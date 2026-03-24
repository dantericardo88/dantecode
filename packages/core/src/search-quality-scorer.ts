// ============================================================================
// @dantecode/core — Search Quality Scorer
// Multi-dimensional quality scoring for search results to drive filtering,
// synthesis priority, and result ranking decisions.
// ============================================================================

import type { SearchResult } from "./search-providers.js";
import { DimensionScorer } from "./dimension-scorer.js";
import type { DimensionScorerOptions } from "./dimension-scorer.js";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** Quality score decomposed into four orthogonal dimensions. */
export interface SearchQualityScore {
  /** Source trustworthiness based on domain (0-25). */
  sourceAuthority: number;
  /** How recent the result is (0-25). */
  freshness: number;
  /** Topic relevance based on snippet quality (0-25). */
  relevance: number;
  /** Density of citations, references, and structured content (0-25). */
  citationDensity: number;
  /** Aggregate score (0-100). */
  total: number;
}

/** Search result enriched with its quality score. */
export interface ScoredSearchResult extends SearchResult {
  /** Quality score for this result. */
  qualityScore: SearchQualityScore;
}

// ────────────────────────────────────────────────────────────────────────────
// Domain Authority Map
// ────────────────────────────────────────────────────────────────────────────

/** Known authoritative domains for technical content (0-1). */
const DOMAIN_AUTHORITY: Record<string, number> = {
  "github.com": 0.95,
  "stackoverflow.com": 0.92,
  "developer.mozilla.org": 0.95,
  "docs.python.org": 0.90,
  "docs.microsoft.com": 0.88,
  "learn.microsoft.com": 0.88,
  "nodejs.org": 0.90,
  "typescriptlang.org": 0.92,
  "react.dev": 0.90,
  "nextjs.org": 0.88,
  "npmjs.com": 0.85,
  "pypi.org": 0.82,
  "crates.io": 0.82,
  "pkg.go.dev": 0.85,
  "docs.rs": 0.88,
  "arxiv.org": 0.80,
  "en.wikipedia.org": 0.75,
  "docs.docker.com": 0.85,
  "kubernetes.io": 0.88,
  "rust-lang.org": 0.90,
  "go.dev": 0.88,
  "angular.io": 0.85,
  "vuejs.org": 0.85,
  "svelte.dev": 0.82,
  "medium.com": 0.45,
  "dev.to": 0.50,
  "hackernews.com": 0.55,
  "reddit.com": 0.40,
  "w3schools.com": 0.50,
};

// ────────────────────────────────────────────────────────────────────────────
// Scorer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Multi-dimensional quality scorer for search results.
 *
 * Dimensions (each 0-25):
 * - **sourceAuthority**: domain reputation from authority map.
 * - **freshness**: inverse age from publishedDate.
 * - **relevance**: snippet length + code presence + structural cues.
 * - **citationDensity**: links, references, lists, code blocks in snippet.
 */
export class SearchQualityScorer extends DimensionScorer<SearchResult> {
  constructor(options?: DimensionScorerOptions) {
    super(options);
  }

  protected dimensionNames(): [string, string, string, string] {
    return ["sourceAuthority", "freshness", "relevance", "citationDensity"];
  }

  protected scoreDimensions(result: SearchResult): [number, number, number, number] {
    return [
      this.scoreAuthority(result.url),
      this.scoreFreshness(result.publishedDate),
      this.scoreRelevance(result),
      this.scoreCitationDensity(result.snippet),
    ];
  }

  /** Score a single search result across four dimensions (0-100 aggregate). */
  score(result: SearchResult): SearchQualityScore {
    const [sourceAuthority, freshness, relevance, citationDensity] = this.scoreDimensions(result);
    const total = sourceAuthority + freshness + relevance + citationDensity;
    return { sourceAuthority, freshness, relevance, citationDensity, total };
  }

  /**
   * Filter results below a quality threshold.
   * Default threshold is 30 (out of 100).
   */
  filter(results: SearchResult[], threshold = 30): ScoredSearchResult[] {
    return results
      .map((r) => ({ ...r, qualityScore: this.score(r) }))
      .filter((r) => r.qualityScore.total >= threshold);
  }

  /**
   * Sort results by quality score descending for synthesis priority.
   * Returns scored results ordered from highest to lowest quality.
   */
  weightedSynthesis(results: SearchResult[]): ScoredSearchResult[] {
    return results
      .map((r) => ({ ...r, qualityScore: this.score(r) }))
      .sort((a, b) => b.qualityScore.total - a.qualityScore.total);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Dimension scorers (each returns 0-25)
  // ──────────────────────────────────────────────────────────────────────────

  /** Source authority: domain reputation from authority map. */
  private scoreAuthority(url: string): number {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      // Check exact match first, then check parent domain patterns
      const authority = DOMAIN_AUTHORITY[hostname]
        ?? this.matchSubdomain(hostname)
        ?? 0.4; // unknown domain baseline
      return Math.round(authority * 25);
    } catch {
      return 8; // fallback for malformed URLs
    }
  }

  /** Match docs.* subdomains and known patterns. */
  private matchSubdomain(hostname: string): number | undefined {
    // docs.* subdomains typically have high authority
    if (hostname.startsWith("docs.")) return 0.80;
    // api.* subdomains
    if (hostname.startsWith("api.")) return 0.75;
    // Check if any known domain is a suffix
    for (const [domain, score] of Object.entries(DOMAIN_AUTHORITY)) {
      if (hostname.endsWith(`.${domain}`)) return score * 0.9;
    }
    return undefined;
  }

  /** Freshness: inverse age from publishedDate. */
  private scoreFreshness(publishedDate?: string): number {
    if (!publishedDate) return 13; // neutral for unknown

    try {
      const date = new Date(publishedDate);
      const ageMs = Math.max(0, this.nowFn() - date.getTime());
      const ageDays = ageMs / (86_400_000);

      if (ageDays < 7) return 25;
      if (ageDays < 30) return 22;
      if (ageDays < 90) return 18;
      if (ageDays < 365) return 14;
      if (ageDays < 730) return 8;
      return 4;
    } catch {
      return 13;
    }
  }

  /** Relevance: snippet quality heuristics. */
  private scoreRelevance(result: SearchResult): number {
    const text = result.snippet || "";
    let points = 0;

    // Snippet length
    if (text.length > 300) points += 8;
    else if (text.length > 150) points += 6;
    else if (text.length > 50) points += 3;
    else points += 1;

    // Contains code indicators
    if (/```|`[^`]+`|function\s|class\s|const\s|import\s|def\s|fn\s/.test(text)) {
      points += 7;
    }

    // Contains structured content
    if (/\d+\.\s|\n-\s|\n\*\s/.test(text)) points += 4;

    // Word count indicates depth
    const wordCount = text.split(/\s+/).length;
    if (wordCount > 30) points += 4;
    else if (wordCount > 15) points += 2;

    // Title relevance (non-empty, meaningful title)
    if (result.title && result.title.length > 10) points += 2;

    return Math.min(points, 25);
  }

  /** Citation density: references, links, structured data in snippet. */
  private scoreCitationDensity(snippet: string): number {
    if (!snippet) return 0;
    let points = 0;

    // Count URL references
    const urlCount = (snippet.match(/https?:\/\/\S+/g) ?? []).length;
    points += Math.min(urlCount * 3, 9);

    // Code blocks
    const codeBlockCount = (snippet.match(/```/g) ?? []).length / 2;
    points += Math.min(Math.floor(codeBlockCount) * 3, 6);

    // Numbered lists (citations)
    const listItems = (snippet.match(/^\s*\d+\.\s/gm) ?? []).length;
    points += Math.min(listItems * 2, 6);

    // Inline code references
    const inlineCode = (snippet.match(/`[^`]+`/g) ?? []).length;
    points += Math.min(inlineCode, 4);

    return Math.min(points, 25);
  }
}
