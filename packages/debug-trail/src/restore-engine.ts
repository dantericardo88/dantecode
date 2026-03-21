// ============================================================================
// @dantecode/debug-trail — Restore Engine
// Restores files from forensic snapshots with full audit trail.
// PRD hard rule: no restore without audit record.
// ============================================================================

import { existsSync } from "node:fs";
import type { DebugRestoreResult } from "./types.js";
import { FileSnapshotter } from "./file-snapshotter.js";
import { AuditLogger } from "./audit-logger.js";
import { hashFile, shortHash } from "./hash-engine.js";

// ---------------------------------------------------------------------------
// Restore options
// ---------------------------------------------------------------------------

export interface RestoreOptions {
  /** Target path. Defaults to the original file path recorded in the snapshot. */
  targetPath?: string;
  /** Whether to overwrite if target already exists. Default: true. */
  overwrite?: boolean;
  /** Dry run — check if restore is possible without writing. */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Restore Engine
// ---------------------------------------------------------------------------

export class RestoreEngine {
  constructor(
    private readonly snapshotter: FileSnapshotter,
    private readonly logger: AuditLogger,
  ) {}

  /**
   * Restore a file from a snapshot ID.
   * PRD: no restore without audit record.
   */
  async restoreFromSnapshot(
    snapshotId: string,
    originalFilePath: string,
    options: RestoreOptions = {},
  ): Promise<DebugRestoreResult> {
    const targetPath = options.targetPath ?? originalFilePath;
    const provenance = this.logger.getProvenance();

    // Check snapshot exists
    const snapshotExists = await this.snapshotter.snapshotExists(snapshotId);
    if (!snapshotExists) {
      const auditEventId = await this.logger.log(
        "file_restore",
        "RestoreEngine",
        `Restore failed: snapshot ${snapshotId} not found`,
        { snapshotId, targetPath, error: "snapshot_not_found" },
      );
      return {
        snapshotId,
        restored: false,
        targetPath,
        auditEventId,
        error: `Snapshot ${snapshotId} not found in storage`,
      };
    }

    // Check target safety
    // F1: treat undefined as true per JSDoc "Default: true" — only block when explicitly false.
    if (existsSync(targetPath) && options.overwrite === false) {
      const auditEventId = await this.logger.log(
        "file_restore",
        "RestoreEngine",
        `Restore blocked: target exists and overwrite=false`,
        { snapshotId, targetPath, error: "target_exists" },
      );
      return {
        snapshotId,
        restored: false,
        targetPath,
        auditEventId,
        error: `Target path ${targetPath} already exists and overwrite is disabled`,
      };
    }

    if (options.dryRun) {
      const targetExists = existsSync(targetPath);
      const snapshotExistsNow = await this.snapshotter.snapshotExists(snapshotId);
      // A3: PRD rule — no restore without audit record; dry-run must also be logged.
      const auditEventId = await this.logger.log(
        "file_restore",
        "RestoreEngine",
        `Dry-run restore: snapshot ${snapshotId} → ${targetPath}`,
        { snapshotId, targetPath, dryRun: true, snapshotExists: snapshotExistsNow, targetExists },
      );
      return {
        snapshotId,
        restored: false,
        targetPath,
        auditEventId,
        error: "dry_run",
        dryRunDetails: {
          snapshotExists: snapshotExistsNow,
          targetExists,
          wouldOverwrite: targetExists,
        },
      };
    }

    // Capture current state of target before overwriting (audit trail)
    const currentHash = await hashFile(targetPath);
    let preRestoreSnapshotId: string | undefined;
    if (currentHash) {
      const pre = await this.snapshotter.captureSnapshot(
        targetPath,
        "pre-restore-capture",
        provenance,
      );
      preRestoreSnapshotId = pre?.snapshotId;
    }

    // Perform the restore
    const success = await this.snapshotter.restoreSnapshot(snapshotId, targetPath);

    if (!success) {
      const auditEventId = await this.logger.log(
        "file_restore",
        "RestoreEngine",
        `Restore failed: could not write to ${targetPath}`,
        { snapshotId, targetPath, error: "write_failed" },
      );
      return {
        snapshotId,
        restored: false,
        targetPath,
        auditEventId,
        error: `Failed to write restored content to ${targetPath}`,
      };
    }

    // Capture after-state
    const afterHash = await hashFile(targetPath);
    const afterSnap = afterHash
      ? await this.snapshotter.captureSnapshot(targetPath, "post-restore-capture", provenance)
      : null;

    // Verify content integrity: restored file hash must match snapshot record
    const snapRecords = await this.snapshotter.getSnapshotRecords();
    const snapRecord = snapRecords.find((r) => r.snapshotId === snapshotId);
    // A1: explicit guard — if afterHash is null, verification is impossible; fail fast.
    if (snapRecord && afterHash === null) {
      const errEventId = await this.logger.log(
        "file_restore",
        "RestoreEngine",
        `Restore integrity check failed: file unreadable after restore to ${targetPath}`,
        { snapshotId, targetPath, error: "post_restore_unreadable" },
      );
      return {
        snapshotId,
        restored: false,
        targetPath,
        auditEventId: errEventId,
        error: "Cannot verify: file unreadable after restore",
      };
    }
    if (snapRecord && afterHash && afterHash !== snapRecord.contentHash) {
      const errEventId = await this.logger.log(
        "file_restore",
        "RestoreEngine",
        `Restore hash mismatch for ${targetPath}`,
        { snapshotId, targetPath, expected: snapRecord.contentHash, actual: afterHash, error: "hash_mismatch" },
      );
      return {
        snapshotId,
        restored: false,
        targetPath,
        auditEventId: errEventId,
        error: `Content hash mismatch: expected ${shortHash(snapRecord.contentHash)} got ${shortHash(afterHash)}`,
      };
    }

    // Mandatory audit record
    const auditEventId = await this.logger.log(
      "file_restore",
      "RestoreEngine",
      `Restored ${targetPath} from snapshot ${snapshotId}`,
      {
        snapshotId,
        targetPath,
        originalPath: originalFilePath,
        preRestoreSnapshotId,
        afterSnapshotId: afterSnap?.snapshotId,
      },
      { afterHash: afterSnap?.contentHash },
    );

    return { snapshotId, restored: true, targetPath, auditEventId };
  }

  /**
   * Restore a deleted file from its tombstone.
   */
  async restoreDeletedFile(
    filePath: string,
    options: RestoreOptions = {},
  ): Promise<DebugRestoreResult> {
    const tombstone = this.snapshotter.getTombstoneForFile(filePath);

    if (!tombstone) {
      return {
        snapshotId: "",
        restored: false,
        targetPath: filePath,
        error: `No tombstone found for ${filePath} — deletion not recorded or file was never tracked`,
      };
    }

    if (!tombstone.lastSnapshotId) {
      return {
        snapshotId: tombstone.tombstoneId,
        restored: false,
        targetPath: filePath,
        error: `Tombstone exists for ${filePath} but before-state was not captured: ${tombstone.missingBeforeReason ?? "unknown reason"}`,
      };
    }

    return this.restoreFromSnapshot(tombstone.lastSnapshotId, filePath, options);
  }

  /**
   * List restorable snapshots for a file path.
   */
  // A2: snapshotId is null when no before-state was captured (tombstone ID is not a snapshot ID).
  getRestorableSnapshots(filePath: string): Array<{ snapshotId: string | null; deletedAt: string; hasBeforeState: boolean }> {
    const tombstones = this.snapshotter.getTombstones().allForFile(filePath);
    return tombstones.map((t) => ({
      snapshotId: t.lastSnapshotId ?? null,
      deletedAt: t.deletedAt,
      hasBeforeState: t.beforeStateCaptured,
    }));
  }
}
