/**
 * tool-call-types.ts — DTR Phase 1: Deterministic Tool Runtime types
 *
 * 7-state tool lifecycle (inspired by Qwen coreToolScheduler.ts:70-147).
 * DanteCode adds: 'verifying' state + typed ArtifactRecord + VerificationResult.
 */

// ─── Tool Lifecycle States ────────────────────────────────────────────────────

/**
 * 10-state tool call status union.
 * Lifecycle: created → validating → (awaiting_approval) → scheduled → executing → verifying → success | error | cancelled | timed_out
 */
export type ToolCallStatus =
  | "created"
  | "validating"
  | "awaiting_approval"
  | "scheduled"
  | "executing"
  | "verifying"
  | "success"
  | "error"
  | "blocked_by_dependency"
  | "cancelled"
  | "timed_out";

/** Terminal states — once reached, no further transitions allowed */
export const TERMINAL_STATES: ReadonlySet<ToolCallStatus> = new Set([
  "success",
  "error",
  "blocked_by_dependency",
  "cancelled",
  "timed_out",
]);

/** Valid state transitions */
export const VALID_TRANSITIONS: Readonly<Record<ToolCallStatus, ReadonlyArray<ToolCallStatus>>> = {
  created: ["validating", "cancelled"],
  validating: ["awaiting_approval", "scheduled", "error", "blocked_by_dependency", "cancelled"],
  awaiting_approval: ["scheduled", "cancelled"],
  scheduled: ["executing", "cancelled"],
  executing: ["verifying", "success", "error", "timed_out", "cancelled"],
  verifying: ["success", "error"],
  success: [],
  error: [],
  blocked_by_dependency: [],
  cancelled: [],
  timed_out: [],
};

// ─── Tool Call Record ─────────────────────────────────────────────────────────

/** A single tool call tracked by the DTR scheduler */
export interface ToolCallRecord {
  readonly id: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly requestId: string; // parent LLM turn ID
  readonly dependsOn?: string[];
  status: ToolCallStatus;
  statusHistory: Array<{ status: ToolCallStatus; ts: number; reason?: string }>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: ToolExecutionResult;
  verificationResult?: VerificationResult;
  artifacts?: ArtifactRecord[];
  errorMessage?: string;
}

// ─── Execution Result ─────────────────────────────────────────────────────────

/**
 * Typed result from any tool execution.
 * Backward-compatible: always includes `content` (string) + `isError` (boolean)
 * so existing callers need no changes.
 */
export interface ToolExecutionResult {
  /** Human-readable output — passed to model as tool result */
  content: string;
  /** True when the tool call itself failed (vs. returning a useful result) */
  isError: boolean;
  /** Structured evidence for post-execution analysis */
  evidence?: ToolExecutionEvidence;
}

export interface ToolExecutionEvidence {
  /** Exit code from Bash executions */
  exitCode?: number;
  /** Files written/modified during this execution */
  filesWritten?: string[];
  /** Files read during this execution */
  filesRead?: string[];
  /** Bytes transferred (download tools) */
  bytesTransferred?: number;
  /** Duration in ms */
  durationMs?: number;
}

// ─── Artifact Record ──────────────────────────────────────────────────────────

export type ArtifactKind =
  | "git_clone"
  | "file_write"
  | "download"
  | "archive_extract"
  | "directory_create";

/** Tracks any artifact created by tool execution (for verification + durable store) */
export interface ArtifactRecord {
  readonly id: string;
  readonly kind: ArtifactKind;
  /** Absolute path on disk */
  readonly path: string;
  readonly toolCallId: string;
  readonly createdAt: number;
  /** Whether post-execution verification confirmed this artifact exists */
  verified: boolean;
  verifiedAt?: number;
  /** Source URL or git remote (for downloads and clones) */
  sourceUrl?: string;
  /** File size in bytes (for downloads) */
  sizeBytes?: number;
  /** Git commit SHA at time of clone */
  gitSha?: string;
}

// ─── Verification ─────────────────────────────────────────────────────────────

export type VerificationCheckKind =
  | "directory_exists"
  | "file_exists"
  | "file_size_nonzero"
  | "git_repo_valid"
  | "archive_extracted";

export interface VerificationCheck {
  readonly kind: VerificationCheckKind;
  readonly path: string;
  /** Optional minimum size in bytes */
  minSizeBytes?: number;
}

export interface VerificationResult {
  readonly passed: boolean;
  readonly checks: VerificationCheckOutcome[];
  readonly failedChecks: VerificationCheckOutcome[];
}

export interface VerificationCheckOutcome {
  readonly check: VerificationCheck;
  readonly passed: boolean;
  readonly actualValue?: string | number | boolean;
  readonly errorMessage?: string;
}

// ─── Scheduler Config ─────────────────────────────────────────────────────────

export interface ToolSchedulerConfig {
  /** Tools that require explicit approval before execution */
  requireApprovalFor?: string[];
  /** Domains that require explicit approval for WebFetch/WebSearch */
  requireApprovalForDomains?: string[];
  /** Maximum concurrent tool executions (default: 1 — sequential) */
  maxConcurrency?: number;
  /** Timeout per tool call in ms (default: 120_000) */
  defaultTimeoutMs?: number;
  /** Whether to run post-execution verification (default: true) */
  verifyAfterExecution?: boolean;
}
