// ============================================================================
// @dantecode/core — Semantic Search Cache
// 7-day persistent search cache with Jaccard similarity matching.
// Avoids redundant API calls for similar queries.
// Upgrade path: swap Jaccard → vector embeddings when available.
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tokenize, jaccardSimilarity } from "./approach-memory.js";
import type { SearchResult } from "./search-providers.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A cached search entry. */
export interface SearchCacheEntry {
  /** The original query. */
  query: string;
  /** Tokenized query for similarity matching. */
  queryTokens: string[];
  /** Cached results. */
  results: SearchResult[];
  /** ISO timestamp when cached. */
  cachedAt: string;
  /** Providers that contributed. */
  providers: string[];
  /** Number of cache hits. */
  hitCount: number;
}

/** Options for the search cache. */
export interface SearchCacheOptions {
  /** TTL in milliseconds (default: 7 days). */
  ttlMs?: number;
  /** Maximum entries before eviction (default: 500). */
  maxEntries?: number;
  /** Jaccard similarity threshold for cache hit (default: 0.8). */
  similarityThreshold?: number;
  /** Persist cache to disk (default: true). */
  persistToDisk?: boolean;
}

// ----------------------------------------------------------------------------
// Cache Implementation
// ----------------------------------------------------------------------------

/** Default TTL: 7 days. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_SIMILARITY_THRESHOLD = 0.8;

export class SemanticSearchCache {
  private entries: SearchCacheEntry[] = [];
  private loaded = false;
  private filePath: string;
  private ttlMs: number;
  private maxEntries: number;
  private similarityThreshold: number;
  private persistToDisk: boolean;

  constructor(projectRoot: string, options: SearchCacheOptions = {}) {
    this.filePath = join(projectRoot, ".dantecode", "search-cache.json");
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.similarityThreshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    this.persistToDisk = options.persistToDisk ?? true;
  }

  /** Load cache from disk. Idempotent. */
  async load(): Promise<void> {
    if (this.loaded) return;
    if (!this.persistToDisk) {
      this.loaded = true;
      return;
    }
    try {
      const content = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        this.entries = parsed;
        // Prune expired on load
        this.pruneExpired();
      }
    } catch {
      this.entries = [];
    }
    this.loaded = true;
  }

  /** Save cache to disk. */
  async save(): Promise<void> {
    if (!this.persistToDisk) return;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(this.entries, null, 2), "utf-8");
    } catch {
      // Non-fatal
    }
  }

  /**
   * Look up a query in the cache using semantic similarity.
   * Returns cached results if a similar enough query was seen recently.
   */
  async get(query: string): Promise<SearchResult[] | null> {
    await this.load();

    const queryTokens = tokenize(query);
    if (queryTokens.size === 0) return null;

    const now = Date.now();

    for (const entry of this.entries) {
      // Check TTL
      const cachedTime = new Date(entry.cachedAt).getTime();
      if (now - cachedTime > this.ttlMs) continue;

      // Check semantic similarity
      const entryTokens = new Set(entry.queryTokens);
      const similarity = jaccardSimilarity(queryTokens, entryTokens);

      if (similarity >= this.similarityThreshold) {
        entry.hitCount++;
        return entry.results;
      }
    }

    return null;
  }

  /**
   * Store search results in the cache.
   */
  async put(
    query: string,
    results: SearchResult[],
    providers: string[],
  ): Promise<void> {
    await this.load();

    const queryTokens = [...tokenize(query)];

    // Check if a similar entry already exists and update it
    const existingIdx = this.entries.findIndex((e) => {
      const entryTokens = new Set(e.queryTokens);
      return jaccardSimilarity(new Set(queryTokens), entryTokens) >= this.similarityThreshold;
    });

    if (existingIdx >= 0) {
      // Update existing entry
      this.entries[existingIdx] = {
        query,
        queryTokens,
        results,
        cachedAt: new Date().toISOString(),
        providers,
        hitCount: this.entries[existingIdx]!.hitCount,
      };
    } else {
      // Add new entry
      this.entries.push({
        query,
        queryTokens,
        results,
        cachedAt: new Date().toISOString(),
        providers,
        hitCount: 0,
      });
    }

    // Evict if over capacity (LRU by cachedAt)
    if (this.entries.length > this.maxEntries) {
      this.entries.sort(
        (a, b) => new Date(b.cachedAt).getTime() - new Date(a.cachedAt).getTime(),
      );
      this.entries = this.entries.slice(0, this.maxEntries);
    }

    await this.save();
  }

  /** Remove expired entries. */
  pruneExpired(): void {
    const now = Date.now();
    this.entries = this.entries.filter((e) => {
      const cachedTime = new Date(e.cachedAt).getTime();
      return now - cachedTime <= this.ttlMs;
    });
  }

  /** Clear all cache entries. */
  async clear(): Promise<void> {
    this.entries = [];
    this.loaded = true;
    await this.save();
  }

  /** Number of cached entries. */
  get size(): number {
    return this.entries.length;
  }

  /** Get cache statistics. */
  getStats(): { entries: number; totalHits: number; oldestEntry: string | null } {
    const totalHits = this.entries.reduce((sum, e) => sum + e.hitCount, 0);
    const oldest = this.entries.length > 0
      ? this.entries.reduce((a, b) =>
          new Date(a.cachedAt).getTime() < new Date(b.cachedAt).getTime() ? a : b,
        ).cachedAt
      : null;
    return { entries: this.entries.length, totalHits, oldestEntry: oldest };
  }
}
