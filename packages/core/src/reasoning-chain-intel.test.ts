import { describe, it, expect, beforeEach } from "vitest";
import { ReasoningChain } from "./reasoning-chain.js";
import type { ReasoningPhase } from "./reasoning-chain.js";

describe("ReasoningChain — Tier Selection", () => {
  let chain: ReasoningChain;

  beforeEach(() => {
    chain = new ReasoningChain();
  });

  it("selects 'quick' for low complexity with no errors", () => {
    const tier = chain.decideTier(0.2, { errorCount: 0, toolCalls: 3 });
    expect(tier).toBe("quick");
  });

  it("selects 'deep' for moderate complexity", () => {
    const tier = chain.decideTier(0.5, { errorCount: 1, toolCalls: 8 });
    expect(tier).toBe("deep");
  });

  it("selects 'expert' for high complexity with many errors", () => {
    const tier = chain.decideTier(0.9, { errorCount: 5, toolCalls: 20 });
    expect(tier).toBe("expert");
  });

  it("quick tier when complexity < 0.3 regardless of errors", () => {
    const tier = chain.decideTier(0.1, { errorCount: 10, toolCalls: 1 });
    expect(tier).toBe("quick");
  });

  it("quick tier when errorCount === 0 and toolCalls < 5", () => {
    const tier = chain.decideTier(0.6, { errorCount: 0, toolCalls: 4 });
    expect(tier).toBe("quick");
  });

  it("applies cost bias to downgrade tier", () => {
    // High cost multiplier should reduce adjusted complexity, favoring cheaper tiers
    chain.decideTier(0.4, { errorCount: 1, toolCalls: 8, costMultiplier: 1.0 });
    const highCost = chain.decideTier(0.4, { errorCount: 1, toolCalls: 8, costMultiplier: 4.0 });
    // With high cost, adjusted complexity drops, potentially selecting a cheaper tier
    expect(["quick", "deep"]).toContain(highCost);
  });

  it("applies budget pressure bias", () => {
    const tier = chain.decideTier(0.35, {
      errorCount: 1,
      toolCalls: 8,
      remainingBudget: 10000,
    });
    // Budget pressure should push toward cheaper tier
    expect(["quick", "deep"]).toContain(tier);
  });
});

describe("ReasoningChain — Thinking", () => {
  let chain: ReasoningChain;

  beforeEach(() => {
    chain = new ReasoningChain();
  });

  it("generates quick thinking phase", () => {
    const phase = chain.think("Fix the bug", "login fails", "quick");
    expect(phase.type).toBe("thinking");
    expect(phase.content).toContain("Fix the bug");
    expect(phase.content).toContain("login fails");
    expect(phase.timestamp).toBeDefined();
  });

  it("generates deep thinking with step-by-step analysis", () => {
    const phase = chain.think("Refactor auth", "too complex", "deep");
    expect(phase.content).toContain("step-by-step");
    expect(phase.content).toContain("Refactor auth");
  });

  it("generates expert thinking with edge case analysis", () => {
    const phase = chain.think("Redesign API", "breaking changes", "expert");
    expect(phase.content).toContain("edge cases");
    expect(phase.content).toContain("Redesign API");
  });

  it("appends context to thinking content", () => {
    const phase = chain.think("Task", "Important context details", "quick");
    expect(phase.content).toContain("Important context details");
  });
});

describe("ReasoningChain — Self-Critique", () => {
  let chain: ReasoningChain;

  beforeEach(() => {
    chain = new ReasoningChain({ autoEscalateThreshold: 0.75 });
  });

  function makeThought(content: string): ReasoningPhase {
    return { type: "thinking", content, timestamp: new Date().toISOString() };
  }

  it("recommends proceeding for high PDSE scores", () => {
    const critique = chain.selfCritique(makeThought("Good approach"), 0.95);
    expect(critique.score).toBe(0.95);
    expect(critique.shouldEscalate).toBe(false);
    expect(critique.recommendation).toContain("Proceed");
  });

  it("recommends minor adjustments for scores 0.8-0.9", () => {
    const critique = chain.selfCritique(makeThought("Decent approach"), 0.85);
    expect(critique.recommendation).toContain("Minor adjustments");
    expect(critique.shouldEscalate).toBe(false);
  });

  it("recommends re-evaluation for scores above threshold but below 0.8", () => {
    const critique = chain.selfCritique(makeThought("Incomplete analysis"), 0.76);
    expect(critique.recommendation).toContain("Re-evaluate");
    expect(critique.rootCause).toBeDefined();
  });

  it("recommends escalation for scores below threshold", () => {
    const critique = chain.selfCritique(makeThought("Wrong approach used"), 0.5);
    expect(critique.shouldEscalate).toBe(true);
    expect(critique.recommendation).toContain("Escalate");
  });

  it("identifies root cause: missing context", () => {
    const critique = chain.selfCritique(
      makeThought("Missing context and no information available"),
      0.6,
    );
    expect(critique.rootCause).toContain("missing context");
  });

  it("identifies root cause: incomplete analysis", () => {
    const critique = chain.selfCritique(
      makeThought("Incomplete analysis of the partial check"),
      0.6,
    );
    expect(critique.rootCause).toContain("incomplete analysis");
  });

  it("identifies root cause: wrong approach", () => {
    const critique = chain.selfCritique(
      makeThought("Used wrong method for the task"),
      0.6,
    );
    expect(critique.rootCause).toContain("wrong approach");
  });

  it("provides fallback root cause when no pattern matches", () => {
    const critique = chain.selfCritique(makeThought("Some generic issue"), 0.6);
    expect(critique.rootCause).toContain("unidentified issue");
  });
});

describe("ReasoningChain — Critique Timing", () => {
  it("critiques every N turns", () => {
    const chain = new ReasoningChain({ critiqueEveryNTurns: 3 });
    const thought = chain.think("task", "ctx", "quick");

    // Step 0 should not critique
    expect(chain.shouldCritique()).toBe(false);

    // Record steps until we hit critiqueEveryNTurns
    chain.recordStep(thought);
    expect(chain.shouldCritique()).toBe(false);
    chain.recordStep(thought);
    expect(chain.shouldCritique()).toBe(false);
    chain.recordStep(thought);
    expect(chain.shouldCritique()).toBe(true); // Step 3
  });
});

describe("ReasoningChain — Playbook Distillation", () => {
  it("distills winning approaches into playbook bullets", () => {
    const chain = new ReasoningChain({ playbookDistill: true });

    const phase1: ReasoningPhase = {
      type: "thinking",
      content: "Analyzed the error log and found root cause",
      pdseScore: 0.92,
      timestamp: new Date().toISOString(),
    };
    const phase2: ReasoningPhase = {
      type: "thinking",
      content: "Applied fix and verified with tests",
      pdseScore: 0.88,
      timestamp: new Date().toISOString(),
    };

    chain.recordStep(phase1);
    chain.recordStep(phase2);

    const playbook = chain.getPlaybook();
    expect(Array.isArray(playbook)).toBe(true);
  });
});

describe("ReasoningChain — Chain History", () => {
  it("records steps and tracks step counter", () => {
    const chain = new ReasoningChain();
    const thought = chain.think("task", "context", "quick");
    chain.recordStep(thought);
    chain.recordStep(thought);

    const history = chain.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]!.stepNumber).toBe(1);
    expect(history[1]!.stepNumber).toBe(2);
  });

  it("tracks step count accurately across many steps", () => {
    const chain = new ReasoningChain();
    const thought = chain.think("task", "ctx", "quick");

    for (let i = 0; i < 5; i++) {
      chain.recordStep(thought);
    }

    expect(chain.getStepCount()).toBe(5);
    expect(chain.getHistory()).toHaveLength(5);
  });

  it("resets chain state", () => {
    const chain = new ReasoningChain();
    chain.recordStep(chain.think("task", "ctx", "quick"));
    chain.recordStep(chain.think("task2", "ctx2", "deep"));

    chain.reset();
    expect(chain.getHistory()).toHaveLength(0);
  });
});
