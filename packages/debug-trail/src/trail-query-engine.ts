// ============================================================================
// @dantecode/debug-trail — Trail Query Engine
// Searchable forensic history: by file, action, error, session, natural language.
// PRD target: <200ms complex query latency on representative fixture sets.
// ============================================================================

import type {
  TrailEvent,
  TrailEventKind,
  DebugTrailResult,
  DebugTrailConfig,
} from "./types.js";
import { defaultConfig } from "./types.js";
import { TrailStore, getTrailStore } from "./sqlite-store.js";
import { TrailEventIndex } from "./state/trail-index.js";

// ---------------------------------------------------------------------------
// Structured error code vocabulary
// ---------------------------------------------------------------------------

/** Structured error code vocabulary for all debug-trail engine errors. */
export const TrailErrorCode = {
  SNAPSHOT_NOT_FOUND: "snapshot_not_found",
  TARGET_EXISTS: "target_exists",
  WRITE_FAILED: "write_failed",
  DRY_RUN: "dry_run",
  HASH_MISMATCH: "hash_mismatch",
  DISK_WRITE_ERROR: "disk_write_error",
  DISPATCH_FAILED: "dispatch_failed",
  QUOTA_EXCEEDED: "quota_exceeded",
  PRIVACY_EXCLUDED: "privacy_excluded",
} as const;
export type TrailErrorCode = (typeof TrailErrorCode)[keyof typeof TrailErrorCode];

// ---------------------------------------------------------------------------
// Query types
// ---------------------------------------------------------------------------

export interface TrailQuery {
  /** Natural language or text search across all fields. */
  text?: string;
  /** Filter by session ID. */
  sessionId?: string;
  /** Filter by exact file path. */
  filePath?: string;
  /** Filter by file path prefix (directory). */
  filePathPrefix?: string;
  /** Filter by event kind(s). */
  kinds?: TrailEventKind[];
  /** Filter by actor name. */
  actor?: string;
  /** Filter by date range (ISO-8601). */
  afterDate?: string;
  /** Filter by date range (ISO-8601). */
  beforeDate?: string;
  /** Filter to only error events. */
  errorsOnly?: boolean;
  /** Filter to only file events (write/delete/move/restore). */
  fileEventsOnly?: boolean;
  /** Filter to events with anomaly flags. */
  anomaliesOnly?: boolean;
  /** Max results to return. Default: 50. */
  limit?: number;
  /** Skip first N results. */
  offset?: number;
  /** Sort order. Default: desc (newest first). */
  order?: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Natural language query parser
// Converts phrases like "what erased auth.ts yesterday" into structured queries.
// ---------------------------------------------------------------------------

const ERROR_KEYWORDS = ["error", "fail", "failed", "exception", "crash", "broken"];
const DELETE_KEYWORDS = ["delet", "erase", "remov", "rm ", "destroyed", "gone", "missing"];
const WRITE_KEYWORDS = ["writ", "edit", "modif", "chang", "updat", "creat"];

export function parseNaturalLanguageQuery(nl: string): TrailQuery {
  const lower = nl.toLowerCase();
  const query: TrailQuery = { text: nl };

  // Time range detection
  if (lower.includes("yesterday")) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);
    query.afterDate = yesterday.toISOString();
    query.beforeDate = endOfYesterday.toISOString();
  } else if (lower.includes("last week")) {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    query.afterDate = weekAgo.toISOString();
  } else if (lower.includes("today")) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    query.afterDate = today.toISOString();
  } else if (lower.includes("last hour")) {
    const hourAgo = new Date();
    hourAgo.setHours(hourAgo.getHours() - 1);
    query.afterDate = hourAgo.toISOString();
  }

  // Event kind detection
  if (ERROR_KEYWORDS.some((k) => lower.includes(k))) {
    query.errorsOnly = true;
  }
  if (DELETE_KEYWORDS.some((k) => lower.includes(k))) {
    query.kinds = [...(query.kinds ?? []), "file_delete"];
    if (!query.errorsOnly) delete query.errorsOnly;
  }
  if (WRITE_KEYWORDS.some((k) => lower.includes(k)) && !query.kinds) {
    query.kinds = ["file_write"];
  }

  // File path extraction — look for common extensions or path patterns
  const fileMatch = nl.match(/[\w\-./]+\.(ts|js|json|md|tsx|jsx|py|sh|yaml|yml|env)\b/i);
  if (fileMatch?.[0]) {
    query.text = fileMatch[0];
  } else if (query.kinds || query.errorsOnly) {
    // Kind/error filters already narrow results — don't also apply the raw NL as a text filter
    // (it would match nothing since event summaries don't contain the query phrase)
    delete query.text;
  }

  return query;
}

// ---------------------------------------------------------------------------
// Trail Query Engine
// ---------------------------------------------------------------------------

export class TrailQueryEngine {
  private config: DebugTrailConfig;
  private store: TrailStore;
  private index: TrailEventIndex;
  private initialized = false;
  private cachedEvents: TrailEvent[] | null = null;
  private cacheTime = 0;
  private static CACHE_TTL_MS = 10_000; // 10s cache

  constructor(config?: Partial<DebugTrailConfig>, index?: TrailEventIndex) {
    this.config = { ...defaultConfig(), ...config };
    this.store = getTrailStore(this.config.storageRoot);
    this.index = index ?? new TrailEventIndex();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.store.init();
    const events = await this.store.readAllEvents();
    this.index.bulkIndex(events);
    this.cachedEvents = events;
    this.cacheTime = Date.now();
    this.initialized = true;
  }

  /** Warm the index from an external AuditLogger's index. */
  warmFromIndex(index: TrailEventIndex): void {
    this.index = index;
    this.initialized = true;
  }

  // -------------------------------------------------------------------------
  // Main query method
  // -------------------------------------------------------------------------

  async query(queryOrText: TrailQuery | string): Promise<DebugTrailResult> {
    await this.ensureReady();
    const start = Date.now();

    const q: TrailQuery = typeof queryOrText === "string"
      ? parseNaturalLanguageQuery(queryOrText)
      : queryOrText;

    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;
    const order = q.order ?? "desc";

    // Load events (with caching)
    const allEvents = await this.getEvents();

    // Apply filters
    let results = allEvents;

    if (q.sessionId) {
      results = results.filter((e) => e.provenance.sessionId === q.sessionId);
    }

    if (q.filePath) {
      results = results.filter((e) => e.payload["filePath"] === q.filePath);
    }

    if (q.filePathPrefix) {
      results = results.filter(
        (e) =>
          typeof e.payload["filePath"] === "string" &&
          (e.payload["filePath"] as string).startsWith(q.filePathPrefix!),
      );
    }

    if (q.kinds && q.kinds.length > 0) {
      const kindSet = new Set(q.kinds);
      results = results.filter((e) => kindSet.has(e.kind));
    }

    if (q.actor) {
      const actorLower = q.actor.toLowerCase();
      results = results.filter((e) => e.actor.toLowerCase().includes(actorLower));
    }

    if (q.errorsOnly) {
      results = results.filter((e) => e.kind === "error" || e.kind === "retry");
    }

    if (q.fileEventsOnly) {
      const fileKinds = new Set<TrailEventKind>([
        "file_write",
        "file_delete",
        "file_move",
        "file_restore",
      ]);
      results = results.filter((e) => fileKinds.has(e.kind));
    }

    if (q.anomaliesOnly) {
      results = results.filter((e) => e.kind === "anomaly_flag");
    }

    if (q.afterDate) {
      const after = new Date(q.afterDate).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() >= after);
    }

    if (q.beforeDate) {
      const before = new Date(q.beforeDate).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() <= before);
    }

    if (q.text && q.text.length > 0) {
      const textLower = q.text.toLowerCase();
      results = results.filter(
        (e) =>
          e.actor.toLowerCase().includes(textLower) ||
          e.summary.toLowerCase().includes(textLower) ||
          JSON.stringify(e.payload).toLowerCase().includes(textLower),
      );
    }

    // Sort
    results = results.sort((a, b) => {
      const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return order === "desc" ? -diff : diff;
    });

    const totalMatches = results.length;

    // Paginate
    results = results.slice(offset, offset + limit);

    return {
      query: typeof queryOrText === "string" ? queryOrText : undefined,
      results,
      latencyMs: Date.now() - start,
      totalMatches,
    };
  }

  /** Convenience: query by file path. */
  async queryFile(filePath: string, limit = 50): Promise<DebugTrailResult> {
    return this.query({ filePath, limit, order: "desc" });
  }

  /** Convenience: query recent errors. */
  async queryErrors(sessionId?: string, limit = 20): Promise<DebugTrailResult> {
    return this.query({ errorsOnly: true, sessionId, limit, order: "desc" });
  }

  /** Convenience: query by session. */
  async querySession(sessionId: string, limit = 200): Promise<DebugTrailResult> {
    return this.query({ sessionId, limit, order: "asc" });
  }

  /** Get the most recent error event for a session. Returns null if none. */
  async getLatestError(sessionId?: string): Promise<import("./types.js").TrailEvent | null> {
    const result = await this.query({ sessionId, errorsOnly: true, limit: 1, order: "desc" });
    return result.results[0] ?? null;
  }

  /** List all sessions in the trail. */
  async listSessions(): Promise<string[]> {
    await this.ensureReady();
    return this.index.getSessions();
  }

  /** List all files that have trail events. */
  async listFiles(): Promise<string[]> {
    await this.ensureReady();
    return this.index.getFiles();
  }

  /**
   * Stream events from the JSONL file line-by-line without loading all into memory.
   * Use for large trails (100K+ events) where readAllEvents() is too expensive.
   */
  async *streamEvents(
    filter?: (e: import("./types.js").TrailEvent) => boolean,
  ): AsyncGenerator<import("./types.js").TrailEvent> {
    await this.ensureReady();
    const logPath = this.store.eventsLogPath();
    const { existsSync } = await import("node:fs");
    if (!existsSync(logPath)) return;

    const { createReadStream } = await import("node:fs");
    const { createInterface } = await import("node:readline");

    const rl = createInterface({
      input: createReadStream(logPath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as import("./types.js").TrailEvent;
        if (!filter || filter(event)) {
          yield event;
        }
      } catch {
        // malformed line — skip silently
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async getEvents(): Promise<TrailEvent[]> {
    if (this.cachedEvents && Date.now() - this.cacheTime < TrailQueryEngine.CACHE_TTL_MS) {
      return this.cachedEvents;
    }
    const events = await this.store.readAllEvents();
    this.cachedEvents = events;
    this.cacheTime = Date.now();
    return events;
  }

  /** Invalidate cache (call after new events are appended). */
  invalidateCache(): void {
    this.cachedEvents = null;
    this.cacheTime = 0;
  }

  private async ensureReady(): Promise<void> {
    if (!this.initialized) await this.init();
  }
}
