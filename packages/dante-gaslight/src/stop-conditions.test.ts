import { describe, it, expect } from "vitest";
import { evaluateStopConditions, isLessonEligible } from "./stop-conditions.js";
import { DEFAULT_GASLIGHT_CONFIG } from "./types.js";
import type { GaslightSession, GaslightConfig } from "./types.js";

const makeSession = (overrides?: Partial<GaslightSession>): GaslightSession => ({
  sessionId: "sess-1",
  trigger: { channel: "explicit-user", at: new Date().toISOString() },
  iterations: [],
  lessonEligible: false,
  startedAt: new Date().toISOString(),
  ...overrides,
});

const cfg: GaslightConfig = {
  ...DEFAULT_GASLIGHT_CONFIG,
  enabled: true,
  maxIterations: 3,
  maxTokens: 1000,
  maxSeconds: 60,
  confidenceThreshold: 0.9,
};

describe("evaluateStopConditions", () => {
  it("returns user-stop immediately", () => {
    const reason = evaluateStopConditions(
      makeSession(),
      { tokensUsed: 0, elapsedMs: 0, iterations: 0, userStopped: true },
      cfg,
    );
    expect(reason).toBe("user-stop");
  });

  it("returns pass when last gate passed", () => {
    const session = makeSession({
      iterations: [
        { iteration: 1, draft: "x", gateDecision: "pass", at: new Date().toISOString() },
      ],
    });
    const reason = evaluateStopConditions(
      session,
      { tokensUsed: 0, elapsedMs: 0, iterations: 1, userStopped: false },
      cfg,
    );
    expect(reason).toBe("pass");
  });

  it("returns confidence when score >= threshold", () => {
    const session = makeSession({
      iterations: [
        {
          iteration: 1,
          draft: "x",
          gateDecision: "fail",
          gateScore: 0.95,
          at: new Date().toISOString(),
        },
      ],
    });
    const reason = evaluateStopConditions(
      session,
      { tokensUsed: 0, elapsedMs: 0, iterations: 1, userStopped: false },
      cfg,
    );
    expect(reason).toBe("confidence");
  });

  it("returns budget-tokens when exhausted", () => {
    const session = makeSession();
    const reason = evaluateStopConditions(
      session,
      { tokensUsed: 1001, elapsedMs: 0, iterations: 0, userStopped: false },
      cfg,
    );
    expect(reason).toBe("budget-tokens");
  });

  it("returns budget-time when elapsed exceeds limit", () => {
    const session = makeSession();
    const reason = evaluateStopConditions(
      session,
      { tokensUsed: 0, elapsedMs: 61_000, iterations: 0, userStopped: false },
      cfg,
    );
    expect(reason).toBe("budget-time");
  });

  it("returns budget-iterations when max hit", () => {
    const session = makeSession();
    const reason = evaluateStopConditions(
      session,
      { tokensUsed: 0, elapsedMs: 0, iterations: 3, userStopped: false },
      cfg,
    );
    expect(reason).toBe("budget-iterations");
  });

  it("returns null when no condition met", () => {
    const session = makeSession();
    const reason = evaluateStopConditions(
      session,
      { tokensUsed: 100, elapsedMs: 1000, iterations: 1, userStopped: false },
      cfg,
    );
    expect(reason).toBeNull();
  });
});

describe("isLessonEligible", () => {
  it("true when final gate is pass and has iterations", () => {
    const session = makeSession({
      finalGateDecision: "pass",
      iterations: [{ iteration: 1, draft: "x", at: new Date().toISOString() }],
    });
    expect(isLessonEligible(session)).toBe(true);
  });

  it("false when final gate is fail", () => {
    const session = makeSession({
      finalGateDecision: "fail",
      iterations: [{ iteration: 1, draft: "x", at: new Date().toISOString() }],
    });
    expect(isLessonEligible(session)).toBe(false);
  });

  it("false when no iterations", () => {
    const session = makeSession({ finalGateDecision: "pass", iterations: [] });
    expect(isLessonEligible(session)).toBe(false);
  });
});
