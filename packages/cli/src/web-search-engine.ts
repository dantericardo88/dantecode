// ============================================================================
// @dantecode/cli — Multi-Engine Web Search (v2.0 — 9+ Upgrade)
// Now delegates to @dantecode/core's WebSearchOrchestrator for multi-provider
// search with Tavily/Exa/Serper/Google/Brave/DuckDuckGo, RRF ranking,
// semantic reranking, citations, and 7-day semantic cache.
//
// This file maintains backward-compatible exports (SearchResult, SearchEngine,
// MultiEngineSearch, clearSearchCache, createSearchEngine) while routing all
// calls through the new orchestrator.
// ============================================================================

import {
  WebSearchOrchestrator,
  createWebSearchOrchestrator,
  clearOrchestratorCache,
  type OrchestratedSearchResult,
  type WebSearchOptions,
  type SearchResult as CoreSearchResult,
  synthesizeResults,
  formatSynthesizedResult,
  rerankResults,
  type RerankContext,
} from "@dantecode/core";

// ----------------------------------------------------------------------------
// Re-export core types for backward compatibility
// ----------------------------------------------------------------------------

export type { CoreSearchResult as SearchResult };

/** @deprecated Use SearchProvider from @dantecode/core instead. */
export interface SearchEngine {
  name: string;
  available(): boolean;
  search(query: string, maxResults: number): Promise<CoreSearchResult[]>;
}

// ----------------------------------------------------------------------------
// Enhanced Search Engine (wraps new orchestrator)
// ----------------------------------------------------------------------------

/**
 * Enhanced multi-provider search engine that wraps the core orchestrator.
 * Backward-compatible with the original MultiEngineSearch API while
 * providing access to new features (citations, reranking, agentic iteration).
 */
export class MultiEngineSearch {
  private orchestrator: WebSearchOrchestrator;

  constructor() {
    this.orchestrator = createWebSearchOrchestrator();
  }

  /** Get the underlying orchestrator for advanced usage. */
  getOrchestrator(): WebSearchOrchestrator {
    return this.orchestrator;
  }

  /** Get available provider names. */
  get availableProviders(): string[] {
    return this.orchestrator.availableProviders;
  }

  /** Get session cost so far. */
  get sessionCost(): number {
    return this.orchestrator.sessionCost;
  }

  /**
   * Search using the new multi-provider orchestrator.
   * Backward-compatible: returns SearchResult[] like the old API.
   */
  async search(
    query: string,
    maxResults = 15,
    preferredProvider?: string,
  ): Promise<CoreSearchResult[]> {
    const result = await this.orchestrator.search(query, {
      maxResults,
      preferredProvider,
    });
    return result.results;
  }

  /**
   * Enhanced search with full orchestrated result including metadata.
   */
  async orchestratedSearch(
    query: string,
    options: WebSearchOptions = {},
  ): Promise<OrchestratedSearchResult> {
    return this.orchestrator.search(query, options);
  }

  /**
   * Search with synthesis: returns results + LLM-ready summary with citations.
   */
  async searchWithCitations(
    query: string,
    options: WebSearchOptions = {},
  ): Promise<{
    results: CoreSearchResult[];
    synthesized: string;
    confidence: number;
    providersUsed: string[];
    totalCost: number;
  }> {
    const orchestrated = await this.orchestrator.search(query, options);
    const synthesis = synthesizeResults(orchestrated.results, query, {
      useRawContent: options.includeRawContent,
    });

    return {
      results: orchestrated.results,
      synthesized: formatSynthesizedResult(synthesis),
      confidence: synthesis.confidence,
      providersUsed: orchestrated.providersUsed,
      totalCost: orchestrated.totalCost,
    };
  }

  /**
   * Search with reranking: results reordered by context relevance.
   */
  async searchWithReranking(
    query: string,
    context: RerankContext,
    options: WebSearchOptions = {},
  ): Promise<CoreSearchResult[]> {
    const orchestrated = await this.orchestrator.search(query, options);
    const reranked = rerankResults(orchestrated.results, context);
    return reranked;
  }

  /**
   * Chain searches with follow-up refinement.
   * Backward-compatible with old chainSearch API.
   */
  async chainSearch(
    initialQuery: string,
    refineFn: (results: CoreSearchResult[]) => string | null,
    _maxChains = 3,
    maxResults = 15,
  ): Promise<CoreSearchResult[]> {
    const result = await this.orchestrator.chainSearch(initialQuery, {
      maxResults,
      refineFn: (results) => refineFn(results),
    });
    return result.results;
  }

  /**
   * Agentic search: auto-follows up on low-confidence results.
   */
  async agenticSearch(
    query: string,
    options: WebSearchOptions = {},
  ): Promise<OrchestratedSearchResult> {
    return this.orchestrator.agenticSearch(query, options);
  }
}

// ----------------------------------------------------------------------------
// Cache Control
// ----------------------------------------------------------------------------

/** Clear all search caches (orchestrator + legacy). */
export function clearSearchCache(): void {
  clearOrchestratorCache();
}

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

/** Creates the enhanced multi-provider search engine. */
export function createSearchEngine(): MultiEngineSearch {
  return new MultiEngineSearch();
}
