// ============================================================================
// @dantecode/debug-trail — Trail Store
// Append-only JSONL-based persistent store (AgentFS-inspired SQLite semantics).
// Lives outside the worktree at ~/.dantecode/debug-trail/.
// Zero native binary dependencies — JSONL + JSON index, durable and queryable.
// ============================================================================

import { appendFile, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TrailEvent, DeleteTombstone, TrailRetentionDecision, FileSnapshotRecord } from "./types.js";

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
  private ready = false;

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
    this.ready = true;
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

  // -------------------------------------------------------------------------
  // Append event (hot path — <5ms target)
  // -------------------------------------------------------------------------

  async appendEvent(event: TrailEvent): Promise<void> {
    await this.ensureReady();
    const line = JSON.stringify(event) + "\n";
    await appendFile(this.paths.eventsLog, line, "utf8");

    // Update in-memory index
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

    // Update session record
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

    // Persist index every 50 events (async — don't await in hot path)
    if (event.seq % 50 === 0) {
      void this.persistIndex();
      void this.persistSessions();
    }
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
    if (!existsSync(this.paths.eventsLog)) return [];
    const raw = await readFile(this.paths.eventsLog, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as TrailEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is TrailEvent => e !== null);
  }

  /** Query events by session ID. */
  async queryBySession(sessionId: string): Promise<TrailEvent[]> {
    const all = await this.readAllEvents();
    return all.filter((e) => e.provenance.sessionId === sessionId);
  }

  /** Query events by file path (exact or prefix match). */
  async queryByFile(filePath: string): Promise<TrailEvent[]> {
    const all = await this.readAllEvents();
    return all.filter((e) => {
      const fp = e.payload["filePath"];
      return typeof fp === "string" && (fp === filePath || fp.startsWith(filePath));
    });
  }

  /** Query events by kind. */
  async queryByKind(kind: string): Promise<TrailEvent[]> {
    const all = await this.readAllEvents();
    return all.filter((e) => e.kind === kind);
  }

  /** Query events matching a text search (actor, summary, payload). */
  async queryByText(search: string): Promise<TrailEvent[]> {
    const lower = search.toLowerCase();
    const all = await this.readAllEvents();
    return all.filter((e) => {
      return (
        e.actor.toLowerCase().includes(lower) ||
        e.summary.toLowerCase().includes(lower) ||
        JSON.stringify(e.payload).toLowerCase().includes(lower)
      );
    });
  }

  /** Read all tombstones. */
  async readAllTombstones(): Promise<DeleteTombstone[]> {
    await this.ensureReady();
    if (!existsSync(this.paths.tombstonesLog)) return [];
    const raw = await readFile(this.paths.tombstonesLog, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as DeleteTombstone;
        } catch {
          return null;
        }
      })
      .filter((t): t is DeleteTombstone => t !== null);
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
    if (!existsSync(this.paths.snapshotManifestLog)) return [];
    const raw = await readFile(this.paths.snapshotManifestLog, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as FileSnapshotRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is FileSnapshotRecord => r !== null);
  }

  /** Get session records. */
  getSessions(): Record<string, SessionRecord> {
    return this.sessions;
  }

  /** Get the last seq used. */
  getLastSeq(): number {
    return this.index.lastSeq;
  }

  /** Pin a session (prevent pruning). */
  async pinSession(sessionId: string): Promise<void> {
    await this.ensureReady();
    if (this.sessions[sessionId]) {
      this.sessions[sessionId]!.pinned = true;
      await this.persistSessions();
    }
  }

  /** Flush index to disk immediately. */
  async flush(): Promise<void> {
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
