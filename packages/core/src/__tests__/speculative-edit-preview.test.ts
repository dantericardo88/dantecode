// packages/core/src/__tests__/speculative-edit-preview.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  buildEditHunk,
  parseUnifiedDiffToHunks,
  scoreHunkConfidence,
  generatePreview,
  detectEditConflicts,
  describeHunk,
  formatPreviewForPrompt,
  SpeculativeEditManager,
  type EditHunk,
  type SpeculativeEditSession,
} from "../speculative-edit-preview.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(
  overrides: Partial<SpeculativeEditSession> = {},
  hunks: EditHunk[] = [],
): SpeculativeEditSession {
  return {
    id: "session-test",
    filePath: "src/foo.ts",
    originalContent: "line1\nline2\nline3\nline4\nline5",
    hunks,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
    ...overrides,
  };
}

// ─── buildEditHunk ────────────────────────────────────────────────────────────

describe("buildEditHunk", () => {
  it("creates hunk with correct fields", () => {
    const hunk = buildEditHunk(["old line"], ["new line"], 5);
    expect(hunk.originalLines).toEqual(["old line"]);
    expect(hunk.proposedLines).toEqual(["new line"]);
    expect(hunk.startLine).toBe(5);
    expect(hunk.endLine).toBe(5);
    expect(hunk.status).toBe("pending");
  });

  it("computes endLine correctly for multi-line original", () => {
    const hunk = buildEditHunk(["a", "b", "c"], ["x"], 3);
    expect(hunk.endLine).toBe(5); // 3 + 3 - 1 = 5
  });

  it("applies default confidence 0.8", () => {
    const hunk = buildEditHunk(["x"], ["y"], 1);
    expect(hunk.confidence).toBe(0.8);
  });

  it("accepts custom confidence and rationale", () => {
    const hunk = buildEditHunk(["x"], ["y"], 1, { confidence: 0.5, rationale: "risky" });
    expect(hunk.confidence).toBe(0.5);
    expect(hunk.rationale).toBe("risky");
  });

  it("generates unique IDs", () => {
    const a = buildEditHunk([], [], 1);
    const b = buildEditHunk([], [], 1);
    expect(a.id).not.toBe(b.id);
  });
});

// ─── parseUnifiedDiffToHunks ──────────────────────────────────────────────────

describe("parseUnifiedDiffToHunks", () => {
  const SIMPLE_DIFF = [
    "@@ -1,2 +1,2 @@",
    "-old line 1",
    "-old line 2",
    "+new line 1",
    "+new line 2",
  ].join("\n");

  it("parses a simple unified diff", () => {
    const hunks = parseUnifiedDiffToHunks(SIMPLE_DIFF);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.originalLines).toEqual(["old line 1", "old line 2"]);
    expect(hunks[0]!.proposedLines).toEqual(["new line 1", "new line 2"]);
  });

  it("sets startLine from @@ header", () => {
    const hunks = parseUnifiedDiffToHunks(SIMPLE_DIFF);
    expect(hunks[0]!.startLine).toBe(1);
  });

  it("parses multiple hunks", () => {
    const diff = [
      "@@ -1,1 +1,1 @@",
      "-a",
      "+b",
      "@@ -10,1 +10,1 @@",
      "-x",
      "+y",
    ].join("\n");
    const hunks = parseUnifiedDiffToHunks(diff);
    expect(hunks).toHaveLength(2);
    expect(hunks[1]!.startLine).toBe(10);
  });

  it("applies baseConfidence to all hunks", () => {
    const hunks = parseUnifiedDiffToHunks(SIMPLE_DIFF, 0.65);
    expect(hunks[0]!.confidence).toBe(0.65);
  });

  it("handles context lines (no prefix)", () => {
    const diff = ["@@ -1,3 +1,3 @@", " context", "-old", "+new"].join("\n");
    const hunks = parseUnifiedDiffToHunks(diff);
    expect(hunks[0]!.originalLines).toContain("context");
    expect(hunks[0]!.originalLines).toContain("old");
  });

  it("returns empty array for non-diff input", () => {
    expect(parseUnifiedDiffToHunks("not a diff")).toEqual([]);
  });
});

// ─── scoreHunkConfidence ──────────────────────────────────────────────────────

describe("scoreHunkConfidence", () => {
  it("gives high score for small hunks (≤4 total lines)", () => {
    const hunk = buildEditHunk(["a"], ["b"], 1, { confidence: 0.8 });
    const score = scoreHunkConfidence(hunk);
    expect(score).toBeGreaterThan(0.8);
  });

  it("penalizes large hunks (>30 total lines)", () => {
    const orig = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const prop = Array.from({ length: 15 }, (_, i) => `new ${i}`);
    const hunk = buildEditHunk(orig, prop, 1, { confidence: 0.8 });
    const score = scoreHunkConfidence(hunk);
    expect(score).toBeLessThan(0.8);
  });

  it("boosts pure additions (no deletions)", () => {
    const hunk = buildEditHunk([], ["new1", "new2"], 5);
    const score = scoreHunkConfidence(hunk);
    expect(score).toBeGreaterThan(0.8);
  });

  it("penalizes blank-only original lines", () => {
    // Use 5 blank lines so totalLines > 4 — avoids the +0.15 small-hunk boost
    const hunk = buildEditHunk(["  ", "", "  ", "", "  "], ["something", "else"], 1);
    const score = scoreHunkConfidence(hunk);
    expect(score).toBeLessThan(0.8);
  });

  it("returns value in [0, 1] range", () => {
    const hunk = buildEditHunk(["x".repeat(10)], ["y".repeat(10)], 1);
    const score = scoreHunkConfidence(hunk);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─── generatePreview ─────────────────────────────────────────────────────────

describe("generatePreview", () => {
  it("applies pending hunk to content", () => {
    const hunk = buildEditHunk(["line2"], ["REPLACED"], 2);
    const session = makeSession({}, [hunk]);
    session.originalContent = "line1\nline2\nline3";
    const preview = generatePreview(session);
    expect(preview.previewContent).toContain("REPLACED");
    expect(preview.previewContent).not.toContain("line2");
  });

  it("skips rejected hunks", () => {
    const hunk = buildEditHunk(["line2"], ["REPLACED"], 2);
    hunk.status = "rejected";
    const session = makeSession({ originalContent: "line1\nline2\nline3" }, [hunk]);
    const preview = generatePreview(session);
    expect(preview.previewContent).toContain("line2");
    expect(preview.rejectedHunks).toBe(1);
  });

  it("uses modifiedLines when status is modified", () => {
    const hunk = buildEditHunk(["line2"], ["PROPOSED"], 2);
    hunk.status = "modified";
    hunk.modifiedLines = ["USER_EDITED"];
    const session = makeSession({ originalContent: "line1\nline2\nline3" }, [hunk]);
    const preview = generatePreview(session);
    expect(preview.previewContent).toContain("USER_EDITED");
  });

  it("counts lines added and deleted", () => {
    const hunk = buildEditHunk(["line2"], ["a", "b", "c"], 2);
    hunk.status = "accepted";
    const session = makeSession({ originalContent: "line1\nline2\nline3" }, [hunk]);
    const preview = generatePreview(session);
    expect(preview.linesAdded).toBe(2); // 3 new - 1 old
    expect(preview.linesDeleted).toBe(0);
  });

  it("reports conflict as none when no conflict", () => {
    const session = makeSession({}, []);
    const preview = generatePreview(session);
    expect(preview.conflict).toBe("none");
  });

  it("counts pending, accepted, rejected hunks correctly", () => {
    const h1 = buildEditHunk(["line1"], ["X"], 1);
    h1.status = "pending";
    const h2 = buildEditHunk(["line2"], ["Y"], 2);
    h2.status = "accepted";
    const h3 = buildEditHunk(["line3"], ["Z"], 3);
    h3.status = "rejected";
    const session = makeSession({ originalContent: "line1\nline2\nline3" }, [h1, h2, h3]);
    const preview = generatePreview(session);
    expect(preview.pendingHunks).toBe(1);
    expect(preview.acceptedHunks).toBe(1);
    expect(preview.rejectedHunks).toBe(1);
  });
});

// ─── detectEditConflicts ──────────────────────────────────────────────────────

describe("detectEditConflicts", () => {
  it("returns none when content unchanged", () => {
    const session = makeSession({ originalContent: "same content" });
    expect(detectEditConflicts(session, "same content")).toBe("none");
  });

  it("returns stale-content for different line count", () => {
    const session = makeSession({ originalContent: "a\nb\nc" });
    expect(detectEditConflicts(session, "a\nb")).toBe("stale-content");
  });

  it("returns merge-conflict for many changed lines", () => {
    const session = makeSession({ originalContent: "a\nb\nc\nd\ne" });
    const current = "X\nY\nZ\nW\nV"; // 5 lines, all different
    expect(detectEditConflicts(session, current)).toBe("merge-conflict");
  });

  it("returns stale-content for 1-3 changed lines", () => {
    const session = makeSession({ originalContent: "a\nb\nc\nd\ne" });
    const current = "X\nb\nc\nd\ne"; // 1 line changed
    expect(detectEditConflicts(session, current)).toBe("stale-content");
  });
});

// ─── describeHunk ─────────────────────────────────────────────────────────────

describe("describeHunk", () => {
  it("returns rationale if present", () => {
    const hunk = buildEditHunk(["x"], ["y"], 1, { rationale: "Fix bug" });
    expect(describeHunk(hunk)).toBe("Fix bug");
  });

  it("describes pure addition", () => {
    const hunk = buildEditHunk([], ["new1", "new2"], 5);
    const desc = describeHunk(hunk);
    expect(desc).toContain("Add");
    expect(desc).toContain("5");
  });

  it("describes pure deletion", () => {
    const hunk = buildEditHunk(["a", "b"], [], 3);
    const desc = describeHunk(hunk);
    expect(desc).toContain("Delete");
    expect(desc).toContain("3");
  });

  it("describes single-line modification", () => {
    const hunk = buildEditHunk(["old"], ["new"], 7);
    expect(describeHunk(hunk)).toContain("Modify line 7");
  });

  it("describes equal-count replacement", () => {
    const hunk = buildEditHunk(["a", "b"], ["x", "y"], 10);
    const desc = describeHunk(hunk);
    expect(desc).toContain("Replace");
  });

  it("describes different-count rewrite", () => {
    const hunk = buildEditHunk(["a", "b", "c"], ["x", "y"], 1);
    const desc = describeHunk(hunk);
    expect(desc).toContain("Rewrite");
  });
});

// ─── formatPreviewForPrompt ───────────────────────────────────────────────────

describe("formatPreviewForPrompt", () => {
  it("includes file path in output", () => {
    const session = makeSession({ filePath: "src/my-file.ts" });
    const preview = generatePreview(session);
    const output = formatPreviewForPrompt(session, preview);
    expect(output).toContain("src/my-file.ts");
  });

  it("includes hunk status icons", () => {
    const hunk = buildEditHunk(["line1"], ["new1"], 1);
    hunk.status = "accepted";
    const session = makeSession({ originalContent: "line1" }, [hunk]);
    const preview = generatePreview(session);
    const output = formatPreviewForPrompt(session, preview);
    expect(output).toContain("✅");
  });

  it("includes conflict warning when conflict exists", () => {
    const session = makeSession({ originalContent: "line1\nline2" });
    const preview = { ...generatePreview(session), conflict: "merge-conflict" as const };
    const output = formatPreviewForPrompt(session, preview);
    expect(output).toContain("merge-conflict");
  });

  it("includes line change summary", () => {
    const hunk = buildEditHunk(["line1"], ["a", "b", "c"], 1);
    hunk.status = "accepted";
    const session = makeSession({ originalContent: "line1" }, [hunk]);
    const preview = generatePreview(session);
    const output = formatPreviewForPrompt(session, preview);
    expect(output).toContain("+");
    expect(output).toContain("-");
  });
});

// ─── SpeculativeEditManager ───────────────────────────────────────────────────

describe("SpeculativeEditManager", () => {
  let mgr: SpeculativeEditManager;

  beforeEach(() => { mgr = new SpeculativeEditManager(); });

  it("createSession returns active session", () => {
    const hunk = buildEditHunk(["old"], ["new"], 1);
    const session = mgr.createSession("src/a.ts", "old content", [hunk]);
    expect(session.status).toBe("active");
    expect(session.filePath).toBe("src/a.ts");
  });

  it("acceptHunk changes hunk status to accepted", () => {
    const hunk = buildEditHunk(["x"], ["y"], 1);
    const session = mgr.createSession("f.ts", "x", [hunk]);
    mgr.acceptHunk(session.id, hunk.id);
    expect(mgr.getSession(session.id)!.hunks[0]!.status).toBe("accepted");
  });

  it("rejectHunk changes hunk status to rejected", () => {
    const hunk = buildEditHunk(["x"], ["y"], 1);
    const session = mgr.createSession("f.ts", "x", [hunk]);
    mgr.rejectHunk(session.id, hunk.id);
    expect(mgr.getSession(session.id)!.hunks[0]!.status).toBe("rejected");
  });

  it("modifyHunk sets modified status and modifiedLines", () => {
    const hunk = buildEditHunk(["x"], ["y"], 1);
    const session = mgr.createSession("f.ts", "x", [hunk]);
    mgr.modifyHunk(session.id, hunk.id, ["custom"]);
    const updated = mgr.getSession(session.id)!.hunks[0]!;
    expect(updated.status).toBe("modified");
    expect(updated.modifiedLines).toEqual(["custom"]);
  });

  it("acceptAll returns count of hunks accepted", () => {
    const h1 = buildEditHunk(["a"], ["b"], 1);
    const h2 = buildEditHunk(["c"], ["d"], 2);
    const session = mgr.createSession("f.ts", "a\nc", [h1, h2]);
    const count = mgr.acceptAll(session.id);
    expect(count).toBe(2);
  });

  it("rejectAll returns count of hunks rejected", () => {
    const h1 = buildEditHunk(["a"], ["b"], 1);
    const h2 = buildEditHunk(["c"], ["d"], 2);
    const session = mgr.createSession("f.ts", "a\nc", [h1, h2]);
    const count = mgr.rejectAll(session.id);
    expect(count).toBe(2);
  });

  it("undoLast restores previous hunk status", () => {
    const hunk = buildEditHunk(["x"], ["y"], 1);
    const session = mgr.createSession("f.ts", "x", [hunk]);
    mgr.acceptHunk(session.id, hunk.id);
    mgr.undoLast(session.id);
    expect(mgr.getSession(session.id)!.hunks[0]!.status).toBe("pending");
  });

  it("commit returns final content and marks session committed", () => {
    const hunk = buildEditHunk(["old"], ["new"], 1);
    hunk.status = "accepted";
    const session = mgr.createSession("f.ts", "old", [hunk]);
    const content = mgr.commit(session.id);
    expect(content).toBe("new");
    expect(mgr.getSession(session.id)!.status).toBe("committed");
  });

  it("abandon marks session abandoned", () => {
    const session = mgr.createSession("f.ts", "content", []);
    mgr.abandon(session.id);
    expect(mgr.getSession(session.id)!.status).toBe("abandoned");
  });

  it("getPreview returns EditPreviewResult", () => {
    const session = mgr.createSession("f.ts", "content", []);
    const preview = mgr.getPreview(session.id);
    expect(preview).toBeDefined();
    expect(preview!.conflict).toBe("none");
  });

  it("activeSessions excludes committed and abandoned", () => {
    mgr.createSession("a.ts", "a", []);
    const b = mgr.createSession("b.ts", "b", []);
    const c = mgr.createSession("c.ts", "c", []);
    mgr.commit(b.id);
    mgr.abandon(c.id);
    expect(mgr.activeSessions).toHaveLength(1);
  });

  it("totalSessions tracks all sessions regardless of status", () => {
    mgr.createSession("a.ts", "a", []);
    mgr.createSession("b.ts", "b", []);
    expect(mgr.totalSessions).toBe(2);
  });

  it("getChain returns chain entries after actions", () => {
    const hunk = buildEditHunk(["x"], ["y"], 1);
    const session = mgr.createSession("f.ts", "x", [hunk]);
    mgr.acceptHunk(session.id, hunk.id);
    mgr.rejectHunk(session.id, hunk.id);
    const chain = mgr.getChain(session.id);
    expect(chain).toHaveLength(2);
    expect(chain[0]!.action).toBe("accept");
    expect(chain[1]!.action).toBe("reject");
  });

  it("createSession rescores hunk confidence", () => {
    // Small hunk should be boosted above the base 0.8 passed in
    const hunk = buildEditHunk(["x"], ["y"], 1, { confidence: 0.5 });
    const session = mgr.createSession("f.ts", "x", [hunk]);
    // The manager re-scores on create using scoreHunkConfidence
    expect(session.hunks[0]!.confidence).not.toBe(0.5);
  });
});
