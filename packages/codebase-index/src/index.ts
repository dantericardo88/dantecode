// ============================================================================
// packages/codebase-index/src/index.ts
// Public API for @dantecode/codebase-index
// ============================================================================

export type { Language, SymbolMatch, IndexChunk, RankedChunk, ContextSource, RankedFile } from "./types.js";
export { detectLanguage, extractSymbols, extractSymbolsAsync } from "./symbol-extractor.js";
export { RepoMapProvider } from "./repo-map-provider.js";
export type { SymbolTag } from "@dantecode/core";
export { SymbolDefinitionLookup } from "./symbol-definition-lookup.js";
export { rrfFusion } from "./rrf-fusion.js";
export { tokenCostOf, assembleContext } from "./context-assembler.js";
export { semanticChunkFile, semanticChunkFileAsync } from "./semantic-chunker.js";
export type { AstChunk } from "./ast-chunker.js";
export { BM25Index } from "./bm25-index.js";
export { TFIDFVectorStore } from "./tfidf-vector-store.js";
export type { TFIDFSearchResult } from "./tfidf-vector-store.js";
export { extractNotebookChunks, isNotebookFile } from "./notebook-extractor.js";
