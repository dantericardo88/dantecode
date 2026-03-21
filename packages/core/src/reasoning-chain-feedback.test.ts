// ============================================================================
// reasoning-chain-feedback.test.ts
// Tests for: cost-aware decideTier, feedback loop tracking, getCostMultiplier
// ============================================================================

import { describe, it, expect } from "vitest";
import { ReasoningChain, getCostMultiplier } from "./reasoning-chain.js";
import type { ReasoningTier } from "./reasoning-chain.js";

function makeChain() {
  return new ReasoningChain({ critiqueEveryNTurns: 5, autoEscalateThreshold: 0.75 });
}

function record(chain: ReasoningChain, tier: ReasoningTier, pdse: number, n: number) {
  for (let i = 0; i < n; i++) {
    chain.recordTierOutcome(tier, pdse);
  }
}

// ---------------------------------------------------------------------------
// getCostMultiplier
// ---------------------------------------------------------------------------

describe("getCostMultiplier", () => {
  it("returns 5.0 for opus models", () => {
    expect(getCostMultiplier({ provider: "anthropic", modelId: "claude-opus-4-5" })).toBe(5.0);
  });

  it("returns 5.0 for o1-pro", () => {
    expect(getCostMultiplier({ provider: "openai", modelId: "o1-pro-2024" })).toBe(5.0);
  });

  it("returns 2.0 for sonnet models", () => {
    expect(getCostMultiplier({ provider: "anthropic", modelId: "claude-sonnet-4-6" })).toBe(2.0);
  });

  it("returns 2.0 for gpt-4 class", () => {
    expect(getCostMultiplier({ provider: "openai", modelId: "gpt-4o" })).toBe(2.0);
  });

  it("returns 2.0 for grok-3", () => {
    expect(getCostMultiplier({ provider: "xai", modelId: "grok-3" })).toBe(2.0);
  });

  it("returns 0.5 for haiku", () => {
    expect(getCostMultiplier({ provider: "anthropic", modelId: "claude-haiku-4-5" })).toBe(0.5);
  });

  it("returns 0.5 for mini (non-gpt4 model)", () => {
    // A model with "mini" but not "gpt-4" hits the mini tier → 0.5
    expect(getCostMultiplier({ provider: "openai", modelId: "o1-mini" })).toBe(0.5);
  });

  it("returns 0.5 for flash models", () => {
    expect(getCostMultiplier({ provider: "google", modelId: "gemini-flash-2.0" })).toBe(0.5);
  });

  it("returns 1.0 for unknown models", () => {
    expect(getCostMultiplier({ provider: "unknown", modelId: "custom-model-x" })).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// recordTierOutcome + getTierPerformance
// ---------------------------------------------------------------------------

describe("recordTierOutcome / getTierPerformance", () => {
  it("returns undefined for a tier with fewer than 3 samples", () => {
    const chain = makeChain();
    chain.recordTierOutcome("quick", 0.9);
    chain.recordTierOutcome("quick", 0.9);
    expect(chain.getTierPerformance().quick).toBeUndefined();
  });

  it("computes average correctly after 5 quick samples at 0.9", () => {
    const chain = makeChain();
    record(chain, "quick", 0.9, 5);
    expect(chain.getTierPerformance().quick).toBeCloseTo(0.9, 5);
  });

  it("computes average with mixed scores", () => {
    const chain = makeChain();
    record(chain, "deep", 0.8, 2);
    chain.recordTierOutcome("deep", 0.5);
    expect(chain.getTierPerformance().deep).toBeCloseTo(0.7, 5);
  });

  it("tracks expert tier independently", () => {
    const chain = makeChain();
    record(chain, "expert", 0.95, 3);
    const perf = chain.getTierPerformance();
    expect(perf.expert).toBeCloseTo(0.95, 5);
    expect(perf.quick).toBeUndefined();
    expect(perf.deep).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getAdaptiveBias
// ---------------------------------------------------------------------------

describe("getAdaptiveBias", () => {
  it("returns 0 with insufficient data", () => {
    const chain = makeChain();
    expect(chain.getAdaptiveBias()).toBe(0);
  });

  it("returns 0 when quick scores <= 0.85", () => {
    const chain = makeChain();
    record(chain, "quick", 0.8, 5);
    record(chain, "deep", 0.75, 5);
    expect(chain.getAdaptiveBias()).toBe(0);
  });

  it("returns -0.1 when quick tier performs above 0.85", () => {
    const chain = makeChain();
    record(chain, "quick", 0.9, 5);
    record(chain, "deep", 0.85, 5);
    expect(chain.getAdaptiveBias()).toBe(-0.1);
  });

  it("returns -0.05 when expert does not meaningfully beat deep", () => {
    const chain = makeChain();
    record(chain, "quick", 0.75, 5);
    record(chain, "deep", 0.82, 5);
    record(chain, "expert", 0.83, 5); // only 0.01 improvement
    expect(chain.getAdaptiveBias()).toBe(-0.05);
  });

  it("returns 0 when expert meaningfully beats deep", () => {
    const chain = makeChain();
    record(chain, "quick", 0.75, 5);
    record(chain, "deep", 0.80, 5);
    record(chain, "expert", 0.90, 5); // 0.10 improvement > 0.05 threshold
    expect(chain.getAdaptiveBias()).toBe(0);
  });

  it("returns 0 when only quick has data — deep required for non-zero bias (PRD §3.5)", () => {
    const chain = makeChain();
    record(chain, "quick", 0.95, 5); // well above 0.85 threshold
    // No deep data — PRD requires both quick AND deep before adjusting
    expect(chain.getAdaptiveBias()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cost-aware decideTier
// ---------------------------------------------------------------------------

describe("decideTier — cost awareness", () => {
  it("stays quick on high-cost model with few tool calls", () => {
    const chain = makeChain();
    const tier = chain.decideTier(0.5, { errorCount: 0, toolCalls: 3, costMultiplier: 5.0 });
    expect(tier).toBe("quick");
  });

  it("biases away from expert on opus model with moderate complexity", () => {
    const chain = makeChain();
    // complexity=0.72, errorCount=3, toolCalls=10 → expert normally
    // with costBias=0.15: adjustedComplexity=0.57 → deep
    const tier = chain.decideTier(0.72, { errorCount: 3, toolCalls: 10, costMultiplier: 5.0 });
    expect(tier).toBe("deep");
  });

  it("respects budget pressure to prefer lower tier", () => {
    const chain = makeChain();
    const tier = chain.decideTier(0.72, {
      errorCount: 3,
      toolCalls: 10,
      remainingBudget: 30000,
    });
    expect(tier).toBe("deep");
  });

  it("combined: high cost + budget pressure + moderate complexity → deep", () => {
    const chain = makeChain();
    // complexity=0.8, costBias=0.15, budgetBias=0.1 → adjusted=0.55 → deep
    const tier = chain.decideTier(0.8, {
      errorCount: 3,
      toolCalls: 10,
      costMultiplier: 5.0,
      remainingBudget: 20000,
    });
    expect(tier).toBe("deep");
  });

  it("backward compatible: no extra context → same behavior as before", () => {
    const chain = makeChain();
    expect(chain.decideTier(0.5, { errorCount: 0, toolCalls: 3 })).toBe("quick");
    expect(chain.decideTier(0.5, { errorCount: 1, toolCalls: 6 })).toBe("deep");
    expect(chain.decideTier(0.9, { errorCount: 5, toolCalls: 10 })).toBe("expert");
  });

  it("neutral costMultiplier=1.0 does not change behavior", () => {
    const chain = makeChain();
    const tier = chain.decideTier(0.9, { errorCount: 5, toolCalls: 10, costMultiplier: 1.0 });
    expect(tier).toBe("expert");
  });
});

// ---------------------------------------------------------------------------
// getPlaybook
// ---------------------------------------------------------------------------

describe("getPlaybook", () => {
  it("returns empty array with no history steps", () => {
    const chain = makeChain();
    expect(chain.getPlaybook()).toEqual([]);
  });

  it("returns empty array when all steps have pdseScore below 0.85 threshold", () => {
    const chain = makeChain();
    const phase = chain.think("Attempt that underperformed", "ctx", "quick");
    phase.pdseScore = 0.7; // below distillPlaybook's 0.85 threshold
    chain.recordStep(phase);
    expect(chain.getPlaybook()).toEqual([]);
  });

  it("returns bullet for step with pdseScore >= 0.85", () => {
    const chain = makeChain();
    const phase = chain.think("This auth debugging approach worked well", "ctx", "deep");
    phase.pdseScore = 0.9; // above threshold
    chain.recordStep(phase);
    const playbook = chain.getPlaybook();
    expect(playbook.length).toBeGreaterThanOrEqual(1);
    expect(playbook[0]).toContain("auth debugging");
  });
});

// ---------------------------------------------------------------------------
// getAdaptiveBias boundary: expert === deep exactly
// ---------------------------------------------------------------------------

describe("getAdaptiveBias — boundary", () => {
  it("returns -0.05 when expert exactly equals deep (0.00 difference is still < 0.05)", () => {
    const chain = makeChain();
    record(chain, "quick", 0.75, 5);
    record(chain, "deep", 0.82, 5);
    record(chain, "expert", 0.82, 5); // exactly equal → 0.00 < 0.05 → should return -0.05
    expect(chain.getAdaptiveBias()).toBe(-0.05);
  });
});

// ---------------------------------------------------------------------------
// selfCritique — escalation threshold
// ---------------------------------------------------------------------------

describe("selfCritique — shouldEscalate", () => {
  it("shouldEscalate is true when pdseScore < autoEscalateThreshold (0.75 default)", () => {
    const chain = makeChain(); // autoEscalateThreshold=0.75
    const phase = chain.think("test approach", "ctx", "quick");
    const result = chain.selfCritique(phase, 0.6); // 0.6 < 0.75
    expect(result.shouldEscalate).toBe(true);
    expect(result.score).toBe(0.6);
  });

  it("shouldEscalate is false when pdseScore === autoEscalateThreshold (boundary)", () => {
    const chain = makeChain();
    const phase = chain.think("test approach", "ctx", "quick");
    const result = chain.selfCritique(phase, 0.75); // 0.75 is NOT < 0.75
    expect(result.shouldEscalate).toBe(false);
  });

  it("shouldEscalate is false when pdseScore > autoEscalateThreshold", () => {
    const chain = makeChain();
    const phase = chain.think("test approach", "ctx", "quick");
    const result = chain.selfCritique(phase, 0.8); // 0.8 >= 0.75
    expect(result.shouldEscalate).toBe(false);
  });
});
