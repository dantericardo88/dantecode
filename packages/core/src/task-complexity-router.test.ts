// ============================================================================
// @dantecode/core — Task Complexity Router Tests
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { TaskComplexityRouter, type ComplexitySignals } from "./task-complexity-router.js";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

const SIMPLE_SIGNALS: ComplexitySignals = {
  promptTokens: 500,
  fileCount: 1,
  hasReasoning: false,
  hasSecurity: false,
  hasMultiFile: false,
  estimatedOutputTokens: 250,
};

const STANDARD_SIGNALS: ComplexitySignals = {
  promptTokens: 3000,
  fileCount: 2,
  hasReasoning: false,
  hasSecurity: false,
  hasMultiFile: true,
  estimatedOutputTokens: 1500,
};

const COMPLEX_BY_TOKENS: ComplexitySignals = {
  promptTokens: 10000,
  fileCount: 2,
  hasReasoning: false,
  hasSecurity: false,
  hasMultiFile: true,
  estimatedOutputTokens: 5000,
};

const COMPLEX_BY_FILES: ComplexitySignals = {
  promptTokens: 1000,
  fileCount: 7,
  hasReasoning: false,
  hasSecurity: false,
  hasMultiFile: true,
  estimatedOutputTokens: 500,
};

const COMPLEX_BY_SECURITY_REASONING: ComplexitySignals = {
  promptTokens: 1000,
  fileCount: 1,
  hasReasoning: true,
  hasSecurity: true,
  hasMultiFile: false,
  estimatedOutputTokens: 500,
};

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("TaskComplexityRouter", () => {
  let router: TaskComplexityRouter;

  beforeEach(() => {
    router = new TaskComplexityRouter();
  });

  // ── 1. Simple classification ─────────────────────────────────────────────

  it("classify() returns 'simple' for small single-file prompts", () => {
    const decision = router.classify(SIMPLE_SIGNALS);
    expect(decision.complexity).toBe("simple");
    expect(decision.recommendedModel).toBe("claude-haiku-4-5-20251001");
    expect(decision.confidence).toBeGreaterThan(0);
    expect(decision.evidenceLogged).toBe(false);
  });

  // ── 2. Complex classification by multi-file ──────────────────────────────

  it("classify() returns 'complex' for large multi-file prompts", () => {
    const decision = router.classify(COMPLEX_BY_FILES);
    expect(decision.complexity).toBe("complex");
    expect(decision.recommendedModel).toBe("claude-opus-4-6");
  });

  // ── 3. Complex classification by token count ─────────────────────────────

  it("classify() returns 'complex' when promptTokens > 8000", () => {
    const decision = router.classify(COMPLEX_BY_TOKENS);
    expect(decision.complexity).toBe("complex");
    expect(decision.recommendedModel).toBe("claude-opus-4-6");
  });

  // ── 4. Complex when hasSecurity AND hasReasoning ─────────────────────────

  it("classify() returns 'complex' when hasSecurity AND hasReasoning", () => {
    const decision = router.classify(COMPLEX_BY_SECURITY_REASONING);
    expect(decision.complexity).toBe("complex");
    expect(decision.rationale).toContain("hasSecurity + hasReasoning");
  });

  // ── 5. Standard classification ───────────────────────────────────────────

  it("classify() returns 'standard' for mid-range signals", () => {
    const decision = router.classify(STANDARD_SIGNALS);
    expect(decision.complexity).toBe("standard");
    expect(decision.recommendedModel).toBe("claude-sonnet-4-6");
  });

  // ── 6. Override parameter ────────────────────────────────────────────────

  it("classify() respects explicit override parameter", () => {
    // Would normally be simple, but user forced complex
    const decision = router.classify(SIMPLE_SIGNALS, "complex");
    expect(decision.complexity).toBe("complex");
    expect(decision.override).toBe("complex");
    expect(decision.recommendedModel).toBe("claude-opus-4-6");
    expect(decision.confidence).toBe(1.0);
  });

  it("classify() override works for simple downgrade from complex signals", () => {
    const decision = router.classify(COMPLEX_BY_TOKENS, "simple");
    expect(decision.complexity).toBe("simple");
    expect(decision.override).toBe("simple");
  });

  // ── 7. getModel() returns correct model IDs ──────────────────────────────

  it("getModel() returns correct model IDs for each tier", () => {
    expect(router.getModel("simple")).toBe("claude-haiku-4-5-20251001");
    expect(router.getModel("standard")).toBe("claude-sonnet-4-6");
    expect(router.getModel("complex")).toBe("claude-opus-4-6");
  });

  // ── Custom config ────────────────────────────────────────────────────────

  it("uses custom model IDs from config", () => {
    const custom = new TaskComplexityRouter({
      simpleModel: "custom-haiku",
      standardModel: "custom-sonnet",
      complexModel: "custom-opus",
    });
    expect(custom.getModel("simple")).toBe("custom-haiku");
    expect(custom.getModel("standard")).toBe("custom-sonnet");
    expect(custom.getModel("complex")).toBe("custom-opus");
  });

  it("uses custom thresholds from config", () => {
    const custom = new TaskComplexityRouter({
      thresholds: {
        simpleMaxTokens: 100, // very low threshold
        complexMinTokens: 500, // lower complex threshold
        complexMinFiles: 3,
      },
    });

    // 200 tokens would be standard with default but complex here
    const highTokens: ComplexitySignals = {
      ...SIMPLE_SIGNALS,
      promptTokens: 600,
    };
    expect(custom.classify(highTokens).complexity).toBe("complex");

    // 50 tokens would be simple
    const tiny: ComplexitySignals = {
      ...SIMPLE_SIGNALS,
      promptTokens: 50,
    };
    expect(custom.classify(tiny).complexity).toBe("simple");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// extractSignals()
// ────────────────────────────────────────────────────────────────────────────

describe("TaskComplexityRouter.extractSignals()", () => {
  let router: TaskComplexityRouter;

  beforeEach(() => {
    router = new TaskComplexityRouter();
  });

  // ── 8. File count from context.files ────────────────────────────────────

  it("extractSignals() counts files correctly from context.files", () => {
    const signals = router.extractSignals("do some work", {
      files: ["src/a.ts", "src/b.ts", "src/c.ts"],
    });
    expect(signals.fileCount).toBe(3);
    expect(signals.hasMultiFile).toBe(true);
  });

  it("extractSignals() sets hasMultiFile false for single file", () => {
    const signals = router.extractSignals("edit the file", {
      files: ["src/a.ts"],
    });
    expect(signals.fileCount).toBe(1);
    expect(signals.hasMultiFile).toBe(false);
  });

  // ── 9. Security keyword detection ───────────────────────────────────────

  it("extractSignals() detects security keywords: secret", () => {
    const signals = router.extractSignals("update the secret key rotation logic");
    expect(signals.hasSecurity).toBe(true);
  });

  it("extractSignals() detects security keywords: auth", () => {
    const signals = router.extractSignals("refactor the auth middleware");
    expect(signals.hasSecurity).toBe(true);
  });

  it("extractSignals() detects security keywords: password", () => {
    const signals = router.extractSignals("add password validation to the form");
    expect(signals.hasSecurity).toBe(true);
  });

  it("extractSignals() detects security keywords: token", () => {
    const signals = router.extractSignals("validate the JWT token on each request");
    expect(signals.hasSecurity).toBe(true);
  });

  it("extractSignals() detects security keywords: credential", () => {
    const signals = router.extractSignals("store AWS credentials securely");
    expect(signals.hasSecurity).toBe(true);
  });

  it("extractSignals() does NOT flag security on a plain prompt", () => {
    const signals = router.extractSignals("add a button to the home page");
    expect(signals.hasSecurity).toBe(false);
  });

  // ── 10. Reasoning keyword detection ─────────────────────────────────────

  it("extractSignals() detects reasoning keywords: analyze", () => {
    const signals = router.extractSignals("analyze the performance bottleneck in the API");
    expect(signals.hasReasoning).toBe(true);
  });

  it("extractSignals() detects reasoning keywords: compare", () => {
    const signals = router.extractSignals("compare the two approaches and recommend one");
    expect(signals.hasReasoning).toBe(true);
  });

  it("extractSignals() detects reasoning keywords: evaluate", () => {
    const signals = router.extractSignals("evaluate the tradeoffs of each solution");
    expect(signals.hasReasoning).toBe(true);
  });

  it("extractSignals() detects reasoning keywords: design", () => {
    const signals = router.extractSignals("design a new database schema for events");
    expect(signals.hasReasoning).toBe(true);
  });

  it("extractSignals() detects reasoning keywords: architect", () => {
    const signals = router.extractSignals("help me architect the microservices layer");
    expect(signals.hasReasoning).toBe(true);
  });

  it("extractSignals() does NOT flag reasoning on a plain prompt", () => {
    const signals = router.extractSignals("fix the typo in the README");
    expect(signals.hasReasoning).toBe(false);
  });

  // ── Token estimation ─────────────────────────────────────────────────────

  it("extractSignals() estimates promptTokens from character length", () => {
    const prompt = "a".repeat(400); // 400 chars → 100 tokens
    const signals = router.extractSignals(prompt);
    expect(signals.promptTokens).toBe(100);
  });

  // ── context.hasSecurity override ────────────────────────────────────────

  it("extractSignals() respects explicit context.hasSecurity=true", () => {
    const signals = router.extractSignals("fix the button color", { hasSecurity: true });
    expect(signals.hasSecurity).toBe(true);
  });
});
