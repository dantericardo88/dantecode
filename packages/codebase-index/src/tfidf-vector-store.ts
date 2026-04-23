// ============================================================================
// packages/codebase-index/src/tfidf-vector-store.ts
//
// TF-IDF vector store: represents each chunk as a Float32Array in term-space.
// No external dependencies. Cosine similarity search over the full index.
// ============================================================================

import type { IndexChunk } from "./types.js";

// ── Tokenization ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "in", "of", "to", "and", "or", "for",
  "it", "this", "that", "with", "on", "at", "by", "as", "be",
  "are", "was", "were", "has", "have", "had", "not", "but", "from",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Entry {
  key: string;
  chunk: IndexChunk;
  termFreqs: Map<string, number>;
}

export interface TFIDFSearchResult {
  key: string;
  chunk: IndexChunk;
  score: number;
}

// ── TFIDFVectorStore ──────────────────────────────────────────────────────────

const MAX_VOCAB_SIZE = 10_000;
const MIN_DOC_FREQ_FOR_PRUNE = 2;

export class TFIDFVectorStore {
  private _entries: Entry[] = [];
  private _vocab = new Map<string, number>();
  private _docFreq = new Map<string, number>();
  private _vectors: Float32Array[] = [];
  private _dirty = true;

  get size(): number {
    return this._entries.length;
  }

  add(chunk: IndexChunk): void {
    const key = `${chunk.filePath}:${chunk.startLine ?? 0}`;
    // Idempotent: remove existing entry with same key
    const existing = this._entries.findIndex((e) => e.key === key);
    if (existing !== -1) {
      const old = this._entries[existing]!;
      for (const t of old.termFreqs.keys()) {
        const df = (this._docFreq.get(t) ?? 1) - 1;
        if (df <= 0) this._docFreq.delete(t);
        else this._docFreq.set(t, df);
      }
      this._entries.splice(existing, 1);
    }

    const symbolText = Array.isArray(chunk.symbols) ? chunk.symbols.join(" ") : "";
    const tokens = tokenize(chunk.content + " " + symbolText);
    const termFreqs = new Map<string, number>();
    for (const t of tokens) {
      termFreqs.set(t, (termFreqs.get(t) ?? 0) + 1);
    }
    for (const t of termFreqs.keys()) {
      if (!this._vocab.has(t)) this._vocab.set(t, this._vocab.size);
      this._docFreq.set(t, (this._docFreq.get(t) ?? 0) + 1);
    }
    this._entries.push({ key, chunk, termFreqs });
    this._dirty = true;

    // Prune vocab if it exceeds cap
    if (this._vocab.size > MAX_VOCAB_SIZE) {
      this._pruneVocab();
    }
  }

  removeFile(filePath: string): void {
    const before = this._entries.length;
    const removed = this._entries.filter((e) => e.chunk.filePath === filePath);
    if (removed.length === 0) return;

    for (const entry of removed) {
      for (const t of entry.termFreqs.keys()) {
        const df = (this._docFreq.get(t) ?? 1) - 1;
        if (df <= 0) this._docFreq.delete(t);
        else this._docFreq.set(t, df);
      }
    }
    this._entries = this._entries.filter((e) => e.chunk.filePath !== filePath);
    if (this._entries.length !== before) this._dirty = true;
  }

  clear(): void {
    this._entries = [];
    this._vocab.clear();
    this._docFreq.clear();
    this._vectors = [];
    this._dirty = true;
  }

  search(query: string, limit = 20): TFIDFSearchResult[] {
    if (this._entries.length === 0 || !query.trim()) return [];
    this._buildVectors();

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const vocabSize = this._vocab.size;
    const queryVec = new Float32Array(vocabSize);
    const queryTF = new Map<string, number>();
    for (const t of queryTokens) queryTF.set(t, (queryTF.get(t) ?? 0) + 1);

    const N = this._entries.length;
    for (const [term, tf] of queryTF) {
      const idx = this._vocab.get(term);
      if (idx === undefined) continue;
      const df = this._docFreq.get(term) ?? 0;
      const idf = df === 0 ? 0 : Math.log((N + 1) / (df + 1)) + 1;
      queryVec[idx] = (tf / queryTF.size) * idf;
    }

    const scored: Array<{ score: number; idx: number }> = [];
    for (let i = 0; i < this._vectors.length; i++) {
      const score = cosineSimilarity(queryVec, this._vectors[i]!);
      if (score > 0) scored.push({ score, idx: i });
    }
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ score, idx }) => ({
      key: this._entries[idx]!.key,
      chunk: this._entries[idx]!.chunk,
      score,
    }));
  }

  private _buildVectors(): void {
    if (!this._dirty) return;
    const N = this._entries.length;
    const vocabSize = this._vocab.size;
    this._vectors = this._entries.map((entry) => {
      const vec = new Float32Array(vocabSize);
      for (const [term, tf] of entry.termFreqs) {
        const idx = this._vocab.get(term);
        if (idx === undefined) continue;
        const df = this._docFreq.get(term) ?? 1;
        const idf = Math.log((N + 1) / (df + 1)) + 1;
        const tfidf = (tf / entry.termFreqs.size) * idf;
        if (idx < vocabSize) vec[idx] = tfidf;
      }
      return vec;
    });
    this._dirty = false;
  }

  private _pruneVocab(): void {
    // Remove terms with docFreq < MIN_DOC_FREQ_FOR_PRUNE to cap vocab size
    for (const [term, df] of this._docFreq) {
      if (df < MIN_DOC_FREQ_FOR_PRUNE) {
        this._docFreq.delete(term);
        this._vocab.delete(term);
      }
    }
    // Rebuild vocab indices (they must be 0..vocab.size-1 contiguous)
    const newVocab = new Map<string, number>();
    let idx = 0;
    for (const term of this._vocab.keys()) {
      newVocab.set(term, idx++);
    }
    this._vocab = newVocab;
    this._dirty = true; // vectors must be rebuilt after vocab change
  }
}
