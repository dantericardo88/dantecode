// ============================================================================
// @dantecode/sandbox — Fallback Local Executor (no Docker)
// ============================================================================

import { spawn } from "node:child_process";
import type { SandboxExecResult, AuditEventType } from "@dantecode/config-types";
import { appendAuditEvent } from "@dantecode/core";
import type { AuditLoggerFn } from "./executor.js";

/**
 * Whether the initial warning about sandbox mode being inactive has been
 * emitted. This is tracked at module level so the warning is only shown
 * once per process, regardless of how many LocalExecutor instances are
 * created.
 */
let warnedAboutFallback = false;

/**
 * Fallback command executor that runs commands directly on the host
 * when Docker is not available.
 *
 * This class provides the same interface as SandboxExecutor so that
 * callers can swap between sandboxed and local execution transparently.
 *
 * WARNING: Commands executed through LocalExecutor run with the full
 * privileges of the host process. There is no filesystem or network
 * isolation. Use SandboxExecutor whenever Docker is available.
 */
export class LocalExecutor {
  private readonly projectRoot: string;
  private readonly auditLogger: AuditLoggerFn;

  /**
   * @param projectRoot - Absolute path to the project root, used as cwd and for audit logging.
   * @param auditLogger - Function to append audit events. Typically `appendAuditEvent`.
   */
  constructor(projectRoot: string, auditLogger: AuditLoggerFn = appendAuditEvent) {
    this.projectRoot = projectRoot;
    this.auditLogger = auditLogger;

    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      console.warn(
        "[DanteCode Sandbox] WARNING: Docker is not available. " +
          "Commands will execute directly on the host without sandbox isolation. " +
          "Install Docker and start the daemon for secure sandboxed execution.",
      );
    }
  }

  /**
   * Executes a command directly on the host using `child_process.spawn`.
   *
   * The command is run via the system shell (`sh -c` on Unix, `cmd /c` on
   * Windows). If the specified timeout is exceeded, the child process is
   * killed and the result will have `timedOut: true`.
   *
   * @param command - The shell command string to execute.
   * @param timeoutMs - Optional timeout in milliseconds. 0 or undefined means no timeout.
   * @returns The execution result with exit code, output, timing, and timeout status.
   */
  async run(command: string, timeoutMs?: number): Promise<SandboxExecResult> {
    const startTimestamp = new Date().toISOString();

    await this.logAudit("bash_execute", {
      phase: "start",
      command,
      timeoutMs: timeoutMs ?? null,
      sandboxed: false,
      timestamp: startTimestamp,
    });

    const result = await this.spawnCommand(command, timeoutMs);

    await this.logAudit("bash_execute", {
      phase: "complete",
      command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      sandboxed: false,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
    });

    return result;
  }

  /**
   * Runs multiple commands sequentially on the host, collecting all results.
   * Execution continues even if individual commands fail.
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
   * Returns true unconditionally. The local executor is always available
   * because it does not depend on Docker.
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Spawns a child process to run the given command with optional timeout.
   */
  private spawnCommand(command: string, timeoutMs?: number): Promise<SandboxExecResult> {
    return new Promise<SandboxExecResult>((resolve) => {
      const startTime = Date.now();
      let timedOut = false;
      let settled = false;

      const isWindows = process.platform === "win32";
      const shell = isWindows ? "cmd" : "sh";
      const shellFlag = isWindows ? "/c" : "-c";

      const child = spawn(shell, [shellFlag, command], {
        cwd: this.projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
        windowsHide: true,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      if (timeoutMs !== undefined && timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          // Kill the process tree. On Windows, taskkill is more reliable
          // but child.kill() is sufficient for most cases.
          try {
            child.kill("SIGKILL");
          } catch {
            // Process may have already exited
          }
        }, timeoutMs);
      }

      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;

        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
        }

        const durationMs = Date.now() - startTime;

        resolve({
          exitCode: exitCode ?? (timedOut ? -1 : 1),
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
          durationMs,
          timedOut,
        });
      };

      child.on("close", (code) => {
        finish(code);
      });

      child.on("error", (err) => {
        stderrChunks.push(Buffer.from(err.message, "utf-8"));
        finish(-1);
      });
    });
  }

  /**
   * Logs an audit event through the configured audit logger.
   */
  private async logAudit(type: AuditEventType, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.auditLogger(this.projectRoot, {
        sessionId: (payload["sessionId"] as string | undefined) ?? "local-fallback",
        timestamp: new Date().toISOString(),
        type,
        payload,
        modelId: "local-fallback",
        projectRoot: this.projectRoot,
      });
    } catch {
      // Audit logging failures must not break command execution.
    }
  }
}
