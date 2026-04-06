// ============================================================================
// @dantecode/core — Memory Consolidator
// Consolidates accumulated session memories when the entry count exceeds a
// threshold, merging duplicate/overlapping entries and pruning stale ones.
// ============================================================================

/**
 * Configuration for the MemoryConsolidator.
 */
export interface MemoryConsolidatorOptions {
  /** Directory where session data is stored. Defaults to ".dantecode/sessions". */
  sessionsDir?: string;
  /** Minimum number of entries before consolidation triggers. Default: 50. */
  consolidationThreshold?: number;
  /** Maximum age in days for entries to keep. Default: 90. */
  maxAgeDays?: number;
}

/**
 * A single memory entry to be consolidated.
 */
export interface MemoryEntry {
  key: string;
  value: string;
  timestamp: string;
  score?: number;
}

/**
 * Result of a consolidation run.
 */
export interface ConsolidationResult {
  /** Number of entries before consolidation. */
  before: number;
  /** Number of entries after consolidation. */
  after: number;
  /** Number of entries merged. */
  merged: number;
  /** Number of stale entries pruned. */
  pruned: number;
}

/**
 * MemoryConsolidator merges duplicate and overlapping memory entries,
 * prunes stale entries beyond maxAgeDays, and keeps the most relevant
 * memories for fast retrieval.
 */
export class MemoryConsolidator {
  private readonly threshold: number;
  private readonly maxAgeDays: number;
  private entries: MemoryEntry[];

  constructor(options: MemoryConsolidatorOptions = {}) {
    this.threshold = options.consolidationThreshold ?? 50;
    this.maxAgeDays = options.maxAgeDays ?? 90;
    this.entries = [];
  }

  /**
   * Add entries to be considered for consolidation.
   */
  addEntries(entries: MemoryEntry[]): void {
    this.entries.push(...entries);
  }

  /**
   * Returns whether the current entry count exceeds the consolidation threshold.
   */
  needsConsolidation(): boolean {
    return this.entries.length >= this.threshold;
  }

  /**
   * Run consolidation only if the entry count exceeds the threshold.
   * Returns null if consolidation was not needed.
   */
  consolidateIfNeeded(): ConsolidationResult | null {
    if (!this.needsConsolidation()) {
      return null;
    }
    return this.consolidate();
  }

  /**
   * Run consolidation unconditionally: merge duplicates, prune stale entries.
   */
  consolidate(): ConsolidationResult {
    const before = this.entries.length;
    const now = Date.now();
    const maxAgeMs = this.maxAgeDays * 24 * 60 * 60 * 1000;

    // Phase 1: Prune stale entries
    let pruned = 0;
    const fresh = this.entries.filter((entry) => {
      const entryTime = new Date(entry.timestamp).getTime();
      if (isNaN(entryTime) || now - entryTime > maxAgeMs) {
        pruned++;
        return false;
      }
      return true;
    });

    // Phase 2: Merge duplicates by key (keep highest score / newest)
    const byKey = new Map<string, MemoryEntry>();
    let merged = 0;
    for (const entry of fresh) {
      const existing = byKey.get(entry.key);
      if (existing) {
        merged++;
        // Keep whichever has the higher score, or the newer one
        const existingScore = existing.score ?? 0;
        const entryScore = entry.score ?? 0;
        if (
          entryScore > existingScore ||
          (entryScore === existingScore && entry.timestamp > existing.timestamp)
        ) {
          byKey.set(entry.key, entry);
        }
      } else {
        byKey.set(entry.key, entry);
      }
    }

    this.entries = Array.from(byKey.values());

    return {
      before,
      after: this.entries.length,
      merged,
      pruned,
    };
  }

  /** Get the current entries. */
  getEntries(): MemoryEntry[] {
    return [...this.entries];
  }

  /** Get the current entry count. */
  get entryCount(): number {
    return this.entries.length;
  }

  /** Get the configured threshold. */
  get consolidationThreshold(): number {
    return this.threshold;
  }
}
