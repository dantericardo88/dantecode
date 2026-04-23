// ============================================================================
// packages/codebase-index/src/types.ts
// Shared types for the codebase indexing system.
// ============================================================================

/** Programming language supported by the symbol extractor. */
export type Language = "typescript" | "javascript" | "python" | "go" | "rust" | "unknown";

/** A symbol definition extracted from source code. */
export interface SymbolMatch {
  name: string;
  kind: string;
  line: number;
  signature: string;
}

/** A code chunk with file path and content (subset of @dantecode/config-types CodeChunk). */
export interface IndexChunk {
  filePath: string;
  content: string;
  startLine?: number;
  endLine?: number;
  symbols?: string[];
}

/** A chunk ranked by a retrieval strategy. */
export interface RankedChunk {
  /** Deduplication key: "${filePath}:${startLine ?? 0}" */
  key: string;
  chunk: IndexChunk;
}

/** A source of context for FIM prompt injection, with priority and token cost. */
export interface ContextSource {
  id: string;
  /** Higher priority sources are included before lower priority ones. */
  priority: number;
  content: string;
  /** Approximate token cost: content.length / 3.5 */
  tokenCost: number;
}

/** A ranked file from the PageRank repo map. */
export interface RankedFile {
  filePath: string;
  score: number;
  symbols: SymbolMatch[];
}
