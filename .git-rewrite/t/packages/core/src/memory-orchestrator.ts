// ============================================================================
// @dantecode/core — Memory Orchestrator
// The central nervous system for DanteCode's Memory Engine. Coordinates
// short-term context, persistent memory, semantic extraction, pruning, and
// integrations with Checkpointer and AutonomyEngine.
// ============================================================================

import { PersistentMemory, type MemoryEntry } from "./persistent-memory.js";
import { SessionStore } from "./session-store.js";
import { EntityExtractor } from "./entity-extractor.js";
import { PruningEngine } from "./pruning-engine.js";
import { SemanticRecall } from "./semantic-recall.js";
import type { AutonomyEngine } from "./autonomy-engine.js";
import type { EventSourcedCheckpointer } from "./checkpointer.js";
import type { ModelRouterImpl } from "./model-router.js";

export interface MemoryConfig {
  projectRoot: string;
  sessionId: string;
}

export class MemoryOrchestrator {
  public persistentMemory: PersistentMemory;
  public sessionStore: SessionStore;
  public extractor: EntityExtractor;
  public pruner: PruningEngine;
  public recallEngine: SemanticRecall;

  constructor(
    private readonly config: MemoryConfig,
    router: ModelRouterImpl,
    private readonly autonomy: AutonomyEngine,
    private readonly checkpointer: EventSourcedCheckpointer,
  ) {
    this.persistentMemory = new PersistentMemory(config.projectRoot);
    this.sessionStore = new SessionStore(config.projectRoot);
    this.extractor = new EntityExtractor(router);
    this.pruner = new PruningEngine(this.persistentMemory, autonomy);
    this.recallEngine = new SemanticRecall(this.persistentMemory, router);
  }

  /**
   * Intelligently stores a raw memory string:
   * 1. Extracts entities, summary, and category via LLM.
   * 2. Saves to PersistentMemory.
   * 3. Syncs the summary to the EventSourcedCheckpointer as a meta write.
   */
  async recordMemory(rawText: string, syncToCheckpoint = true): Promise<MemoryEntry> {
    const extracted = await this.extractor.extract(rawText);

    const entry = await this.persistentMemory.store(
      extracted.summary,
      extracted.category,
      extracted.entities,
      this.config.sessionId,
    );

    if (syncToCheckpoint) {
      await this.checkpointer.putWrite({
        taskId: "memory-orchestrator",
        channel: "memory_sync",
        value: { id: entry.id, summary: extracted.summary, category: extracted.category },
        timestamp: new Date().toISOString(),
      });
    }

    return entry;
  }

  /**
   * Recalls the best matching memories. Always queries persistent storage via SemanticRecall,
   * but also attaches the current Autonomy active goals to context.
   */
  async queryMemory(query: string, strictGate = false): Promise<string> {
    const activeGoals = this.autonomy.listGoals("active");
    const goalContext = activeGoals.map((g) => g.description).join(" ");

    // Supplement the query with current agent goals for better semantic hit rate
    const enhancedQuery = query + " " + goalContext;

    const matchingEntries = await this.recallEngine.recall(enhancedQuery, 5, strictGate);

    if (matchingEntries.length === 0) return "No relevant memory context found.";
    return matchingEntries.map((e) => `[${e.category.toUpperCase()}] ${e.content}`).join("\\n");
  }

  /**
   * Runs the pruning cycle. Should be called periodically or manually via MCP.
   */
  async optimizeMemory(): Promise<void> {
    await this.pruner.prune();
  }

  /**
   * Summarizes the entire current session context and records it as a permanent fact.
   */
  async closeSession(): Promise<void> {
    const session = await this.sessionStore.load(this.config.sessionId);
    if (!session) return;

    const summary = await this.sessionStore.summarize(session);
    await this.recordMemory(`Session Summary: ${summary}`, false);
    await this.optimizeMemory();
  }
}
