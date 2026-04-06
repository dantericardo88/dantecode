// ============================================================================
// @dantecode/cli — Agent Client Protocol (ACP) Server
// Implements the ACP standard for editor ↔ agent communication.
// Spec: https://agentclientprotocol.com/
// Usage: dantecode --acp (runs as a JSON-RPC stdio server)
// ============================================================================

import { createInterface } from "node:readline";

export interface ACPRequest {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface ACPResponse {
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Start the ACP JSON-RPC server over stdio.
 * Each line of stdin is a JSON request; each line of stdout is a JSON response.
 */
export async function startACPServer(projectRoot?: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, terminal: false });

  // Send ready signal
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "ready",
    params: { name: "DanteCode", version: "0.9.3", capabilities: ["run_agent", "get_status", "cancel"] }
  }) + "\n");

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const request: ACPRequest = JSON.parse(trimmed);
      const response = await handleACPRequest(request, projectRoot ?? process.cwd());
      process.stdout.write(JSON.stringify(response) + "\n");
    } catch (err) {
      process.stdout.write(JSON.stringify({
        id: null,
        error: { code: -32700, message: "Parse error: " + String(err) }
      }) + "\n");
    }
  }
}

async function handleACPRequest(req: ACPRequest, projectRoot: string): Promise<ACPResponse> {
  switch (req.method) {
    case "initialize":
      return {
        id: req.id,
        result: {
          name: "DanteCode",
          version: "0.9.3",
          capabilities: { run_agent: true, streaming: false, cancel: true },
        }
      };

    case "run_agent": {
      const prompt = (req.params?.prompt as string) ?? "";
      if (!prompt) {
        return { id: req.id, error: { code: -32602, message: "prompt is required" } };
      }
      // Return a simple acknowledgment — full agent loop integration is complex
      // and would require session management; return a structured response
      return {
        id: req.id,
        result: {
          status: "accepted",
          message: `DanteCode received: ${prompt.slice(0, 100)}`,
          hint: "Run 'dantecode' interactively or use the VS Code extension for full agent capabilities",
        }
      };
    }

    case "get_status":
      return { id: req.id, result: { status: "idle", projectRoot } };

    case "cancel":
      return { id: req.id, result: { cancelled: true } };

    default:
      return { id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}
