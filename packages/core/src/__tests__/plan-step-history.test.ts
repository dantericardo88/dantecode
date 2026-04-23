// packages/core/src/__tests__/plan-step-history.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  buildStep,
  buildArtifact,
  diffSteps,
  validateStepSequence,
  PlanStepHistory,
  type PlanStep,
} from "../plan-step-history.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStep(description = "Run task", action: PlanStep["action"] = "shell"): PlanStep {
  return buildStep(description, action, { command: "echo done" });
}

// ─── buildStep ────────────────────────────────────────────────────────────────

describe("buildStep", () => {
  it("creates step with pending status", () => {
    const step = makeStep();
    expect(step.status).toBe("pending");
  });

  it("creates unique IDs", () => {
    const a = makeStep();
    const b = makeStep();
    expect(a.id).not.toBe(b.id);
  });

  it("sets action and description", () => {
    const step = buildStep("Write file", "file-write", { path: "src/a.ts" });
    expect(step.action).toBe("file-write");
    expect(step.description).toBe("Write file");
    expect(step.params["path"]).toBe("src/a.ts");
  });

  it("accepts parentStepId and branchName", () => {
    const step = buildStep("sub-task", "agent-task", {}, { parentStepId: "step-1", branchName: "retry" });
    expect(step.parentStepId).toBe("step-1");
    expect(step.branchName).toBe("retry");
  });
});

// ─── buildArtifact ────────────────────────────────────────────────────────────

describe("buildArtifact", () => {
  it("creates artifact with id and kind", () => {
    const a = buildArtifact("src/out.ts", "file", "content");
    expect(a.id).toBe("src/out.ts");
    expect(a.kind).toBe("file");
  });

  it("computes hash for content", () => {
    const a = buildArtifact("out", "output", "hello");
    expect(a.hash).toBeDefined();
    expect(a.hash!.length).toBeGreaterThan(0);
  });

  it("hash is undefined when no content", () => {
    const a = buildArtifact("log", "log");
    expect(a.hash).toBeUndefined();
  });

  it("same content produces same hash", () => {
    const a1 = buildArtifact("x", "file", "data");
    const a2 = buildArtifact("y", "file", "data");
    expect(a1.hash).toBe(a2.hash);
  });
});

// ─── diffSteps ────────────────────────────────────────────────────────────────

describe("diffSteps", () => {
  it("detects added artifacts", () => {
    const from = makeStep();
    const to = { ...makeStep(), artifacts: [buildArtifact("new.ts", "file", "content")] };
    const diff = diffSteps(from, to);
    expect(diff.addedArtifacts).toHaveLength(1);
    expect(diff.removedArtifacts).toHaveLength(0);
  });

  it("detects removed artifacts", () => {
    const from = { ...makeStep(), artifacts: [buildArtifact("old.ts", "file", "content")] };
    const to = makeStep();
    const diff = diffSteps(from, to);
    expect(diff.removedArtifacts).toHaveLength(1);
  });

  it("records status change", () => {
    const from = { ...makeStep(), status: "pending" as const };
    const to = { ...makeStep(), status: "succeeded" as const };
    const diff = diffSteps(from, to);
    expect(diff.statusChange.from).toBe("pending");
    expect(diff.statusChange.to).toBe("succeeded");
  });
});

// ─── validateStepSequence ─────────────────────────────────────────────────────

describe("validateStepSequence", () => {
  it("returns valid for empty sequence", () => {
    const result = validateStepSequence([]);
    expect(result.valid).toBe(true);
    expect(result.stepCount).toBe(0);
  });

  it("returns valid for well-formed steps", () => {
    const steps = [makeStep(), makeStep()];
    expect(validateStepSequence(steps).valid).toBe(true);
  });

  it("errors on missing parentStepId reference", () => {
    const step = buildStep("child", "shell", {}, { parentStepId: "nonexistent-id" });
    const result = validateStepSequence([step]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("parentStepId"))).toBe(true);
  });

  it("errors on duplicate step IDs", () => {
    const step = makeStep();
    const duplicate = { ...step }; // same ID
    const result = validateStepSequence([step, duplicate]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  it("warns on file-write step without path param", () => {
    const step = buildStep("write", "file-write", {}); // no path
    const result = validateStepSequence([step]);
    expect(result.warnings.some((w) => w.includes("path"))).toBe(true);
  });

  it("warns on shell step without command param", () => {
    const step = buildStep("run", "shell", {}); // no command
    const result = validateStepSequence([step]);
    expect(result.warnings.some((w) => w.includes("command"))).toBe(true);
  });
});

// ─── PlanStepHistory ──────────────────────────────────────────────────────────

describe("PlanStepHistory", () => {
  let history: PlanStepHistory;

  beforeEach(() => { history = new PlanStepHistory(); });

  it("addStep and getStep", () => {
    const step = makeStep();
    history.addStep(step);
    expect(history.getStep(step.id)).toBeDefined();
  });

  it("markStarted sets running status and startedAt", () => {
    const step = makeStep();
    history.addStep(step);
    history.markStarted(step.id);
    const updated = history.getStep(step.id)!;
    expect(updated.status).toBe("running");
    expect(updated.startedAt).toBeDefined();
  });

  it("markSucceeded sets succeeded status and artifacts", () => {
    const step = makeStep();
    history.addStep(step);
    const artifact = buildArtifact("out.ts", "file", "code");
    history.markSucceeded(step.id, [artifact]);
    const updated = history.getStep(step.id)!;
    expect(updated.status).toBe("succeeded");
    expect(updated.artifacts).toHaveLength(1);
  });

  it("markFailed sets failed status and errorMessage", () => {
    const step = makeStep();
    history.addStep(step);
    history.markFailed(step.id, "Something went wrong");
    const updated = history.getStep(step.id)!;
    expect(updated.status).toBe("failed");
    expect(updated.errorMessage).toBe("Something went wrong");
  });

  it("markSkipped sets skipped status", () => {
    const step = makeStep();
    history.addStep(step);
    history.markSkipped(step.id);
    expect(history.getStep(step.id)!.status).toBe("skipped");
  });

  it("getStepsByStatus filters correctly", () => {
    const s1 = makeStep("a");
    const s2 = makeStep("b");
    history.addStep(s1);
    history.addStep(s2);
    history.markSucceeded(s1.id);
    expect(history.getStepsByStatus("succeeded")).toHaveLength(1);
    expect(history.getStepsByStatus("pending")).toHaveLength(1);
  });

  // ─── Rollback ───────────────────────────────────────────────────────────

  it("rollbackN marks last N steps as rolled-back", () => {
    for (let i = 0; i < 4; i++) history.addStep(makeStep());
    const count = history.rollbackN(2);
    expect(count).toHaveLength(2);
    expect(history.getStepsByStatus("rolled-back")).toHaveLength(2);
  });

  it("rollbackTo checkpoint rolls back steps after it", () => {
    const s1 = makeStep("s1");
    const s2 = makeStep("s2");
    const s3 = makeStep("s3");
    history.addStep(s1);
    history.markSucceeded(s1.id);
    history.addStep(s2);
    const cp = history.createCheckpoint("after-s1");
    history.addStep(s3);
    history.markSucceeded(s3.id);

    const rolled = history.rollbackTo(cp!.id);
    expect(rolled).toBeGreaterThan(0);
    expect(history.getStep(s3.id)!.status).toBe("rolled-back");
  });

  // ─── Checkpoints ────────────────────────────────────────────────────────

  it("createCheckpoint returns undefined when no steps", () => {
    expect(history.createCheckpoint("empty")).toBeUndefined();
  });

  it("createCheckpoint anchors to last pending/succeeded step", () => {
    const step = makeStep();
    history.addStep(step);
    const cp = history.createCheckpoint("my-cp");
    expect(cp).toBeDefined();
    expect(cp!.stepId).toBe(step.id);
  });

  it("getCheckpoint finds by name", () => {
    const step = makeStep();
    history.addStep(step);
    history.createCheckpoint("named-cp");
    expect(history.getCheckpoint("named-cp")).toBeDefined();
  });

  it("checkpoints returns all created checkpoints", () => {
    history.addStep(makeStep());
    history.createCheckpoint("a");
    history.createCheckpoint("b");
    expect(history.checkpoints).toHaveLength(2);
  });

  // ─── Branching ──────────────────────────────────────────────────────────

  it("forkBranch creates new branch from step", () => {
    const step = makeStep();
    history.addStep(step);
    const ok = history.forkBranch("retry", step.id);
    expect(ok).toBe(true);
    expect(history.branchNames).toContain("retry");
  });

  it("forkBranch returns false for duplicate branch name", () => {
    const step = makeStep();
    history.addStep(step);
    history.forkBranch("retry", step.id);
    expect(history.forkBranch("retry", step.id)).toBe(false);
  });

  it("addStepToBranch tags step with branchName", () => {
    const step = makeStep();
    history.addStep(step);
    history.forkBranch("alt", step.id);
    const branchStep = buildStep("alt action", "shell");
    history.addStepToBranch("alt", branchStep);
    const found = history.getStep(branchStep.id)!;
    expect(found.branchName).toBe("alt");
  });

  it("currentBranch updates after forkBranch", () => {
    const step = makeStep();
    history.addStep(step);
    history.forkBranch("feature", step.id);
    expect(history.currentBranch).toBe("feature");
  });

  // ─── Diff ───────────────────────────────────────────────────────────────

  it("diffBetween returns undefined for unknown stepIds", () => {
    expect(history.diffBetween("x", "y")).toBeUndefined();
  });

  it("diffBetween returns diff for known steps", () => {
    const s1 = makeStep();
    const s2 = makeStep();
    history.addStep(s1);
    history.addStep(s2);
    history.markSucceeded(s2.id, [buildArtifact("out.ts", "file", "code")]);
    const diff = history.diffBetween(s1.id, s2.id);
    expect(diff).toBeDefined();
    expect(diff!.addedArtifacts).toHaveLength(1);
  });

  // ─── Serialization ──────────────────────────────────────────────────────

  it("serialize and deserialize preserves steps", () => {
    const step = makeStep("test task");
    history.addStep(step);
    history.markSucceeded(step.id);
    const json = history.serialize();
    const restored = PlanStepHistory.deserialize(json);
    expect(restored.getStep(step.id)!.status).toBe("succeeded");
  });

  it("serialize and deserialize preserves checkpoints", () => {
    history.addStep(makeStep());
    history.createCheckpoint("saved-cp");
    const json = history.serialize();
    const restored = PlanStepHistory.deserialize(json);
    expect(restored.getCheckpoint("saved-cp")).toBeDefined();
  });

  // ─── Counts and Prompt ──────────────────────────────────────────────────

  it("totalSteps, succeededCount, failedCount, pendingCount are accurate", () => {
    const s1 = makeStep();
    const s2 = makeStep();
    const s3 = makeStep();
    history.addStep(s1);
    history.addStep(s2);
    history.addStep(s3);
    history.markSucceeded(s1.id);
    history.markFailed(s2.id, "err");
    expect(history.totalSteps).toBe(3);
    expect(history.succeededCount).toBe(1);
    expect(history.failedCount).toBe(1);
    expect(history.pendingCount).toBe(1);
  });

  it("formatForPrompt includes step descriptions", () => {
    history.addStep(buildStep("Install deps", "shell", { command: "npm install" }));
    const output = history.formatForPrompt();
    expect(output).toContain("Install deps");
  });

  it("formatForPrompt includes checkpoint names", () => {
    history.addStep(makeStep());
    history.createCheckpoint("pre-deploy");
    const output = history.formatForPrompt();
    expect(output).toContain("pre-deploy");
  });
});
