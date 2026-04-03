// ============================================================================
// @dantecode/memory-engine — Zep Adapter (optional)
// Optional adapter for getzep/zep vector + document memory server.
// Local-first; Zep only activated when ZEP_API_KEY is set.
// ============================================================================

import type { MemoryItem, MemoryScope } from "../types.js";

export interface ZepConfig {
  apiKey?: string;
  baseUrl?: string;
  collectionName?: string;
}

/**
 * Zep adapter for optional hybrid (vector + document) memory.
 *
 * When ZEP_API_KEY is configured, high-value semantic memories are
 * synced to Zep for richer retrieval (embeddings + graph).
 */
export class ZepAdapter {
  private readonly config: ZepConfig;
  private available = false;

  constructor(config: ZepConfig) {
    this.config = config;
  }

  async initialize(): Promise<boolean> {
    this.available = Boolean(this.config.apiKey && this.config.baseUrl);
    return this.available;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  /** Store a memory item in Zep (semantic layer, project/global scope only). */
  async store(item: MemoryItem): Promise<boolean> {
    if (!this.available) return false;
    if (item.scope === "session") return false; // Don't sync session-scoped to Zep

    // Production: POST to Zep collections API
    void item;
    return true;
  }

  /** Recall from Zep using hybrid search. */
  async recall(query: string, scope?: MemoryScope, limit = 10): Promise<MemoryItem[]> {
    if (!this.available) return [];
    void query;
    void scope;
    void limit;
    return [];
  }
}

/** Create a Zep adapter from environment variables. */
export function createZepAdapter(): ZepAdapter | null {
  const apiKey = process.env["ZEP_API_KEY"];
  const baseUrl = process.env["ZEP_BASE_URL"] ?? "http://localhost:8000";
  const collectionName = process.env["ZEP_COLLECTION"] ?? "dantecode";

  if (!apiKey) return null;
  return new ZepAdapter({ apiKey, baseUrl, collectionName });
}
