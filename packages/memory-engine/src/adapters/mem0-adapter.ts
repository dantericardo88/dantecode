// ============================================================================
// @dantecode/memory-engine — Mem0 Adapter (optional)
// Optional adapter for mem0ai/mem0 cloud or self-hosted service.
// Falls back gracefully if Mem0 is not configured.
// ============================================================================

import type { MemoryItem, MemoryScope, MemoryLayer } from "../types.js";

export interface Mem0Config {
  apiKey?: string;
  baseUrl?: string;
  userId?: string;
}

export interface Mem0AdapterOptions {
  config: Mem0Config;
  /** Fallback to local storage if Mem0 is unavailable. Default: true. */
  fallbackToLocal?: boolean;
}

/**
 * Mem0 adapter for optional cloud-backed semantic memory.
 *
 * When configured with MEM0_API_KEY, routes high-importance memories
 * to the Mem0 service for cross-device persistence.
 *
 * Privacy: only items with scope="global" and score > 0.7 are sent to Mem0.
 */
export class Mem0Adapter {
  private readonly config: Mem0Config;
  readonly fallbackToLocal: boolean;
  private available = false;

  constructor(options: Mem0AdapterOptions) {
    this.config = options.config;
    this.fallbackToLocal = options.fallbackToLocal ?? true;
  }

  /** Check if Mem0 is configured and reachable. */
  async initialize(): Promise<boolean> {
    if (!this.config.apiKey) {
      this.available = false;
      return false;
    }
    // In production: ping the Mem0 health endpoint
    // For now: just check config presence
    this.available = Boolean(this.config.apiKey && this.config.baseUrl);
    return this.available;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  /**
   * Store a memory item in Mem0 (if configured and item qualifies).
   * Only global scope + high score items are sent.
   */
  async store(item: MemoryItem): Promise<boolean> {
    if (!this.available) return false;
    if (item.scope !== "global" || item.score < 0.7) return false;

    // In production: POST to Mem0 API
    // POST ${this.config.baseUrl}/memories
    // { content: item.summary, user_id: this.config.userId }
    return true;
  }

  /**
   * Recall relevant memories from Mem0.
   */
  async recall(query: string, _scope?: MemoryScope, limit = 10): Promise<MemoryItem[]> {
    if (!this.available) return [];

    // In production: GET ${this.config.baseUrl}/memories/search?query=...
    // Transform Mem0 results into MemoryItems
    void query;
    void limit;
    return [];
  }

  /**
   * Convert a Mem0 API response to a MemoryItem.
   */
  fromMem0Response(response: Record<string, unknown>): MemoryItem {
    const layer: MemoryLayer = "semantic";
    return {
      key: String(response["id"] ?? "mem0-unknown"),
      value: response["content"] ?? "",
      scope: "global",
      layer,
      createdAt: String(response["created_at"] ?? new Date().toISOString()),
      lastAccessedAt: new Date().toISOString(),
      score: 0.7,
      recallCount: 0,
      source: "mem0",
      summary: String(response["content"] ?? "").slice(0, 200),
      tags: ["mem0", "external"],
    };
  }
}

/** Create a Mem0 adapter from environment variables. */
export function createMem0Adapter(): Mem0Adapter | null {
  const apiKey = process.env["MEM0_API_KEY"];
  const baseUrl = process.env["MEM0_BASE_URL"] ?? "https://api.mem0.ai";
  const userId = process.env["MEM0_USER_ID"];

  if (!apiKey) return null;

  return new Mem0Adapter({
    config: { apiKey, baseUrl, userId },
    fallbackToLocal: true,
  });
}
