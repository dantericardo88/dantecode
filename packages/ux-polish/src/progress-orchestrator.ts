/**
 * progress-orchestrator.ts — @dantecode/ux-polish
 *
 * Multi-task progress tracking for the shared UX engine.
 * Implements the PRD ProgressState contract with start/update/complete/fail
 * lifecycle, serializable state for checkpoint/resume, and themed rendering.
 */

import type { ProgressState, ProgressConfig, ProgressPatch, ProgressStatus } from "./types.js";
import { ThemeEngine } from "./theme-engine.js";
import { COLUMN_WIDTH } from "./tokens/spacing-tokens.js";

// ---------------------------------------------------------------------------
// ProgressOrchestrator
// ---------------------------------------------------------------------------

export interface ProgressOrchestratorOptions {
  theme?: ThemeEngine;
}

export class ProgressOrchestrator {
  private readonly _states = new Map<string, ProgressState>();
  private readonly _engine: ThemeEngine;

  constructor(options: ProgressOrchestratorOptions = {}) {
    this._engine = options.theme ?? new ThemeEngine();
  }

  // -------------------------------------------------------------------------
  // PRD public API
  // -------------------------------------------------------------------------

  /**
   * Start tracking a new progress item.
   * Throws if id already exists. Use reset() to clear before re-registering.
   */
  startProgress(id: string, config: ProgressConfig): ProgressState {
    if (this._states.has(id)) {
      throw new Error(`Progress item '${id}' already exists. Call reset() first.`);
    }
    const state: ProgressState = {
      id,
      phase: config.phase,
      progress: config.initialProgress ?? 0,
      status: "running",
      message: config.message,
      startedAt: new Date().toISOString(),
    };
    this._states.set(id, state);
    return { ...state };
  }

  /**
   * Update an existing progress item.
   * Partial patch — only provided fields are updated.
   */
  updateProgress(id: string, patch: ProgressPatch): ProgressState {
    const state = this._require(id);
    if (patch.phase !== undefined) state.phase = patch.phase;
    if (patch.progress !== undefined) state.progress = Math.min(100, Math.max(0, patch.progress));
    if (patch.status !== undefined) state.status = patch.status;
    if (patch.message !== undefined) state.message = patch.message;
    return { ...state };
  }

  /** Mark a progress item as completed (100%). */
  completeProgress(id: string, message?: string): ProgressState {
    return this.updateProgress(id, {
      status: "completed",
      progress: 100,
      ...(message !== undefined ? { message } : {}),
    });
  }

  /** Mark a progress item as failed. */
  failProgress(id: string, message?: string): ProgressState {
    const state = this._require(id);
    state.status = "failed";
    state.endedAt = new Date().toISOString();
    if (message !== undefined) state.message = message;
    return { ...state };
  }

  /** Pause a running progress item. */
  pauseProgress(id: string): ProgressState {
    return this.updateProgress(id, { status: "paused" });
  }

  /** Resume a paused progress item. */
  resumeProgress(id: string): ProgressState {
    return this.updateProgress(id, { status: "running" });
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /** Get current state for a given id. Returns undefined if not found. */
  getProgress(id: string): ProgressState | undefined {
    const s = this._states.get(id);
    return s ? { ...s } : undefined;
  }

  /** Get all tracked states. */
  getAllProgress(): ProgressState[] {
    return Array.from(this._states.values()).map((s) => ({ ...s }));
  }

  /** Summary counts by status. */
  getSummary(): Record<ProgressStatus, number> {
    const counts: Record<ProgressStatus, number> = {
      pending: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0,
    };
    for (const s of this._states.values()) counts[s.status]++;
    return counts;
  }

  /** Whether all tracked items are in a terminal state (completed/failed). */
  isAllComplete(): boolean {
    if (this._states.size === 0) return false;
    for (const s of this._states.values()) {
      if (s.status === "pending" || s.status === "running" || s.status === "paused") return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Serialization (checkpoint/resume support)
  // -------------------------------------------------------------------------

  /** Serialize all states to a plain object (for persistence). */
  serialize(): Record<string, ProgressState> {
    const out: Record<string, ProgressState> = {};
    for (const [k, v] of this._states) out[k] = { ...v };
    return out;
  }

  /** Restore states from a serialized snapshot. Merges with existing. */
  restore(snapshot: Record<string, ProgressState>): void {
    for (const [k, v] of Object.entries(snapshot)) {
      this._states.set(k, { ...v });
    }
  }

  /** Remove a specific progress item. */
  remove(id: string): void {
    this._states.delete(id);
  }

  /** Clear all progress state. */
  reset(): void {
    this._states.clear();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Render a single progress item as a themed string. */
  renderOne(id: string): string {
    const state = this.getProgress(id);
    if (!state) return "";
    return this._renderState(state);
  }

  /** Render all progress items as a multi-line string. */
  renderAll(): string {
    if (this._states.size === 0) return "";
    const lines: string[] = [];
    for (const state of this._states.values()) {
      lines.push(this._renderState(state));
    }
    const s = this.getSummary();
    const total = this._states.size;
    const done = s.completed + s.failed;
    lines.push(
      this._engine.muted(
        `\n  Progress: ${done}/${total} done` +
          (s.failed > 0 ? ` — ${s.failed} failed` : "") +
          (s.running > 0 ? ` — ${s.running} running` : ""),
      ),
    );
    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _require(id: string): ProgressState {
    const state = this._states.get(id);
    if (!state) throw new Error(`Progress item '${id}' not found`);
    return state;
  }

  private _renderState(state: ProgressState): string {
    const icons = this._engine.icons();
    const icon = _STATUS_ICONS[state.status] ?? "○";
    const detailPart = state.message ? `  ${state.message}` : "";

    if (state.status === "running" && state.progress !== undefined && state.progress > 0) {
      const bar = _progressBar(state.progress, COLUMN_WIDTH.progressBar);
      const coloredBar = this._engine.progressColor(bar);
      return `  ${icon} ${coloredBar} ${state.phase}${detailPart}`;
    }

    if (state.status === "completed") {
      return `  ${this._engine.success(icons.success + " " + state.phase)}${detailPart}`;
    }

    if (state.status === "failed") {
      return `  ${this._engine.error(icons.error + " " + state.phase)}${detailPart}`;
    }

    return `  ${icon} ${state.phase}${detailPart}`;
  }
}

// ---------------------------------------------------------------------------
// Module-level convenience functions (PRD public API)
// ---------------------------------------------------------------------------

const _orchestrator = new ProgressOrchestrator();

/** Start tracking a new progress item in the shared orchestrator. */
export function startProgress(id: string, config: ProgressConfig): ProgressState {
  return _orchestrator.startProgress(id, config);
}

/** Update an existing progress item in the shared orchestrator. */
export function updateProgress(id: string, patch: ProgressPatch): ProgressState {
  return _orchestrator.updateProgress(id, patch);
}

/** Reset the shared orchestrator (useful for tests). */
export function resetProgressOrchestrator(): void {
  _orchestrator.reset();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _STATUS_ICONS: Record<ProgressStatus, string> = {
  pending: "○",
  running: "◉",
  paused: "⏸",
  completed: "✓",
  failed: "✗",
};

function _progressBar(percent: number, width: number): string {
  const pct = Math.min(100, Math.max(0, percent)) / 100;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${Math.round(pct * 100)}%`;
}
