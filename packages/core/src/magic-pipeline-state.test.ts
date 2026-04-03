// ============================================================================
// @dantecode/core — Magic Pipeline State Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveMagicPipelineState,
  loadMagicPipelineState,
  clearMagicPipelineState,
  createMagicPipelineState,
  advancePipelineStep,
  recordStepRetry,
  remainingSteps,
  estimateRequiredRounds,
  formatPipelineProgress,
  getMagicStatePath,
  type MagicStepResult,
} from "./magic-pipeline-state.js";

describe("MagicPipelineState", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "magic-state-test-"));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  describe("getMagicStatePath", () => {
    it("returns path under .danteforge/", () => {
      const p = getMagicStatePath("/project");
      expect(p).toContain(".danteforge");
      expect(p).toContain("magic-session.json");
    });
  });

  describe("createMagicPipelineState", () => {
    it("creates initial state with correct defaults", () => {
      const state = createMagicPipelineState({
        pipelineId: "test-id",
        level: "magic",
        goal: "Improve reliability",
        steps: [{ kind: "autoforge" }, { kind: "lessons-compact" }],
      });
      expect(state.pipelineId).toBe("test-id");
      expect(state.level).toBe("magic");
      expect(state.goal).toBe("Improve reliability");
      expect(state.totalSteps).toBe(2);
      expect(state.currentStepIndex).toBe(0);
      expect(state.completedSteps).toEqual([]);
      expect(state.completed).toBe(false);
      expect(state.maxRetriesPerStep).toBe(2);
    });

    it("accepts custom maxRetriesPerStep", () => {
      const state = createMagicPipelineState({
        pipelineId: "id",
        level: "ember",
        goal: "test",
        steps: [],
        maxRetriesPerStep: 5,
      });
      expect(state.maxRetriesPerStep).toBe(5);
    });
  });

  describe("advancePipelineStep", () => {
    it("advances the step index and records result", () => {
      const state = createMagicPipelineState({
        pipelineId: "id",
        level: "magic",
        goal: "test",
        steps: [{ kind: "autoforge" }, { kind: "lessons-compact" }],
      });
      const result: MagicStepResult = {
        kind: "autoforge",
        status: "ok",
        durationMs: 5000,
      };
      const next = advancePipelineStep(state, result);
      expect(next.currentStepIndex).toBe(1);
      expect(next.completedSteps).toHaveLength(1);
      expect(next.completedSteps[0]!.kind).toBe("autoforge");
      expect(next.completed).toBe(false);
      expect(next.currentStepRetries).toBe(0);
    });

    it("marks completed when all steps are done", () => {
      let state = createMagicPipelineState({
        pipelineId: "id",
        level: "ember",
        goal: "test",
        steps: [{ kind: "autoforge" }],
      });
      state = advancePipelineStep(state, {
        kind: "autoforge",
        status: "ok",
        durationMs: 1000,
      });
      expect(state.completed).toBe(true);
      expect(state.currentStepIndex).toBe(1);
    });
  });

  describe("recordStepRetry", () => {
    it("increments retry count and reports canRetry=true", () => {
      const state = createMagicPipelineState({
        pipelineId: "id",
        level: "magic",
        goal: "test",
        steps: [{ kind: "autoforge" }],
        maxRetriesPerStep: 3,
      });
      const { state: s1, canRetry: c1 } = recordStepRetry(state);
      expect(s1.currentStepRetries).toBe(1);
      expect(c1).toBe(true);
    });

    it("reports canRetry=false when max retries reached", () => {
      let state = createMagicPipelineState({
        pipelineId: "id",
        level: "magic",
        goal: "test",
        steps: [{ kind: "autoforge" }],
        maxRetriesPerStep: 2,
      });
      state = recordStepRetry(state).state;
      const { canRetry } = recordStepRetry(state);
      expect(canRetry).toBe(false);
    });
  });

  describe("remainingSteps", () => {
    it("returns correct count", () => {
      const state = createMagicPipelineState({
        pipelineId: "id",
        level: "inferno",
        goal: "test",
        steps: [{ kind: "oss" }, { kind: "autoforge" }, { kind: "party" }],
      });
      expect(remainingSteps(state)).toBe(3);

      const next = advancePipelineStep(state, {
        kind: "oss",
        status: "ok",
        durationMs: 1000,
      });
      expect(remainingSteps(next)).toBe(2);
    });
  });

  describe("estimateRequiredRounds", () => {
    it("estimates correctly for different step kinds", () => {
      const steps = [
        { kind: "oss", maxRepos: 5 },
        { kind: "autoforge", maxWaves: 8 },
        { kind: "party" },
        { kind: "verify" },
        { kind: "lessons-compact" },
      ];
      const estimate = estimateRequiredRounds(steps);
      // oss=40 + autoforge=8*5=40 + party=25 + verify=8 + lessons=3 = 116
      expect(estimate).toBe(116);
    });

    it("uses default maxWaves for autoforge without maxWaves", () => {
      const estimate = estimateRequiredRounds([{ kind: "autoforge" }]);
      expect(estimate).toBe(40); // 8 * 5
    });

    it("returns 5 per step for unknown kinds", () => {
      const estimate = estimateRequiredRounds([{ kind: "review" }, { kind: "plan" }]);
      expect(estimate).toBe(10); // 5 + 5
    });
  });

  describe("save/load/clear cycle", () => {
    it("saves and loads state from disk", async () => {
      const state = createMagicPipelineState({
        pipelineId: "persist-test",
        level: "blaze",
        goal: "Test persistence",
        steps: [{ kind: "autoforge" }, { kind: "party" }],
      });

      await saveMagicPipelineState(tmpRoot, state);

      const loaded = await loadMagicPipelineState(tmpRoot);
      expect(loaded).not.toBeNull();
      expect(loaded!.pipelineId).toBe("persist-test");
      expect(loaded!.level).toBe("blaze");
      expect(loaded!.goal).toBe("Test persistence");
      expect(loaded!.totalSteps).toBe(2);
    });

    it("returns null when no state file exists", async () => {
      const loaded = await loadMagicPipelineState(tmpRoot);
      expect(loaded).toBeNull();
    });

    it("clears state from disk", async () => {
      const state = createMagicPipelineState({
        pipelineId: "clear-test",
        level: "magic",
        goal: "test",
        steps: [],
      });
      await saveMagicPipelineState(tmpRoot, state);

      // Verify it exists
      const loaded = await loadMagicPipelineState(tmpRoot);
      expect(loaded).not.toBeNull();

      // Clear and verify gone
      await clearMagicPipelineState(tmpRoot);
      const cleared = await loadMagicPipelineState(tmpRoot);
      expect(cleared).toBeNull();
    });

    it("clearMagicPipelineState is safe when file doesn't exist", async () => {
      // Should not throw
      await clearMagicPipelineState(tmpRoot);
    });

    it("updates lastCheckpointAt on save", async () => {
      const state = createMagicPipelineState({
        pipelineId: "ts-test",
        level: "magic",
        goal: "test",
        steps: [],
      });
      const before = state.lastCheckpointAt;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 5));
      await saveMagicPipelineState(tmpRoot, state);

      const loaded = await loadMagicPipelineState(tmpRoot);
      expect(loaded!.lastCheckpointAt).not.toBe(before);
    });
  });

  describe("formatPipelineProgress", () => {
    it("formats empty pipeline", () => {
      const state = createMagicPipelineState({
        pipelineId: "id",
        level: "magic",
        goal: "test",
        steps: [{ kind: "autoforge" }, { kind: "lessons-compact" }],
      });
      const formatted = formatPipelineProgress(state);
      expect(formatted).toContain("0/2 steps complete");
      expect(formatted).toContain("2 remaining");
    });

    it("formats partially completed pipeline", () => {
      let state = createMagicPipelineState({
        pipelineId: "id",
        level: "inferno",
        goal: "test",
        steps: [{ kind: "oss" }, { kind: "autoforge" }, { kind: "party" }],
      });
      state = advancePipelineStep(state, {
        kind: "oss",
        status: "ok",
        durationMs: 30000,
      });
      const formatted = formatPipelineProgress(state);
      expect(formatted).toContain("1/3 steps complete");
      expect(formatted).toContain("2 remaining");
      expect(formatted).toContain("[OK] oss");
    });

    it("includes failed steps", () => {
      let state = createMagicPipelineState({
        pipelineId: "id",
        level: "magic",
        goal: "test",
        steps: [{ kind: "autoforge" }],
      });
      state = advancePipelineStep(state, {
        kind: "autoforge",
        status: "fail",
        durationMs: 5000,
        message: "timeout",
      });
      const formatted = formatPipelineProgress(state);
      expect(formatted).toContain("[FAIL] autoforge");
    });
  });
});
