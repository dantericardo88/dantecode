// ============================================================================
// @dantecode/debug-trail — Trail Index
// In-memory search index over trail events: by file, session, action, error.
// ============================================================================

import type { TrailEvent, TrailEventKind } from "../types.js";

// ---------------------------------------------------------------------------
// Index entry
// ---------------------------------------------------------------------------

export interface IndexEntry {
  eventId: string;
  sessionId: string;
  runId: string;
  kind: TrailEventKind;
  actor: string;
  summary: string;
  timestamp: string;
  seq: number;
  filePath?: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Trail Index
// ---------------------------------------------------------------------------

export class TrailEventIndex {
  private bySession = new Map<string, IndexEntry[]>();
  private byFile = new Map<string, IndexEntry[]>();
  private byKind = new Map<string, IndexEntry[]>();
  private byActor = new Map<string, IndexEntry[]>();
  private allEntries: IndexEntry[] = [];

  /** Index a trail event. */
  index(event: TrailEvent): void {
    const filePath =
      typeof event.payload["filePath"] === "string" ? event.payload["filePath"] : undefined;
    const errorMessage =
      typeof event.payload["error"] === "string" ? event.payload["error"] : undefined;

    const entry: IndexEntry = {
      eventId: event.id,
      sessionId: event.provenance.sessionId,
      runId: event.provenance.runId,
      kind: event.kind,
      actor: event.actor,
      summary: event.summary,
      timestamp: event.timestamp,
      seq: event.seq,
      filePath,
      errorMessage,
    };

    this.allEntries.push(entry);

    // Index by session
    const sessionEntries = this.bySession.get(entry.sessionId) ?? [];
    sessionEntries.push(entry);
    this.bySession.set(entry.sessionId, sessionEntries);

    // Index by file
    if (filePath) {
      const fileEntries = this.byFile.get(filePath) ?? [];
      fileEntries.push(entry);
      this.byFile.set(filePath, fileEntries);
    }

    // Index by kind
    const kindEntries = this.byKind.get(entry.kind) ?? [];
    kindEntries.push(entry);
    this.byKind.set(entry.kind, kindEntries);

    // Index by actor
    const actorEntries = this.byActor.get(entry.actor) ?? [];
    actorEntries.push(entry);
    this.byActor.set(entry.actor, actorEntries);
  }

  /** Bulk index events (e.g. on startup from JSONL load). */
  bulkIndex(events: TrailEvent[]): void {
    for (const e of events) this.index(e);
  }

  /** Search by session ID. */
  findBySession(sessionId: string): IndexEntry[] {
    return this.bySession.get(sessionId) ?? [];
  }

  /** Search by file path (exact match). */
  findByFile(filePath: string): IndexEntry[] {
    return this.byFile.get(filePath) ?? [];
  }

  /** Search by file path prefix (e.g. directory). */
  findByFilePrefix(prefix: string): IndexEntry[] {
    const results: IndexEntry[] = [];
    for (const [fp, entries] of this.byFile) {
      if (fp.startsWith(prefix)) results.push(...entries);
    }
    return results;
  }

  /** Search by event kind. */
  findByKind(kind: TrailEventKind): IndexEntry[] {
    return this.byKind.get(kind) ?? [];
  }

  /** Search by actor name. */
  findByActor(actor: string): IndexEntry[] {
    return this.byActor.get(actor) ?? [];
  }

  /** Full-text search across summary and error fields. */
  search(text: string): IndexEntry[] {
    const lower = text.toLowerCase();
    return this.allEntries.filter(
      (e) =>
        e.summary.toLowerCase().includes(lower) ||
        e.actor.toLowerCase().includes(lower) ||
        (e.filePath?.toLowerCase().includes(lower) ?? false) ||
        (e.errorMessage?.toLowerCase().includes(lower) ?? false),
    );
  }

  /** Get all sessions. */
  getSessions(): string[] {
    return Array.from(this.bySession.keys());
  }

  /** Get all indexed files. */
  getFiles(): string[] {
    return Array.from(this.byFile.keys());
  }

  /** Total indexed entries. */
  size(): number {
    return this.allEntries.length;
  }

  /** Clear all. */
  clear(): void {
    this.bySession.clear();
    this.byFile.clear();
    this.byKind.clear();
    this.byActor.clear();
    this.allEntries = [];
  }
}
