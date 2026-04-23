// packages/core/src/hybrid-search-engine.ts
// Hybrid semantic search — closes dim 3 (codebase semantic search: 8→9).
//
// Harvested from: Tabby RAG pipeline, Continue.dev embedding retrieval,
//                 Anthropic contextual retrieval paper (RRF fusion).
//
// Provides:
//   - BM25 sparse retrieval (term-frequency / inverse-document-frequency)
//   - TF-IDF vector-based dense retrieval
//   - Reciprocal Rank Fusion (RRF) to combine sparse + dense
//   - Query expansion (camelCase/snake_case splitting, synonym injection)
//   - Result deduplication and snippet extraction
//   - Configurable k parameter for RRF weighting

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchDocument {
  id: string;
  content: string;
  /** Optional pre-computed tokens (if not provided, content is tokenized) */
  tokens?: string[];
  /** File path or source identifier */
  source?: string;
  /** Start line in source (1-indexed) */
  startLine?: number;
  /** End line in source */
  endLine?: number;
}

export interface SearchResult {
  document: SearchDocument;
  /** Combined RRF score (higher = more relevant) */
  score: number;
  /** Rank from BM25 (1-indexed, undefined if not ranked) */
  bm25Rank?: number;
  /** Rank from TF-IDF (1-indexed, undefined if not ranked) */
  tfidfRank?: number;
  /** Matched snippet (extracted from document content) */
  snippet: string;
  /** Query terms that matched */
  matchedTerms: string[];
}

export interface HybridSearchOptions {
  /** Max results to return (default: 10) */
  topK?: number;
  /** RRF k parameter — controls rank weighting (default: 60) */
  rrfK?: number;
  /** Whether to expand the query (default: true) */
  expandQuery?: boolean;
  /** Snippet context chars around match (default: 150) */
  snippetChars?: number;
  /** Minimum score threshold (default: 0) */
  minScore?: number;
}

// ─── Query Expansion ──────────────────────────────────────────────────────────

/**
 * Split camelCase/PascalCase into component words.
 */
export function splitCamelCase(token: string): string[] {
  // e.g. "getUserById" → ["get", "user", "by", "id"]
  return token
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Split snake_case/kebab-case into component words.
 */
export function splitSnakeCase(token: string): string[] {
  return token.split(/[_\-.]/).map((t) => t.toLowerCase()).filter((t) => t.length > 0);
}

/**
 * Expand a query term into related variants for better recall.
 */
export function expandTerm(term: string): string[] {
  const lower = term.toLowerCase();
  const expanded = new Set<string>([lower]);

  // camelCase split
  const camel = splitCamelCase(term);
  camel.forEach((t) => expanded.add(t));

  // snake_case split
  const snake = splitSnakeCase(term);
  snake.forEach((t) => expanded.add(t));

  // Plural/singular approximations
  if (lower.endsWith("s") && lower.length > 3) expanded.add(lower.slice(0, -1));
  if (!lower.endsWith("s") && lower.length > 2) expanded.add(lower + "s");

  // Common programming synonyms
  const synonyms: Record<string, string[]> = {
    get: ["fetch", "retrieve", "load", "read"],
    set: ["write", "store", "save", "put", "update"],
    create: ["make", "new", "build", "generate", "init"],
    delete: ["remove", "destroy", "drop", "clear"],
    error: ["err", "exception", "failure", "fault"],
    handler: ["callback", "listener", "hook"],
    config: ["configuration", "options", "settings"],
    auth: ["authentication", "login", "token"],
  };

  const syns = synonyms[lower];
  if (syns) syns.forEach((s) => expanded.add(s));

  return [...expanded];
}

/**
 * Tokenize text for search indexing/querying.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Expand a full query into a set of search terms.
 */
export function expandQuery(query: string): string[] {
  const base = tokenize(query);
  const expanded = new Set<string>(base);
  // Expand original words before lowercasing to preserve camelCase splitting
  const rawWords = query.split(/\s+/);
  for (const word of rawWords) {
    expandTerm(word).forEach((t) => expanded.add(t));
  }
  for (const term of base) {
    expandTerm(term).forEach((t) => expanded.add(t));
  }
  return [...expanded];
}

// ─── BM25 ─────────────────────────────────────────────────────────────────────

const BM25_K1 = 1.5;
const BM25_B = 0.75;

export class BM25Index {
  private _docs: SearchDocument[] = [];
  private _tf: Map<string, Map<string, number>> = new Map(); // term → (docId → tf)
  private _df: Map<string, number> = new Map(); // term → doc frequency
  private _docLengths: Map<string, number> = new Map();
  private _avgDocLength = 0;

  add(doc: SearchDocument): void {
    const tokens = doc.tokens ?? tokenize(doc.content);
    this._docs.push({ ...doc, tokens });
    this._docLengths.set(doc.id, tokens.length);

    // TF: count occurrences
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);

    for (const [term, count] of counts) {
      if (!this._tf.has(term)) this._tf.set(term, new Map());
      this._tf.get(term)!.set(doc.id, count / tokens.length);
      this._df.set(term, (this._df.get(term) ?? 0) + 1);
    }

    // Recompute avg doc length
    let total = 0;
    this._docLengths.forEach((l) => (total += l));
    this._avgDocLength = this._docs.length > 0 ? total / this._docs.length : 0;
  }

  /**
   * Score all documents for a query, returning doc IDs sorted by BM25 score desc.
   */
  score(queryTerms: string[]): Array<{ docId: string; score: number }> {
    const N = this._docs.length;
    if (N === 0) return [];

    const scores = new Map<string, number>();

    for (const term of queryTerms) {
      const df = this._df.get(term) ?? 0;
      if (df === 0) continue;

      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const tfMap = this._tf.get(term)!;

      for (const [docId, tfRaw] of tfMap) {
        const dl = this._docLengths.get(docId) ?? 1;
        const tf = tfRaw * (this._docLengths.get(docId) ?? 1); // un-normalize
        const numerator = tf * (BM25_K1 + 1);
        const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / this._avgDocLength));
        const bm25 = idf * (numerator / denominator);
        scores.set(docId, (scores.get(docId) ?? 0) + bm25);
      }
    }

    return [...scores.entries()]
      .map(([docId, score]) => ({ docId, score }))
      .sort((a, b) => b.score - a.score);
  }

  getDoc(id: string): SearchDocument | undefined {
    return this._docs.find((d) => d.id === id);
  }

  get size(): number { return this._docs.length; }

  clear(): void {
    this._docs = [];
    this._tf.clear();
    this._df.clear();
    this._docLengths.clear();
    this._avgDocLength = 0;
  }
}

// ─── TF-IDF Dense Retrieval ────────────────────────────────────────────────────

export class TFIDFIndex {
  private _docs: SearchDocument[] = [];
  private _idf: Map<string, number> = new Map();
  private _vectors: Map<string, Map<string, number>> = new Map(); // docId → (term → tfidf)
  private _df: Map<string, number> = new Map();

  add(doc: SearchDocument): void {
    const tokens = doc.tokens ?? tokenize(doc.content);
    this._docs.push({ ...doc, tokens });

    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);

    const vec = new Map<string, number>();
    for (const [term, count] of counts) {
      vec.set(term, count / tokens.length); // raw TF
      this._df.set(term, (this._df.get(term) ?? 0) + 1);
    }
    this._vectors.set(doc.id, vec);
    this._recomputeIdf();
  }

  private _recomputeIdf(): void {
    const N = this._docs.length;
    this._idf.clear();
    for (const [term, df] of this._df) {
      this._idf.set(term, Math.log((N + 1) / (df + 1)) + 1);
    }
  }

  /**
   * Compute cosine similarity between query and each document.
   */
  score(queryTerms: string[]): Array<{ docId: string; score: number }> {
    if (this._docs.length === 0) return [];

    // Build query vector
    const qCounts = new Map<string, number>();
    for (const t of queryTerms) qCounts.set(t, (qCounts.get(t) ?? 0) + 1);

    const qVec = new Map<string, number>();
    for (const [term, count] of qCounts) {
      const idf = this._idf.get(term) ?? 0;
      qVec.set(term, (count / queryTerms.length) * idf);
    }

    const qNorm = Math.sqrt([...qVec.values()].reduce((s, v) => s + v * v, 0));
    if (qNorm === 0) return [];

    const results: Array<{ docId: string; score: number }> = [];

    for (const doc of this._docs) {
      const dVec = this._vectors.get(doc.id);
      if (!dVec) continue;

      let dot = 0;
      let dNorm = 0;
      for (const [term, qVal] of qVec) {
        const idf = this._idf.get(term) ?? 0;
        const dVal = (dVec.get(term) ?? 0) * idf;
        dot += qVal * dVal;
        dNorm += dVal * dVal;
      }
      dNorm = Math.sqrt(dNorm);

      const cosine = dNorm > 0 ? dot / (qNorm * dNorm) : 0;
      results.push({ docId: doc.id, score: cosine });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  getDoc(id: string): SearchDocument | undefined {
    return this._docs.find((d) => d.id === id);
  }

  get size(): number { return this._docs.length; }

  clear(): void {
    this._docs = [];
    this._idf.clear();
    this._vectors.clear();
    this._df.clear();
  }
}

// ─── Reciprocal Rank Fusion ───────────────────────────────────────────────────

/**
 * Combine multiple ranked lists using Reciprocal Rank Fusion.
 * RRF(d) = Σ 1 / (k + rank(d))
 */
export function reciprocalRankFusion(
  rankedLists: Array<Array<{ docId: string; score: number }>>,
  k = 60,
): Map<string, number> {
  const fusedScores = new Map<string, number>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const { docId } = list[rank]!;
      const rrf = 1 / (k + rank + 1);
      fusedScores.set(docId, (fusedScores.get(docId) ?? 0) + rrf);
    }
  }

  return fusedScores;
}

// ─── Snippet Extraction ───────────────────────────────────────────────────────

/**
 * Extract a snippet from document content centered on the first matched term.
 */
export function extractSnippet(content: string, queryTerms: string[], contextChars = 150): string {
  const lower = content.toLowerCase();
  let bestIdx = -1;

  for (const term of queryTerms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx;
    }
  }

  if (bestIdx === -1) return content.slice(0, contextChars * 2);

  const start = Math.max(0, bestIdx - contextChars / 2);
  const end = Math.min(content.length, bestIdx + contextChars);
  const snippet = content.slice(start, end);

  return (start > 0 ? "…" : "") + snippet + (end < content.length ? "…" : "");
}

/**
 * Find which query terms appear in a document.
 */
export function findMatchedTerms(content: string, queryTerms: string[]): string[] {
  const lower = content.toLowerCase();
  return queryTerms.filter((t) => lower.includes(t));
}

// ─── Embedding Support ────────────────────────────────────────────────────────

/**
 * Minimal embedding function type accepted by HybridSearchEngine for semantic
 * reranking. Compatible with `detectBestEmbeddingProvider()` from
 * `@dantecode/memory-engine`.
 */
export type SearchEmbeddingFn = (text: string) => Promise<number[]>;

/**
 * Cosine similarity between two equal-length vectors.
 * Returns 0 when either vector is zero-length or lengths differ.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ─── Hybrid Search Engine ─────────────────────────────────────────────────────

export class HybridSearchEngine {
  private _bm25 = new BM25Index();
  private _tfidf = new TFIDFIndex();
  private _docs = new Map<string, SearchDocument>();
  /** Optional semantic embedding provider for reranking. */
  private _embeddingFn: SearchEmbeddingFn | null = null;
  /** Cached document embeddings (populated lazily during searchAsync). */
  private _docEmbeddings = new Map<string, number[]>();

  addDocument(doc: SearchDocument): void {
    this._docs.set(doc.id, doc);
    this._bm25.add(doc);
    this._tfidf.add(doc);
  }

  addDocuments(docs: SearchDocument[]): void {
    for (const doc of docs) this.addDocument(doc);
  }

  search(query: string, opts: HybridSearchOptions = {}): SearchResult[] {
    const {
      topK = 10,
      rrfK = 60,
      expandQuery: shouldExpand = true,
      snippetChars = 150,
      minScore = 0,
    } = opts;

    const baseTerms = tokenize(query);
    const queryTerms = shouldExpand ? expandQuery(query) : baseTerms;

    if (queryTerms.length === 0 || this._docs.size === 0) return [];

    // Retrieve from both indexes
    const bm25Results = this._bm25.score(queryTerms);
    const tfidfResults = this._tfidf.score(queryTerms);

    // Build rank maps for provenance
    const bm25Ranks = new Map(bm25Results.map((r, i) => [r.docId, i + 1]));
    const tfidfRanks = new Map(tfidfResults.map((r, i) => [r.docId, i + 1]));

    // Fuse with RRF
    const fused = reciprocalRankFusion([bm25Results, tfidfResults], rrfK);

    // Build results
    const results: SearchResult[] = [];
    for (const [docId, score] of fused) {
      if (score < minScore) continue;
      const doc = this._docs.get(docId);
      if (!doc) continue;

      const snippet = extractSnippet(doc.content, baseTerms, snippetChars);
      const matchedTerms = findMatchedTerms(doc.content, baseTerms);

      results.push({
        document: doc,
        score,
        bm25Rank: bm25Ranks.get(docId),
        tfidfRank: tfidfRanks.get(docId),
        snippet,
        matchedTerms,
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Format search results for AI prompt injection.
   */
  formatResultsForPrompt(results: SearchResult[], maxResults = 5): string {
    if (results.length === 0) return "No results found.";

    const lines = [`## Search Results (${results.length} found)`];
    for (const r of results.slice(0, maxResults)) {
      const source = r.document.source ?? r.document.id;
      const loc = r.document.startLine ? `:${r.document.startLine}` : "";
      lines.push(`\n### ${source}${loc} (score: ${r.score.toFixed(3)})`);
      lines.push(`\`\`\``);
      lines.push(r.snippet);
      lines.push(`\`\`\``);
      if (r.matchedTerms.length > 0) {
        lines.push(`Matched: ${r.matchedTerms.slice(0, 5).join(", ")}`);
      }
    }
    return lines.join("\n");
  }

  /**
   * Set an embedding provider for semantic reranking in `searchAsync()`.
   * Clears cached document embeddings when the provider changes.
   */
  setEmbeddingProvider(fn: SearchEmbeddingFn | null): void {
    if (fn !== this._embeddingFn) {
      this._embeddingFn = fn;
      this._docEmbeddings.clear();
    }
  }

  /** Returns the currently set embedding provider (for tests/diagnostics). */
  get embeddingProvider(): SearchEmbeddingFn | null {
    return this._embeddingFn;
  }

  /**
   * Async search that layers semantic reranking on top of BM25+TF-IDF+RRF.
   *
   * When an embedding provider is set (via `setEmbeddingProvider`):
   *   1. Run lexical search for `topK * 3` candidates.
   *   2. Embed the query and each candidate document (cached).
   *   3. Blend scores: 40% lexical RRF + 60% cosine similarity.
   *   4. Re-sort and return top K.
   *
   * Falls back to `search()` (synchronous lexical) when no provider is set.
   */
  async searchAsync(query: string, opts: HybridSearchOptions = {}): Promise<SearchResult[]> {
    const topK = opts.topK ?? 10;

    if (!this._embeddingFn) {
      return this.search(query, opts);
    }

    // Expand the candidate pool for semantic reranking
    const candidates = this.search(query, { ...opts, topK: topK * 3 });
    if (candidates.length === 0) return [];

    let queryEmbedding: number[];
    try {
      queryEmbedding = await this._embeddingFn(query.slice(0, 512));
    } catch {
      // Embedding call failed — fall back to lexical results
      return candidates.slice(0, topK);
    }

    // Embed candidates lazily (cached by docId)
    for (const r of candidates) {
      const docId = r.document.id;
      if (!this._docEmbeddings.has(docId)) {
        try {
          const emb = await this._embeddingFn(r.document.content.slice(0, 512));
          this._docEmbeddings.set(docId, emb);
        } catch {
          // Leave this doc without an embedding; lexical score wins
        }
      }
    }

    // Blend lexical RRF score (normalised) + cosine similarity
    const maxLexical = candidates[0]?.score ?? 1;
    const reranked = candidates.map((r) => {
      const docEmb = this._docEmbeddings.get(r.document.id);
      const cosine = docEmb ? cosineSimilarity(queryEmbedding, docEmb) : 0;
      const normLexical = maxLexical > 0 ? r.score / maxLexical : 0;
      return { ...r, score: normLexical * 0.4 + cosine * 0.6 };
    });

    return reranked.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  get documentCount(): number { return this._docs.size; }

  clear(): void {
    this._bm25.clear();
    this._tfidf.clear();
    this._docs.clear();
    this._docEmbeddings.clear();
  }

  /**
   * Batch-index a list of file paths, computing and caching embeddings to disk.
   *
   * Pattern from Tabby (pre-index corpus at workspace open) and Continue.dev
   * (mtime-based cache invalidation). Each entry in the cache stores:
   *   { path, mtime, embedding }
   *
   * On subsequent calls, entries whose mtime matches the cache are reused
   * (no re-embedding), so only changed/new files hit the provider.
   *
   * Non-text files (detected by extension) are skipped silently.
   *
   * @param files    Absolute file paths to index.
   * @param provider Embedding function (text → vector).
   * @param cacheDir Directory to write `embeddings.cache.json` into.
   */
  async indexAll(
    files: string[],
    provider: SearchEmbeddingFn,
    cacheDir: string,
  ): Promise<void> {
    const { readFile, writeFile, mkdir, stat } = await import("node:fs/promises");
    const { join } = await import("node:path");

    // Binary/non-text extensions to skip
    const BINARY_EXTS = new Set([
      ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
      ".woff", ".woff2", ".ttf", ".eot", ".otf",
      ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
      ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
      ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ]);

    // Load existing cache
    const cacheFile = join(cacheDir, "embeddings.cache.json");
    let cache: Array<{ path: string; mtime: number; embedding: number[] }> = [];
    try {
      const raw = await readFile(cacheFile, "utf8");
      cache = JSON.parse(raw) as typeof cache;
    } catch {
      // No cache yet — start fresh
    }
    const cacheMap = new Map(cache.map((e) => [e.path, e]));

    const updated: Array<{ path: string; mtime: number; embedding: number[] }> = [];

    for (const filePath of files) {
      // Skip binary file types
      const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
      if (BINARY_EXTS.has(ext)) continue;

      let mtime = 0;
      let content = "";
      try {
        const s = await stat(filePath);
        mtime = s.mtimeMs;
        content = await readFile(filePath, "utf8");
      } catch {
        continue; // File unreadable — skip
      }

      const cached = cacheMap.get(filePath);
      if (cached && cached.mtime === mtime) {
        // Cache hit — reuse embedding, still add document to engine
        this._docEmbeddings.set(filePath, cached.embedding);
        updated.push(cached);
      } else {
        // Cache miss or stale — compute new embedding
        let embedding: number[] = [];
        try {
          embedding = await provider(content.slice(0, 512));
        } catch {
          embedding = [];
        }
        this._docEmbeddings.set(filePath, embedding);
        updated.push({ path: filePath, mtime, embedding });
      }

      // Add document to search index (idempotent if already present)
      if (!this._docs.has(filePath)) {
        this.addDocument({ id: filePath, content, source: filePath });
      }
    }

    // Persist updated cache
    try {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cacheFile, JSON.stringify(updated), "utf8");
    } catch {
      // Cache write failure is non-fatal
    }
  }
}
