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
  /** Filter by actor name (case-insensitive substring). */
  actor?: string;
  /** Multiple actor names (OR). Overrides `actor` when both are set. */
  actors?: string[];
  /** Exclude events from this actor (case-insensitive substring). */
  excludeActor?: string;
  /** Exclude events of these kinds. Applied after all positive filters. */
  excludeKinds?: TrailEventKind[];
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

  // Time range detection — two relative expression patterns, then named periods.
  // Pattern A: "3 hours ago", "2 days ago"
  const relativeMatch = nl.match(/(\d+)\s*(hour|hr|minute|min|day|week)s?\s+ago/i);
  // Pattern B: "in the last N hours", "over the past N days", "past N minutes"
  const lastNMatch = !relativeMatch
    ? nl.match(/(?:in\s+the\s+last|over\s+the\s+past|past)\s+(\d+)\s*(hour|hr|minute|min|day|week)s?/i)
    : null;
  const timeMatch = relativeMatch ?? lastNMatch;
  if (timeMatch) {
    const amount = parseInt(timeMatch[1]!, 10);
    const unit = timeMatch[2]!.toLowerCase();
    const ms =
      unit === "week" ? amount * 7 * 86_400_000 :
      unit === "day"  ? amount * 86_400_000 :
      unit === "hour" || unit === "hr" ? amount * 3_600_000 :
      amount * 60_000; // minute / min
    query.afterDate = new Date(Date.now() - ms).toISOString();
  } else if (lower.includes("yesterday")) {
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

  // Negation detection — specific "except/excluding/without/not <term>" patterns.
  // These take priority over positive detection to avoid conflicting filters.
  const negatedErrors = /\b(?:except|excluding|without|not)\s+(?:error|fail|failed|exception|crash)\w*/i.test(nl);
  const negatedDeletes = /\b(?:except|excluding|without|not)\s+(?:delet|remov|erase)\w*/i.test(nl);
  if (negatedErrors) query.excludeKinds = [...(query.excludeKinds ?? []), "error", "retry"];
  if (negatedDeletes) query.excludeKinds = [...(query.excludeKinds ?? []), "file_delete"];

  // Positive event kind detection (skip terms already handled by negation above)
  if (!negatedErrors && ERROR_KEYWORDS.some((k) => lower.includes(k))) {
    query.errorsOnly = true;
  }
  if (!negatedDeletes && DELETE_KEYWORDS.some((k) => lower.includes(k))) {
    query.kinds = [...(query.kinds ?? []), "file_delete"];
  }
  if (WRITE_KEYWORDS.some((k) => lower.includes(k)) && !query.kinds) {
    query.kinds = ["file_write"];
  }

  // Actor detection — multi-actor OR takes priority over single-actor match.
  // Matches 2+ capitalized words joined by " or ": "Alice or Bob", "Alice or Bob or Carol"
  const actorOrMatch = nl.match(/[A-Z][a-zA-Z]+(?:\s+or\s+[A-Z][a-zA-Z]+)+/);
  if (actorOrMatch) {
    query.actors = actorOrMatch[0].split(/\s+or\s+/i);
  } else {
    const actorMatch = nl.match(/(?:by|from|what did)\s+([A-Z][a-zA-Z]+)/);
    if (actorMatch?.[1]) query.actor = actorMatch[1];
  }

  // F7: resolve mutually exclusive filters — errorsOnly and kinds can't both be set.
  // kinds wins: the user named specific event types, which is more explicit than errorsOnly.
  if (query.kinds && query.kinds.length > 0 && query.errorsOnly) {
    delete query.errorsOnly;
  }

  // File path extraction — file with extension (expanded list)
  const fileMatch = nl.match(/[\w\-./]+\.(ts|js|json|md|tsx|jsx|py|sh|yaml|yml|env|css|html|rs|go|java|rb|php|c|cpp|h)\b/i);
  if (fileMatch?.[0]) {
    query.text = fileMatch[0];
  } else {
    // Directory path detection — slash-separated path without extension.
    // Require first segment to start with a letter to avoid matching "10/20 files" etc.
    const dirMatch = nl.match(/(?:^|\s)(\.\/|\/)?([a-zA-Z][\w-]*(?:\/[\w-]+)+)(?=\s|$)/);
    if (dirMatch?.[2] && !dirMatch[2].includes("http")) {
      query.filePathPrefix = (dirMatch[1] ?? "") + dirMatch[2];
      delete query.text;
    } else if (query.kinds || query.errorsOnly || query.actor || query.actors || query.excludeKinds) {
      // Positive/negative filters already narrow results — drop raw NL text to avoid no-matches
      delete query.text;
    }
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
  // F2: de-duplicate concurrent cache-miss reads — all callers share the same in-flight Promise.
  private pendingRead: Promise<TrailEvent[]> | null = null;

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
      results = results.filter((e) => {
        if (typeof e.payload["filePath"] !== "string") return false;
        const fp = e.payload["filePath"] as string;
        const prefix = q.filePathPrefix!;
        return fp === prefix || fp.startsWith(prefix + "/") || fp.startsWith(prefix + "\\");
      });
    }

    if (q.kinds && q.kinds.length > 0) {
      const kindSet = new Set(q.kinds);
      results = results.filter((e) => kindSet.has(e.kind));
    }

    if (q.actors && q.actors.length > 0) {
      results = results.filter((e) =>
        q.actors!.some((a) => e.actor.toLowerCase().includes(a.toLowerCase())),
      );
    } else if (q.actor) {
      const actorLower = q.actor.toLowerCase();
      results = results.filter((e) => e.actor.toLowerCase().includes(actorLower));
    }

    if (q.excludeActor) {
      const excLower = q.excludeActor.toLowerCase();
      results = results.filter((e) => !e.actor.toLowerCase().includes(excLower));
    }

    if (q.excludeKinds && q.excludeKinds.length > 0) {
      const excludeSet = new Set(q.excludeKinds);
      results = results.filter((e) => !excludeSet.has(e.kind));
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
   * Stream events from disk line-by-line without loading all into memory.
   * Use for large trails (100K+ events) where readAllEvents() is too expensive.
   * For in-memory filtered queries, use query() instead — it uses the cache.
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

    // F3: try/finally ensures rl.close() is called even on early break/return from the caller.
    try {
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
    } finally {
      rl.close();
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async getEvents(): Promise<TrailEvent[]> {
    if (this.cachedEvents && Date.now() - this.cacheTime < TrailQueryEngine.CACHE_TTL_MS) {
      return this.cachedEvents;
    }
    // F2: if a read is already in flight, return the same Promise — no duplicate disk reads.
    if (this.pendingRead) return this.pendingRead;
    this.pendingRead = this.store.readAllEvents().then((events) => {
      this.cachedEvents = events;
      this.cacheTime = Date.now();
      this.pendingRead = null;
      return events;
    });
    return this.pendingRead;
  }

  /** Invalidate cache (call after new events are appended). */
  invalidateCache(): void {
    this.cachedEvents = null;
    this.cacheTime = 0;
    this.pendingRead = null; // F2: also cancel any in-flight read so next caller gets fresh data.
  }

  private async ensureReady(): Promise<void> {
    if (!this.initialized) await this.init();
  }
}
