// ============================================================================
// packages/codebase-index/src/bm25-index.ts
//
// BM25 search index backed by MiniSearch.
// Plugs in as the 3rd RRF source alongside TF-IDF and vector search.
//
// Document schema:
//   id:      "${filePath}:${startLine ?? 0}"
//   content: chunk content (weight 1)
//   symbols: space-joined symbols (weight 2)
//   filePath, startLine, endLine stored for result mapping
// ============================================================================

import MiniSearch from "minisearch";
import type { IndexChunk, RankedChunk } from "./types.js";

interface BM25Document {
  id: string;
  content: string;
  symbols: string;
  filePath: string;
  startLine: number;
  endLine: number;
  chunkContent: string;
  chunkSymbols: string[];
}

export class BM25Index {
  private _ms: MiniSearch<BM25Document>;
  /** Map from doc id → stored chunk fields (for result hydration) */
  private _stored = new Map<string, Pick<BM25Document, "filePath" | "startLine" | "endLine" | "chunkContent" | "chunkSymbols">>();

  constructor() {
    this._ms = new MiniSearch<BM25Document>({
      fields: ["content", "symbols"],
      storeFields: [],
      searchOptions: {
        boost: { symbols: 2 },
        fuzzy: 0.15,
        prefix: true,
      },
      idField: "id",
    });
  }

  /** Add a chunk to the index. Idempotent — replaces if same id already exists. */
  add(chunk: IndexChunk): void {
    const id = `${chunk.filePath}:${chunk.startLine ?? 0}`;
    if (this._ms.has(id)) {
      this._ms.discard(id);
      this._stored.delete(id);
    }
    const doc: BM25Document = {
      id,
      content: chunk.content,
      symbols: (chunk.symbols ?? []).join(" "),
      filePath: chunk.filePath,
      startLine: chunk.startLine ?? 0,
      endLine: chunk.endLine ?? 0,
      chunkContent: chunk.content,
      chunkSymbols: chunk.symbols ?? [],
    };
    this._ms.add(doc);
    this._stored.set(id, {
      filePath: doc.filePath,
      startLine: doc.startLine,
      endLine: doc.endLine,
      chunkContent: doc.chunkContent,
      chunkSymbols: doc.chunkSymbols,
    });
  }

  /** Remove all chunks for a given file path. */
  removeFile(filePath: string): void {
    for (const [id, stored] of this._stored) {
      if (stored.filePath === filePath) {
        if (this._ms.has(id)) {
          this._ms.discard(id);
        }
        this._stored.delete(id);
      }
    }
  }

  /**
   * BM25 search. Returns up to `limit` chunks ranked by relevance.
   * Returns [] on empty query or empty index.
   */
  search(query: string, limit = 20): RankedChunk[] {
    if (!query.trim() || this._stored.size === 0) return [];

    const results = this._ms.search(query).slice(0, limit);
    const ranked: RankedChunk[] = [];

    for (const result of results) {
      const stored = this._stored.get(result.id as string);
      if (!stored) continue;
      ranked.push({
        key: result.id as string,
        chunk: {
          filePath: stored.filePath,
          startLine: stored.startLine,
          endLine: stored.endLine,
          content: stored.chunkContent,
          symbols: stored.chunkSymbols,
        },
      });
    }

    return ranked;
  }

  /** Clear all indexed documents. */
  clear(): void {
    this._ms.removeAll();
    this._stored.clear();
  }

  /** Number of indexed documents. */
  get size(): number {
    return this._stored.size;
  }
}
