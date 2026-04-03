/**
 * sandbox-types.ts
 *
 * Canonical contracts for the DanteSandbox enforcement spine.
 * All execution requests, decisions, results, and audit records
 * are typed here and imported by both dante-sandbox and runtime.
 */

import { z } from "zod";

// ─── Enumerations ─────────────────────────────────────────────────────────────

/** The configured sandbox operating mode. */
export const SandboxModeSchema = z.enum([
  "off", // legacy compat only — no enforcement
  "auto", // Docker preferred, worktree fallback (recommended default)
  "docker", // force Docker isolation
  "worktree", // force git-worktree isolation
  "host-escape", // explicit governed host execution (audit + warning required)
]);
export type SandboxMode = z.infer<typeof SandboxModeSchema>;

/** The concrete isolation strategy selected for a specific execution. */
export const IsolationStrategySchema = z.enum([
  "native", // OS-native sandbox (macOS Seatbelt / Linux bwrap)
  "docker", // Docker container
  "worktree", // git worktree isolation
  "host", // host execution (escape path — must be audited)
  "mock", // dry-run / test mode
]);
export type IsolationStrategy = z.infer<typeof IsolationStrategySchema>;

/** Risk classification of an execution request. */
export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/** Gate verdict from DanteForge policy evaluation. */
export const GateVerdictSchema = z.enum(["allow", "warn", "block", "require-override"]);
export type GateVerdict = z.infer<typeof GateVerdictSchema>;

// ─── Execution Request ────────────────────────────────────────────────────────

/**
 * Canonical execution request — every caller must produce one of these
 * before any command may execute. Produced by the ExecutionProxy.
 */
export const ExecutionRequestSchema = z.object({
  /** UUID assigned by the proxy at intercept time. */
  id: z.string().uuid(),
  /** The full shell command string. */
  command: z.string(),
  /** Optional parsed argument list (informational). */
  args: z.array(z.string()).default([]),
  /** Working directory for the execution. */
  cwd: z.string().optional(),
  /** Additional environment variables. */
  env: z.record(z.string()).default({}),
  /** Logical task type (e.g., "bash", "git", "build", "test"). */
  taskType: z.string().default("bash"),
  /** Caller identity (e.g., "agent-loop", "tools", "multi-agent"). */
  actor: z.string().default("agent"),
  /** Requested sandbox mode (may be overridden by policy). */
  requestedMode: SandboxModeSchema.default("auto"),
  /** Hard timeout in milliseconds. */
  timeoutMs: z.number().int().positive().default(30_000),
  /** Parent session ID for audit linkage. */
  sessionId: z.string().optional(),
  /** Parent checkpoint ID for audit trail linking. */
  checkpointId: z.string().optional(),
});
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;

// ─── Execution Result ─────────────────────────────────────────────────────────

/** Normalized result returned to every caller — no raw process state. */
export const ExecutionResultSchema = z.object({
  /** The request ID this result answers. */
  requestId: z.string().uuid(),
  /** Process exit code (0 = success). */
  exitCode: z.number().int(),
  /** Captured standard output. */
  stdout: z.string(),
  /** Captured standard error. */
  stderr: z.string(),
  /** Wall-clock execution time in milliseconds. */
  durationMs: z.number(),
  /** True when execution was killed due to timeout. */
  timedOut: z.boolean().default(false),
  /** The isolation strategy that was actually used. */
  strategy: IsolationStrategySchema,
  /** Whether execution was sandboxed (false only for audited host escapes). */
  sandboxed: z.boolean(),
  /** Policy violation messages detected during execution. */
  violations: z.array(z.string()).default([]),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

// ─── Sandbox Decision ─────────────────────────────────────────────────────────

/** The decision record produced by the DanteForge gate for each request. */
export const SandboxDecisionSchema = z.object({
  /** Links back to the execution request. */
  requestId: z.string().uuid(),
  /** Whether execution is permitted to proceed. */
  allow: z.boolean(),
  /** The isolation strategy selected by the engine. */
  strategy: IsolationStrategySchema,
  /** Human-readable reason for the decision. */
  reason: z.string(),
  /** Risk classification assigned to this command. */
  riskLevel: RiskLevelSchema,
  /** DanteForge gate verdict. */
  gateVerdict: GateVerdictSchema,
  /** Whether an explicit human/policy confirmation is required. */
  requiresConfirmation: z.boolean().default(false),
  /** DanteForge safety score [0..1] if computed. */
  gateScore: z.number().min(0).max(1).optional(),
  /** ISO-8601 decision timestamp. */
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});
export type SandboxDecision = z.infer<typeof SandboxDecisionSchema>;

// ─── Violation ────────────────────────────────────────────────────────────────

/** A single policy violation event captured during gate or execution. */
export const SandboxViolationSchema = z.object({
  requestId: z.string().uuid(),
  command: z.string(),
  reason: z.string(),
  riskLevel: RiskLevelSchema,
  /** Whether execution was blocked (false = warn-only). */
  blocked: z.boolean(),
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});
export type SandboxViolation = z.infer<typeof SandboxViolationSchema>;

// ─── Audit Record ─────────────────────────────────────────────────────────────

/** Full execution audit record — persisted for every meaningful execution. */
export const SandboxAuditRecordSchema = z.object({
  /** Unique audit record ID. */
  id: z.string().uuid(),
  /** Full normalized request. */
  request: ExecutionRequestSchema,
  /** Gate decision. */
  decision: SandboxDecisionSchema,
  /** Execution result (absent when blocked before execution). */
  result: ExecutionResultSchema.optional(),
  /** All violations captured. */
  violations: z.array(SandboxViolationSchema).default([]),
  /** True when host escape was used. */
  hostEscape: z.boolean().default(false),
  /** ISO-8601 record timestamp. */
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
  /** Parent session ID. */
  sessionId: z.string().optional(),
  /** Parent checkpoint ID for trail linkage. */
  checkpointId: z.string().optional(),
});
export type SandboxAuditRecord = z.infer<typeof SandboxAuditRecordSchema>;

// ─── Checkpoint Reference ──────────────────────────────────────────────────────

/**
 * Lightweight sandbox summary embedded in each Checkpoint.
 * Links to the full audit trail without duplicating records.
 */
export const SandboxAuditRefSchema = z.object({
  /** Last isolation strategy used in this checkpoint window. */
  lastStrategy: IsolationStrategySchema.optional(),
  /** Active sandbox mode at checkpoint time. */
  activeMode: SandboxModeSchema.optional(),
  /** Total number of policy violations in this checkpoint window. */
  violationCount: z.number().int().min(0).default(0),
  /** Number of host escape executions in this checkpoint window. */
  hostEscapeCount: z.number().int().min(0).default(0),
  /** IDs of SandboxAuditRecord entries linked from this checkpoint. */
  auditRecordIds: z.array(z.string().uuid()).default([]),
  /** ISO-8601 timestamp. */
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});
export type SandboxAuditRef = z.infer<typeof SandboxAuditRefSchema>;

// ─── Status ───────────────────────────────────────────────────────────────────

/** Live status snapshot reported by /sandbox status. */
export interface SandboxStatus {
  /** Whether enforcement is active (false only in "off" mode). */
  enforced: boolean;
  /** Current operating mode. */
  mode: SandboxMode;
  /** Detected available strategies. */
  available: IsolationStrategy[];
  /** Preferred strategy in use. */
  preferred: IsolationStrategy;
  /** Whether Docker daemon is reachable. */
  dockerReady: boolean;
  /** Whether git worktree creation is available. */
  worktreeReady: boolean;
  /** Total executions in current session. */
  executionCount: number;
  /** Total violations in current session. */
  violationCount: number;
  /** Total host escapes in current session. */
  hostEscapeCount: number;
}
