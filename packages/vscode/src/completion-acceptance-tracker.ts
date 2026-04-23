// ============================================================================
// packages/vscode/src/completion-acceptance-tracker.ts
//
// Bridges VSCode's InlineCompletionItem acceptance signal to the
// CompletionTelemetryService. Tracks view → select / partial / dismiss
// for every ghost-text completion shown to the user.
//
// Strategy:
//  1. `trackShown()` — called by the completion provider each time a ghost
//     text item is returned. Stores the pending completion and starts a
//     dismiss timer (5 s).
//  2. `trackAccepted()` — registered as `InlineCompletionItem.command`.
//     VSCode fires it when the user presses Tab. Records a "select" event.
//  3. `onDidChangeTextDocument` listener — additional heuristic: if the
//     document delta matches the shown text (≥50 % prefix), fires "partial".
//  4. If neither 2 nor 3 fires within 5 s, fires "dismiss".
// ============================================================================

import * as vscode from "vscode";
import type { CompletionTelemetryService } from "@dantecode/core";

/** O(n*m) Levenshtein distance — exported for testing (Sprint BA dim 1). */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

/** Internal record of a completion that is currently being shown. */
interface PendingCompletion {
  completionId: string;
  filePath: string;
  insertText: string;
  language: string;
  modelId: string;
  elapsedMs: number;
  firstChunkMs?: number;
  shownAt: number;
}

const DISMISS_TIMEOUT_MS = 5_000;

export class CompletionAcceptanceTracker implements vscode.Disposable {
  private _pending: PendingCompletion | null = null;
  private _dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _telemetry: CompletionTelemetryService;

  constructor(
    telemetry: CompletionTelemetryService,
    /** Injected for testability; defaults to the real vscode.workspace */
    workspace: Pick<
      typeof vscode.workspace,
      "onDidChangeTextDocument"
    > = vscode.workspace,
  ) {
    this._telemetry = telemetry;

    // Listen for document changes as a heuristic acceptance signal
    this._disposables.push(
      workspace.onDidChangeTextDocument((e) => {
        this._onDocumentChange(e);
      }),
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Call from InlineCompletionProvider each time a ghost-text item is shown.
   * Cancels any pending dismiss timer from a prior completion.
   */
  trackShown(
    completionId: string,
    filePath: string,
    insertText: string,
    elapsedMs: number,
    language: string,
    modelId: string,
    /** Optional TTFB — milliseconds from stream open to first chunk received. */
    firstChunkMs?: number,
  ): void {
    if (!completionId) throw new Error("completionId must not be empty");

    // Cancel previous dismiss timer
    this._cancelDismissTimer();

    this._pending = { completionId, filePath, insertText, language, modelId, elapsedMs, firstChunkMs, shownAt: Date.now() };

    // Record the "view" event
    this._telemetry.record({
      completionId,
      eventType: "view",
      language,
      modelId,
      elapsedMs,
      firstChunkMs,
      completionLength: insertText.length,
      timestamp: Date.now(),
    });

    // Start dismiss timer
    this._dismissTimer = setTimeout(() => {
      this._fireDismiss();
    }, DISMISS_TIMEOUT_MS);
  }

  /**
   * Called when the user explicitly accepts (via Tab).
   * Set this as the `command` on InlineCompletionItem:
   *   `{ command: "dantecode._internalTrackAccept", arguments: [completionId] }`
   */
  trackAccepted(completionId: string): void {
    const pending = this._pending;
    if (!pending || pending.completionId !== completionId) return;

    this._cancelDismissTimer();
    this._telemetry.record({
      completionId: pending.completionId,
      eventType: "select",
      language: pending.language,
      modelId: pending.modelId,
      elapsedMs: Date.now() - pending.shownAt,
      completionLength: pending.insertText.length,
      timestamp: Date.now(),
    });
    this._pending = null;
  }

  dispose(): void {
    this._cancelDismissTimer();
    for (const d of this._disposables) d.dispose();
    this._disposables.length = 0;
    this._pending = null;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _onDocumentChange(e: vscode.TextDocumentChangeEvent): void {
    const pending = this._pending;
    if (!pending) return;

    // Only care about changes to the file where completion was shown
    if (e.document.uri.fsPath !== pending.filePath) return;

    for (const change of e.contentChanges) {
      const inserted = change.text;
      if (!inserted || inserted.length === 0) continue;

      const expected = pending.insertText;

      if (inserted === expected) {
        // Full match — treat as select
        this._cancelDismissTimer();
        this._telemetry.record({
          completionId: pending.completionId,
          eventType: "select",
          language: pending.language,
          modelId: pending.modelId,
          elapsedMs: Date.now() - pending.shownAt,
          completionLength: expected.length,
          timestamp: Date.now(),
        });
        this._pending = null;
        return;
      }

      // Partial match: inserted text is within Levenshtein threshold (Sprint BA dim 1)
      if (levenshteinDistance(inserted, expected) < Math.max(3, expected.length * 0.10)) {
        this._cancelDismissTimer();
        this._telemetry.record({
          completionId: pending.completionId,
          eventType: "partial",
          language: pending.language,
          modelId: pending.modelId,
          elapsedMs: Date.now() - pending.shownAt,
          completionLength: expected.length,
          acceptedLength: inserted.length,
          timestamp: Date.now(),
        });
        this._pending = null;
        return;
      }
    }
  }

  private _fireDismiss(): void {
    const pending = this._pending;
    if (!pending) return;
    this._telemetry.record({
      completionId: pending.completionId,
      eventType: "dismiss",
      language: pending.language,
      modelId: pending.modelId,
      elapsedMs: Date.now() - pending.shownAt,
      completionLength: pending.insertText.length,
      timestamp: Date.now(),
    });
    this._pending = null;
    this._dismissTimer = null;
  }

  private _cancelDismissTimer(): void {
    if (this._dismissTimer !== null) {
      clearTimeout(this._dismissTimer);
      this._dismissTimer = null;
    }
  }
}
