// ============================================================================
// @dantecode/memory-engine — Public API
// Multi-layer semantic persistent memory engine for DanteCode agents.
//
// PRD: Session / Memory Enhancement v1.0 — Target score 9.0+
// ============================================================================

// --- Core types ---
export type {
  MemoryScope,
  MemoryLayer,
  MemoryItem,
  MemoryStoreResult,
  MemoryRecallResult,
  MemorySummarizeResult,
  MemoryPruneResult,
  MemoryVisualizeResult,
  MemoryEntity,
  MemoryRelationship,
  MemoryOrchestratorOptions,
  RetentionPolicyConfig,
  ScoringPolicyConfig,
  SessionKnowledge,
  WorkspaceSnapshot,
} from "./types.js";

// --- Main orchestrator (primary entry point) ---
export { MemoryOrchestrator, createMemoryOrchestrator } from "./memory-orchestrator.js";

// --- Layer A: Short-term store ---
export { ShortTermStore } from "./short-term-store.js";

// --- Layer B: Session memory (checkpoint layer) ---
export { SessionMemory } from "./session-memory.js";

// --- Layer C: Semantic store ---
export { VectorStore, tokenize, jaccardSimilarity, cosineSimilarity } from "./vector-store.js";
export type { VectorEntry, VectorSearchResult } from "./vector-store.js";

// --- Embedding provider ---
export { LocalEmbeddingProvider } from "./embedding-provider.js";

// --- Recall engine ---
export { SemanticRecall } from "./semantic-recall.js";
export type { RecallCandidate, RecallOptions } from "./semantic-recall.js";

// --- Entity extraction ---
export { EntityExtractor, globalEntityExtractor } from "./entity-extractor.js";

// --- Summarization ---
export { Summarizer, estimateTokens, globalSummarizer } from "./summarizer.js";
export type { SummarizerOptions } from "./summarizer.js";

// --- Pruning ---
export { PruningEngine } from "./pruning-engine.js";
export type { PruningEngineOptions, PruningStats } from "./pruning-engine.js";

// --- Compression ---
export { CompressionEngine, globalCompressionEngine } from "./compression-engine.js";
export type { CompressionResult } from "./compression-engine.js";

// --- Graph memory ---
export { GraphMemory } from "./graph-memory.js";
export type { GraphNode, GraphTraversalResult } from "./graph-memory.js";

// --- Visualization ---
export { MemoryVisualizer } from "./memory-visualizer.js";

// --- Storage ---
export { LocalStore } from "./storage/local-store.js";
export type { LocalStoreOptions } from "./storage/local-store.js";
export { SnapshotStore } from "./storage/snapshot-store.js";
export type { SnapshotStoreOptions } from "./storage/snapshot-store.js";

// --- Policies ---
export { RetentionPolicy, defaultRetentionPolicy } from "./policies/retention-policy.js";
export type { RetentionDecision, RetentionEvaluation } from "./policies/retention-policy.js";
export { ScoringPolicy, defaultScoringPolicy } from "./policies/scoring-policy.js";

// --- Optional adapters ---
export { Mem0Adapter, createMem0Adapter } from "./adapters/mem0-adapter.js";
export type { Mem0Config, Mem0AdapterOptions } from "./adapters/mem0-adapter.js";
export { ZepAdapter, createZepAdapter } from "./adapters/zep-adapter.js";
export type { ZepConfig } from "./adapters/zep-adapter.js";
