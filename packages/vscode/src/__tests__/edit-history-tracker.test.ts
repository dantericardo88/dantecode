// ============================================================================
// packages/vscode/src/__tests__/edit-history-tracker.test.ts
// 15 tests for EditHistoryTracker.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vscode mock ───────────────────────────────────────────────────────────────

let changeListener: ((event: unknown) => void) | null = null;

vi.mock("vscode", () => {
  return {
    workspace: {
      onDidChangeTextDocument: vi.fn((listener: (event: unknown) => void) => {
        changeListener = listener;
        return { dispose: vi.fn() };
      }),
    },
  };
});

// Suppress noUnusedLocals on changeListener — it's only assigned by the mock
// and reset in beforeEach; never read directly. Kept for future fire() tests.
void changeListener;

import { EditHistoryTracker } from "../edit-history-tracker.js";
import type { EditRecord } from "../edit-history-tracker.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<EditRecord> = {}): EditRecord {
  return {
    filePath: "/workspace/src/foo.ts",
    range: { startLine: 5, startChar: 2, endLine: 5, endChar: 2 },
    oldText: "",
    newText: "hello",
    timestamp: Date.now(),
    changeType: "insert",
    ...overrides,
  };
}

function makeTracker(maxSize = 50): EditHistoryTracker {
  return new EditHistoryTracker(maxSize);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EditHistoryTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changeListener = null;
  });

  // ── Ring buffer ───────────────────────────────────────────────────────────

  it("single edit recorded and retrievable via getRecent(1)", () => {
    const tracker = makeTracker();
    tracker.push(makeRecord({ filePath: "/a.ts" }));
    const recent = tracker.getRecent(1);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.filePath).toBe("/a.ts");
    tracker.dispose();
  });

  it("getRecent() returns all edits newest-first", () => {
    const tracker = makeTracker();
    tracker.push(makeRecord({ range: { startLine: 1, startChar: 0, endLine: 1, endChar: 0 } }));
    tracker.push(makeRecord({ range: { startLine: 2, startChar: 0, endLine: 2, endChar: 0 } }));
    tracker.push(makeRecord({ range: { startLine: 3, startChar: 0, endLine: 3, endChar: 0 } }));
    const recent = tracker.getRecent();
    expect(recent).toHaveLength(3);
    // Newest first → line 3 is at index 0
    expect(recent[0]?.range.startLine).toBe(3);
    expect(recent[2]?.range.startLine).toBe(1);
    tracker.dispose();
  });

  it("ring evicts oldest when >maxSize edits recorded", () => {
    const tracker = makeTracker(3);
    tracker.push(makeRecord({ filePath: "/first.ts" }));
    tracker.push(makeRecord({ filePath: "/second.ts" }));
    tracker.push(makeRecord({ filePath: "/third.ts" }));
    expect(tracker.size).toBe(3);
    tracker.push(makeRecord({ filePath: "/fourth.ts" }));
    // Oldest (/first.ts) should be evicted
    expect(tracker.size).toBe(3);
    const files = tracker.getRecent().map((r) => r.filePath);
    expect(files).not.toContain("/first.ts");
    expect(files).toContain("/fourth.ts");
    tracker.dispose();
  });

  it("size returns correct count (capped at maxSize)", () => {
    const tracker = makeTracker(5);
    for (let i = 0; i < 10; i++) tracker.push(makeRecord());
    expect(tracker.size).toBe(5);
    tracker.dispose();
  });

  it("getForFile() returns only edits for specified file", () => {
    const tracker = makeTracker();
    tracker.push(makeRecord({ filePath: "/a.ts" }));
    tracker.push(makeRecord({ filePath: "/b.ts" }));
    tracker.push(makeRecord({ filePath: "/a.ts" }));
    const aEdits = tracker.getForFile("/a.ts");
    expect(aEdits).toHaveLength(2);
    for (const r of aEdits) expect(r.filePath).toBe("/a.ts");
    tracker.dispose();
  });

  // ── Edit classification ───────────────────────────────────────────────────

  it("insert classified when oldText is empty", () => {
    const tracker = makeTracker();
    tracker.push(makeRecord({ oldText: "", newText: "hello", changeType: "insert" }));
    expect(tracker.getRecent(1)[0]?.changeType).toBe("insert");
    tracker.dispose();
  });

  it("delete classified when newText is empty", () => {
    const tracker = makeTracker();
    tracker.push(makeRecord({ oldText: "hello", newText: "", changeType: "delete" }));
    expect(tracker.getRecent(1)[0]?.changeType).toBe("delete");
    tracker.dispose();
  });

  it("replace classified when both oldText and newText are non-empty", () => {
    const tracker = makeTracker();
    tracker.push(makeRecord({ oldText: "foo", newText: "bar", changeType: "replace" }));
    expect(tracker.getRecent(1)[0]?.changeType).toBe("replace");
    tracker.dispose();
  });

  it("empty insert (newText='') still recorded", () => {
    const tracker = makeTracker();
    tracker.push(makeRecord({ oldText: "", newText: "", changeType: "insert" }));
    expect(tracker.size).toBe(1);
    tracker.dispose();
  });

  // ── Pattern detection ─────────────────────────────────────────────────────

  it("getAdjacentLinePattern() returns match when 3 consecutive-line edits recorded", () => {
    const tracker = makeTracker();
    const file = "/workspace/foo.ts";
    tracker.push(makeRecord({ filePath: file, range: { startLine: 10, startChar: 4, endLine: 10, endChar: 4 } }));
    tracker.push(makeRecord({ filePath: file, range: { startLine: 11, startChar: 4, endLine: 11, endChar: 4 } }));
    tracker.push(makeRecord({ filePath: file, range: { startLine: 12, startChar: 4, endLine: 12, endChar: 4 } }));
    const pattern = tracker.getAdjacentLinePattern();
    expect(pattern).not.toBeNull();
    expect(pattern).toHaveLength(3);
    tracker.dispose();
  });

  it("getAdjacentLinePattern() returns null when lines are not consecutive", () => {
    const tracker = makeTracker();
    const file = "/workspace/foo.ts";
    tracker.push(makeRecord({ filePath: file, range: { startLine: 10, startChar: 0, endLine: 10, endChar: 0 } }));
    tracker.push(makeRecord({ filePath: file, range: { startLine: 15, startChar: 0, endLine: 15, endChar: 0 } }));
    tracker.push(makeRecord({ filePath: file, range: { startLine: 20, startChar: 0, endLine: 20, endChar: 0 } }));
    const pattern = tracker.getAdjacentLinePattern();
    expect(pattern).toBeNull();
    tracker.dispose();
  });

  it("getColumnPattern() returns match when ≥3 of last 5 edits share same startChar", () => {
    const tracker = makeTracker();
    for (let i = 0; i < 3; i++) {
      tracker.push(makeRecord({ range: { startLine: i, startChar: 8, endLine: i, endChar: 8 } }));
    }
    const pattern = tracker.getColumnPattern();
    expect(pattern).not.toBeNull();
    expect(pattern?.column).toBe(8);
    expect(pattern?.count).toBeGreaterThanOrEqual(3);
    tracker.dispose();
  });

  it("getColumnPattern() returns null when columns vary", () => {
    const tracker = makeTracker();
    for (let i = 0; i < 5; i++) {
      tracker.push(makeRecord({ range: { startLine: i, startChar: i * 3, endLine: i, endChar: i * 3 } }));
    }
    const pattern = tracker.getColumnPattern();
    expect(pattern).toBeNull();
    tracker.dispose();
  });

  it("getFilePairPattern() returns file pair when A/B/A alternation in last 3+ edits", () => {
    const tracker = makeTracker();
    tracker.push(makeRecord({ filePath: "/a.ts" }));
    tracker.push(makeRecord({ filePath: "/b.ts" }));
    tracker.push(makeRecord({ filePath: "/a.ts" })); // newest = A, before = B, before that = A
    const pattern = tracker.getFilePairPattern();
    expect(pattern).not.toBeNull();
    expect(pattern?.fileA).toBe("/a.ts");
    expect(pattern?.fileB).toBe("/b.ts");
    tracker.dispose();
  });

  it("dispose() clears the ring buffer", () => {
    const tracker = makeTracker();
    tracker.push(makeRecord());
    tracker.push(makeRecord());
    tracker.dispose();
    expect(tracker.size).toBe(0);
    expect(tracker.getRecent()).toHaveLength(0);
  });
});
