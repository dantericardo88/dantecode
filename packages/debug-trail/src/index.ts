// ============================================================================
// @dantecode/debug-trail — Public API
// Always-on, immutable, queryable forensic debug spine for DanteCode agents.
// PRD: Persistent Debug Memory Enhancement v1.0 — Target 9.0+
// ============================================================================

// --- Core types ---
export type {
  TrailProvenance,
  TrailEventKind,
  TrailEvent,
  FileSnapshotRecord,
  DeleteTombstone,
  ReplayCursor,
  TrailCompletenessScore,
  TrailRetentionDecision,
  DebugTrailResult,
  DebugSnapshotResult,
  DebugRestoreResult,
  DebugReplayResult,
  AuditExportResult,
  DebugTrailConfig,
} from "./types.js";
export { defaultConfig, DiskWriteError } from "./types.js";

// --- Storage ---
export { TrailStore, getTrailStore, getStorePaths } from "./sqlite-store.js";
export type { TrailIndex, SessionRecord } from "./sqlite-store.js";

// --- Hash Engine ---
export {
  hashContent,
  hashFile,
  shortHash,
  makeSnapshotId,
  makeTombstoneId,
  makeTrailEventId,
  hashesEqual,
} from "./hash-engine.js";

// --- State ---
export { TrailEventIndex } from "./state/trail-index.js";
export type { IndexEntry } from "./state/trail-index.js";
export { SessionMap } from "./state/session-map.js";
export type { SessionInfo } from "./state/session-map.js";
export { TombstoneRegistry } from "./state/tombstones.js";

// --- Audit Logger ---
export { AuditLogger, getGlobalLogger, resetGlobalLogger } from "./audit-logger.js";
export type { AuditLoggerOptions, FlushResult } from "./audit-logger.js";

// --- File Snapshotter ---
export { FileSnapshotter } from "./file-snapshotter.js";

// --- Diff Engine ---
export {
  diffText,
  diffBuffers,
  formatUnifiedDiff,
  isBinaryContent,
} from "./diff-engine.js";
export type { FileDiff, DiffHunk, DiffLine } from "./diff-engine.js";

// --- Restore Engine ---
export { RestoreEngine } from "./restore-engine.js";
export type { RestoreOptions } from "./restore-engine.js";

// --- Trail Query Engine ---
export { TrailQueryEngine, parseNaturalLanguageQuery, TrailErrorCode } from "./trail-query-engine.js";
export type { TrailQuery, TrailErrorCode as TrailErrorCodeType } from "./trail-query-engine.js";

// --- Replay Orchestrator ---
export { ReplayOrchestrator } from "./replay-orchestrator.js";

// --- Anomaly Detector ---
export { AnomalyDetector } from "./anomaly-detector.js";
export type { AnomalyFlag, AnomalyType, AnomalyDetectorConfig } from "./anomaly-detector.js";

// --- Export Engine ---
export { ExportEngine, scoreCompleteness } from "./export-engine.js";
export type { ExportOptions, ExportFormat } from "./export-engine.js";

// --- Policies ---
export { RetentionPolicy } from "./policies/retention-policy.js";
export type { RetentionPolicyConfig } from "./policies/retention-policy.js";
export { CompressionPolicy } from "./policies/compression-policy.js";
export type { CompressionPolicyConfig, CompressionDecision } from "./policies/compression-policy.js";
export { PrivacyPolicy, StorageQuotaPolicy } from "./policies/privacy-policy.js";
export type { PrivacyPolicyConfig } from "./policies/privacy-policy.js";

// --- Integration Bridges ---
export { GitBridge } from "./integrations/git-bridge.js";
export type { GitContext } from "./integrations/git-bridge.js";
export { CheckpointerBridge } from "./integrations/checkpointer-bridge.js";
export type { CheckpointLinkage } from "./integrations/checkpointer-bridge.js";
export { SandboxBridge } from "./integrations/sandbox-bridge.js";
export type { SandboxContext } from "./integrations/sandbox-bridge.js";
export { DanteForgeBridge } from "./integrations/danteforge-bridge.js";
export type { TrailTrustResult } from "./integrations/danteforge-bridge.js";
export { CliBridge } from "./integrations/cli-bridge.js";
export { VsCodeBridge } from "./integrations/vscode-bridge.js";
export type { VsCodeTrailMessage, VsCodeTrailMessageKind } from "./integrations/vscode-bridge.js";

// --- Evidence Chain Integration (Soul Seal) ---
export { EvidenceBridge } from "./integrations/evidence-bridge.js";
export type { CertificationSeal, EvidenceBundleData, Receipt, MerkleProofStep } from "@dantecode/evidence-chain";
export { EvidenceType } from "@dantecode/evidence-chain";
export type { ReplayVerification } from "./replay-orchestrator.js";

// ============================================================================
// Top-level convenience functions (debugTrail / debugSnapshot / debugRestore /
// debugReplay / auditExport) — match the PRD's public API surface exactly.
// ============================================================================

import { getGlobalLogger } from "./audit-logger.js";
import { CliBridge } from "./integrations/cli-bridge.js";
import type { DebugTrailConfig } from "./types.js";
import type {
  DebugTrailResult,
  DebugSnapshotResult,
  DebugRestoreResult,
  DebugReplayResult,
  AuditExportResult,
} from "./types.js";

let _bridge: CliBridge | null = null;

function getBridge(config?: Partial<DebugTrailConfig>): CliBridge {
  if (!_bridge) {
    _bridge = new CliBridge(getGlobalLogger(), config);
  }
  return _bridge;
}

/** Search the debug trail. Accepts natural language or structured query string. */
export async function debugTrail(
  query?: string,
  config?: Partial<DebugTrailConfig>,
): Promise<DebugTrailResult> {
  return getBridge(config).debugTrail(query);
}

/** Capture a snapshot of a file or the current session. */
export async function debugSnapshot(
  fileOrSession?: string,
  config?: Partial<DebugTrailConfig>,
): Promise<DebugSnapshotResult> {
  return getBridge(config).debugSnapshot(fileOrSession);
}

/** Restore a file from a snapshot ID or tombstone. */
export async function debugRestore(
  id: string,
  config?: Partial<DebugTrailConfig>,
): Promise<DebugRestoreResult> {
  return getBridge(config).debugRestore(id);
}

/** Replay a session step by step. */
export async function debugReplay(
  sessionId: string,
  step?: number,
  config?: Partial<DebugTrailConfig>,
): Promise<DebugReplayResult> {
  return getBridge(config).debugReplay(sessionId, step);
}

/** Export a session as an immutable forensic report. */
export async function auditExport(
  sessionId: string,
  config?: Partial<DebugTrailConfig>,
): Promise<AuditExportResult> {
  return getBridge(config).auditExport(sessionId);
}

/** Reset the global bridge (useful for testing). */
export function resetDebugTrail(): void {
  _bridge = null;
}
