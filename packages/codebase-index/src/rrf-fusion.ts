// ============================================================================
// packages/codebase-index/src/rrf-fusion.ts
// Reciprocal Rank Fusion — merge multiple ranked chunk lists into one.
//
// Harvest: DanteCode packages/core/src/web-search-orchestrator.ts
//          reciprocalRankFusion() pattern, adapted for CodeChunk lists.
//
// Formula: score(d) = Σ_i  1 / (k + rank_i(d))
// k=60 is the standard RRF constant (Cormack et al. 2009).
// ============================================================================

import type { RankedChunk } from "./types.js";

const RRF_K = 60;

/**
 * Merge multiple ranked chunk lists into a single ranking via RRF.
 *
 * Items appearing in multiple lists receive additive score bonuses.
 * Items appearing in none remain absent from the result.
 *
 * @param rankedLists - Each list is already ranked (index 0 = best).
 * @returns Merged list, descending by RRF score.
 */
export function rrfFusion(rankedLists: RankedChunk[][]): RankedChunk[] {
  if (rankedLists.length === 0) return [];

  const scores = new Map<string, { item: RankedChunk; score: number }>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank]!;
      const rrf = 1 / (RRF_K + rank + 1);
      const existing = scores.get(item.key);
      if (existing) {
        existing.score += rrf;
      } else {
        scores.set(item.key, { item, score: rrf });
      }
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map((e) => e.item);
}
