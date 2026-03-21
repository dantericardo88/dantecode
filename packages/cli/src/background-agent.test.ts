// ============================================================================
// @dantecode/cli — BackgroundAgentRunner CLI-level tests
// Smoke tests for the four core behaviours used by the CLI's /bg and
// /automate slash commands: enqueue+completion, cancel, getStatusCounts, and
// loop-detection output format.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundAgentRunner } from "@dantecode/core";

// ── child_process mock ────────────────────────────────────────────────────────
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    exec: vi.fn(
      (_cmd: string, _opts: unknown, cb?: (err: null, stdout: string, stderr: string) => void) => {
        cb?.(null, "", "");
        return {} as ReturnType<typeof actual.exec>;
      },
    ),
  };
});

// ── @dantecode/sandbox stub (not used in these tests but imported transitively) ─
vi.mock("@dantecode/sandbox", () => ({
  SandboxManager: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
  SandboxExecutor: vi.fn().mockImplementation(() => ({
    run: vi
      .fn()
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 5, timedOut: false }),
  })),
}));

describe("BackgroundAgentRunner (CLI smoke)", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-cli-bg-"));
  });

  // ── T1: enqueue + completion ──────────────────────────────────────────────

  it("T1: enqueue starts a task and it reaches completed status", async () => {
    const runner = new BackgroundAgentRunner(1, projectRoot);
    runner.setWorkFn(async () => ({ output: "done", touchedFiles: [] }));

    const taskId = runner.enqueue("hello world");

    // Task ID is a non-empty string
    expect(typeof taskId).toBe("string");
    expect(taskId.length).toBeGreaterThan(0);

    // Wait for completion
    await vi.waitFor(
      () => {
        expect(runner.getTask(taskId)?.status).toBe("completed");
      },
      { timeout: 5_000 },
    );

    const task = runner.getTask(taskId);
    expect(task).not.toBeNull();
    expect(task!.status).toBe("completed");
    expect(task!.prompt).toBe("hello world");
    expect(task!.output).toBe("done");
  });

  // ── T2: cancel behaviour ─────────────────────────────────────────────────

  it("T2: cancel() stops a queued task and returns true; cancel of unknown ID returns false", () => {
    // maxConcurrent=0 keeps tasks queued indefinitely
    const runner = new BackgroundAgentRunner(0, projectRoot);

    const taskId = runner.enqueue("task to cancel");
    expect(runner.getTask(taskId)?.status).toBe("queued");

    const result = runner.cancel(taskId);
    expect(result).toBe(true);
    expect(runner.getTask(taskId)?.status).toBe("cancelled");

    // Cancelling a non-existent task returns false
    expect(runner.cancel("nonexistent-id")).toBe(false);
  });

  // ── T3: getStatusCounts ──────────────────────────────────────────────────

  it("T3: getStatusCounts reflects queued, running, and completed tasks", async () => {
    // Use maxConcurrent=0 to keep tasks queued for the initial count assertion
    const queuedRunner = new BackgroundAgentRunner(0, projectRoot);
    queuedRunner.enqueue("q1");
    queuedRunner.enqueue("q2");
    queuedRunner.enqueue("q3");

    const counts = queuedRunner.getStatusCounts();
    expect(counts.queued).toBe(3);
    expect(counts.running).toBe(0);
    expect(counts.completed).toBe(0);
    expect(counts.failed).toBe(0);
    expect(counts.cancelled).toBe(0);

    // Verify the shape includes all statuses
    const expectedKeys: Array<keyof typeof counts> = [
      "queued",
      "running",
      "paused",
      "completed",
      "failed",
      "cancelled",
    ];
    for (const key of expectedKeys) {
      expect(typeof counts[key]).toBe("number");
    }
  });

  // ── T4: loop detection output format ─────────────────────────────────────

  it("T4: repeated failures trigger loop detection with 'Loop detected: <reason> — <details>' format", async () => {
    // failureThreshold=100 prevents circuit breaker from firing before loop
    // resetTimeoutMs=1 ensures no long delays in the circuit breaker
    const runner = new BackgroundAgentRunner(1, projectRoot, {
      failureThreshold: 100,
      resetTimeoutMs: 1,
    });

    runner.setWorkFn(async () => {
      throw new Error("boom");
    });

    // longRunning=true so the task is paused (not permanently failed) on loop detection
    const taskId = runner.enqueue("loop task", { longRunning: true });

    await vi.waitFor(
      () => {
        const task = runner.getTask(taskId);
        expect(task?.progress).toMatch(/^Loop detected: /);
      },
      { timeout: 15_000 },
    );

    const task = runner.getTask(taskId);
    expect(task).not.toBeNull();

    // Format: "Loop detected: <reason> — <details>"
    expect(task!.progress).toMatch(/^Loop detected: /);
    expect(task!.progress).toContain(" — ");

    // The reason must be one of the LoopDetector strategy names
    const validReasons = [
      "identical_consecutive",
      "cyclic_pattern",
      "max_iterations",
      "semantic_similarity",
    ];
    const hasValidReason = validReasons.some((r) => task!.progress.includes(r));
    expect(hasValidReason).toBe(true);

    // Task should be paused (long-running loop → pause, not permanent fail)
    expect(task!.status).toBe("paused");
  });
});
