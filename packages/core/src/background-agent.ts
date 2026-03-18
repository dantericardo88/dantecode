// ============================================================================
// @dantecode/core — Background Agent Runner
// Manages asynchronous agent tasks that run in the background while the user
// continues working. Tasks are queued, retried with a circuit breaker for
// long-running work, and persisted to checkpoints for resume flows.
// ============================================================================

import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type {
  BackgroundAgentTask,
  BackgroundAgentStatus,
  BackgroundTaskCheckpoint,
  DockerAgentConfig,
  SandboxExecResult,
  SandboxSpec,
  SelfImprovementContext,
  Session,
} from "@dantecode/config-types";
import { appendAuditEvent } from "./audit.js";
import { BackgroundTaskStore } from "./background-task-store.js";
import { CircuitBreaker } from "./circuit-breaker.js";

const execAsync = promisify(exec);
const SANDBOX_PACKAGE_NAME = "@dantecode/sandbox";
const CHECKPOINT_INTERVAL_MS = 300_000;

/** Callback for progress updates from a background task. */
export type BackgroundProgressCallback = (task: BackgroundAgentTask) => void;

export interface BackgroundRunnerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
}

/** Options passed when enqueuing a background agent task. */
export interface EnqueueOptions {
  /** Auto-commit touched files on successful completion */
  autoCommit?: boolean;
  /** Create a PR after auto-commit */
  createPR?: boolean;
  /** Run in Docker sandbox */
  docker?: boolean;
  /** Docker configuration */
  dockerConfig?: DockerAgentConfig;
  /** Enable checkpointing + retry behavior for long-running tasks */
  longRunning?: boolean;
  /** Resume a previously persisted task */
  resumeFromTaskId?: string;
  /** Explicit self-improvement context to carry into the task */
  selfImprovement?: SelfImprovementContext;
}

export interface BackgroundTaskContext {
  task: BackgroundAgentTask;
  dockerConfig?: DockerAgentConfig;
  runInDocker?: (command: string, timeoutMs?: number) => Promise<SandboxExecResult>;
  saveCheckpoint?: (label: string, sessionSnapshot?: Session) => Promise<BackgroundTaskCheckpoint>;
  getLatestCheckpoint?: () => BackgroundTaskCheckpoint | null;
}

/** Function that runs the actual agent work. Receives a progress reporter. */
export type AgentWorkFn = (
  prompt: string,
  onProgress: (message: string) => void,
  context: BackgroundTaskContext,
) => Promise<{ output: string; touchedFiles: string[] }>;

/**
 * Manages background agent tasks with queue and concurrency control.
 * Tasks run asynchronously and report progress via callbacks.
 */
export class BackgroundAgentRunner {
  private tasks: Map<string, BackgroundAgentTask> = new Map();
  private taskOptions: Map<string, EnqueueOptions> = new Map();
  private queue: string[] = [];
  private running = 0;
  private readonly maxConcurrent: number;
  private readonly projectRoot: string;
  private readonly breaker: CircuitBreaker;
  private readonly taskStore: BackgroundTaskStore;
  private readonly resetTimeoutMs: number;
  private readonly resumeTimers = new Map<string, NodeJS.Timeout>();
  private onProgress?: BackgroundProgressCallback;
  private workFn?: AgentWorkFn;
  private readonly restorePromise: Promise<void>;

  constructor(
    maxConcurrent = 1,
    projectRoot = process.cwd(),
    options: BackgroundRunnerOptions = {},
  ) {
    this.maxConcurrent = maxConcurrent;
    this.projectRoot = projectRoot;
    this.breaker = new CircuitBreaker({
      failureThreshold: options.failureThreshold ?? 5,
      resetTimeoutMs: options.resetTimeoutMs ?? 60_000,
    });
    this.resetTimeoutMs = this.breaker.getResetTimeoutMs();
    this.taskStore = new BackgroundTaskStore(projectRoot);
    this.restorePromise = this.restorePersistedTasks();
  }

  /** Set the function that does actual agent work. */
  setWorkFn(fn: AgentWorkFn): void {
    this.workFn = fn;
    void this.restorePromise.then(() => {
      this.processQueue();
    });
  }

  /** Returns whether a work function has been configured. */
  hasWorkFn(): boolean {
    return typeof this.workFn === "function";
  }

  /** Set a callback for progress updates. */
  setProgressCallback(cb: BackgroundProgressCallback): void {
    this.onProgress = cb;
  }

  /**
   * Enqueue a task. Returns the task ID immediately.
   * The task will be started when a slot is available.
   *
   * Accepts either a `DockerAgentConfig` (legacy) or an `EnqueueOptions`
   * object for richer control (auto-commit, PR creation, Docker).
   */
  enqueue(prompt: string, optionsOrDocker?: EnqueueOptions | DockerAgentConfig): string {
    const id = randomUUID().slice(0, 8);

    let options: EnqueueOptions | undefined;
    let dockerConfig: DockerAgentConfig | undefined;

    if (optionsOrDocker && "image" in optionsOrDocker) {
      dockerConfig = optionsOrDocker as DockerAgentConfig;
      options = { dockerConfig };
    } else if (optionsOrDocker) {
      options = optionsOrDocker as EnqueueOptions;
      dockerConfig = options.dockerConfig;
    }

    const task: BackgroundAgentTask = {
      id,
      prompt,
      status: "queued",
      createdAt: new Date().toISOString(),
      progress: "Waiting in queue...",
      touchedFiles: [],
      attemptCount: 0,
      breakerState: "closed",
      checkpoints: [],
      longRunning: options?.longRunning ?? false,
      resumeFromTaskId: options?.resumeFromTaskId,
      selfImprovement: options?.selfImprovement,
      ...(dockerConfig ? { dockerConfig } : {}),
    };

    this.tasks.set(id, task);
    if (options) {
      this.taskOptions.set(id, options);
    }
    this.queue.push(id);
    this.notifyProgress(task);
    void this.persistTask(task);
    this.processQueue();
    return id;
  }

  /** Manually resumes a persisted paused or failed task from its latest checkpoint. */
  async resume(taskId: string): Promise<boolean> {
    await this.restorePromise;

    let task = this.tasks.get(taskId) ?? undefined;
    if (!task) {
      task = (await this.taskStore.loadTask(taskId)) ?? undefined;
    }
    if (!task) return false;
    if (task.status === "completed" || task.status === "cancelled") return false;

    this.clearResumeTimer(task.id);
    task.status = "queued";
    task.progress = `Resuming from checkpoint ${task.checkpointId ?? "latest"}`;
    task.nextRetryAt = undefined;
    task.resumeFromTaskId = task.resumeFromTaskId ?? taskId;
    this.tasks.set(task.id, task);
    if (!this.queue.includes(task.id)) {
      this.queue.push(task.id);
    }
    await this.persistTask(task);
    this.notifyProgress(task);
    this.processQueue();
    return true;
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

    this.clearResumeTimer(id);
    task.status = "cancelled";
    task.completedAt = new Date().toISOString();
    task.progress = "Cancelled by user";
    this.queue = this.queue.filter((qId) => qId !== id);
    this.notifyProgress(task);
    void this.persistTask(task);
    return true;
  }

  /** Get count of tasks by status. */
  getStatusCounts(): Record<BackgroundAgentStatus, number> {
    const counts: Record<BackgroundAgentStatus, number> = {
      queued: 0,
      running: 0,
      paused: 0,
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
        this.taskOptions.delete(id);
        this.clearResumeTimer(id);
        void this.taskStore.deleteTask(id);
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
      if (!task || task.status === "cancelled" || task.status === "paused") continue;
      this.runTask(task);
    }
  }

  /** Run a single task. */
  private runTask(task: BackgroundAgentTask): void {
    this.running++;
    task.status = "running";
    task.startedAt = task.startedAt ?? new Date().toISOString();
    task.progress =
      task.resumeFromTaskId || task.checkpointId
        ? `Resuming from checkpoint ${task.checkpointId ?? "latest"}`
        : "Starting...";
    this.notifyProgress(task);
    void this.persistTask(task);

    const execute = async () => {
      if (!this.workFn) {
        task.status = "failed";
        task.error = "No work function configured";
        task.completedAt = new Date().toISOString();
        task.progress = "Failed";
        await this.persistTask(task);
        this.notifyProgress(task);
        this.running--;
        this.processQueue();
        return;
      }

      const { context, cleanup } = await this.createTaskContext(task);
      let checkpointTimer: NodeJS.Timeout | undefined;

      try {
        await context.saveCheckpoint?.("task-start");
        if (task.longRunning) {
          checkpointTimer = setInterval(() => {
            void context.saveCheckpoint?.("heartbeat");
          }, CHECKPOINT_INTERVAL_MS);
        }

        const result = await this.breaker.execute(task.id, async () =>
          this.workFn!(
            task.prompt,
            (message) => {
              if (task.status === "cancelled") return;
              task.progress = message;
              this.notifyProgress(task);
              void this.persistTask(task);
            },
            context,
          ),
        );

        if (task.status === "cancelled") return;

        task.status = "completed";
        task.breakerState = this.breaker.getState(task.id);
        task.output = result.output;
        task.touchedFiles = result.touchedFiles;
        task.completedAt = new Date().toISOString();
        task.progress = "Done";
        task.nextRetryAt = undefined;

        if (result.touchedFiles.length > 0) {
          await context.saveCheckpoint?.("write-batch");
        }
        await context.saveCheckpoint?.("completed");
        await this.postCompletionHook(task);
      } catch (err: unknown) {
        if (task.status !== "cancelled") {
          await this.handleTaskFailure(task, err, context);
        }
      } finally {
        if (checkpointTimer) {
          clearInterval(checkpointTimer);
        }
        await cleanup();
      }

      this.notifyProgress(task);
      this.running--;
      this.processQueue();
    };

    void execute();
  }

  private async handleTaskFailure(
    task: BackgroundAgentTask,
    err: unknown,
    context: BackgroundTaskContext,
  ): Promise<void> {
    task.error = err instanceof Error ? err.message : String(err);
    task.attemptCount = (task.attemptCount ?? 0) + 1;
    task.breakerState = this.breaker.getState(task.id);

    if (!task.longRunning) {
      task.status = "failed";
      task.completedAt = new Date().toISOString();
      task.progress = "Failed";
      await context.saveCheckpoint?.("failed");
      await this.persistTask(task);
      return;
    }

    if (task.breakerState === "open") {
      task.status = "paused";
      task.progress = `Circuit opened after ${this.breaker.getFailureThreshold()} fails - pausing task for ${Math.ceil(this.resetTimeoutMs / 1000)}s cooldown`;
      task.nextRetryAt = new Date(Date.now() + this.resetTimeoutMs).toISOString();
      await context.saveCheckpoint?.("pre-cooldown");
      await this.persistTask(task);
      this.scheduleResume(task.id);
      return;
    }

    task.status = "queued";
    task.progress = `Retrying after failure ${task.attemptCount}/${this.breaker.getFailureThreshold()}: ${task.error}`;
    await context.saveCheckpoint?.("failed");
    await this.persistTask(task);
    this.queue.push(task.id);
  }

  private scheduleResume(taskId: string): void {
    this.clearResumeTimer(taskId);

    const timer = setTimeout(() => {
      void this.resume(taskId);
    }, this.resetTimeoutMs);

    this.resumeTimers.set(taskId, timer);
  }

  private clearResumeTimer(taskId: string): void {
    const timer = this.resumeTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.resumeTimers.delete(taskId);
    }
  }

  private async restorePersistedTasks(): Promise<void> {
    await this.taskStore.cleanupExpired(7);
    const persistedTasks = await this.taskStore.listTasks();

    for (const task of persistedTasks) {
      if (this.tasks.has(task.id)) {
        continue;
      }
      this.tasks.set(task.id, task);

      if (
        task.status === "queued" ||
        task.status === "running" ||
        (task.status === "paused" && task.nextRetryAt && new Date(task.nextRetryAt).getTime() <= Date.now())
      ) {
        task.status = task.status === "paused" ? "queued" : task.status;
        if (!this.queue.includes(task.id)) {
          this.queue.push(task.id);
        }
      } else if (task.status === "paused" && task.nextRetryAt) {
        this.scheduleResume(task.id);
      }
    }
  }

  private async persistTask(task: BackgroundAgentTask): Promise<void> {
    await this.taskStore.saveTask(task);
    await this.taskStore.cleanupExpired(7);
  }

  private async saveCheckpoint(
    task: BackgroundAgentTask,
    label: string,
    sessionSnapshot?: Session,
  ): Promise<BackgroundTaskCheckpoint> {
    const checkpoint: BackgroundTaskCheckpoint = {
      id: randomUUID().slice(0, 8),
      label,
      createdAt: new Date().toISOString(),
      sessionSnapshot,
      touchedFiles: [...task.touchedFiles],
      progress: task.progress,
    };

    task.checkpoints = [...(task.checkpoints ?? []), checkpoint].slice(-20);
    task.checkpointId = checkpoint.id;
    await this.persistTask(task);
    return checkpoint;
  }

  /**
   * Runs after a task completes successfully. Handles auto-commit and
   * PR creation when the corresponding EnqueueOptions flags are set.
   */
  private async postCompletionHook(task: BackgroundAgentTask): Promise<void> {
    const options = this.taskOptions.get(task.id);
    if (!options) {
      await this.persistTask(task);
      return;
    }
    if (!task.touchedFiles || task.touchedFiles.length === 0) {
      await this.persistTask(task);
      return;
    }

    if (options.autoCommit) {
      try {
        const files = task.touchedFiles.map((f) => `"${f.replace(/"/g, '\\"')}"`).join(" ");
        const commitMsg = `feat: ${task.prompt.slice(0, 72).replace(/"/g, '\\"')}`;
        await execAsync(`git add ${files} && git commit -m "${commitMsg}"`, {
          cwd: this.projectRoot,
        });
        task.progress = "Auto-committed changes";
        this.notifyProgress(task);
      } catch {
        // Non-fatal: commit failure should not fail the task
      }
    }

    if (options.createPR) {
      try {
        const title = task.prompt.slice(0, 72).replace(/"/g, '\\"');
        const fileList = task.touchedFiles.map((f) => `- ${f}`).join("\\n");
        const body = `Automated PR from DanteCode background agent.\\n\\nTask: ${task.prompt.replace(/"/g, '\\"')}\\n\\nFiles changed:\\n${fileList}`;
        await execAsync(`gh pr create --title "${title}" --body "${body}"`, {
          cwd: this.projectRoot,
        });
        task.progress = "PR created";
        this.notifyProgress(task);
      } catch (err) {
        task.progress = `Committed but PR creation failed: ${err instanceof Error ? err.message : String(err)}`;
        this.notifyProgress(task);
      }
    }

    await this.persistTask(task);
  }

  /** Notify the progress callback. */
  private notifyProgress(task: BackgroundAgentTask): void {
    this.onProgress?.(task);
  }

  private async createTaskContext(task: BackgroundAgentTask): Promise<{
    context: BackgroundTaskContext;
    cleanup: () => Promise<void>;
  }> {
    const baseContext: Pick<BackgroundTaskContext, "task" | "saveCheckpoint" | "getLatestCheckpoint"> = {
      task,
      saveCheckpoint: (label: string, sessionSnapshot?: Session) =>
        this.saveCheckpoint(task, label, sessionSnapshot),
      getLatestCheckpoint: () => task.checkpoints?.[task.checkpoints.length - 1] ?? null,
    };

    if (!task.dockerConfig) {
      return {
        context: baseContext,
        cleanup: async () => {},
      };
    }

    try {
      const { SandboxManager, SandboxExecutor } = await import(SANDBOX_PACKAGE_NAME);
      const spec: SandboxSpec = {
        image: task.dockerConfig.image,
        workdir: "/workspace",
        networkMode: task.dockerConfig.networkMode ?? "bridge",
        mounts: [
          {
            hostPath: this.projectRoot,
            containerPath: "/workspace",
            readonly: task.dockerConfig.readOnlyMount ?? false,
          },
        ],
        env: {},
        memoryLimitMb: task.dockerConfig.memoryLimitMb ?? 2048,
        cpuLimit: task.dockerConfig.cpuLimit ?? 2,
        timeoutMs: 300_000,
      };

      const manager = new SandboxManager(spec);
      await manager.start();
      const executor = new SandboxExecutor(manager, this.projectRoot, appendAuditEvent);

      return {
        context: {
          ...baseContext,
          dockerConfig: task.dockerConfig,
          runInDocker: (command: string, timeoutMs?: number) => executor.run(command, timeoutMs),
        },
        cleanup: async () => {
          await manager.stop();
        },
      };
    } catch {
      return {
        context: {
          ...baseContext,
          dockerConfig: task.dockerConfig,
          runInDocker: (command: string, timeoutMs?: number) =>
            this.runCommandOnHost(command, timeoutMs),
        },
        cleanup: async () => {},
      };
    }
  }

  private async runCommandOnHost(command: string, timeoutMs?: number): Promise<SandboxExecResult> {
    const startedAt = Date.now();

    try {
      const result = await execAsync(command, {
        cwd: this.projectRoot,
        timeout: timeoutMs,
      });

      return {
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      };
    } catch (error: unknown) {
      const execError = error as Error & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        signal?: string;
      };

      return {
        exitCode: typeof execError.code === "number" ? execError.code : -1,
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? execError.message,
        durationMs: Date.now() - startedAt,
        timedOut: execError.signal === "SIGTERM",
      };
    }
  }
}
