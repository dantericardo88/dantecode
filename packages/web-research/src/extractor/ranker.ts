import type { SearchResult } from "../types.js";

const AUTHORITY_TIERS: Record<string, number> = {
  // Tier 1: Official sources (10 points)
  "github.com": 10,
  "docs.github.com": 10,
  "developer.mozilla.org": 10,
  "nodejs.org": 10,
  "typescriptlang.org": 10,
  "reactjs.org": 10,
  "npmjs.com": 9,
  "docs.npmjs.com": 9,
  // Tier 2: Curated platforms (8 points)
  "stackoverflow.com": 8,
  "arxiv.org": 8,
  "jsr.io": 8,
  // Tier 3: Quality blogs/tutorials (5-6 points)
  "medium.com": 6,
  "dev.to": 5,
  "hashnode.dev": 5,
  "css-tricks.com": 6,
  "smashingmagazine.com": 6,
  // Tier 4: Forums (3 points)
  "reddit.com": 3,
  "news.ycombinator.com": 3,
  "quora.com": 2,
};

function getAuthorityScore(url: string, overrides?: Record<string, number>): number {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (overrides?.[hostname] !== undefined) return overrides[hostname];
    return AUTHORITY_TIERS[hostname] ?? 0;
  } catch {
    return 0;
  }
}

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

  rank(results: SearchResult[], query: string, opts?: { authorityOverrides?: Record<string, number> }): SearchResult[] {
    if (results.length === 0) return results;

    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return results;

    // Build document corpus from title + snippet fields
    const docs = results.map(r => this.tokenize(`${r.title} ${r.snippet}`));

    // Compute average document length
    const avgDocLen = docs.reduce((s, d) => s + d.length, 0) / docs.length;

    // Compute IDF for each query term over the corpus
    const idf = this.computeIdf(queryTerms, docs);

    // Score each document: BM25 relevance + authority bonus
    const scored = results.map((result, idx) => {
      const doc = docs[idx] ?? [];
      const bm25 = this.bm25Score(queryTerms, doc, avgDocLen, idf);
      const authority = getAuthorityScore(result.url, opts?.authorityOverrides) * 0.5;
      return { result, score: bm25 + authority };
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
