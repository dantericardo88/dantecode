// ============================================================================
// @dantecode/core — Background Agent Runner
// Manages asynchronous agent tasks that run in the background while the user
// continues working. Tasks are queued, executed with concurrency limits, and
// report progress via callbacks.
// ============================================================================

import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type {
  BackgroundAgentTask,
  BackgroundAgentStatus,
  DockerAgentConfig,
  SandboxExecResult,
  SandboxSpec,
} from "@dantecode/config-types";
import { appendAuditEvent } from "./audit.js";

const execAsync = promisify(exec);
const SANDBOX_PACKAGE_NAME = "@dantecode/sandbox";

/** Callback for progress updates from a background task. */
export type BackgroundProgressCallback = (task: BackgroundAgentTask) => void;

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
}

export interface BackgroundTaskContext {
  task: BackgroundAgentTask;
  dockerConfig?: DockerAgentConfig;
  runInDocker?: (command: string, timeoutMs?: number) => Promise<SandboxExecResult>;
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
  private onProgress?: BackgroundProgressCallback;
  private workFn?: AgentWorkFn;

  constructor(maxConcurrent = 1, projectRoot = process.cwd()) {
    this.maxConcurrent = maxConcurrent;
    this.projectRoot = projectRoot;
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
   *
   * Accepts either a `DockerAgentConfig` (legacy) or an `EnqueueOptions`
   * object for richer control (auto-commit, PR creation, Docker).
   */
  enqueue(prompt: string, optionsOrDocker?: EnqueueOptions | DockerAgentConfig): string {
    const id = randomUUID().slice(0, 8);

    // Normalize: legacy callers pass a DockerAgentConfig directly.
    let options: EnqueueOptions | undefined;
    let dockerConfig: DockerAgentConfig | undefined;

    if (optionsOrDocker && "autoCommit" in optionsOrDocker) {
      options = optionsOrDocker as EnqueueOptions;
      dockerConfig = options.dockerConfig;
    } else if (optionsOrDocker && "image" in optionsOrDocker) {
      dockerConfig = optionsOrDocker as DockerAgentConfig;
      options = { dockerConfig };
    }

    const task: BackgroundAgentTask = {
      id,
      prompt,
      status: "queued",
      createdAt: new Date().toISOString(),
      progress: "Waiting in queue...",
      touchedFiles: [],
      ...(dockerConfig ? { dockerConfig } : {}),
    };
    this.tasks.set(id, task);
    if (options) {
      this.taskOptions.set(id, options);
    }
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
        this.taskOptions.delete(id);
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

      const { context, cleanup } = await this.createTaskContext(task);

      try {
        const result = await this.workFn(
          task.prompt,
          (message) => {
            if (task.status === "cancelled") return;
            task.progress = message;
            this.notifyProgress(task);
          },
          context,
        );

        if (task.status === "cancelled") return;
        task.status = "completed";
        task.output = result.output;
        task.touchedFiles = result.touchedFiles;
        task.completedAt = new Date().toISOString();
        task.progress = "Done";

        // ── Post-completion hook: auto-commit & PR creation ──
        await this.postCompletionHook(task);
      } catch (err: unknown) {
        if (task.status === "cancelled") return;
        task.status = "failed";
        task.error = err instanceof Error ? err.message : String(err);
        task.completedAt = new Date().toISOString();
        task.progress = "Failed";
      } finally {
        await cleanup();
      }

      this.notifyProgress(task);
      this.running--;
      this.processQueue();
    };

    execute();
  }

  /**
   * Runs after a task completes successfully. Handles auto-commit and
   * PR creation when the corresponding EnqueueOptions flags are set.
   */
  private async postCompletionHook(task: BackgroundAgentTask): Promise<void> {
    const options = this.taskOptions.get(task.id);
    if (!options) return;
    if (!task.touchedFiles || task.touchedFiles.length === 0) return;

    // Auto-commit if requested
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

    // Create PR if requested (implies auto-commit already happened above)
    if (options.createPR) {
      try {
        const title = task.prompt.slice(0, 72).replace(/"/g, '\\"');
        const fileList = task.touchedFiles.map((f) => `- ${f}`).join("\\n");
        const body = `Automated PR from DanteCode background agent.\\n\\nTask: ${task.prompt.replace(/"/g, '\\"')}\\n\\nFiles changed:\\n${fileList}`;
        await execAsync(
          `gh pr create --title "${title}" --body "${body}"`,
          { cwd: this.projectRoot },
        );
        task.progress = "PR created";
        this.notifyProgress(task);
      } catch (err) {
        task.progress = `Committed but PR creation failed: ${err instanceof Error ? err.message : String(err)}`;
        this.notifyProgress(task);
      }
    }
  }

  /** Notify the progress callback. */
  private notifyProgress(task: BackgroundAgentTask): void {
    this.onProgress?.(task);
  }

  private async createTaskContext(task: BackgroundAgentTask): Promise<{
    context: BackgroundTaskContext;
    cleanup: () => Promise<void>;
  }> {
    if (!task.dockerConfig) {
      return {
        context: { task },
        cleanup: async () => {},
      };
    }

    try {
      // Keep sandbox loading as a runtime-only dependency so core does not
      // bundle sandbox's optional native Docker transport dependencies.
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
          task,
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
          task,
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
