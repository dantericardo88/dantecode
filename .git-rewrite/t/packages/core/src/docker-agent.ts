// ============================================================================
// @dantecode/core — Docker Agent
// Runs agent tasks in isolated Docker containers. Project is mounted
// read-only by default; patches are collected via git diff.
// ============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DockerAgentOptions {
  image?: string;
  workdir?: string;
  networkMode?: "none" | "bridge" | "host";
  memoryLimitMb?: number;
  cpuLimit?: number;
  timeoutMs?: number;
  readOnlyMount?: boolean;
  env?: Record<string, string>;
}

export interface DockerAgentResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  patch?: string;
  timedOut: boolean;
}

export interface DockerCommandSpec {
  command: string;
  workdir?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Default options applied when not explicitly provided. */
const DEFAULT_OPTIONS: Required<DockerAgentOptions> = {
  image: "node:20-slim",
  workdir: "/workspace",
  networkMode: "none",
  memoryLimitMb: 2048,
  cpuLimit: 2,
  timeoutMs: 300_000,
  readOnlyMount: true,
  env: {},
};

// ─── DockerAgent Class ───────────────────────────────────────────────────────

/**
 * Runs agent tasks in isolated Docker containers using the Docker CLI.
 * The project directory is mounted read-only by default to prevent
 * uncontrolled mutations. Changes are collected as unified diffs via
 * `git diff` inside the container.
 */
export class DockerAgent {
  private readonly projectRoot: string;
  private readonly options: Required<DockerAgentOptions>;
  private containerId: string | null = null;

  constructor(projectRoot: string, options?: DockerAgentOptions) {
    this.projectRoot = projectRoot;
    this.options = {
      image: options?.image ?? DEFAULT_OPTIONS.image,
      workdir: options?.workdir ?? DEFAULT_OPTIONS.workdir,
      networkMode: options?.networkMode ?? DEFAULT_OPTIONS.networkMode,
      memoryLimitMb: options?.memoryLimitMb ?? DEFAULT_OPTIONS.memoryLimitMb,
      cpuLimit: options?.cpuLimit ?? DEFAULT_OPTIONS.cpuLimit,
      timeoutMs: options?.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
      readOnlyMount: options?.readOnlyMount ?? DEFAULT_OPTIONS.readOnlyMount,
      env: options?.env ?? { ...DEFAULT_OPTIONS.env },
    };
  }

  /** Get the current container ID, or null if not started. */
  getContainerId(): string | null {
    return this.containerId;
  }

  /** Get the resolved options for this agent. */
  getOptions(): Readonly<Required<DockerAgentOptions>> {
    return this.options;
  }

  /**
   * Start the Docker container in detached mode.
   * The project root is mounted into the container at the configured workdir.
   */
  async start(): Promise<void> {
    if (this.containerId) {
      throw new Error("Container already started");
    }

    const containerName = `dantecode-agent-${randomUUID().slice(0, 8)}`;

    const args: string[] = [
      "run",
      "--detach",
      "--name",
      containerName,
      "--workdir",
      this.options.workdir,
      "--network",
      this.options.networkMode,
      "--memory",
      `${this.options.memoryLimitMb}m`,
      "--cpus",
      String(this.options.cpuLimit),
    ];

    // Mount project directory
    const mountFlag = this.options.readOnlyMount ? ":ro" : "";
    args.push("--volume", `${this.projectRoot}:${this.options.workdir}${mountFlag}`);

    // Environment variables
    for (const [key, value] of Object.entries(this.options.env)) {
      args.push("--env", `${key}=${value}`);
    }

    // Image and entrypoint (sleep to keep container alive)
    args.push(this.options.image, "sleep", "infinity");

    try {
      const result = await execFileAsync("docker", args, {
        timeout: 30_000,
      });
      this.containerId = result.stdout.trim().slice(0, 12);
    } catch (err: unknown) {
      throw new Error(`Failed to start Docker container: ${errorMessage(err)}`);
    }
  }

  /**
   * Execute a command inside the running container.
   * Returns the stdout/stderr, exit code, and timing information.
   */
  async exec(spec: DockerCommandSpec): Promise<DockerAgentResult> {
    if (!this.containerId) {
      throw new Error("Container not started. Call start() first.");
    }

    const startedAt = Date.now();
    const timeout = spec.timeoutMs ?? this.options.timeoutMs;

    const args: string[] = ["exec"];

    // Working directory override
    if (spec.workdir) {
      args.push("--workdir", spec.workdir);
    }

    // Environment variables for this specific command
    if (spec.env) {
      for (const [key, value] of Object.entries(spec.env)) {
        args.push("--env", `${key}=${value}`);
      }
    }

    args.push(this.containerId, "sh", "-c", spec.command);

    try {
      const result = await execFileAsync("docker", args, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        success: true,
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startedAt;
      const execError = err as Error & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        signal?: string;
        killed?: boolean;
      };

      const timedOut = execError.killed === true || execError.signal === "SIGTERM";
      const exitCode = typeof execError.code === "number" ? execError.code : 1;

      return {
        success: false,
        exitCode,
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? execError.message,
        durationMs,
        timedOut,
      };
    }
  }

  /**
   * Run a full agent task lifecycle: start container (if needed),
   * execute the command, collect the git diff patch, and stop.
   */
  async runTask(command: string): Promise<DockerAgentResult> {
    const wasAlreadyStarted = this.containerId !== null;

    if (!wasAlreadyStarted) {
      await this.start();
    }

    try {
      const result = await this.exec({ command });
      const patch = await this.collectPatch();

      return {
        ...result,
        patch: patch || undefined,
      };
    } finally {
      if (!wasAlreadyStarted) {
        await this.stop();
      }
    }
  }

  /**
   * Collect the git diff (patch) from the container's working directory.
   * Returns the unified diff output, or an empty string if no changes.
   */
  async collectPatch(): Promise<string> {
    if (!this.containerId) {
      throw new Error("Container not started. Call start() first.");
    }

    try {
      const result = await this.exec({
        command: "git diff --no-color 2>/dev/null || echo ''",
        timeoutMs: 15_000,
      });

      return result.stdout.trim();
    } catch {
      // If git is not available or no repo, return empty
      return "";
    }
  }

  /**
   * Stop and remove the Docker container.
   * This is idempotent — calling stop on an already-stopped agent is a no-op.
   */
  async stop(): Promise<void> {
    if (!this.containerId) {
      return;
    }

    const id = this.containerId;
    this.containerId = null;

    try {
      // Force remove the container (handles both running and stopped states)
      await execFileAsync("docker", ["rm", "--force", id], {
        timeout: 15_000,
      });
    } catch {
      // Best-effort cleanup; container may already be gone
    }
  }

  /**
   * Check if Docker is available on the system by running `docker info`.
   * Returns true if the command succeeds, false otherwise.
   */
  static async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("docker", ["info"], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }
}
