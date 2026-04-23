// ============================================================================
// packages/vscode/src/fim-latency-tracker.ts
//
// FimLatencyTracker — sliding window p50/p95 TTFB tracking with status bar.
//
// Maintains a rolling window of the last MAX_SAMPLES first-chunk latency values
// and surfaces p50/p95 in a VS Code status bar item.
//
// OSS pattern: Tabby metrics endpoint + live latency display.
// ============================================================================

import * as vscode from "vscode";

const MAX_SAMPLES = 200;

/**
 * Records first-chunk latency (TTFB) samples in a sliding window and updates
 * a VS Code status bar item showing the current p50.
 *
 * Usage:
 *   const tracker = new FimLatencyTracker(telemetry);
 *   // After each streaming completion:
 *   tracker.recordFirstChunk(firstChunkMs);
 */
export class FimLatencyTracker implements vscode.Disposable {
  private readonly _samples: number[] = [];
  private readonly _statusBarItem: vscode.StatusBarItem;
  private _ownedStatusBar: boolean;

  constructor(
    /** Accepts telemetry service (reserved for future use); currently unused */
    _telemetry?: unknown,
    /** Injected for testability — creates its own item when not provided */
    statusBarItem?: vscode.StatusBarItem,
  ) {
    if (statusBarItem) {
      this._statusBarItem = statusBarItem;
      this._ownedStatusBar = false;
    } else {
      this._statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        98, // just below the main DanteCode status bar (priority 99)
      );
      this._ownedStatusBar = true;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Record a new first-chunk latency sample (milliseconds).
   * Updates the sliding window and refreshes the status bar.
   */
  recordFirstChunk(ms: number): void {
    this._samples.push(ms);
    if (this._samples.length > MAX_SAMPLES) {
      this._samples.shift(); // evict oldest — O(n) acceptable for ≤200 samples
    }
    this._updateStatusBar();
  }

  /** Current p50 TTFB from the sliding window. Returns 0 when no samples. */
  getP50(): number {
    return this._getPercentile(50);
  }

  /** Current p95 TTFB from the sliding window. Returns 0 when no samples. */
  getP95(): number {
    return this._getPercentile(95);
  }

  /** Number of samples currently in the window. */
  get sampleCount(): number {
    return this._samples.length;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private _getPercentile(p: number): number {
    if (this._samples.length === 0) return 0;
    const sorted = [...this._samples].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)]!;
  }

  private _updateStatusBar(): void {
    const p50 = this.getP50();
    if (p50 === 0) {
      this._statusBarItem.hide();
      return;
    }
    const p95 = this.getP95();
    this._statusBarItem.text = `$(zap) ${p50}ms`;
    this._statusBarItem.tooltip = `FIM latency — p50: ${p50}ms | p95: ${p95}ms`;
    this._statusBarItem.show();
  }

  /**
   * Log the P50 latency to an output channel and return the value.
   * Used by extension.ts after context-retriever warmup completes.
   */
  reportP50(channel?: vscode.OutputChannel): number {
    const p50 = this.getP50();
    if (channel && p50 > 0) {
      channel.appendLine(`[FIM] P50 latency: ${p50}ms | P95: ${this.getP95()}ms`);
    }
    return p50;
  }

  dispose(): void {
    this._samples.length = 0;
    if (this._ownedStatusBar) {
      this._statusBarItem.dispose();
    }
  }
}
