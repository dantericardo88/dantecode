// packages/core/src/__tests__/approval-workflow.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  classifyRisk,
  isOperationReversible,
  buildApprovalRequest,
  formatApprovalPrompt,
  canAutoApprove,
  partitionForAutoApproval,
  UndoStack,
  ApprovalWorkflow,
  type ApprovalRequest,
} from "../approval-workflow.js";

// ─── classifyRisk ─────────────────────────────────────────────────────────────

describe("classifyRisk", () => {
  it("classifies file-write as safe", () => {
    expect(classifyRisk("file-write", "some content")).toBe("safe");
  });

  it("classifies file-delete as dangerous", () => {
    expect(classifyRisk("file-delete", "src/index.ts")).toBe("dangerous");
  });

  it("classifies git-reset as destructive", () => {
    expect(classifyRisk("git-reset", "--hard HEAD")).toBe("destructive");
  });

  it("classifies git-push as dangerous", () => {
    expect(classifyRisk("git-push", "origin main")).toBe("dangerous");
  });

  it("classifies shell rm -rf as destructive", () => {
    expect(classifyRisk("shell-command", "rm -rf node_modules")).toBe("destructive");
  });

  it("classifies shell git push --force as destructive", () => {
    expect(classifyRisk("shell-command", "git push --force origin main")).toBe("destructive");
  });

  it("classifies npm install as caution", () => {
    expect(classifyRisk("shell-command", "npm install lodash")).toBe("caution");
  });

  it("classifies git commit as caution", () => {
    expect(classifyRisk("git-commit", "feat: add feature")).toBe("caution");
  });

  it("classifies network-request as caution", () => {
    expect(classifyRisk("network-request", "https://api.example.com")).toBe("caution");
  });

  it("classifies git branch-delete as dangerous", () => {
    expect(classifyRisk("git-branch-delete", "feat/old")).toBe("dangerous");
  });
});

// ─── isOperationReversible ────────────────────────────────────────────────────

describe("isOperationReversible", () => {
  it("file-write is reversible", () => {
    expect(isOperationReversible("file-write")).toBe(true);
  });

  it("file-delete is NOT reversible", () => {
    expect(isOperationReversible("file-delete")).toBe(false);
  });

  it("git-push is NOT reversible", () => {
    expect(isOperationReversible("git-push")).toBe(false);
  });

  it("git-commit is reversible", () => {
    expect(isOperationReversible("git-commit")).toBe(true);
  });
});

// ─── buildApprovalRequest ─────────────────────────────────────────────────────

describe("buildApprovalRequest", () => {
  it("auto-classifies risk", () => {
    const req = buildApprovalRequest("file-delete", "Delete file", "src/index.ts");
    expect(req.riskLevel).toBe("dangerous");
  });

  it("auto-classifies reversibility", () => {
    const req = buildApprovalRequest("file-write", "Write file", "content");
    expect(req.isReversible).toBe(true);

    const req2 = buildApprovalRequest("file-delete", "Delete file", "src/x.ts");
    expect(req2.isReversible).toBe(false);
  });

  it("generates unique IDs", () => {
    const r1 = buildApprovalRequest("file-write", "a", "a");
    const r2 = buildApprovalRequest("file-write", "b", "b");
    expect(r1.id).not.toBe(r2.id);
  });

  it("sets expiresAt in the future by default", () => {
    const req = buildApprovalRequest("file-write", "desc", "payload");
    expect(req.expiresAt).toBeGreaterThan(Date.now());
  });

  it("uses requestExpiryMs option", () => {
    const req = buildApprovalRequest("file-write", "d", "p", {}, { requestExpiryMs: 1000 });
    expect(req.expiresAt).toBeLessThanOrEqual(Date.now() + 1100);
  });
});

// ─── formatApprovalPrompt ─────────────────────────────────────────────────────

describe("formatApprovalPrompt", () => {
  function makeReq(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
    return buildApprovalRequest("shell-command", "Run tests", "npm test", overrides as any);
  }

  it("includes '## Approval Required' header", () => {
    expect(formatApprovalPrompt(makeReq())).toContain("## Approval Required");
  });

  it("includes the description", () => {
    expect(formatApprovalPrompt(makeReq())).toContain("Run tests");
  });

  it("includes risk badge", () => {
    const req = makeReq();
    const result = formatApprovalPrompt(req);
    expect(result).toMatch(/SAFE|CAUTION|DANGEROUS|DESTRUCTIVE/);
  });

  it("includes reversibility", () => {
    expect(formatApprovalPrompt(makeReq())).toContain("Reversible");
  });

  it("includes diff preview when present", () => {
    const req = buildApprovalRequest("file-write", "Write", "content", { diffPreview: "+new line" });
    expect(formatApprovalPrompt(req)).toContain("+new line");
    expect(formatApprovalPrompt(req)).toContain("```diff");
  });

  it("includes file paths when present", () => {
    const req = buildApprovalRequest("file-write", "Write", "content", { filePaths: ["src/index.ts"] });
    expect(formatApprovalPrompt(req)).toContain("src/index.ts");
  });

  it("includes the payload command", () => {
    expect(formatApprovalPrompt(makeReq())).toContain("npm test");
  });
});

// ─── canAutoApprove ───────────────────────────────────────────────────────────

describe("canAutoApprove", () => {
  it("auto-approves safe operations under default threshold", () => {
    const req = buildApprovalRequest("file-write", "Write", "content");
    expect(canAutoApprove(req, "safe")).toBe(true);
  });

  it("does NOT auto-approve dangerous operations under safe threshold", () => {
    const req = buildApprovalRequest("file-delete", "Delete", "file");
    expect(canAutoApprove(req, "safe")).toBe(false);
  });

  it("auto-approves caution under caution threshold", () => {
    const req = buildApprovalRequest("git-commit", "Commit", "message");
    expect(canAutoApprove(req, "caution")).toBe(true);
  });

  it("does NOT auto-approve expired requests", () => {
    const req = buildApprovalRequest("file-write", "Write", "content", { expiresAt: Date.now() - 1 });
    expect(canAutoApprove(req, "safe")).toBe(false);
  });
});

// ─── partitionForAutoApproval ─────────────────────────────────────────────────

describe("partitionForAutoApproval", () => {
  it("separates auto-approved from needs-review", () => {
    const requests = [
      buildApprovalRequest("file-write", "Write", "content"),
      buildApprovalRequest("file-delete", "Delete", "file"),
    ];
    const { autoApproved, needsReview } = partitionForAutoApproval(requests, "safe");
    expect(autoApproved.length).toBe(1);
    expect(needsReview.length).toBe(1);
    expect(autoApproved[0]!.operationType).toBe("file-write");
    expect(needsReview[0]!.operationType).toBe("file-delete");
  });
});

// ─── UndoStack ────────────────────────────────────────────────────────────────

describe("UndoStack", () => {
  it("pushes and tracks depth", () => {
    const stack = new UndoStack();
    stack.push("op1", "Write file", async () => {});
    stack.push("op2", "Delete file", async () => {});
    expect(stack.depth).toBe(2);
  });

  it("undoLast calls the most recent undo fn", async () => {
    const stack = new UndoStack();
    const fn = vi.fn();
    stack.push("op1", "desc", fn);
    await stack.undoLast();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("marks entry as consumed after undo", async () => {
    const stack = new UndoStack();
    stack.push("op1", "desc", async () => {});
    await stack.undoLast();
    expect(stack.depth).toBe(0);
  });

  it("undoById targets specific entry", async () => {
    const stack = new UndoStack();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const id1 = stack.push("op1", "desc1", fn1);
    stack.push("op2", "desc2", fn2);
    await stack.undoById(id1);
    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).not.toHaveBeenCalled();
  });

  it("evicts oldest when maxDepth exceeded", () => {
    const stack = new UndoStack(3);
    for (let i = 0; i < 5; i++) stack.push(`op${i}`, `desc${i}`, async () => {});
    expect(stack.depth).toBe(3);
  });

  it("getAvailable returns unconsumed entries", async () => {
    const stack = new UndoStack();
    stack.push("op1", "d1", async () => {});
    stack.push("op2", "d2", async () => {});
    await stack.undoLast();
    expect(stack.getAvailable().length).toBe(1);
  });

  it("clear removes all entries", () => {
    const stack = new UndoStack();
    stack.push("op1", "d", async () => {});
    stack.clear();
    expect(stack.depth).toBe(0);
  });
});

// ─── ApprovalWorkflow ─────────────────────────────────────────────────────────

describe("ApprovalWorkflow", () => {
  it("auto-approves safe operations", () => {
    const wf = new ApprovalWorkflow({ autoApproveUpTo: "safe" });
    const { response } = wf.submit("file-write", "Write", "content");
    expect(response?.status).toBe("auto-approved");
    expect(wf.pendingCount).toBe(0);
  });

  it("holds dangerous operations for review", () => {
    const wf = new ApprovalWorkflow({ autoApproveUpTo: "safe" });
    const { response } = wf.submit("file-delete", "Delete", "file");
    expect(response).toBeNull();
    expect(wf.pendingCount).toBe(1);
  });

  it("decide approves pending request", () => {
    const wf = new ApprovalWorkflow({ autoApproveUpTo: "safe" });
    const { request } = wf.submit("file-delete", "Delete", "file");
    const resp = wf.decide(request.id, true, "looks good");
    expect(resp?.status).toBe("approved");
    expect(resp?.note).toBe("looks good");
    expect(wf.pendingCount).toBe(0);
  });

  it("decide rejects pending request", () => {
    const wf = new ApprovalWorkflow({ autoApproveUpTo: "safe" });
    const { request } = wf.submit("file-delete", "Delete", "file");
    const resp = wf.decide(request.id, false);
    expect(resp?.status).toBe("rejected");
  });

  it("getPrompt returns formatted prompt", () => {
    const wf = new ApprovalWorkflow({ autoApproveUpTo: "safe" });
    const { request } = wf.submit("file-delete", "Delete dangerous file", "file");
    const prompt = wf.getPrompt(request.id);
    expect(prompt).toContain("## Approval Required");
    expect(prompt).toContain("Delete dangerous file");
  });

  it("registerUndo and undoLast work together", async () => {
    const wf = new ApprovalWorkflow();
    const fn = vi.fn();
    wf.registerUndo("op1", "Write file", fn);
    expect(wf.undoDepth).toBe(1);
    await wf.undoLast();
    expect(fn).toHaveBeenCalledOnce();
    expect(wf.undoDepth).toBe(0);
  });

  it("getPending returns all pending requests", () => {
    const wf = new ApprovalWorkflow({ autoApproveUpTo: "safe" });
    wf.submit("file-delete", "d1", "f1");
    wf.submit("file-delete", "d2", "f2");
    expect(wf.getPending().length).toBe(2);
  });

  it("getResponse returns stored response", () => {
    const wf = new ApprovalWorkflow({ autoApproveUpTo: "safe" });
    const { request } = wf.submit("file-write", "Write", "content");
    const resp = wf.getResponse(request.id);
    expect(resp?.status).toBe("auto-approved");
  });

  it("isExpired returns true for past expiry", () => {
    const wf = new ApprovalWorkflow({ autoApproveUpTo: "safe" });
    const { request } = wf.submit("file-delete", "Delete", "file", { expiresAt: Date.now() - 1 });
    expect(wf.isExpired(request.id)).toBe(true);
  });
});
