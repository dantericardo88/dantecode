// ============================================================================
// @dantecode/core — Durable Execution Engine Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  DurableExecutionCheckpointSchema,
  CheckpointWorkspaceContextSchema,
  type ApplyReceipt,
} from "@dantecode/runtime-spine";
import {
  DurableExecutionEngine,
  listCheckpoints,
  clearAllCheckpoints,
  type ExecutionCheckpoint,
} from "./durable-execution.js";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function makeTmpRoot(): string {
  const dir = join(tmpdir(), `durable-exec-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeReceipt(stepId: string): ApplyReceipt {
  return {
    stepId,
    state: "success",
    affectedFiles: [],
    appliedAt: new Date().toISOString(),
    verification: "passed",
  };
}

function makeEngine(
  projectRoot: string,
  sessionId?: string,
  checkpointEveryN = 1,
): DurableExecutionEngine {
  return new DurableExecutionEngine({
    sessionId: sessionId ?? randomUUID().slice(0, 8),
    projectRoot,
    checkpointEveryN,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("DurableExecutionEngine", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeTmpRoot();
  });

  afterEach(() => {
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  // ── 1. checkpoint() writes file ─────────────────────────────────────────

  it("checkpoint() writes file to .dantecode/checkpoints/{sessionId}.json", async () => {
    const sessionId = "test-session-001";
    const engine = new DurableExecutionEngine({ sessionId, projectRoot });

    const receipts = ["step-0", "step-1", "step-2"].map((stepId) => ({
      stepId,
      state: "success" as const,
      affectedFiles: [],
      appliedAt: new Date().toISOString(),
      verification: "passed" as const,
    }));
    await engine.checkpoint(2, receipts);

    const expectedPath = join(projectRoot, ".dantecode", "checkpoints", `${sessionId}.json`);
    expect(existsSync(expectedPath)).toBe(true);
    expect(engine.getCheckpointPath()).toBe(expectedPath);
  });

  // ── 2. loadCheckpoint() returns null when no checkpoint exists ──────────

  it("loadCheckpoint() returns null when no checkpoint exists", async () => {
    const engine = makeEngine(projectRoot);
    const result = await engine.loadCheckpoint();
    expect(result).toBeNull();
  });

  // ── 3. loadCheckpoint() returns checkpoint data after checkpoint() ──────

  it("loadCheckpoint() returns checkpoint data after checkpoint()", async () => {
    const sessionId = "test-session-003";
    const engine = new DurableExecutionEngine({ sessionId, projectRoot });
    const completedSteps = ["step-alpha", "step-beta"];

    const receipts = completedSteps.map((stepId) => ({
      stepId,
      state: "success" as const,
      affectedFiles: [],
      appliedAt: new Date().toISOString(),
      verification: "passed" as const,
    }));
    await engine.checkpoint(1, receipts, "partial content here");

    const loaded = await engine.loadCheckpoint();
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe(sessionId);
    expect(loaded!.stepIndex).toBe(1);
    expect(loaded!.completedSteps).toEqual(completedSteps); // Legacy field for backward compatibility
    expect((loaded as any).completedStepReceipts).toHaveLength(2);
    expect(loaded!.partialOutput).toBe("partial content here");
    expect(loaded!.projectRoot).toBe(projectRoot);
    expect(loaded!.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(loaded!.runConfig).toMatchObject({
      checkpointEveryN: 1,
      maxRetries: 3,
    });
    expect(loaded!.workspaceContext).toBeDefined();
    expect(CheckpointWorkspaceContextSchema.safeParse(loaded!.workspaceContext).success).toBe(true);
  });

  // ── 4. clearCheckpoint() removes the file ───────────────────────────────

  it("clearCheckpoint() removes the file", async () => {
    const sessionId = "test-session-004";
    const engine = new DurableExecutionEngine({ sessionId, projectRoot });

    await engine.checkpoint(0, [
      {
        stepId: "step-0",
        state: "success",
        affectedFiles: [],
        appliedAt: new Date().toISOString(),
        verification: "passed",
      },
    ]);
    const path = engine.getCheckpointPath();
    expect(existsSync(path)).toBe(true);

    await engine.clearCheckpoint();
    expect(existsSync(path)).toBe(false);
  });

  it("clearCheckpoint() is a no-op when file does not exist", async () => {
    const engine = makeEngine(projectRoot);
    // Should not throw
    await expect(engine.clearCheckpoint()).resolves.toBeUndefined();
  });

  // ── 5. run() executes all steps in order ────────────────────────────────

  it("run() executes all steps in order and returns results", async () => {
    const engine = makeEngine(projectRoot);
    const executed: string[] = [];

    const steps = [
      {
        name: "step-a",
        fn: async () => {
          executed.push("a");
          return "result-a";
        },
      },
      {
        name: "step-b",
        fn: async () => {
          executed.push("b");
          return "result-b";
        },
      },
      {
        name: "step-c",
        fn: async () => {
          executed.push("c");
          return "result-c";
        },
      },
    ];

    const results = await engine.run(steps);
    expect(executed).toEqual(["a", "b", "c"]);
    expect(results).toEqual(["result-a", "result-b", "result-c"]);
  });

  // ── 6. run() resumes from checkpoint when one exists ────────────────────

  it("run() resumes from checkpoint when one exists (pre-written)", async () => {
    const sessionId = "test-session-006";
    const engine = new DurableExecutionEngine({ sessionId, projectRoot });

    // Pre-write a checkpoint simulating that steps 0 and 1 already completed
    const checkpointDir = join(projectRoot, ".dantecode", "checkpoints");
    mkdirSync(checkpointDir, { recursive: true });
    const checkpointData: ExecutionCheckpoint = {
      sessionId,
      stepIndex: 1,
      completedSteps: ["step-first", "step-second"],
      savedAt: new Date().toISOString(),
      projectRoot,
      runConfig: {
        checkpointEveryN: 1,
        maxRetries: 3,
      },
      workspaceContext: {
        projectRoot,
        workspaceRoot: projectRoot,
        workspaceIsRepoRoot: false,
        installContextKind: "npm_global_cli",
      },
    };
    writeFileSync(
      join(checkpointDir, `${sessionId}.json`),
      JSON.stringify(checkpointData),
      "utf-8",
    );

    const executed: string[] = [];

    const steps = [
      {
        name: "step-first",
        fn: async () => {
          executed.push("first");
          return 1;
        },
      },
      {
        name: "step-second",
        fn: async () => {
          executed.push("second");
          return 2;
        },
      },
      {
        name: "step-third",
        fn: async () => {
          executed.push("third");
          return 3;
        },
      },
    ];

    await engine.run(steps);

    // Only step-third should have executed (steps 0 and 1 were in checkpoint)
    expect(executed).toEqual(["third"]);
  });

  it("run() refuses to resume when the persisted checkpoint config does not match", async () => {
    const sessionId = "test-session-config-mismatch";
    const engine = new DurableExecutionEngine({
      sessionId,
      projectRoot,
      checkpointEveryN: 2,
      maxRetries: 5,
    });

    const checkpointDir = join(projectRoot, ".dantecode", "checkpoints");
    mkdirSync(checkpointDir, { recursive: true });
    const checkpointData: ExecutionCheckpoint = {
      sessionId,
      stepIndex: 0,
      completedSteps: ["step-first"],
      savedAt: new Date().toISOString(),
      projectRoot,
      runConfig: {
        checkpointEveryN: 1,
        maxRetries: 3,
      },
      workspaceContext: {
        projectRoot,
        workspaceRoot: projectRoot,
        workspaceIsRepoRoot: false,
        installContextKind: "npm_global_cli",
      },
    };
    writeFileSync(
      join(checkpointDir, `${sessionId}.json`),
      JSON.stringify(checkpointData),
      "utf-8",
    );

    await expect(engine.run([{ name: "step-first", fn: async () => 1 }])).rejects.toThrow(
      /Checkpoint config mismatch/,
    );
  });

  it("loadCheckpoint() returns null for invalid persisted checkpoint payloads", async () => {
    const sessionId = "test-session-invalid-payload";
    const engine = new DurableExecutionEngine({ sessionId, projectRoot });
    const checkpointDir = join(projectRoot, ".dantecode", "checkpoints");
    mkdirSync(checkpointDir, { recursive: true });
    writeFileSync(
      join(checkpointDir, `${sessionId}.json`),
      JSON.stringify({
        sessionId,
        stepIndex: -1,
        completedSteps: "not-an-array",
        savedAt: "not-a-timestamp",
        projectRoot,
      }),
      "utf-8",
    );

    await expect(engine.loadCheckpoint()).resolves.toBeNull();
  });

  // ── 7. run() clears checkpoint on completion ────────────────────────────

  it("run() clears checkpoint on successful completion", async () => {
    const sessionId = "test-session-007";
    const engine = new DurableExecutionEngine({ sessionId, projectRoot });

    const steps = [
      { name: "step-x", fn: async () => "x" },
      { name: "step-y", fn: async () => "y" },
    ];

    await engine.run(steps);

    // Checkpoint file should be gone
    const path = engine.getCheckpointPath();
    expect(existsSync(path)).toBe(false);
    // loadCheckpoint returns null
    expect(await engine.loadCheckpoint()).toBeNull();
  });

  // ── onStep callback ──────────────────────────────────────────────────────

  it("run() calls onStep callback for each step", async () => {
    const engine = makeEngine(projectRoot);
    const callLog: Array<{ index: number; name: string }> = [];

    const steps = [
      { name: "alpha", fn: async () => 1 },
      { name: "beta", fn: async () => 2 },
    ];

    await engine.run(steps, (index, name) => {
      callLog.push({ index, name });
    });

    expect(callLog).toEqual([
      { index: 0, name: "alpha" },
      { index: 1, name: "beta" },
    ]);
  });

  // ── checkpointEveryN ────────────────────────────────────────────────────

  it("run() respects checkpointEveryN option (checkpoints only every N steps)", async () => {
    const sessionId = "test-session-everyN";
    const engine = new DurableExecutionEngine({
      sessionId,
      projectRoot,
      checkpointEveryN: 2,
    });

    const steps = [
      { name: "s0", fn: async () => 0 },
      { name: "s1", fn: async () => 1 },
      { name: "s2", fn: async () => 2 },
    ];

    await engine.run(steps);

    // Checkpoint is cleared at end, file should not exist
    expect(existsSync(engine.getCheckpointPath())).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// listCheckpoints
// ────────────────────────────────────────────────────────────────────────────

describe("listCheckpoints()", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeTmpRoot();
  });

  afterEach(() => {
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  // ── 8. listCheckpoints() returns all checkpoints ────────────────────────

  it("listCheckpoints() returns all checkpoints in .dantecode/checkpoints/", async () => {
    const engine1 = new DurableExecutionEngine({
      sessionId: "session-a",
      projectRoot,
    });
    const engine2 = new DurableExecutionEngine({
      sessionId: "session-b",
      projectRoot,
    });

    await engine1.checkpoint(0, [makeReceipt("step-0")]);
    // Small delay to ensure different savedAt timestamps
    await new Promise((r) => setTimeout(r, 5));
    await engine2.checkpoint(1, [makeReceipt("step-0"), makeReceipt("step-1")]);

    const all = await listCheckpoints(projectRoot);
    expect(all).toHaveLength(2);
    expect(DurableExecutionCheckpointSchema.safeParse(all[0]).success).toBe(true);
    expect(DurableExecutionCheckpointSchema.safeParse(all[1]).success).toBe(true);
    // Sorted oldest-first
    expect(all[0]!.sessionId).toBe("session-a");
    expect(all[1]!.sessionId).toBe("session-b");
  });

  it("listCheckpoints() skips invalid checkpoint payloads", async () => {
    const checkpointDir = join(projectRoot, ".dantecode", "checkpoints");
    mkdirSync(checkpointDir, { recursive: true });
    writeFileSync(
      join(checkpointDir, "valid.json"),
      JSON.stringify({
        sessionId: "session-valid",
        stepIndex: 0,
        completedSteps: [],
        savedAt: new Date().toISOString(),
        projectRoot,
        runConfig: {
          checkpointEveryN: 1,
          maxRetries: 3,
        },
        workspaceContext: {
          projectRoot,
          workspaceRoot: projectRoot,
          workspaceIsRepoRoot: false,
          installContextKind: "npm_global_cli",
        },
      }),
      "utf-8",
    );
    writeFileSync(
      join(checkpointDir, "invalid.json"),
      JSON.stringify({
        sessionId: "session-invalid",
        stepIndex: -3,
        completedSteps: "oops",
        savedAt: "bad",
        projectRoot,
      }),
      "utf-8",
    );

    const all = await listCheckpoints(projectRoot);
    expect(all).toHaveLength(1);
    expect(all[0]?.sessionId).toBe("session-valid");
  });

  it("listCheckpoints() returns empty array when directory does not exist", async () => {
    const empty = await listCheckpoints(join(projectRoot, "nonexistent"));
    expect(empty).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// clearAllCheckpoints
// ────────────────────────────────────────────────────────────────────────────

describe("clearAllCheckpoints()", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeTmpRoot();
  });

  afterEach(() => {
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("clearAllCheckpoints() removes all checkpoint files", async () => {
    const engine1 = new DurableExecutionEngine({
      sessionId: "sa",
      projectRoot,
    });
    const engine2 = new DurableExecutionEngine({
      sessionId: "sb",
      projectRoot,
    });

    await engine1.checkpoint(0, [makeReceipt("step-0")]);
    await engine2.checkpoint(0, [makeReceipt("step-0")]);

    expect(await listCheckpoints(projectRoot)).toHaveLength(2);

    await clearAllCheckpoints(projectRoot);
    expect(await listCheckpoints(projectRoot)).toHaveLength(0);
  });

  it("clearAllCheckpoints() is a no-op when directory does not exist", async () => {
    await expect(clearAllCheckpoints(join(projectRoot, "nonexistent"))).resolves.toBeUndefined();
  });
});
