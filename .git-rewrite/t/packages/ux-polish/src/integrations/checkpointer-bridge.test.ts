/**
 * checkpointer-bridge.test.ts — @dantecode/ux-polish
 * Tests for G14 — Checkpointer weld.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CheckpointedProgress } from "./checkpointer-bridge.js";
import { ProgressOrchestrator } from "../progress-orchestrator.js";
import type { CheckpointerLike } from "./checkpointer-bridge.js";
import type { ProgressState } from "../types.js";

// ---------------------------------------------------------------------------
// Mock checkpointer
// ---------------------------------------------------------------------------

function makeMockCheckpointer(): CheckpointerLike & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async put(sessionId, checkpoint) {
      store.set(sessionId, checkpoint);
    },
    async getTuple(sessionId) {
      const cp = store.get(sessionId);
      if (!cp) return null;
      return {
        checkpoint: cp as { channelValues: Record<string, unknown>; step: number },
        metadata: { step: 1 },
      };
    },
  };
}

describe("CheckpointedProgress", () => {
  let orchestrator: ProgressOrchestrator;
  let mock: ReturnType<typeof makeMockCheckpointer>;
  let cp: CheckpointedProgress;

  beforeEach(() => {
    orchestrator = new ProgressOrchestrator();
    mock = makeMockCheckpointer();
    cp = new CheckpointedProgress({ orchestrator, checkpointer: mock });
  });

  describe("hasCheckpointer", () => {
    it("returns true when checkpointer is provided", () => {
      expect(cp.hasCheckpointer).toBe(true);
    });

    it("returns false when no checkpointer", () => {
      const cp2 = new CheckpointedProgress({ orchestrator });
      expect(cp2.hasCheckpointer).toBe(false);
    });
  });

  describe("saveCheckpoint()", () => {
    it("is a no-op when no checkpointer", async () => {
      const cp2 = new CheckpointedProgress({ orchestrator });
      await expect(cp2.saveCheckpoint("sess-1")).resolves.toBeUndefined();
    });

    it("saves orchestrator state to the checkpointer", async () => {
      orchestrator.startProgress("p1", { phase: "Building", message: "compile" });
      await cp.saveCheckpoint("sess-1");
      expect(mock.store.has("sess-1")).toBe(true);
    });

    it("stored checkpoint contains progressState channel value", async () => {
      orchestrator.startProgress("p2", { phase: "Testing" });
      await cp.saveCheckpoint("sess-2");
      const stored = mock.store.get("sess-2") as { channelValues: Record<string, unknown> };
      expect(stored.channelValues["progressState"]).toBeDefined();
    });
  });

  describe("restoreCheckpoint()", () => {
    it("returns false when no checkpointer", async () => {
      const cp2 = new CheckpointedProgress({ orchestrator });
      expect(await cp2.restoreCheckpoint("sess-x")).toBe(false);
    });

    it("returns false when session not found", async () => {
      expect(await cp.restoreCheckpoint("nonexistent")).toBe(false);
    });

    it("returns true after saving and restoring", async () => {
      orchestrator.startProgress("p3", { phase: "Deploy" });
      await cp.saveCheckpoint("sess-3");

      const orchestrator2 = new ProgressOrchestrator();
      const cp2 = new CheckpointedProgress({ orchestrator: orchestrator2, checkpointer: mock });
      const restored = await cp2.restoreCheckpoint("sess-3");
      expect(restored).toBe(true);
    });

    it("restores progress state into the new orchestrator", async () => {
      orchestrator.startProgress("p4", { phase: "Linting" });
      orchestrator.updateProgress("p4", { progress: 50 });
      await cp.saveCheckpoint("sess-4");

      const orchestrator2 = new ProgressOrchestrator();
      const cp2 = new CheckpointedProgress({ orchestrator: orchestrator2, checkpointer: mock });
      await cp2.restoreCheckpoint("sess-4");

      const states = orchestrator2.getAllProgress();
      expect(states.length).toBeGreaterThan(0);
      expect(states.some((s: ProgressState) => s.phase === "Linting")).toBe(true);
    });
  });

  describe("formatResumedStatus()", () => {
    it("returns 'no in-progress items' when orchestrator is empty", () => {
      const msg = cp.formatResumedStatus("sess-0");
      expect(msg).toContain("no in-progress items");
    });

    it("includes phase names in resumed status", () => {
      orchestrator.startProgress("p5", { phase: "Building" });
      orchestrator.startProgress("p6", { phase: "Testing" });
      const msg = cp.formatResumedStatus("sess-5");
      expect(msg).toContain("Building");
      expect(msg).toContain("Testing");
    });

    it("shows resuming session message", () => {
      orchestrator.startProgress("p7", { phase: "Deploy" });
      const msg = cp.formatResumedStatus("my-session");
      expect(msg).toContain("my-session");
    });
  });

  describe("orchestrator accessor", () => {
    it("returns the wrapped orchestrator", () => {
      expect(cp.orchestrator).toBe(orchestrator);
    });
  });
});
