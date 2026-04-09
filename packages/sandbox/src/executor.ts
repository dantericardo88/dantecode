// ============================================================================
// @dantecode/sandbox — High-Level Command Executor
// ============================================================================

import { execFile } from "node:child_process";
import type { SandboxSpec, SandboxExecResult, AuditEventType } from "@dantecode/config-types";
import { appendAuditEvent } from "@dantecode/core";
import { SandboxManager } from "./container.js";
import type { ExecOptions } from "./container.js";

/**
 * Interface for the audit logger function accepted by SandboxExecutor.
 *
 * This matches the signature of `appendAuditEvent` from @dantecode/core but
 * is expressed as a function type so callers can supply mocks or alternatives.
 */
export type AuditLoggerFn = typeof appendAuditEvent;

/**
 * High-level command executor that wraps SandboxManager with timeout
 * enforcement, batch execution, and audit logging.
 */
export class SandboxExecutor {
  private readonly manager: SandboxManager;
  private readonly projectRoot: string;
  private readonly auditLogger: AuditLoggerFn;

  /**
   * @param manager - The SandboxManager instance managing the Docker container.
   * @param projectRoot - Absolute path to the project root, used for audit logging.
   * @param auditLogger - Function to append audit events. Typically `appendAuditEvent`.
   */
  constructor(manager: SandboxManager, projectRoot: string, auditLogger: AuditLoggerFn) {
    this.manager = manager;
    this.projectRoot = projectRoot;
    this.auditLogger = auditLogger;
  }

  /**
   * Executes a single command inside the sandbox container.
   *
   * Enforces the specified timeout (falling back to the spec's default).
   * If the timeout is exceeded, the exec is killed and the result will have
   * `timedOut: true`. Logs audit events for each execution.
   *
   * @param command - The shell command string to execute.
   * @param timeoutMs - Optional timeout in milliseconds. 0 means no timeout.
   * @returns The execution result with exit code, output, timing, and timeout status.
   */
  async run(command: string, timeoutMs?: number): Promise<SandboxExecResult> {
    const execOptions: ExecOptions = {};
    if (timeoutMs !== undefined) {
      execOptions.timeoutMs = timeoutMs;
    }

    const startTimestamp = new Date().toISOString();

    await this.logAudit("bash_execute", {
      phase: "start",
      command,
      timeoutMs: timeoutMs ?? null,
      sandboxed: true,
      containerId: this.manager.getContainerId(),
      timestamp: startTimestamp,
    });

    let result: SandboxExecResult;
    try {
      result = await this.manager.exec(command, execOptions);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      const errorResult: SandboxExecResult = {
        exitCode: -1,
        stdout: "",
        stderr: errorMessage,
        durationMs: Date.now() - new Date(startTimestamp).getTime(),
        timedOut: false,
      };

      await this.logAudit("bash_execute", {
        phase: "error",
        command,
        error: errorMessage,
        sandboxed: true,
        containerId: this.manager.getContainerId(),
      });

      return errorResult;
    }

    await this.logAudit("bash_execute", {
      phase: "complete",
      command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      sandboxed: true,
      containerId: this.manager.getContainerId(),
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
    });

    return result;
  }

  /**
   * Runs multiple commands sequentially inside the sandbox, collecting
   * all results. Execution continues even if individual commands fail.
   *
   * @param commands - Array of shell command strings to execute in order.
   * @returns An array of SandboxExecResult, one per command, in the same order.
   */
  async runBatch(commands: string[]): Promise<SandboxExecResult[]> {
    const results: SandboxExecResult[] = [];

    for (const command of commands) {
      const result = await this.run(command);
      results.push(result);
    }

    return results;
  }

  /**
   * Checks whether Docker is installed and the daemon is responsive.
   *
   * Attempts to run `docker info` on the host. Returns true if the command
   * succeeds (exit code 0), false otherwise.
   */
  async isAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      execFile("docker", ["info"], { timeout: 10_000 }, (err, _stdout, _stderr) => {
        if (err) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Logs an audit event through the configured audit logger.
   */
  private async logAudit(type: AuditEventType, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.auditLogger(this.projectRoot, {
        sessionId: (payload["sessionId"] as string | undefined) ?? "sandbox",
        timestamp: new Date().toISOString(),
        type,
        payload,
        modelId: "sandbox",
        projectRoot: this.projectRoot,
      });
    } catch {
      // Audit logging failures must not break command execution.
      // The sandbox continues to operate even if the audit log is unavailable.
    }
  }
}

/**
 * Creates a SandboxSpec with sensible default values for a given project root.
 *
 * Defaults:
 * - Image: ghcr.io/dantecode/sandbox:latest
 * - Workdir: /workspace
 * - Network: bridge
 * - Memory: 2048 MB (2 GB)
 * - CPU: 2 cores
 * - Timeout: 300000 ms (5 minutes)
 * - Mount: project root mounted read-write at /workspace
 * - Env: empty
 *
 * @param projectRoot - Absolute path to the host project directory.
 * @returns A complete SandboxSpec ready for use with SandboxManager.
 */
export function createDefaultSandboxSpec(projectRoot: string): SandboxSpec {
  return {
    image: "ghcr.io/dantecode/sandbox:latest",
    workdir: "/workspace",
    networkMode: "none", // Network isolation: no external network access
    mounts: [
      {
        hostPath: projectRoot,
        containerPath: "/workspace",
        readonly: false,
      },
    ],
    env: {},
    memoryLimitMb: 2048,
    cpuLimit: 2,
    timeoutMs: 300_000,
  };
}
