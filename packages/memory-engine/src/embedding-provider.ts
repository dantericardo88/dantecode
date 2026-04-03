// ============================================================================
// @dantecode/memory-engine — Local Embedding Provider
// TF-IDF with 256-dim hashing trick. Zero external dependencies.
// L2-normalized output for cosine similarity.
// ============================================================================

import { tokenize } from "./vector-store.js";

/**
 * LocalEmbeddingProvider — TF-IDF with 256-dim hashing trick.
 * Zero external dependencies. L2-normalized output for cosine similarity.
 */
export class LocalEmbeddingProvider {
  static readonly DIMS = 256;
  private idfWeights = new Map<string, number>();
  private documentCount = 0;

  async embed(text: string): Promise<number[]> {
    const tokens = Array.from(tokenize(text));
    const vector = new Float64Array(LocalEmbeddingProvider.DIMS);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [token, freq] of tf) {
      const slot = simpleHash(token) % LocalEmbeddingProvider.DIMS;
      const idf = this.idfWeights.get(token) ?? 1.0;
      vector[slot] = (vector[slot] ?? 0) + (freq / Math.max(1, tokens.length)) * idf;
    }
    const norm = Math.sqrt(Array.from(vector).reduce((s, v) => s + v * v, 0)) || 1;
    return Array.from(vector).map((v) => v / norm);
  }

  updateCorpus(documents: string[]): void {
    this.documentCount = documents.length;
    const df = new Map<string, number>();
    for (const doc of documents) {
      for (const token of tokenize(doc)) df.set(token, (df.get(token) ?? 0) + 1);
    }
    this.idfWeights.clear();
    for (const [term, count] of df) {
      this.idfWeights.set(term, Math.log((this.documentCount + 1) / (count + 1)) + 1);
    }
  }
}

function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
    hash = hash & 0x7fffffff;
  }
  return hash;
}
