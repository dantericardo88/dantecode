// ============================================================================
// Memory Distiller — compresses N memory entries into K distilled summaries.
// Uses token-level Jaccard similarity for cluster detection and merging.
// Designed for cross-session memory compaction in DanteCode agent loops.
// ============================================================================

import { tokenize, jaccardSimilarity } from "./approach-memory.js";

/** A raw memory entry eligible for distillation. */
export interface DistillableEntry {
  id: string;
  content: string;
  category: string;
  relevanceScore: number;
  timestamp: string;
  tags: string[];
}

/** A distilled (merged/compressed) memory entry. */
export interface DistilledEntry {
  content: string;
  sourceIds: string[];
  category: string;
  combinedScore: number;
  tags: string[];
  timestamp: string;
}

/** Result of a distillation pass. */
export interface DistillationResult {
  distilled: DistilledEntry[];
  removedCount: number;
  mergedCount: number;
  keptCount: number;
}

/** Options controlling distillation behavior. */
export interface DistillerOptions {
  /** Jaccard threshold for merging similar entries. Default: 0.7 */
  mergeThreshold?: number;
  /** Maximum distilled entries to produce. Default: 100 */
  maxOutput?: number;
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

/**
 * Cluster entries by similarity within a single category group.
 * Greedy single-linkage: each entry joins the first cluster whose representative
 * it exceeds the merge threshold against.
 */
function clusterBySimilarity(
  entries: DistillableEntry[],
  threshold: number,
): DistillableEntry[][] {
  const clusters: DistillableEntry[][] = [];
  const tokenCache = new Map<string, Set<string>>();

  const getTokens = (entry: DistillableEntry): Set<string> => {
    let cached = tokenCache.get(entry.id);
    if (!cached) {
      cached = tokenize(entry.content);
      tokenCache.set(entry.id, cached);
    }
    return cached;
  };

  for (const entry of entries) {
    const entryTokens = getTokens(entry);
    let placed = false;

    for (const cluster of clusters) {
      // Compare against the first entry in the cluster (representative)
      const repTokens = getTokens(cluster[0]!);
      if (jaccardSimilarity(entryTokens, repTokens) >= threshold) {
        cluster.push(entry);
        placed = true;
        break;
      }
    }

    if (!placed) {
      clusters.push([entry]);
    }
  }

  return clusters;
}

/**
 * Merge a cluster of similar entries into a single distilled entry.
 * - Content: picks the longest content string (most informative).
 * - Tags: union of all tags (deduplicated).
 * - Score: average of all relevance scores.
 * - Timestamp: latest timestamp in the cluster.
 * - SourceIds: all original entry IDs.
 */
function mergeCluster(cluster: DistillableEntry[]): DistilledEntry {
  // Pick the longest content (most informative)
  let longestContent = cluster[0]!.content;
  for (const entry of cluster) {
    if (entry.content.length > longestContent.length) {
      longestContent = entry.content;
    }
  }

  // Union of all tags
  const tagSet = new Set<string>();
  for (const entry of cluster) {
    for (const tag of entry.tags) {
      tagSet.add(tag);
    }
  }

  // Average relevance score
  const totalScore = cluster.reduce((sum, e) => sum + e.relevanceScore, 0);
  const avgScore = totalScore / cluster.length;

  // Latest timestamp
  let latestTimestamp = cluster[0]!.timestamp;
  for (const entry of cluster) {
    if (entry.timestamp > latestTimestamp) {
      latestTimestamp = entry.timestamp;
    }
  }

  // Collect all source IDs
  const sourceIds = cluster.map((e) => e.id);

  return {
    content: longestContent,
    sourceIds,
    category: cluster[0]!.category,
    combinedScore: avgScore,
    tags: [...tagSet],
    timestamp: latestTimestamp,
  };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Distill a collection of memory entries into a compressed set.
 *
 * Algorithm:
 * 1. Group entries by category.
 * 2. Within each group, cluster by Jaccard similarity (>= mergeThreshold).
 * 3. Merge each cluster into a single distilled entry.
 * 4. Sort all distilled entries by combinedScore descending.
 * 5. If total exceeds maxOutput, keep only the top entries.
 *
 * @param entries - Raw memory entries to distill.
 * @param options - Distillation parameters.
 * @returns DistillationResult with distilled entries and counts.
 */
export function distillEntries(
  entries: DistillableEntry[],
  options?: DistillerOptions,
): DistillationResult {
  const mergeThreshold = options?.mergeThreshold ?? 0.7;
  const maxOutput = options?.maxOutput ?? 100;

  if (entries.length === 0) {
    return { distilled: [], removedCount: 0, mergedCount: 0, keptCount: 0 };
  }

  // Step 1: Group by category
  const groups = new Map<string, DistillableEntry[]>();
  for (const entry of entries) {
    let group = groups.get(entry.category);
    if (!group) {
      group = [];
      groups.set(entry.category, group);
    }
    group.push(entry);
  }

  // Step 2-3: Cluster and merge within each category
  const allDistilled: DistilledEntry[] = [];
  let mergedCount = 0;

  for (const [, groupEntries] of groups) {
    const clusters = clusterBySimilarity(groupEntries, mergeThreshold);

    for (const cluster of clusters) {
      allDistilled.push(mergeCluster(cluster));
      if (cluster.length > 1) {
        // Count each multi-entry cluster as one merge operation
        mergedCount++;
      }
    }
  }

  // Step 4: Sort by combinedScore descending
  allDistilled.sort((a, b) => b.combinedScore - a.combinedScore);

  // Step 5: Trim to maxOutput
  let removedCount = 0;
  let finalDistilled: DistilledEntry[];

  if (allDistilled.length > maxOutput) {
    removedCount = allDistilled.length - maxOutput;
    finalDistilled = allDistilled.slice(0, maxOutput);
  } else {
    finalDistilled = allDistilled;
  }

  return {
    distilled: finalDistilled,
    removedCount,
    mergedCount,
    keptCount: finalDistilled.length,
  };
}

/**
 * Extract strategy/playbook bullets from memory entries.
 *
 * Selects entries where category is "strategy" or tags include "playbook",
 * then returns their content strings sorted by relevanceScore descending.
 *
 * @param entries - Memory entries to scan for strategy content.
 * @returns Array of content strings representing playbook strategies.
 */
export function extractPlaybook(entries: DistillableEntry[]): string[] {
  const strategies = entries.filter(
    (e) => e.category === "strategy" || e.tags.includes("playbook"),
  );

  strategies.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return strategies.map((e) => e.content);
}

/**
 * Compute relevance of an entry to a query string.
 *
 * Base score is Jaccard similarity between tokenized content and tokenized query.
 * Bonuses:
 * - +0.1 if entry category is "strategy"
 * - +0.05 for each tag that appears as a token in the query
 *
 * @param entry - The memory entry to score.
 * @param query - The query string to measure relevance against.
 * @returns Relevance score in [0, 1+bonus] range.
 */
export function scoreRelevance(entry: DistillableEntry, query: string): number {
  const contentTokens = tokenize(entry.content);
  const queryTokens = tokenize(query);

  let score = jaccardSimilarity(contentTokens, queryTokens);

  // Category bonus
  if (entry.category === "strategy") {
    score += 0.1;
  }

  // Tag matching bonus: each tag that appears in the query tokens
  const queryTokenSet = queryTokens;
  for (const tag of entry.tags) {
    const tagLower = tag.toLowerCase();
    if (queryTokenSet.has(tagLower)) {
      score += 0.05;
    }
  }

  return score;
}

/**
 * Find clusters of duplicate or near-duplicate entries.
 *
 * Groups entries whose pairwise Jaccard similarity exceeds the threshold.
 * Returns an array of ID arrays, where each inner array contains the IDs
 * of entries that form a duplicate cluster (only clusters with 2+ members).
 *
 * @param entries - Entries to scan for duplicates.
 * @param threshold - Jaccard similarity threshold for duplicate detection. Default: 0.8.
 * @returns Array of ID arrays, one per duplicate cluster.
 */
export function findDuplicates(
  entries: DistillableEntry[],
  threshold = 0.8,
): string[][] {
  const clusters = clusterBySimilarity(entries, threshold);

  // Only return clusters with 2+ members (actual duplicates)
  return clusters.filter((c) => c.length > 1).map((c) => c.map((e) => e.id));
}
