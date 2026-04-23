// ============================================================================
// PlanActController — per-step git snapshot + rollback tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExecFileException } from "node:child_process";

// Mock vscode before importing the module under test.
vi.mock("vscode", () => ({
  Uri: { file: (p: string) => ({ fsPath: p }) },
  workspace: { fs: { readFile: vi.fn(), writeFile: vi.fn(), delete: vi.fn() } },
  window: { showTextDocument: vi.fn(), showInformationMessage: vi.fn(), createTextEditorDecorationType: vi.fn() },
  ViewColumn: { Beside: 2 },
}));

// Mock node:child_process before importing the module under test.
// We do a partial mock so that other exports (exec, spawn, etc.) still exist.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

// Import after mock registration.
import {
  PlanActController,
  setActivePlanActController,
  getActivePlanActController,
} from "../plan-act-controller.js";
import type { PlanActControllerOptions } from "../plan-act-controller.js";
import type { ExecutionPlan, PlanStep, StepExecutionResult } from "@dantecode/core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePlan(stepCount: number): ExecutionPlan {
  return {
    goal: "test goal",
    steps: Array.from({ length: stepCount }, (_, i) => ({
      id: `step-${i + 1}`,
      description: `Step ${i + 1}`,
      files: [],
      status: "pending" as const,
    })),
    createdAt: new Date().toISOString(),
    estimatedComplexity: 0.5,
  };
}

function makeOkStep(stepId: string): StepExecutionResult {
  return { stepId, success: true, output: "done", durationMs: 1 };
}

function makeController(
  overrides: Partial<PlanActControllerOptions> = {},
  workdir = "/fake/repo",
): PlanActController {
  return new PlanActController({
    executeStep: vi.fn().mockImplementation((step: PlanStep) => makeOkStep(step.id)),
    workdir,
    ...overrides,
  });
}

/**
 * Sets up the node:child_process mock so that every `execFile` call resolves
 * using the provided factory.  The factory receives the command arguments so
 * tests can return different values per call.
 */
async function setupExecFileMock(
  factory: (args: string[]) => { stdout: string } | Error,
): Promise<void> {
  const { execFile } = await import("node:child_process");
  const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      args: string[],
      _opts: unknown,
      callback: (
        err: ExecFileException | null,
        result: { stdout: string; stderr: string },
      ) => void,
    ) => {
      const result = factory(args);
      if (result instanceof Error) {
        callback(result as ExecFileException, { stdout: "", stderr: result.message });
      } else {
        callback(null, { stdout: result.stdout, stderr: "" });
      }
    },
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PlanActController — git snapshots", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Default: rev-parse HEAD returns a fixed SHA, reset --hard succeeds
    await setupExecFileMock((args) => {
      if (args.includes("rev-parse")) return { stdout: "abc1234def5678\n" };
      return { stdout: "" }; // reset --hard
    });
  });

  afterEach(() => {
    setActivePlanActController(null);
  });

  // 1. _captureSnapshot(0) stores SHA from `git rev-parse HEAD`
  it("captureSnapshot stores the SHA returned by git rev-parse HEAD", async () => {
    const ctrl = makeController();
    await ctrl._captureSnapshot(0);
    expect(ctrl.getSnapshots().get(0)).toBe("abc1234def5678");
  });

  // 2. _captureSnapshot(1) stores different SHA for step 1
  it("captureSnapshot stores different SHAs for different step indices", async () => {
    let callCount = 0;
    await setupExecFileMock((args) => {
      if (args.includes("rev-parse")) {
        callCount++;
        return { stdout: callCount === 1 ? "sha-step-0\n" : "sha-step-1\n" };
      }
      return { stdout: "" };
    });

    const ctrl = makeController();
    await ctrl._captureSnapshot(0);
    await ctrl._captureSnapshot(1);

    expect(ctrl.getSnapshots().get(0)).toBe("sha-step-0");
    expect(ctrl.getSnapshots().get(1)).toBe("sha-step-1");
  });

  // 3. rollbackToStep(0) calls `git reset --hard <sha-0>`
  it("rollbackToStep calls git reset --hard with the correct SHA", async () => {
    const { execFile } = await import("node:child_process");
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

    const ctrl = makeController();
    await ctrl._captureSnapshot(0);
    await ctrl.rollbackToStep(0);

    const resetCall = mockExecFile.mock.calls.find((c) => {
      const args = c[1] as string[];
      return args.includes("reset") && args.includes("--hard");
    });
    expect(resetCall).toBeDefined();
    const callArgs = resetCall![1] as string[];
    expect(callArgs).toContain("abc1234def5678");
  });

  // 4. rollbackToStep(0) returns { success: true, sha }
  it("rollbackToStep returns { success: true, sha } on success", async () => {
    const ctrl = makeController();
    await ctrl._captureSnapshot(0);
    const result = await ctrl.rollbackToStep(0);

    expect(result.success).toBe(true);
    expect(result.sha).toBe("abc1234def5678");
  });

  // 5. rollbackToStep(99) returns { success: false, error } when no snapshot
  it("rollbackToStep returns { success: false, error } when no snapshot exists", async () => {
    const ctrl = makeController();
    const result = await ctrl.rollbackToStep(99);

    expect(result.success).toBe(false);
    expect(result.error).toBe("No snapshot for step 99");
    expect(result.sha).toBeUndefined();
  });

  // 6. rollbackToStep(0) returns { success: false, error } when git throws
  it("rollbackToStep returns { success: false, error } when git reset fails", async () => {
    await setupExecFileMock((args) => {
      if (args.includes("rev-parse")) return { stdout: "deadbeef\n" };
      // git reset --hard fails
      return new Error("fatal: cannot do a hard reset");
    });

    const ctrl = makeController();
    await ctrl._captureSnapshot(0);
    const result = await ctrl.rollbackToStep(0);

    expect(result.success).toBe(false);
    expect(result.error).toContain("fatal: cannot do a hard reset");
  });

  // 7. clearSnapshots() empties the snapshot map
  it("clearSnapshots empties all stored snapshots", async () => {
    const ctrl = makeController();
    await ctrl._captureSnapshot(0);
    await ctrl._captureSnapshot(1);

    expect(ctrl.getSnapshots().size).toBe(2);
    ctrl.clearSnapshots();
    expect(ctrl.getSnapshots().size).toBe(0);
  });

  // 8. Snapshot not overwritten if step already has one (idempotent capture)
  it("captureSnapshot is idempotent — does not overwrite an existing snapshot", async () => {
    let captureCallCount = 0;
    await setupExecFileMock((args) => {
      if (args.includes("rev-parse")) {
        captureCallCount++;
        return { stdout: `sha-call-${captureCallCount}\n` };
      }
      return { stdout: "" };
    });

    const ctrl = makeController();
    await ctrl._captureSnapshot(0);
    const firstSha = ctrl.getSnapshots().get(0);

    // Call again for the same step — should NOT overwrite.
    await ctrl._captureSnapshot(0);
    const secondSha = ctrl.getSnapshots().get(0);

    expect(firstSha).toBe("sha-call-1");
    expect(secondSha).toBe(firstSha); // unchanged
    expect(captureCallCount).toBe(1); // git only called once
  });

  // 9. _captureSnapshot fails silently when no git repo (no throw)
  it("captureSnapshot does not throw when git is unavailable", async () => {
    await setupExecFileMock((_args) => new Error("git: command not found"));

    const ctrl = makeController();
    // Should resolve without throwing
    await expect(ctrl._captureSnapshot(0)).resolves.toBeUndefined();
    // No snapshot stored
    expect(ctrl.getSnapshots().has(0)).toBe(false);
  });

  // 10. execute() integrates snapshot capture into the plan loop
  it("execute captures a snapshot before each step", async () => {
    let captureCallCount = 0;
    await setupExecFileMock((args) => {
      if (args.includes("rev-parse")) {
        captureCallCount++;
        return { stdout: `sha-${captureCallCount}\n` };
      }
      return { stdout: "" };
    });

    const ctrl = makeController();
    const plan = makePlan(3);
    await ctrl.execute(plan);

    expect(ctrl.getSnapshots().size).toBe(3);
    expect(ctrl.getSnapshots().get(0)).toBe("sha-1");
    expect(ctrl.getSnapshots().get(1)).toBe("sha-2");
    expect(ctrl.getSnapshots().get(2)).toBe("sha-3");
  });

  // 11. setActivePlanActController / getActivePlanActController round-trip
  it("setActivePlanActController and getActivePlanActController work correctly", () => {
    const ctrl = makeController();
    setActivePlanActController(ctrl);
    expect(getActivePlanActController()).toBe(ctrl);
    setActivePlanActController(null);
    expect(getActivePlanActController()).toBeNull();
  });
});
