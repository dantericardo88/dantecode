// ============================================================================
// @dantecode/cli — Multi-Engine Web Search
// Provides a multi-engine search abstraction with result deduplication,
// reciprocal rank fusion, and follow-up search chaining.
// Harvested from Qwen Code's multi-engine pattern (Apache 2.0).
// ============================================================================

import { htmlToReadableText } from "./html-parser.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  rank?: number;
}

export interface SearchEngine {
  name: string;
  available(): boolean;
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}

// ----------------------------------------------------------------------------
// Cache (shared with tools.ts)
// ----------------------------------------------------------------------------

const searchCache = new Map<string, { results: SearchResult[]; timestamp: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getCachedSearch(key: string): SearchResult[] | null {
  const entry = searchCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.results;
  }
  searchCache.delete(key);
  return null;
}

function setCachedSearch(key: string, results: SearchResult[]): void {
  searchCache.set(key, { results, timestamp: Date.now() });
}

/** Clears the search cache. Useful for testing. */
export function clearSearchCache(): void {
  searchCache.clear();
}

// ----------------------------------------------------------------------------
// DuckDuckGo Engine (always available, no API key)
// ----------------------------------------------------------------------------

export class DuckDuckGoEngine implements SearchEngine {
  name = "duckduckgo";

  available(): boolean {
    return true; // Always available, no API key
  }

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "DanteCode/1.0 (CLI agent tool)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo HTTP ${response.status}`);
    }

    const html = await response.text();
    return this.parseResults(html, maxResults);
  }

  private parseResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // DuckDuckGo result blocks: <div class="result..."> with nested links
    const resultBlocks =
      html.match(
        /<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi,
      ) || [];

    for (const block of resultBlocks) {
      if (results.length >= maxResults) break;

      const linkMatch = block.match(
        /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!linkMatch) continue;

      const url = linkMatch[1]!;
      const title = htmlToReadableText(linkMatch[2]!);

      const snippetMatch = block.match(
        /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
      );
      const snippet = snippetMatch ? htmlToReadableText(snippetMatch[1]!) : "";

      if (title && url && !url.startsWith("//duckduckgo.com")) {
        results.push({ title, url, snippet, source: this.name });
      }
    }

    // Fallback: extract links if structured parsing fails
    if (results.length === 0) {
      const linkMatches = [
        ...html.matchAll(
          /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
        ),
      ];
      for (const match of linkMatches) {
        if (results.length >= maxResults) break;
        const url = match[1]!;
        const title = htmlToReadableText(match[2]!);
        if (url.includes("duckduckgo.com") || !title || title.length < 3) continue;
        results.push({ title, url, snippet: "", source: this.name });
      }
    }

    return results;
  }
}

// ----------------------------------------------------------------------------
// Brave Search Engine (optional, requires BRAVE_API_KEY env)
// ----------------------------------------------------------------------------

export class BraveSearchEngine implements SearchEngine {
  name = "brave";

  available(): boolean {
    return !!process.env["BRAVE_API_KEY"];
  }

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const apiKey = process.env["BRAVE_API_KEY"];
    if (!apiKey) return [];

    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(maxResults, 20)),
    });

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) {
      throw new Error(`Brave Search HTTP ${response.status}`);
    }

    const data = (await response.json()) as BraveSearchResponse;
    return this.parseResults(data, maxResults);
  }

  private parseResults(data: BraveSearchResponse, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];
    const webResults = data.web?.results ?? [];

    for (const item of webResults) {
      if (results.length >= maxResults) break;
      results.push({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: item.description ?? "",
        source: this.name,
      });
    }

    return results;
  }
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
}

// ----------------------------------------------------------------------------
// Multi-Engine Search Orchestrator
// ----------------------------------------------------------------------------

export class MultiEngineSearch {
  private engines: SearchEngine[];

  constructor(engines?: SearchEngine[]) {
    this.engines = engines ?? [new DuckDuckGoEngine(), new BraveSearchEngine()];
  }

  /**
   * Search across all available engines, deduplicate, and rank results.
   */
  async search(
    query: string,
    maxResults = 10,
    preferredEngine?: string,
  ): Promise<SearchResult[]> {
    const cacheKey = `multi:${query}:${maxResults}:${preferredEngine ?? "auto"}`;
    const cached = getCachedSearch(cacheKey);
    if (cached) return cached;

    // If a specific engine is preferred and available, use it alone
    if (preferredEngine && preferredEngine !== "auto") {
      const engine = this.engines.find(
        (e) => e.name === preferredEngine && e.available(),
      );
      if (engine) {
        const results = await engine.search(query, maxResults);
        const ranked = results.map((r, i) => ({ ...r, rank: i + 1 }));
        setCachedSearch(cacheKey, ranked);
        return ranked;
      }
    }

    // Search all available engines concurrently
    const available = this.engines.filter((e) => e.available());
    if (available.length === 0) {
      return [];
    }

    const allResults = await Promise.allSettled(
      available.map((engine) => engine.search(query, maxResults)),
    );

    // Collect results by engine
    const engineResults: SearchResult[][] = [];
    for (const result of allResults) {
      if (result.status === "fulfilled") {
        engineResults.push(result.value);
      }
    }

    if (engineResults.length === 0) {
      // All engines failed — try DuckDuckGo alone as last resort
      const ddg = new DuckDuckGoEngine();
      try {
        const fallback = await ddg.search(query, maxResults);
        setCachedSearch(cacheKey, fallback);
        return fallback;
      } catch {
        return [];
      }
    }

    // Deduplicate and rank via reciprocal rank fusion
    const fused = this.reciprocalRankFusion(engineResults);
    const final = fused.slice(0, maxResults);
    setCachedSearch(cacheKey, final);
    return final;
  }

  /**
   * Chain searches: run initial query, then use refineFn to generate
   * follow-up queries based on results. Useful for research workflows.
   */
  async chainSearch(
    initialQuery: string,
    refineFn: (results: SearchResult[]) => string | null,
    maxChains = 3,
    maxResults = 10,
  ): Promise<SearchResult[]> {
    let allResults: SearchResult[] = [];
    let currentQuery = initialQuery;

    for (let i = 0; i <= maxChains; i++) {
      const results = await this.search(currentQuery, maxResults);
      allResults = this.mergeResults(allResults, results);

      if (i === maxChains) break;

      const nextQuery = refineFn(allResults);
      if (!nextQuery) break; // No more refinement needed
      currentQuery = nextQuery;
    }

    return allResults;
  }

  /**
   * Reciprocal Rank Fusion (RRF): merges ranked lists from multiple engines.
   * Each result gets score = sum(1 / (k + rank_i)) across engines where it appears.
   * k = 60 is the standard constant that reduces the impact of high rankings.
   */
  private reciprocalRankFusion(engineResults: SearchResult[][]): SearchResult[] {
    const k = 60;
    const scores = new Map<string, { result: SearchResult; score: number }>();

    for (const results of engineResults) {
      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank]!;
        const normalizedUrl = this.normalizeUrl(result.url);
        const existing = scores.get(normalizedUrl);

        if (existing) {
          existing.score += 1 / (k + rank + 1);
          // Keep the result with the longer snippet
          if (result.snippet.length > existing.result.snippet.length) {
            existing.result = { ...result, source: `${existing.result.source}+${result.source}` };
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

  /**
   * Merge new results into existing results, deduplicating by URL.
   */
  private mergeResults(existing: SearchResult[], incoming: SearchResult[]): SearchResult[] {
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

  /**
   * Normalizes URLs for deduplication: removes trailing slashes,
   * www prefix, and protocol differences.
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "");
      const path = parsed.pathname.replace(/\/+$/, "");
      return `${host}${path}${parsed.search}`.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }
}

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

/**
 * Creates a MultiEngineSearch with all available engines.
 */
export function createSearchEngine(): MultiEngineSearch {
  return new MultiEngineSearch();
}
