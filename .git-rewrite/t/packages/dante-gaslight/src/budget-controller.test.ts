import { describe, it, expect, beforeEach } from "vitest";
import { BudgetController } from "./budget-controller.js";
import { DEFAULT_GASLIGHT_CONFIG } from "./types.js";
import type { GaslightConfig } from "./types.js";

const cfg: GaslightConfig = {
  ...DEFAULT_GASLIGHT_CONFIG,
  enabled: true,
  maxIterations: 3,
  maxTokens: 500,
  maxSeconds: 10,
};

describe("BudgetController", () => {
  let bc: BudgetController;

  beforeEach(() => {
    bc = new BudgetController(cfg);
  });

  it("starts fresh", () => {
    const snap = bc.snapshot();
    expect(snap.tokensUsed).toBe(0);
    expect(snap.iterations).toBe(0);
    expect(snap.userStopped).toBe(false);
  });

  it("tracks token usage", () => {
    bc.addTokens(100);
    bc.addTokens(200);
    expect(bc.snapshot().tokensUsed).toBe(300);
    expect(bc.remainingTokens()).toBe(200);
  });

  it("ignores negative tokens", () => {
    bc.addTokens(-50);
    expect(bc.snapshot().tokensUsed).toBe(0);
  });

  it("tracks iterations", () => {
    bc.incrementIteration();
    bc.incrementIteration();
    expect(bc.snapshot().iterations).toBe(2);
    expect(bc.remainingIterations()).toBe(1);
  });

  it("isExhausted on token cap", () => {
    bc.addTokens(500);
    expect(bc.isExhausted()).toBe(true);
  });

  it("isExhausted on iteration cap", () => {
    bc.incrementIteration();
    bc.incrementIteration();
    bc.incrementIteration();
    expect(bc.isExhausted()).toBe(true);
  });

  it("isExhausted on user stop", () => {
    bc.stop();
    expect(bc.isExhausted()).toBe(true);
    expect(bc.snapshot().userStopped).toBe(true);
  });

  it("not exhausted when within limits", () => {
    bc.addTokens(100);
    bc.incrementIteration();
    expect(bc.isExhausted()).toBe(false);
  });

  it("summary returns readable string", () => {
    bc.addTokens(50);
    bc.incrementIteration();
    const s = bc.summary();
    expect(s).toContain("tokens=50/500");
    expect(s).toContain("iterations=1/3");
  });
});
