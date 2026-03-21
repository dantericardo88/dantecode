// ============================================================================
// @dantecode/dante-sandbox — Public API
// ============================================================================

// ── Primary Integration Surface ───────────────────────────────────────────────
export { DanteSandbox, getEngine } from "./integration.js";
export type { DanteSandboxSetupOptions } from "./integration.js";

// ── Execution Proxy ────────────────────────────────────────────────────────────
export {
  ExecutionProxy,
  setGlobalProxy,
  getGlobalProxy,
  sandboxRun,
  toToolResult,
} from "./execution-proxy.js";

// ── Engine ────────────────────────────────────────────────────────────────────
export { SandboxEngine } from "./sandbox-engine.js";

// ── Isolation Layers ──────────────────────────────────────────────────────────
export { NativeSandbox } from "./native-sandbox.js";
export { DockerIsolationLayer } from "./docker-isolation.js";
export { WorktreeIsolationLayer } from "./worktree-isolation.js";
export { HostEscapeLayer } from "./host-escape.js";

// ── Audit ─────────────────────────────────────────────────────────────────────
export { SandboxAuditLog, noopAuditSink } from "./audit-log.js";

// ── Gate ──────────────────────────────────────────────────────────────────────
export { buildDanteForgeGate, permissiveGate } from "./danteforge-gate.js";

// ── Policy ────────────────────────────────────────────────────────────────────
export { evaluatePolicy, buildDecision, buildBlockDecision } from "./policy-engine.js";

// ── Capability Detection ──────────────────────────────────────────────────────
export {
  isDockerAvailable,
  isWorktreeAvailable,
  detectAvailableStrategies,
  selectStrategy,
  resetCapabilityCache,
} from "./capability-check.js";

// ── Types (re-export from runtime-spine + local) ──────────────────────────────
export type {
  SandboxMode,
  IsolationStrategy,
  RiskLevel,
  GateVerdict,
  ExecutionRequest,
  ExecutionResult,
  SandboxDecision,
  SandboxViolation,
  SandboxAuditRecord,
  SandboxAuditRef,
  SandboxStatus,
  IsolationLayer,
  GateFn,
  AuditSink,
  ProxyCallOptions,
  SandboxEngineConfig,
} from "./types.js";

// ── Approval Engine ───────────────────────────────────────────────────────────
export { ApprovalEngine, globalApprovalEngine, getGlobalApprovalEngine } from './approval-engine.js';
export type { ApprovalPolicy, ApprovalRequest } from './approval-engine.js';
