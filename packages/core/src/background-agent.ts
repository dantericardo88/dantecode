// ============================================================================
// @dantecode/core — Background Agent Runner
// Manages asynchronous agent tasks that run in the background while the user
// continues working. Tasks are queued, executed with concurrency limits, and
// report progress via callbacks.
// ============================================================================

import { randomUUID } from "node:crypto";
import type { BackgroundAgentTask, BackgroundAgentStatus } from "@dantecode/config-types";

/** Callback for progress updates from a background task. */
export type BackgroundProgressCallback = (task: BackgroundAgentTask) => void;

/** Function that runs the actual agent work. Receives a progress reporter. */
export type AgentWorkFn = (
  prompt: string,
  onProgress: (message: string) => void,
) => Promise<{ output: string; touchedFiles: string[] }>;

/**
 * Manages background agent tasks with queue and concurrency control.
 * Tasks run asynchronously and report progress via callbacks.
 */
export class BackgroundAgentRunner {
  private tasks: Map<string, BackgroundAgentTask> = new Map();
  private queue: string[] = [];
  private running = 0;
  private readonly maxConcurrent: number;
  private onProgress?: BackgroundProgressCallback;
  private workFn?: AgentWorkFn;

  constructor(maxConcurrent = 1) {
    this.maxConcurrent = maxConcurrent;
  }

  /** Set the function that does actual agent work. */
  setWorkFn(fn: AgentWorkFn): void {
    this.workFn = fn;
  }

  /** Set a callback for progress updates. */
  setProgressCallback(cb: BackgroundProgressCallback): void {
    this.onProgress = cb;
  }

  /**
   * Enqueue a task. Returns the task ID immediately.
   * The task will be started when a slot is available.
   */
  enqueue(prompt: string): string {
    const id = randomUUID().slice(0, 8);
    const task: BackgroundAgentTask = {
      id,
      prompt,
      status: "queued",
      createdAt: new Date().toISOString(),
      progress: "Waiting in queue...",
      touchedFiles: [],
    };
    this.tasks.set(id, task);
    this.queue.push(id);
    this.notifyProgress(task);
    this.processQueue();
    return id;
  }

  /** List all tasks (active and completed). */
  listTasks(): BackgroundAgentTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /** Get a specific task by ID. */
  getTask(id: string): BackgroundAgentTask | null {
    return this.tasks.get(id) ?? null;
  }

  /** Cancel a queued or running task. */
  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status === "completed" || task.status === "failed") return false;

    task.status = "cancelled";
    task.completedAt = new Date().toISOString();
    task.progress = "Cancelled by user";
    this.queue = this.queue.filter((qId) => qId !== id);
    this.notifyProgress(task);
    return true;
  }

  /** Get count of tasks by status. */
  getStatusCounts(): Record<BackgroundAgentStatus, number> {
    const counts: Record<BackgroundAgentStatus, number> = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const task of this.tasks.values()) {
      counts[task.status]++;
    }
    return counts;
  }

  /** Clear completed/failed/cancelled tasks from the list. */
  clearFinished(): number {
    let cleared = 0;
    for (const [id, task] of this.tasks) {
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
        this.tasks.delete(id);
        cleared++;
      }
    }
    return cleared;
  }

  /** Process the queue, starting tasks up to concurrency limit. */
  private processQueue(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const taskId = this.queue.shift()!;
      const task = this.tasks.get(taskId);
      if (!task || task.status === "cancelled") continue;
      this.runTask(task);
    }
  }

  /** Run a single task. */
  private runTask(task: BackgroundAgentTask): void {
    this.running++;
    task.status = "running";
    task.startedAt = new Date().toISOString();
    task.progress = "Starting...";
    this.notifyProgress(task);

    const execute = async () => {
      if (!this.workFn) {
        task.status = "failed";
        task.error = "No work function configured";
        task.completedAt = new Date().toISOString();
        this.notifyProgress(task);
        this.running--;
        this.processQueue();
        return;
      }

      try {
        const result = await this.workFn(task.prompt, (message) => {
          if (task.status === "cancelled") return;
          task.progress = message;
          this.notifyProgress(task);
        });

        if (task.status === "cancelled") return;
        task.status = "completed";
        task.output = result.output;
        task.touchedFiles = result.touchedFiles;
        task.completedAt = new Date().toISOString();
        task.progress = "Done";
      } catch (err: unknown) {
        if (task.status === "cancelled") return;
        task.status = "failed";
        task.error = err instanceof Error ? err.message : String(err);
        task.completedAt = new Date().toISOString();
        task.progress = "Failed";
      }

      this.notifyProgress(task);
      this.running--;
      this.processQueue();
    };

    execute();
  }

  /** Notify the progress callback. */
  private notifyProgress(task: BackgroundAgentTask): void {
    this.onProgress?.(task);
  }
}
