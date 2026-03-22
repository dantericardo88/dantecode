// ============================================================================
// @dantecode/memory-engine — Short-Term Store
// Fast, in-memory, session-local working memory with TTL + LRU eviction.
// Inspired by Mem0's working memory patterns and LangGraph thread-local state.
// ============================================================================

import type { MemoryItem, MemoryScope } from "./types.js";

const DEFAULT_CAPACITY = 500;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** An entry in the short-term store with access metadata. */
interface StoreEntry {
  item: MemoryItem;
  expiresAt: number; // 0 = no TTL
  insertedAt: number;
}

/**
 * Fast in-memory short-term store.
 *
 * - LRU eviction when capacity is reached (least-recently-accessed removed first)
 * - Optional TTL per item (defaults to constructor `defaultTtlMs`)
 * - Thread-safe under single-threaded Node.js
 * - Scope isolation: items are scoped and can be queried by scope
 */
export class ShortTermStore {
  private readonly capacity: number;
  private readonly defaultTtlMs: number;
  /** Ordered map (insertion order = LRU order; access bumps to front). */
  private readonly store = new Map<string, StoreEntry>();

  constructor(capacity = DEFAULT_CAPACITY, defaultTtlMs = DEFAULT_TTL_MS) {
    this.capacity = capacity;
    this.defaultTtlMs = defaultTtlMs;
  }

  // --------------------------------------------------------------------------
  // Write
  // --------------------------------------------------------------------------

  /**
   * Stores a value with the given key and scope.
   * If a key already exists, updates it in place (LRU refresh).
   * Evicts the least-recently-used item if capacity is reached.
   */
  set(key: string, value: unknown, scope: MemoryScope = "session", ttlMs?: number): MemoryItem {
    const now = Date.now();
    const storeKey = this.storeKey(key, scope);
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;

    // If key already exists, remove to re-insert at the end (LRU bump)
    if (this.store.has(storeKey)) {
      const existing = this.store.get(storeKey)!;
      this.store.delete(storeKey);
      const updated: MemoryItem = {
        ...existing.item,
        value,
        lastAccessedAt: new Date(now).toISOString(),
        recallCount: existing.item.recallCount,
      };
      this.store.set(storeKey, {
        item: updated,
        expiresAt: effectiveTtl > 0 ? now + effectiveTtl : 0,
        insertedAt: existing.insertedAt,
      });
      return updated;
    }

    // Evict LRU if at capacity
    if (this.store.size >= this.capacity) {
      this.evictLRU();
    }

    const item: MemoryItem = {
      key,
      value,
      scope,
      layer: "short-term",
      createdAt: new Date(now).toISOString(),
      lastAccessedAt: new Date(now).toISOString(),
      score: 0.5,
      recallCount: 0,
      ttlMs: effectiveTtl > 0 ? effectiveTtl : undefined,
    };

    this.store.set(storeKey, {
      item,
      expiresAt: effectiveTtl > 0 ? now + effectiveTtl : 0,
      insertedAt: now,
    });

    return item;
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  /**
   * Retrieves a value by key + scope.
   * Bumps LRU order and increments recallCount.
   * Returns null if not found or expired.
   */
  get(key: string, scope: MemoryScope = "session"): MemoryItem | null {
    const storeKey = this.storeKey(key, scope);
    const entry = this.store.get(storeKey);
    if (!entry) return null;

    // TTL check
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.store.delete(storeKey);
      return null;
    }

    // LRU bump: re-insert at end
    this.store.delete(storeKey);
    const now = Date.now();
    const updated: MemoryItem = {
      ...entry.item,
      lastAccessedAt: new Date(now).toISOString(),
      recallCount: entry.item.recallCount + 1,
    };
    this.store.set(storeKey, {
      item: updated,
      expiresAt: entry.expiresAt,
      insertedAt: entry.insertedAt,
    });

    return updated;
  }

  /** Returns whether a key exists and is not expired. */
  has(key: string, scope: MemoryScope = "session"): boolean {
    return this.get(key, scope) !== null;
  }

  /** Deletes a key. Returns true if it existed. */
  delete(key: string, scope: MemoryScope = "session"): boolean {
    return this.store.delete(this.storeKey(key, scope));
  }

  // --------------------------------------------------------------------------
  // Query
  // --------------------------------------------------------------------------

  /**
   * Returns all non-expired items in a scope, sorted by lastAccessedAt descending.
   */
  listByScope(scope: MemoryScope): MemoryItem[] {
    const now = Date.now();
    const results: MemoryItem[] = [];

    for (const [, entry] of this.store) {
      if (entry.item.scope !== scope) continue;
      if (entry.expiresAt > 0 && now > entry.expiresAt) continue;
      results.push(entry.item);
    }

    return results.sort(
      (a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime(),
    );
  }

  /**
   * Returns all non-expired items across all scopes.
   */
  listAll(): MemoryItem[] {
    const now = Date.now();
    const results: MemoryItem[] = [];
    for (const [, entry] of this.store) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) continue;
      results.push(entry.item);
    }
    return results;
  }

  /**
   * Searches items whose key or string-serialized value contains the query.
   * Returns up to `limit` results sorted by recallCount + score.
   */
  search(query: string, scope?: MemoryScope, limit = 10): MemoryItem[] {
    const q = query.toLowerCase();
    const now = Date.now();
    const results: MemoryItem[] = [];

    for (const [, entry] of this.store) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) continue;
      if (scope && entry.item.scope !== scope) continue;

      const keyMatch = entry.item.key.toLowerCase().includes(q);
      const valMatch = JSON.stringify(entry.item.value).toLowerCase().includes(q);
      const summaryMatch = entry.item.summary?.toLowerCase().includes(q) ?? false;

      if (keyMatch || valMatch || summaryMatch) {
        results.push(entry.item);
      }
    }

    return results
      .sort((a, b) => b.score + b.recallCount * 0.1 - (a.score + a.recallCount * 0.1))
      .slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // Maintenance
  // --------------------------------------------------------------------------

  /** Evicts all expired items. Returns count evicted. */
  pruneExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Clears all items for a scope (e.g. on session end). */
  clearScope(scope: MemoryScope): number {
    let count = 0;
    for (const [key, entry] of this.store) {
      if (entry.item.scope === scope) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Clears everything. */
  clear(): void {
    this.store.clear();
  }

  /** Current item count (including potentially expired). */
  get size(): number {
    return this.store.size;
  }

  /** Returns the current capacity limit. */
  get capacityLimit(): number {
    return this.capacity;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private storeKey(key: string, scope: MemoryScope): string {
    return `${scope}::${key}`;
  }

  private evictLRU(): void {
    // Map iterates in insertion order — first entry is least recently used
    const firstKey = this.store.keys().next().value;
    if (firstKey !== undefined) {
      this.store.delete(firstKey);
    }
  }
}
