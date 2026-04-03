// ============================================================================
// @dantecode/core — Search Result Synthesizer with Citations
// Generates concise summaries with inline citations [1][2] from search results.
// Harvested from Qwen Code CLI's always-cited pattern (Apache 2.0).
// ============================================================================

import type { SearchResult } from "./search-providers.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A citation reference. */
export interface Citation {
  /** Citation number (1-indexed). */
  index: number;
  /** Source URL. */
  url: string;
  /** Source title. */
  title: string;
  /** Brief snippet used from this source. */
  snippet: string;
}

/** Result of synthesizing search results. */
export interface SynthesizedResult {
  /** LLM-ready summary with inline [N] citations. */
  summary: string;
  /** Ordered citation list. */
  citations: Citation[];
  /** Confidence score (0–1) based on result quality. */
  confidence: number;
  /** Raw results for agent memory. */
  rawResults: SearchResult[];
  /** The query that produced these results. */
  query: string;
}

/** Options for the synthesizer. */
export interface SynthesizerOptions {
  /** Maximum summary paragraphs (default: 3). */
  maxParagraphs?: number;
  /** Maximum citations to include (default: 10). */
  maxCitations?: number;
  /** Include raw content in synthesis if available (default: true). */
  useRawContent?: boolean;
}

// ----------------------------------------------------------------------------
// Synthesizer
// ----------------------------------------------------------------------------

/**
 * Synthesizes search results into a concise summary with inline citations.
 * This is a deterministic, template-based synthesis (no LLM call required).
 * For LLM-powered synthesis, use buildSynthesisPrompt() and feed to the model.
 */
export function synthesizeResults(
  results: SearchResult[],
  query: string,
  options: SynthesizerOptions = {},
): SynthesizedResult {
  const maxCitations = options.maxCitations ?? 10;

  if (results.length === 0) {
    return {
      summary: `No results found for "${query}".`,
      citations: [],
      confidence: 0,
      rawResults: [],
      query,
    };
  }

  // Build citations from top results
  const citations: Citation[] = results.slice(0, maxCitations).map((r, i) => ({
    index: i + 1,
    url: r.url,
    title: r.title,
    snippet: r.snippet.slice(0, 200),
  }));

  // Build summary with inline citations
  const summaryParts: string[] = [];

  // Opening: direct answer from top results
  const topResults = results.slice(0, Math.min(5, results.length));
  for (const [i, result] of topResults.entries()) {
    if (result.snippet) {
      const snippet = cleanSnippet(result.snippet);
      if (snippet.length > 30) {
        summaryParts.push(`${snippet} [${i + 1}]`);
      }
    }
  }

  // If we have raw content, extract key points
  const rawContentResults = results.filter((r) => r.rawContent && options.useRawContent !== false);
  if (rawContentResults.length > 0) {
    for (const result of rawContentResults.slice(0, 2)) {
      const keyPoints = extractKeyPoints(result.rawContent!, 3);
      if (keyPoints.length > 0) {
        const citationIdx = results.indexOf(result) + 1;
        summaryParts.push(keyPoints.map((p) => `- ${p} [${citationIdx}]`).join("\n"));
      }
    }
  }

  const summary =
    summaryParts.length > 0
      ? summaryParts.join("\n\n")
      : `Found ${results.length} results for "${query}". Top result: ${results[0]!.title} [1]`;

  // Calculate confidence based on result quality
  const confidence = calculateConfidence(results, query);

  return {
    summary,
    citations,
    confidence,
    rawResults: results,
    query,
  };
}

/**
 * Build an LLM synthesis prompt for richer summarization.
 * Feed this to the model as a system/user message pair.
 */
export function buildSynthesisPrompt(
  results: SearchResult[],
  query: string,
  maxCitations = 10,
): { system: string; user: string } {
  const truncatedResults = results.slice(0, maxCitations);

  const resultsBlock = truncatedResults
    .map((r, i) => {
      const parts = [`[${i + 1}] ${r.title}`, `URL: ${r.url}`];
      if (r.snippet) parts.push(`Content: ${r.snippet}`);
      if (r.rawContent) parts.push(`Full text: ${r.rawContent.slice(0, 2000)}`);
      return parts.join("\n");
    })
    .join("\n\n");

  return {
    system: `You are a research assistant. Synthesize search results into a concise, accurate summary.
Rules:
- Use inline citations like [1], [2] to reference sources
- Be factual — only state what the sources support
- Keep the summary to 1-3 paragraphs
- Start with the most important finding
- End with a citations list`,

    user: `Query: ${query}

Search Results:
${resultsBlock}

Provide a concise synthesis with inline citations.`,
  };
}

/**
 * Format citations as a reference block appended to the summary.
 */
export function formatCitationBlock(citations: Citation[]): string {
  if (citations.length === 0) return "";

  return (
    "\n\n---\nSources:\n" + citations.map((c) => `[${c.index}] ${c.title} — ${c.url}`).join("\n")
  );
}

/**
 * Format a complete synthesized result (summary + citations).
 */
export function formatSynthesizedResult(result: SynthesizedResult): string {
  return result.summary + formatCitationBlock(result.citations);
}

// ----------------------------------------------------------------------------
// Internal Helpers
// ----------------------------------------------------------------------------

/** Clean a search snippet for inclusion in synthesis. */
function cleanSnippet(snippet: string): string {
  return snippet
    .replace(/\s+/g, " ")
    .replace(/\.\.\./g, ".")
    .trim();
}

/** Extract key points from raw content text. */
function extractKeyPoints(text: string, maxPoints: number): string[] {
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 300);

  // Take first N substantive sentences as key points
  return sentences.slice(0, maxPoints);
}

/** Calculate confidence score based on result quality. */
function calculateConfidence(results: SearchResult[], query: string): number {
  if (results.length === 0) return 0;

  const queryTokens = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );

  // Factor 1: Result count
  const countScore = Math.min(results.length / 5, 1);

  // Factor 2: Relevance (query token matching)
  let relevantCount = 0;
  for (const r of results) {
    const text = `${r.title} ${r.snippet}`.toLowerCase();
    let matches = 0;
    for (const token of queryTokens) {
      if (text.includes(token)) matches++;
    }
    if (queryTokens.size > 0 && matches / queryTokens.size >= 0.3) {
      relevantCount++;
    }
  }
  const relevanceScore = relevantCount / results.length;

  // Factor 3: Provider relevance scores (if available)
  const providerScores = results
    .filter((r) => r.relevanceScore !== undefined)
    .map((r) => r.relevanceScore!);
  const avgProviderScore =
    providerScores.length > 0
      ? providerScores.reduce((a, b) => a + b, 0) / providerScores.length
      : 0.5;

  // Factor 4: Snippet substantiveness
  const substantive = results.filter((r) => r.snippet.length > 50).length;
  const snippetScore = substantive / results.length;

  return countScore * 0.2 + relevanceScore * 0.3 + avgProviderScore * 0.25 + snippetScore * 0.25;
}
