// ============================================================================
// @dantecode/debug-trail — Core Types
// Immutable, queryable forensic debug spine for DanteCode.
// PRD: Persistent Debug Memory Enhancement v1.0 — Target 9.0+
// ============================================================================

// ---------------------------------------------------------------------------
// Provenance — every record must carry this
// ---------------------------------------------------------------------------

export interface TrailProvenance {
  /** Unique session identifier (one per CLI/VSCode session). */
  sessionId: string;
  /** Unique run identifier (one per autoforge/magic invocation). */
  runId: string;
  /** Worktree path if applicable. */
  worktreePath?: string;
  /** Git branch if applicable. */
  branch?: string;
  /** Checkpoint ID if this event was part of a checkpoint transition. */
  checkpointId?: string;
  /** Parent lane ID for council/subagent runs. */
  parentLaneId?: string;
  /** This lane's ID. */
  laneId?: string;
  /** Workflow ID for multi-step pipeline tracking. */
  workflowId?: string;
}

// ---------------------------------------------------------------------------
// Trail Events
// ---------------------------------------------------------------------------

export type TrailEventKind =
  | "tool_call"
  | "tool_result"
  | "model_decision"
  | "file_write"
  | "file_delete"
  | "file_move"
  | "file_restore"
  | "verification"
  | "checkpoint_transition"
  | "error"
  | "retry"
  | "timeout"
  | "lane_start"
  | "lane_end"
  | "workflow_event"
  | "anomaly_flag";

export interface TrailEvent {
  /** Unique event ID (UUID v4). */
  id: string;
  /** Sequential index within the session. */
  seq: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Event kind. */
  kind: TrailEventKind;
  /** Tool or actor name (e.g. "Write", "Edit", "Bash", "model"). */
  actor: string;
  /** Human-readable summary. */
  summary: string;
  /** Structured payload — varies by kind. */
  payload: Record<string, unknown>;
  /** Provenance — session/run/worktree/lane linkage. */
  provenance: TrailProvenance;
  /** Content hash of the file at time of event (if file event). */
  beforeHash?: string;
  /** Content hash after mutation (if write/delete). */
  afterHash?: string;
  /** Snapshot ID referencing stored before-state. */
  beforeSnapshotId?: string;
  /** Snapshot ID referencing stored after-state. */
  afterSnapshotId?: string;
  /** Trust/completeness score (0-1). */
  trustScore?: number;
}

// ---------------------------------------------------------------------------
// File Snapshots
// ---------------------------------------------------------------------------

export interface FileSnapshotRecord {
  /** Unique snapshot ID (content hash or UUID). */
  snapshotId: string;
  /** Absolute path of the original file. */
  filePath: string;
  /** Content hash (SHA-256 hex). */
  contentHash: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** ISO-8601 timestamp when snapshot was taken. */
  capturedAt: string;
  /** Path to the stored snapshot content (outside worktree). */
  storagePath: string;
  /** Whether this snapshot is compressed. */
  compressed: boolean;
  /** Provenance linkage. */
  provenance: TrailProvenance;
  /** Trail event that triggered this snapshot. */
  trailEventId: string;
}

// ---------------------------------------------------------------------------
// Tombstones — deletion records
// ---------------------------------------------------------------------------

export interface DeleteTombstone {
  /** Unique tombstone ID. */
  tombstoneId: string;
  /** Absolute path of the deleted file. */
  filePath: string;
  /** Snapshot ID of the last known state (before delete). */
  lastSnapshotId?: string;
  /** Content hash of file at deletion time (if captured). */
  contentHash?: string;
  /** ISO-8601 deletion timestamp. */
  deletedAt: string;
  /** Actor/tool that performed the deletion. */
  deletedBy: string;
  /** Whether before-state was successfully captured. */
  beforeStateCaptured: boolean;
  /** If before-state could not be captured, why. */
  missingBeforeReason?: string;
  /** Provenance linkage. */
  provenance: TrailProvenance;
  /** Trail event ID. */
  trailEventId: string;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayCursor {
  /** Session being replayed. */
  sessionId: string;
  /** Current step index. */
  currentStep: number;
  /** Total steps in session. */
  totalSteps: number;
  /** Events available from this position. */
  events: TrailEvent[];
  /** File state at this cursor position (filePath → snapshotId). */
  fileStateMap: Record<string, string>;
  /** Whether replay has reached the end. */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Completeness / Trust scoring
// ---------------------------------------------------------------------------

export interface TrailCompletenessScore {
  /** Session ID scored. */
  sessionId: string;
  /** Overall completeness (0-1). */
  score: number;
  /** Total events in session. */
  totalEvents: number;
  /** Events with full provenance. */
  eventsWithProvenance: number;
  /** File events with before/after snapshots. */
  fileEventsWithSnapshots: number;
  /** Total file events. */
  totalFileEvents: number;
  /** Missing provenance event IDs. */
  missingProvenance: string[];
  /** File events lacking snapshots. */
  snapshotGaps: string[];
  /** ISO-8601 timestamp of scoring. */
  scoredAt: string;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export interface TrailRetentionDecision {
  /** Session ID. */
  sessionId: string;
  /** Decision: keep, compress, archive, prune. */
  decision: "keep" | "compress" | "archive" | "prune";
  /** Reason for decision. */
  reason: string;
  /** ISO-8601 timestamp. */
  decidedAt: string;
  /** Whether session is pinned (always keep). */
  pinned: boolean;
  /** Retention policy ID that produced this decision. */
  policyId: string;
}

// ---------------------------------------------------------------------------
// Public API Result Types
// ---------------------------------------------------------------------------

export interface DebugTrailResult {
  query?: string;
  results: TrailEvent[];
  latencyMs: number;
  totalMatches: number;
}

export interface DebugSnapshotResult {
  snapshotId: string;
  target: string;
  created: boolean;
  contentHash?: string;
  sizeBytes?: number;
}

export interface DebugRestoreResult {
  snapshotId: string;
  restored: boolean;
  targetPath?: string;
  auditEventId?: string;
  error?: string;
  dryRunDetails?: {
    snapshotExists: boolean;
    targetExists: boolean;
    wouldOverwrite: boolean;
    snapshotSizeBytes?: number;
  };
}

export interface DebugReplayResult {
  sessionId: string;
  step?: number;
  replayed: boolean;
  trail: TrailEvent[];
  cursor: ReplayCursor;
}

export interface AuditExportResult {
  sessionId: string;
  path: string;
  completenessScore?: number;
  eventCount: number;
  snapshotCount: number;
  exportedAt: string;
}

// ---------------------------------------------------------------------------
// Storage config
// ---------------------------------------------------------------------------

export interface DebugTrailConfig {
  /** Base directory for trail storage (outside worktree). Default: ~/.dantecode/debug-trail */
  storageRoot: string;
  /** Whether the trail is enabled. Default: true */
  enabled: boolean;
  /** Retention window in days. Default: 30 */
  retentionDays: number;
  /** Whether to compress snapshots older than compressAfterDays. Default: true */
  compressSnapshots: boolean;
  /** Compress snapshots older than N days. Default: 7 */
  compressAfterDays: number;
  /** Maximum storage size in MB before pruning. Default: 500 */
  maxStorageMb: number;
  /** Optional encryption passphrase. */
  encryptionKey?: string;
  /**
   * Maximum number of events to keep in the in-memory session buffer used for
   * anomaly detection on flush(). Events beyond this limit are still persisted to
   * disk but not included in detection. Default: 10_000.
   */
  sessionEventsBufferLimit: number;
}

// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------

/** Thrown by AuditLogger.log() when the underlying disk write fails. */
export class DiskWriteError extends Error {
  constructor(
    public readonly eventId: string,
    public readonly seq: number,
    public readonly cause: unknown,
  ) {
    super(`DiskWriteError: event seq=${seq} id=${eventId} — ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "DiskWriteError";
  }
}

export function defaultConfig(): DebugTrailConfig {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "/tmp";
  return {
    storageRoot: `${home}/.dantecode/debug-trail`,
    enabled: true,
    retentionDays: 30,
    compressSnapshots: true,
    compressAfterDays: 7,
    maxStorageMb: 500,
    sessionEventsBufferLimit: 10_000,
  };
}
