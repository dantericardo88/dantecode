// ============================================================================
// @dantecode/core — Async Task Executor (crewai-derived)
// Event-driven task execution with status tracking, cancellation, and completion
// callbacks. Builds on existing Council and background-agent patterns.
// ============================================================================

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Status of an async task. */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/** Priority level for task scheduling. */
export type TaskPriority = "low" | "normal" | "high" | "critical";

/**
 * A unit of work to be executed asynchronously.
 * TInput and TOutput are type parameters for input/output data.
 */
export interface Task<TInput = unknown, TOutput = unknown> {
  /** Unique task identifier. */
  id: string;
  /** Task display name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Task input data. */
  input: TInput;
  /** Priority level (default: "normal"). */
  priority?: TaskPriority;
  /** Maximum execution time in milliseconds (0 = no timeout). */
  timeout?: number;
  /** Number of retry attempts on failure (default: 0). */
  retries?: number;
  /** Tags for categorization and filtering. */
  tags?: string[];
  /** Phantom field to preserve TOutput type parameter. */
  _output?: TOutput;
}

/**
 * Result of task execution.
 */
export interface TaskResult<TOutput = unknown> {
  /** The task that was executed. */
  task: Task;
  /** Whether the task completed successfully. */
  success: boolean;
  /** Output data from successful execution. */
  output?: TOutput;
  /** Error information if the task failed. */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
  /** Task execution metrics. */
  metrics: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
    retriesUsed: number;
  };
}

/**
 * Handle for interacting with a running task.
 */
export interface TaskHandle<TOutput = unknown> {
  /** Unique task identifier. */
  taskId: string;
  /** Promise that resolves when the task completes. */
  promise: Promise<TaskResult<TOutput>>;
  /** Cancel the task if it's still running. */
  cancel: () => Promise<void>;
}

/**
 * Current status snapshot of a task.
 */
export interface TaskStatusSnapshot {
  taskId: string;
  status: TaskStatus;
  progress?: number;
  message?: string;
  startedAt?: string;
  updatedAt: string;
}

/**
 * Function that executes a task.
 */
export type TaskExecutor<TInput = unknown, TOutput = unknown> = (
  task: Task<TInput, TOutput>,
  signal: AbortSignal,
) => Promise<TOutput>;

/**
 * Options for the AsyncTaskExecutor.
 */
export interface AsyncTaskExecutorOptions {
  /** Maximum number of concurrent tasks (default: 5). */
  maxConcurrency?: number;
  /** Default timeout for tasks in milliseconds (default: 0 = no timeout). */
  defaultTimeout?: number;
  /** Default retry count for tasks (default: 0). */
  defaultRetries?: number;
}

// ----------------------------------------------------------------------------
// Events
// ----------------------------------------------------------------------------

export interface AsyncTaskExecutorEvents {
  "task:started": (taskId: string, task: Task) => void;
  "task:progress": (taskId: string, progress: number, message?: string) => void;
  "task:completed": (taskId: string, result: TaskResult) => void;
  "task:failed": (taskId: string, result: TaskResult) => void;
  "task:cancelled": (taskId: string) => void;
  "task:retry": (taskId: string, attempt: number, maxRetries: number) => void;
  "queue:empty": () => void;
  "queue:full": () => void;
}

// ----------------------------------------------------------------------------
// Task Execution State
// ----------------------------------------------------------------------------

interface TaskExecutionState<TInput = unknown, TOutput = unknown> {
  task: Task<TInput, TOutput>;
  status: TaskStatus;
  executor: TaskExecutor<TInput, TOutput>;
  abortController: AbortController;
  startedAt?: Date;
  updatedAt: Date;
  progress: number;
  message?: string;
  retriesUsed: number;
  promise: Promise<TaskResult<TOutput>>;
  resolve: (result: TaskResult<TOutput>) => void;
  reject: (error: Error) => void;
}

// ----------------------------------------------------------------------------
// AsyncTaskExecutor
// ----------------------------------------------------------------------------

/**
 * Async task executor with event-driven completion, cancellation, and status tracking.
 */
export class AsyncTaskExecutor extends EventEmitter {
  private options: Required<AsyncTaskExecutorOptions>;
  private tasks: Map<string, TaskExecutionState<unknown, unknown>> = new Map();
  private queue: Array<{ task: Task<unknown, unknown>; executor: TaskExecutor<unknown, unknown> }> = [];
  private runningCount = 0;

  constructor(options: AsyncTaskExecutorOptions = {}) {
    super();
    this.options = {
      maxConcurrency: options.maxConcurrency ?? 5,
      defaultTimeout: options.defaultTimeout ?? 0,
      defaultRetries: options.defaultRetries ?? 0,
    };
  }

  /**
   * Start executing a task and return a handle immediately.
   */
  startTask<TInput = unknown, TOutput = unknown>(
    task: Task<TInput, TOutput>,
    executor: TaskExecutor<TInput, TOutput>,
  ): TaskHandle<TOutput> {
    // Create abort controller for cancellation
    const abortController = new AbortController();

    // Create promise that will be resolved when task completes
    let resolve: (result: TaskResult<TOutput>) => void;
    let reject: (error: Error) => void;
    const promise = new Promise<TaskResult<TOutput>>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    // Create task state
    const state: TaskExecutionState<TInput, TOutput> = {
      task,
      status: "pending",
      executor,
      abortController,
      updatedAt: new Date(),
      progress: 0,
      retriesUsed: 0,
      promise,
      resolve: resolve!,
      reject: reject!,
    };

    // Store task state (cast to unknown for map storage)
    this.tasks.set(task.id, state as TaskExecutionState<unknown, unknown>);

    // Add to queue or start immediately
    if (this.runningCount < this.options.maxConcurrency) {
      void this.executeTask(task.id);
    } else {
      this.queue.push({ task: task as Task<unknown, unknown>, executor: executor as TaskExecutor<unknown, unknown> });
      this.emit("queue:full");
    }

    return {
      taskId: task.id,
      promise,
      cancel: async () => this.cancelTask(task.id),
    };
  }

  /**
   * Execute a task from the queue or directly.
   */
  private async executeTask(taskId: string): Promise<void> {
    const state = this.tasks.get(taskId);
    if (!state) {
      return;
    }

    this.runningCount++;
    state.status = "running";
    state.startedAt = new Date();
    state.updatedAt = new Date();

    this.emit("task:started", taskId, state.task);

    try {
      const result = await this.executeWithRetries(state);
      state.status = "completed";
      state.resolve(result);
      this.emit("task:completed", taskId, result);
    } catch (error) {
      state.status = "failed";
      const result: TaskResult = {
        task: state.task,
        success: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        metrics: {
          startedAt: state.startedAt?.toISOString() ?? new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: state.startedAt ? Date.now() - state.startedAt.getTime() : 0,
          retriesUsed: state.retriesUsed,
        },
      };
      state.resolve(result);
      this.emit("task:failed", taskId, result);
    } finally {
      this.runningCount--;
      this.processQueue();
    }
  }

  /**
   * Execute a task with retry logic.
   */
  private async executeWithRetries(
    state: TaskExecutionState<unknown, unknown>,
  ): Promise<TaskResult<unknown>> {
    const maxRetries = state.task.retries ?? this.options.defaultRetries;
    const timeout = state.task.timeout ?? this.options.defaultTimeout;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (state.abortController.signal.aborted) {
        throw new Error("Task was cancelled");
      }

      if (attempt > 0) {
        state.retriesUsed = attempt;
        this.emit("task:retry", state.task.id, attempt, maxRetries);
      }

      try {
        // Create timeout signal if needed
        let timeoutId: NodeJS.Timeout | undefined;
        const timeoutPromise =
          timeout > 0
            ? new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                  reject(new Error(`Task timed out after ${timeout}ms`));
                }, timeout);
              })
            : null;

        // Execute task with abort signal
        const output: unknown = await (timeoutPromise
          ? Promise.race([state.executor(state.task, state.abortController.signal), timeoutPromise])
          : state.executor(state.task, state.abortController.signal));

        if (timeoutId) clearTimeout(timeoutId);

        // Success — return result
        return {
          task: state.task,
          success: true,
          output,
          metrics: {
            startedAt: state.startedAt?.toISOString() ?? new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: state.startedAt ? Date.now() - state.startedAt.getTime() : 0,
            retriesUsed: state.retriesUsed,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // If this is the last attempt, throw
        if (attempt === maxRetries) {
          throw lastError;
        }

        // Otherwise, continue to next retry
      }
    }

    // Should never reach here, but TypeScript needs this
    throw lastError ?? new Error("Task failed with unknown error");
  }

  /**
   * Process the next task in the queue.
   */
  private processQueue(): void {
    if (this.runningCount >= this.options.maxConcurrency) {
      return;
    }

    // Sort queue by priority
    this.queue.sort((a, b) => {
      const priorityOrder = { critical: 3, high: 2, normal: 1, low: 0 };
      const aPriority = priorityOrder[a.task.priority ?? "normal"];
      const bPriority = priorityOrder[b.task.priority ?? "normal"];
      return bPriority - aPriority;
    });

    const next = this.queue.shift();
    if (next) {
      void this.executeTask(next.task.id);
    } else if (this.runningCount === 0) {
      this.emit("queue:empty");
    }
  }

  /**
   * Get the current status of a task.
   */
  async getStatus(taskId: string): Promise<TaskStatusSnapshot | null> {
    const state = this.tasks.get(taskId);
    if (!state) {
      return null;
    }

    return {
      taskId,
      status: state.status,
      progress: state.progress,
      message: state.message,
      startedAt: state.startedAt?.toISOString(),
      updatedAt: state.updatedAt.toISOString(),
    };
  }

  /**
   * Cancel a running task.
   */
  async cancelTask(taskId: string): Promise<void> {
    const state = this.tasks.get(taskId);
    if (!state) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (state.status === "completed" || state.status === "failed" || state.status === "cancelled") {
      return; // Already done
    }

    state.abortController.abort();
    state.status = "cancelled";
    state.updatedAt = new Date();

    // Remove from queue if pending
    this.queue = this.queue.filter((item) => item.task.id !== taskId);

    this.emit("task:cancelled", taskId);
  }

  /**
   * Wait for a task to complete.
   */
  async waitForCompletion<TOutput = unknown>(taskId: string): Promise<TaskResult<TOutput>> {
    const state = this.tasks.get(taskId);
    if (!state) {
      throw new Error(`Task ${taskId} not found`);
    }

    return state.promise as Promise<TaskResult<TOutput>>;
  }

  /**
   * Register a callback for task completion events.
   */
  onTaskComplete(callback: (taskId: string, result: TaskResult) => void): void {
    this.on("task:completed", callback);
  }

  /**
   * Get all active tasks.
   */
  getActiveTasks(): TaskStatusSnapshot[] {
    const snapshots: TaskStatusSnapshot[] = [];
    for (const [taskId, state] of this.tasks.entries()) {
      if (state.status !== "completed" && state.status !== "failed") {
        snapshots.push({
          taskId,
          status: state.status,
          progress: state.progress,
          message: state.message,
          startedAt: state.startedAt?.toISOString(),
          updatedAt: state.updatedAt.toISOString(),
        });
      }
    }
    return snapshots;
  }

  /**
   * Clear completed and failed tasks from memory.
   */
  cleanup(): void {
    for (const [taskId, state] of this.tasks.entries()) {
      if (state.status === "completed" || state.status === "failed" || state.status === "cancelled") {
        this.tasks.delete(taskId);
      }
    }
  }

  /**
   * Get executor statistics.
   */
  getStats(): {
    running: number;
    pending: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let running = 0;
    let pending = 0;

    for (const state of this.tasks.values()) {
      switch (state.status) {
        case "completed":
          completed++;
          break;
        case "failed":
          failed++;
          break;
        case "cancelled":
          cancelled++;
          break;
        case "running":
          running++;
          break;
        case "pending":
          pending++;
          break;
      }
    }

    return { running, pending, completed, failed, cancelled };
  }
}

/**
 * Create a new AsyncTaskExecutor instance.
 */
export function createAsyncTaskExecutor(options?: AsyncTaskExecutorOptions): AsyncTaskExecutor {
  return new AsyncTaskExecutor(options);
}

/**
 * Helper to create a simple task definition.
 */
export function createTask<TInput = unknown, TOutput = unknown>(
  name: string,
  input: TInput,
  options?: Partial<Task<TInput, TOutput>>,
): Task<TInput, TOutput> {
  return {
    id: options?.id ?? randomUUID(),
    name,
    input,
    description: options?.description,
    priority: options?.priority,
    timeout: options?.timeout,
    retries: options?.retries,
    tags: options?.tags,
  };
}
