// ============================================================================
// @dantecode/memory-engine — Session Memory
// Checkpoint-native persistent session memory layer.
// Wraps LocalStore for cross-restart persistence. GF-01 golden flow.
// ============================================================================

import type { MemoryItem, MemoryScope, SessionKnowledge } from "./types.js";
import type { LocalStore } from "./storage/local-store.js";

/**
 * Session Memory manages the checkpoint layer.
 *
 * - Stores facts, tasks, errors, files from each session
 * - Survives CLI restarts (persisted to .dantecode/memory/)
 * - Provides structured recall per session or cross-session
 * - Integrates with the SessionKnowledge contract
 */
export class SessionMemory {
  private readonly store: LocalStore;

  constructor(store: LocalStore) {
    this.store = store;
  }

  // --------------------------------------------------------------------------
  // Write
  // --------------------------------------------------------------------------

  /** Persist a fact for a session. */
  async storeFact(
    sessionId: string,
    key: string,
    value: unknown,
    scope: MemoryScope = "session",
  ): Promise<MemoryItem> {
    const item: MemoryItem = {
      key,
      value,
      scope,
      layer: "checkpoint",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      score: 0.7,
      recallCount: 0,
      source: sessionId,
      tags: ["fact"],
    };
    await this.store.put(item);
    return item;
  }

  /** Store session knowledge extracted after session completion. */
  async storeKnowledge(knowledge: SessionKnowledge): Promise<void> {
    const item: MemoryItem = {
      key: `knowledge::${knowledge.sessionId}`,
      value: knowledge,
      scope: "project",
      layer: "checkpoint",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      score: 0.8,
      recallCount: 0,
      source: knowledge.sessionId,
      tags: ["knowledge", "session-summary"],
      summary: `Session ${knowledge.sessionId}: ${knowledge.tasks.slice(0, 2).join(", ")}. Files: ${knowledge.filesModified.slice(0, 3).join(", ")}`,
    };
    await this.store.put(item);
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  /** Load all checkpoint items for a scope. */
  async loadAll(scope: MemoryScope): Promise<MemoryItem[]> {
    return this.store.list(scope, "checkpoint");
  }

  /** Load a specific item by key + scope. */
  async load(key: string, scope: MemoryScope): Promise<MemoryItem | null> {
    return this.store.get(key, scope, "checkpoint");
  }

  /** Load session knowledge for a session ID. */
  async loadKnowledge(sessionId: string): Promise<SessionKnowledge | null> {
    const item = await this.store.get(`knowledge::${sessionId}`, "project", "checkpoint");
    if (!item) return null;
    return item.value as SessionKnowledge;
  }

  /** List all session knowledge entries (cross-session). */
  async listAllKnowledge(): Promise<SessionKnowledge[]> {
    const items = await this.store.list("project", "checkpoint");
    return items
      .filter((i) => i.tags?.includes("knowledge"))
      .map((i) => i.value as SessionKnowledge)
      .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  }

  /** Find all checkpoint items that contain a keyword in their key or summary. */
  async search(query: string, scope?: MemoryScope): Promise<MemoryItem[]> {
    const scopes: MemoryScope[] = scope ? [scope] : ["session", "project", "user", "global"];
    const q = query.toLowerCase();
    const results: MemoryItem[] = [];

    for (const s of scopes) {
      const items = await this.store.list(s, "checkpoint");
      for (const item of items) {
        const keyMatch = item.key.toLowerCase().includes(q);
        const summaryMatch = item.summary?.toLowerCase().includes(q) ?? false;
        const valueMatch = JSON.stringify(item.value).toLowerCase().includes(q);
        if (keyMatch || summaryMatch || valueMatch) {
          results.push(item);
        }
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  // --------------------------------------------------------------------------
  // Update
  // --------------------------------------------------------------------------

  /** Bump the score of an item (called when recalled or verified). */
  async boost(key: string, scope: MemoryScope, delta = 0.1): Promise<void> {
    const item = await this.store.get(key, scope, "checkpoint");
    if (!item) return;
    const updated: MemoryItem = {
      ...item,
      score: Math.min(1, item.score + delta),
      recallCount: item.recallCount + 1,
      lastAccessedAt: new Date().toISOString(),
    };
    await this.store.put(updated);
  }

  /** Mark an item as verified (trusted memory). */
  async verify(key: string, scope: MemoryScope): Promise<void> {
    const item = await this.store.get(key, scope, "checkpoint");
    if (!item) return;
    const updated: MemoryItem = {
      ...item,
      verified: true,
      score: Math.min(1, item.score + 0.2),
    };
    await this.store.put(updated);
  }

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  /** Delete a single checkpoint item. */
  async delete(key: string, scope: MemoryScope): Promise<boolean> {
    return this.store.delete(key, scope, "checkpoint");
  }

  /** Delete all checkpoint items in a scope. */
  async clear(scope: MemoryScope): Promise<number> {
    return this.store.deleteAll(scope, "checkpoint");
  }
}
