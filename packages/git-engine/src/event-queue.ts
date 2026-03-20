import type { GitAutomationEvent, GitAutomationEventPriority } from "./event-normalizer.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EventQueueEntry {
  id: string;
  event: GitAutomationEvent;
  enqueuedAt: string;
  retryCount: number;
  maxRetries: number;
}

export interface EventQueueOptions {
  /** Maximum number of events in the queue before backpressure kicks in */
  maxSize?: number;
  /** Default max retries for each enqueued event */
  defaultMaxRetries?: number;
  /** Window in ms for dedup (0 disables dedup) */
  dedupeWindowMs?: number;
}

export interface EventQueueStats {
  total: number;
  byPriority: Record<GitAutomationEventPriority, number>;
  droppedDuplicates: number;
  droppedBackpressure: number;
}

// ─── Priority helpers ─────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<GitAutomationEventPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

function comparePriority(a: EventQueueEntry, b: EventQueueEntry): number {
  const pd = PRIORITY_ORDER[a.event.priority] - PRIORITY_ORDER[b.event.priority];
  if (pd !== 0) {
    return pd;
  }
  return a.enqueuedAt < b.enqueuedAt ? -1 : 1;
}

// ─── GitEventQueue ─────────────────────────────────────────────────────────────

/**
 * Priority queue for canonical GitAutomationEvents.
 *
 * - High-priority events are always dequeued before normal, normal before low.
 * - Duplicate events (same fingerprint within dedupeWindowMs) are collapsed.
 * - Backpressure: enqueue() returns false when maxSize is reached.
 * - Failed events can be re-queued via retry() up to maxRetries.
 */
export class GitEventQueue {
  private readonly entries: EventQueueEntry[] = [];
  private readonly maxSize: number;
  private readonly defaultMaxRetries: number;
  private readonly dedupeWindowMs: number;
  private droppedDuplicates = 0;
  private droppedBackpressure = 0;
  /** Fingerprints of events enqueued within the last dedupeWindowMs */
  private readonly recentFingerprints = new Map<string, number>();

  constructor(options: EventQueueOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.defaultMaxRetries = options.defaultMaxRetries ?? 3;
    this.dedupeWindowMs = options.dedupeWindowMs ?? 500;
  }

  /**
   * Attempt to add an event to the queue.
   * Returns false if rejected (backpressure or duplicate).
   */
  enqueue(event: GitAutomationEvent, maxRetries?: number): boolean {
    // Dedup check
    if (this.isDuplicate(event)) {
      this.droppedDuplicates += 1;
      return false;
    }

    // Backpressure check
    if (this.entries.length >= this.maxSize) {
      this.droppedBackpressure += 1;
      return false;
    }

    const entry: EventQueueEntry = {
      id: event.id,
      event,
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries: maxRetries ?? this.defaultMaxRetries,
    };

    this.insertSorted(entry);
    this.trackFingerprint(event.fingerprint);
    return true;
  }

  /**
   * Remove and return the highest-priority entry.
   * Returns null when the queue is empty.
   */
  dequeue(): EventQueueEntry | null {
    return this.entries.shift() ?? null;
  }

  /**
   * Inspect the highest-priority entry without removing it.
   */
  peek(): EventQueueEntry | null {
    return this.entries[0] ?? null;
  }

  /**
   * Drain up to `count` entries at once (defaults to all).
   */
  drainBatch(count?: number): EventQueueEntry[] {
    const limit = count ?? this.entries.length;
    return this.entries.splice(0, limit);
  }

  /**
   * Re-enqueue a failed entry for retry if it hasn't exceeded maxRetries.
   * Returns true if re-queued, false if retries exhausted.
   */
  retry(entry: EventQueueEntry): boolean {
    if (entry.retryCount >= entry.maxRetries) {
      return false;
    }

    const retried: EventQueueEntry = {
      ...entry,
      retryCount: entry.retryCount + 1,
      enqueuedAt: new Date().toISOString(),
    };

    this.insertSorted(retried);
    return true;
  }

  /**
   * Check whether an event fingerprint was recently enqueued (dedup window).
   */
  isDuplicate(event: GitAutomationEvent): boolean {
    if (this.dedupeWindowMs === 0) {
      return false;
    }
    const lastSeen = this.recentFingerprints.get(event.fingerprint);
    if (lastSeen === undefined) {
      return false;
    }
    return Date.now() - lastSeen < this.dedupeWindowMs;
  }

  /** Current queue depth */
  size(): number {
    return this.entries.length;
  }

  /** Returns true when the queue has reached maxSize */
  isBackpressured(): boolean {
    return this.entries.length >= this.maxSize;
  }

  /** Snapshot of queue metrics */
  stats(): EventQueueStats {
    const byPriority: Record<GitAutomationEventPriority, number> = {
      high: 0,
      normal: 0,
      low: 0,
    };
    for (const entry of this.entries) {
      byPriority[entry.event.priority] += 1;
    }
    return {
      total: this.entries.length,
      byPriority,
      droppedDuplicates: this.droppedDuplicates,
      droppedBackpressure: this.droppedBackpressure,
    };
  }

  /** Remove all entries (useful for testing / shutdown) */
  clear(): void {
    this.entries.length = 0;
    this.recentFingerprints.clear();
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private insertSorted(entry: EventQueueEntry): void {
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const existing = this.entries[mid]!;
      if (comparePriority(entry, existing) <= 0) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    this.entries.splice(lo, 0, entry);
  }

  private trackFingerprint(fingerprint: string): void {
    if (this.dedupeWindowMs === 0) {
      return;
    }
    const now = Date.now();
    this.recentFingerprints.set(fingerprint, now);
    // Prune stale entries to prevent unbounded growth
    if (this.recentFingerprints.size > 5000) {
      for (const [key, time] of this.recentFingerprints) {
        if (now - time >= this.dedupeWindowMs) {
          this.recentFingerprints.delete(key);
        }
      }
    }
  }
}
