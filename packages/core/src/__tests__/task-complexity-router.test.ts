// packages/core/src/__tests__/task-complexity-router.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  classifyTaskComplexity,
  routeByComplexity,
  detectAvailableProviders,
  type TaskSignals,
} from "../task-complexity-router.js";
import type { ModelProvider } from "@dantecode/config-types";

describe("classifyTaskComplexity", () => {
  it("returns forceComplexity override when set", () => {
    const signals: TaskSignals = { promptTokens: 100, forceComplexity: "reasoning" };
    expect(classifyTaskComplexity(signals)).toBe("reasoning");
  });

  it("returns reasoning when requiresReasoning is true", () => {
    const signals: TaskSignals = { promptTokens: 100, requiresReasoning: true };
    expect(classifyTaskComplexity(signals)).toBe("reasoning");
  });

  it("returns complex when multiFile and requiresTools both true", () => {
    const signals: TaskSignals = { promptTokens: 500, multiFile: true, requiresTools: true };
    expect(classifyTaskComplexity(signals)).toBe("complex");
  });

  it("returns moderate when promptTokens > 8000", () => {
    const signals: TaskSignals = { promptTokens: 9000 };
    expect(classifyTaskComplexity(signals)).toBe("moderate");
  });

  it("returns moderate when multiFile is true without requiresTools", () => {
    const signals: TaskSignals = { promptTokens: 300, multiFile: true };
    expect(classifyTaskComplexity(signals)).toBe("moderate");
  });

  it("returns simple for FIM with promptTokens < 2000", () => {
    const signals: TaskSignals = { promptTokens: 1500, isFim: true };
    expect(classifyTaskComplexity(signals)).toBe("simple");
  });

  it("returns trivial for FIM with promptTokens < 500", () => {
    const signals: TaskSignals = { promptTokens: 300, isFim: true };
    expect(classifyTaskComplexity(signals)).toBe("trivial");
  });

  it("returns moderate when promptTokens > 4000 (not FIM)", () => {
    const signals: TaskSignals = { promptTokens: 5000 };
    expect(classifyTaskComplexity(signals)).toBe("moderate");
  });

  it("defaults to simple for small non-FIM prompts", () => {
    const signals: TaskSignals = { promptTokens: 300 };
    expect(classifyTaskComplexity(signals)).toBe("simple");
  });

  it("requiresReasoning overrides multiFile+requiresTools", () => {
    const signals: TaskSignals = {
      promptTokens: 500,
      requiresReasoning: true,
      multiFile: true,
      requiresTools: true,
    };
    expect(classifyTaskComplexity(signals)).toBe("reasoning");
  });
});

describe("routeByComplexity", () => {
  it("routes trivial to ollama when available", () => {
    const providers = new Set<ModelProvider>(["ollama"]);
    const result = routeByComplexity({ promptTokens: 100, isFim: true }, providers);
    expect(result.provider).toBe("ollama");
    expect(result.complexity).toBe("trivial");
  });

  it("routes simple to mistral/codestral when available", () => {
    const providers = new Set<ModelProvider>(["ollama", "mistral"]);
    const result = routeByComplexity({ promptTokens: 1500, isFim: true }, providers);
    expect(result.provider).toBe("mistral");
    expect(result.modelId).toContain("codestral");
  });

  it("routes moderate to deepseek when available", () => {
    const providers = new Set<ModelProvider>(["ollama", "deepseek", "anthropic"]);
    const result = routeByComplexity({ promptTokens: 5000 }, providers);
    expect(result.provider).toBe("deepseek");
  });

  it("routes complex to anthropic sonnet", () => {
    const providers = new Set<ModelProvider>(["anthropic"]);
    const result = routeByComplexity({ promptTokens: 500, multiFile: true, requiresTools: true }, providers);
    expect(result.provider).toBe("anthropic");
    expect(result.modelId).toContain("sonnet");
  });

  it("routes reasoning to anthropic opus", () => {
    const providers = new Set<ModelProvider>(["anthropic"]);
    const result = routeByComplexity({ promptTokens: 100, requiresReasoning: true }, providers);
    expect(result.provider).toBe("anthropic");
    expect(result.modelId).toContain("opus");
  });

  it("falls back to groq when mistral not available for simple", () => {
    const providers = new Set<ModelProvider>(["ollama", "groq"]);
    const result = routeByComplexity({ promptTokens: 1500, isFim: true }, providers);
    expect(result.provider).toBe("groq");
    expect(result.rationale).toContain("preferred unavailable");
  });

  it("falls back to anthropic sonnet as last resort", () => {
    const providers = new Set<ModelProvider>(["anthropic"]);
    const result = routeByComplexity({ promptTokens: 5000 }, providers);
    // deepseek and anthropic-haiku not available, falls back to sonnet
    expect(result.provider).toBe("anthropic");
  });

  it("includes rationale string in result", () => {
    const providers = new Set<ModelProvider>(["ollama", "anthropic"]);
    const result = routeByComplexity({ promptTokens: 100, requiresReasoning: true }, providers);
    expect(result.rationale).toBeTruthy();
    expect(typeof result.rationale).toBe("string");
  });
});

describe("detectAvailableProviders", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Remove all relevant keys
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["GROQ_API_KEY"];
    delete process.env["DEEPSEEK_API_KEY"];
    delete process.env["MISTRAL_API_KEY"];
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["XAI_API_KEY"];
    delete process.env["GOOGLE_API_KEY"];
    delete process.env["GEMINI_API_KEY"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("always includes ollama (local fallback)", () => {
    const providers = detectAvailableProviders();
    expect(providers.has("ollama")).toBe(true);
  });

  it("includes anthropic when ANTHROPIC_API_KEY set", () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-test";
    const providers = detectAvailableProviders();
    expect(providers.has("anthropic")).toBe(true);
  });

  it("includes deepseek when DEEPSEEK_API_KEY set", () => {
    process.env["DEEPSEEK_API_KEY"] = "sk-test";
    const providers = detectAvailableProviders();
    expect(providers.has("deepseek")).toBe(true);
  });

  it("includes mistral when MISTRAL_API_KEY set", () => {
    process.env["MISTRAL_API_KEY"] = "sk-test";
    const providers = detectAvailableProviders();
    expect(providers.has("mistral")).toBe(true);
  });

  it("includes openrouter when OPENROUTER_API_KEY set", () => {
    process.env["OPENROUTER_API_KEY"] = "sk-test";
    const providers = detectAvailableProviders();
    expect(providers.has("openrouter")).toBe(true);
  });

  it("does not include anthropic when key not set", () => {
    const providers = detectAvailableProviders();
    expect(providers.has("anthropic")).toBe(false);
  });

  it("includes groq when GROQ_API_KEY set", () => {
    process.env["GROQ_API_KEY"] = "gsk_test";
    const providers = detectAvailableProviders();
    expect(providers.has("groq")).toBe(true);
  });

  it("includes grok when XAI_API_KEY set", () => {
    process.env["XAI_API_KEY"] = "xai-test";
    const providers = detectAvailableProviders();
    expect(providers.has("grok")).toBe(true);
  });
});
