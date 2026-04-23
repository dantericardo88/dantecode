// ============================================================================
// packages/vscode/src/__tests__/completion-acceptance-tracker.test.ts
// 15 tests for CompletionAcceptanceTracker.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";

// ── vscode mock ───────────────────────────────────────────────────────────────

vi.mock("vscode", () => {
  return {
    window: { visibleTextEditors: [] },
    workspace: { onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })) },
  };
});

// ── @dantecode/core mock ──────────────────────────────────────────────────────

vi.mock("@dantecode/core", () => ({}));

import { CompletionAcceptanceTracker } from "../completion-acceptance-tracker.js";
import type { CompletionTelemetryService } from "@dantecode/core";

// ── Helpers ───────────────────────────────────────────────────────────────────

type TestContentChange = { text: string };

type TestWorkspace = Pick<
  typeof vscode.workspace,
  "onDidChangeTextDocument"
> & {
  fireChange(fsPath: string, changes: TestContentChange[]): void;
};

type DocChangeListener = (e: vscode.TextDocumentChangeEvent) => unknown;

function makeChangeEvent(
  fsPath: string,
  changes: TestContentChange[],
): vscode.TextDocumentChangeEvent {
  return {
    document: { uri: { fsPath } } as unknown as vscode.TextDocument,
    contentChanges:
      changes as unknown as readonly vscode.TextDocumentContentChangeEvent[],
    reason: undefined,
  };
}

function makeFakeWorkspace(): TestWorkspace {
  let listener: DocChangeListener | null = null;
  const onDidChangeTextDocument: typeof vscode.workspace.onDidChangeTextDocument =
    (nextListener) => {
      listener = nextListener as DocChangeListener;
      return { dispose: vi.fn() };
    };

  return {
    onDidChangeTextDocument,
    fireChange(fsPath: string, changes: TestContentChange[]) {
      listener?.(makeChangeEvent(fsPath, changes));
    },
  };
}

function makeTelemetry() {
  return {
    record: vi.fn(),
    generateCompletionId: vi.fn(() => "cmp_aabbccdd1122"),
  } as unknown as CompletionTelemetryService;
}

function makeTracker(telemetry?: CompletionTelemetryService) {
  const ws = makeFakeWorkspace();
  const t = telemetry ?? makeTelemetry();
  const tracker = new CompletionAcceptanceTracker(t, ws);
  return { tracker, ws, telemetry: t };
}

const FILE = "/workspace/src/foo.ts";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CompletionAcceptanceTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── trackShown ──────────────────────────────────────────────────────────────

  it("trackShown records a view event", () => {
    const { tracker, telemetry } = makeTracker();
    tracker.trackShown("cmp_001", FILE, "const x = 1;", 120, "typescript", "grok/grok-3");
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "view", completionId: "cmp_001" }),
    );
    tracker.dispose();
  });

  it("trackShown with empty completionId throws", () => {
    const { tracker } = makeTracker();
    expect(() => tracker.trackShown("", FILE, "x", 100, "ts", "m")).toThrow();
    tracker.dispose();
  });

  it("trackShown language is passed through to telemetry event", () => {
    const { tracker, telemetry } = makeTracker();
    tracker.trackShown("cmp_002", FILE, "code", 80, "python", "grok/grok-3");
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ language: "python" }),
    );
    tracker.dispose();
  });

  it("trackShown elapsedMs is passed through to telemetry event", () => {
    const { tracker, telemetry } = makeTracker();
    tracker.trackShown("cmp_003", FILE, "code", 333, "typescript", "model");
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ elapsedMs: 333 }),
    );
    tracker.dispose();
  });

  // ── trackAccepted ───────────────────────────────────────────────────────────

  it("trackAccepted fires select event when completionId matches", () => {
    const { tracker, telemetry } = makeTracker();
    tracker.trackShown("cmp_004", FILE, "const x = 1;", 100, "typescript", "m");
    vi.clearAllMocks();
    tracker.trackAccepted("cmp_004");
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "select", completionId: "cmp_004" }),
    );
    tracker.dispose();
  });

  it("trackAccepted with wrong completionId is ignored", () => {
    const { tracker, telemetry } = makeTracker();
    tracker.trackShown("cmp_005", FILE, "x", 100, "ts", "m");
    vi.clearAllMocks();
    tracker.trackAccepted("cmp_WRONG");
    expect(telemetry.record).not.toHaveBeenCalled();
    tracker.dispose();
  });

  it("new trackShown cancels previous dismiss timer", () => {
    const { tracker, telemetry } = makeTracker();
    tracker.trackShown("cmp_006a", FILE, "x", 100, "ts", "m");
    vi.clearAllMocks();
    // Second trackShown cancels the first dismiss timer
    tracker.trackShown("cmp_006b", FILE, "y", 120, "ts", "m");
    // Advance timer — only ONE view event should fire (from cmp_006b)
    vi.advanceTimersByTime(6000);
    const dismissCalls = (telemetry.record as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0]?.eventType === "dismiss");
    // Only one dismiss (for cmp_006b), none for cmp_006a
    expect(dismissCalls.length).toBe(1);
    expect(dismissCalls[0]?.[0]?.completionId).toBe("cmp_006b");
    tracker.dispose();
  });

  it("multiple shown completions — only last one tracked for dismiss", () => {
    const { tracker, telemetry } = makeTracker();
    tracker.trackShown("cmp_A", FILE, "first", 100, "ts", "m");
    tracker.trackShown("cmp_B", FILE, "second", 120, "ts", "m");
    vi.clearAllMocks();
    vi.advanceTimersByTime(6000);
    const dismissIds = (telemetry.record as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0]?.eventType === "dismiss")
      .map((c) => c[0]?.completionId);
    expect(dismissIds).toContain("cmp_B");
    expect(dismissIds).not.toContain("cmp_A");
    tracker.dispose();
  });

  // ── document delta heuristic ────────────────────────────────────────────────

  it("document delta matching full completion text fires select", () => {
    const { tracker, ws, telemetry } = makeTracker();
    tracker.trackShown("cmp_007", FILE, "const x = 1;", 100, "typescript", "m");
    vi.clearAllMocks();
    ws.fireChange(FILE, [{ text: "const x = 1;" }]);
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "select", completionId: "cmp_007" }),
    );
    tracker.dispose();
  });

  it("document delta matching within Levenshtein threshold fires partial", () => {
    const { tracker, ws, telemetry } = makeTracker();
    tracker.trackShown("cmp_008", FILE, "const x = 1234;", 100, "typescript", "m");
    vi.clearAllMocks();
    // "const x = 123;" has Levenshtein distance 2 from "const x = 1234;" — within threshold of 3
    ws.fireChange(FILE, [{ text: "const x = 123;" }]);
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "partial", completionId: "cmp_008" }),
    );
    tracker.dispose();
  });

  it("no matching delta after 5s fires dismiss", () => {
    const { tracker, telemetry } = makeTracker();
    tracker.trackShown("cmp_009", FILE, "const x = 1;", 100, "typescript", "m");
    vi.clearAllMocks();
    vi.advanceTimersByTime(6000);
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "dismiss", completionId: "cmp_009" }),
    );
    tracker.dispose();
  });

  it("no double-dismiss if document change fires and timer also fires", () => {
    const { tracker, ws, telemetry } = makeTracker();
    tracker.trackShown("cmp_010", FILE, "const x = 1;", 100, "typescript", "m");
    vi.clearAllMocks();
    // Fire a non-matching change (not a partial match either — too short)
    ws.fireChange(FILE, [{ text: "c" }]);
    // Advance timer — dismiss should NOT fire again since pending was already cleared by select/partial or is still pending
    vi.advanceTimersByTime(6000);
    const dismissCalls = (telemetry.record as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0]?.eventType === "dismiss");
    // Timer fires dismiss (pending still set from 'c' not matching) — max 1 dismiss
    expect(dismissCalls.length).toBeLessThanOrEqual(1);
    tracker.dispose();
  });

  // ── dispose ─────────────────────────────────────────────────────────────────

  it("dispose cleans up document change listener", () => {
    const ws = makeFakeWorkspace();
    const telemetry = makeTelemetry();
    const tracker = new CompletionAcceptanceTracker(telemetry, ws);
    tracker.trackShown("cmp_011", FILE, "x", 100, "ts", "m");
    vi.clearAllMocks();
    tracker.dispose();
    // After dispose, document changes should not trigger events
    ws.fireChange(FILE, [{ text: "x" }]);
    expect(telemetry.record).not.toHaveBeenCalled();
  });

  it("dispose clears pending dismiss timer", () => {
    const { tracker, telemetry } = makeTracker();
    tracker.trackShown("cmp_012", FILE, "x", 100, "ts", "m");
    tracker.dispose();
    vi.clearAllMocks();
    vi.advanceTimersByTime(6000);
    expect(telemetry.record).not.toHaveBeenCalled();
  });

  it("disposed tracker fires no events on trackAccepted", () => {
    const { tracker, telemetry } = makeTracker();
    tracker.trackShown("cmp_013", FILE, "x", 100, "ts", "m");
    tracker.dispose();
    vi.clearAllMocks();
    tracker.trackAccepted("cmp_013");
    expect(telemetry.record).not.toHaveBeenCalled();
  });
});
