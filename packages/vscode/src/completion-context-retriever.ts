// ============================================================================
// packages/vscode/src/completion-context-retriever.ts
//
// Lightweight BM25 (Okapi BM25) retrieval for FIM completion context.
// Operates on an injected chunk store so it has no hard dependency on
// CodebaseIndexManager — it degrades gracefully when the index is unavailable.
//
// Usage:
//   const retriever = new CompletionContextRetriever(() => indexManager.getChunks());
//   const snippets = await retriever.retrieve(last5Lines, 3, 400);
//   // → ["// --- src/auth/tokens.ts ---\nexport function ...", ...]
// ============================================================================

// ── BM25 constants ────────────────────────────────────────────────────────────
const K1 = 1.5; // term-frequency saturation
const B = 0.75; // length normalization

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CodeChunk {
  /** Absolute or workspace-relative path of the source file. */
  filePath: string;
  /** The chunk content (a contiguous block of source lines). */
  content: string;
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter((t) => t.length >= 2);
}

// ── BM25 implementation ───────────────────────────────────────────────────────

function termFreq(term: string, tokens: string[]): number {
  let count = 0;
  for (const t of tokens) {
    if (t === term) count++;
  }
  return count;
}

function idf(term: string, docs: string[][]): number {
  let docCount = 0;
  for (const doc of docs) {
    if (doc.includes(term)) docCount++;
  }
  const N = docs.length;
  return Math.log((N - docCount + 0.5) / (docCount + 0.5) + 1);
}

/**
 * Score a single document against query terms using Okapi BM25.
 */
export function bm25Score(
  queryTerms: string[],
  docTerms: string[],
  avgDocLen: number,
  allDocs: string[][],
): number {
  let score = 0;
  const dl = docTerms.length;
  for (const term of queryTerms) {
    const tf = termFreq(term, docTerms);
    if (tf === 0) continue;
    const idfVal = idf(term, allDocs);
    score += (idfVal * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * dl) / Math.max(avgDocLen, 1)));
  }
  return score;
}

// ── Cosine similarity + RRF merge ─────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function rrfMerge(
  lexical: Array<{ chunk: CodeChunk; score: number }>,
  semantic: Array<{ chunk: CodeChunk; score: number }>,
  k = 60,
): Array<{ chunk: CodeChunk; score: number }> {
  const merged = new Map<string, { chunk: CodeChunk; score: number }>();
  for (let i = 0; i < lexical.length; i++) {
    const { chunk } = lexical[i]!;
    const prev = merged.get(chunk.filePath)?.score ?? 0;
    merged.set(chunk.filePath, { chunk, score: prev + 1 / (k + i + 1) });
  }
  for (let i = 0; i < semantic.length; i++) {
    const { chunk } = semantic[i]!;
    const prev = merged.get(chunk.filePath)?.score ?? 0;
    merged.set(chunk.filePath, { chunk, score: prev + 1 / (k + i + 1) });
  }
  return [...merged.values()];
}

// ── CompletionContextRetriever ─────────────────────────────────────────────────

type EmbedFn = (text: string) => Promise<number[]>;

/**
 * BM25-based snippet retriever for FIM completion context, with optional
 * semantic reranking via an injected embedding provider.
 */
export class CompletionContextRetriever {
  private readonly _getChunks: () => CodeChunk[];
  private _warmedUp = false;
  private _embeddingProviderChecked = false;

  /** Embedding function detected at first retrieve() call. Null = lexical-only. */
  embeddingProvider: EmbedFn | null = null;

  /** True after warmup() has completed (or failed gracefully). */
  get warmedUp(): boolean {
    return this._warmedUp;
  }

  constructor(getChunks: () => CodeChunk[]) {
    this._getChunks = getChunks;
  }

  /**
   * Retrieve top-N relevant snippets for the given query lines.
   *
   * @param queryLines   Lines immediately before the cursor (e.g. last 5 lines)
   * @param maxSnippets  Maximum number of snippets to return (default 3)
   * @param tokenBudget  Approximate token budget for all snippets combined
   * @param timeoutMs    Hard cap on BM25 scoring time; also gates semantic reranking
   *                     (semantic path enabled when timeoutMs > 100)
   */
  async retrieve(
    queryLines: string[],
    maxSnippets = 3,
    tokenBudget = 400,
    timeoutMs = 50,
  ): Promise<string[]> {
    // Probe for embedding provider once on first call (before timer starts)
    if (!this._embeddingProviderChecked) {
      this._embeddingProviderChecked = true;
      try {
        const { detectBestEmbeddingProvider } = await import("@dantecode/memory-engine") as {
          detectBestEmbeddingProvider: () => Promise<EmbedFn | null>;
        };
        this.embeddingProvider = await detectBestEmbeddingProvider();
      } catch {
        this.embeddingProvider = null;
      }
    }

    const start = Date.now();
    try {
      const chunks = this._getChunks();
      if (chunks.length === 0) return [];

      const queryText = queryLines.join("\n");
      const queryTerms = tokenize(queryText);
      if (queryTerms.length === 0) return [];

      // Tokenize all docs upfront (needed for IDF)
      const allDocs = chunks.map((c) => tokenize(c.content));
      const avgDocLen = allDocs.reduce((s, d) => s + d.length, 0) / allDocs.length;

      // BM25 scoring — bail early if timeout exceeded
      const scored: Array<{ chunk: CodeChunk; score: number }> = [];
      for (let i = 0; i < chunks.length; i++) {
        if (Date.now() - start > timeoutMs) return [];
        const score = bm25Score(queryTerms, allDocs[i]!, avgDocLen, allDocs);
        scored.push({ chunk: chunks[i]!, score: score > 0 ? score : 0 });
      }

      // Semantic reranking via RRF when provider is available and budget allows
      if (this.embeddingProvider !== null && timeoutMs > 100) {
        try {
          const queryVec = await this.embeddingProvider(queryText);
          if (queryVec.length > 0) {
            const semScored: Array<{ chunk: CodeChunk; score: number }> = [];
            for (const chunk of chunks) {
              const docVec = await this.embeddingProvider(chunk.content.slice(0, 500));
              semScored.push({ chunk, score: cosineSimilarity(queryVec, docVec) });
            }
            semScored.sort((a, b) => b.score - a.score);
            scored.sort((a, b) => b.score - a.score);
            const merged = rrfMerge(scored, semScored);
            scored.length = 0;
            scored.push(...merged);
          }
        } catch {
          // Semantic path failed — fall back to BM25 order already in scored[]
        }
      }

      // Sort descending by score
      scored.sort((a, b) => b.score - a.score);

      // Format top-N snippets within token budget
      const charBudget = tokenBudget * 3.5;
      const results: string[] = [];
      let usedChars = 0;

      for (const { chunk } of scored) {
        if (results.length >= maxSnippets) break;
        const shortPath = chunk.filePath.replace(/\\/g, "/").split("/").slice(-2).join("/");
        const header = `// --- ${shortPath} ---`;
        const lines = chunk.content
          .split("\n")
          .slice(0, 15)
          .filter((l) => l.trim().length > 0)
          .map((l) => `// ${l}`)
          .join("\n");
        const snippet = `${header}\n${lines}`;
        if (usedChars + snippet.length > charBudget) break;
        results.push(snippet);
        usedChars += snippet.length;
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Pre-embed the current corpus for semantic retrieval.
   * Called once after indexing completes. No-op if chunks are not yet available.
   */
  async warmup(_projectRoot: string): Promise<void> {
    try {
      const chunks = this._getChunks();
      const { detectBestEmbeddingProvider } = await import("@dantecode/memory-engine" as string) as {
        detectBestEmbeddingProvider: () => Promise<unknown>;
      };
      const embeddingProvider = await detectBestEmbeddingProvider();
      if (chunks.length > 0) {
        const { HybridSearchEngine } = await import("@dantecode/core") as {
          HybridSearchEngine: new () => { setEmbeddingProvider(p: unknown): void; indexAll(): Promise<void>; addDocument(id: string, text: string): void };
        };
        const engine = new HybridSearchEngine();
        engine.setEmbeddingProvider(embeddingProvider);
        for (const chunk of chunks) {
          engine.addDocument(chunk.filePath, chunk.content);
        }
        await engine.indexAll();
      }
    } catch {
      // Non-fatal — warmup is best-effort
    } finally {
      this._warmedUp = true;
    }
  }
}
