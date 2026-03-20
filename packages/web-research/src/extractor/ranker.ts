import type { SearchResult } from "../types.js";

/**
 * Ranks search results or content chunks by relevance to a query.
 */
export class RelevanceRanker {
  rank(results: SearchResult[], query: string): SearchResult[] {
    const queryTokens = this.tokenize(query);
    if (queryTokens.size === 0) return results;

    const scored = results.map(result => {
      const text = `${result.title} ${result.snippet}`.toLowerCase();
      let matches = 0;
      for (const token of queryTokens) {
        if (text.includes(token)) matches++;
      }
      
      const score = matches / queryTokens.size;
      return { result, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .map(s => s.result);
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text.toLowerCase()
        .split(/\W+/)
        .filter(t => t.length > 2)
    );
  }
}
