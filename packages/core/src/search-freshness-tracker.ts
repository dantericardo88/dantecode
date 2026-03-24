// ============================================================================
// @dantecode/core — Search Freshness Tracker
// Tracks cache ages for search results by content type, supports TTL-based
// staleness detection and forced refresh. In-memory, zero dependencies.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** Content categories with different staleness thresholds. */
export type ContentType = "news" | "documentation" | "code";

/** A tracked search result entry. */
interface TrackedEntry {
  query: string;
  resultId: string;
  fetchedAt: number;
  contentType: ContentType;
  forcedStale: boolean;
}

/** Options for the freshness tracker. */
export interface FreshnessTrackerOptions {
  /** Custom TTL overrides by content type (in ms). */
  ttls?: Partial<Record<ContentType, number>>;
  /** Custom time provider for testing. */
  nowFn?: () => number;
}

// ────────────────────────────────────────────────────────────────────────────
// Default TTLs
// ────────────────────────────────────────────────────────────────────────────

/** Default TTL values by content type (milliseconds). */
const DEFAULT_TTLS: Record<ContentType, number> = {
  news: 24 * 60 * 60 * 1000,           // 24 hours
  documentation: 7 * 24 * 60 * 60 * 1000, // 7 days
  code: 30 * 24 * 60 * 60 * 1000,      // 30 days
};

// ────────────────────────────────────────────────────────────────────────────
// Tracker
// ────────────────────────────────────────────────────────────────────────────

/**
 * Tracks freshness of search results by content type with configurable TTLs.
 *
 * - Results are tracked per (query, resultId) pair.
 * - Staleness is determined by `now - fetchedAt > TTL[contentType]`.
 * - `forceRefresh(query)` marks all results for a query as stale immediately.
 * - `evictStale()` removes and returns IDs of all stale entries.
 */
export class SearchFreshnessTracker {
  private readonly entries: Map<string, TrackedEntry> = new Map();
  private readonly ttls: Record<ContentType, number>;
  private readonly nowFn: () => number;

  constructor(options?: FreshnessTrackerOptions) {
    this.ttls = { ...DEFAULT_TTLS, ...options?.ttls };
    this.nowFn = options?.nowFn ?? (() => Date.now());
  }

  /**
   * Track a search result fetch time.
   * If the resultId already exists, its fetchedAt is updated.
   */
  track(
    query: string,
    resultId: string,
    fetchedAt: number,
    contentType: ContentType = "documentation",
  ): void {
    this.entries.set(resultId, {
      query,
      resultId,
      fetchedAt,
      contentType,
      forcedStale: false,
    });
  }

  /**
   * Check if a tracked result is stale.
   * Returns true if:
   *  - The result was force-refreshed, OR
   *  - `now - fetchedAt > TTL[contentType]`
   * Returns false if the resultId is not tracked.
   */
  isStale(resultId: string, ttlMs?: number): boolean {
    const entry = this.entries.get(resultId);
    if (!entry) return false;
    if (entry.forcedStale) return true;
    const effectiveTtl = ttlMs ?? this.ttls[entry.contentType];
    const age = this.nowFn() - entry.fetchedAt;
    return age > effectiveTtl;
  }

  /**
   * Evict all stale entries and return their resultIds.
   */
  evictStale(): string[] {
    const staleIds: string[] = [];
    for (const [resultId, entry] of this.entries) {
      if (this.isStaleEntry(entry)) {
        staleIds.push(resultId);
      }
    }
    for (const id of staleIds) {
      this.entries.delete(id);
    }
    return staleIds;
  }

  /**
   * Force-refresh: mark all results for a query as stale immediately.
   * They will be evicted on the next `evictStale()` call.
   */
  forceRefresh(query: string): void {
    for (const entry of this.entries.values()) {
      if (entry.query === query) {
        entry.forcedStale = true;
      }
    }
  }

  /** Get the number of tracked entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Check if a resultId is being tracked. */
  has(resultId: string): boolean {
    return this.entries.has(resultId);
  }

  /** Get the TTL for a content type. */
  getTtl(contentType: ContentType): number {
    return this.ttls[contentType];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal
  // ──────────────────────────────────────────────────────────────────────────

  private isStaleEntry(entry: TrackedEntry): boolean {
    if (entry.forcedStale) return true;
    const age = this.nowFn() - entry.fetchedAt;
    return age > this.ttls[entry.contentType];
  }
}
