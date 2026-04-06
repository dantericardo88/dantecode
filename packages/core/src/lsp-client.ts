// ============================================================================
// Minimal LSP client — JSON-RPC over stdio.
// Only diagnostics (textDocument/publishDiagnostics) is fully implemented;
// definition, references, and hover are thin request wrappers.
// No external dependencies — only node built-ins.
// ============================================================================

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomInt } from "node:crypto";
import { posix } from "node:path";
import type { LspServerConfig } from "./lsp-config.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LspDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  code?: string;
}

export interface LspLocation {
  file: string;
  line: number;
  column: number;
}

// ─── Internal JSON-RPC types ─────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

type IncomingMessage = JsonRpcResponse | JsonRpcNotification;

// ─── LSP severity mapping ─────────────────────────────────────────────────────

function lspSeverityToString(n: number): LspDiagnostic["severity"] {
  switch (n) {
    case 1:  return "error";
    case 2:  return "warning";
    case 3:  return "info";
    default: return "hint";
  }
}

function pathToUri(filePath: string): string {
  const p = filePath.replace(/\\/g, "/");
  const withSlash = p.startsWith("/") ? p : "/" + p;
  return "file://" + withSlash;
}

function uriToPath(uri: string): string {
  return uri.replace(/^file:\/\//, "").replace(/\//g, posix.sep);
}

// ─── LspClient ───────────────────────────────────────────────────────────────

export class LspClient {
  private _process: ChildProcess | undefined;
  private _nextId = 1;
  private _pending = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }>();
  private _diagnostics = new Map<string, LspDiagnostic[]>();
  private _buffer = "";
  private _connected = false;

  constructor(private readonly serverConfig: LspServerConfig) {}

  // ─── connect ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this._connected) return;

    const [cmd, ...defaultArgs] = this.serverConfig.command.split(/\s+/);
    const args = this.serverConfig.args ?? defaultArgs;

    this._process = spawn(cmd ?? this.serverConfig.command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    if (!this._process.stdout || !this._process.stdin) {
      throw new Error(`[LspClient] Failed to spawn LSP server: ${this.serverConfig.command}`);
    }

    this._process.stdout.on("data", (chunk: Buffer) => {
      this._buffer += chunk.toString("utf-8");
      this._processBuffer();
    });

    this._process.stderr?.on("data", (_chunk: Buffer) => {
      // Suppress stderr — language servers write noise here
    });

    this._process.on("exit", () => {
      this._connected = false;
      for (const { reject } of this._pending.values()) {
        reject(new Error("[LspClient] Server exited unexpectedly"));
      }
      this._pending.clear();
    });

    // LSP initialize handshake
    await this._request("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: false },
          hover: { contentFormat: ["plaintext"] },
          definition: { linkSupport: false },
          references: {},
        },
        workspace: { applyEdit: false },
      },
      clientInfo: { name: "dantecode-lsp-client", version: "0.9.2" },
    });

    this._notify("initialized", {});
    this._connected = true;
  }

  // ─── disconnect ───────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    try {
      await this._request("shutdown", null);
      this._notify("exit", null);
    } catch {
      // Best-effort shutdown
    } finally {
      this._process?.kill();
      this._process = undefined;
      this._connected = false;
      this._pending.clear();
    }
  }

  // ─── getDiagnostics ───────────────────────────────────────────────────────

  /**
   * Opens the file, waits for publishDiagnostics, returns the results.
   * Fully implemented — used by the post-edit linting loop.
   */
  async getDiagnostics(
    filePath: string,
    content: string,
  ): Promise<LspDiagnostic[]> {
    this._requireConnected();

    const uri = pathToUri(filePath);
    const version = randomInt(1, 100_000);

    // Wipe any stale diagnostics for this file
    this._diagnostics.delete(uri);

    this._notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: this._inferLanguage(filePath),
        version,
        text: content,
      },
    });

    // Poll for diagnostics (server may push them asynchronously)
    const diags = await this._waitForDiagnostics(uri, 5_000);

    this._notify("textDocument/didClose", {
      textDocument: { uri },
    });

    return diags;
  }

  // ─── getDefinition ────────────────────────────────────────────────────────

  async getDefinition(
    filePath: string,
    line: number,
    char: number,
  ): Promise<LspLocation | null> {
    this._requireConnected();

    const uri = pathToUri(filePath);
    const result = await this._request("textDocument/definition", {
      textDocument: { uri },
      position: { line, character: char },
    });

    const loc = this._parseFirstLocation(result);
    return loc;
  }

  // ─── getReferences ────────────────────────────────────────────────────────

  async getReferences(
    filePath: string,
    line: number,
    char: number,
  ): Promise<LspLocation[]> {
    this._requireConnected();

    const uri = pathToUri(filePath);
    const result = await this._request("textDocument/references", {
      textDocument: { uri },
      position: { line, character: char },
      context: { includeDeclaration: true },
    });

    return this._parseLocationArray(result);
  }

  // ─── getHover ─────────────────────────────────────────────────────────────

  async getHover(
    filePath: string,
    line: number,
    char: number,
  ): Promise<string | null> {
    this._requireConnected();

    const uri = pathToUri(filePath);
    const result = await this._request("textDocument/hover", {
      textDocument: { uri },
      position: { line, character: char },
    });

    if (!result || typeof result !== "object") return null;
    const rec = result as Record<string, unknown>;
    const contents = rec["contents"];
    if (typeof contents === "string") return contents;
    if (isRecord(contents) && typeof contents["value"] === "string") {
      return contents["value"];
    }
    return null;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private _requireConnected(): void {
    if (!this._connected) {
      throw new Error("[LspClient] Not connected — call connect() first");
    }
  }

  private _processBuffer(): void {
    let idx: number;
    while ((idx = this._buffer.indexOf("\r\n\r\n")) !== -1) {
      const header = this._buffer.slice(0, idx);
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch?.[1]) {
        this._buffer = this._buffer.slice(idx + 4);
        continue;
      }
      const length = parseInt(lengthMatch[1], 10);
      const bodyStart = idx + 4;
      if (this._buffer.length < bodyStart + length) break;

      const body = this._buffer.slice(bodyStart, bodyStart + length);
      this._buffer = this._buffer.slice(bodyStart + length);

      try {
        const msg = JSON.parse(body) as IncomingMessage;
        this._handleMessage(msg);
      } catch {
        // Malformed JSON from server — discard
      }
    }
  }

  private _handleMessage(msg: IncomingMessage): void {
    if ("id" in msg && msg.id !== undefined) {
      // Response to a request we sent
      const pending = this._pending.get(msg.id);
      if (pending) {
        this._pending.delete(msg.id);
        const res = msg as JsonRpcResponse;
        if (res.error) {
          pending.reject(new Error(`[LspClient] RPC error: ${res.error.message}`));
        } else {
          pending.resolve(res.result);
        }
      }
    } else {
      // Notification from server
      const notif = msg as JsonRpcNotification;
      if (notif.method === "textDocument/publishDiagnostics") {
        this._handleDiagnostics(notif.params);
      }
    }
  }

  private _handleDiagnostics(params: unknown): void {
    if (!isRecord(params)) return;
    const uri = params["uri"];
    const rawDiags = params["diagnostics"];
    if (typeof uri !== "string" || !Array.isArray(rawDiags)) return;

    const filePath = uriToPath(uri);
    const diags: LspDiagnostic[] = rawDiags
      .filter(isRecord)
      .map((d) => {
        const range = isRecord(d["range"]) ? d["range"] : {};
        const start = isRecord(range["start"]) ? range["start"] : {};
        const code = d["code"];
        return {
          file: filePath,
          line: typeof start["line"] === "number" ? start["line"] : 0,
          column: typeof start["character"] === "number" ? start["character"] : 0,
          severity: lspSeverityToString(
            typeof d["severity"] === "number" ? d["severity"] : 2,
          ),
          message: typeof d["message"] === "string" ? d["message"] : "",
          code: code !== undefined && code !== null ? String(code) : undefined,
        } satisfies LspDiagnostic;
      });

    this._diagnostics.set(uri, diags);
  }

  private async _waitForDiagnostics(
    uri: string,
    timeoutMs: number,
  ): Promise<LspDiagnostic[]> {
    const deadline = Date.now() + timeoutMs;
    const pollMs = 100;
    while (Date.now() < deadline) {
      if (this._diagnostics.has(uri)) {
        return this._diagnostics.get(uri) ?? [];
      }
      await sleep(pollMs);
    }
    // Timeout — return empty rather than error
    return [];
  }

  private _request(method: string, params: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = this._nextId++;
      const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this._pending.set(id, { resolve, reject });
      this._send(msg);
    });
  }

  private _notify(method: string, params: unknown): void {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this._send(msg);
  }

  private _send(msg: unknown): void {
    if (!this._process?.stdin) return;
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
    this._process.stdin.write(header + body, "utf-8");
  }

  private _inferLanguage(filePath: string): string {
    const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    const map: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".jsx": "javascriptreact",
      ".mts": "typescript",
      ".cts": "typescript",
      ".py": "python",
      ".pyi": "python",
      ".go": "go",
      ".rs": "rust",
    };
    return map[ext] ?? "plaintext";
  }

  private _parseFirstLocation(result: unknown): LspLocation | null {
    const locs = this._parseLocationArray(result);
    return locs[0] ?? null;
  }

  private _parseLocationArray(result: unknown): LspLocation[] {
    const arr = Array.isArray(result) ? result : result ? [result] : [];
    return arr.filter(isRecord).map((loc) => {
      const uri = typeof loc["uri"] === "string" ? loc["uri"] : "";
      const range = isRecord(loc["range"]) ? loc["range"] : {};
      const start = isRecord(range["start"]) ? range["start"] : {};
      return {
        file: uriToPath(uri),
        line: typeof start["line"] === "number" ? start["line"] : 0,
        column: typeof start["character"] === "number" ? start["character"] : 0,
      } satisfies LspLocation;
    });
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
