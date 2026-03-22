// ============================================================================
// @dantecode/debug-trail — Tombstone Registry
// Tracks file deletions with before-state references for recovery.
// ============================================================================

import type { DeleteTombstone } from "../types.js";

export class TombstoneRegistry {
  /** filePath → list of tombstones (multiple deletions possible over time) */
  private byFile = new Map<string, DeleteTombstone[]>();
  /** tombstoneId → tombstone */
  private byId = new Map<string, DeleteTombstone>();

  /** Register a new tombstone. */
  register(tombstone: DeleteTombstone): void {
    this.byId.set(tombstone.tombstoneId, tombstone);

    const list = this.byFile.get(tombstone.filePath) ?? [];
    list.push(tombstone);
    this.byFile.set(tombstone.filePath, list);
  }

  /** Bulk load tombstones (e.g. from JSONL on startup). */
  bulkLoad(tombstones: DeleteTombstone[]): void {
    for (const t of tombstones) this.register(t);
  }

  /** Get tombstone by ID. */
  getById(tombstoneId: string): DeleteTombstone | undefined {
    return this.byId.get(tombstoneId);
  }

  /** Get most recent tombstone for a file path. */
  latestForFile(filePath: string): DeleteTombstone | undefined {
    // F5: reuse allForFile() which guarantees chronological order.
    const sorted = this.allForFile(filePath);
    return sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
  }

  /** Get all tombstones for a file path (oldest first). */
  allForFile(filePath: string): DeleteTombstone[] {
    const list = this.byFile.get(filePath) ?? [];
    // F5: sort explicitly — bulkLoad() may deliver tombstones in non-chronological order.
    // Spread to avoid mutating the internal insertion-order list.
    return [...list].sort(
      (a, b) => new Date(a.deletedAt).getTime() - new Date(b.deletedAt).getTime(),
    );
  }

  /** All tombstones in a session. */
  forSession(sessionId: string): DeleteTombstone[] {
    const results: DeleteTombstone[] = [];
    for (const t of this.byId.values()) {
      if (t.provenance.sessionId === sessionId) results.push(t);
    }
    return results.sort(
      (a, b) => new Date(a.deletedAt).getTime() - new Date(b.deletedAt).getTime(),
    );
  }

  /** All tombstones for files matching a path prefix. */
  forPathPrefix(prefix: string): DeleteTombstone[] {
    const results: DeleteTombstone[] = [];
    for (const [fp, list] of this.byFile) {
      if (fp.startsWith(prefix)) results.push(...list);
    }
    return results;
  }

  /** All tracked file paths that have been deleted at least once. */
  deletedFiles(): string[] {
    return Array.from(this.byFile.keys());
  }

  /** Total tombstone count. */
  size(): number {
    return this.byId.size;
  }

  /** Find tombstones without a before-state (capture gap). */
  withoutBeforeState(): DeleteTombstone[] {
    return Array.from(this.byId.values()).filter((t) => !t.beforeStateCaptured);
  }

  /** All tombstones as flat array (newest first). */
  all(): DeleteTombstone[] {
    return Array.from(this.byId.values()).sort(
      (a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime(),
    );
  }
}
