// ============================================================================
// @dantecode/dante-sandbox — Sandbox Engine
// Central decision brain: intercepts requests, selects strategy, invokes gate,
// runs in isolation, and emits audit records.
// ============================================================================

import { randomUUID } from "node:crypto";
import type {
  ExecutionRequest,
  ExecutionResult,
  SandboxDecision,
  SandboxAuditRecord,
  SandboxViolation,
  SandboxMode,
  IsolationStrategy,
  GateFn,
  AuditSink,
  SandboxEngineConfig,
  SandboxStatus,
  IsolationLayer,
} from "./types.js";
import { DEFAULT_ENGINE_CONFIG } from "./types.js";
import { evaluatePolicy, buildBlockDecision } from "./policy-engine.js";
import { detectAvailableStrategies, isDockerAvailable, isWorktreeAvailable } from "./capability-check.js";

// ─── Session Counters ─────────────────────────────────────────────────────────

interface SessionStats {
  executions: number;
  violations: number;
  hostEscapes: number;
}

// ─── SandboxEngine ────────────────────────────────────────────────────────────

/**
 * The single source of execution authority for DanteCode.
 *
 * Every command that DanteCode runs must pass through here.
 * The engine:
 *   1. Evaluates policy (risk classification)
 *   2. Selects an isolation strategy
 *   3. Invokes the DanteForge gate
 *   4. Executes in the selected isolation layer
 *   5. Records a full audit entry
 *   6. Returns a normalized ExecutionResult
 *
 * Fail-closed: if strategy selection or gate evaluation throws,
 * the request is blocked and an audit record is written.
 */
export class SandboxEngine {
  private readonly config: SandboxEngineConfig;
  /** Mutable mode field — avoids unsafe type casts in setMode(). */
  private currentMode: SandboxMode;
  private readonly gateFn: GateFn;
  private readonly auditSink: AuditSink;
  private readonly layers: Map<IsolationStrategy, IsolationLayer> = new Map();
  private readonly stats: SessionStats = { executions: 0, violations: 0, hostEscapes: 0 };

  constructor(opts: {
    config?: Partial<SandboxEngineConfig>;
    gateFn: GateFn;
    auditSink: AuditSink;
  }) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...opts.config };
    this.currentMode = this.config.mode;
    this.gateFn = opts.gateFn;
    this.auditSink = opts.auditSink;
  }

  // ── Layer Registration ────────────────────────────────────────────────────

  /** Register an isolation layer implementation. */
  registerLayer(layer: IsolationLayer): void {
    this.layers.set(layer.strategy, layer);
  }

  // ── Main Entry Point ──────────────────────────────────────────────────────

  /**
   * Execute a command through the full sandbox pipeline.
   * This is the only authorized execution path in DanteCode.
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const violations: SandboxViolation[] = [];

    // ── Step 1: Policy evaluation ───────────────────────────────────────────
    const policy = evaluatePolicy(request);

    if (!policy.allow) {
      violations.push({
        requestId: request.id,
        command: request.command,
        reason: policy.reason,
        riskLevel: policy.riskLevel,
        blocked: true,
        at: new Date().toISOString(),
      });
      this.stats.violations++;

      const blockDecision = buildBlockDecision(request.id, policy.reason, "mock");
      await this.audit({ request, decision: blockDecision, violations, hostEscape: false });
      return this.buildBlockedResult(request, policy.reason);
    }

    // ── Step 2: Strategy selection ──────────────────────────────────────────
    let strategy: IsolationStrategy;
    try {
      strategy = await this.selectStrategy(request);
    } catch (err) {
      const reason = `Strategy selection failed: ${err instanceof Error ? err.message : String(err)}`;
      const blockDecision = buildBlockDecision(request.id, reason, "mock");
      await this.audit({ request, decision: blockDecision, violations, hostEscape: false });
      return this.buildBlockedResult(request, reason);
    }

    // ── Step 3: DanteForge gate ─────────────────────────────────────────────
    let decision: SandboxDecision;
    try {
      decision = await this.gateFn({ ...request, requestedMode: this.currentMode });
      // Merge policy risk into gate decision if gate was more permissive
      if (policy.riskLevel === "critical" && decision.allow) {
        decision = { ...decision, allow: false, reason: policy.reason, gateVerdict: "block" };
      }
    } catch (err) {
      // Gate failure → fail closed
      const reason = `DanteForge gate error: ${err instanceof Error ? err.message : String(err)}`;
      decision = buildBlockDecision(request.id, reason, strategy);
    }

    if (!decision.allow) {
      violations.push({
        requestId: request.id,
        command: request.command,
        reason: decision.reason,
        riskLevel: decision.riskLevel,
        blocked: true,
        at: new Date().toISOString(),
      });
      this.stats.violations++;
      await this.audit({ request, decision, violations, hostEscape: false });
      return this.buildBlockedResult(request, decision.reason);
    }

    // ── Step 4: Host escape guard ───────────────────────────────────────────
    const isHostEscape = strategy === "host";
    if (isHostEscape && !this.config.allowHostEscape) {
      const reason = "Host execution is not permitted. Enable allowHostEscape in config.";
      const blockDecision = buildBlockDecision(request.id, reason, strategy);
      await this.audit({ request, decision: blockDecision, violations, hostEscape: true });
      return this.buildBlockedResult(request, reason);
    }

    // ── Step 5: Execute in isolation ────────────────────────────────────────
    this.stats.executions++;
    if (isHostEscape) this.stats.hostEscapes++;

    // Find the layer for the selected strategy; fall back through the chain if none registered.
    let layer = this.layers.get(strategy);
    if (!layer) {
      const fallbackOrder: IsolationStrategy[] = ["native", "docker", "worktree", "host"];
      for (const fb of fallbackOrder) {
        if (fb !== strategy && this.layers.has(fb)) {
          layer = this.layers.get(fb);
          strategy = fb;
          break;
        }
      }
    }
    if (!layer) {
      const reason = `No isolation layer registered (tried: ${strategy})`;
      const blockDecision = buildBlockDecision(request.id, reason, strategy);
      await this.audit({ request, decision: blockDecision, violations, hostEscape: false });
      return this.buildBlockedResult(request, reason);
    }

    let result: ExecutionResult;
    try {
      result = await layer.execute(request);
    } catch (err) {
      result = {
        requestId: request.id,
        exitCode: -1,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: 0,
        timedOut: false,
        strategy,
        sandboxed: strategy !== "host",
        violations: [],
      };
    }

    // ── Step 6: Audit ───────────────────────────────────────────────────────
    await this.audit({ request, decision, result, violations, hostEscape: isHostEscape });

    return result;
  }

  // ── Status ────────────────────────────────────────────────────────────────

  async getStatus(): Promise<SandboxStatus> {
    const [available, dockerReady, worktreeReady] = await Promise.all([
      detectAvailableStrategies(),
      isDockerAvailable(),
      isWorktreeAvailable(),
    ]);

    const preferred = dockerReady ? "docker" : worktreeReady ? "worktree" : "host";

    return {
      enforced: this.currentMode !== "off",
      mode: this.currentMode,
      available,
      preferred,
      dockerReady,
      worktreeReady,
      executionCount: this.stats.executions,
      violationCount: this.stats.violations,
      hostEscapeCount: this.stats.hostEscapes,
    };
  }

  setMode(mode: SandboxMode): void {
    this.currentMode = mode;
  }

  getMode(): SandboxMode {
    return this.currentMode;
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  async teardown(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.layers.values()).map((l) => l.teardown()),
    );
    this.layers.clear();
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private async selectStrategy(request: ExecutionRequest): Promise<IsolationStrategy> {
    const mode = request.requestedMode !== "auto" ? request.requestedMode : this.currentMode;

    if (mode === "docker") {
      if (await isDockerAvailable()) return "docker";
      if (await isWorktreeAvailable()) return "worktree";
      return "host";
    }
    if (mode === "worktree") {
      if (await isWorktreeAvailable()) return "worktree";
      return "host";
    }
    if (mode === "host-escape") return "host";
    if (mode === "off") return "host";

    // auto: Prefer native (zero-dep, fast) → docker → worktree → host
    const isTrusted = this.config.trustedTaskClasses.includes(request.taskType);
    if (this.layers.has("native")) return "native";
    if (!isTrusted && await isDockerAvailable()) return "docker";
    if (await isWorktreeAvailable()) return "worktree";
    if (await isDockerAvailable()) return "docker";
    return "host";
  }

  private async audit(opts: {
    request: ExecutionRequest;
    decision: SandboxDecision;
    result?: ExecutionResult;
    violations: SandboxViolation[];
    hostEscape: boolean;
  }): Promise<void> {
    const record: SandboxAuditRecord = {
      id: randomUUID(),
      request: opts.request,
      decision: opts.decision,
      result: opts.result,
      violations: opts.violations,
      hostEscape: opts.hostEscape,
      at: new Date().toISOString(),
      sessionId: opts.request.sessionId,
      checkpointId: opts.request.checkpointId,
    };
    try {
      await this.auditSink(record);
    } catch {
      // Audit sink failures must not break execution
    }
  }

  private buildBlockedResult(request: ExecutionRequest, reason: string): ExecutionResult {
    return {
      requestId: request.id,
      exitCode: 1,
      stdout: "",
      stderr: `[DanteSandbox] Execution blocked: ${reason}`,
      durationMs: 0,
      timedOut: false,
      strategy: "mock",
      sandboxed: true,
      violations: [reason],
    };
  }
}
