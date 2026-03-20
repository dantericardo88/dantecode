import type { SearchResult } from "../types.js";

/**
 * BM25-based relevance ranker for search results.
 *
 * BM25 is the gold standard for term-frequency-based ranking (used in Elasticsearch,
 * Crawl4AI relevance pipeline, and most production search systems).
 *
 * Parameters follow Lucene defaults: k1=1.5, b=0.75
 */
export class RelevanceRanker {
  private readonly k1: number;
  private readonly b: number;

  constructor({ k1 = 1.5, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
  }

  rank(results: SearchResult[], query: string): SearchResult[] {
    if (results.length === 0) return results;

    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return results;

    // Build document corpus from title + snippet fields
    const docs = results.map(r => this.tokenize(`${r.title} ${r.snippet}`));

    // Compute average document length
    const avgDocLen = docs.reduce((s, d) => s + d.length, 0) / docs.length;

    // Compute IDF for each query term over the corpus
    const idf = this.computeIdf(queryTerms, docs);

    // Score each document
    const scored = results.map((result, idx) => {
      const doc = docs[idx] ?? [];
      const score = this.bm25Score(queryTerms, doc, avgDocLen, idf);
      return { result, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .map(s => s.result);
  }

  private bm25Score(
    queryTerms: string[],
    doc: string[],
    avgDocLen: number,
    idf: Map<string, number>
  ): number {
    const docLen = doc.length;
    const termFreq = new Map<string, number>();
    for (const t of doc) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const tf = termFreq.get(term) ?? 0;
      if (tf === 0) continue;
      const idfVal = idf.get(term) ?? 0;
      const numerator = tf * (this.k1 + 1);
      const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / avgDocLen));
      score += idfVal * (numerator / denominator);
    }
    return score;
  }

  private computeIdf(queryTerms: string[], docs: string[][]): Map<string, number> {
    const N = docs.length;
    const idf = new Map<string, number>();

    for (const term of queryTerms) {
      const df = docs.filter(doc => doc.includes(term)).length;
      // Robertson-Spärck Jones IDF with +1 smoothing
      idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
    }

    return idf;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\W+/)
      .filter(t => t.length > 2);
  }
}
