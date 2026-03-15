import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ModelConfig, ModelRouterConfig } from "@dantecode/config-types";

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

import { ModelRouterImpl } from "./model-router.js";
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
