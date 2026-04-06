// ============================================================================
// @dantecode/core — Hook Runner (QwenCode pattern)
// ============================================================================
//
// Executes registered hooks for the 12 supported event types.
// Semantics:
//   exit 0   → success / allow
//   exit 2   → blocking error — HookResult.block = true, pipeline halts
//   other    → non-blocking warning — logged, pipeline continues
//
// Hooks in the same event group can be sequential (default) or parallel.
// Sequential hooks receive the transformed output of the previous hook as
// their stdin, allowing pipeline-style input transformation.
// ============================================================================

import { spawn } from "node:child_process";
import type {
  HookDefinition,
  HookEventPayload,
  HookEventType,
  HookExitCode,
} from "./hook-types.js";

export type { HookEventType };
export type { HookDefinition };

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576; // 1 MiB

// ─── Public result types ────────────────────────────────────────────────────

export interface HookEvent {
  eventType: HookEventType;
  payload: HookEventPayload;
}

export interface HookResult {
  /** Name of the hook that produced this result. */
  hookName: string;
  /** OS exit code from the shell command (or 0 for inline functions). */
  exitCode: HookExitCode;
  /** Combined stdout output (trimmed, capped at maxOutputBytes). */
  stdout: string;
  /** Combined stderr output (trimmed, capped at maxOutputBytes). */
  stderr: string;
  /**
   * When true the exit code was 2 — caller should block / halt the pipeline.
   * Includes a human-readable message derived from stderr / stdout.
   */
  block: boolean;
  blockMessage?: string;
  /** Non-zero exit that was NOT 2 — warning was emitted but execution continues. */
  warning: boolean;
  /** Error thrown if the hook itself failed to start / timed out. */
  error?: string;
  /** Duration in milliseconds. */
  durationMs: number;
}

export interface HookRunSummary {
  eventType: HookEventType;
  results: HookResult[];
  /**
   * Consolidated block flag — true if ANY hook in the run returned exit 2.
   * The caller should inspect `blockMessage` on the relevant result.
   */
  blocked: boolean;
  blockMessage?: string;
  /**
   * The (potentially transformed) stdin that was threaded through sequential hooks.
   * Callers can use this as the final transformed payload (e.g. transformed prompt).
   */
  transformedInput?: string;
}

// ─── HookRunner ──────────────────────────────────────────────────────────────

export class HookRunner {
  private readonly hooks: Map<HookEventType, HookDefinition[]> = new Map();

  // ── Registration ──────────────────────────────────────────────────────────

  register(hook: HookDefinition): void {
    const existing = this.hooks.get(hook.event) ?? [];
    existing.push(hook);
    this.hooks.set(hook.event, existing);
  }

  registerAll(hooks: HookDefinition[]): void {
    for (const hook of hooks) this.register(hook);
  }

  unregister(name: string): void {
    for (const [eventType, list] of this.hooks.entries()) {
      this.hooks.set(
        eventType,
        list.filter((h) => h.name !== name),
      );
    }
  }

  clear(eventType?: HookEventType): void {
    if (eventType) {
      this.hooks.delete(eventType);
    } else {
      this.hooks.clear();
    }
  }

  // ── Main entry point ─────────────────────────────────────────────────────

  async run(eventType: HookEventType, payload: HookEventPayload): Promise<HookRunSummary> {
    const defs = this.hooks.get(eventType) ?? [];
    const applicable = defs.filter((d) => this.matchesToolPattern(d, payload));

    if (applicable.length === 0) {
      return {
        eventType,
        results: [],
        blocked: false,
      };
    }

    // Partition into parallel and sequential groups, preserving registration order.
    // All hooks marked parallel run as a batch; sequential hooks run one-by-one.
    const parallelGroup = applicable.filter((d) => d.parallel);
    const sequentialGroup = applicable.filter((d) => !d.parallel);

    const results: HookResult[] = [];
    let transformedInput = this.payloadToStdin(payload);

    // Run parallel group first (fire all, collect results)
    if (parallelGroup.length > 0) {
      const parallelResults = await Promise.all(
        parallelGroup.map((d) => this.runOne(d, payload, transformedInput)),
      );
      results.push(...parallelResults);
    }

    // Run sequential group — each feeds its stdout to the next as stdin
    for (const def of sequentialGroup) {
      const result = await this.runOne(def, payload, transformedInput);
      results.push(result);
      // If the hook produced output, use it as the input for the next hook.
      if (result.stdout.trim().length > 0) {
        transformedInput = result.stdout;
      }
      // On a blocking error, stop immediately.
      if (result.block) break;
    }

    const blocked = results.some((r) => r.block);
    const blockingResult = results.find((r) => r.block);

    return {
      eventType,
      results,
      blocked,
      blockMessage: blockingResult?.blockMessage,
      transformedInput,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private matchesToolPattern(def: HookDefinition, payload: HookEventPayload): boolean {
    if (!def.toolPattern) return true;
    if (!payload.toolName) return false;
    try {
      return new RegExp(def.toolPattern).test(payload.toolName);
    } catch {
      // Malformed regex — skip the hook
      return false;
    }
  }

  /**
   * Serialises the event payload to a JSON string that shell commands receive
   * on stdin (and inline functions receive as their transformedInput parameter).
   */
  private payloadToStdin(payload: HookEventPayload): string {
    return JSON.stringify(payload, null, 2);
  }

  private async runOne(
    def: HookDefinition,
    payload: HookEventPayload,
    stdin: string,
  ): Promise<HookResult> {
    const start = Date.now();
    const timeoutMs = def.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = def.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    if (typeof def.command === "function") {
      return this.runInlineFunction(def, payload, start, timeoutMs);
    }

    return this.runShellCommand(def, def.command, stdin, start, timeoutMs, maxBytes);
  }

  private async runInlineFunction(
    def: HookDefinition,
    payload: HookEventPayload,
    start: number,
    timeoutMs: number,
  ): Promise<HookResult> {
    const fn = def.command as (event: HookEventPayload) => Promise<string>;
    let stdout = "";
    let exitCode: HookExitCode = 0;
    let error: string | undefined;

    try {
      const result = await Promise.race([
        fn(payload),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Hook "${def.name}" timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      stdout = result ?? "";
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      // Support `.code` property for exit-code semantics
      const code = (e as NodeJS.ErrnoException).code;
      if (typeof code === "number") {
        exitCode = code;
      } else {
        exitCode = 1;
      }
      error = e.message;
    }

    const durationMs = Date.now() - start;
    return this.buildResult(def.name, exitCode, stdout, "", durationMs, error);
  }

  private async runShellCommand(
    def: HookDefinition,
    command: string,
    stdin: string,
    start: number,
    timeoutMs: number,
    maxBytes: number,
  ): Promise<HookResult> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const child = spawn(command, [], {
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      const settle = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        resolve(this.buildResult(def.name, exitCode, stdout, stderr, durationMs, timedOut ? `Hook "${def.name}" timed out after ${timeoutMs}ms` : undefined));
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        settle(1);
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        const remaining = maxBytes - stdout.length;
        if (remaining > 0) {
          stdout += chunk.slice(0, remaining).toString("utf8");
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const remaining = maxBytes - stderr.length;
        if (remaining > 0) {
          stderr += chunk.slice(0, remaining).toString("utf8");
        }
      });

      child.on("error", (err) => {
        stderr += err.message;
        settle(1);
      });

      child.on("close", (code) => {
        settle(code ?? 1);
      });

      // Write the serialised payload to the command's stdin
      try {
        child.stdin.write(stdin, "utf8");
        child.stdin.end();
      } catch {
        // stdin may not be writable (e.g. command ignores stdin) — ignore
      }
    });
  }

  private buildResult(
    hookName: string,
    exitCode: HookExitCode,
    stdout: string,
    stderr: string,
    durationMs: number,
    error?: string,
  ): HookResult {
    const block = exitCode === 2;
    const warning = !block && exitCode !== 0;
    const blockMessage = block
      ? (stderr.trim() || stdout.trim() || `Hook "${hookName}" returned exit code 2`)
      : undefined;

    return {
      hookName,
      exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      block,
      blockMessage,
      warning,
      error,
      durationMs,
    };
  }
}

// ─── Singleton helper ────────────────────────────────────────────────────────

let _globalHookRunner: HookRunner | null = null;

export function getGlobalHookRunner(): HookRunner {
  if (!_globalHookRunner) {
    _globalHookRunner = new HookRunner();
  }
  return _globalHookRunner;
}

export function setGlobalHookRunner(runner: HookRunner): void {
  _globalHookRunner = runner;
}
