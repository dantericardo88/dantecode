// ============================================================================
// packages/codebase-index/src/repo-map-provider.ts
// TTL-cached repo map for FIM prompt injection.
//
// Harvest: Continue.dev context provider TTL caching pattern.
// Wraps buildRepoMap() from @dantecode/core — does NOT re-implement PageRank.
// Invalidated on every file save to avoid stale rankings.
// ============================================================================

import { buildRepoMap, formatRepoMap, buildRepoMapTags } from "@dantecode/core";
import type { SymbolTag } from "@dantecode/core";

const TTL_MS = 5 * 60_000; // 5 minutes

/**
 * Provides a compact, FIM-ready repo map string within a token budget.
 *
 * Usage:
 *   const provider = new RepoMapProvider();
 *   const map = await provider.getMap("/path/to/project", 300);
 *   // Returns: "- src/auth.ts\n  function getToken, class AuthManager\n..."
 *
 * Invalidate on file save:
 *   provider.invalidate();
 */
export class RepoMapProvider {
  private _cache: { map: string; builtAt: number } | null = null;
  private _tagsCache: { tags: SymbolTag[]; builtAt: number } | null = null;

  /**
   * Return the cached repo map, rebuilding if expired or missing.
   *
   * @param projectRoot  - Absolute path to the project root.
   * @param budgetTokens - Maximum token budget (default 300 ≈ ~1050 chars).
   * @returns Formatted repo map string, or "" on error / empty project.
   */
  async getMap(projectRoot: string, budgetTokens = 300): Promise<string> {
    const now = Date.now();
    if (this._cache && now - this._cache.builtAt < TTL_MS) {
      return this._cache.map;
    }

    try {
      // budgetTokens → maxTokenBudget for formatRepoMap
      const rankedFiles = await buildRepoMap(projectRoot);
      const map = formatRepoMap(rankedFiles, budgetTokens);
      this._cache = { map, builtAt: Date.now() };
      return map;
    } catch {
      // Non-fatal: FIM completion proceeds without repo map
      return "";
    }
  }

  /**
   * Return Aider-style symbol tags for the project, with 5-min TTL caching.
   * Each tag records which symbol is defined in which file and how many other
   * files reference it — allowing callers to identify cross-file centrality.
   *
   * @param projectRoot - Absolute path to the project root.
   * @returns SymbolTag[] sorted by refCount descending, or [] on error.
   */
  async getRepoMapTags(projectRoot: string): Promise<SymbolTag[]> {
    const now = Date.now();
    if (this._tagsCache && now - this._tagsCache.builtAt < TTL_MS) {
      return this._tagsCache.tags;
    }

    try {
      const tags = await buildRepoMapTags(projectRoot);
      this._tagsCache = { tags, builtAt: Date.now() };
      return tags;
    } catch {
      return [];
    }
  }

  /**
   * Force cache invalidation on the next getMap() call.
   * Should be called whenever a file is saved.
   */
  invalidate(): void {
    this._cache = null;
    this._tagsCache = null;
  }
}
