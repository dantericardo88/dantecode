// ============================================================================
// @dantecode/core — Semantic Search Reranker
// Reranks search results by relevance using token-based similarity with
// context-aware boosting. Uses existing Jaccard infrastructure from
// approach-memory.ts with upgrade path to embeddings.
// ============================================================================

import type { SearchResult } from "./search-providers.js";
import { tokenize, jaccardSimilarity } from "./approach-memory.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Reranking context for context-aware boosting. */
export interface RerankContext {
  /** The original search query. */
  query: string;
  /** Additional context from the agent's current task. */
  taskDescription?: string;
  /** Recently accessed file paths (for relevance boosting). */
  activeFiles?: string[];
  /** Technology stack keywords for domain boosting. */
  techStack?: string[];
}

/** A search result with reranking score. */
export interface RankedSearchResult extends SearchResult {
  /** Composite reranking score (0–1). */
  rerankScore: number;
  /** Breakdown of scoring factors. */
  scoreFactors: {
    queryRelevance: number;
    contextRelevance: number;
    snippetQuality: number;
    domainAuthority: number;
    recency: number;
  };
}

/** Options for the reranker. */
export interface RerankOptions {
  /** Weight for query relevance (default: 0.4). */
  queryWeight?: number;
  /** Weight for context relevance (default: 0.25). */
  contextWeight?: number;
  /** Weight for snippet quality (default: 0.15). */
  snippetWeight?: number;
  /** Weight for domain authority (default: 0.1). */
  domainWeight?: number;
  /** Weight for recency (default: 0.1). */
  recencyWeight?: number;
  /** Minimum score threshold to keep (default: 0.05). */
  minScore?: number;
}

// ----------------------------------------------------------------------------
// Domain Authority
// ----------------------------------------------------------------------------

/** Known high-authority domains for technical content. */
const AUTHORITY_DOMAINS: Record<string, number> = {
  "github.com": 0.95,
  "stackoverflow.com": 0.9,
  "developer.mozilla.org": 0.95,
  "docs.python.org": 0.9,
  "docs.microsoft.com": 0.85,
  "learn.microsoft.com": 0.85,
  "nodejs.org": 0.9,
  "typescriptlang.org": 0.9,
  "react.dev": 0.9,
  "nextjs.org": 0.85,
  "vercel.com": 0.8,
  "npmjs.com": 0.85,
  "pypi.org": 0.8,
  "crates.io": 0.8,
  "pkg.go.dev": 0.85,
  "docs.rs": 0.85,
  "arxiv.org": 0.8,
  "en.wikipedia.org": 0.75,
  "medium.com": 0.5,
  "dev.to": 0.55,
  "hackernews.com": 0.6,
};

// ----------------------------------------------------------------------------
// Reranker
// ----------------------------------------------------------------------------

/**
 * Rerank search results using multi-factor scoring:
 * 1. Query relevance (Jaccard similarity)
 * 2. Context relevance (task description + active files)
 * 3. Snippet quality (length, code presence)
 * 4. Domain authority (known high-quality sources)
 * 5. Recency (published date if available)
 */
export function rerankResults(
  results: SearchResult[],
  context: RerankContext,
  options: RerankOptions = {},
): RankedSearchResult[] {
  const weights = {
    query: options.queryWeight ?? 0.4,
    context: options.contextWeight ?? 0.25,
    snippet: options.snippetWeight ?? 0.15,
    domain: options.domainWeight ?? 0.1,
    recency: options.recencyWeight ?? 0.1,
  };
  const minScore = options.minScore ?? 0.05;

  const queryTokens = tokenize(context.query);
  const contextTokens = context.taskDescription
    ? tokenize(context.taskDescription)
    : new Set<string>();

  // Add tech stack tokens to context
  if (context.techStack) {
    for (const tech of context.techStack) {
      for (const t of tokenize(tech)) {
        contextTokens.add(t);
      }
    }
  }

  // Add active file extensions/names to context
  if (context.activeFiles) {
    for (const file of context.activeFiles) {
      const parts = file.split(/[/\\]/);
      const filename = parts[parts.length - 1] ?? "";
      const ext = filename.split(".").pop() ?? "";
      if (ext.length > 1) contextTokens.add(ext.toLowerCase());
    }
  }

  const ranked: RankedSearchResult[] = results.map((result) => {
    const resultTokens = tokenize(`${result.title} ${result.snippet}`);

    // Factor 1: Query relevance
    const queryRelevance = jaccardSimilarity(queryTokens, resultTokens);

    // Factor 2: Context relevance
    const contextRelevance =
      contextTokens.size > 0 ? jaccardSimilarity(contextTokens, resultTokens) : 0.5; // neutral if no context

    // Factor 3: Snippet quality
    const snippetQuality = scoreSnippetQuality(result.snippet);

    // Factor 4: Domain authority
    const domainAuthority = scoreDomainAuthority(result.url);

    // Factor 5: Recency
    const recency = scoreRecency(result.publishedDate);

    const rerankScore =
      queryRelevance * weights.query +
      contextRelevance * weights.context +
      snippetQuality * weights.snippet +
      domainAuthority * weights.domain +
      recency * weights.recency;

    return {
      ...result,
      rerankScore,
      scoreFactors: {
        queryRelevance,
        contextRelevance,
        snippetQuality,
        domainAuthority,
        recency,
      },
    };
  });

  // Sort by rerank score descending, filter by min threshold
  return ranked
    .filter((r) => r.rerankScore >= minScore)
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// ----------------------------------------------------------------------------
// Scoring Helpers
// ----------------------------------------------------------------------------

/** Score snippet quality (0–1). */
function scoreSnippetQuality(snippet: string): number {
  if (!snippet) return 0;

  let score = 0;

  // Length score
  if (snippet.length > 200) score += 0.4;
  else if (snippet.length > 100) score += 0.3;
  else if (snippet.length > 50) score += 0.2;
  else score += 0.1;

  // Contains code indicators
  if (/```|`[^`]+`|function |class |const |import |def |fn /.test(snippet)) {
    score += 0.3;
  }

  // Contains structured content (lists, numbers)
  if (/\d+\.\s|\n-\s/.test(snippet)) {
    score += 0.15;
  }

  // Not just a title/navigation text
  if (snippet.split(/\s+/).length > 10) {
    score += 0.15;
  }

  return Math.min(score, 1);
}

/** Score domain authority (0–1). */
function scoreDomainAuthority(url: string): number {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return AUTHORITY_DOMAINS[hostname] ?? 0.5;
  } catch {
    return 0.3;
  }
}

/** Score recency based on published date (0–1). */
function scoreRecency(publishedDate?: string): number {
  if (!publishedDate) return 0.5; // neutral for unknown dates

  try {
    const date = new Date(publishedDate);
    const ageMs = Date.now() - date.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays < 7) return 1.0;
    if (ageDays < 30) return 0.9;
    if (ageDays < 90) return 0.8;
    if (ageDays < 365) return 0.6;
    if (ageDays < 730) return 0.4;
    return 0.2;
  } catch {
    return 0.5;
  }
}
