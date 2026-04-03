import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type {
  ModelConfig,
  ModelRouterConfig,
  RoutingContext,
  BladeAutoforgeConfig,
} from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Mock external dependencies BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("./audit.js", () => ({
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock providers so they don't need real API keys
const mockModel = { modelId: "mock-model" };
vi.mock("./providers/index.js", () => ({
  PROVIDER_BUILDERS: {
    grok: vi.fn(() => mockModel),
    anthropic: vi.fn(() => mockModel),
    openai: vi.fn(() => mockModel),
    ollama: vi.fn(() => mockModel),
  },
}));

import { ModelRouterImpl, shouldContinueLoop } from "./model-router.js";
import { generateText, streamText } from "ai";
import { appendAuditEvent } from "./audit.js";

// ---------------------------------------------------------------------------
// Test configs
// ---------------------------------------------------------------------------

const grokConfig: ModelConfig = {
  provider: "grok",
  modelId: "grok-3",
  maxTokens: 8192,
  temperature: 0.1,
  contextWindow: 131072,
  supportsVision: false,
  supportsToolCalls: true,
};

const anthropicConfig: ModelConfig = {
  provider: "anthropic",
  modelId: "claude-sonnet-4-6",
  maxTokens: 8192,
  temperature: 0.1,
  contextWindow: 200000,
  supportsVision: true,
  supportsToolCalls: true,
};

const openaiConfig: ModelConfig = {
  provider: "openai",
  modelId: "gpt-4.1",
  maxTokens: 8192,
  temperature: 0.1,
  contextWindow: 128000,
  supportsVision: true,
  supportsToolCalls: true,
};

function makeRouterConfig(overrides?: Partial<ModelRouterConfig>): ModelRouterConfig {
  return {
    default: grokConfig,
    fallback: [anthropicConfig],
    overrides: {},
    ...overrides,
  };
}

const testMessages = [{ role: "user" as const, content: "test prompt" }];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("model-router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor and Config
  // -------------------------------------------------------------------------

  describe("constructor and config", () => {
    it("creates a router with default config", () => {
      const config = makeRouterConfig();
      const router = new ModelRouterImpl(config, "/tmp/test", "session-1");
      expect(router).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // resolveProvider
  // -------------------------------------------------------------------------

  describe("resolveProvider", () => {
    it("resolves grok provider", () => {
      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp/test", "s1");
      const builder = router.resolveProvider(grokConfig);
      expect(builder).toBeDefined();
      expect(typeof builder).toBe("function");
    });

    it("resolves anthropic provider", () => {
      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp/test", "s1");
      const builder = router.resolveProvider(anthropicConfig);
      expect(builder).toBeDefined();
    });

    it("resolves openai provider", () => {
      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp/test", "s1");
      const builder = router.resolveProvider(openaiConfig);
      expect(builder).toBeDefined();
    });

    it("throws for unknown provider", () => {
      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp/test", "s1");
      const badConfig = { ...grokConfig, provider: "nonexistent" as ModelConfig["provider"] };
      expect(() => router.resolveProvider(badConfig)).toThrow("Unknown model provider");
    });

    it("includes available providers in error message", () => {
      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp/test", "s1");
      const badConfig = { ...grokConfig, provider: "nonexistent" as ModelConfig["provider"] };
      try {
        router.resolveProvider(badConfig);
      } catch (err) {
        expect(String(err)).toContain("grok");
        expect(String(err)).toContain("anthropic");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Router logs
  // -------------------------------------------------------------------------

  describe("router logs", () => {
    it("starts with empty logs", () => {
      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp/test", "s1");
      expect(router.getLogs()).toHaveLength(0);
    });

    it("clears logs on demand", () => {
      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp/test", "s1");
      router.resolveProvider(grokConfig);
      router.clearLogs();
      expect(router.getLogs()).toHaveLength(0);
    });

    it("returns a snapshot (not the internal array)", () => {
      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp/test", "s1");
      const logs1 = router.getLogs();
      const logs2 = router.getLogs();
      expect(logs1).not.toBe(logs2);
      expect(logs1).toEqual(logs2);
    });
  });

  // -------------------------------------------------------------------------
  // generate()
  // -------------------------------------------------------------------------

  describe("generate", () => {
    it("returns text on successful generation", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "Hello world",
        usage: { totalTokens: 50 },
      });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      const result = await router.generate(testMessages);

      expect(result).toBe("Hello world");
    });

    it("logs attempt and success entries", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "response",
        usage: { totalTokens: 100 },
      });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.generate(testMessages);

      const logs = router.getLogs();
      expect(logs.length).toBe(2);
      expect(logs[0]!.action).toBe("attempt");
      expect(logs[1]!.action).toBe("success");
      expect(logs[0]!.provider).toBe("grok");
    });

    it("calls appendAuditEvent with token count", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "response",
        usage: { totalTokens: 200 },
      });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.generate(testMessages);

      expect(appendAuditEvent).toHaveBeenCalledTimes(1);
      const auditCall = (appendAuditEvent as Mock).mock.calls[0]!;
      expect(auditCall[1].payload.tokensUsed).toBe(200);
    });

    it("falls back to secondary provider when primary fails", async () => {
      (generateText as Mock)
        .mockRejectedValueOnce(new Error("primary failed"))
        .mockResolvedValueOnce({
          text: "fallback response",
          usage: { totalTokens: 75 },
        });

      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp", "s1");
      const result = await router.generate(testMessages);

      expect(result).toBe("fallback response");
      const logs = router.getLogs();
      const actions = logs.map((l) => l.action);
      expect(actions).toContain("attempt");
      expect(actions).toContain("error");
      expect(actions).toContain("fallback");
      expect(actions).toContain("success");
    });

    it("throws primary error when all providers fail", async () => {
      (generateText as Mock)
        .mockRejectedValueOnce(new Error("primary failed"))
        .mockRejectedValueOnce(new Error("fallback failed"));

      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp", "s1");
      await expect(router.generate(testMessages)).rejects.toThrow("primary failed");
    });

    it("passes maxTokens override to generateText", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "ok",
        usage: { totalTokens: 10 },
      });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.generate(testMessages, { maxTokens: 1024 });

      const callArgs = (generateText as Mock).mock.calls[0]![0];
      expect(callArgs.maxTokens).toBe(1024);
    });

    it("uses config maxTokens when no override is provided", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "ok",
        usage: { totalTokens: 10 },
      });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.generate(testMessages);

      const callArgs = (generateText as Mock).mock.calls[0]![0];
      expect(callArgs.maxTokens).toBe(grokConfig.maxTokens);
    });

    it("passes system prompt when provided", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "ok",
        usage: { totalTokens: 10 },
      });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.generate(testMessages, { system: "You are a helpful assistant" });

      const callArgs = (generateText as Mock).mock.calls[0]![0];
      expect(callArgs.system).toBe("You are a helpful assistant");
    });

    it("omits system key when not provided", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "ok",
        usage: { totalTokens: 10 },
      });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.generate(testMessages);

      const callArgs = (generateText as Mock).mock.calls[0]![0];
      expect(callArgs).not.toHaveProperty("system");
    });

    it("uses task type override when matching", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "override response",
        usage: { totalTokens: 10 },
      });

      const config = makeRouterConfig({
        overrides: { code_review: anthropicConfig },
        fallback: [],
      });
      const router = new ModelRouterImpl(config, "/tmp", "s1");
      await router.generate(testMessages, { taskType: "code_review" });

      const logs = router.getLogs();
      expect(logs[0]!.provider).toBe("anthropic");
      expect(logs[0]!.modelId).toBe("claude-sonnet-4-6");
    });

    it("uses default config when task type has no override", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "default response",
        usage: { totalTokens: 10 },
      });

      const config = makeRouterConfig({
        overrides: { code_review: anthropicConfig },
        fallback: [],
      });
      const router = new ModelRouterImpl(config, "/tmp", "s1");
      await router.generate(testMessages, { taskType: "unknown_task" });

      const logs = router.getLogs();
      expect(logs[0]!.provider).toBe("grok");
    });

    it("handles null usage gracefully", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "ok",
        usage: null,
      });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      const result = await router.generate(testMessages);
      expect(result).toBe("ok");

      const auditCall = (appendAuditEvent as Mock).mock.calls[0]!;
      expect(auditCall[1].payload.tokensUsed).toBe(0);
    });

    it("still succeeds when audit logging fails", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "response despite audit failure",
        usage: { totalTokens: 50 },
      });
      (appendAuditEvent as Mock).mockRejectedValueOnce(new Error("audit failed"));

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      const result = await router.generate(testMessages);
      expect(result).toBe("response despite audit failure");
    });

    it("wraps non-Error thrown values", async () => {
      (generateText as Mock).mockRejectedValueOnce("string error");

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await expect(router.generate(testMessages)).rejects.toThrow("string error");
    });

    it("clears logs after generate runs", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "ok",
        usage: { totalTokens: 10 },
      });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.generate(testMessages);
      expect(router.getLogs().length).toBeGreaterThan(0);

      router.clearLogs();
      expect(router.getLogs()).toHaveLength(0);
    });

    it("passes extended thinking provider options to supported Anthropic models", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "reasoned response",
        usage: { totalTokens: 120 },
      });

      const router = new ModelRouterImpl(
        makeRouterConfig({
          default: {
            ...anthropicConfig,
            supportsExtendedThinking: true,
            reasoningEffort: "high",
          },
          fallback: [],
        }),
        "/tmp",
        "s1",
      );

      await router.generate(testMessages, { thinkingBudget: 2048 });

      const callArgs = (generateText as Mock).mock.calls[0]![0];
      expect(callArgs.providerOptions).toEqual({
        anthropic: {
          thinking: {
            type: "enabled",
            budgetTokens: 2048,
          },
          reasoningEffort: "high",
        },
      });
    });

    it("omits provider options when the selected model does not support extended thinking", async () => {
      (generateText as Mock).mockResolvedValueOnce({
        text: "standard response",
        usage: { totalTokens: 40 },
      });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.generate(testMessages, { thinkingBudget: 1024 });

      const callArgs = (generateText as Mock).mock.calls[0]![0];
      expect(callArgs.providerOptions).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // stream()
  // -------------------------------------------------------------------------

  describe("stream", () => {
    it("returns stream result on success", async () => {
      const mockStream = { type: "mock-stream" };
      (streamText as Mock).mockReturnValueOnce(mockStream);

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      const result = await router.stream(testMessages);

      expect(result).toBe(mockStream);
    });

    it("logs attempt entry for stream", async () => {
      (streamText as Mock).mockReturnValueOnce({ type: "mock-stream" });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.stream(testMessages);

      const logs = router.getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0]!.action).toBe("attempt");
    });

    it("falls back when primary stream fails", async () => {
      const fallbackStream = { type: "fallback-stream" };
      (streamText as Mock)
        .mockImplementationOnce(() => {
          throw new Error("stream failed");
        })
        .mockReturnValueOnce(fallbackStream);

      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp", "s1");
      const result = await router.stream(testMessages);

      expect(result).toBe(fallbackStream);
      const actions = router.getLogs().map((l) => l.action);
      expect(actions).toContain("error");
      expect(actions).toContain("fallback");
    });

    it("throws when all stream providers fail", async () => {
      (streamText as Mock)
        .mockImplementationOnce(() => {
          throw new Error("primary stream failed");
        })
        .mockImplementationOnce(() => {
          throw new Error("fallback stream failed");
        });

      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp", "s1");
      await expect(router.stream(testMessages)).rejects.toThrow("primary stream failed");
    });

    it("passes maxTokens override to streamText", async () => {
      (streamText as Mock).mockReturnValueOnce({ type: "mock-stream" });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.stream(testMessages, { maxTokens: 2048 });

      const callArgs = (streamText as Mock).mock.calls[0]![0];
      expect(callArgs.maxTokens).toBe(2048);
    });

    it("passes system prompt to streamText", async () => {
      (streamText as Mock).mockReturnValueOnce({ type: "mock-stream" });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.stream(testMessages, { system: "Be concise" });

      const callArgs = (streamText as Mock).mock.calls[0]![0];
      expect(callArgs.system).toBe("Be concise");
    });

    it("provides onFinish callback to streamText", async () => {
      (streamText as Mock).mockReturnValueOnce({ type: "mock-stream" });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.stream(testMessages);

      const callArgs = (streamText as Mock).mock.calls[0]![0];
      expect(typeof callArgs.onFinish).toBe("function");
    });

    it("onFinish callback logs success and records audit event", async () => {
      let capturedOnFinish: (opts: { usage?: { totalTokens: number } }) => Promise<void>;

      (streamText as Mock).mockImplementationOnce((opts: { onFinish: typeof capturedOnFinish }) => {
        capturedOnFinish = opts.onFinish;
        return { type: "mock-stream" };
      });

      const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s1");
      await router.stream(testMessages);

      // Simulate the AI SDK calling onFinish
      await capturedOnFinish!({ usage: { totalTokens: 300 } });

      const logs = router.getLogs();
      expect(logs.some((l) => l.action === "success")).toBe(true);
      expect(appendAuditEvent).toHaveBeenCalledTimes(1);
      const auditCall = (appendAuditEvent as Mock).mock.calls[0]!;
      expect(auditCall[1].payload.tokensUsed).toBe(300);
    });

    it("uses task type override for stream", async () => {
      (streamText as Mock).mockReturnValueOnce({ type: "mock-stream" });

      const config = makeRouterConfig({
        overrides: { code_review: anthropicConfig },
        fallback: [],
      });
      const router = new ModelRouterImpl(config, "/tmp", "s1");
      await router.stream(testMessages, { taskType: "code_review" });

      const logs = router.getLogs();
      expect(logs[0]!.provider).toBe("anthropic");
    });
  });
});

// ---------------------------------------------------------------------------
// Blade v1.2 — shared routerConfig for new test blocks
// ---------------------------------------------------------------------------

const routerConfig: ModelRouterConfig = {
  default: grokConfig,
  fallback: [anthropicConfig],
  overrides: {},
};

// ---------------------------------------------------------------------------
// Blade v1.2 — selectTier tests (D6)
// ---------------------------------------------------------------------------

describe("selectTier", () => {
  let router: ModelRouterImpl;

  beforeEach(() => {
    router = new ModelRouterImpl(routerConfig, "/test", "session-1");
  });

  it("returns 'fast' for 500-token chat context", () => {
    const ctx: RoutingContext = {
      estimatedInputTokens: 500,
      taskType: "chat",
      consecutiveGstackFailures: 0,
      filesInScope: 1,
      forceCapable: false,
    };
    expect(router.selectTier(ctx)).toBe("fast");
  });

  it("returns 'capable' for 3000-token context", () => {
    const ctx: RoutingContext = {
      estimatedInputTokens: 3000,
      taskType: "chat",
      consecutiveGstackFailures: 0,
      filesInScope: 1,
      forceCapable: false,
    };
    expect(router.selectTier(ctx)).toBe("capable");
  });

  it("returns 'capable' for autoforge task type", () => {
    const ctx: RoutingContext = {
      estimatedInputTokens: 100,
      taskType: "autoforge",
      consecutiveGstackFailures: 0,
      filesInScope: 1,
      forceCapable: false,
    };
    expect(router.selectTier(ctx)).toBe("capable");
  });

  it("returns 'capable' when consecutiveGstackFailures >= 2", () => {
    const ctx: RoutingContext = {
      estimatedInputTokens: 100,
      taskType: "chat",
      consecutiveGstackFailures: 2,
      filesInScope: 1,
      forceCapable: false,
    };
    expect(router.selectTier(ctx)).toBe("capable");
  });

  it("returns 'capable' when filesInScope >= 3", () => {
    const ctx: RoutingContext = {
      estimatedInputTokens: 100,
      taskType: "chat",
      consecutiveGstackFailures: 0,
      filesInScope: 3,
      forceCapable: false,
    };
    expect(router.selectTier(ctx)).toBe("capable");
  });

  it("returns 'capable' when forceCapable=true regardless of tokens", () => {
    const ctx: RoutingContext = {
      estimatedInputTokens: 10,
      taskType: "chat",
      consecutiveGstackFailures: 0,
      filesInScope: 1,
      forceCapable: true,
    };
    expect(router.selectTier(ctx)).toBe("capable");
  });

  it("always returns 'capable' once escalated (no de-escalation)", () => {
    const escalateCtx: RoutingContext = {
      estimatedInputTokens: 5000,
      taskType: "chat",
      consecutiveGstackFailures: 0,
      filesInScope: 1,
      forceCapable: false,
    };
    router.selectTier(escalateCtx);
    const smallCtx: RoutingContext = {
      estimatedInputTokens: 10,
      taskType: "chat",
      consecutiveGstackFailures: 0,
      filesInScope: 1,
      forceCapable: false,
    };
    expect(router.selectTier(smallCtx)).toBe("capable");
  });

  it("escalates to capable when modelRatedComplexity >= 0.4", () => {
    const ctx: RoutingContext = {
      estimatedInputTokens: 100,
      taskType: "chat",
      consecutiveGstackFailures: 0,
      filesInScope: 1,
      forceCapable: false,
      promptComplexity: 0.1,
      modelRatedComplexity: 0.6,
    };
    expect(router.selectTier(ctx)).toBe("capable");
  });

  it("stays fast when both complexities are below threshold", () => {
    const freshRouter = new ModelRouterImpl(routerConfig, "/test", "session-new");
    const ctx: RoutingContext = {
      estimatedInputTokens: 100,
      taskType: "chat",
      consecutiveGstackFailures: 0,
      filesInScope: 1,
      forceCapable: false,
      promptComplexity: 0.1,
      modelRatedComplexity: 0.2,
    };
    expect(freshRouter.selectTier(ctx)).toBe("fast");
  });
});

// ---------------------------------------------------------------------------
// Model-Assisted Complexity Scoring
// ---------------------------------------------------------------------------

describe("extractModelComplexityRating", () => {
  let router: ModelRouterImpl;

  beforeEach(() => {
    router = new ModelRouterImpl(routerConfig, "/test", "session-1");
  });

  it("extracts explicit [COMPLEXITY: 0.8] tag", () => {
    const score = router.extractModelComplexityRating(
      "Here is my plan for the refactor...\n[COMPLEXITY: 0.8]",
    );
    expect(score).toBe(0.8);
  });

  it("extracts [COMPLEXITY: 0.0] for trivial tasks", () => {
    const score = router.extractModelComplexityRating("Done!\n[COMPLEXITY: 0.0]");
    expect(score).toBe(0);
  });

  it("extracts [COMPLEXITY: 1.0] for maximum complexity", () => {
    const score = router.extractModelComplexityRating("Very complex.\n[COMPLEXITY: 1.0]");
    expect(score).toBe(1.0);
  });

  it("returns heuristic score based on user prompt complexity", () => {
    const score = router.extractModelComplexityRating(
      "Here is my response.",
      "Refactor the entire auth module across all files and handle every edge case with database transactions",
    );
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("falls back to response-based heuristic when no userPrompt", () => {
    const score = router.extractModelComplexityRating(
      "I need to refactor the auth module across all services and handle edge cases with database transactions",
    );
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("scores complex prompt higher than simple prompt", () => {
    const router1 = new ModelRouterImpl(routerConfig, "/test", "s1");
    const router2 = new ModelRouterImpl(routerConfig, "/test", "s2");

    const simple = router1.extractModelComplexityRating("ok", "rename this variable");
    const complex = router2.extractModelComplexityRating(
      "ok",
      "Refactor the entire database migration pipeline across all services, handle edge cases with retry logic and parallel transaction rollback",
    );

    expect(complex!).toBeGreaterThan(simple!);
  });

  it("caches result and returns same value on second call", () => {
    const first = router.extractModelComplexityRating("[COMPLEXITY: 0.6]");
    const second = router.extractModelComplexityRating("[COMPLEXITY: 0.9]");
    expect(first).toBe(0.6);
    expect(second).toBe(0.6);
  });

  it("returns baseline heuristic on empty response and prompt", () => {
    const score = router.extractModelComplexityRating("", "");
    expect(score).toBeGreaterThanOrEqual(0.3);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("resets cache when resetSessionCost is called", () => {
    router.extractModelComplexityRating("[COMPLEXITY: 0.5]");
    expect(router.getModelRatedComplexity()).toBe(0.5);
    router.resetSessionCost();
    expect(router.getModelRatedComplexity()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Blade v1.2 — Cost Accumulator tests (D6)
// ---------------------------------------------------------------------------

describe("recordRequestCost", () => {
  let router: ModelRouterImpl;

  beforeEach(() => {
    router = new ModelRouterImpl(routerConfig, "/test", "session-1");
  });

  it("accumulates correctly across 3 mock requests", () => {
    router.recordRequestCost(1000, 500, "fast", "grok");
    router.recordRequestCost(2000, 1000, "fast", "grok");
    const result = router.recordRequestCost(500, 200, "fast", "grok");
    expect(result.sessionTotalUsd).toBeGreaterThan(0);
    expect(result.tokensUsedSession).toBe(1000 + 500 + 2000 + 1000 + 500 + 200);
  });

  it("estimateTokens returns ceil(chars/4)", () => {
    expect(router.estimateTokens("hello world!")).toBe(3); // 12 chars / 4 = 3
    expect(router.estimateTokens("a")).toBe(1);
    expect(router.estimateTokens("ab")).toBe(1);
    expect(router.estimateTokens("abc")).toBe(1);
    expect(router.estimateTokens("abcd")).toBe(1);
    expect(router.estimateTokens("abcde")).toBe(2);
  });

  it("resetSessionCost resets all accumulators to zero", () => {
    router.recordRequestCost(5000, 3000, "capable", "grok");
    router.resetSessionCost();
    const estimate = router.getCostEstimate();
    expect(estimate.sessionTotalUsd).toBe(0);
    expect(estimate.tokensUsedSession).toBe(0);
    expect(estimate.modelTier).toBe("fast");
  });

  it("getCostEstimate reflects current session state", () => {
    router.recordRequestCost(1000, 500, "fast", "grok");
    const estimate = router.getCostEstimate();
    expect(estimate.sessionTotalUsd).toBeGreaterThan(0);
    expect(estimate.modelTier).toBe("fast");
  });
});

// ---------------------------------------------------------------------------
// Blade v1.2 — shouldContinueLoop tests (D4)
// ---------------------------------------------------------------------------

describe("shouldContinueLoop", () => {
  const baseConfig: BladeAutoforgeConfig = {
    enabled: true,
    autoRunOnWrite: false,
    maxIterations: 5,
    gstackCommands: [],
    lessonInjectionEnabled: false,
    abortOnSecurityViolation: false,
    persistUntilGreen: false,
  };

  it("stops when toolCallCount === 0 regardless of roundsRemaining", () => {
    const result = shouldContinueLoop(0, 100, false, 50, baseConfig);
    expect(result.shouldContinue).toBe(false);
    expect(result.reason).toBe("natural_completion");
  });

  it("stops when roundsRemaining reaches 0 even if quality not met", () => {
    const result = shouldContinueLoop(3, 0, false, 50, baseConfig);
    expect(result.shouldContinue).toBe(false);
    expect(result.reason).toBe("hard_ceiling_reached");
  });

  it("stops when persistUntilGreen=true AND gstackPassed AND pdse>=90", () => {
    const cfg = { ...baseConfig, persistUntilGreen: true };
    const result = shouldContinueLoop(2, 100, true, 95, cfg);
    expect(result.shouldContinue).toBe(false);
    expect(result.reason).toBe("quality_gate_passed");
  });

  it("continues past maxToolRounds when persistUntilGreen=true and quality not met", () => {
    const cfg = { ...baseConfig, persistUntilGreen: true };
    const result = shouldContinueLoop(2, 50, false, 70, cfg);
    expect(result.shouldContinue).toBe(true);
  });

  it("continues when there are tool calls and rounds remaining", () => {
    const result = shouldContinueLoop(3, 10, false, 50, baseConfig);
    expect(result.shouldContinue).toBe(true);
  });

  it("does not trigger quality_gate_passed when persistUntilGreen=false", () => {
    const result = shouldContinueLoop(2, 100, true, 95, baseConfig);
    expect(result.shouldContinue).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Blade v1.2 — D6 cost tracking integration tests
// ---------------------------------------------------------------------------

describe("D6 cost tracking integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generate() tracks cost after successful completion", async () => {
    (generateText as Mock).mockResolvedValueOnce({
      text: "cost-tracked response",
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s-cost-1");
    await router.generate(testMessages);

    const estimate = router.getCostEstimate();
    expect(estimate.sessionTotalUsd).toBeGreaterThan(0);
    expect(estimate.tokensUsedSession).toBe(150);
  });

  it("stream() tracks cost in onFinish callback", async () => {
    let capturedOnFinish: (opts: {
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    }) => Promise<void>;

    (streamText as Mock).mockImplementationOnce((opts: { onFinish: typeof capturedOnFinish }) => {
      capturedOnFinish = opts.onFinish;
      return { type: "mock-stream" };
    });

    const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s-cost-2");
    await router.stream(testMessages);

    // Simulate the AI SDK calling onFinish after stream completes
    await capturedOnFinish!({
      usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
    });

    const estimate = router.getCostEstimate();
    expect(estimate.sessionTotalUsd).toBeGreaterThan(0);
    expect(estimate.tokensUsedSession).toBe(300);
  });

  it("cost accumulates across multiple generate calls", async () => {
    (generateText as Mock)
      .mockResolvedValueOnce({
        text: "first",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      })
      .mockResolvedValueOnce({
        text: "second",
        usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
      });

    const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s-cost-3");
    await router.generate(testMessages);
    const afterFirst = router.getCostEstimate();

    await router.generate(testMessages);
    const afterSecond = router.getCostEstimate();

    expect(afterSecond.sessionTotalUsd).toBeGreaterThan(afterFirst.sessionTotalUsd);
    expect(afterSecond.tokensUsedSession).toBe(150 + 280);
  });

  it("anthropic provider uses anthropic rates", async () => {
    (generateText as Mock).mockResolvedValueOnce({
      text: "anthropic response",
      usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
    });

    // Use anthropic as the default provider
    const anthropicRouterConfig = makeRouterConfig({
      default: anthropicConfig,
      fallback: [],
    });
    const router = new ModelRouterImpl(anthropicRouterConfig, "/tmp", "s-cost-4");
    await router.generate(testMessages);

    const estimate = router.getCostEstimate();
    // Anthropic rates: input=3.00/MTk, output=15.00/MTk
    // Expected: (1000 * 3.00 + 500 * 15.00) / 1_000_000 = (3000 + 7500) / 1_000_000 = 0.0105
    const expectedCost = (1000 * 3.0 + 500 * 15.0) / 1_000_000;
    expect(estimate.sessionTotalUsd).toBeCloseTo(expectedCost, 8);
  });

  it("grok fast tier uses lower rates", async () => {
    (generateText as Mock).mockResolvedValueOnce({
      text: "grok fast response",
      usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
    });

    const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s-cost-5");
    await router.generate(testMessages);

    const estimate = router.getCostEstimate();
    // Grok fast rates: input=0.30/MTk, output=0.60/MTk
    // Expected: (1000 * 0.30 + 500 * 0.60) / 1_000_000 = (300 + 300) / 1_000_000 = 0.0006
    const expectedCost = (1000 * 0.3 + 500 * 0.6) / 1_000_000;
    expect(estimate.sessionTotalUsd).toBeCloseTo(expectedCost, 8);
  });

  it("grok capable tier uses higher rates", async () => {
    (generateText as Mock).mockResolvedValueOnce({
      text: "grok capable response",
      usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
    });

    const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s-cost-6");
    // Force escalation to capable tier before generating
    router.forceCapable();
    await router.generate(testMessages);

    const estimate = router.getCostEstimate();
    // Grok capable rates: input=3.00/MTk, output=6.00/MTk
    // Expected: (1000 * 3.00 + 500 * 6.00) / 1_000_000 = (3000 + 3000) / 1_000_000 = 0.006
    const expectedCost = (1000 * 3.0 + 500 * 6.0) / 1_000_000;
    expect(estimate.sessionTotalUsd).toBeCloseTo(expectedCost, 8);
  });

  it("escalateTier promotes the session to capable and records an audit reason", () => {
    const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s-cost-6b");

    router.escalateTier("persistent verification failures");

    expect(router.getCurrentTier()).toBe("capable");
    expect(appendAuditEvent).toHaveBeenCalledWith(
      "/tmp",
      expect.objectContaining({
        type: "tier_escalation",
        payload: expect.objectContaining({ reason: "persistent verification failures" }),
      }),
    );
  });

  it("resetSessionCost clears accumulated cost", async () => {
    (generateText as Mock).mockResolvedValueOnce({
      text: "will be cleared",
      usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    });

    const router = new ModelRouterImpl(makeRouterConfig({ fallback: [] }), "/tmp", "s-cost-7");
    await router.generate(testMessages);

    // Verify cost was tracked
    const beforeReset = router.getCostEstimate();
    expect(beforeReset.sessionTotalUsd).toBeGreaterThan(0);
    expect(beforeReset.tokensUsedSession).toBe(700);

    // Reset and verify everything is cleared
    router.resetSessionCost();
    const afterReset = router.getCostEstimate();
    expect(afterReset.sessionTotalUsd).toBe(0);
    expect(afterReset.tokensUsedSession).toBe(0);
  });
});
