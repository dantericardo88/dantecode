import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Stable JSON Serialization
// THIS IS THE #1 SOURCE OF HASH INSTABILITY.
// All hashing must use sorted-key JSON for determinism.
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON serialization with recursively sorted keys.
 * Guarantees: same object → same string → same hash, always.
 */
export function stableJSON(obj: unknown): string {
  return JSON.stringify(deepSortKeys(obj));
}

function deepSortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepSortKeys);
  return Object.keys(obj as Record<string, unknown>)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = deepSortKeys((obj as Record<string, unknown>)[key]);
        return acc;
      },
      {} as Record<string, unknown>,
    );
}

// ---------------------------------------------------------------------------
// SHA-256 Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hash of a string, returned as 64-char lowercase hex. */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** SHA-256 hash of an object via stableJSON serialization. */
export function hashDict(obj: Record<string, unknown>): string {
  return sha256(stableJSON(obj));
}

// ---------------------------------------------------------------------------
// Evidence Type Enum
// ---------------------------------------------------------------------------

export enum EvidenceType {
  // Agent lifecycle
  SESSION_STARTED = "session.started",
  SESSION_COMPLETED = "session.completed",
  SESSION_SEALED = "session.sealed",

  // Model operations
  MODEL_DECISION = "model.decision",
  MODEL_ROUTER_SELECTION = "model.router_selection",
  MODEL_FALLBACK = "model.fallback",

  // Tool execution
  TOOL_CALL = "tool.call",
  TOOL_RESULT = "tool.result",
  TOOL_ERROR = "tool.error",

  // File operations
  FILE_WRITE = "file.write",
  FILE_DELETE = "file.delete",
  FILE_MOVE = "file.move",
  FILE_RESTORE = "file.restore",

  // Verification
  VERIFICATION_STARTED = "verification.started",
  VERIFICATION_PASSED = "verification.passed",
  VERIFICATION_FAILED = "verification.failed",
  PDSE_SCORED = "verification.pdse_scored",

  // Constitutional enforcement
  CONSTITUTION_CHECK = "constitution.check",
  CONSTITUTION_VIOLATION = "constitution.violation",
  ANTISTUB_SCAN = "constitution.antistub_scan",
  SECURITY_SCAN = "constitution.security_scan",

  // DanteForge gates
  GSTACK_RUN = "danteforge.gstack_run",
  GSTACK_PASSED = "danteforge.gstack_passed",
  GSTACK_FAILED = "danteforge.gstack_failed",
  AUTOFORGE_DECISION = "danteforge.autoforge_decision",

  // Git operations
  GIT_COMMIT = "git.commit",
  GIT_WORKTREE_CREATED = "git.worktree_created",
  GIT_MERGE = "git.merge",

  // Sandbox
  SANDBOX_EXEC_START = "sandbox.exec_start",
  SANDBOX_EXEC_COMPLETE = "sandbox.exec_complete",

  // Council / Multi-agent
  COUNCIL_DEBATE = "council.debate",
  COUNCIL_DECISION = "council.decision",
  LANE_START = "lane.start",
  LANE_END = "lane.end",

  // Gaslight / Skillbook
  GASLIGHT_ITERATION = "gaslight.iteration",
  SKILLBOOK_LESSON = "skillbook.lesson",

  // Checkpoint
  CHECKPOINT_CREATED = "checkpoint.created",
  CHECKPOINT_RESTORED = "checkpoint.restored",

  // Anomaly
  ANOMALY_DETECTED = "anomaly.detected",

  // Evidence meta
  CHAIN_INTEGRITY_CHECK = "evidence.chain_integrity_check",
  SESSION_SEAL_CREATED = "evidence.session_seal_created",
}
