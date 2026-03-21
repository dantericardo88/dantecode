// ============================================================================
// @dantecode/debug-trail — Trail Store
// Append-only JSONL-based persistent store (AgentFS-inspired SQLite semantics).
// Lives outside the worktree at ~/.dantecode/debug-trail/.
// Zero native binary dependencies — JSONL + JSON index, durable and queryable.
// ============================================================================

import { appendFile, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  TrailEvent,
  DeleteTombstone,
  TrailRetentionDecision,
  FileSnapshotRecord,
} from "./types.js";

// ---------------------------------------------------------------------------
// Store paths
// ---------------------------------------------------------------------------

export function getStorePaths(storageRoot: string) {
  return {
    root: storageRoot,
    eventsLog: join(storageRoot, "events.jsonl"),
    snapshotsDir: join(storageRoot, "snapshots"),
    tombstonesLog: join(storageRoot, "tombstones.jsonl"),
    retentionLog: join(storageRoot, "retention.jsonl"),
    indexFile: join(storageRoot, "index.json"),
    sessionsFile: join(storageRoot, "sessions.json"),
    // Gap 2: snapshot manifest log
    snapshotManifestLog: join(storageRoot, "snapshots.jsonl"),
  };
}

// ---------------------------------------------------------------------------
// Store index structure (in-memory + persisted as JSON)
// ---------------------------------------------------------------------------

export interface TrailIndex {
  /** sessionId → array of event IDs */
  bySession: Record<string, string[]>;
  /** filePath → array of event IDs */
  byFile: Record<string, string[]>;
  /** TrailEventKind → array of event IDs */
  byKind: Record<string, string[]>;
  /** eventId → seq for fast lookup */
  seqByEvent: Record<string, number>;
  /** Last seq number written */
  lastSeq: number;
}

export interface SessionRecord {
  sessionId: string;
  runId: string;
  startedAt: string;
  lastEventAt: string;
  eventCount: number;
  pinned: boolean;
}

// ---------------------------------------------------------------------------
// Trail Store
// ---------------------------------------------------------------------------

export class TrailStore {
  private paths: ReturnType<typeof getStorePaths>;
  private index: TrailIndex = {
    bySession: {},
    byFile: {},
    byKind: {},
    seqByEvent: {},
    lastSeq: 0,
  };
  private sessions: Record<string, SessionRecord> = {};
  /** In-memory event cache — populated on init, kept in sync on appendEvent/rebuildIndex. */
  private eventMap = new Map<string, TrailEvent>();
  private ready = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(storageRoot: string) {
    this.paths = getStorePaths(storageRoot);
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.ready) return;
    await mkdir(this.paths.root, { recursive: true });
    await mkdir(this.paths.snapshotsDir, { recursive: true });
    await this.loadIndex();
    await this.loadSessions();
    await this.loadEvents();
    // Rebuild index from events if index.json was entirely absent — events.jsonl is authoritative.
    // Only triggers when the file does not exist (not when it exists but is corrupted).
    // Handles cross-instance reads where appendEvent() was called before flush() persisted
    // the index (e.g. TrailStore A appends events without flush(); TrailStore B reads them).
    if (
      this.eventMap.size > 0 &&
      Object.keys(this.index.bySession).length === 0 &&
      !existsSync(this.paths.indexFile)
    ) {
      for (const event of this.eventMap.values()) {
        this.indexSingleEvent(event);
      }
    }
    this.ready = true;
  }

  private async loadEvents(): Promise<void> {
    const events = await this.readJsonlFile<TrailEvent>(
      this.paths.eventsLog,
      this.paths.eventsLog + ".corrupt",
    );
    for (const e of events) {
      this.eventMap.set(e.id, e);
    }
  }

  private async loadIndex(): Promise<void> {
    if (!existsSync(this.paths.indexFile)) return;
    try {
      const raw = await readFile(this.paths.indexFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<TrailIndex>;
      this.index = {
        bySession: parsed.bySession ?? {},
        byFile: parsed.byFile ?? {},
        byKind: parsed.byKind ?? {},
        seqByEvent: parsed.seqByEvent ?? {},
        lastSeq: parsed.lastSeq ?? 0,
      };
    } catch {
      // corrupt index — start fresh (events.jsonl is the source of truth)
    }
  }

  private async loadSessions(): Promise<void> {
    if (!existsSync(this.paths.sessionsFile)) return;
    try {
      const raw = await readFile(this.paths.sessionsFile, "utf8");
      this.sessions = JSON.parse(raw) as Record<string, SessionRecord>;
    } catch {
      this.sessions = {};
    }
  }

  private async persistIndex(): Promise<void> {
    await writeFile(this.paths.indexFile, JSON.stringify(this.index, null, 2), "utf8");
  }

  private async persistSessions(): Promise<void> {
    await writeFile(this.paths.sessionsFile, JSON.stringify(this.sessions, null, 2), "utf8");
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistIndex().catch(() => {});
      void this.persistSessions().catch(() => {});
    }, 500);
  }

  // -------------------------------------------------------------------------
  // Generic JSONL reader — shared by readAllEvents, readAllTombstones, readAllSnapshotRecords
  // -------------------------------------------------------------------------

  private async readJsonlFile<T>(jsonlPath: string, corruptPath: string): Promise<T[]> {
    if (!existsSync(jsonlPath)) return [];
    const raw = await readFile(jsonlPath, "utf8");
    const results: T[] = [];
    let byteOffset = 0;
    for (const line of raw.split("\n")) {
      if (line.trim()) {
        try {
          results.push(JSON.parse(line) as T);
        } catch {
          void appendFile(
            corruptPath,
            JSON.stringify({ line, byteOffset, corruptedAt: new Date().toISOString() }) + "\n",
            "utf8",
          ).catch(() => {});
        }
      }
      byteOffset += line.length + 1;
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Single-event index update — shared by appendEvent and rebuildIndex
  // Note: does NOT update session records (only appendEvent does that).
  // -------------------------------------------------------------------------

  private indexSingleEvent(event: TrailEvent): void {
    const sid = event.provenance.sessionId;
    if (!this.index.bySession[sid]) this.index.bySession[sid] = [];
    this.index.bySession[sid]!.push(event.id);

    if (event.payload["filePath"] && typeof event.payload["filePath"] === "string") {
      const fp = event.payload["filePath"] as string;
      if (!this.index.byFile[fp]) this.index.byFile[fp] = [];
      this.index.byFile[fp]!.push(event.id);
    }

    if (!this.index.byKind[event.kind]) this.index.byKind[event.kind] = [];
    this.index.byKind[event.kind]!.push(event.id);

    this.index.seqByEvent[event.id] = event.seq;
    this.index.lastSeq = Math.max(this.index.lastSeq, event.seq);
  }

  // -------------------------------------------------------------------------
  // Append event (hot path — <5ms target)
  // -------------------------------------------------------------------------

  async appendEvent(event: TrailEvent): Promise<void> {
    await this.ensureReady();
    const line = JSON.stringify(event) + "\n";
    await appendFile(this.paths.eventsLog, line, "utf8");

    // Update in-memory index and event cache
    this.indexSingleEvent(event);
    this.eventMap.set(event.id, event);

    // Update session record
    const sid = event.provenance.sessionId;
    const now = event.timestamp;
    if (!this.sessions[sid]) {
      this.sessions[sid] = {
        sessionId: sid,
        runId: event.provenance.runId,
        startedAt: now,
        lastEventAt: now,
        eventCount: 0,
        pinned: false,
      };
    }
    const sess = this.sessions[sid]!;
    sess.lastEventAt = now;
    sess.eventCount++;

    // Debounced persist — coalesces rapid writes into a single disk flush
    this.schedulePersist();
  }

  // -------------------------------------------------------------------------
  // Append tombstone
  // -------------------------------------------------------------------------

  async appendTombstone(tombstone: DeleteTombstone): Promise<void> {
    await this.ensureReady();
    const line = JSON.stringify(tombstone) + "\n";
    await appendFile(this.paths.tombstonesLog, line, "utf8");
  }

  // -------------------------------------------------------------------------
  // Append retention decision
  // -------------------------------------------------------------------------

  async appendRetentionDecision(decision: TrailRetentionDecision): Promise<void> {
    await this.ensureReady();
    const line = JSON.stringify(decision) + "\n";
    await appendFile(this.paths.retentionLog, line, "utf8");
  }

  // -------------------------------------------------------------------------
  // Query events
  // -------------------------------------------------------------------------

  /** Read all events from the JSONL log. */
  async readAllEvents(): Promise<TrailEvent[]> {
    await this.ensureReady();
    return this.readJsonlFile<TrailEvent>(this.paths.eventsLog, this.paths.eventsLog + ".corrupt");
  }

  /** Query events by session ID. O(k) via in-memory index + event cache. */
  async queryBySession(sessionId: string): Promise<TrailEvent[]> {
    await this.ensureReady();
    const ids = this.index.bySession[sessionId] ?? [];
    return ids.flatMap((id) => {
      const e = this.eventMap.get(id);
      return e ? [e] : [];
    });
  }

  /** Query events by file path (exact or prefix match). O(files + k) via index + event cache. */
  async queryByFile(filePath: string): Promise<TrailEvent[]> {
    await this.ensureReady();
    const seen = new Set<string>();
    const results: TrailEvent[] = [];
    for (const [fp, ids] of Object.entries(this.index.byFile)) {
      if (fp === filePath || fp.startsWith(filePath)) {
        for (const id of ids) {
          if (!seen.has(id)) {
            seen.add(id);
            const e = this.eventMap.get(id);
            if (e) results.push(e);
          }
        }
      }
    }
    return results;
  }

  /** Query events by kind. O(k) via in-memory index + event cache. */
  async queryByKind(kind: string): Promise<TrailEvent[]> {
    await this.ensureReady();
    const ids = this.index.byKind[kind] ?? [];
    return ids.flatMap((id) => {
      const e = this.eventMap.get(id);
      return e ? [e] : [];
    });
  }

  /** Query events matching a text search (actor, summary, payload). O(n) in-memory scan. */
  async queryByText(search: string): Promise<TrailEvent[]> {
    await this.ensureReady();
    const lower = search.toLowerCase();
    return Array.from(this.eventMap.values()).filter(
      (e) =>
        e.actor.toLowerCase().includes(lower) ||
        e.summary.toLowerCase().includes(lower) ||
        JSON.stringify(e.payload).toLowerCase().includes(lower),
    );
  }

  /** Read all tombstones. */
  async readAllTombstones(): Promise<DeleteTombstone[]> {
    await this.ensureReady();
    return this.readJsonlFile<DeleteTombstone>(
      this.paths.tombstonesLog,
      this.paths.tombstonesLog + ".corrupt",
    );
  }

  // -------------------------------------------------------------------------
  // Snapshot manifest (Gap 2)
  // -------------------------------------------------------------------------

  /** Append a snapshot record to the manifest log. */
  async appendSnapshotRecord(record: FileSnapshotRecord): Promise<void> {
    await this.ensureReady();
    const line = JSON.stringify(record) + "\n";
    await appendFile(this.paths.snapshotManifestLog, line, "utf8");
  }

  /** Read all snapshot records from the manifest log. */
  async readAllSnapshotRecords(): Promise<FileSnapshotRecord[]> {
    await this.ensureReady();
    return this.readJsonlFile<FileSnapshotRecord>(
      this.paths.snapshotManifestLog,
      this.paths.snapshotManifestLog + ".corrupt",
    );
  }

  /** Get session records. */
  getSessions(): Record<string, SessionRecord> {
    return this.sessions;
  }

  /** Get the last seq used. */
  getLastSeq(): number {
    return this.index.lastSeq;
  }

  /** Rebuild the in-memory index and event cache by re-reading the entire events JSONL. */
  async rebuildIndex(): Promise<void> {
    await this.ensureReady();
    const events = await this.readAllEvents();
    this.index = { bySession: {}, byFile: {}, byKind: {}, seqByEvent: {}, lastSeq: 0 };
    this.eventMap.clear();
    for (const event of events) {
      this.indexSingleEvent(event);
      this.eventMap.set(event.id, event);
    }
    await this.persistIndex();
  }

  /** Path to the events JSONL file (used by streaming readers). */
  eventsLogPath(): string {
    return this.paths.eventsLog;
  }

  /** Pin a session (prevent pruning). */
  async pinSession(sessionId: string): Promise<void> {
    await this.ensureReady();
    if (this.sessions[sessionId]) {
      this.sessions[sessionId]!.pinned = true;
      await this.persistSessions();
    }
  }

  /** Flush index to disk immediately, cancelling any pending debounce timer. */
  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persistIndex();
    await this.persistSessions();
  }

  // -------------------------------------------------------------------------
  // Snapshot storage path
  // -------------------------------------------------------------------------

  snapshotPath(snapshotId: string): string {
    return join(this.paths.snapshotsDir, `${snapshotId}.bin`);
  }

  snapshotsDir(): string {
    return this.paths.snapshotsDir;
  }

  // -------------------------------------------------------------------------
  // Ensure initialized
  // -------------------------------------------------------------------------

  private async ensureReady(): Promise<void> {
    if (!this.ready) await this.init();
  }

  /** Check if storage is accessible. */
  async healthCheck(): Promise<{ ok: boolean; storageRoot: string; error?: string }> {
    try {
      await access(this.paths.root);
      return { ok: true, storageRoot: this.paths.root };
    } catch (err) {
      return {
        ok: false,
        storageRoot: this.paths.root,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// Singleton map (one store per storageRoot)
const storeCache = new Map<string, TrailStore>();

export function getTrailStore(storageRoot: string): TrailStore {
  if (!storeCache.has(storageRoot)) {
    storeCache.set(storageRoot, new TrailStore(storageRoot));
  }
  return storeCache.get(storageRoot)!;
}
