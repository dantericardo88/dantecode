// ============================================================================
// @dantecode/debug-trail — Compression Policy
// Determines when and how to compress snapshots to save storage.
// Uses deduplication via content hash to avoid storing identical snapshots.
// ============================================================================

import type { FileSnapshotRecord } from "../types.js";
import { MS_PER_DAY } from "../types.js";

// ---------------------------------------------------------------------------
// Policy config
// ---------------------------------------------------------------------------

export interface CompressionPolicyConfig {
  /** Compress snapshots older than N days. Default: 7 */
  compressAfterDays: number;
  /** Maximum snapshot size in bytes before forced compression. Default: 10MB */
  maxSnapshotSizeBytes: number;
  /** Deduplicate identical content hashes. Default: true */
  enableDeduplication: boolean;
  /** Remove duplicate entries and keep only the most recent. Default: true */
  pruneIdenticalHashes: boolean;
}

const DEFAULT_COMPRESSION: CompressionPolicyConfig = {
  compressAfterDays: 7,
  maxSnapshotSizeBytes: 10 * 1024 * 1024, // 10MB
  enableDeduplication: true,
  pruneIdenticalHashes: true,
};

// ---------------------------------------------------------------------------
// Compression decision
// ---------------------------------------------------------------------------

export interface CompressionDecision {
  snapshotId: string;
  filePath: string;
  action: "compress" | "dedup" | "keep" | "prune_duplicate";
  reason: string;
}

// ---------------------------------------------------------------------------
// Compression Policy
// ---------------------------------------------------------------------------

export class CompressionPolicy {
  private config: CompressionPolicyConfig;

  constructor(config?: Partial<CompressionPolicyConfig>) {
    this.config = { ...DEFAULT_COMPRESSION, ...config };
  }

  /**
   * Evaluate a set of snapshot records and return compression decisions.
   */
  evaluate(snapshots: FileSnapshotRecord[]): CompressionDecision[] {
    const now = Date.now();
    const ageThreshold = now - this.config.compressAfterDays * MS_PER_DAY;
    const decisions: CompressionDecision[] = [];

    // Group by content hash for deduplication
    const hashGroups = new Map<string, FileSnapshotRecord[]>();
    if (this.config.enableDeduplication) {
      for (const s of snapshots) {
        const group = hashGroups.get(s.contentHash) ?? [];
        group.push(s);
        hashGroups.set(s.contentHash, group);
      }
    }

    const alreadyDecided = new Set<string>();

    // Handle duplicates first
    if (this.config.enableDeduplication && this.config.pruneIdenticalHashes) {
      for (const group of hashGroups.values()) {
        if (group.length <= 1) continue;
        // Keep most recent, mark others as duplicate
        const sorted = group.sort(
          (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
        );
        for (let i = 1; i < sorted.length; i++) {
          const s = sorted[i]!;
          decisions.push({
            snapshotId: s.snapshotId,
            filePath: s.filePath,
            action: "prune_duplicate",
            reason: `Identical content hash to ${sorted[0]!.snapshotId} (captured ${sorted[0]!.capturedAt})`,
          });
          alreadyDecided.add(s.snapshotId);
        }
      }
    }

    // Evaluate remaining snapshots
    for (const s of snapshots) {
      if (alreadyDecided.has(s.snapshotId)) continue;

      const capturedAt = new Date(s.capturedAt).getTime();
      const tooOld = capturedAt < ageThreshold;
      const tooLarge = s.sizeBytes > this.config.maxSnapshotSizeBytes;

      if (s.compressed) {
        decisions.push({
          snapshotId: s.snapshotId,
          filePath: s.filePath,
          action: "keep",
          reason: "already compressed",
        });
      } else if (tooOld || tooLarge) {
        decisions.push({
          snapshotId: s.snapshotId,
          filePath: s.filePath,
          action: "compress",
          reason: tooLarge
            ? `size ${(s.sizeBytes / 1024).toFixed(0)}KB > threshold ${(this.config.maxSnapshotSizeBytes / 1024).toFixed(0)}KB`
            : `older than ${this.config.compressAfterDays} days`,
        });
      } else {
        decisions.push({
          snapshotId: s.snapshotId,
          filePath: s.filePath,
          action: "keep",
          reason: "recent and within size limit",
        });
      }
    }

    return decisions;
  }

  /** Check if a single snapshot should be compressed. */
  shouldCompress(snapshot: FileSnapshotRecord): boolean {
    if (snapshot.compressed) return false;
    const ageMs = Date.now() - new Date(snapshot.capturedAt).getTime();
    const ageThresholdMs = this.config.compressAfterDays * MS_PER_DAY;
    return ageMs > ageThresholdMs || snapshot.sizeBytes > this.config.maxSnapshotSizeBytes;
  }
}
