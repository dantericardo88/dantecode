// ============================================================================
// packages/vscode/src/__tests__/next-edit-predictor.test.ts
// 15 tests for NextEditPredictor.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── vscode mock ───────────────────────────────────────────────────────────────

vi.mock("vscode", () => {
  return {
    window: {
      activeTextEditor: null,
    },
    workspace: {
      onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    },
  };
});

import { NextEditPredictor } from "../next-edit-predictor.js";
import { EditHistoryTracker } from "../edit-history-tracker.js";
import type { EditRecord } from "../edit-history-tracker.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<EditRecord> = {}): EditRecord {
  return {
    filePath: "/workspace/src/foo.ts",
    range: { startLine: 5, startChar: 4, endLine: 5, endChar: 4 },
    oldText: "",
    newText: "x",
    timestamp: Date.now(),
    changeType: "insert",
    ...overrides,
  };
}

function makeHistoryWithPattern(
  pattern: "adjacent" | "column" | "file-pair" | "import" | "none",
): EditHistoryTracker {
  const tracker = new EditHistoryTracker(50);

  if (pattern === "adjacent") {
    const file = "/workspace/foo.ts";
    tracker.push(makeRecord({ filePath: file, range: { startLine: 10, startChar: 4, endLine: 10, endChar: 4 } }));
    tracker.push(makeRecord({ filePath: file, range: { startLine: 11, startChar: 4, endLine: 11, endChar: 4 } }));
    tracker.push(makeRecord({ filePath: file, range: { startLine: 12, startChar: 4, endLine: 12, endChar: 4 } }));
  } else if (pattern === "column") {
    // Non-consecutive lines so adjacent-line pattern does NOT trigger
    for (const line of [5, 10, 15]) {
      tracker.push(makeRecord({ range: { startLine: line, startChar: 8, endLine: line, endChar: 8 } }));
    }
  } else if (pattern === "file-pair") {
    // Use varying startChar so column-repeat does NOT trigger (need ≥3 same column)
    tracker.push(makeRecord({ filePath: "/a.ts", range: { startLine: 5, startChar: 2, endLine: 5, endChar: 2 } }));
    tracker.push(makeRecord({ filePath: "/b.ts", range: { startLine: 8, startChar: 7, endLine: 8, endChar: 7 } }));
    tracker.push(makeRecord({ filePath: "/a.ts", range: { startLine: 5, startChar: 12, endLine: 5, endChar: 12 } }));
  } else if (pattern === "import") {
    tracker.push(makeRecord({ newText: "import { Foo } from './foo'", changeType: "insert" }));
  }
  // "none": empty tracker

  return tracker;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("NextEditPredictor", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  // ── Prediction strategies ─────────────────────────────────────────────────

  it("predict() returns strategy 'none' with confidence 0 when no history", () => {
    const tracker = makeHistoryWithPattern("none");
    const predictor = new NextEditPredictor(tracker);
    const pred = predictor.predict("/foo.ts", 5, 0);
    expect(pred.strategy).toBe("none");
    expect(pred.confidence).toBe(0);
    predictor.dispose();
    tracker.dispose();
  });

  it("predict() returns 'adjacent-line' when 3 consecutive line edits in history", () => {
    const tracker = makeHistoryWithPattern("adjacent");
    const predictor = new NextEditPredictor(tracker);
    const pred = predictor.predict("/workspace/foo.ts", 12, 4);
    expect(pred.strategy).toBe("adjacent-line");
    predictor.dispose();
    tracker.dispose();
  });

  it("adjacent-line prediction advances line by 1 from last edit", () => {
    const tracker = makeHistoryWithPattern("adjacent");
    const predictor = new NextEditPredictor(tracker);
    const pred = predictor.predict("/workspace/foo.ts", 12, 4);
    // Last edit was line 12, so prediction should be line 13
    expect(pred.line).toBe(13);
    expect(pred.character).toBe(4); // same column as last edit
    predictor.dispose();
    tracker.dispose();
  });

  it("predict() returns 'column-repeat' when ≥3 same-column edits in last 5", () => {
    const tracker = makeHistoryWithPattern("column");
    const predictor = new NextEditPredictor(tracker);
    const pred = predictor.predict("/workspace/src/foo.ts", 3, 8);
    expect(pred.strategy).toBe("column-repeat");
    predictor.dispose();
    tracker.dispose();
  });

  it("column-repeat prediction targets same character offset", () => {
    const tracker = makeHistoryWithPattern("column");
    const predictor = new NextEditPredictor(tracker);
    const pred = predictor.predict("/workspace/src/foo.ts", 3, 8);
    expect(pred.character).toBe(8);
    predictor.dispose();
    tracker.dispose();
  });

  it("predict() returns 'file-oscillation' when A/B/A pattern in last 4 edits", () => {
    const tracker = makeHistoryWithPattern("file-pair");
    const predictor = new NextEditPredictor(tracker);
    // Currently in /a.ts — should predict /b.ts
    const pred = predictor.predict("/a.ts", 5, 0);
    expect(pred.strategy).toBe("file-oscillation");
    predictor.dispose();
    tracker.dispose();
  });

  it("file-oscillation confidence = 0.70", () => {
    const tracker = makeHistoryWithPattern("file-pair");
    const predictor = new NextEditPredictor(tracker);
    const pred = predictor.predict("/a.ts", 5, 0);
    expect(pred.confidence).toBe(0.70);
    predictor.dispose();
    tracker.dispose();
  });

  it("higher-priority strategy wins when multiple patterns could match", () => {
    const tracker = new EditHistoryTracker(50);
    const file = "/workspace/foo.ts";
    // Set up both adjacent-line AND column-repeat (adjacent should win at 0.85 vs 0.75)
    tracker.push(makeRecord({ filePath: file, range: { startLine: 10, startChar: 4, endLine: 10, endChar: 4 } }));
    tracker.push(makeRecord({ filePath: file, range: { startLine: 11, startChar: 4, endLine: 11, endChar: 4 } }));
    tracker.push(makeRecord({ filePath: file, range: { startLine: 12, startChar: 4, endLine: 12, endChar: 4 } }));
    const predictor = new NextEditPredictor(tracker);
    const pred = predictor.predict(file, 12, 4);
    expect(pred.strategy).toBe("adjacent-line");
    expect(pred.confidence).toBe(0.85);
    predictor.dispose();
    tracker.dispose();
  });

  // ── Confidence and thresholds ─────────────────────────────────────────────

  it("adjacent-line confidence = 0.85", () => {
    const tracker = makeHistoryWithPattern("adjacent");
    const predictor = new NextEditPredictor(tracker);
    const pred = predictor.predict("/workspace/foo.ts", 12, 4);
    expect(pred.confidence).toBe(0.85);
    predictor.dispose();
    tracker.dispose();
  });

  it("column-repeat confidence = 0.75", () => {
    const tracker = makeHistoryWithPattern("column");
    const predictor = new NextEditPredictor(tracker);
    const pred = predictor.predict("/workspace/src/foo.ts", 3, 8);
    expect(pred.confidence).toBe(0.75);
    predictor.dispose();
    tracker.dispose();
  });

  it("predict() returns 'none' when no pattern matches", () => {
    // 2 non-consecutive edits — not enough for any pattern
    const tracker = new EditHistoryTracker(50);
    tracker.push(makeRecord({ filePath: "/x.ts", range: { startLine: 1, startChar: 0, endLine: 1, endChar: 0 } }));
    tracker.push(makeRecord({ filePath: "/y.ts", range: { startLine: 50, startChar: 0, endLine: 50, endChar: 0 } }));
    const predictor = new NextEditPredictor(tracker);
    const pred = predictor.predict("/z.ts", 10, 0);
    expect(pred.strategy).toBe("none");
    expect(pred.confidence).toBe(0);
    predictor.dispose();
    tracker.dispose();
  });

  it("confidence 0 when history is empty", () => {
    const tracker = new EditHistoryTracker(50);
    const predictor = new NextEditPredictor(tracker);
    const pred = predictor.predict("/foo.ts", 0, 0);
    expect(pred.confidence).toBe(0);
    predictor.dispose();
    tracker.dispose();
  });

  // ── Idle watcher ──────────────────────────────────────────────────────────

  it("startIdleWatcher fires callback after idle period (fake timers)", async () => {
    vi.useFakeTimers();
    const tracker = makeHistoryWithPattern("adjacent");
    const predictor = new NextEditPredictor(tracker);
    const callback = vi.fn();
    predictor.startIdleWatcher(300, callback);
    // Trigger the timer by calling predict() which resets idle timer
    predictor.predict("/workspace/foo.ts", 12, 4);
    // Advance past the idle timeout
    await vi.advanceTimersByTimeAsync(400);
    // Callback should have been called (confidence 0.85 >= 0.65)
    expect(callback).toHaveBeenCalled();
    predictor.dispose();
    tracker.dispose();
    vi.useRealTimers();
  });

  it("idle timer resets when predict() called before timeout", async () => {
    vi.useFakeTimers();
    const tracker = makeHistoryWithPattern("adjacent");
    const predictor = new NextEditPredictor(tracker);
    const callback = vi.fn();
    predictor.startIdleWatcher(300, callback);
    // First predict — starts timer
    predictor.predict("/workspace/foo.ts", 12, 4);
    // Before 300ms, call predict again — timer resets
    await vi.advanceTimersByTimeAsync(200);
    predictor.predict("/workspace/foo.ts", 12, 4);
    // Advance 200ms more (total 400ms from first, but only 200ms from second)
    await vi.advanceTimersByTimeAsync(200);
    // Should NOT have fired yet (200ms < 300ms idle)
    expect(callback).not.toHaveBeenCalled();
    // Advance another 200ms → now 400ms since last predict → fires
    await vi.advanceTimersByTimeAsync(200);
    expect(callback).toHaveBeenCalledTimes(1);
    predictor.dispose();
    tracker.dispose();
    vi.useRealTimers();
  });

  it("dispose() stops idle watcher and no further callbacks fire", async () => {
    vi.useFakeTimers();
    const tracker = makeHistoryWithPattern("adjacent");
    const predictor = new NextEditPredictor(tracker);
    const callback = vi.fn();
    predictor.startIdleWatcher(200, callback);
    predictor.predict("/workspace/foo.ts", 12, 4);
    predictor.dispose();
    await vi.advanceTimersByTimeAsync(500);
    expect(callback).not.toHaveBeenCalled();
    tracker.dispose();
    vi.useRealTimers();
  });
});
