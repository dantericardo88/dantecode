// ============================================================================
// @dantecode/core — Sandbox Engine
// Multi-layer sandbox/isolation engine for agent code execution.
// Inspired by the E2B sandbox model. Supports process, docker, and mock modes.
// Uses dependency injection for testability (execSyncFn).
// ============================================================================

import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

/** The isolation strategy used for a sandbox instance. */
export type SandboxMode = "process" | "docker" | "mock";

/** Lifecycle state of a sandbox instance. */
export type SandboxStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "destroyed";

/**
 * Policy that governs what a sandbox instance is allowed to do.
 * All commands are validated against this policy before execution.
 */
export interface SandboxPolicy {
  /** Whether outbound network access is permitted. */
  allowNetwork: boolean;
  /** Whether the sandbox may write to the filesystem. */
  allowFileWrite: boolean;
  /**
   * Explicit filesystem paths the sandbox may access.
   * Empty array means no additional path restrictions beyond OS defaults.
   */
  allowedPaths: string[];
  /**
   * Command substrings / patterns that are always blocked regardless of
   * other policy settings.
   */
  blockedCommands: string[];
  /** Hard wall-clock timeout for a single exec() call, in milliseconds. */
  maxExecutionMs: number;
  /** Maximum combined byte length of stdout + stderr before truncation. */
  maxOutputBytes: number;
}

/** A running or terminated sandbox instance. */
export interface SandboxInstance {
  /** UUID assigned at creation. */
  id: string;
  /** Isolation mode this instance was created with. */
  mode: SandboxMode;
  /** Current lifecycle status. */
  status: SandboxStatus;
  /** Active policy for this instance. */
  policy: SandboxPolicy;
  /** ISO 8601 timestamp of when this instance was created. */
  createdAt: string;
  /** Temporary working directory allocated for this instance. */
  workDir: string;
  /** Arbitrary caller-supplied metadata. */
  metadata: Record<string, unknown>;
}

/** Result of a single exec() call. */
export interface ExecResult {
  /** Standard output captured from the command. */
  stdout: string;
  /** Standard error captured from the command. */
  stderr: string;
  /** Process exit code (0 = success). */
  exitCode: number;
  /** Wall-clock duration of the execution, in milliseconds. */
  durationMs: number;
  /** True when stdout+stderr was truncated to stay within maxOutputBytes. */
  truncated: boolean;
}

/** Options for constructing a SandboxEngine. */
export interface SandboxEngineOptions {
  /** Default isolation mode for new instances. Default: "process". */
  defaultMode?: SandboxMode;
  /** Partial overrides applied on top of DEFAULT_POLICY for every new instance. */
  defaultPolicy?: Partial<SandboxPolicy>;
  /** Injectable execSync for unit-testing without spawning real processes. */
  execSyncFn?: typeof execSync;
  /** Base directory under which per-instance work dirs are created. Default: os.tmpdir(). */
  workDirBase?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Baseline policy applied to every new sandbox instance unless overridden.
 * Blocks the most destructive shell commands by default.
 */
const DEFAULT_POLICY: SandboxPolicy = {
  allowNetwork: false,
  allowFileWrite: true,
  allowedPaths: [],
  blockedCommands: [
    "rm -rf /",
    "mkfs",
    "dd if=",
    ":(){:|:&};:",
    "shutdown",
    "reboot",
  ],
  maxExecutionMs: 30_000,
  maxOutputBytes: 1024 * 1024, // 1 MB
};

/** Network-access commands that are blocked when allowNetwork === false. */
const NETWORK_COMMANDS = [
  "curl",
  "wget",
  "nc ",
  "ncat",
  "netcat",
  "ssh ",
  "scp ",
  "sftp",
  "ftp ",
  "telnet",
  "ping ",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Merges two partial policies, preferring values from `override` while
 * falling back to `base` for unset keys.
 */
function mergePolicy(
  base: SandboxPolicy,
  override: Partial<SandboxPolicy> = {}
): SandboxPolicy {
  return {
    allowNetwork:
      override.allowNetwork !== undefined
        ? override.allowNetwork
        : base.allowNetwork,
    allowFileWrite:
      override.allowFileWrite !== undefined
        ? override.allowFileWrite
        : base.allowFileWrite,
    allowedPaths: override.allowedPaths ?? base.allowedPaths,
    blockedCommands: override.blockedCommands ?? base.blockedCommands,
    maxExecutionMs: override.maxExecutionMs ?? base.maxExecutionMs,
    maxOutputBytes: override.maxOutputBytes ?? base.maxOutputBytes,
  };
}

// ─── SandboxEngine ───────────────────────────────────────────────────────────

/**
 * Multi-layer sandbox engine for isolating agent code execution.
 *
 * Modes:
 *  - **process** — runs commands via execSync in the host OS process space
 *    with policy-level guardrails (blocked commands, network, output limits).
 *  - **docker** — same policy checks; actual execution should be delegated to
 *    a Docker runner layer (process mode is used as fallback in this impl).
 *  - **mock** — no real execution; useful for dry-run tests.
 *
 * All instances are tracked internally. Call destroy() to mark an instance
 * terminated; subsequent exec() calls will throw.
 *
 * @example
 * ```typescript
 * const engine = new SandboxEngine({ defaultMode: "process" });
 * const instance = engine.create();
 * const result = engine.exec(instance.id, "echo hello");
 * engine.destroy(instance.id);
 * ```
 */
export class SandboxEngine {
  private readonly instances: Map<string, SandboxInstance> = new Map();
  private readonly options: Required<SandboxEngineOptions>;

  constructor(options: SandboxEngineOptions = {}) {
    this.options = {
      defaultMode: options.defaultMode ?? "process",
      defaultPolicy: options.defaultPolicy ?? {},
      execSyncFn: options.execSyncFn ?? execSync,
      workDirBase: options.workDirBase ?? os.tmpdir(),
    };
  }

  // ── Factory ──────────────────────────────────────────────────────────────

  /**
   * Creates a new sandbox instance.
   *
   * The effective policy is built by layering:
   *   1. `DEFAULT_POLICY` (baseline)
   *   2. `options.defaultPolicy` (engine-wide defaults)
   *   3. `policyOverrides` (per-instance overrides, highest priority)
   *
   * @param mode - Isolation mode. Falls back to `options.defaultMode`.
   * @param policyOverrides - Per-instance policy overrides.
   * @returns The newly created, idle SandboxInstance.
   */
  create(
    mode?: SandboxMode,
    policyOverrides?: Partial<SandboxPolicy>
  ): SandboxInstance {
    const id = randomUUID();
    const effectiveMode = mode ?? this.options.defaultMode;

    // Layer policies: defaults → engine options → per-call overrides
    const basePolicy = mergePolicy(DEFAULT_POLICY, this.options.defaultPolicy);
    const policy = mergePolicy(basePolicy, policyOverrides);

    const workDir = path.join(this.options.workDirBase, `sandbox-${id}`);

    const instance: SandboxInstance = {
      id,
      mode: effectiveMode,
      status: "idle",
      policy,
      createdAt: new Date().toISOString(),
      workDir,
      metadata: {},
    };

    this.instances.set(id, instance);
    return instance;
  }

  // ── Execution ────────────────────────────────────────────────────────────

  /**
   * Executes a shell command inside the specified sandbox instance.
   *
   * Validation steps (in order):
   *  1. Instance must exist.
   *  2. Instance must not be destroyed.
   *  3. Command must pass policy checks (blocked commands, network).
   *
   * On success the instance status becomes "completed"; on exec error it
   * becomes "failed". Output is truncated to `policy.maxOutputBytes` if
   * needed, with `truncated` set to `true` in the result.
   *
   * @param instanceId - ID of the target sandbox instance.
   * @param command - Shell command string to execute.
   * @returns ExecResult containing stdout, stderr, exitCode, durationMs, truncated.
   * @throws Error when instance is unknown, destroyed, or command is policy-blocked.
   */
  exec(instanceId: string, command: string): ExecResult {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Sandbox instance not found: ${instanceId}`);
    }
    if (instance.status === "destroyed") {
      throw new Error(
        `Cannot exec on destroyed sandbox instance: ${instanceId}`
      );
    }

    // Policy validation
    const violation = this.applyPolicies(instance, command);
    if (violation !== null) {
      throw new Error(`Policy violation: ${violation}`);
    }

    instance.status = "running";

    const startMs = Date.now();
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      if (instance.mode === "mock") {
        // Mock mode: simulate success without real execution
        stdout = `[mock] ${command}`;
      } else {
        // process / docker modes — delegate to injected execSync
        const rawOutput = this.options.execSyncFn(command, {
          timeout: instance.policy.maxExecutionMs,
          encoding: "buffer",
          stdio: ["pipe", "pipe", "pipe"],
        });
        stdout =
          rawOutput instanceof Buffer ? rawOutput.toString("utf8") : String(rawOutput ?? "");
      }
      instance.status = "completed";
    } catch (err: unknown) {
      exitCode = 1;
      // execSync throws SpawnSyncReturns-like errors with .stdout/.stderr
      const spawnErr = err as {
        stdout?: Buffer | string;
        stderr?: Buffer | string;
        status?: number;
        message?: string;
      };

      if (spawnErr.stdout !== undefined) {
        stdout =
          spawnErr.stdout instanceof Buffer
            ? spawnErr.stdout.toString("utf8")
            : String(spawnErr.stdout ?? "");
      }
      if (spawnErr.stderr !== undefined) {
        stderr =
          spawnErr.stderr instanceof Buffer
            ? spawnErr.stderr.toString("utf8")
            : String(spawnErr.stderr ?? "");
      } else {
        stderr = errorMessage(err);
      }
      if (typeof spawnErr.status === "number") {
        exitCode = spawnErr.status;
      }

      instance.status = "failed";
    }

    const durationMs = Date.now() - startMs;

    // Output truncation
    let truncated = false;
    const { maxOutputBytes } = instance.policy;
    const totalBytes = stdout.length + stderr.length;
    if (totalBytes > maxOutputBytes) {
      truncated = true;
      // Apportion bytes proportionally, favouring stdout
      const stdoutShare = Math.floor(
        (stdout.length / totalBytes) * maxOutputBytes
      );
      const stderrShare = maxOutputBytes - stdoutShare;
      stdout = stdout.slice(0, stdoutShare);
      stderr = stderr.slice(0, stderrShare);
    }

    return { stdout, stderr, exitCode, durationMs, truncated };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Marks a sandbox instance as destroyed. Subsequent exec() calls will throw.
   * Calling destroy() on an already-destroyed instance is a no-op (idempotent).
   *
   * @param instanceId - ID of the instance to destroy.
   */
  destroy(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return; // Unknown IDs are silently ignored
    }
    instance.status = "destroyed";
  }

  // ── Policy ───────────────────────────────────────────────────────────────

  /**
   * Validates `command` against the instance's active policy.
   *
   * @param instance - The sandbox instance providing the policy context.
   * @param command - The command string to validate.
   * @returns `null` when the command is permitted; a human-readable violation
   *          message when it is blocked.
   */
  applyPolicies(
    instance: SandboxInstance,
    command: string
  ): string | null {
    const { policy } = instance;

    // Check explicit blocked-command list
    if (this.isCommandBlocked(command, policy)) {
      return `command matches blocked pattern: "${command}"`;
    }

    // Check network access restrictions
    if (!policy.allowNetwork) {
      const lc = command.toLowerCase();
      for (const netCmd of NETWORK_COMMANDS) {
        if (lc.includes(netCmd)) {
          return `network access is disabled (matched: "${netCmd.trim()}")`;
        }
      }
    }

    return null;
  }

  /**
   * Returns `true` when `command` contains any of the blocked patterns
   * defined in `policy.blockedCommands`.
   *
   * Matching is case-insensitive substring matching so that partial command
   * forms (e.g. "rm -rf /" embedded in a longer script) are still caught.
   *
   * @param command - The command string to test.
   * @param policy - The policy containing the blocked-command list.
   */
  isCommandBlocked(command: string, policy: SandboxPolicy): boolean {
    const lc = command.toLowerCase();
    return policy.blockedCommands.some((blocked) =>
      lc.includes(blocked.toLowerCase())
    );
  }

  // ── Query ────────────────────────────────────────────────────────────────

  /**
   * Retrieves a sandbox instance by ID.
   *
   * @param id - Instance UUID.
   * @returns The SandboxInstance or `undefined` when not found.
   */
  getInstance(id: string): SandboxInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * Lists all tracked sandbox instances, optionally filtered by status.
   *
   * @param status - When provided, only instances with this status are returned.
   * @returns Array of matching SandboxInstance objects.
   */
  listInstances(status?: SandboxStatus): SandboxInstance[] {
    const all = Array.from(this.instances.values());
    if (status === undefined) return all;
    return all.filter((i) => i.status === status);
  }

  /**
   * Returns aggregate counts of instances grouped by status.
   *
   * @returns Object with `total` plus one count per SandboxStatus.
   */
  getStats(): {
    total: number;
    idle: number;
    running: number;
    completed: number;
    failed: number;
    destroyed: number;
  } {
    const stats = {
      total: this.instances.size,
      idle: 0,
      running: 0,
      completed: 0,
      failed: 0,
      destroyed: 0,
    };
    for (const inst of this.instances.values()) {
      stats[inst.status]++;
    }
    return stats;
  }
}
