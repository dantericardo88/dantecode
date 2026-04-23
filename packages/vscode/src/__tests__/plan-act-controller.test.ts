// ============================================================================
// Sprint B — Dim 16: PlanActController tests
// Proves: plan editing step, per-step rollback, step parsing
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock vscode before importing the module under test
vi.mock("vscode", () => ({
  workspace: {
    openTextDocument: vi.fn().mockResolvedValue({
      getText: vi.fn().mockReturnValue("edited plan text"),
    }),
    fs: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      delete: vi.fn(),
    },
  },
  window: {
    showTextDocument: vi.fn().mockResolvedValue(undefined),
    showInformationMessage: vi.fn().mockResolvedValue("Confirm"),
  },
  ViewColumn: { Beside: 2 },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p, toString: () => p })),
  },
}));

import { PlanActController, parsePlanSteps } from "../plan-act-controller.js";
import type { PlanStep } from "../plan-act-controller.js";

// ── Mock workspace FS ─────────────────────────────────────────────────────────

function makeMockFs() {
  const encoder = new TextEncoder();
  return {
    readFile: vi.fn().mockResolvedValue(encoder.encode("original content")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PlanActController.editAndConfirm", () => {
  it("calls editorFn with the plan and returns its result", async () => {
    const ctrl = new PlanActController();
    const editorFn = vi.fn().mockResolvedValue("user-edited plan");
    const result = await ctrl.editAndConfirm("original plan", editorFn);
    expect(editorFn).toHaveBeenCalledWith("original plan");
    expect(result).toBe("user-edited plan");
  });

  it("returns null when editorFn returns null (cancelled)", async () => {
    const ctrl = new PlanActController();
    const editorFn = vi.fn().mockResolvedValue(null);
    const result = await ctrl.editAndConfirm("some plan", editorFn);
    expect(result).toBeNull();
  });

  it("returns the plan unchanged if editorFn returns it as-is", async () => {
    const ctrl = new PlanActController();
    const editorFn = vi.fn().mockImplementation(async (p: string) => p);
    const result = await ctrl.editAndConfirm("exact plan", editorFn);
    expect(result).toBe("exact plan");
  });
});

describe("PlanActController.executeStep", () => {
  let ctrl: PlanActController;
  let mockFs: ReturnType<typeof makeMockFs>;

  beforeEach(() => {
    mockFs = makeMockFs();
    ctrl = new PlanActController({ workspaceFs: mockFs });
  });

  it("returns succeeded:true when fn resolves", async () => {
    const step: PlanStep = { id: "s1", description: "Install deps" };
    const result = await ctrl.executeStep(step, async () => {});
    expect(result.succeeded).toBe(true);
    expect(result.stepId).toBe("s1");
  });

  it("returns succeeded:false with error when fn throws", async () => {
    const step: PlanStep = { id: "s2", description: "Run tests" };
    const result = await ctrl.executeStep(step, async () => {
      throw new Error("test failed");
    });
    expect(result.succeeded).toBe(false);
    expect(result.error).toContain("test failed");
  });

  it("takes snapshot when targetFile is provided", async () => {
    const step: PlanStep = { id: "s3", description: "Edit file", targetFile: "/proj/src/app.ts" };
    const result = await ctrl.executeStep(step, async () => {});
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot!.filePath).toBe("/proj/src/app.ts");
    expect(result.snapshot!.existed).toBe(true);
    expect(mockFs.readFile).toHaveBeenCalled();
  });

  it("snapshot.existed is false when file does not exist", async () => {
    mockFs.readFile.mockRejectedValueOnce(new Error("ENOENT"));
    const step: PlanStep = { id: "s4", description: "Create file", targetFile: "/proj/new.ts" };
    const result = await ctrl.executeStep(step, async () => {});
    expect(result.snapshot!.existed).toBe(false);
    expect(result.snapshot!.content).toBe("");
  });

  it("no snapshot taken when targetFile is absent", async () => {
    const step: PlanStep = { id: "s5", description: "No file" };
    const result = await ctrl.executeStep(step, async () => {});
    expect(result.snapshot).toBeUndefined();
    expect(mockFs.readFile).not.toHaveBeenCalled();
  });
});

describe("PlanActController.rollbackStep", () => {
  let ctrl: PlanActController;
  let mockFs: ReturnType<typeof makeMockFs>;

  beforeEach(() => {
    mockFs = makeMockFs();
    ctrl = new PlanActController({ workspaceFs: mockFs });
  });

  it("restores original content when file existed", async () => {
    const step: PlanStep = { id: "r1", description: "Edit", targetFile: "/proj/src/x.ts" };
    const result = await ctrl.executeStep(step, async () => {});
    await ctrl.rollbackStep(result);
    expect(mockFs.writeFile).toHaveBeenCalled();
  });

  it("deletes file when it did not exist before step", async () => {
    mockFs.readFile.mockRejectedValueOnce(new Error("ENOENT"));
    const step: PlanStep = { id: "r2", description: "Create", targetFile: "/proj/new.ts" };
    const result = await ctrl.executeStep(step, async () => {});
    await ctrl.rollbackStep(result);
    expect(mockFs.delete).toHaveBeenCalled();
  });

  it("is a no-op when result has no snapshot", async () => {
    const result = { stepId: "r3", succeeded: false };
    await ctrl.rollbackStep(result);
    expect(mockFs.writeFile).not.toHaveBeenCalled();
    expect(mockFs.delete).not.toHaveBeenCalled();
  });
});

describe("parsePlanSteps", () => {
  it("parses numbered list items", () => {
    const plan = "1. Install dependencies\n2. Run tests\n3. Deploy";
    const steps = parsePlanSteps(plan);
    expect(steps).toHaveLength(3);
    expect(steps[0]!.description).toBe("Install dependencies");
    expect(steps[2]!.description).toBe("Deploy");
  });

  it("parses markdown headings (## and ###)", () => {
    const plan = "## Setup\n\nSome text\n\n### Configure";
    const steps = parsePlanSteps(plan);
    expect(steps.some((s) => s.description === "Setup")).toBe(true);
    expect(steps.some((s) => s.description === "Configure")).toBe(true);
  });

  it("assigns unique incremental IDs", () => {
    const plan = "1. Step A\n2. Step B";
    const steps = parsePlanSteps(plan);
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns empty array for empty input", () => {
    expect(parsePlanSteps("")).toHaveLength(0);
    expect(parsePlanSteps("   \n\n  ")).toHaveLength(0);
  });
});
