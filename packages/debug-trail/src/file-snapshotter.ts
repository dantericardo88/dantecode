// ============================================================================
// @dantecode/debug-trail — File Snapshotter (AgentFS-inspired)
// Captures before/after file states and delete tombstones.
// All snapshots stored OUTSIDE the worktree.
// ============================================================================

import { readFile, writeFile, mkdir, access, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type {
  FileSnapshotRecord,
  DeleteTombstone,
  TrailProvenance,
  DebugTrailConfig,
} from "./types.js";
import { defaultConfig } from "./types.js";
import type { PrivacyPolicy } from "./policies/privacy-policy.js";
import { hashFile, hashContent, makeSnapshotId, makeTombstoneId } from "./hash-engine.js";
import { TrailStore, getTrailStore } from "./sqlite-store.js";
import { TombstoneRegistry } from "./state/tombstones.js";

// ---------------------------------------------------------------------------
// File Snapshotter
// ---------------------------------------------------------------------------

export class FileSnapshotter {
  private config: DebugTrailConfig;
  private store: TrailStore;
  private tombstones = new TombstoneRegistry();
  private initialized = false;
  // Gap 1: dedup cache — contentHash → most recently written FileSnapshotRecord
  private recentSnapshotByHash = new Map<string, FileSnapshotRecord>();
  private privacyPolicy: PrivacyPolicy | null = null;

  constructor(config?: Partial<DebugTrailConfig>, privacyPolicy?: PrivacyPolicy) {
    this.config = { ...defaultConfig(), ...config };
    this.store = getTrailStore(this.config.storageRoot);
    this.privacyPolicy = privacyPolicy ?? null;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.store.init();
    // Load existing tombstones
    const existing = await this.store.readAllTombstones();
    this.tombstones.bulkLoad(existing);
    // Gap 2: load existing snapshot records and populate dedup cache
    const snapRecords = await this.store.readAllSnapshotRecords();
    for (const record of snapRecords) {
      // Populate dedup cache with each record. Later records overwrite earlier
      // ones for the same hash (last-write wins — acceptable since content is
      // identical for the same hash).
      this.recentSnapshotByHash.set(record.contentHash, record);
    }
    this.initialized = true;
    // Evict stale cache entries pointing to deleted snapshot files
    await this.reconcileDedupeCache();
  }

  // -------------------------------------------------------------------------
  // Capture snapshot of a file (AgentFS pattern: before/after every mutation)
  // -------------------------------------------------------------------------

  /**
   * Capture and store a snapshot of a file.
   * Returns null if file doesn't exist (nothing to capture).
   */
  async captureSnapshot(
    filePath: string,
    trailEventId: string,
    provenance: TrailProvenance,
  ): Promise<FileSnapshotRecord | null> {
    await this.ensureReady();

    // Privacy: path-based exclusion before any I/O (free check)
    if (this.privacyPolicy && this.privacyPolicy.shouldExcludePath(filePath)) return null;

    if (!existsSync(filePath)) return null;

    let content: Buffer;
    try {
      content = await readFile(filePath);
    } catch {
      return null;
    }

    // Privacy: size-based + redaction checks (content already in memory)
    if (this.privacyPolicy) {
      const action = this.privacyPolicy.evaluateCapture(filePath, content.length);
      if (action === "exclude" || action === "redact") return null;
    }

    const contentHash = hashContent(content);

    // Gap 1: check dedup cache — if we have a record with this hash AND the
    // file still exists on disk, return the existing record without writing.
    const cached = this.recentSnapshotByHash.get(contentHash);
    if (cached && existsSync(cached.storagePath)) {
      return cached;
    }

    const now = new Date().toISOString();
    const snapshotId = makeSnapshotId(filePath, contentHash, now);
    const storagePath = this.store.snapshotPath(snapshotId);

    // Write snapshot content outside worktree (atomic write-then-rename)
    const tmpPath = storagePath + ".tmp";
    await writeFile(tmpPath, content);
    await rename(tmpPath, storagePath);

    const record: FileSnapshotRecord = {
      snapshotId,
      filePath,
      contentHash,
      sizeBytes: content.length,
      capturedAt: now,
      storagePath,
      compressed: false,
      provenance,
      trailEventId,
    };

    // Gap 1: populate dedup cache
    this.recentSnapshotByHash.set(contentHash, record);

    // Gap 2: persist snapshot manifest record
    await this.store.appendSnapshotRecord(record);

    return record;
  }

  /**
   * Capture a pair: before (current state) + signal that a write is about to happen.
   * Returns the before snapshot ID (or null if file didn't exist).
   */
  async captureBeforeState(
    filePath: string,
    trailEventId: string,
    provenance: TrailProvenance,
  ): Promise<{ beforeSnapshotId: string | null; beforeHash: string | null }> {
    await this.ensureReady();

    const hash = await hashFile(filePath);
    if (hash === null) return { beforeSnapshotId: null, beforeHash: null };

    const snap = await this.captureSnapshot(filePath, trailEventId, provenance);
    return {
      beforeSnapshotId: snap?.snapshotId ?? null,
      beforeHash: hash,
    };
  }

  /**
   * Capture after-state following a file write.
   * Returns snapshot ID and new hash.
   */
  async captureAfterState(
    filePath: string,
    trailEventId: string,
    provenance: TrailProvenance,
  ): Promise<{ afterSnapshotId: string | null; afterHash: string | null }> {
    await this.ensureReady();

    const snap = await this.captureSnapshot(filePath, trailEventId, provenance);
    if (!snap) return { afterSnapshotId: null, afterHash: null };
    return { afterSnapshotId: snap.snapshotId, afterHash: snap.contentHash };
  }

  // -------------------------------------------------------------------------
  // Tombstones — deletions must always produce a before-state
  // -------------------------------------------------------------------------

  /**
   * Record a file deletion.
   * PRD hard rule: destructive ops must capture before-state (or log impossibility).
   */
  async recordDeletion(
    filePath: string,
    trailEventId: string,
    provenance: TrailProvenance,
    deletedBy: string,
  ): Promise<DeleteTombstone> {
    await this.ensureReady();

    const now = new Date().toISOString();
    const tombstoneId = makeTombstoneId(filePath, now);

    // Try to capture before-state
    let lastSnapshotId: string | undefined;
    let contentHash: string | undefined;
    let beforeStateCaptured = false;
    let missingBeforeReason: string | undefined;

    const hash = await hashFile(filePath);
    if (hash) {
      const snap = await this.captureSnapshot(filePath, trailEventId, provenance);
      if (snap) {
        lastSnapshotId = snap.snapshotId;
        contentHash = snap.contentHash;
        beforeStateCaptured = true;
      } else {
        missingBeforeReason = "Snapshot capture returned null despite file existing";
      }
    } else {
      missingBeforeReason = "File not found at deletion time — may have been already deleted";
    }

    const tombstone: DeleteTombstone = {
      tombstoneId,
      filePath,
      lastSnapshotId,
      contentHash,
      deletedAt: now,
      deletedBy,
      beforeStateCaptured,
      missingBeforeReason,
      provenance,
      trailEventId,
    };

    await this.store.appendTombstone(tombstone);
    this.tombstones.register(tombstone);

    return tombstone;
  }

  // -------------------------------------------------------------------------
  // Restore from snapshot (used by RestoreEngine)
  // -------------------------------------------------------------------------

  /**
   * Read snapshot content by ID. Returns null if not found.
   */
  async readSnapshot(snapshotId: string): Promise<Buffer | null> {
    await this.ensureReady();
    const path = this.store.snapshotPath(snapshotId);
    if (!existsSync(path)) return null;
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }

  /**
   * Restore a snapshot to a given path.
   * Returns true if successful.
   */
  async restoreSnapshot(snapshotId: string, targetPath: string): Promise<boolean> {
    const content = await this.readSnapshot(snapshotId);
    if (!content) return false;
    try {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Tombstone access
  // -------------------------------------------------------------------------

  getTombstones(): TombstoneRegistry {
    return this.tombstones;
  }

  getTombstoneForFile(filePath: string): DeleteTombstone | undefined {
    return this.tombstones.latestForFile(filePath);
  }

  // -------------------------------------------------------------------------
  // Storage verification
  // -------------------------------------------------------------------------

  /** Get all persisted snapshot records (used by RestoreEngine for hash verification). */
  async getSnapshotRecords(): Promise<FileSnapshotRecord[]> {
    await this.ensureReady();
    return this.store.readAllSnapshotRecords();
  }

  async snapshotExists(snapshotId: string): Promise<boolean> {
    const path = this.store.snapshotPath(snapshotId);
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async reconcileDedupeCache(): Promise<void> {
    for (const [hash, record] of this.recentSnapshotByHash) {
      if (!existsSync(record.storagePath)) {
        this.recentSnapshotByHash.delete(hash);
      }
    }
  }

  evictSnapshot(snapshotId: string): void {
    for (const [hash, record] of this.recentSnapshotByHash) {
      if (record.snapshotId === snapshotId) {
        this.recentSnapshotByHash.delete(hash);
        break;
      }
    }
  }

  private async ensureReady(): Promise<void> {
    if (!this.initialized) await this.init();
  }
}
