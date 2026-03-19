// ============================================================================
// @dantecode/core — Web Search Orchestrator
// Production-grade multi-provider search with RRF ranking, cost tracking,
// agentic iteration, and provider fallback.
// Harvested from Qwen Code CLI + OpenHands + OpenCode patterns.
// ============================================================================

import type {
  SearchProvider,
  SearchProviderConfig,
  SearchProviderOptions,
  SearchResult,
} from "./search-providers.js";
import { createSearchProviders, loadSearchConfig } from "./search-providers.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Options for the web search orchestrator. */
export interface WebSearchOptions {
  /** Maximum results to return. */
  maxResults?: number;
  /** Search depth: basic (fast) or advanced (thorough). */
  searchDepth?: "basic" | "advanced";
  /** Include raw content from supported providers. */
  includeRawContent?: boolean;
  /** Preferred provider name (bypasses cost-aware ordering). */
  preferredProvider?: string;
  /** Enable chain search with follow-up queries. */
  followUp?: boolean;
  /** Topic filter. */
  topic?: "general" | "news";
  /** Time range filter. */
  timeRange?: "day" | "week" | "month" | "year";
  /** Enable agentic iteration (auto follow-up on low confidence). */
  agenticIteration?: boolean;
  /** Refinement function for chain search. */
  refineFn?: (results: SearchResult[], query: string) => string | null;
}

/** Result from the orchestrator including metadata. */
export interface OrchestratedSearchResult {
  /** Ranked search results. */
  results: SearchResult[];
  /** Which providers contributed results. */
  providersUsed: string[];
  /** Total cost of this search in USD. */
  totalCost: number;
  /** Number of search iterations performed. */
  iterations: number;
  /** Whether the search was served from cache. */
  fromCache: boolean;
  /** Original query. */
  query: string;
}

// ----------------------------------------------------------------------------
// Cache
// ----------------------------------------------------------------------------

interface CacheEntry {
  result: OrchestratedSearchResult;
  timestamp: number;
}

const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getCached(key: string): OrchestratedSearchResult | null {
  const entry = searchCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return { ...entry.result, fromCache: true };
  }
  searchCache.delete(key);
  return null;
}

function setCache(key: string, result: OrchestratedSearchResult): void {
  searchCache.set(key, { result, timestamp: Date.now() });
}

/** Clear all search cache entries. For testing. */
export function clearOrchestratorCache(): void {
  searchCache.clear();
}

// ----------------------------------------------------------------------------
// Orchestrator
// ----------------------------------------------------------------------------

export class WebSearchOrchestrator {
  private providers: SearchProvider[];
  private config: SearchProviderConfig;
  private totalSessionCost = 0;

  constructor(config?: Partial<SearchProviderConfig>, providers?: SearchProvider[]) {
    this.config = { ...loadSearchConfig(), ...config };
    this.providers = providers ?? createSearchProviders(this.config);
  }

  /** Get total cost incurred this session. */
  get sessionCost(): number {
    return this.totalSessionCost;
  }

  /** Get available provider names. */
  get availableProviders(): string[] {
    return this.providers.filter((p) => p.available()).map((p) => p.name);
  }

  /**
   * Execute a search across configured providers with intelligent fallback.
   */
  async search(query: string, options: WebSearchOptions = {}): Promise<OrchestratedSearchResult> {
    const maxResults = options.maxResults ?? this.config.maxResults;
    const cacheKey = this.buildCacheKey(query, options);
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // If follow-up mode, use chain search
    if (options.followUp) {
      return this.chainSearch(query, options);
    }

    // If agentic iteration, use iterative search
    if (options.agenticIteration) {
      return this.agenticSearch(query, options);
    }

    // Standard search with provider fallback
    const providerOpts: SearchProviderOptions = {
      maxResults,
      searchDepth: options.searchDepth ?? this.config.searchDepth,
      includeRawContent: options.includeRawContent,
      topic: options.topic,
      timeRange: options.timeRange,
    };

    // If preferred provider specified, try it first
    if (options.preferredProvider && options.preferredProvider !== "auto") {
      const provider = this.providers.find(
        (p) => p.name === options.preferredProvider && p.available(),
      );
      if (provider) {
        try {
          const results = await provider.search(query, providerOpts);
          const ranked = results.map((r, i) => ({ ...r, rank: i + 1 }));
          const orchestrated: OrchestratedSearchResult = {
            results: ranked.slice(0, maxResults),
            providersUsed: [provider.name],
            totalCost: provider.costPerQuery,
            iterations: 1,
            fromCache: false,
            query,
          };
          this.totalSessionCost += provider.costPerQuery;
          setCache(cacheKey, orchestrated);
          return orchestrated;
        } catch {
          // Fall through to multi-provider search
        }
      }
    }

    // Multi-provider search with cost-aware ordering
    return this.multiProviderSearch(query, providerOpts, maxResults, cacheKey);
  }

  /**
   * Multi-provider search: query available providers concurrently,
   * then merge via reciprocal rank fusion.
   */
  private async multiProviderSearch(
    query: string,
    providerOpts: SearchProviderOptions,
    maxResults: number,
    cacheKey: string,
  ): Promise<OrchestratedSearchResult> {
    const available = this.providers.filter((p) => p.available());
    if (available.length === 0) {
      return {
        results: [],
        providersUsed: [],
        totalCost: 0,
        iterations: 1,
        fromCache: false,
        query,
      };
    }

    // Cost-aware: only use providers within budget
    let budget = this.config.costCapPerCall;
    const selectedProviders: SearchProvider[] = [];
    for (const provider of available) {
      if (provider.costPerQuery <= budget) {
        selectedProviders.push(provider);
        budget -= provider.costPerQuery;
      }
    }

    // Always include at least one provider (DuckDuckGo is free)
    if (selectedProviders.length === 0 && available.length > 0) {
      selectedProviders.push(available[available.length - 1]!);
    }

    // Search all selected providers concurrently
    const allResults = await Promise.allSettled(
      selectedProviders.map((p) => p.search(query, providerOpts)),
    );

    const engineResults: SearchResult[][] = [];
    const providersUsed: string[] = [];
    let totalCost = 0;

    for (let i = 0; i < allResults.length; i++) {
      const result = allResults[i]!;
      if (result.status === "fulfilled" && result.value.length > 0) {
        engineResults.push(result.value);
        providersUsed.push(selectedProviders[i]!.name);
        totalCost += selectedProviders[i]!.costPerQuery;
      }
    }

    // If all providers failed, try DuckDuckGo as last resort
    if (engineResults.length === 0) {
      const ddg = available.find((p) => p.name === "duckduckgo") ?? available[0]!;
      try {
        const fallback = await ddg.search(query, providerOpts);
        const orchestrated: OrchestratedSearchResult = {
          results: fallback.slice(0, maxResults),
          providersUsed: [ddg.name],
          totalCost: ddg.costPerQuery,
          iterations: 1,
          fromCache: false,
          query,
        };
        this.totalSessionCost += ddg.costPerQuery;
        setCache(cacheKey, orchestrated);
        return orchestrated;
      } catch {
        return {
          results: [],
          providersUsed: [],
          totalCost: 0,
          iterations: 1,
          fromCache: false,
          query,
        };
      }
    }

    // Merge via RRF
    const fused = this.reciprocalRankFusion(engineResults);
    this.totalSessionCost += totalCost;

    const orchestrated: OrchestratedSearchResult = {
      results: fused.slice(0, maxResults),
      providersUsed,
      totalCost,
      iterations: 1,
      fromCache: false,
      query,
    };
    setCache(cacheKey, orchestrated);
    return orchestrated;
  }

  /**
   * Chain search: run initial query, then generate follow-up queries
   * based on results. Useful for research workflows.
   */
  async chainSearch(
    initialQuery: string,
    options: WebSearchOptions = {},
  ): Promise<OrchestratedSearchResult> {
    const maxChains = 3;
    const maxResults = options.maxResults ?? this.config.maxResults;
    let allResults: SearchResult[] = [];
    let currentQuery = initialQuery;
    let totalCost = 0;
    const allProviders = new Set<string>();

    for (let i = 0; i <= maxChains; i++) {
      const result = await this.search(currentQuery, {
        ...options,
        followUp: false,
        agenticIteration: false,
      });

      allResults = this.mergeResults(allResults, result.results);
      totalCost += result.totalCost;
      result.providersUsed.forEach((p) => allProviders.add(p));

      if (i === maxChains) break;

      // Generate next query
      const refineFn = options.refineFn ?? this.defaultRefineFn;
      const nextQuery = refineFn(allResults, initialQuery);
      if (!nextQuery) break;
      currentQuery = nextQuery;
    }

    return {
      results: allResults.slice(0, maxResults),
      providersUsed: [...allProviders],
      totalCost,
      iterations: 1,
      fromCache: false,
      query: initialQuery,
    };
  }

  /**
   * Agentic iteration: search, evaluate result quality, and
   * auto-generate follow-up queries if confidence is low.
   * Max 2 additional rounds.
   */
  async agenticSearch(
    query: string,
    options: WebSearchOptions = {},
  ): Promise<OrchestratedSearchResult> {
    const maxIterations = 3;
    const maxResults = options.maxResults ?? this.config.maxResults;
    let allResults: SearchResult[] = [];
    let totalCost = 0;
    const allProviders = new Set<string>();
    let iterations = 0;
    let currentQuery = query;

    for (let i = 0; i < maxIterations; i++) {
      iterations++;
      const result = await this.search(currentQuery, {
        ...options,
        agenticIteration: false,
        followUp: false,
      });

      allResults = this.mergeResults(allResults, result.results);
      totalCost += result.totalCost;
      result.providersUsed.forEach((p) => allProviders.add(p));

      // Evaluate: do we have enough quality results?
      const confidence = this.evaluateResultConfidence(allResults, query);
      if (confidence >= 0.7 || i === maxIterations - 1) break;

      // Generate follow-up query for low-confidence results
      currentQuery = this.generateFollowUpQuery(query, allResults, i);
    }

    return {
      results: allResults.slice(0, maxResults),
      providersUsed: [...allProviders],
      totalCost,
      iterations,
      fromCache: false,
      query,
    };
  }

  // --------------------------------------------------------------------------
  // RRF & Dedup
  // --------------------------------------------------------------------------

  /**
   * Reciprocal Rank Fusion: merges ranked lists from multiple engines.
   * Score = sum(1 / (k + rank_i)) across engines. k=60 standard.
   */
  reciprocalRankFusion(engineResults: SearchResult[][]): SearchResult[] {
    const k = 60;
    const scores = new Map<string, { result: SearchResult; score: number }>();

    for (const results of engineResults) {
      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank]!;
        const normalizedUrl = this.normalizeUrl(result.url);
        const existing = scores.get(normalizedUrl);

        if (existing) {
          existing.score += 1 / (k + rank + 1);
          if (result.snippet.length > existing.result.snippet.length) {
            existing.result = {
              ...result,
              source: `${existing.result.source}+${result.source}`,
            };
          }
          // Keep highest relevance score
          if (
            result.relevanceScore !== undefined &&
            (existing.result.relevanceScore === undefined ||
              result.relevanceScore > existing.result.relevanceScore)
          ) {
            existing.result.relevanceScore = result.relevanceScore;
          }
        } else {
          scores.set(normalizedUrl, {
            result,
            score: 1 / (k + rank + 1),
          });
        }
      }
    }

    return [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .map((entry, i) => ({ ...entry.result, rank: i + 1 }));
  }

  /** Merge results, deduplicating by URL. */
  mergeResults(existing: SearchResult[], incoming: SearchResult[]): SearchResult[] {
    const seen = new Set(existing.map((r) => this.normalizeUrl(r.url)));
    const merged = [...existing];

    for (const result of incoming) {
      const normalized = this.normalizeUrl(result.url);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        merged.push(result);
      }
    }

    return merged;
  }

  /** Normalize URL for deduplication. */
  normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "");
      const path = parsed.pathname.replace(/\/+$/, "");
      return `${host}${path}${parsed.search}`.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  // --------------------------------------------------------------------------
  // Confidence & Follow-Up Heuristics
  // --------------------------------------------------------------------------

  /**
   * Evaluate result quality confidence (0–1).
   * Based on: number of results, snippet quality, source diversity.
   */
  evaluateResultConfidence(results: SearchResult[], query: string): number {
    if (results.length === 0) return 0;

    const queryTokens = new Set(
      query.toLowerCase().split(/\s+/).filter((t) => t.length > 2),
    );

    // Factor 1: Result count (more results = higher confidence)
    const countScore = Math.min(results.length / 5, 1);

    // Factor 2: Query relevance (how many results mention query terms)
    let relevantResults = 0;
    for (const r of results) {
      const text = `${r.title} ${r.snippet}`.toLowerCase();
      let matches = 0;
      for (const token of queryTokens) {
        if (text.includes(token)) matches++;
      }
      if (queryTokens.size > 0 && matches / queryTokens.size >= 0.3) {
        relevantResults++;
      }
    }
    const relevanceScore = results.length > 0 ? relevantResults / results.length : 0;

    // Factor 3: Snippet quality (non-empty, substantive snippets)
    const substantiveSnippets = results.filter((r) => r.snippet.length > 50).length;
    const snippetScore = results.length > 0 ? substantiveSnippets / results.length : 0;

    // Factor 4: Source diversity
    const uniqueSources = new Set(results.map((r) => r.source));
    const diversityScore = Math.min(uniqueSources.size / 2, 1);

    // Weighted combination
    return countScore * 0.25 + relevanceScore * 0.35 + snippetScore * 0.25 + diversityScore * 0.15;
  }

  /** Generate a follow-up query when initial results are insufficient. */
  generateFollowUpQuery(originalQuery: string, currentResults: SearchResult[], iteration: number): string {
    if (currentResults.length === 0) {
      return `${originalQuery} tutorial guide`;
    }

    // Strategy varies by iteration
    if (iteration === 0) {
      return `${originalQuery} documentation examples`;
    }
    return `${originalQuery} ${new Date().getFullYear()} latest`;
  }

  /** Default refinement function for chain search. */
  private defaultRefineFn(results: SearchResult[], _query: string): string | null {
    if (results.length < 3) return `${_query} tutorial guide`;
    return null;
  }

  /** Build cache key from query + options. */
  private buildCacheKey(query: string, options: WebSearchOptions): string {
    const depth = options.searchDepth ?? "basic";
    const provider = options.preferredProvider ?? "auto";
    const maxResults = options.maxResults ?? this.config.maxResults;
    return `orch:${query}:${maxResults}:${provider}:${depth}`;
  }
}

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

/** Create a new WebSearchOrchestrator with default configuration. */
export function createWebSearchOrchestrator(
  config?: Partial<SearchProviderConfig>,
): WebSearchOrchestrator {
  return new WebSearchOrchestrator(config);
}
