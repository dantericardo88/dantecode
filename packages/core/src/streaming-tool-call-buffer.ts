// packages/core/src/streaming-tool-call-buffer.ts
// Streaming tool-call delta buffer — queued P0 from Screenshot-to-code harvest.
//
// Harvested from: Screenshot-to-code streaming tool-call buffering,
//                 Anthropic streaming tool_use events, Cline partial JSON display.
//
// Provides:
//   - Partial JSON argument accumulator for real-time display during streaming
//   - Throttled emission at configurable chunk rate (default: 18 chunks/sec)
//   - Tool-call lifecycle: pending → streaming → complete → error
//   - Multi-tool concurrent tracking (parallel tool calls)
//   - Prompt-ready formatting of in-flight tool calls

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolCallStatus = "pending" | "streaming" | "complete" | "error";

export interface ToolCallDelta {
  toolCallId: string;
  /** Partial JSON string received so far */
  partialArgs: string;
  /** Whether the args JSON is parseable yet */
  isParseable: boolean;
  /** Parsed args if parseable */
  parsedArgs?: Record<string, unknown>;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  status: ToolCallStatus;
  /** Accumulated raw JSON string */
  rawArgs: string;
  /** Latest parseable snapshot of args */
  latestParsedArgs?: Record<string, unknown>;
  /** Chunks received */
  chunkCount: number;
  /** ISO timestamp when streaming started */
  startedAt: string;
  /** ISO timestamp when complete */
  completedAt?: string;
  /** Error message if status === "error" */
  errorMessage?: string;
  /** Result returned by the tool */
  result?: unknown;
}

export interface EmissionEvent {
  toolCallId: string;
  delta: ToolCallDelta;
  isThrottled: boolean;
}

export type EmissionCallback = (event: EmissionEvent) => void;

export interface StreamingBufferOptions {
  /** Max emissions per second per tool call (default: 18) */
  maxChunksPerSec?: number;
  /** Whether to attempt JSON parsing on each chunk (default: true) */
  parsePartial?: boolean;
  /** Max concurrent tool calls tracked (default: 10) */
  maxConcurrent?: number;
}

// ─── Partial JSON Parser ──────────────────────────────────────────────────────

/**
 * Attempt to parse a partial JSON string by closing unclosed brackets/braces.
 * Returns parsed object or undefined if not recoverable.
 */
export function tryParsePartialJson(raw: string): Record<string, unknown> | undefined {
  if (!raw.trim().startsWith("{")) return undefined;

  // Count open brackets that need closing
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const ch of raw) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  // Close any unclosed string
  let attempt = raw;
  if (inString) attempt += '"';

  // Close remaining brackets in reverse order
  attempt += stack.reverse().join("");

  try {
    return JSON.parse(attempt) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// ─── Streaming Tool Call Buffer ───────────────────────────────────────────────

let _toolCallCounter = 0;

export class StreamingToolCallBuffer {
  private _calls = new Map<string, ToolCallRecord>();
  private _lastEmitted = new Map<string, number>(); // toolCallId → timestamp
  private readonly _maxChunksPerSec: number;
  private readonly _parsePartial: boolean;
  private readonly _maxConcurrent: number;
  private _callbacks: EmissionCallback[] = [];

  constructor(opts: StreamingBufferOptions = {}) {
    this._maxChunksPerSec = opts.maxChunksPerSec ?? 18;
    this._parsePartial = opts.parsePartial ?? true;
    this._maxConcurrent = opts.maxConcurrent ?? 10;
  }

  onEmit(cb: EmissionCallback): () => void {
    this._callbacks.push(cb);
    return () => { this._callbacks = this._callbacks.filter((c) => c !== cb); };
  }

  /**
   * Register a new tool call starting to stream.
   */
  startToolCall(name: string, id?: string): string {
    const toolCallId = id ?? `tc-${++_toolCallCounter}`;

    if (this._calls.size >= this._maxConcurrent) {
      // Evict oldest complete/error call
      for (const [key, call] of this._calls) {
        if (call.status === "complete" || call.status === "error") {
          this._calls.delete(key);
          break;
        }
      }
    }

    this._calls.set(toolCallId, {
      id: toolCallId,
      name,
      status: "streaming",
      rawArgs: "",
      chunkCount: 0,
      startedAt: new Date().toISOString(),
    });

    return toolCallId;
  }

  /**
   * Feed a new delta chunk for a tool call.
   * Returns whether emission was throttled.
   */
  feedDelta(toolCallId: string, chunk: string): boolean {
    const call = this._calls.get(toolCallId);
    if (!call || call.status !== "streaming") return false;

    call.rawArgs += chunk;
    call.chunkCount++;

    // Parse partial if enabled
    let parsedArgs: Record<string, unknown> | undefined;
    if (this._parsePartial) {
      parsedArgs = tryParsePartialJson(call.rawArgs);
      if (parsedArgs) call.latestParsedArgs = parsedArgs;
    }

    // Throttle check
    const now = Date.now();
    const minInterval = 1000 / this._maxChunksPerSec;
    const lastTime = this._lastEmitted.get(toolCallId) ?? 0;
    const isThrottled = now - lastTime < minInterval;

    if (!isThrottled) {
      this._lastEmitted.set(toolCallId, now);
      const delta: ToolCallDelta = {
        toolCallId,
        partialArgs: call.rawArgs,
        isParseable: parsedArgs !== undefined,
        parsedArgs,
      };
      this._emit({ toolCallId, delta, isThrottled: false });
    }

    return isThrottled;
  }

  /**
   * Mark a tool call as complete with its final args.
   */
  completeToolCall(toolCallId: string, result?: unknown): boolean {
    const call = this._calls.get(toolCallId);
    if (!call) return false;

    // Final parse attempt
    try {
      call.latestParsedArgs = JSON.parse(call.rawArgs) as Record<string, unknown>;
    } catch {
      // Keep latestParsedArgs from partial if available
    }

    call.status = "complete";
    call.completedAt = new Date().toISOString();
    call.result = result;

    // Always emit final delta
    const delta: ToolCallDelta = {
      toolCallId,
      partialArgs: call.rawArgs,
      isParseable: call.latestParsedArgs !== undefined,
      parsedArgs: call.latestParsedArgs,
    };
    this._emit({ toolCallId, delta, isThrottled: false });
    return true;
  }

  /**
   * Mark a tool call as errored.
   */
  errorToolCall(toolCallId: string, errorMessage: string): boolean {
    const call = this._calls.get(toolCallId);
    if (!call) return false;
    call.status = "error";
    call.errorMessage = errorMessage;
    call.completedAt = new Date().toISOString();
    return true;
  }

  getCall(toolCallId: string): ToolCallRecord | undefined {
    return this._calls.get(toolCallId);
  }

  getActiveToolCalls(): ToolCallRecord[] {
    return [...this._calls.values()].filter((c) => c.status === "streaming");
  }

  getCompletedToolCalls(): ToolCallRecord[] {
    return [...this._calls.values()].filter((c) => c.status === "complete");
  }

  private _emit(event: EmissionEvent): void {
    for (const cb of this._callbacks) {
      try { cb(event); } catch { /* never let callback crash the buffer */ }
    }
  }

  /**
   * Format all active tool calls for display (e.g. in status bar or progress UI).
   */
  formatActiveForDisplay(): string {
    const active = this.getActiveToolCalls();
    if (active.length === 0) return "";

    return active.map((call) => {
      const preview = call.latestParsedArgs
        ? Object.entries(call.latestParsedArgs)
          .slice(0, 2)
          .map(([k, v]) => `${k}=${JSON.stringify(v)?.slice(0, 30)}`)
          .join(", ")
        : call.rawArgs.slice(0, 50) + (call.rawArgs.length > 50 ? "…" : "");

      return `⚙️ ${call.name}(${preview}) [${call.chunkCount} chunks]`;
    }).join("\n");
  }

  get totalCalls(): number { return this._calls.size; }

  clear(): void {
    this._calls.clear();
    this._lastEmitted.clear();
  }
}

// ─── SSE Adaptive Timeout ─────────────────────────────────────────────────────

/**
 * Plandex-harvested SSE adaptive timeout:
 * base(90s) + slope(90s per 150k tokens)
 *
 * For large context windows, streaming can take much longer — this prevents
 * premature timeout on long model generations.
 */
export function computeSseTimeout(contextTokens: number): number {
  const BASE_MS = 90_000;
  const SLOPE_MS_PER_TOKEN = 90_000 / 150_000; // 90s per 150k tokens
  return Math.round(BASE_MS + SLOPE_MS_PER_TOKEN * contextTokens);
}

/**
 * Clamp SSE timeout between min and max bounds.
 */
export function clampSseTimeout(
  contextTokens: number,
  minMs = 30_000,
  maxMs = 600_000,
): number {
  return Math.min(maxMs, Math.max(minMs, computeSseTimeout(contextTokens)));
}
