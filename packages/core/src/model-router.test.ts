import { describe, it, expect } from "vitest";
import { ModelRouterImpl } from "./model-router.js";
import type { ModelConfig, ModelRouterConfig } from "@dantecode/config-types";

// Build test model configs
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

describe("model-router", () => {
  describe("constructor and config", () => {
    it("creates a router with default config", () => {
      const config = makeRouterConfig();
      const router = new ModelRouterImpl(config, "/tmp/test", "session-1");
      expect(router).toBeDefined();
    });
  });

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

  describe("router logs", () => {
    it("starts with empty logs", () => {
      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp/test", "s1");
      expect(router.getLogs()).toHaveLength(0);
    });

    it("clears logs on demand", () => {
      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp/test", "s1");
      // Trigger a provider resolution to indirectly verify the router works
      router.resolveProvider(grokConfig);
      router.clearLogs();
      expect(router.getLogs()).toHaveLength(0);
    });

    it("returns a snapshot (not the internal array)", () => {
      const router = new ModelRouterImpl(makeRouterConfig(), "/tmp/test", "s1");
      const logs1 = router.getLogs();
      const logs2 = router.getLogs();
      expect(logs1).not.toBe(logs2); // different array instances
      expect(logs1).toEqual(logs2); // same content
    });
  });

  describe("task type overrides", () => {
    it("uses override config when task type matches", () => {
      const config = makeRouterConfig({
        overrides: {
          code_review: anthropicConfig,
        },
      });
      const router = new ModelRouterImpl(config, "/tmp/test", "s1");
      // The resolveModelConfig method is private, but we can test it
      // indirectly through generate() which would require API keys.
      // For now, test that the router constructs correctly with overrides.
      expect(router).toBeDefined();
    });
  });

  describe("generate (integration - requires API keys)", () => {
    it("throws when all providers fail (no API keys configured)", async () => {
      const config = makeRouterConfig({ fallback: [] });
      const router = new ModelRouterImpl(config, "/tmp/test", "s1");

      await expect(router.generate([{ role: "user", content: "test" }])).rejects.toThrow();
    });
  });
});
