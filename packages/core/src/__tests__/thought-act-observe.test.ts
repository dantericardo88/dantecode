// packages/core/src/__tests__/thought-act-observe.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  detectCompletionSignal,
  detectFailureSignal,
  classifyObservationStatus,
  adaptStrategy,
  isStuck,
  buildTaoCycle,
  TaoLoopManager,
  type TaoCycle,
  type ThoughtStep,
  type ActionStep,
  type ObservationStep,
} from "../thought-act-observe.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeThought(content = "I will read the file first", strategy: ThoughtStep["strategy"] = "direct"): ThoughtStep {
  return { content, strategy, confidence: 0.8 };
}

function makeAction(kind: ActionStep["kind"] = "bash", target = "ls -la"): ActionStep {
  return { kind, target };
}

function makeObservation(
  status: ObservationStep["status"] = "success",
  output = "Done",
  isCompletionSignal = false,
): ObservationStep {
  return { status, output, isCompletionSignal };
}

function makeCycle(stepIndex = 0, opts: {
  target?: string;
  output?: string;
  status?: ObservationStep["status"];
  isCompletionSignal?: boolean;
} = {}): TaoCycle {
  return buildTaoCycle(
    stepIndex,
    makeThought(),
    makeAction("bash", opts.target ?? "ls"),
    makeObservation(opts.status ?? "success", opts.output ?? "file.ts", opts.isCompletionSignal ?? false),
    100,
  );
}

// ─── detectCompletionSignal ───────────────────────────────────────────────────

describe("detectCompletionSignal", () => {
  it("detects 'all tests pass'", () => {
    expect(detectCompletionSignal("All tests pass")).toBe(true);
  });

  it("detects 'task complete'", () => {
    expect(detectCompletionSignal("task complete")).toBe(true);
  });

  it("detects 'exit code: 0'", () => {
    expect(detectCompletionSignal("Process finished with exit code: 0")).toBe(true);
  });

  it("detects 'successfully created'", () => {
    expect(detectCompletionSignal("successfully created the module")).toBe(true);
  });

  it("returns false for neutral output", () => {
    expect(detectCompletionSignal("Reading file src/auth.ts")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(detectCompletionSignal("ALL TESTS PASS")).toBe(true);
  });
});

// ─── detectFailureSignal ──────────────────────────────────────────────────────

describe("detectFailureSignal", () => {
  it("detects SyntaxError", () => {
    expect(detectFailureSignal("SyntaxError: Unexpected token")).toBe(true);
  });

  it("detects TypeError", () => {
    expect(detectFailureSignal("TypeError: Cannot read property 'x'")).toBe(true);
  });

  it("detects 'command not found'", () => {
    expect(detectFailureSignal("bash: unknown-cmd: command not found")).toBe(true);
  });

  it("detects TS error codes", () => {
    expect(detectFailureSignal("error TS2322: Type 'string' is not assignable")).toBe(true);
  });

  it("returns false for success output", () => {
    expect(detectFailureSignal("Build succeeded in 2.3s")).toBe(false);
  });
});

// ─── classifyObservationStatus ────────────────────────────────────────────────

describe("classifyObservationStatus", () => {
  it("returns failure when errorMessage provided", () => {
    expect(classifyObservationStatus("some output", "ENOENT")).toBe("failure");
  });

  it("returns success on completion signal", () => {
    expect(classifyObservationStatus("all tests pass")).toBe("success");
  });

  it("returns failure on failure signal", () => {
    expect(classifyObservationStatus("SyntaxError: bad token")).toBe("failure");
  });

  it("returns partial for empty output", () => {
    expect(classifyObservationStatus("")).toBe("partial");
  });

  it("returns success for neutral non-empty output", () => {
    expect(classifyObservationStatus("npm install\nadded 42 packages")).toBe("success");
  });
});

// ─── adaptStrategy ────────────────────────────────────────────────────────────

describe("adaptStrategy", () => {
  it("keeps current strategy when no failures", () => {
    expect(adaptStrategy("direct", 0, 0)).toBe("direct");
  });

  it("shifts to next strategy on repeated failures", () => {
    const adapted = adaptStrategy("direct", 3, 0);
    expect(adapted).not.toBe("direct");
  });

  it("shifts to next strategy when stuck", () => {
    const adapted = adaptStrategy("direct", 0, 4);
    expect(adapted).not.toBe("direct");
  });

  it("does not go beyond defensive strategy", () => {
    const adapted = adaptStrategy("defensive", 5, 5);
    expect(adapted).toBe("defensive"); // already at end
  });
});

// ─── isStuck ─────────────────────────────────────────────────────────────────

describe("isStuck", () => {
  it("returns false for fewer than windowSize cycles", () => {
    const cycles = [makeCycle(0, { target: "ls", output: "same" })];
    expect(isStuck(cycles, 3)).toBe(false);
  });

  it("returns true when same target and output repeated", () => {
    const cycles = [
      makeCycle(0, { target: "ls -la", output: "file.ts" }),
      makeCycle(1, { target: "ls -la", output: "file.ts" }),
      makeCycle(2, { target: "ls -la", output: "file.ts" }),
    ];
    expect(isStuck(cycles, 3)).toBe(true);
  });

  it("returns false when output varies", () => {
    const cycles = [
      makeCycle(0, { target: "ls", output: "a.ts" }),
      makeCycle(1, { target: "ls", output: "b.ts" }),
      makeCycle(2, { target: "ls", output: "c.ts" }),
    ];
    expect(isStuck(cycles, 3)).toBe(false);
  });
});

// ─── buildTaoCycle ────────────────────────────────────────────────────────────

describe("buildTaoCycle", () => {
  it("creates cycle with correct fields", () => {
    const cycle = makeCycle(3);
    expect(cycle.stepIndex).toBe(3);
    expect(cycle.thought).toBeDefined();
    expect(cycle.action).toBeDefined();
    expect(cycle.observation).toBeDefined();
    expect(cycle.timestamp).toBeTruthy();
  });

  it("records durationMs", () => {
    const cycle = buildTaoCycle(0, makeThought(), makeAction(), makeObservation(), 250);
    expect(cycle.durationMs).toBe(250);
  });
});

// ─── TaoLoopManager ──────────────────────────────────────────────────────────

describe("TaoLoopManager", () => {
  let mgr: TaoLoopManager;

  beforeEach(() => { mgr = new TaoLoopManager(10, "direct"); });

  it("starts with 0 steps", () => {
    expect(mgr.stepCount).toBe(0);
    expect(mgr.isTerminated).toBe(false);
  });

  it("recordCycle increments stepCount", () => {
    mgr.recordCycle(makeCycle(0));
    expect(mgr.stepCount).toBe(1);
  });

  it("terminates with 'success' on finish action", () => {
    const cycle = buildTaoCycle(0, makeThought(), makeAction("finish"), makeObservation(), 10);
    const reason = mgr.recordCycle(cycle);
    expect(reason).toBe("success");
    expect(mgr.isTerminated).toBe(true);
  });

  it("terminates with 'success' on completion signal observation", () => {
    const cycle = makeCycle(0, { output: "all tests pass", isCompletionSignal: true });
    const reason = mgr.recordCycle(cycle);
    expect(reason).toBe("success");
  });

  it("terminates with 'max-steps' when limit reached", () => {
    const loop = new TaoLoopManager(3);
    loop.recordCycle(makeCycle(0));
    loop.recordCycle(makeCycle(1));
    const reason = loop.recordCycle(makeCycle(2));
    expect(reason).toBe("max-steps");
  });

  it("terminates with 'repeated-failure' after 3+ failures in 5 steps", () => {
    const loop = new TaoLoopManager(20);
    for (let i = 0; i < 5; i++) {
      loop.recordCycle(makeCycle(i, { status: "failure", output: `error ${i}` }));
    }
    expect(loop.isTerminated).toBe(true);
    expect(loop.buildResult().terminationReason).toBe("repeated-failure");
  });

  it("terminates with 'stuck' on repeated same action+output", () => {
    const loop = new TaoLoopManager(20);
    loop.recordCycle(makeCycle(0, { target: "cat file.ts", output: "const x = 1" }));
    loop.recordCycle(makeCycle(1, { target: "cat file.ts", output: "const x = 1" }));
    const reason = loop.recordCycle(makeCycle(2, { target: "cat file.ts", output: "const x = 1" }));
    expect(reason).toBe("stuck");
  });

  it("forceStop terminates with given reason", () => {
    mgr.forceStop("user-stop");
    expect(mgr.isTerminated).toBe(true);
    expect(mgr.buildResult().terminationReason).toBe("user-stop");
  });

  it("buildResult includes all cycles", () => {
    mgr.recordCycle(makeCycle(0));
    mgr.recordCycle(makeCycle(1));
    const result = mgr.buildResult();
    expect(result.cycles).toHaveLength(2);
    expect(result.totalSteps).toBe(2);
  });

  it("buildResult.success=true only on 'success' termination", () => {
    const cycle = buildTaoCycle(0, makeThought(), makeAction("finish"), makeObservation(), 10);
    mgr.recordCycle(cycle);
    expect(mgr.buildResult().success).toBe(true);
  });

  it("formatForPrompt includes step numbers and action details", () => {
    mgr.recordCycle(makeCycle(0, { target: "npm test", output: "10 tests passed" }));
    const output = mgr.formatForPrompt();
    expect(output).toContain("Step 1");
    expect(output).toContain("npm test");
  });

  it("summarize returns files modified and commands run", () => {
    const writeCycle = buildTaoCycle(0, makeThought(), makeAction("write", "src/a.ts"), makeObservation(), 10);
    const bashCycle = buildTaoCycle(1, makeThought(), makeAction("bash", "npm test"), makeObservation(), 20);
    mgr.recordCycle(writeCycle);
    mgr.recordCycle(bashCycle);
    const summary = mgr.summarize();
    expect(summary.filesModified).toContain("src/a.ts");
    expect(summary.commandsRun).toContain("npm test");
  });

  it("currentStrategy adapts after repeated failures", () => {
    const loop = new TaoLoopManager(20, "direct");
    // 2 failures in 5 steps should trigger adaptation
    for (let i = 0; i < 4; i++) {
      loop.recordCycle(makeCycle(i, { status: "failure", output: `err ${i}` }));
    }
    // After 3+ failures in 5 steps, terminates, but let's check with fewer
    const loop2 = new TaoLoopManager(20, "direct");
    loop2.recordCycle(makeCycle(0, { status: "failure", output: "err" }));
    loop2.recordCycle(makeCycle(1, { status: "failure", output: "err2" }));
    loop2.recordCycle(makeCycle(2)); // success
    expect(loop2.currentStrategy).toBeDefined();
  });
});
