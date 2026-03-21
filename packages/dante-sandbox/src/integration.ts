// ============================================================================
// @dantecode/dante-sandbox — Integration Surface
// High-level API for wiring DanteSandbox into the platform.
// agent-loop.ts, tools.ts, and extension.ts call DanteSandbox.setup()
// once at startup to wire the global proxy.
// ============================================================================

import { SandboxEngine } from "./sandbox-engine.js";
import { ExecutionProxy, setGlobalProxy, sandboxRun, toToolResult } from "./execution-proxy.js";
import { SandboxAuditLog, noopAuditSink } from "./audit-log.js";
import { buildDanteForgeGate, permissiveGate } from "./danteforge-gate.js";
import { NativeSandbox } from "./native-sandbox.js";
import { DockerIsolationLayer } from "./docker-isolation.js";
import { WorktreeIsolationLayer } from "./worktree-isolation.js";
import { HostEscapeLayer } from "./host-escape.js";
import type { SandboxEngineConfig, SandboxMode, SandboxStatus } from "./types.js";

// ─── Setup Options ────────────────────────────────────────────────────────────

export interface DanteSandboxSetupOptions {
  projectRoot: string;
  config?: Partial<SandboxEngineConfig>;
  /** Use permissive (test) gate instead of DanteForge gate. */
  useMockGate?: boolean;
  /** Disable audit file persistence (useful in tests). */
  noAuditFile?: boolean;
}

// ─── Module State ─────────────────────────────────────────────────────────────

let _engine: SandboxEngine | null = null;
let _proxy: ExecutionProxy | null = null;
let _auditLog: SandboxAuditLog | null = null;

// ─── DanteSandbox Facade ─────────────────────────────────────────────────────

/**
 * The public facade for DanteSandbox integration.
 * Call DanteSandbox.setup() once at startup (in agent-loop / extension.ts).
 */
export const DanteSandbox = {
  /**
   * Initialize the sandbox engine, register isolation layers,
   * and wire the global execution proxy.
   *
   * Call this once before any tool execution begins.
   */
  async setup(opts: DanteSandboxSetupOptions): Promise<void> {
    const auditLog = opts.noAuditFile
      ? null
      : new SandboxAuditLog({ projectRoot: opts.projectRoot });

    _auditLog = auditLog;

    const gate = opts.useMockGate ? permissiveGate : buildDanteForgeGate();
    const auditSink = auditLog ? auditLog.sink : noopAuditSink;

    const engine = new SandboxEngine({ config: opts.config, gateFn: gate, auditSink });

    // Register all isolation layers (engine selects the best available one)
    engine.registerLayer(new NativeSandbox(opts.projectRoot));
    engine.registerLayer(new DockerIsolationLayer(opts.projectRoot));
    engine.registerLayer(new WorktreeIsolationLayer(opts.projectRoot));
    engine.registerLayer(new HostEscapeLayer());

    _engine = engine;
    _proxy = new ExecutionProxy(engine);
    setGlobalProxy(_proxy);
  },

  /**
   * Execute a command through the sandbox. Primary API.
   * Equivalent to: import { sandboxRun } from "@dantecode/dante-sandbox"
   */
  execute: sandboxRun,

  /**
   * Execute and return stdout as string (execSync drop-in).
   * Throws on non-zero exit, just like execSync.
   */
  async execSync(command: string, options?: Parameters<typeof sandboxRun>[1]): Promise<string> {
    if (!_proxy)
      throw new Error("[DanteSandbox] Not initialized. Call DanteSandbox.setup() first.");
    return _proxy.runSync(command, options);
  },

  /** Convert an ExecutionResult to the ToolResult format used in tools.ts. */
  toToolResult,

  /**
   * Get live status of the sandbox (mode, available strategies, counters).
   * Powers /sandbox status command.
   */
  async status(): Promise<SandboxStatus> {
    if (!_engine) {
      return {
        enforced: false,
        mode: "off",
        available: [],
        preferred: "host",
        dockerReady: false,
        worktreeReady: false,
        executionCount: 0,
        violationCount: 0,
        hostEscapeCount: 0,
      };
    }
    return _engine.getStatus();
  },

  /**
   * Change the sandbox mode at runtime.
   * Powers /sandbox force-docker, /sandbox force-worktree, etc.
   */
  setMode(mode: SandboxMode): void {
    _engine?.setMode(mode);
  },

  /**
   * Returns the audit log for checkpoint linking.
   */
  getAuditLog(): SandboxAuditLog | null {
    return _auditLog;
  },

  /**
   * Tear down all isolation layers (containers, worktrees).
   * Call on process exit / session end.
   */
  async teardown(): Promise<void> {
    await _engine?.teardown();
    _engine = null;
    _proxy = null;
    _auditLog = null;
  },

  /** Returns true when the sandbox has been initialized. */
  isReady(): boolean {
    return _proxy !== null;
  },
};

/**
 * Returns the active SandboxEngine instance, or null if not initialized.
 * Useful for tests and introspection.
 */
export function getEngine(): SandboxEngine | null {
  return _engine;
}
