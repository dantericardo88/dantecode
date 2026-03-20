// ============================================================================
// @dantecode/memory-engine — Memory Orchestrator
// Main entry point. Coordinates all memory layers, recall, pruning, and I/O.
// Implements the public API from the PRD:
//   memoryStore, memoryRecall, memorySummarize, memoryPrune,
//   crossSessionRecall, memoryVisualize
// ============================================================================

import type {
  MemoryItem,
  MemoryScope,
  MemoryStoreResult,
  MemoryRecallResult,
  MemorySummarizeResult,
  MemoryPruneResult,
  MemoryVisualizeResult,
  MemoryOrchestratorOptions,
  SessionKnowledge,
} from "./types.js";

import { ShortTermStore } from "./short-term-store.js";
import { SessionMemory } from "./session-memory.js";
import { VectorStore } from "./vector-store.js";
import { EntityExtractor } from "./entity-extractor.js";
import { Summarizer } from "./summarizer.js";
import { PruningEngine } from "./pruning-engine.js";
import { CompressionEngine } from "./compression-engine.js";
import { SemanticRecall } from "./semantic-recall.js";
import { GraphMemory } from "./graph-memory.js";
import { MemoryVisualizer } from "./memory-visualizer.js";
import { LocalStore } from "./storage/local-store.js";
import { SnapshotStore } from "./storage/snapshot-store.js";
import { Mem0Adapter, createMem0Adapter } from "./adapters/mem0-adapter.js";
import { ZepAdapter, createZepAdapter } from "./adapters/zep-adapter.js";
import { ScoringPolicy } from "./policies/scoring-policy.js";

/**
 * MemoryOrchestrator — the multi-layer memory engine control brain.
 *
 * Architecture (5 organs):
 * - Organ A: MemoryOrchestrator (this class) — control + routing
 * - Organ B: ShortTermStore + LocalStore + SnapshotStore — storage hierarchy
 * - Organ C: SemanticRecall + VectorStore — retrieval
 * - Organ D: Summarizer + PruningEngine + CompressionEngine — efficiency
 * - Organ E: ScoringPolicy + (DanteForge gates) — governance
 *
 * Public API (PRD § 9):
 * - memoryStore(key, value, scope?)
 * - memoryRecall(query, limit?, scope?)
 * - memorySummarize(sessionId)
 * - memoryPrune(threshold?)
 * - crossSessionRecall(userGoal?)
 * - memoryVisualize()
 */
export class MemoryOrchestrator {
  // Organ B — Storage
  private readonly shortTerm: ShortTermStore;
  private readonly localStore: LocalStore;
  private readonly sessionMemory: SessionMemory;
  private readonly vectorStore: VectorStore;
  readonly snapshotStore: SnapshotStore;

  // Organ C — Recall
  private readonly semanticRecall: SemanticRecall;

  // Organ D — Efficiency
  private readonly summarizer: Summarizer;
  private readonly pruningEngine: PruningEngine;
  readonly compressionEngine: CompressionEngine;

  // Organ E — Governance
  private readonly scoringPolicy: ScoringPolicy;

  // Graph + visualization
  private readonly graphMemory: GraphMemory;
  private readonly visualizer: MemoryVisualizer;

  // Entity extraction
  private readonly entityExtractor: EntityExtractor;

  // Optional external adapters
  private readonly mem0: Mem0Adapter | null;
  private readonly zep: ZepAdapter | null;

  // Options
  private readonly enableSemanticRecall: boolean;
  private readonly enableEntityExtraction: boolean;

  constructor(options: MemoryOrchestratorOptions) {
    const {
      projectRoot,
      shortTermCapacity = 500,
      shortTermTtlMs = 30 * 60 * 1000,
      longTermCapacity = 100_000,
      enableSemanticRecall = true,
      enableEntityExtraction = true,
    } = options;

    // Build injectable file I/O for testability
    const ioOptions = {
      writeFileFn: options.writeFileFn,
      readFileFn: options.readFileFn,
      mkdirFn: options.mkdirFn as (p: string, opts?: { recursive?: boolean }) => Promise<void>,
      readdirFn: options.readdirFn,
      unlinkFn: options.unlinkFn,
    };

    // Organ B — Storage
    this.shortTerm = new ShortTermStore(shortTermCapacity, shortTermTtlMs);
    this.localStore = new LocalStore(projectRoot, ioOptions);
    this.sessionMemory = new SessionMemory(this.localStore);
    this.vectorStore = new VectorStore(this.localStore, longTermCapacity);
    this.snapshotStore = new SnapshotStore(projectRoot, ioOptions);

    // Organ C — Recall
    this.semanticRecall = new SemanticRecall(
      this.shortTerm,
      this.sessionMemory,
      this.vectorStore,
    );

    // Organ D — Efficiency
    this.summarizer = new Summarizer();
    this.pruningEngine = new PruningEngine(this.localStore, this.vectorStore);
    this.compressionEngine = new CompressionEngine();

    // Organ E — Governance
    this.scoringPolicy = new ScoringPolicy();

    // Graph + visualization
    this.graphMemory = new GraphMemory();
    this.visualizer = new MemoryVisualizer(
      this.graphMemory,
      this.shortTerm,
      this.vectorStore,
    );

    // Entity extraction
    this.entityExtractor = new EntityExtractor();

    // Optional external adapters (check env vars)
    this.mem0 = createMem0Adapter();
    this.zep = createZepAdapter();

    this.enableSemanticRecall = enableSemanticRecall;
    this.enableEntityExtraction = enableEntityExtraction;
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the engine: load the semantic index from disk.
   * Call this once on startup.
   */
  async initialize(): Promise<void> {
    await this.vectorStore.loadFromDisk();

    if (this.mem0) await this.mem0.initialize();
    if (this.zep) await this.zep.initialize();
  }

  // --------------------------------------------------------------------------
  // Public API — PRD § 9
  // --------------------------------------------------------------------------

  /**
   * Store a memory item.
   *
   * Routing:
   * - Always: short-term (fast, session-local)
   * - If value is a string/fact: also checkpoint layer (persistent)
   * - If summary exists or value is long: also semantic layer (indexed)
   *
   * GF-01: stored items survive restarts.
   */
  async memoryStore(
    key: string,
    value: unknown,
    scope: MemoryScope = "session",
    meta?: {
      tags?: string[];
      source?: string;
      summary?: string;
      verified?: boolean;
      layer?: "short-term" | "checkpoint" | "semantic";
    },
  ): Promise<MemoryStoreResult> {
    // Build base item
    const baseItem: MemoryItem = {
      key,
      value,
      scope,
      layer: "short-term",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      score: 0.5,
      recallCount: 0,
      tags: meta?.tags,
      source: meta?.source,
      summary: meta?.summary,
      verified: meta?.verified,
    };

    // Score the item
    const scored = this.scoringPolicy.applyScore(baseItem);

    // Layer 1: Always write to short-term
    this.shortTerm.set(key, value, scope);

    // Determine which persistent layer(s) to write to
    const requestedLayer = meta?.layer;
    const valueStr = typeof value === "string" ? value : JSON.stringify(value);
    const isLongValue = valueStr.length > 200;
    const hasSummary = Boolean(meta?.summary);

    let persistedLayer: MemoryItem["layer"] = "short-term";

    if (requestedLayer === "checkpoint" || (!requestedLayer && scope !== "session")) {
      // Layer 2: Checkpoint layer for project/user/global scope
      await this.sessionMemory.storeFact(meta?.source ?? "unknown", key, value, scope);
      persistedLayer = "checkpoint";
    }

    if (
      this.enableSemanticRecall &&
      (requestedLayer === "semantic" || hasSummary || isLongValue || scope === "project" || scope === "global")
    ) {
      // Layer 3: Semantic layer for indexable content
      const semanticItem: MemoryItem = { ...scored, layer: "semantic" };
      await this.vectorStore.add(semanticItem);
      persistedLayer = "semantic";
    }

    // Entity extraction for project/global scope
    if (this.enableEntityExtraction && (scope === "project" || scope === "global")) {
      const entities = this.entityExtractor.extractFromValue(value, meta?.source, key);
      this.graphMemory.addEntities(entities);
    }

    // Optional: sync to Mem0/Zep for global scope
    if (scope === "global" && scored.score > 0.7) {
      if (this.mem0?.isAvailable) await this.mem0.store(scored);
      if (this.zep?.isAvailable) await this.zep.store(scored);
    }

    return {
      key,
      scope,
      stored: true,
      layer: persistedLayer,
    };
  }

  /**
   * Recall memories relevant to a query.
   *
   * GF-02: semantic recall with ranking and scope handling.
   */
  async memoryRecall(
    query: string,
    limit = 10,
    scope?: MemoryScope,
  ): Promise<MemoryRecallResult> {
    if (this.enableSemanticRecall) {
      return this.semanticRecall.recall(query, { limit, scope });
    }

    // Fallback: keyword-only search in short-term
    const start = Date.now();
    const results = this.shortTerm.search(query, scope, limit);
    return {
      query,
      scope: scope ?? "all",
      results,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Summarize a session's memory into a compact representation.
   *
   * GF-03: token reduction without losing critical facts.
   */
  async memorySummarize(sessionId: string): Promise<MemorySummarizeResult> {
    // Gather all items related to this session
    const stItems = this.shortTerm.listByScope("session").filter(
      (i) => i.source === sessionId,
    );
    const cpItems = await this.sessionMemory.loadAll("session");
    const filtered = cpItems.filter((i) => i.source === sessionId);
    const allItems = [...stItems, ...filtered];

    const result = await this.summarizer.summarize(sessionId, allItems);

    // If we produced a summary, store it as session knowledge
    if (result.compressed && allItems.length > 0) {
      const knowledge: SessionKnowledge = this.summarizer.extractKnowledge(sessionId, allItems);
      await this.sessionMemory.storeKnowledge(knowledge);
    }

    return result;
  }

  /**
   * Prune low-value memory items.
   *
   * GF-04: removes stale items, preserves frequently recalled + verified.
   */
  async memoryPrune(threshold?: number): Promise<MemoryPruneResult> {
    return this.pruningEngine.pruneAll(threshold, false);
  }

  /**
   * Cross-session recall: find memories relevant to a long-term goal.
   *
   * GF-02 extended: cross-session scope with goal alignment.
   */
  async crossSessionRecall(userGoal?: string, limit = 10): Promise<MemoryRecallResult> {
    const query = userGoal ?? "";
    return this.semanticRecall.crossSessionRecall(query, limit);
  }

  /**
   * Generate a visualization of the current memory state.
   *
   * GF-07: entity/relationship map without corrupting storage.
   */
  memoryVisualize(scope?: MemoryScope): MemoryVisualizeResult {
    return this.visualizer.visualize(scope);
  }

  // --------------------------------------------------------------------------
  // Extended API
  // --------------------------------------------------------------------------

  /**
   * Store session knowledge from a completed session.
   */
  async storeSessionKnowledge(knowledge: SessionKnowledge): Promise<void> {
    await this.sessionMemory.storeKnowledge(knowledge);

    // Also index in semantic layer
    const item: MemoryItem = {
      key: `knowledge::${knowledge.sessionId}`,
      value: knowledge,
      scope: "project",
      layer: "semantic",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      score: 0.8,
      recallCount: 0,
      source: knowledge.sessionId,
      summary: `Session: ${knowledge.tasks.slice(0, 2).join("; ")} | Files: ${knowledge.filesModified.slice(0, 3).join(", ")}`,
      tags: ["knowledge", "session-summary"],
    };
    await this.vectorStore.add(item);
  }

  /** Retrieve session knowledge for a specific session. */
  async getSessionKnowledge(sessionId: string): Promise<SessionKnowledge | null> {
    return this.sessionMemory.loadKnowledge(sessionId);
  }

  /** List all session knowledge entries. */
  async listSessionKnowledge(): Promise<SessionKnowledge[]> {
    return this.sessionMemory.listAllKnowledge();
  }

  /** Boost a memory item's score (call when actively used/referenced). */
  async boost(key: string, scope: MemoryScope): Promise<void> {
    await this.sessionMemory.boost(key, scope);
  }

  /** Mark a memory item as DanteForge-verified (trusted). */
  async verify(key: string, scope: MemoryScope): Promise<void> {
    await this.sessionMemory.verify(key, scope);
  }

  /** Get memory state summary as text. */
  getTextSummary(): string {
    return this.visualizer.toTextSummary();
  }

  /** Get the underlying graph memory (for external use). */
  getGraphMemory(): GraphMemory {
    return this.graphMemory;
  }

  /** Get short-term store stats. */
  getShortTermStats(): { size: number; capacity: number } {
    return {
      size: this.shortTerm.size,
      capacity: this.shortTerm.capacityLimit,
    };
  }

  /** Get semantic index stats. */
  getSemanticStats(): { size: number } {
    return { size: this.vectorStore.size };
  }
}

// ----------------------------------------------------------------------------
// Factory function
// ----------------------------------------------------------------------------

/**
 * Create a MemoryOrchestrator with default configuration.
 * Reads optional config from environment variables.
 */
export function createMemoryOrchestrator(
  projectRoot: string,
  options?: Partial<MemoryOrchestratorOptions>,
): MemoryOrchestrator {
  return new MemoryOrchestrator({
    projectRoot,
    ...options,
  });
}
