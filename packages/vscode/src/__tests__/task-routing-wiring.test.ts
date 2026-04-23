// packages/vscode/src/__tests__/task-routing-wiring.test.ts
// Sprint E — Dim 26: semantic task routing wired into sidebar per-request (26: 8→9)
import { describe, it, expect } from "vitest";
import {
  ModelRouterImpl,
  classifyTaskComplexity,
  routeByComplexity,
  detectAvailableProviders,
  type TaskSignals,
  type RoutedModel,
} from "@dantecode/core";

// ─── classifyTaskComplexity ───────────────────────────────────────────────────

describe("classifyTaskComplexity", () => {
  it("classifies short FIM as trivial", () => {
    const signals: TaskSignals = { promptTokens: 300, isFim: true };
    expect(classifyTaskComplexity(signals)).toBe("trivial");
  });

  it("classifies medium FIM as simple", () => {
    const signals: TaskSignals = { promptTokens: 1500, isFim: true };
    expect(classifyTaskComplexity(signals)).toBe("simple");
  });

  it("classifies multi-file + tools as complex", () => {
    const signals: TaskSignals = { promptTokens: 500, multiFile: true, requiresTools: true };
    expect(classifyTaskComplexity(signals)).toBe("complex");
  });

  it("classifies reasoning tasks as reasoning", () => {
    const signals: TaskSignals = { promptTokens: 1000, requiresReasoning: true };
    expect(classifyTaskComplexity(signals)).toBe("reasoning");
  });

  it("forceComplexity override wins", () => {
    const signals: TaskSignals = { promptTokens: 9999, forceComplexity: "trivial" };
    expect(classifyTaskComplexity(signals)).toBe("trivial");
  });

  it("classifies large prompts as moderate", () => {
    const signals: TaskSignals = { promptTokens: 9000 };
    expect(classifyTaskComplexity(signals)).toBe("moderate");
  });

  it("default is simple for small prompts without special signals", () => {
    const signals: TaskSignals = { promptTokens: 200 };
    expect(classifyTaskComplexity(signals)).toBe("simple");
  });
});

// ─── routeByComplexity ────────────────────────────────────────────────────────

describe("routeByComplexity", () => {
  it("routes trivial FIM to ollama when available", () => {
    const providers = new Set(["ollama"] as const);
    const result = routeByComplexity({ promptTokens: 300, isFim: true }, providers);
    expect(result.provider).toBe("ollama");
    expect(result.complexity).toBe("trivial");
  });

  it("routes complex task to anthropic Sonnet", () => {
    const providers = new Set(["anthropic"] as const);
    const result = routeByComplexity({ promptTokens: 500, multiFile: true, requiresTools: true }, providers);
    expect(result.provider).toBe("anthropic");
    expect(result.complexity).toBe("complex");
  });

  it("falls back to anthropic when preferred provider unavailable", () => {
    const providers = new Set(["anthropic"] as const);
    const result = routeByComplexity({ promptTokens: 1500, isFim: true }, providers);
    // preferred = mistral codestral for simple, but fallback = groq; last resort = anthropic
    expect(result.provider).toBe("anthropic");
    expect(typeof result.rationale).toBe("string");
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it("RoutedModel has all required fields", () => {
    const providers = new Set(["anthropic", "ollama"] as const);
    const result = routeByComplexity({ promptTokens: 400 }, providers);
    expect(result).toHaveProperty("provider");
    expect(result).toHaveProperty("modelId");
    expect(result).toHaveProperty("complexity");
    expect(result).toHaveProperty("rationale");
  });
});

// ─── ModelRouterImpl.routeForTask ─────────────────────────────────────────────

describe("ModelRouterImpl.routeForTask", () => {
  it("is a static method callable without instantiation", () => {
    expect(typeof ModelRouterImpl.routeForTask).toBe("function");
  });

  it("returns a RoutedModel with required fields", () => {
    const result: RoutedModel = ModelRouterImpl.routeForTask({ promptTokens: 500 });
    expect(result.provider).toBeTruthy();
    expect(result.modelId).toBeTruthy();
    expect(result.complexity).toBeTruthy();
    expect(result.rationale).toBeTruthy();
  });

  it("reasoning mode routed to Opus or equivalent", () => {
    const result = ModelRouterImpl.routeForTask({ promptTokens: 500, requiresReasoning: true });
    expect(result.complexity).toBe("reasoning");
    // modelId should be a real model string
    expect(result.modelId.length).toBeGreaterThan(3);
  });

  it("FIM task routes to efficient model", () => {
    const result = ModelRouterImpl.routeForTask({ promptTokens: 300, isFim: true });
    expect(result.complexity).toBe("trivial");
    // Rationale should mention local/zero-cost nature
    expect(result.rationale.toLowerCase()).toMatch(/local|zero|fast|trivial/);
  });

  it("routing decision includes rationale string", () => {
    const result = ModelRouterImpl.routeForTask({ promptTokens: 1000 });
    expect(typeof result.rationale).toBe("string");
    expect(result.rationale.length).toBeGreaterThan(10);
  });
});

// ─── detectAvailableProviders ─────────────────────────────────────────────────

describe("detectAvailableProviders", () => {
  it("always includes ollama (local, no key needed)", () => {
    const providers = detectAvailableProviders();
    expect(providers.has("ollama")).toBe(true);
  });

  it("returns a Set of ModelProvider strings", () => {
    const providers = detectAvailableProviders();
    expect(providers).toBeInstanceOf(Set);
    expect(providers.size).toBeGreaterThan(0);
  });
});

// ─── routing_decision message shape ──────────────────────────────────────────

describe("routing_decision webview message contract", () => {
  it("payload has expected fields from routeForTask", () => {
    const result = ModelRouterImpl.routeForTask({ promptTokens: 800, multiFile: true, requiresTools: true });
    const payload = {
      complexity: result.complexity,
      provider: result.provider,
      modelId: result.modelId,
      rationale: result.rationale,
      promptTokens: 800,
    };
    expect(payload.complexity).toBeTruthy();
    expect(payload.provider).toBeTruthy();
    expect(payload.modelId).toBeTruthy();
    expect(payload.rationale).toBeTruthy();
    expect(typeof payload.promptTokens).toBe("number");
  });

  it("complexity is one of the 5 valid levels", () => {
    const valid = ["trivial", "simple", "moderate", "complex", "reasoning"];
    const result = ModelRouterImpl.routeForTask({ promptTokens: 500 });
    expect(valid).toContain(result.complexity);
  });
});
