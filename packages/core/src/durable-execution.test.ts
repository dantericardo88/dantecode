// ============================================================================
// @dantecode/core — Durable Execution Tests
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { DurableExecution } from "./durable-execution.js";

describe("DurableExecution", () => {
  let exec: DurableExecution;

  beforeEach(() => {
    exec = new DurableExecution();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Checkpoint creation
  // ──────────────────────────────────────────────────────────────────────────

  describe("checkpoint", () => {
    it("creates a checkpoint and returns its ID", () => {
      const id = exec.checkpoint({
        stepNumber: 1,
        currentTask: "write code",
        partialOutput: ["line 1"],
        memoryState: { key: "value" },
        toolCallHistory: [{ tool: "Read", timestamp: Date.now(), success: true }],
      });

      expect(id).toMatch(/^cp-/);
      expect(exec.size()).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Recovery
  // ──────────────────────────────────────────────────────────────────────────

  describe("recover", () => {
    it("recovers state from a checkpoint by ID", () => {
      const id = exec.checkpoint({
        stepNumber: 3,
        currentTask: "fix bug",
        partialOutput: ["output A", "output B"],
        memoryState: { progress: 50 },
        toolCallHistory: [],
      });

      const recovered = exec.recover(id);
      expect(recovered).not.toBeNull();
      expect(recovered!.stepNumber).toBe(3);
      expect(recovered!.currentTask).toBe("fix bug");
      expect(recovered!.partialOutput).toEqual(["output A", "output B"]);
      expect(recovered!.memoryState).toEqual({ progress: 50 });
    });

    it("returns null for unknown checkpoint ID", () => {
      expect(exec.recover("cp-nonexistent")).toBeNull();
    });

    it("returns a deep copy that does not share references", () => {
      const id = exec.checkpoint({
        stepNumber: 1,
        currentTask: "test",
        partialOutput: ["a"],
        memoryState: { nested: { val: 1 } },
        toolCallHistory: [],
      });

      const first = exec.recover(id)!;
      const second = exec.recover(id)!;

      first.partialOutput.push("modified");
      expect(second.partialOutput).toEqual(["a"]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Last checkpoint
  // ──────────────────────────────────────────────────────────────────────────

  describe("getLastCheckpoint", () => {
    it("returns the most recently created checkpoint", () => {
      exec.checkpoint({
        stepNumber: 1,
        currentTask: "first",
        partialOutput: [],
        memoryState: {},
        toolCallHistory: [],
      });
      exec.checkpoint({
        stepNumber: 2,
        currentTask: "second",
        partialOutput: [],
        memoryState: {},
        toolCallHistory: [],
      });

      const last = exec.getLastCheckpoint();
      expect(last).not.toBeNull();
      expect(last!.currentTask).toBe("second");
      expect(last!.stepNumber).toBe(2);
    });

    it("returns null when no checkpoints exist", () => {
      expect(exec.getLastCheckpoint()).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ──────────────────────────────────────────────────────────────────────────

  describe("cleanup", () => {
    it("removes checkpoints older than maxAge", () => {
      // Create a checkpoint with an old timestamp by manipulating Date.now
      const realNow = Date.now;
      const baseTime = 1_700_000_000_000;

      Date.now = () => baseTime;
      exec.checkpoint({
        stepNumber: 1,
        currentTask: "old",
        partialOutput: [],
        memoryState: {},
        toolCallHistory: [],
      });

      Date.now = () => baseTime + 60_000;
      exec.checkpoint({
        stepNumber: 2,
        currentTask: "new",
        partialOutput: [],
        memoryState: {},
        toolCallHistory: [],
      });

      // Cleanup with 30-second maxAge, from the perspective of the "new" time
      const deleted = exec.cleanup(30_000);

      Date.now = realNow;

      expect(deleted).toBe(1);
      expect(exec.size()).toBe(1);
      expect(exec.getLastCheckpoint()!.currentTask).toBe("new");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Checkpoint interval
  // ──────────────────────────────────────────────────────────────────────────

  describe("shouldCheckpoint", () => {
    it("returns true at default interval of 5", () => {
      expect(exec.shouldCheckpoint(5)).toBe(true);
      expect(exec.shouldCheckpoint(10)).toBe(true);
      expect(exec.shouldCheckpoint(15)).toBe(true);
    });

    it("returns false between intervals", () => {
      expect(exec.shouldCheckpoint(1)).toBe(false);
      expect(exec.shouldCheckpoint(3)).toBe(false);
      expect(exec.shouldCheckpoint(7)).toBe(false);
    });

    it("supports custom interval", () => {
      expect(exec.shouldCheckpoint(3, 3)).toBe(true);
      expect(exec.shouldCheckpoint(6, 3)).toBe(true);
      expect(exec.shouldCheckpoint(4, 3)).toBe(false);
    });

    it("returns false for step 0", () => {
      expect(exec.shouldCheckpoint(0)).toBe(false);
    });
  });
});
