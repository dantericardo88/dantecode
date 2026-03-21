// ============================================================================
// @dantecode/dante-sandbox — Host Escape Layer
// Explicit, governed host execution path. Must feel exceptional, never normal.
// Requires: allowHostEscape=true in config + DanteForge gate pass.
// Emits high-severity audit records on every use.
// ============================================================================

import { spawn } from "node:child_process";
import type { IsolationLayer, ExecutionRequest, ExecutionResult } from "./types.js";

/** Warning banner printed to stderr for every host-escape execution. */
const HOST_ESCAPE_WARNING =
  "[DanteSandbox WARNING] Host escape active — command running UNSANDBOXED on host. " +
  "This execution is audited and requires explicit policy authorization.";

export class HostEscapeLayer implements IsolationLayer {
  readonly strategy = "host" as const;

  async isAvailable(): Promise<boolean> {
    return true; // Host is always nominally available
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    // Print loud warning to stderr before every host execution
    process.stderr.write(`\n${HOST_ESCAPE_WARNING}\n  command: ${request.command}\n\n`);

    const startMs = Date.now();

    return new Promise<ExecutionResult>((resolve) => {
      const isWindows = process.platform === "win32";
      const shell = isWindows ? "cmd" : "sh";
      const shellFlag = isWindows ? "/c" : "-c";

      const child = spawn(shell, [shellFlag, request.command], {
        cwd: request.cwd,
        env: { ...process.env, ...request.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = request.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, request.timeoutMs)
        : null;

      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({
          requestId: request.id,
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - startMs,
          timedOut,
          strategy: "host",
          sandboxed: false, // explicit: host is NOT sandboxed
          violations: [],
        });
      });

      child.on("error", (err) => {
        if (timer) clearTimeout(timer);
        resolve({
          requestId: request.id,
          exitCode: -1,
          stdout: "",
          stderr: err.message,
          durationMs: Date.now() - startMs,
          timedOut: false,
          strategy: "host",
          sandboxed: false,
          violations: [],
        });
      });
    });
  }

  async teardown(): Promise<void> {
    // No persistent resources to clean up
  }
}
