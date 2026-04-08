// ============================================================================
// AutonomyOrchestrator — unit tests
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { AutonomyOrchestrator } from "./autonomy-orchestrator.js";
import type { AutonomyInput } from "./autonomy-orchestrator.js";
import type { FailureAction } from "./task-circuit-breaker.js";
import type { LoopDetectionResult } from "./loop-detector.js";
import { RecoveryEngine } from "./recovery-engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBreaker(action: "continue" | "pause_and_recover" | "escalate"): FailureAction {
  return {
    action,
    state: action === "escalate" ? "escalated" : action === "pause_and_recover" ? "paused" : "active",
    identicalCount: action === "continue" ? 2 : 5,
    recoveryAttempts: action === "escalate" ? 2 : action === "pause_and_recover" ? 1 : 0,
  };
}

function makeLoop(stuck: boolean, reason?: LoopDetectionResult["reason"]): LoopDetectionResult {
  return {
    stuck,
    reason,
    iterationCount: 10,
    consecutiveRepeats: stuck ? 3 : 0,
    details: stuck ? "Stuck pattern detected" : undefined,
  };
}

function makeInput(overrides: Partial<AutonomyInput> = {}): AutonomyInput {
  return {
    projectRoot: "/test/project",
    round: 5,
    touchedFiles: ["src/foo.ts", "src/bar.ts"],
    primaryTargetFile: "src/foo.ts",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// describe: noop (no recovery needed)
// ---------------------------------------------------------------------------

describe("AutonomyOrchestrator — noop path", () => {
  it("returns continue when no breakerAction or loopResult", async () => {
    const orch = new AutonomyOrchestrator();
    const decision = await orch.decide(makeInput());
    expect(decision.type).toBe("continue");
    expect(decision.injectedMessages).toHaveLength(0);
    expect(decision.backoffMs).toBe(0);
  });

  it("returns continue when breakerAction is continue", async () => {
    const orch = new AutonomyOrchestrator();
    const decision = await orch.decide(makeInput({ breakerAction: makeBreaker("continue") }));
    expect(decision.type).toBe("continue");
  });

  it("returns continue when loopResult.stuck is false", async () => {
    const orch = new AutonomyOrchestrator();
    const decision = await orch.decide(makeInput({ loopResult: makeLoop(false) }));
    expect(decision.type).toBe("continue");
  });

  it("strategy starts as standard", async () => {
    const orch = new AutonomyOrchestrator();
    expect(orch.getStrategy()).toBe("standard");
    const decision = await orch.decide(makeInput());
    expect(decision.strategy).toBe("standard");
  });
});

// ---------------------------------------------------------------------------
// describe: recovery path (circuit breaker)
// ---------------------------------------------------------------------------

describe("AutonomyOrchestrator — recovery path", () => {
  it("returns recover action on pause_and_recover", async () => {
    const mockRecoveryEngine = {
      rereadAndRecover: vi.fn().mockResolvedValue({
        recovered: true,
        targetContent: "const x = 1;",
        contextFiles: [],
        targetHash: "abc123",
      }),
    } as unknown as RecoveryEngine;

    const orch = new AutonomyOrchestrator({ recoveryEngine: mockRecoveryEngine });
    const decision = await orch.decide(makeInput({
      breakerAction: makeBreaker("pause_and_recover"),
      errorMessage: "TS2345: Type error",
    }));

    expect(decision.type).toBe("recover");
    expect(decision.injectedMessages.length).toBeGreaterThan(0);
    expect(decision.injectedMessages[0]).toContain("Recovery attempt 1");
    expect(decision.recoveryAttempt).toBe(1);
  });

  it("injects error message into recovery message", async () => {
    const mockRecoveryEngine = {
      rereadAndRecover: vi.fn().mockResolvedValue({ recovered: false, contextFiles: [], error: "File not found" }),
    } as unknown as RecoveryEngine;

    const orch = new AutonomyOrchestrator({ recoveryEngine: mockRecoveryEngine });
    const decision = await orch.decide(makeInput({
      breakerAction: makeBreaker("pause_and_recover"),
      errorMessage: "Cannot read property 'x' of undefined",
    }));

    expect(decision.injectedMessages[0]).toContain("Cannot read property");
  });

  it("includes fresh context when re-read succeeds", async () => {
    const mockRecoveryEngine = {
      rereadAndRecover: vi.fn().mockResolvedValue({
        recovered: true,
        targetContent: "export function foo() {}",
        contextFiles: [{ path: "src/bar.ts", content: "export const bar = 1;" }],
        targetHash: "def456",
      }),
    } as unknown as RecoveryEngine;

    const orch = new AutonomyOrchestrator({ recoveryEngine: mockRecoveryEngine });
    const decision = await orch.decide(makeInput({
      breakerAction: makeBreaker("pause_and_recover"),
    }));

    expect(decision.freshContext?.recovered).toBe(true);
    expect(decision.freshContext?.targetContent).toBe("export function foo() {}");
    expect(mockRecoveryEngine.rereadAndRecover).toHaveBeenCalledWith("src/foo.ts", "/test/project");
  });

  it("applies exponential backoff on successive recoveries", async () => {
    const mockRecoveryEngine = {
      rereadAndRecover: vi.fn().mockResolvedValue({ recovered: false, contextFiles: [] }),
    } as unknown as RecoveryEngine;

    const orch = new AutonomyOrchestrator({ recoveryEngine: mockRecoveryEngine, maxRecoveryAttempts: 4 });

    const d1 = await orch.decide(makeInput({ breakerAction: makeBreaker("pause_and_recover") }));
    const d2 = await orch.decide(makeInput({ breakerAction: makeBreaker("pause_and_recover") }));
    const d3 = await orch.decide(makeInput({ breakerAction: makeBreaker("pause_and_recover") }));

    expect(d1.backoffMs).toBe(250);   // 250ms
    expect(d2.backoffMs).toBe(500);   // 500ms
    expect(d3.backoffMs).toBe(1000);  // 1000ms
  });

  it("increments recoveryAttempts counter per decision", async () => {
    const orch = new AutonomyOrchestrator({
      recoveryEngine: { rereadAndRecover: vi.fn().mockResolvedValue({ recovered: false, contextFiles: [] }) } as unknown as RecoveryEngine,
      maxRecoveryAttempts: 4,
    });

    await orch.decide(makeInput({ breakerAction: makeBreaker("pause_and_recover") }));
    expect(orch.getRecoveryAttempts()).toBe(1);

    await orch.decide(makeInput({ breakerAction: makeBreaker("pause_and_recover") }));
    expect(orch.getRecoveryAttempts()).toBe(2);
  });

  it("does not throw when recovery engine fails", async () => {
    const mockRecoveryEngine = {
      rereadAndRecover: vi.fn().mockRejectedValue(new Error("disk error")),
    } as unknown as RecoveryEngine;

    const orch = new AutonomyOrchestrator({ recoveryEngine: mockRecoveryEngine });
    const decision = await orch.decide(makeInput({ breakerAction: makeBreaker("pause_and_recover") }));

    expect(decision.type).toBe("recover");
    expect(decision.freshContext).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// describe: escalation path
// ---------------------------------------------------------------------------

describe("AutonomyOrchestrator — escalation path", () => {
  it("escalates when breakerAction is escalate", async () => {
    const orch = new AutonomyOrchestrator();
    const decision = await orch.decide(makeInput({ breakerAction: makeBreaker("escalate") }));
    expect(decision.type).toBe("escalate");
    expect(decision.injectedMessages[0]).toContain("Escalating");
  });

  it("escalates after maxRecoveryAttempts exceeded", async () => {
    const mockEngine = {
      rereadAndRecover: vi.fn().mockResolvedValue({ recovered: false, contextFiles: [] }),
    } as unknown as RecoveryEngine;

    const orch = new AutonomyOrchestrator({ recoveryEngine: mockEngine, maxRecoveryAttempts: 2 });

    await orch.decide(makeInput({ breakerAction: makeBreaker("pause_and_recover") })); // attempt 1
    await orch.decide(makeInput({ breakerAction: makeBreaker("pause_and_recover") })); // attempt 2
    const d3 = await orch.decide(makeInput({ breakerAction: makeBreaker("pause_and_recover") })); // → escalate

    expect(d3.type).toBe("escalate");
  });

  it("escalation message includes error message", async () => {
    const orch = new AutonomyOrchestrator({ maxRecoveryAttempts: 0 });
    const decision = await orch.decide(makeInput({
      breakerAction: makeBreaker("pause_and_recover"),
      errorMessage: "Module not found: @dantecode/missing",
    }));
    // maxRecoveryAttempts: 0 means first call already exceeds limit
    expect(decision.type).toBe("escalate");
    expect(decision.injectedMessages[0]).toContain("Module not found");
  });
});

// ---------------------------------------------------------------------------
// describe: scope reduction path (loop detector)
// ---------------------------------------------------------------------------

describe("AutonomyOrchestrator — scope reduction path", () => {
  it("returns scope_reduce when loop stuck", async () => {
    const orch = new AutonomyOrchestrator();
    const decision = await orch.decide(makeInput({
      loopResult: makeLoop(true, "cyclic_pattern"),
    }));
    expect(decision.type).toBe("scope_reduce");
  });

  it("scope reduction instruction targets primary file", async () => {
    const orch = new AutonomyOrchestrator();
    const decision = await orch.decide(makeInput({
      loopResult: makeLoop(true, "identical_consecutive"),
      touchedFiles: ["src/target.ts", "src/other.ts"],
    }));
    expect(decision.injectedMessages[0]).toContain("src/target.ts");
  });

  it("scope constraint limits edit targets", async () => {
    const orch = new AutonomyOrchestrator();
    const decision = await orch.decide(makeInput({
      loopResult: makeLoop(true),
      touchedFiles: ["a.ts", "b.ts", "c.ts"],
    }));
    expect(decision.scopeConstraint?.maxEditTargets).toBeLessThanOrEqual(2);
    expect(decision.scopeConstraint?.focusFiles.length).toBeLessThanOrEqual(2);
  });

  it("second scope reduction escalates to minimal strategy", async () => {
    const mockEngine = {
      rereadAndRecover: vi.fn().mockResolvedValue({ recovered: false, contextFiles: [] }),
    } as unknown as RecoveryEngine;

    const orch = new AutonomyOrchestrator({ recoveryEngine: mockEngine, maxScopeReductions: 2 });

    const d1 = await orch.decide(makeInput({ loopResult: makeLoop(true) }));
    const d2 = await orch.decide(makeInput({ loopResult: makeLoop(true) }));

    expect(d1.strategy).toBe("reduced_scope");
    expect(d2.strategy).toBe("minimal");
  });

  it("scope reduction includes primary error in constraint", async () => {
    const orch = new AutonomyOrchestrator();
    const decision = await orch.decide(makeInput({
      loopResult: makeLoop(true),
      errorMessage: "TS2304: Cannot find name 'Foo'",
    }));
    expect(decision.scopeConstraint?.primaryError).toContain("TS2304");
  });
});

// ---------------------------------------------------------------------------
// describe: decision history
// ---------------------------------------------------------------------------

describe("AutonomyOrchestrator — decision history", () => {
  it("records all decisions in history", async () => {
    const orch = new AutonomyOrchestrator({
      recoveryEngine: { rereadAndRecover: vi.fn().mockResolvedValue({ recovered: false, contextFiles: [] }) } as unknown as RecoveryEngine,
    });

    await orch.decide(makeInput()); // continue
    await orch.decide(makeInput({ loopResult: makeLoop(true) })); // scope_reduce
    await orch.decide(makeInput({ breakerAction: makeBreaker("pause_and_recover") })); // recover

    const history = orch.getDecisionHistory();
    expect(history).toHaveLength(3);
    expect(history[0]?.type).toBe("continue");
    expect(history[1]?.type).toBe("scope_reduce");
    expect(history[2]?.type).toBe("recover");
  });

  it("reset clears all state", async () => {
    const orch = new AutonomyOrchestrator({
      recoveryEngine: { rereadAndRecover: vi.fn().mockResolvedValue({ recovered: false, contextFiles: [] }) } as unknown as RecoveryEngine,
    });

    await orch.decide(makeInput({ breakerAction: makeBreaker("pause_and_recover") }));
    orch.reset();

    expect(orch.getRecoveryAttempts()).toBe(0);
    expect(orch.getStrategy()).toBe("standard");
    expect(orch.getDecisionHistory()).toHaveLength(0);
  });
});
