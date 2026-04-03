// ============================================================================
// @dantecode/sandbox — Docker Container Lifecycle Management
// ============================================================================

import Docker from "dockerode";
import type { SandboxSpec, SandboxExecResult } from "@dantecode/config-types";

/**
 * Options for executing a command inside the sandbox container.
 */
export interface ExecOptions {
  /** Working directory inside the container. Defaults to the spec's workdir. */
  cwd?: string;
  /** Additional environment variables for this execution only. */
  env?: Record<string, string>;
  /** Timeout in milliseconds for this execution. 0 means no timeout. */
  timeoutMs?: number;
  /** Whether to allocate a pseudo-TTY. Defaults to false. */
  tty?: boolean;
}

/**
 * Manages the lifecycle of a single Docker sandbox container.
 *
 * Handles image pulling, container creation with resource limits,
 * command execution with stdout/stderr capture, snapshotting for
 * rollback, and graceful teardown.
 */
export class SandboxManager {
  private readonly spec: SandboxSpec;
  private readonly docker: Docker;
  private containerId: string | null = null;
  private container: Docker.Container | null = null;

  constructor(spec: SandboxSpec) {
    this.spec = spec;
    this.docker = new Docker();
  }

  /**
   * Pulls the container image if it is not already present on the host,
   * then creates and starts a sandbox container according to the spec.
   *
   * The container is created with:
   * - Resource limits (memory, CPU) from the spec
   * - Bind mounts from the spec
   * - Environment variables from the spec
   * - Network mode from the spec
   * - A long-running entrypoint (`sleep infinity`) to keep it alive
   *
   * @returns The Docker container ID.
   */
  async start(): Promise<string> {
    if (this.containerId !== null) {
      throw new Error(
        `SandboxManager: container already running (${this.containerId}). Call stop() first.`,
      );
    }

    await this.pullImageIfNeeded(this.spec.image);

    const binds: string[] = this.spec.mounts.map((m) => {
      const mode = m.readonly ? "ro" : "rw";
      return `${m.hostPath}:${m.containerPath}:${mode}`;
    });

    const envArray: string[] = Object.entries(this.spec.env).map(
      ([key, value]) => `${key}=${value}`,
    );

    const cpuPeriod = 100000;
    const cpuQuota = Math.round(this.spec.cpuLimit * cpuPeriod);

    const created = await this.docker.createContainer({
      Image: this.spec.image,
      Cmd: ["sleep", "infinity"],
      WorkingDir: this.spec.workdir,
      Env: envArray,
      HostConfig: {
        Binds: binds,
        NetworkMode: this.spec.networkMode,
        Memory: this.spec.memoryLimitMb * 1024 * 1024,
        CpuPeriod: cpuPeriod,
        CpuQuota: cpuQuota,
        AutoRemove: false,
      },
      Labels: {
        "dantecode.sandbox": "true",
        "dantecode.sandbox.created": new Date().toISOString(),
      },
    });

    await created.start();

    this.container = created;
    this.containerId = created.id;

    return this.containerId;
  }

  /**
   * Executes a command inside the running sandbox container.
   *
   * Creates a Docker exec instance, starts it in detached mode, and
   * collects stdout and stderr. Supports optional timeout enforcement.
   *
   * @param command - The shell command to execute (run via `sh -c`).
   * @param options - Optional execution parameters.
   * @returns A SandboxExecResult with exit code, output, timing, and timeout status.
   */
  async exec(command: string, options?: ExecOptions): Promise<SandboxExecResult> {
    if (this.container === null) {
      throw new Error("SandboxManager: no container is running. Call start() first.");
    }

    const execEnv: string[] = options?.env
      ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`)
      : [];

    const cmd: string[] = ["sh", "-c", command];

    const execInstance = await this.container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      Tty: options?.tty ?? false,
      WorkingDir: options?.cwd ?? this.spec.workdir,
      Env: execEnv.length > 0 ? execEnv : undefined,
    });

    const startTime = Date.now();
    const timeoutMs = options?.timeoutMs ?? this.spec.timeoutMs;

    const stream = await execInstance.start({ Detach: false, Tty: options?.tty ?? false });

    const { stdout, stderr, timedOut } = await this.collectOutput(stream, timeoutMs);

    const durationMs = Date.now() - startTime;

    let exitCode = -1;
    if (!timedOut) {
      const inspectResult = await execInstance.inspect();
      exitCode = inspectResult.ExitCode ?? -1;
    }

    return {
      exitCode,
      stdout,
      stderr,
      durationMs,
      timedOut,
    };
  }

  /**
   * Stops and removes the sandbox container, cleaning up all resources.
   * If the container is not running, this is a no-op.
   */
  async stop(): Promise<void> {
    if (this.container === null) {
      return;
    }

    try {
      const info = await this.container.inspect();
      if (info.State.Running) {
        await this.container.stop({ t: 5 });
      }
    } catch (err: unknown) {
      // Container may already be stopped; that is acceptable
      if (!isDockerNotFoundError(err)) {
        throw err;
      }
    }

    try {
      await this.container.remove({ force: true });
    } catch (err: unknown) {
      if (!isDockerNotFoundError(err)) {
        throw err;
      }
    }

    this.container = null;
    this.containerId = null;
  }

  /**
   * Checks whether the sandbox container is currently running.
   */
  async isRunning(): Promise<boolean> {
    if (this.container === null) {
      return false;
    }

    try {
      const info = await this.container.inspect();
      return info.State.Running === true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the current container ID, or null if no container is active.
   */
  getContainerId(): string | null {
    return this.containerId;
  }

  /**
   * Creates a snapshot (Docker commit) of the current container filesystem.
   *
   * This allows the container state to be captured at a point in time and
   * later restored via `restore()`.
   *
   * @returns The snapshot image ID.
   */
  async snapshot(): Promise<string> {
    if (this.container === null) {
      throw new Error("SandboxManager: no container is running. Call start() first.");
    }

    const repo = "dantecode-sandbox-snapshot";
    const tag = `snap-${Date.now()}`;

    const commitResult = await this.container.commit({
      repo,
      tag,
      comment: `DanteCode sandbox snapshot at ${new Date().toISOString()}`,
      pause: true,
    });

    const snapshotId: string =
      typeof commitResult === "object" && commitResult !== null && "Id" in commitResult
        ? String((commitResult as { Id: string }).Id)
        : `${repo}:${tag}`;

    return snapshotId;
  }

  /**
   * Restores the sandbox container from a previously created snapshot.
   *
   * This stops and removes the current container, then creates and starts
   * a new container from the snapshot image, preserving all original spec
   * settings (mounts, env, limits, network).
   *
   * @param snapshotId - The image ID or `repo:tag` string from a previous `snapshot()` call.
   * @returns The new container ID.
   */
  async restore(snapshotId: string): Promise<string> {
    await this.stop();

    const originalImage = this.spec.image;

    // Temporarily override the image to the snapshot for container creation
    const restoreSpec: SandboxSpec = {
      ...this.spec,
      image: snapshotId,
    };

    const binds: string[] = restoreSpec.mounts.map((m) => {
      const mode = m.readonly ? "ro" : "rw";
      return `${m.hostPath}:${m.containerPath}:${mode}`;
    });

    const envArray: string[] = Object.entries(restoreSpec.env).map(
      ([key, value]) => `${key}=${value}`,
    );

    const cpuPeriod = 100000;
    const cpuQuota = Math.round(restoreSpec.cpuLimit * cpuPeriod);

    const created = await this.docker.createContainer({
      Image: snapshotId,
      Cmd: ["sleep", "infinity"],
      WorkingDir: restoreSpec.workdir,
      Env: envArray,
      HostConfig: {
        Binds: binds,
        NetworkMode: restoreSpec.networkMode,
        Memory: restoreSpec.memoryLimitMb * 1024 * 1024,
        CpuPeriod: cpuPeriod,
        CpuQuota: cpuQuota,
        AutoRemove: false,
      },
      Labels: {
        "dantecode.sandbox": "true",
        "dantecode.sandbox.created": new Date().toISOString(),
        "dantecode.sandbox.restored_from": snapshotId,
        "dantecode.sandbox.original_image": originalImage,
      },
    });

    await created.start();

    this.container = created;
    this.containerId = created.id;

    return this.containerId;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Pulls the Docker image if it is not already available locally.
   */
  private async pullImageIfNeeded(image: string): Promise<void> {
    try {
      const img = this.docker.getImage(image);
      await img.inspect();
      // Image exists locally, no pull needed
    } catch {
      // Image not found locally — pull it
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) {
            reject(new Error(`SandboxManager: failed to pull image "${image}": ${err.message}`));
            return;
          }

          // Follow the pull progress to completion
          this.docker.modem.followProgress(stream, (followErr: Error | null) => {
            if (followErr) {
              reject(
                new Error(
                  `SandboxManager: error during image pull "${image}": ${followErr.message}`,
                ),
              );
            } else {
              resolve();
            }
          });
        });
      });
    }
  }

  /**
   * Collects stdout and stderr from a Docker exec stream.
   *
   * Docker multiplexes stdout and stderr into a single stream using an
   * 8-byte header per frame: bytes 0 = stream type (1=stdout, 2=stderr),
   * bytes 4-7 = frame payload length (big-endian uint32).
   *
   * If the timeout is reached before the stream ends, the collection
   * is aborted and `timedOut` is set to true.
   */
  private collectOutput(
    stream: NodeJS.ReadableStream,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;
      let settled = false;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
          timedOut,
        });
      };

      // Set up timeout if a positive value is specified
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              try {
                stream.removeAllListeners();
                if (
                  "destroy" in stream &&
                  typeof (stream as { destroy: unknown }).destroy === "function"
                ) {
                  (stream as { destroy: () => void }).destroy();
                }
              } catch {
                // Best-effort cleanup on timeout
              }
              finish();
            }, timeoutMs)
          : setTimeout(() => {
              // No-op timer; will never fire realistically
            }, 2_147_483_647);

      // Demultiplex the Docker stream
      const demuxOutput = {
        write(chunk: Buffer): boolean {
          stdoutChunks.push(chunk);
          return true;
        },
        end(): void {
          // handled by finish()
        },
      };

      const demuxError = {
        write(chunk: Buffer): boolean {
          stderrChunks.push(chunk);
          return true;
        },
        end(): void {
          // handled by finish()
        },
      };

      // Use Docker modem to demux the stream into separate stdout/stderr
      try {
        this.docker.modem.demuxStream(
          stream as NodeJS.ReadWriteStream,
          demuxOutput as unknown as NodeJS.WritableStream,
          demuxError as unknown as NodeJS.WritableStream,
        );
      } catch {
        // If demuxStream is not available, fall back to raw reading
        stream.on("data", (chunk: Buffer) => {
          stdoutChunks.push(chunk);
        });
      }

      stream.on("end", finish);
      stream.on("close", finish);
      stream.on("error", finish);
    });
  }
}

/**
 * Checks whether a Docker API error indicates a 404 (not found) condition.
 */
function isDockerNotFoundError(err: unknown): boolean {
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (message.includes("no such container") || message.includes("not found")) {
      return true;
    }
    if ("statusCode" in err && (err as { statusCode: number }).statusCode === 404) {
      return true;
    }
  }
  return false;
}
