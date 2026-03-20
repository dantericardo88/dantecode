/**
 * progress-orchestrator.test.ts — @dantecode/ux-polish
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ProgressOrchestrator,
  startProgress,
  updateProgress,
  resetProgressOrchestrator,
} from "./progress-orchestrator.js";
import { ThemeEngine } from "./theme-engine.js";

const noColor = new ThemeEngine({ colors: false });

describe("ProgressOrchestrator", () => {
  let orch: ProgressOrchestrator;

  beforeEach(() => {
    orch = new ProgressOrchestrator({ theme: noColor });
    resetProgressOrchestrator();
  });

  it("startProgress creates a running state", () => {
    const state = orch.startProgress("task1", { phase: "Building" });
    expect(state.id).toBe("task1");
    expect(state.status).toBe("running");
    expect(state.phase).toBe("Building");
  });

  it("startProgress throws if id already exists", () => {
    orch.startProgress("dup", { phase: "A" });
    expect(() => orch.startProgress("dup", { phase: "B" })).toThrow("already exists");
  });

  it("updateProgress patches fields", () => {
    orch.startProgress("t", { phase: "Init" });
    const state = orch.updateProgress("t", { phase: "Running", progress: 50 });
    expect(state.phase).toBe("Running");
    expect(state.progress).toBe(50);
  });

  it("updateProgress clamps progress to 0-100", () => {
    orch.startProgress("t", { phase: "P" });
    expect(orch.updateProgress("t", { progress: 150 }).progress).toBe(100);
    expect(orch.updateProgress("t", { progress: -10 }).progress).toBe(0);
  });

  it("completeProgress sets status=completed + progress=100", () => {
    orch.startProgress("t", { phase: "P" });
    const state = orch.completeProgress("t", "done");
    expect(state.status).toBe("completed");
    expect(state.progress).toBe(100);
    expect(state.message).toBe("done");
  });

  it("failProgress sets status=failed", () => {
    orch.startProgress("t", { phase: "P" });
    const state = orch.failProgress("t", "something broke");
    expect(state.status).toBe("failed");
    expect(state.message).toBe("something broke");
    expect(state.endedAt).toBeDefined();
  });

  it("pauseProgress / resumeProgress work", () => {
    orch.startProgress("t", { phase: "P" });
    expect(orch.pauseProgress("t").status).toBe("paused");
    expect(orch.resumeProgress("t").status).toBe("running");
  });

  it("getProgress returns undefined for unknown id", () => {
    expect(orch.getProgress("missing")).toBeUndefined();
  });

  it("getAllProgress returns all states", () => {
    orch.startProgress("a", { phase: "A" });
    orch.startProgress("b", { phase: "B" });
    expect(orch.getAllProgress()).toHaveLength(2);
  });

  it("getSummary counts by status", () => {
    orch.startProgress("a", { phase: "A" });
    orch.startProgress("b", { phase: "B" });
    orch.completeProgress("a");
    orch.failProgress("b", "err");
    const s = orch.getSummary();
    expect(s.completed).toBe(1);
    expect(s.failed).toBe(1);
  });

  it("isAllComplete returns false when running tasks exist", () => {
    orch.startProgress("t", { phase: "P" });
    expect(orch.isAllComplete()).toBe(false);
  });

  it("isAllComplete returns true when all terminal", () => {
    orch.startProgress("t", { phase: "P" });
    orch.completeProgress("t");
    expect(orch.isAllComplete()).toBe(true);
  });

  it("isAllComplete returns false on empty", () => {
    expect(orch.isAllComplete()).toBe(false);
  });

  it("serialize / restore round-trips state", () => {
    orch.startProgress("x", { phase: "X", message: "msg" });
    const snap = orch.serialize();

    const orch2 = new ProgressOrchestrator({ theme: noColor });
    orch2.restore(snap);
    const state = orch2.getProgress("x");
    expect(state?.phase).toBe("X");
    expect(state?.message).toBe("msg");
  });

  it("remove() deletes a specific item", () => {
    orch.startProgress("t", { phase: "P" });
    orch.remove("t");
    expect(orch.getProgress("t")).toBeUndefined();
  });

  it("reset() clears all items", () => {
    orch.startProgress("a", { phase: "A" });
    orch.startProgress("b", { phase: "B" });
    orch.reset();
    expect(orch.getAllProgress()).toHaveLength(0);
  });

  it("renderOne returns non-empty string for running task", () => {
    orch.startProgress("t", { phase: "Building", initialProgress: 30 });
    const rendered = orch.renderOne("t");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered).toContain("Building");
  });

  it("renderAll returns multi-line string", () => {
    orch.startProgress("a", { phase: "A" });
    orch.startProgress("b", { phase: "B" });
    orch.completeProgress("a");
    const rendered = orch.renderAll();
    expect(rendered).toContain("A");
    expect(rendered).toContain("B");
    expect(rendered).toContain("Progress:");
  });
});

describe("startProgress() / updateProgress() convenience fns", () => {
  beforeEach(() => {
    resetProgressOrchestrator();
  });

  it("startProgress creates state in shared orchestrator", () => {
    const state = startProgress("shared-1", { phase: "Init" });
    expect(state.id).toBe("shared-1");
    expect(state.status).toBe("running");
  });

  it("updateProgress patches state in shared orchestrator", () => {
    startProgress("shared-2", { phase: "Go" });
    const updated = updateProgress("shared-2", { progress: 75 });
    expect(updated.progress).toBe(75);
  });
});
