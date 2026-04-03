/**
 * model-capabilities.test.ts — DTR Phase 5 unit tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ModelCapabilityRegistry,
  globalModelRegistry,
  BUILTIN_CAPABILITY_PROFILES,
} from "./model-capabilities.js";

describe("BUILTIN_CAPABILITY_PROFILES", () => {
  it("has profiles for all known providers", () => {
    const providers = new Set(BUILTIN_CAPABILITY_PROFILES.map((p) => p.provider));
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("grok")).toBe(true);
    expect(providers.has("openai")).toBe(true);
    expect(providers.has("ollama")).toBe(true);
    expect(providers.has("google")).toBe(true);
    expect(providers.has("groq")).toBe(true);
  });

  it("all profiles have required fields", () => {
    for (const p of BUILTIN_CAPABILITY_PROFILES) {
      expect(typeof p.provider).toBe("string");
      expect(typeof p.supportsToolCalls).toBe("boolean");
      expect(typeof p.supportsStreaming).toBe("boolean");
      expect(typeof p.safeForPlanner).toBe("boolean");
      expect(typeof p.timeoutMs).toBe("number");
      expect(typeof p.retryProfile).toBe("object");
    }
  });
});

describe("ModelCapabilityRegistry.lookup", () => {
  let registry: ModelCapabilityRegistry;

  beforeEach(() => {
    registry = new ModelCapabilityRegistry();
  });

  it("claude-sonnet matches anthropic provider", () => {
    const profile = registry.lookup("anthropic", "claude-sonnet-4-6");
    expect(profile.provider).toBe("anthropic");
    expect(profile.supportsToolCalls).toBe(true);
    expect(profile.safeForPlanner).toBe(true);
    expect(profile.contextWindowTokens).toBe(200_000);
  });

  it("grok-beta matches grok provider", () => {
    const profile = registry.lookup("grok", "grok-beta");
    expect(profile.provider).toBe("grok");
    expect(profile.supportsToolCalls).toBe(true);
  });

  it("gpt-4o matches openai gpt-4 profile", () => {
    const profile = registry.lookup("openai", "gpt-4o");
    expect(profile.provider).toBe("openai");
    expect(profile.supportsToolCalls).toBe(true);
    expect(profile.safeForPlanner).toBe(true);
  });

  it("o1-mini matches openai reasoning profile (no streaming)", () => {
    const profile = registry.lookup("openai", "o1-mini");
    expect(profile.supportsStreaming).toBe(false);
    expect(profile.timeoutMs).toBe(300_000);
  });

  it("llama3.1 via Ollama supports tool calls", () => {
    const profile = registry.lookup("ollama", "llama3.1");
    expect(profile.kind).toBe("local");
    expect(profile.supportsToolCalls).toBe(true);
    expect(profile.safeForPlanner).toBe(false);
    expect(profile.timeoutMs).toBe(300_000);
  });

  it("qwen2.5 via Ollama supports tool calls", () => {
    const profile = registry.lookup("ollama", "qwen2.5");
    expect(profile.supportsToolCalls).toBe(true);
  });

  it("unknown Ollama model falls back to conservative (no tool calls)", () => {
    const profile = registry.lookup("ollama", "completely-unknown-model:7b");
    expect(profile.kind).toBe("local");
    expect(profile.supportsToolCalls).toBe(false); // conservative fallback
    expect(profile.defaultBaseUrl).toBe("http://localhost:11434/v1");
  });

  it("gemini matches google provider with 1M context", () => {
    const profile = registry.lookup("google", "gemini-2.0-flash");
    expect(profile.provider).toBe("google");
    expect(profile.contextWindowTokens).toBe(1_000_000);
  });

  it("unknown provider returns safe fallback", () => {
    const profile = registry.lookup("mystery-provider", "mystery-model");
    expect(profile.supportsToolCalls).toBe(false);
    expect(profile.safeForPlanner).toBe(false);
    expect(profile.timeoutMs).toBe(120_000);
  });
});

describe("ModelCapabilityRegistry helper methods", () => {
  let registry: ModelCapabilityRegistry;

  beforeEach(() => {
    registry = new ModelCapabilityRegistry();
  });

  it("supportsToolCalls() delegates to lookup", () => {
    expect(registry.supportsToolCalls("anthropic", "claude-opus-4-6")).toBe(true);
    expect(registry.supportsToolCalls("ollama", "unknown-model")).toBe(false);
  });

  it("isLocal() returns true for local providers", () => {
    expect(registry.isLocal("ollama", "llama3.1")).toBe(true);
    expect(registry.isLocal("anthropic", "claude-sonnet-4-6")).toBe(false);
  });

  it("safeForPlanner() returns false for local models", () => {
    expect(registry.safeForPlanner("ollama", "llama3.1")).toBe(false);
    expect(registry.safeForPlanner("anthropic", "claude-sonnet-4-6")).toBe(true);
  });

  it("timeoutMs() returns longer timeout for local models", () => {
    const localTimeout = registry.timeoutMs("ollama", "llama3.1");
    const cloudTimeout = registry.timeoutMs("anthropic", "claude-sonnet-4-6");
    expect(localTimeout).toBeGreaterThan(cloudTimeout);
  });

  it("retryProfile() returns correct maxRetries", () => {
    const profile = registry.retryProfile("anthropic", "claude-sonnet-4-6");
    expect(profile.maxRetries).toBe(3);
    const localProfile = registry.retryProfile("ollama", "llama3.1");
    expect(localProfile.maxRetries).toBe(2);
  });
});

describe("ModelCapabilityRegistry.register", () => {
  it("custom profile takes priority over builtin", () => {
    const registry = new ModelCapabilityRegistry();

    // Override: make claude NOT safe for planner (hypothetical testing scenario)
    registry.register({
      provider: "anthropic",
      kind: "cloud",
      modelIdPattern: /^claude-sonnet/,
      supportsToolCalls: true,
      supportsStreaming: true,
      safeForPlanner: false, // override
      contextWindowTokens: 200_000,
      timeoutMs: 90_000,
      retryProfile: { maxRetries: 1, initialBackoffMs: 100, maxBackoffMs: 1_000 },
    });

    const profile = registry.lookup("anthropic", "claude-sonnet-4-6");
    expect(profile.safeForPlanner).toBe(false);
    expect(profile.timeoutMs).toBe(90_000);
  });

  it("custom profile does not affect other providers", () => {
    const registry = new ModelCapabilityRegistry();
    registry.register({
      provider: "custom-provider",
      kind: "local",
      modelIdPattern: /^mymodel/,
      supportsToolCalls: true,
      supportsStreaming: false,
      safeForPlanner: false,
      contextWindowTokens: 4_096,
      timeoutMs: 60_000,
      retryProfile: { maxRetries: 1, initialBackoffMs: 100, maxBackoffMs: 1_000 },
    });

    // Anthropic still works correctly
    expect(registry.supportsToolCalls("anthropic", "claude-sonnet-4-6")).toBe(true);
    // New custom provider works
    expect(registry.lookup("custom-provider", "mymodel-7b").supportsToolCalls).toBe(true);
  });
});

describe("globalModelRegistry singleton", () => {
  it("is a ModelCapabilityRegistry", () => {
    expect(globalModelRegistry).toBeInstanceOf(ModelCapabilityRegistry);
  });

  it("correctly resolves claude", () => {
    expect(globalModelRegistry.supportsToolCalls("anthropic", "claude-sonnet-4-6")).toBe(true);
  });
});
