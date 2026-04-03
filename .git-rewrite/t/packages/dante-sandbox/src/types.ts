// ============================================================================
// @dantecode/dante-sandbox — Internal Types
// Re-exports runtime-spine sandbox contracts and adds package-local types.
// ============================================================================

import type {
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
} from "@dantecode/runtime-spine";

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
};

export {
  SandboxModeSchema,
  IsolationStrategySchema,
  RiskLevelSchema,
  GateVerdictSchema,
  ExecutionRequestSchema,
  ExecutionResultSchema,
  SandboxDecisionSchema,
  SandboxViolationSchema,
  SandboxAuditRecordSchema,
  SandboxAuditRefSchema,
} from "@dantecode/runtime-spine";

// ─── Engine Config ────────────────────────────────────────────────────────────

export interface SandboxEngineConfig {
  /** Operating mode — controls which isolation strategies are permitted. */
  mode: SandboxMode;
  /** Allow host execution via the escape hatch (loud warning + audit). */
  allowHostEscape: boolean;
  /** Require explicit confirmation for host-escape commands. */
  requireConfirmationForHostEscape: boolean;
  /** Risk threshold above which DanteForge gate blocks automatically. */
  blockAboveRisk: RiskLevel;
  /** Trusted task classes that may use worktree instead of Docker. */
  trustedTaskClasses: string[];
  /** Whether to run in lite mode (reduced overhead for low-risk tasks). */
  liteMode: boolean;
}

export const DEFAULT_ENGINE_CONFIG: SandboxEngineConfig = {
  mode: "auto",
  allowHostEscape: false,
  requireConfirmationForHostEscape: true,
  blockAboveRisk: "critical",
  trustedTaskClasses: ["git", "read", "grep", "ls"],
  liteMode: false,
};

// ─── Isolation Layer Interface ────────────────────────────────────────────────

/** Common interface all isolation backends must implement. */
export interface IsolationLayer {
  readonly strategy: IsolationStrategy;
  /** Returns true when this layer is currently available. */
  isAvailable(): Promise<boolean>;
  /** Execute a command in isolation and return a normalized result. */
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  /** Clean up any resources held by this layer. */
  teardown(): Promise<void>;
}

// ─── Gate Function ────────────────────────────────────────────────────────────

/**
 * DanteForge gate function signature.
 * Receives an execution request and returns a decision.
 * Defaults to allow-with-policy-check when DanteForge is not available.
 */
export type GateFn = (request: ExecutionRequest) => Promise<SandboxDecision>;

// ─── Audit Sink ───────────────────────────────────────────────────────────────

/** Sink that receives audit records for persistence. */
export type AuditSink = (record: SandboxAuditRecord) => Promise<void> | void;

// ─── Proxy Call ───────────────────────────────────────────────────────────────

/** Options for calling the execution proxy. */
export interface ProxyCallOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  taskType?: string;
  actor?: string;
  sessionId?: string;
  checkpointId?: string;
  /** Override the sandbox mode for this call only. */
  modeOverride?: SandboxMode;
}
