// ============================================================================
// @dantecode/memory-engine — Vector Store
// Lightweight local semantic index using Jaccard token similarity.
// No external deps. Optional embedding provider hookable via model-router.
// Patterns from Zep's semantic memory + Continue's context providers.
// ============================================================================

import type { MemoryItem, MemoryScope } from "./types.js";
import type { LocalStore } from "./storage/local-store.js";

const DEFAULT_CAPACITY = 10_000;
const DEFAULT_SIMILARITY_THRESHOLD = 0.05; // Jaccard threshold for recall

/** An index entry for the semantic store. */
export interface VectorEntry {
  key: string;
  scope: MemoryScope;
  /** Normalized token set for Jaccard similarity. */
  tokens: Set<string>;
  /** Short text used for similarity (summary or stringified value). */
  text: string;
  /** Snapshot of the MemoryItem at time of indexing. */
  snapshot: MemoryItem;
  /** Optional dense embedding vector (set when an embedding provider is wired). */
  embedding?: number[];
}

/** A search result from the vector store. */
export interface VectorSearchResult {
  item: MemoryItem;
  similarity: number;
}

/**
 * Lightweight semantic memory store.
 *
 * - In-memory token index built from item summaries/values
 * - Jaccard similarity for semantic recall (zero external deps)
 * - Optional embedding provider for richer similarity (hook via setEmbeddingProvider)
 * - Backed by LocalStore for cross-restart persistence
 * - LRU eviction at capacity
 */
export class VectorStore {
  private readonly localStore: LocalStore;
  private readonly capacity: number;
  private readonly threshold: number;
  /** In-memory index: scopedKey → VectorEntry. */
  private readonly entries = new Map<string, VectorEntry>();
  /** Optional embedding provider (model-router hookable). */
  embeddingProvider?: (text: string) => Promise<number[]>;

  constructor(
    localStore: LocalStore,
    capacity = DEFAULT_CAPACITY,
    threshold = DEFAULT_SIMILARITY_THRESHOLD,
  ) {
    this.localStore = localStore;
    this.capacity = capacity;
    this.threshold = threshold;
  }

  // --------------------------------------------------------------------------
  // Embedding provider (optional, for rich similarity)
  // --------------------------------------------------------------------------

  /** Hook in a model-router embedding provider for richer recall. */
  setEmbeddingProvider(fn: (text: string) => Promise<number[]>): void {
    this.embeddingProvider = fn;
  }

  // --------------------------------------------------------------------------
  // Write
  // --------------------------------------------------------------------------

  /** Add a MemoryItem to the semantic index. */
  async add(item: MemoryItem): Promise<void> {
    const text = this.toText(item);
    const tokens = tokenize(text);
    const scopedKey = this.scopedKey(item.key, item.scope);

    // Evict if at capacity
    if (this.entries.size >= this.capacity && !this.entries.has(scopedKey)) {
      this.evictLRU();
    }

    const entry: VectorEntry = {
      key: item.key,
      scope: item.scope,
      tokens,
      text,
      snapshot: { ...item },
    };

    // Generate dense embedding if provider is wired
    if (this.embeddingProvider) {
      try {
        entry.embedding = await this.embeddingProvider(text);
      } catch {
        /* non-fatal — fall back to Jaccard */
      }
    }

    this.entries.set(scopedKey, entry);

    // Persist to disk
    await this.localStore.put({ ...item, layer: "semantic" });
  }

  /** Add multiple items to the index. */
  async indexMany(items: MemoryItem[]): Promise<void> {
    for (const item of items) {
      await this.add(item);
    }
  }

  // --------------------------------------------------------------------------
  // Search
  // --------------------------------------------------------------------------

  /**
   * Search for semantically similar items.
   * Returns up to `limit` results ranked by similarity.
   *
   * GF-02: cross-session recall with ranking and scope handling.
   */
  search(
    query: string,
    limit = 10,
    scope?: MemoryScope,
    minSimilarity = this.threshold,
  ): VectorSearchResult[] {
    const queryTokens = tokenize(query);
    const results: VectorSearchResult[] = [];

    for (const [, entry] of this.entries) {
      if (scope && entry.scope !== scope) continue;

      const similarity = jaccardSimilarity(queryTokens, entry.tokens);
      if (similarity >= minSimilarity) {
        results.push({ item: entry.snapshot, similarity });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  /**
   * Async search that uses dense cosine similarity when embeddings are available,
   * falling back to Jaccard token similarity otherwise.
   *
   * Use this in preference to `search()` when an embedding provider is wired.
   */
  async searchAsync(
    query: string,
    limit = 10,
    scope?: MemoryScope,
    minSimilarity = this.threshold,
  ): Promise<VectorSearchResult[]> {
    // Embed the query if provider exists
    let queryEmbedding: number[] | undefined;
    if (this.embeddingProvider) {
      try {
        queryEmbedding = await this.embeddingProvider(query);
      } catch {
        /* fallback to Jaccard */
      }
    }

    const queryTokens = tokenize(query);
    const results: VectorSearchResult[] = [];

    for (const [, entry] of this.entries) {
      if (scope && entry.scope !== scope) continue;
      const similarity =
        queryEmbedding && entry.embedding
          ? cosineSimilarity(queryEmbedding, entry.embedding)
          : jaccardSimilarity(queryTokens, entry.tokens);
      if (similarity >= minSimilarity) {
        results.push({ item: entry.snapshot, similarity });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  /**
   * Find items similar to a reference item (not query string).
   */
  findSimilar(referenceKey: string, scope: MemoryScope, limit = 5): VectorSearchResult[] {
    const entry = this.entries.get(this.scopedKey(referenceKey, scope));
    if (!entry) return [];

    const results: VectorSearchResult[] = [];
    for (const [, other] of this.entries) {
      if (other.key === referenceKey && other.scope === scope) continue;
      const similarity = jaccardSimilarity(entry.tokens, other.tokens);
      if (similarity > this.threshold) {
        results.push({ item: other.snapshot, similarity });
      }
    }
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // Load / persist
  // --------------------------------------------------------------------------

  /**
   * Load the index from disk.
   * Call this on startup to rebuild the in-memory index.
   */
  async loadFromDisk(): Promise<number> {
    const scopes: MemoryScope[] = ["session", "project", "user", "global"];
    let count = 0;

    for (const scope of scopes) {
      const items = await this.localStore.list(scope, "semantic");
      for (const item of items) {
        const text = this.toText(item);
        const tokens = tokenize(text);
        const scopedKey = this.scopedKey(item.key, item.scope);
        this.entries.set(scopedKey, {
          key: item.key,
          scope: item.scope,
          tokens,
          text,
          snapshot: item,
        });
        count++;
      }
    }

    return count;
  }

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  async delete(key: string, scope: MemoryScope): Promise<boolean> {
    const scopedKey = this.scopedKey(key, scope);
    const existed = this.entries.delete(scopedKey);
    if (existed) {
      await this.localStore.delete(key, scope, "semantic");
    }
    return existed;
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  get size(): number {
    return this.entries.size;
  }

  listAll(): MemoryItem[] {
    return Array.from(this.entries.values()).map((e) => e.snapshot);
  }

  listByScope(scope: MemoryScope): MemoryItem[] {
    return Array.from(this.entries.values())
      .filter((e) => e.scope === scope)
      .map((e) => e.snapshot);
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private scopedKey(key: string, scope: MemoryScope): string {
    return `${scope}::${key}`;
  }

  private toText(item: MemoryItem): string {
    if (item.summary) return item.summary;
    const val = item.value;
    if (typeof val === "string") return val;
    try {
      return JSON.stringify(val);
    } catch {
      return item.key;
    }
  }

  private evictLRU(): void {
    // Evict the least-recently accessed snapshot (oldest lastAccessedAt)
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.entries) {
      const t = new Date(entry.snapshot.lastAccessedAt).getTime();
      if (t < oldestTime) {
        oldestTime = t;
        oldest = key;
      }
    }

    if (oldest) {
      this.entries.delete(oldest);
    }
  }
}

// ----------------------------------------------------------------------------
// Utility: Jaccard similarity on token sets
// ----------------------------------------------------------------------------

/**
 * Tokenize text into a normalized token set.
 * Splits on non-word characters, lowercases, removes short tokens.
 */
export function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[\s\W_]+/)
    .filter((t) => t.length > 2);
  return new Set(tokens);
}

/**
 * Jaccard similarity between two token sets.
 * Returns 0–1. Two identical sets return 1.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return intersection / union;
}

/**
 * Cosine similarity between two embedding vectors.
 * Returns 0–1 for normalized vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
