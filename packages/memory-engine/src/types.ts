// ============================================================================
// @dantecode/memory-engine — Types
// Core type definitions for the multi-layer persistent memory engine.
// ============================================================================

/** Memory scope — controls visibility and lifetime. */
export type MemoryScope = "session" | "project" | "user" | "global";

/** Memory layer — controls storage backend and retrieval strategy. */
export type MemoryLayer = "short-term" | "checkpoint" | "semantic" | "entity" | "snapshot";

/** Memory item — the atomic data unit stored in the memory engine. */
export interface MemoryItem {
  /** Unique key (scoped within scope+layer). */
  key: string;
  /** The stored value (any JSON-serializable data). */
  value: unknown;
  /** Scope of this memory. */
  scope: MemoryScope;
  /** Which storage layer it lives in. */
  layer: MemoryLayer;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-access timestamp. */
  lastAccessedAt: string;
  /** Relevance/quality score 0–1. Higher = more important. */
  score: number;
  /** How many times this memory was recalled. */
  recallCount: number;
  /** Optional tags for categorization. */
  tags?: string[];
  /** Source that wrote this memory (sessionId, agentId, etc.). */
  source?: string;
  /** Short plaintext summary for semantic indexing. */
  summary?: string;
  /** Whether this memory has been DanteForge-verified / trusted. */
  verified?: boolean;
  /** TTL in milliseconds (for short-term layer). */
  ttlMs?: number;
  /** Metadata blob for custom use. */
  meta?: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Public API result types (from the PRD contracts)
// ----------------------------------------------------------------------------

/** Result of a memoryStore() call. */
export interface MemoryStoreResult {
  key: string;
  scope: MemoryScope;
  stored: boolean;
  layer: MemoryLayer;
}

/** Result of a memoryRecall() call. */
export interface MemoryRecallResult {
  query: string;
  scope?: string;
  results: MemoryItem[];
  latencyMs: number;
}

/** Result of a memorySummarize() call. */
export interface MemorySummarizeResult {
  sessionId: string;
  summary: string;
  compressed: boolean;
  tokensSaved?: number;
}

/** Result of a memoryPrune() call. */
export interface MemoryPruneResult {
  prunedCount: number;
  retainedCount: number;
  policy: string;
}

/** Result of a memoryVisualize() call. */
export interface MemoryVisualizeResult {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

// ----------------------------------------------------------------------------
// Entity types
// ----------------------------------------------------------------------------

/** A named entity extracted from memory content. */
export interface MemoryEntity {
  /** Entity name. */
  name: string;
  /** Entity type. */
  type:
    | "file"
    | "function"
    | "class"
    | "concept"
    | "person"
    | "project"
    | "error"
    | "package"
    | "other";
  /** How many times this entity was mentioned. */
  count: number;
  /** Sessions where this entity appeared. */
  sessionIds: string[];
  /** Memory keys that reference this entity. */
  memoryKeys: string[];
}

/** A relationship between two memory entities (for graph memory). */
export interface MemoryRelationship {
  from: string;
  to: string;
  kind: "uses" | "defines" | "modifies" | "imports" | "related" | "contradicts" | "extends";
  /** Relationship strength 0–1. */
  strength: number;
}

// ----------------------------------------------------------------------------
// Configuration types
// ----------------------------------------------------------------------------

/** Options for the MemoryOrchestrator. */
export interface MemoryOrchestratorOptions {
  /** Root directory for persistent storage. */
  projectRoot: string;
  /** Maximum items in the short-term (in-memory) store. Default: 500. */
  shortTermCapacity?: number;
  /** Short-term TTL in ms (0 = no TTL). Default: 1800000 (30 min). */
  shortTermTtlMs?: number;
  /** Maximum items in the long-term semantic store. Default: 100_000. */
  longTermCapacity?: number;
  /** Score threshold below which items are pruned. Default: 0.1. */
  pruneThreshold?: number;
  /** Whether to enable semantic (Jaccard) recall. Default: true. */
  enableSemanticRecall?: boolean;
  /** Whether to enable automatic entity extraction. Default: true. */
  enableEntityExtraction?: boolean;
  /** Injectable file I/O for testing. */
  writeFileFn?: (path: string, data: string) => Promise<void>;
  readFileFn?: (path: string) => Promise<string>;
  mkdirFn?: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  readdirFn?: (path: string) => Promise<string[]>;
  unlinkFn?: (path: string) => Promise<void>;
  existsFn?: (path: string) => Promise<boolean>;
}

/** Retention policy configuration. */
export interface RetentionPolicyConfig {
  /** Items older than this (days) become prune candidates. Default: 30. */
  maxAgeDays: number;
  /** Items with score below this are deprioritized. Default: 0.2. */
  minScore: number;
  /** Items recalled fewer times than this are lower priority. Default: 2. */
  minRecallCount: number;
  /** Always retain verified items regardless of score/age. Default: true. */
  keepVerified: boolean;
  /** Maximum items in the semantic layer before forced pruning. Default: 10_000. */
  maxSemanticItems: number;
}

/** Scoring policy configuration. */
export interface ScoringPolicyConfig {
  /** Weight of recency factor (0–1). */
  recencyWeight: number;
  /** Weight of recall frequency (0–1). */
  recallWeight: number;
  /** Weight of verified status (0–1). */
  verifiedWeight: number;
  /** Weight of source quality (0–1). */
  sourceWeight: number;
}

/** An entry in the session knowledge base (used by Summarizer). */
export interface SessionKnowledge {
  /** Session ID. */
  sessionId: string;
  /** Facts extracted from this session. */
  facts: string[];
  /** Files touched in this session. */
  filesModified: string[];
  /** Tasks completed. */
  tasks: string[];
  /** Errors encountered. */
  errors: string[];
  /** ISO-8601 timestamp of knowledge capture. */
  capturedAt: string;
}

/** Snapshot of a repo/worktree state tied to memory. */
export interface WorkspaceSnapshot {
  /** Snapshot ID. */
  id: string;
  /** Worktree path. */
  worktreePath: string;
  /** Git branch. */
  branch: string;
  /** Git commit hash. */
  commitHash: string;
  /** ISO-8601 timestamp. */
  capturedAt: string;
  /** Associated memory keys. */
  memoryKeys: string[];
  /** Whether verified clean. */
  verified: boolean;
}
