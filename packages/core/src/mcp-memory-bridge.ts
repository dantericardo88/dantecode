// ============================================================================
// @dantecode/core — Pieces MCP Memory Bridge
// Connects to Pieces' Long-Term Memory Engine via MCP protocol.
// Requires: Pieces desktop app running locally + PIECES_MCP_URL env var
// Docs: https://docs.pieces.app/products/mcp/get-started
// ============================================================================

export interface MCPMemoryBridgeOptions {
  serverUrl: string;   // e.g., "http://localhost:1000"
  timeoutMs?: number;  // default 5000
}

export class MCPMemoryBridge {
  private readonly serverUrl: string;
  private readonly timeoutMs: number;

  constructor(options: MCPMemoryBridgeOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  /**
   * Search Pieces' long-term memory for context relevant to a query.
   * Returns up to 5 memory snippets.
   */
  async recallContext(query: string): Promise<string[]> {
    try {
      const response = await fetch(`${this.serverUrl}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "search_memories",
          arguments: { query, limit: 5 }
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return [];
      const data = await response.json() as { content?: Array<{ text?: string }> };
      return (data.content ?? []).map(c => c.text ?? "").filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Store context in Pieces' long-term memory.
   */
  async storeContext(content: string, tags: string[] = []): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "save_memory",
          arguments: { content, tags }
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check if the Pieces MCP server is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Create from environment variable PIECES_MCP_URL.
   * Returns null if not configured.
   */
  static fromEnv(): MCPMemoryBridge | null {
    const url = process.env["PIECES_MCP_URL"];
    if (!url) return null;
    return new MCPMemoryBridge({ serverUrl: url });
  }
}
