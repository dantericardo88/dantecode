/**
 * progress-orchestrator.ts
 *
 * Multi-task progress tracking for long-running pipeline operations.
 * Ties into UXEngine for themed output. Works alongside reasoning chains
 * and autoforge pipeline steps.
 */

import { UXEngine } from "./ux-engine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskState = "pending" | "running" | "done" | "failed" | "skipped";

export interface ProgressTask {
  id: string;
  label: string;
  state: TaskState;
  current: number;
  total: number;
  /** Optional detail message (e.g. current sub-step). */
  detail?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface ProgressOrchestratorOptions {
  ux?: UXEngine;
  /** If true, writes to process.stdout on each update. Default: false. */
  autoRender?: boolean;
}

// ---------------------------------------------------------------------------
// ProgressOrchestrator
// ---------------------------------------------------------------------------

export class ProgressOrchestrator {
  private readonly tasks = new Map<string, ProgressTask>();
  private readonly ux: UXEngine;
  private readonly autoRender: boolean;

  constructor(options: ProgressOrchestratorOptions = {}) {
    this.ux = options.ux ?? new UXEngine();
    this.autoRender = options.autoRender ?? false;
  }

  /** Register a new task. Throws if id already exists. */
  register(id: string, label: string, total = 0): void {
    if (this.tasks.has(id)) throw new Error(`Task '${id}' already registered`);
    this.tasks.set(id, { id, label, state: "pending", current: 0, total });
  }

  /** Start a task (pending → running). */
  start(id: string, detail?: string): void {
    const task = this._get(id);
    task.state = "running";
    task.startedAt = Date.now();
    if (detail !== undefined) task.detail = detail;
    this._maybeRender();
  }

  /**
   * Update progress of a running task.
   * @param id - Task id.
   * @param current - Current step.
   * @param total - Total steps (optional override).
   * @param detail - Optional updated detail message.
   */
  update(id: string, current: number, total?: number, detail?: string): void {
    const task = this._get(id);
    task.current = current;
    if (total !== undefined) task.total = total;
    if (detail !== undefined) task.detail = detail;
    if (task.state === "pending") task.state = "running";
    this._maybeRender();
  }

  /** Mark task as done (running → done). */
  complete(id: string, detail?: string): void {
    const task = this._get(id);
    task.state = "done";
    task.finishedAt = Date.now();
    if (task.total > 0) task.current = task.total;
    if (detail !== undefined) task.detail = detail;
    this._maybeRender();
  }

  /** Mark task as failed. */
  fail(id: string, error: string): void {
    const task = this._get(id);
    task.state = "failed";
    task.finishedAt = Date.now();
    task.error = error;
    this._maybeRender();
  }

  /** Mark task as skipped (never ran). */
  skip(id: string, reason?: string): void {
    const task = this._get(id);
    task.state = "skipped";
    task.finishedAt = Date.now();
    if (reason) task.detail = reason;
    this._maybeRender();
  }

  /** Get a snapshot of all tasks. */
  getTasks(): ProgressTask[] {
    return Array.from(this.tasks.values());
  }

  /** Get a single task by id. */
  getTask(id: string): ProgressTask | undefined {
    return this.tasks.get(id);
  }

  /** Summary counts by state. */
  getSummary(): Record<TaskState, number> {
    const counts: Record<TaskState, number> = {
      pending: 0,
      running: 0,
      done: 0,
      failed: 0,
      skipped: 0,
    };
    for (const t of this.tasks.values()) counts[t.state]++;
    return counts;
  }

  /** Whether all registered tasks have reached a terminal state. */
  isComplete(): boolean {
    for (const t of this.tasks.values()) {
      if (t.state === "pending" || t.state === "running") return false;
    }
    return this.tasks.size > 0;
  }

  /**
   * Render all tasks to a string.
   * Running tasks show a progress bar; terminal tasks show icon + elapsed.
   */
  render(): string {
    if (this.tasks.size === 0) return "";
    const lines: string[] = [];

    for (const task of this.tasks.values()) {
      const icon = STATE_ICONS[task.state];
      const elapsedPart = task.startedAt
        ? ` (${_elapsed(task.startedAt, task.finishedAt)})`
        : "";
      const detailPart = task.detail ? `  ${task.detail}` : "";

      if (task.state === "running" && task.total > 0) {
        const bar = this.ux.formatProgress({
          current: task.current,
          total: task.total,
          label: task.label,
        });
        lines.push(`  ${icon} ${bar}${detailPart}`);
      } else if (task.state === "failed") {
        const errPart = task.error ? `: ${task.error}` : "";
        lines.push(`  ${icon} ${task.label}${errPart}${elapsedPart}`);
      } else {
        lines.push(`  ${icon} ${task.label}${detailPart}${elapsedPart}`);
      }
    }

    const s = this.getSummary();
    const total = this.tasks.size;
    const done = s.done + s.skipped;
    lines.push(
      `\n  Progress: ${done}/${total} complete` +
        (s.failed > 0 ? ` — ${s.failed} failed` : "") +
        (s.running > 0 ? ` — ${s.running} running` : ""),
    );

    return lines.join("\n");
  }

  /** Reset all tasks. */
  reset(): void {
    this.tasks.clear();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _get(id: string): ProgressTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task '${id}' not found`);
    return task;
  }

  private _maybeRender(): void {
    if (!this.autoRender) return;
    process.stdout.write("\x1b[2J\x1b[H" + this.render() + "\n");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_ICONS: Record<TaskState, string> = {
  pending: "○",
  running: "◉",
  done: "✓",
  failed: "✗",
  skipped: "⊘",
};

function _elapsed(startedAt: number, finishedAt?: number): string {
  const ms = (finishedAt ?? Date.now()) - startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}
