// ============================================================================
// @dantecode/dante-sandbox — Execution Proxy
// Replaces all direct execSync / spawn / child_process calls throughout the
// platform. Every caller uses proxy.run() instead. If proxy is not set up,
// the proxy fails closed (throws) rather than bypassing the sandbox.
// ============================================================================

import { randomUUID } from "node:crypto";
import type { ExecutionRequest, ExecutionResult, ProxyCallOptions } from "./types.js";
import { ExecutionRequestSchema } from "./types.js";
import type { SandboxEngine } from "./sandbox-engine.js";

// ─── Global Proxy Singleton ───────────────────────────────────────────────────

let _globalProxy: ExecutionProxy | null = null;

/**
 * Sets the global execution proxy. Call this once at startup in agent-loop.ts.
 * All subsequent proxy.run() calls will route through the sandbox engine.
 */
export function setGlobalProxy(proxy: ExecutionProxy): void {
  _globalProxy = proxy;
}

/**
 * Returns the global execution proxy, or throws if not initialized.
 * Fail-closed: callers should always set up the proxy before any execution.
 */
export function getGlobalProxy(): ExecutionProxy {
  if (!_globalProxy) {
    throw new Error(
      "[DanteSandbox] ExecutionProxy not initialized. " +
      "Call setGlobalProxy() before any execution. " +
      "All commands must route through the sandbox engine.",
    );
  }
  return _globalProxy;
}

/**
 * Convenience function: run a command through the global proxy.
 * This is the primary replacement for execSync / spawn everywhere.
 *
 * @example
 * // Replace: execSync("git status", { cwd })
 * // With:    await sandboxRun("git status", { cwd, taskType: "git", actor: "git-engine" })
 */
export async function sandboxRun(
  command: string,
  options?: ProxyCallOptions,
): Promise<ExecutionResult> {
  return getGlobalProxy().run(command, options);
}

// ─── ExecutionProxy ───────────────────────────────────────────────────────────

/**
 * The execution proxy sits between every caller and the SandboxEngine.
 * It normalizes raw command strings into typed ExecutionRequests and
 * delegates to the engine for sandboxed execution.
 *
 * To replace execSync in any file:
 *   Old: execSync("git commit -m 'msg'", { cwd: dir })
 *   New: await executionProxy.run("git commit -m 'msg'", { cwd: dir, taskType: "git" })
 */
export class ExecutionProxy {
  constructor(private readonly engine: SandboxEngine) {}

  /**
   * Execute a command through the sandbox engine.
   * This is the primary public API — replaces execSync everywhere.
   */
  async run(command: string, options: ProxyCallOptions = {}): Promise<ExecutionResult> {
    const request = this.normalize(command, options);
    return this.engine.execute(request);
  }

  /**
   * Execute and return stdout as a string (mirrors execSync return value).
   * Throws on non-zero exit code, just like execSync.
   */
  async runSync(command: string, options: ProxyCallOptions = {}): Promise<string> {
    const result = await this.run(command, options);
    if (result.exitCode !== 0) {
      const err = new Error(
        result.stderr || `Command failed with exit code ${result.exitCode}: ${command}`,
      ) as NodeJS.ErrnoException & { stdout: string; stderr: string; status: number };
      err.stdout = result.stdout;
      err.stderr = result.stderr;
      err.status = result.exitCode;
      throw err;
    }
    return result.stdout;
  }

  /**
   * Run multiple commands sequentially. Stops on first failure.
   */
  async runBatch(commands: string[], options: ProxyCallOptions = {}): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    for (const cmd of commands) {
      const r = await this.run(cmd, options);
      results.push(r);
      if (r.exitCode !== 0) break;
    }
    return results;
  }

  /**
   * Check if a command would be allowed without actually executing it.
   * Useful for pre-flight checks.
   */
  async wouldAllow(command: string, options: ProxyCallOptions = {}): Promise<boolean> {
    const { evaluatePolicy } = await import("./policy-engine.js");
    const request = this.normalize(command, options);
    const policy = evaluatePolicy(request);
    return policy.allow;
  }

  private normalize(command: string, options: ProxyCallOptions): ExecutionRequest {
    return ExecutionRequestSchema.parse({
      id: randomUUID(),
      command,
      args: [],
      cwd: options.cwd,
      env: options.env ?? {},
      taskType: options.taskType ?? "bash",
      actor: options.actor ?? "agent",
      requestedMode: options.modeOverride ?? "auto",
      timeoutMs: options.timeoutMs ?? 30_000,
      sessionId: options.sessionId,
      checkpointId: options.checkpointId,
    });
  }
}

// ─── ToolResult Adapter ───────────────────────────────────────────────────────

/**
 * Converts an ExecutionResult to the ToolResult format expected by tools.ts.
 * Preserves the execSync-like output format.
 */
export function toToolResult(result: ExecutionResult): { content: string; isError: boolean } {
  const output = result.stdout + (result.stderr ? `\nstderr: ${result.stderr}` : "");
  if (result.timedOut) {
    return { content: `Command timed out.\n${output}`, isError: true };
  }
  if (result.violations.length > 0) {
    return { content: result.stderr || result.violations.join("; "), isError: true };
  }
  return { content: output || "(no output)", isError: result.exitCode !== 0 };
}
