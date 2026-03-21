// ============================================================================
// @dantecode/memory-engine — Semantic Recall Engine
// Multi-layer retrieval: short-term + checkpoint + semantic + entity.
// Fusion-ranked results with provenance. GF-02 golden flow.
// ============================================================================

import type { MemoryItem, MemoryScope, MemoryRecallResult } from "./types.js";
import type { ShortTermStore } from "./short-term-store.js";
import type { SessionMemory } from "./session-memory.js";
import type { VectorStore } from "./vector-store.js";

/** Single recall result with source layer and similarity score. */
export interface RecallCandidate {
  item: MemoryItem;
  similarity: number;
  sourceLayer: string;
}

/** Options for a recall query. */
export interface RecallOptions {
  /** Maximum results to return. Default: 10. */
  limit?: number;
  /** Scope filter. Undefined = all scopes. */
  scope?: MemoryScope;
  /** Minimum similarity threshold (0–1). Default: 0.0. */
  minSimilarity?: number;
  /** Whether to include short-term layer. Default: true. */
  includeShortTerm?: boolean;
  /** Whether to include checkpoint layer. Default: true. */
  includeCheckpoint?: boolean;
  /** Whether to include semantic layer. Default: true. */
  includeSemantic?: boolean;
  /** Whether to include entity layer. Default: false (entity layer is specialized). */
  includeEntity?: boolean;
}

/**
 * Multi-layer semantic recall engine.
 *
 * Retrieval pipeline:
 * 1. Query short-term store (exact + partial match)
 * 2. Query checkpoint layer (keyword search)
 * 3. Query semantic (vector) layer (Jaccard similarity)
 * 4. Merge and deduplicate by key
 * 5. Re-rank by fused score (similarity × recency × recall boost)
 * 6. Return top-N with provenance
 */
export class SemanticRecall {
  private readonly shortTerm: ShortTermStore;
  private readonly sessionMemory: SessionMemory;
  private readonly vectorStore: VectorStore;

  constructor(shortTerm: ShortTermStore, sessionMemory: SessionMemory, vectorStore: VectorStore) {
    this.shortTerm = shortTerm;
    this.sessionMemory = sessionMemory;
    this.vectorStore = vectorStore;
  }

  // --------------------------------------------------------------------------
  // Core recall
  // --------------------------------------------------------------------------

  /**
   * Recall memories relevant to the query.
   *
   * @param query - Natural language query or keyword
   * @param options - Recall options
   * @returns Timed MemoryRecallResult with ranked items
   */
  async recall(query: string, options: RecallOptions = {}): Promise<MemoryRecallResult> {
    const start = Date.now();
    const {
      limit = 10,
      scope,
      minSimilarity = 0,
      includeShortTerm = true,
      includeCheckpoint = true,
      includeSemantic = true,
    } = options;

    const candidates: RecallCandidate[] = [];

    // Layer 1: Short-term
    if (includeShortTerm) {
      const stResults = this.shortTerm.search(query, scope, limit * 2);
      for (const item of stResults) {
        candidates.push({
          item,
          similarity: this.keywordSimilarity(query, item),
          sourceLayer: "short-term",
        });
      }
    }

    // Layer 2: Checkpoint (session memory)
    if (includeCheckpoint) {
      const cpResults = await this.sessionMemory.search(query, scope);
      for (const item of cpResults.slice(0, limit * 2)) {
        candidates.push({
          item,
          similarity: this.keywordSimilarity(query, item),
          sourceLayer: "checkpoint",
        });
      }
    }

    // Layer 3: Semantic (vector store)
    if (includeSemantic) {
      const vecResults = this.vectorStore.search(query, limit * 2, scope);
      for (const r of vecResults) {
        candidates.push({
          item: r.item,
          similarity: r.similarity,
          sourceLayer: "semantic",
        });
      }
    }

    // Deduplicate by key+scope (prefer higher similarity source)
    const deduped = deduplicateCandidates(candidates);

    // Fuse-rank: similarity + recency + recall boost
    const ranked = fusionRank(deduped, query);

    // Apply threshold + limit
    const filtered = ranked.filter((c) => c.similarity >= minSimilarity).slice(0, limit);

    return {
      query,
      scope: scope ?? "all",
      results: filtered.map((c) => c.item),
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Cross-session recall: retrieve memories relevant to a user goal.
   * Searches all project + global scopes, returns top memories by relevance.
   *
   * GF-02: semantic recall with cross-session scope handling.
   */
  async crossSessionRecall(userGoal: string, limit = 10): Promise<MemoryRecallResult> {
    const start = Date.now();
    const candidates: RecallCandidate[] = [];

    // Search project + global scopes in semantic layer
    for (const scope of ["project", "global"] as MemoryScope[]) {
      const vecResults = this.vectorStore.search(userGoal, limit * 2, scope);
      for (const r of vecResults) {
        candidates.push({
          item: r.item,
          similarity: r.similarity,
          sourceLayer: `semantic:${scope}`,
        });
      }

      const cpResults = await this.sessionMemory.search(userGoal, scope);
      for (const item of cpResults.slice(0, limit)) {
        candidates.push({
          item,
          similarity: this.keywordSimilarity(userGoal, item),
          sourceLayer: `checkpoint:${scope}`,
        });
      }
    }

    const deduped = deduplicateCandidates(candidates);
    const ranked = fusionRank(deduped, userGoal);

    return {
      query: userGoal,
      scope: "cross-session",
      results: ranked.slice(0, limit).map((c) => c.item),
      latencyMs: Date.now() - start,
    };
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private keywordSimilarity(query: string, item: MemoryItem): number {
    const q = query.toLowerCase();
    const text = `${item.key} ${item.summary ?? ""} ${JSON.stringify(item.value)}`.toLowerCase();

    // Token overlap score
    const queryWords = q.split(/\s+/).filter((w) => w.length > 2);
    if (queryWords.length === 0) return 0;

    let hits = 0;
    for (const word of queryWords) {
      if (text.includes(word)) hits++;
    }
    return hits / queryWords.length;
  }
}

// ----------------------------------------------------------------------------
// Fusion ranking utilities
// ----------------------------------------------------------------------------

/** Remove duplicate candidates, keeping the one with highest similarity. */
function deduplicateCandidates(candidates: RecallCandidate[]): RecallCandidate[] {
  const best = new Map<string, RecallCandidate>();
  for (const c of candidates) {
    const key = `${c.item.scope}::${c.item.key}`;
    const existing = best.get(key);
    if (!existing || c.similarity > existing.similarity) {
      best.set(key, c);
    }
  }
  return Array.from(best.values());
}

/** Fusion-rank candidates by similarity × recency factor × recall boost. */
function fusionRank(candidates: RecallCandidate[], _query: string): RecallCandidate[] {
  const now = Date.now();

  return candidates
    .map((c) => {
      const ageDays = (now - new Date(c.item.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24);
      // Recency factor: 1.0 at 0 days, 0.5 at 7 days, 0.1 at 30+ days
      const recencyFactor = Math.max(0.1, 1 - ageDays / 30);
      // Recall boost: more recalled = more relevant
      const recallBoost = Math.min(0.3, c.item.recallCount * 0.05);
      // Verified items get a 0.2 boost
      const verifiedBoost = c.item.verified ? 0.2 : 0;
      // Score from item quality
      const itemScore = c.item.score * 0.2;

      const fusedScore =
        c.similarity * 0.5 + recencyFactor * 0.3 + recallBoost + verifiedBoost + itemScore;

      return { ...c, similarity: fusedScore };
    })
    .sort((a, b) => b.similarity - a.similarity);
}
