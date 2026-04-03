// ============================================================================
// Memory Engine Integration
// Direct wrapper for @dantecode/memory-engine MemoryOrchestrator
// ============================================================================

import { createMemoryOrchestrator, type MemoryOrchestrator, type MemoryRecallResult, type MemoryStoreResult, type MemoryScope } from "@dantecode/memory-engine";

/**
 * Singleton memory orchestrator for the workspace
 */
let memoryOrchestrator: MemoryOrchestrator | undefined;

/**
 * Initialize or get existing memory orchestrator
 */
export async function getMemoryOrchestrator(projectRoot: string): Promise<MemoryOrchestrator> {
  if (!memoryOrchestrator) {
    memoryOrchestrator = await createMemoryOrchestrator({
      projectRoot,
      embeddingProvider: "local", // Use local TF-IDF embeddings
    });
    await memoryOrchestrator.initialize();
  }
  return memoryOrchestrator;
}

/**
 * Store content in memory
 */
export async function memoryStore(
  content: string,
  scope: MemoryScope,
  projectRoot: string,
): Promise<MemoryStoreResult> {
  const orchestrator = await getMemoryOrchestrator(projectRoot);
  const key = `vscode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return await orchestrator.memoryStore(key, content, scope);
}

/**
 * Recall memories matching query
 */
export async function memoryRecall(
  query: string,
  projectRoot: string,
  limit: number = 10,
): Promise<MemoryRecallResult> {
  const orchestrator = await getMemoryOrchestrator(projectRoot);
  return await orchestrator.memoryRecall(query, limit);
}

/**
 * Visualize memory graph
 */
export async function memoryVisualize(projectRoot: string): Promise<any> {
  const orchestrator = await getMemoryOrchestrator(projectRoot);
  return orchestrator.memoryVisualize();
}

/**
 * Prune old memories
 */
export async function memoryPrune(projectRoot: string, olderThanDays: number = 30): Promise<any> {
  const orchestrator = await getMemoryOrchestrator(projectRoot);
  const threshold = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  return await orchestrator.memoryPrune(threshold);
}

/**
 * Summarize memory contents
 */
export async function memorySummarize(sessionId: string, projectRoot: string): Promise<any> {
  const orchestrator = await getMemoryOrchestrator(projectRoot);
  return await orchestrator.memorySummarize(sessionId);
}

/**
 * Get memory stats
 */
export async function getMemoryStats(projectRoot: string): Promise<{
  totalItems: number;
  byScope: Record<string, number>;
  utilizationPercent: number;
}> {
  const orchestrator = await getMemoryOrchestrator(projectRoot);

  // Use public methods if available, fallback to recall for now
  const shortTermStats = (orchestrator as any).getShortTermStats?.() || { size: 0, capacity: 500 };
  const semanticStats = (orchestrator as any).getSemanticStats?.() || { size: 0 };

  const totalItems = shortTermStats.size + semanticStats.size;
  const totalCapacity = shortTermStats.capacity;

  return {
    totalItems,
    byScope: {
      "short-term": shortTermStats.size,
      "semantic": semanticStats.size,
    },
    utilizationPercent: totalCapacity > 0 ? (totalItems / totalCapacity) * 100 : 0,
  };
}

/**
 * Clear memory orchestrator (for cleanup)
 */
export function clearMemoryOrchestrator(): void {
  memoryOrchestrator = undefined;
}
