// ============================================================================
// packages/cli/src/__tests__/approval-workflow-wiring.test.ts
//
// Sprint 13 — Dim 13: ApprovalWorkflow wiring tests.
// Verifies classifyRisk, UndoStack, and buildApprovalRequest from @dantecode/core
// are wired into the agent loop and function correctly.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  classifyRisk,
  UndoStack,
  buildApprovalRequest,
  canAutoApprove,
  formatApprovalPrompt,
} from "@dantecode/core";
import { globalUndoStack } from "../agent-loop.js";

describe("classifyRisk — risk classifier (Sprint 13)", () => {

  it("classifies 'git reset --hard' as destructive", () => {
    expect(classifyRisk("shell-command", "git reset --hard HEAD")).toBe("destructive");
  });

  it("classifies 'rm -rf' as destructive", () => {
    expect(classifyRisk("shell-command", "rm -rf node_modules")).toBe("destructive");
  });

  it("classifies 'git push' as dangerous", () => {
    expect(classifyRisk("shell-command", "git push origin main")).toBe("dangerous");
  });

  it("classifies 'npm install' as caution", () => {
    expect(classifyRisk("shell-command", "npm install lodash")).toBe("caution");
  });

  it("classifies file-write as safe", () => {
    expect(classifyRisk("file-write", "anything")).toBe("safe");
  });

  it("classifies file-delete as dangerous", () => {
    expect(classifyRisk("file-delete", "src/old.ts")).toBe("dangerous");
  });

  it("classifies git-reset as destructive", () => {
    expect(classifyRisk("git-reset", "HEAD~1")).toBe("destructive");
  });

});

describe("UndoStack (Sprint 13)", () => {

  it("push returns an undo entry ID", () => {
    const stack = new UndoStack();
    const id = stack.push("Write", "Write src/foo.ts", async () => {});
    expect(typeof id).toBe("string");
    expect(id).toMatch(/^undo-/);
  });

  it("undoLast calls the undo function", async () => {
    const stack = new UndoStack();
    let undone = false;
    stack.push("op1", "test op", async () => { undone = true; });
    await stack.undoLast();
    expect(undone).toBe(true);
  });

  it("getAvailable returns unconsumed entries", () => {
    const stack = new UndoStack();
    stack.push("a", "op a", () => {});
    stack.push("b", "op b", () => {});
    expect(stack.getAvailable()).toHaveLength(2);
  });

});

describe("globalUndoStack — wired in agent-loop (Sprint 13)", () => {

  it("globalUndoStack is an instance of UndoStack", () => {
    expect(globalUndoStack).toBeInstanceOf(UndoStack);
  });

});

describe("buildApprovalRequest + canAutoApprove (Sprint 13)", () => {

  it("auto-approves safe operations", () => {
    const req = buildApprovalRequest("file-write", "write file", "const x = 1;");
    expect(canAutoApprove(req, "safe")).toBe(true);
  });

  it("does not auto-approve dangerous operations with safe threshold", () => {
    const req = buildApprovalRequest("file-delete", "delete file", "src/critical.ts");
    expect(canAutoApprove(req, "safe")).toBe(false);
  });

  it("formatApprovalPrompt includes risk level", () => {
    const req = buildApprovalRequest("shell-command", "run command", "git push origin main");
    const prompt = formatApprovalPrompt(req);
    expect(prompt).toContain("## Approval Required");
    expect(prompt).toContain("DANGEROUS");
  });

});
