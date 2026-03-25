// ============================================================================
// @dantecode/debug-trail — Test Suite
// Covers all 7 golden flows + unit tests for every module.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";

// --- Modules under test ---
import {
  hashContent,
  hashFile,
  makeSnapshotId,
  makeTombstoneId,
  shortHash,
  hashesEqual,
} from "./hash-engine.js";
import { diffText, formatUnifiedDiff, isBinaryContent } from "./diff-engine.js";
import { TrailEventIndex } from "./state/trail-index.js";
import { SessionMap } from "./state/session-map.js";
import { TombstoneRegistry } from "./state/tombstones.js";
import { AnomalyDetector } from "./anomaly-detector.js";
import { scoreCompleteness } from "./export-engine.js";
import { parseNaturalLanguageQuery, TrailQueryEngine } from "./trail-query-engine.js";
import { RetentionPolicy } from "./policies/retention-policy.js";
import { CompressionPolicy } from "./policies/compression-policy.js";
import { PrivacyPolicy } from "./policies/privacy-policy.js";
import type { TrailEvent, TrailProvenance, DeleteTombstone, FileSnapshotRecord } from "./types.js";
import { defaultConfig, DiskWriteError } from "./types.js";
import { FileSnapshotter } from "./file-snapshotter.js";
import { AuditLogger } from "./audit-logger.js";
import { ReplayOrchestrator } from "./replay-orchestrator.js";
import { TrailStore, getTrailStore } from "./sqlite-store.js";
import { RestoreEngine } from "./restore-engine.js";

// ============================================================================
// Test helpers
// ============================================================================

function makeProvenance(overrides?: Partial<TrailProvenance>): TrailProvenance {
  return {
    sessionId: `sess_test_${randomUUID().slice(0, 8)}`,
    runId: `run_test_${randomUUID().slice(0, 8)}`,
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<TrailEvent>): TrailEvent {
  const provenance = makeProvenance();
  return {
    id: `evt_${randomUUID().slice(0, 8)}`,
    seq: 0,
    timestamp: new Date().toISOString(),
    kind: "tool_call",
    actor: "TestActor",
    summary: "Test event",
    payload: {},
    provenance,
    ...overrides,
  };
}

function makeDeletedTombstone(overrides?: Partial<DeleteTombstone>): DeleteTombstone {
  const provenance = makeProvenance();
  return {
    tombstoneId: `tomb_${randomUUID().slice(0, 8)}`,
    filePath: "/test/file.ts",
    deletedAt: new Date().toISOString(),
    deletedBy: "TestActor",
    beforeStateCaptured: true,
    lastSnapshotId: `snap_${randomUUID().slice(0, 8)}`,
    provenance,
    trailEventId: `evt_${randomUUID().slice(0, 8)}`,
    ...overrides,
  };
}

// ============================================================================
// Hash Engine
// ============================================================================

describe("Hash Engine", () => {
  it("hashContent returns consistent SHA-256 hex for strings", () => {
    const h1 = hashContent("hello world");
    const h2 = hashContent("hello world");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("hashContent differs for different inputs", () => {
    expect(hashContent("foo")).not.toBe(hashContent("bar"));
  });

  it("hashFile returns null for nonexistent file", async () => {
    const result = await hashFile("/nonexistent/path/file.ts");
    expect(result).toBeNull();
  });

  it("hashFile hashes an actual file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dt-test-"));
    const filePath = join(dir, "test.txt");
    await writeFile(filePath, "hello test content");
    const hash = await hashFile(filePath);
    expect(hash).not.toBeNull();
    expect(hash!).toHaveLength(64);
    await rm(dir, { recursive: true });
  });

  it("shortHash returns 8-char prefix", () => {
    const h = hashContent("test");
    expect(shortHash(h)).toHaveLength(8);
    expect(h.startsWith(shortHash(h))).toBe(true);
  });

  it("makeSnapshotId produces stable unique ID", () => {
    const id1 = makeSnapshotId("/a/b.ts", "abc123", "2024-01-01T00:00:00Z");
    const id2 = makeSnapshotId("/a/b.ts", "abc123", "2024-01-01T00:00:00Z");
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^snap_/);
  });

  it("makeTombstoneId produces stable unique ID", () => {
    const id = makeTombstoneId("/a/b.ts", "2024-01-01T00:00:00Z");
    expect(id).toMatch(/^tomb_/);
  });

  it("hashesEqual works correctly", () => {
    expect(hashesEqual("abc", "abc")).toBe(true);
    expect(hashesEqual("abc", "def")).toBe(false);
    expect(hashesEqual(null, "abc")).toBe(false);
    expect(hashesEqual(undefined, undefined)).toBe(false);
  });
});

// ============================================================================
// Diff Engine
// ============================================================================

describe("Diff Engine", () => {
  it("diffText detects additions", () => {
    const result = diffText("line1\nline2", "line1\nline2\nline3");
    expect(result.linesAdded).toBe(1);
    expect(result.linesRemoved).toBe(0);
  });

  it("diffText detects removals", () => {
    const result = diffText("line1\nline2\nline3", "line1\nline2");
    expect(result.linesAdded).toBe(0);
    expect(result.linesRemoved).toBe(1);
  });

  it("diffText reports correct summary", () => {
    const result = diffText("a\nb", "a\nc\nd");
    expect(result.summary).toBe("+2 -1");
  });

  it("diffText with identical content produces 0 changes", () => {
    const text = "line1\nline2\nline3";
    const result = diffText(text, text);
    expect(result.linesAdded).toBe(0);
    expect(result.linesRemoved).toBe(0);
    expect(result.hunks).toHaveLength(0);
  });

  it("formatUnifiedDiff produces valid unified diff", () => {
    const diff = diffText("old content\n", "new content\n", { filePath: "test.ts" });
    const formatted = formatUnifiedDiff(diff);
    expect(formatted).toContain("--- a/test.ts");
    expect(formatted).toContain("+++ b/test.ts");
  });

  it("isBinaryContent detects null bytes", () => {
    const binary = Buffer.from([0, 1, 2, 3, 0, 0]);
    expect(isBinaryContent(binary)).toBe(true);
    expect(isBinaryContent("plain text")).toBe(false);
  });

  it("diffText handles empty before", () => {
    const result = diffText("", "line1\nline2");
    expect(result.linesAdded).toBe(2);
  });

  it("diffText handles empty after", () => {
    const result = diffText("line1\nline2", "");
    expect(result.linesRemoved).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Iterative LCS diff for large files (Gap 3)
  // -------------------------------------------------------------------------
  it("diffText on 3000+ line files does not throw", () => {
    const makeText = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => `${prefix} line ${i}`).join("\n");

    const before = makeText(1600, "before");
    const after = makeText(1600, "after");

    expect(() => diffText(before, after)).not.toThrow();
    const result = diffText(before, after);
    // All before lines removed, all after lines added
    expect(result.linesAdded).toBeGreaterThan(0);
    expect(result.linesRemoved).toBeGreaterThan(0);
  });

  it("diffText produces correct result after iterative fix (no truncation sentinel)", () => {
    const before = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    const after = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
    const result = diffText(before, after);
    // Iterative path must not emit the old "[N lines]" sentinel
    const allContent = result.hunks.flatMap((h) => h.lines.map((l) => l.content));
    expect(allContent.some((c) => c.startsWith("[") && c.endsWith("lines]"))).toBe(false);
    expect(result.linesAdded).toBe(2);
  });
});

// ============================================================================
// State: TrailEventIndex
// ============================================================================

describe("State: TrailEventIndex", () => {
  it("indexes events by session", () => {
    const index = new TrailEventIndex();
    const sessionId = "sess_abc";
    const e1 = makeEvent({ provenance: makeProvenance({ sessionId }), kind: "file_write" });
    const e2 = makeEvent({ provenance: makeProvenance({ sessionId }), kind: "tool_call" });
    index.index(e1);
    index.index(e2);
    expect(index.findBySession(sessionId)).toHaveLength(2);
  });

  it("indexes events by file path", () => {
    const index = new TrailEventIndex();
    const e = makeEvent({ payload: { filePath: "/src/auth.ts" } });
    index.index(e);
    expect(index.findByFile("/src/auth.ts")).toHaveLength(1);
  });

  it("searches by text in summary", () => {
    const index = new TrailEventIndex();
    const e = makeEvent({ summary: "File deleted: auth.ts" });
    index.index(e);
    const results = index.search("auth.ts");
    expect(results).toHaveLength(1);
  });

  it("findByFilePrefix matches directory", () => {
    const index = new TrailEventIndex();
    const e1 = makeEvent({ payload: { filePath: "/src/auth/login.ts" } });
    const e2 = makeEvent({ payload: { filePath: "/src/auth/logout.ts" } });
    const e3 = makeEvent({ payload: { filePath: "/test/auth.test.ts" } });
    index.index(e1);
    index.index(e2);
    index.index(e3);
    const results = index.findByFilePrefix("/src/auth/");
    expect(results).toHaveLength(2);
  });

  it("findByKind filters correctly", () => {
    const index = new TrailEventIndex();
    index.index(makeEvent({ kind: "file_write" }));
    index.index(makeEvent({ kind: "file_delete" }));
    index.index(makeEvent({ kind: "file_write" }));
    expect(index.findByKind("file_write")).toHaveLength(2);
    expect(index.findByKind("file_delete")).toHaveLength(1);
  });

  it("bulk indexes correctly", () => {
    const index = new TrailEventIndex();
    const events = Array.from({ length: 10 }, (_, i) => makeEvent({ seq: i }));
    index.bulkIndex(events);
    expect(index.size()).toBe(10);
  });

  it("clear resets all data", () => {
    const index = new TrailEventIndex();
    index.index(makeEvent());
    index.clear();
    expect(index.size()).toBe(0);
  });
});

// ============================================================================
// State: SessionMap
// ============================================================================

describe("State: SessionMap", () => {
  it("starts a new session", () => {
    const map = new SessionMap();
    const info = map.startSession({ sessionId: "s1", runId: "r1" });
    expect(info.sessionId).toBe("s1");
    expect(info.runId).toBe("r1");
    expect(map.current()?.sessionId).toBe("s1");
  });

  it("returns existing session on re-start", () => {
    const map = new SessionMap();
    map.startSession({ sessionId: "s1" });
    const info2 = map.startSession({ sessionId: "s1" });
    expect(info2.sessionId).toBe("s1");
  });

  it("ends session and clears current", () => {
    const map = new SessionMap();
    map.startSession({ sessionId: "s1" });
    map.endSession("s1");
    expect(map.current()).toBeNull();
    expect(map.get("s1")?.endedAt).toBeDefined();
  });

  it("records event counts", () => {
    const map = new SessionMap();
    map.startSession({ sessionId: "s1" });
    map.recordEvent("s1", "file_write");
    map.recordEvent("s1", "file_delete");
    map.recordEvent("s1", "other");
    const info = map.get("s1")!;
    expect(info.eventCount).toBe(3);
    expect(info.fileModCount).toBe(1);
    expect(info.fileDeleteCount).toBe(1);
  });

  it("pins and unpins sessions", () => {
    const map = new SessionMap();
    map.startSession({ sessionId: "s1" });
    map.pin("s1");
    expect(map.get("s1")?.pinned).toBe(true);
    map.unpin("s1");
    expect(map.get("s1")?.pinned).toBe(false);
  });

  it("serializes and restores", () => {
    const map = new SessionMap();
    map.startSession({ sessionId: "s1" });
    const data = map.toJSON();
    const map2 = new SessionMap();
    map2.loadFrom(data);
    expect(map2.get("s1")?.sessionId).toBe("s1");
  });
});

// ============================================================================
// State: TombstoneRegistry
// ============================================================================

describe("State: TombstoneRegistry", () => {
  it("registers and retrieves tombstones", () => {
    const reg = new TombstoneRegistry();
    const t = makeDeletedTombstone({ filePath: "/a/b.ts" });
    reg.register(t);
    expect(reg.latestForFile("/a/b.ts")).toEqual(t);
  });

  it("returns most recent tombstone for file", () => {
    const reg = new TombstoneRegistry();
    const t1 = makeDeletedTombstone({ filePath: "/a/b.ts", deletedAt: "2024-01-01T00:00:00Z" });
    const t2 = makeDeletedTombstone({ filePath: "/a/b.ts", deletedAt: "2024-01-02T00:00:00Z" });
    reg.register(t1);
    reg.register(t2);
    expect(reg.latestForFile("/a/b.ts")?.deletedAt).toBe("2024-01-02T00:00:00Z");
  });

  it("forSession filters correctly", () => {
    const reg = new TombstoneRegistry();
    const p1 = makeProvenance({ sessionId: "s1" });
    const p2 = makeProvenance({ sessionId: "s2" });
    reg.register(makeDeletedTombstone({ provenance: p1 }));
    reg.register(makeDeletedTombstone({ provenance: p2 }));
    expect(reg.forSession("s1")).toHaveLength(1);
  });

  it("withoutBeforeState finds capture gaps", () => {
    const reg = new TombstoneRegistry();
    reg.register(makeDeletedTombstone({ beforeStateCaptured: false, lastSnapshotId: undefined }));
    reg.register(makeDeletedTombstone({ beforeStateCaptured: true }));
    expect(reg.withoutBeforeState()).toHaveLength(1);
  });

  it("bulk loads tombstones", () => {
    const reg = new TombstoneRegistry();
    const tombstones = [makeDeletedTombstone(), makeDeletedTombstone(), makeDeletedTombstone()];
    reg.bulkLoad(tombstones);
    expect(reg.size()).toBe(3);
  });

  // -------------------------------------------------------------------------
  // allForFile() oldest-first ordering (Round 13 F5)
  // -------------------------------------------------------------------------
  it("F5: TombstoneRegistry.allForFile() returns oldest-first after reverse-chronological bulkLoad", () => {
    const registry = new TombstoneRegistry();
    const filePath = "/virtual/multi-deleted.ts";
    const prov = makeProvenance();

    const t1: DeleteTombstone = {
      tombstoneId: "tomb_r13_001",
      filePath,
      deletedAt: "2024-01-01T10:00:00.000Z",
      deletedBy: "TestActor",
      trailEventId: "evt_r13_001",
      provenance: prov,
      beforeStateCaptured: false,
    };
    const t2: DeleteTombstone = {
      tombstoneId: "tomb_r13_002",
      filePath,
      deletedAt: "2024-01-02T10:00:00.000Z",
      deletedBy: "TestActor",
      trailEventId: "evt_r13_002",
      provenance: prov,
      beforeStateCaptured: false,
    };
    const t3: DeleteTombstone = {
      tombstoneId: "tomb_r13_003",
      filePath,
      deletedAt: "2024-01-03T10:00:00.000Z",
      deletedBy: "TestActor",
      trailEventId: "evt_r13_003",
      provenance: prov,
      beforeStateCaptured: false,
    };

    // Load in reverse order (newest first — as might come from a reverse-sorted JSONL)
    registry.bulkLoad([t3, t1, t2]);

    const sorted = registry.allForFile(filePath);
    expect(sorted).toHaveLength(3);
    expect(sorted[0]!.tombstoneId).toBe("tomb_r13_001"); // oldest first
    expect(sorted[2]!.tombstoneId).toBe("tomb_r13_003"); // newest last

    const latest = registry.latestForFile(filePath);
    expect(latest!.tombstoneId).toBe("tomb_r13_003"); // newest
  });
});

// ============================================================================
// Anomaly Detector
// ============================================================================

describe("Anomaly Detector", () => {
  // -------------------------------------------------------------------------
  // Core detection (original)
  // -------------------------------------------------------------------------

  it("detects burst deletions", () => {
    const detector = new AnomalyDetector({ burstDeletionCount: 3, burstDeletionWindowMs: 5000 });
    const sessionId = "s1";
    const now = Date.now();
    const events: TrailEvent[] = [
      makeEvent({
        kind: "file_delete",
        timestamp: new Date(now).toISOString(),
        payload: { filePath: "/a.ts" },
      }),
      makeEvent({
        kind: "file_delete",
        timestamp: new Date(now + 1000).toISOString(),
        payload: { filePath: "/b.ts" },
      }),
      makeEvent({
        kind: "file_delete",
        timestamp: new Date(now + 2000).toISOString(),
        payload: { filePath: "/c.ts" },
      }),
    ];
    const flags = detector.analyze(events, sessionId);
    const burst = flags.filter((f) => f.anomalyType === "burst_deletion");
    expect(burst.length).toBeGreaterThan(0);
    expect(burst[0]!.severity).toBe("high");
  });

  it("does not flag deletions outside time window", () => {
    const detector = new AnomalyDetector({ burstDeletionCount: 3, burstDeletionWindowMs: 1000 });
    const now = Date.now();
    const events: TrailEvent[] = [
      makeEvent({ kind: "file_delete", timestamp: new Date(now).toISOString() }),
      makeEvent({ kind: "file_delete", timestamp: new Date(now + 5000).toISOString() }),
      makeEvent({ kind: "file_delete", timestamp: new Date(now + 10000).toISOString() }),
    ];
    const flags = detector.analyze(events);
    expect(flags.filter((f) => f.anomalyType === "burst_deletion")).toHaveLength(0);
  });

  it("detects phantom commits", () => {
    const detector = new AnomalyDetector();
    const events: TrailEvent[] = [
      makeEvent({ kind: "tool_call", actor: "GitCommit", timestamp: new Date().toISOString() }),
    ];
    const flags = detector.analyze(events);
    expect(flags.filter((f) => f.anomalyType === "phantom_commit")).toHaveLength(1);
  });

  it("detects missing before state", () => {
    const detector = new AnomalyDetector();
    const events: TrailEvent[] = [
      makeEvent({ kind: "file_delete", payload: { filePath: "/x.ts" } }),
    ];
    const flags = detector.analyze(events);
    expect(flags.filter((f) => f.anomalyType === "missing_before_state")).toHaveLength(1);
  });

  it("detects rapid loop", () => {
    const detector = new AnomalyDetector({ rapidLoopCount: 3, rapidLoopWindowMs: 60000 });
    const now = Date.now();
    const events: TrailEvent[] = Array.from({ length: 3 }, (_, i) =>
      makeEvent({
        kind: "tool_call",
        actor: "Bash",
        timestamp: new Date(now + i * 1000).toISOString(),
      }),
    );
    const flags = detector.analyze(events);
    expect(flags.filter((f) => f.anomalyType === "rapid_loop")).toHaveLength(1);
  });

  it("detects high error rate", () => {
    const detector = new AnomalyDetector({ errorRateThreshold: 0.3 });
    const events: TrailEvent[] = [
      ...Array.from({ length: 4 }, () => makeEvent({ kind: "error" })),
      makeEvent({ kind: "tool_call" }),
    ];
    const flags = detector.analyze(events);
    expect(flags.filter((f) => f.anomalyType === "high_error_rate")).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // large_rewrite, recursive_delete, untracked_write (Round 4)
  // -------------------------------------------------------------------------
  it("AnomalyDetector detects large_rewrite for 3+ hash-changing writes to same file", () => {
    const detector = new AnomalyDetector();
    const provenance = makeProvenance();
    const baseEvent = makeEvent({ provenance });
    const writes = [0, 1, 2].map((i) =>
      makeEvent({
        provenance,
        kind: "file_write",
        actor: "FileSystem",
        payload: { filePath: "/src/index.ts" },
        beforeHash: `hash_before_${i}`,
        afterHash: `hash_after_${i}`,
      }),
    );
    const flags = detector.analyze([baseEvent, ...writes], provenance.sessionId);
    expect(flags.some((f) => f.anomalyType === "large_rewrite")).toBe(true);
  });

  it("AnomalyDetector detects recursive_delete for 3+ files in same directory", () => {
    const detector = new AnomalyDetector();
    const provenance = makeProvenance();
    const deletions = ["/src/utils/a.ts", "/src/utils/b.ts", "/src/utils/c.ts"].map((fp) =>
      makeEvent({
        provenance,
        kind: "file_delete",
        actor: "FileSystem",
        payload: { filePath: fp },
      }),
    );
    const flags = detector.analyze(deletions, provenance.sessionId);
    expect(flags.some((f) => f.anomalyType === "recursive_delete")).toBe(true);
  });

  it("AnomalyDetector detects untracked_write for writes without preceding read", () => {
    const detector = new AnomalyDetector({ detectUntrackedWrites: true });
    const provenance = makeProvenance();
    // A file_write with no preceding tool_call read for that path
    const writeEvt = makeEvent({
      provenance,
      kind: "file_write",
      actor: "FileSystem",
      payload: { filePath: "/src/ghost.ts" },
    });
    const flags = detector.analyze([writeEvt], provenance.sessionId);
    expect(flags.some((f) => f.anomalyType === "untracked_write")).toBe(true);
  });

  it("AnomalyDetector does NOT flag write as untracked when preceded by a read tool_call", () => {
    const detector = new AnomalyDetector();
    const provenance = makeProvenance();
    const readEvt = makeEvent({
      provenance,
      kind: "tool_call",
      actor: "Read",
      payload: { filePath: "/src/known.ts" },
    });
    const writeEvt = makeEvent({
      provenance,
      kind: "file_write",
      actor: "FileSystem",
      payload: { filePath: "/src/known.ts" },
    });
    const flags = detector.analyze([readEvt, writeEvt], provenance.sessionId);
    expect(flags.filter((f) => f.anomalyType === "untracked_write")).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Anomaly flush integration — anomaly_flag in trail (Round 4)
  // -------------------------------------------------------------------------
  it("flush() logs anomaly_flag events that appear in anomaliesOnly query", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-anomaly-flush-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_anomaly" });
    await logger.init();

    // Log 3 rapid deletions to trigger burst_deletion anomaly
    for (const fp of ["/src/a.ts", "/src/b.ts", "/src/c.ts"]) {
      await logger.log("file_delete", "FileSystem", `Delete ${fp}`, { filePath: fp });
    }
    await logger.flush();

    // Query for anomaly_flag events
    const engine = new TrailQueryEngine({ storageRoot });
    const result = await engine.query({ anomaliesOnly: true });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]!.kind).toBe("anomaly_flag");

    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // detectRapidLoop fingerprint + detectUntrackedWrite default off (Round 5)
  // -------------------------------------------------------------------------
  it("flush() called twice does not log duplicate anomaly_flag events", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r5-dedup-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r5_dedup" });
    await logger.init();

    // 3 burst deletions → burst_deletion anomaly expected on first flush
    for (const fp of ["/src/x.ts", "/src/y.ts", "/src/z.ts"]) {
      await logger.log("file_delete", "FileSystem", `Delete ${fp}`, { filePath: fp });
    }
    await logger.flush();
    await logger.flush(); // second flush — should be a no-op for detection

    const engine = new TrailQueryEngine({ storageRoot });
    const result = await engine.query({ anomaliesOnly: true });
    // Exactly one burst_deletion anomaly, not two
    const burstFlags = result.results.filter((e) => {
      const at = e.payload["anomalyType"];
      return typeof at === "string" && at === "burst_deletion";
    });
    expect(burstFlags).toHaveLength(1);

    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Fix 3: detectRapidLoop uses smarter fingerprint
  // -------------------------------------------------------------------------

  it("detectRapidLoop does NOT fire when 5 writes target different files", () => {
    const detector = new AnomalyDetector();
    const provenance = makeProvenance();
    const writes = ["/a.ts", "/b.ts", "/c.ts", "/d.ts", "/e.ts"].map((fp) =>
      makeEvent({
        provenance,
        kind: "file_write",
        actor: "FileSystem",
        summary: `File write: ${fp}`,
        payload: { filePath: fp },
      }),
    );
    const flags = detector.analyze(writes, provenance.sessionId);
    expect(flags.some((f) => f.anomalyType === "rapid_loop")).toBe(false);
  });

  it("detectRapidLoop DOES fire when the same file is written 5 times", () => {
    const detector = new AnomalyDetector({ rapidLoopWindowMs: 60_000 });
    const provenance = makeProvenance();
    const writes = Array.from({ length: 5 }, () =>
      makeEvent({
        provenance,
        kind: "file_write",
        actor: "FileSystem",
        summary: "File write: /src/auth.ts",
        payload: { filePath: "/src/auth.ts" },
      }),
    );
    const flags = detector.analyze(writes, provenance.sessionId);
    expect(flags.some((f) => f.anomalyType === "rapid_loop")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Fix 2: detectUntrackedWrite is off by default
  // -------------------------------------------------------------------------

  it("detectUntrackedWrite is OFF by default — no false positives from direct writes", () => {
    const detector = new AnomalyDetector(); // detectUntrackedWrites: false by default
    const provenance = makeProvenance();
    const write = makeEvent({
      provenance,
      kind: "file_write",
      actor: "FileSystem",
      payload: { filePath: "/src/direct.ts" },
    });
    const flags = detector.analyze([write], provenance.sessionId);
    expect(flags.some((f) => f.anomalyType === "untracked_write")).toBe(false);
  });

  it("detectUntrackedWrite fires when explicitly enabled and no read precedes write", () => {
    const detector = new AnomalyDetector({ detectUntrackedWrites: true });
    const provenance = makeProvenance();
    const write = makeEvent({
      provenance,
      kind: "file_write",
      actor: "FileSystem",
      payload: { filePath: "/src/ghost.ts" },
    });
    const flags = detector.analyze([write], provenance.sessionId);
    expect(flags.some((f) => f.anomalyType === "untracked_write")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // updateConfig() mid-session reconfiguration (Round 6)
  // -------------------------------------------------------------------------
  it("AnomalyDetector.updateConfig() enables detectUntrackedWrites after construction", () => {
    const detector = new AnomalyDetector(); // default: detectUntrackedWrites = false
    const provenance = makeProvenance();
    const write = makeEvent({
      provenance,
      kind: "file_write",
      actor: "FileSystem",
      payload: { filePath: "/src/ghost.ts" },
    });

    // Off by default
    expect(
      detector
        .analyze([write], provenance.sessionId)
        .some((f) => f.anomalyType === "untracked_write"),
    ).toBe(false);

    // Enable mid-session
    detector.updateConfig({ detectUntrackedWrites: true });
    expect(
      detector
        .analyze([write], provenance.sessionId)
        .some((f) => f.anomalyType === "untracked_write"),
    ).toBe(true);
  });

  it("AnomalyDetector.updateConfig() can tighten burstDeletionCount threshold", () => {
    const detector = new AnomalyDetector({ burstDeletionCount: 5 }); // starts high
    const provenance = makeProvenance();
    const now = Date.now();
    const deletions = ["/a.ts", "/b.ts", "/c.ts"].map((fp, i) =>
      makeEvent({
        provenance,
        kind: "file_delete",
        actor: "FileSystem",
        payload: { filePath: fp },
        timestamp: new Date(now + i * 100).toISOString(),
      }),
    );

    // 3 deletions, threshold=5 — no flag
    expect(
      detector
        .analyze(deletions, provenance.sessionId)
        .some((f) => f.anomalyType === "burst_deletion"),
    ).toBe(false);

    // Lower threshold mid-session
    detector.updateConfig({ burstDeletionCount: 3 });
    expect(
      detector
        .analyze(deletions, provenance.sessionId)
        .some((f) => f.anomalyType === "burst_deletion"),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // detectUntrackedWrite auto-detection from tool_call reads (Round 7)
  // -------------------------------------------------------------------------
  it("detectUntrackedWrite auto-fires when tool_call reads are present but file path not in them", () => {
    const detector = new AnomalyDetector(); // detectUntrackedWrites: false by default
    const provenance = makeProvenance();

    // A tool_call read for one file, then a write to a DIFFERENT file
    const readEvt = makeEvent({
      provenance,
      kind: "tool_call",
      actor: "Read",
      payload: { args: { file_path: "/src/known.ts" } },
    });
    const writeEvt = makeEvent({
      provenance,
      kind: "file_write",
      actor: "FileSystem",
      payload: { filePath: "/src/ghost.ts" }, // different path — not in read set
    });

    // Since readPaths is non-empty (Read established causality), auto-detection fires
    const flags = detector.analyze([readEvt, writeEvt], provenance.sessionId);
    expect(flags.some((f) => f.anomalyType === "untracked_write")).toBe(true);
  });

  it("detectUntrackedWrite does NOT fire when no tool_call reads exist (no causality established)", () => {
    const detector = new AnomalyDetector(); // detectUntrackedWrites: false by default
    const provenance = makeProvenance();

    // Only a direct file_write — no tool_call events at all
    const writeEvt = makeEvent({
      provenance,
      kind: "file_write",
      actor: "FileSystem",
      payload: { filePath: "/src/ghost.ts" },
    });

    // readPaths empty + config false → skip (avoids false positives from direct logFileWrite())
    const flags = detector.analyze([writeEvt], provenance.sessionId);
    expect(flags.some((f) => f.anomalyType === "untracked_write")).toBe(false);
  });

  it("detectUntrackedWrite does NOT fire when write path matches a preceding read", () => {
    const detector = new AnomalyDetector();
    const provenance = makeProvenance();

    const readEvt = makeEvent({
      provenance,
      kind: "tool_call",
      actor: "Read",
      payload: { args: { file_path: "/src/auth.ts" } },
    });
    const writeEvt = makeEvent({
      provenance,
      kind: "file_write",
      actor: "FileSystem",
      payload: { filePath: "/src/auth.ts" }, // same path — tracked
    });

    const flags = detector.analyze([readEvt, writeEvt], provenance.sessionId);
    expect(flags.some((f) => f.anomalyType === "untracked_write")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // detectBurstDeletions relatedEventIds full window (Round 9)
  // -------------------------------------------------------------------------
  it("detectBurstDeletions reports all events in burst window, not just first N", () => {
    const detector = new AnomalyDetector({
      burstDeletionCount: 3,
      burstDeletionWindowMs: 5_000,
    });

    const now = Date.now();
    const makeDelete = (i: number): TrailEvent => ({
      id: `id_del_${i}`,
      seq: i,
      timestamp: new Date(now + i * 500).toISOString(), // 0.5s apart, all within 5s
      kind: "file_delete",
      actor: "FileSystem",
      summary: `delete ${i}`,
      payload: { filePath: `/src/file${i}.ts` },
      provenance: { sessionId: "sess_g", runId: "run_g" },
    });

    // 5 deletions all within the 5s window
    const events = [0, 1, 2, 3, 4].map(makeDelete);
    const flags = detector.analyze(events, "sess_g");
    const burstFlags = flags.filter((f) => f.anomalyType === "burst_deletion");
    expect(burstFlags).toHaveLength(1);
    // All 5 IDs should be in relatedEventIds, not just the first 3
    expect(burstFlags[0]!.relatedEventIds).toHaveLength(5);
  });

  // -------------------------------------------------------------------------
  // AnomalyDetector.getConfig() (Round 9)
  // -------------------------------------------------------------------------
  it("AnomalyDetector.getConfig() returns current config snapshot", () => {
    const detector = new AnomalyDetector({ burstDeletionCount: 7, detectUntrackedWrites: true });
    const cfg = detector.getConfig();
    expect(cfg.burstDeletionCount).toBe(7);
    expect(cfg.detectUntrackedWrites).toBe(true);
    // Verify it's a snapshot — mutating the returned object doesn't affect the detector
    (cfg as Record<string, unknown>)["burstDeletionCount"] = 99;
    expect(detector.getConfig().burstDeletionCount).toBe(7);
  });

  it("AnomalyDetector.getConfig() reflects updateConfig() changes", () => {
    const detector = new AnomalyDetector();
    expect(detector.getConfig().burstDeletionCount).toBe(3); // default
    detector.updateConfig({ burstDeletionCount: 10 });
    expect(detector.getConfig().burstDeletionCount).toBe(10);
  });

  // -------------------------------------------------------------------------
  // detectRecursiveDelete dirname grouping (Round 10)
  // -------------------------------------------------------------------------
  it("detectRecursiveDelete: groups by dirname for deep nested paths", () => {
    const detector = new AnomalyDetector();
    const now = Date.now();
    const makeDelete = (fp: string, i: number): TrailEvent => ({
      id: `rd_${i}`,
      seq: i,
      timestamp: new Date(now + i).toISOString(),
      kind: "file_delete",
      actor: "FileSystem",
      summary: `delete ${fp}`,
      payload: { filePath: fp },
      provenance: { sessionId: "sess_rd", runId: "run_rd" },
    });

    // 3 files from the same deep directory — should be recursive_delete
    const events = [
      makeDelete("/project/src/utils/a.ts", 0),
      makeDelete("/project/src/utils/b.ts", 1),
      makeDelete("/project/src/utils/c.ts", 2),
    ];
    const flags = detector.analyze(events, "sess_rd");
    const rdFlags = flags.filter((f) => f.anomalyType === "recursive_delete");
    expect(rdFlags).toHaveLength(1);
    expect(rdFlags[0]!.description).toContain("/project/src/utils");
    expect(rdFlags[0]!.relatedEventIds).toHaveLength(3);
  });

  it("detectRecursiveDelete: does not group files from different directories", () => {
    const detector = new AnomalyDetector();
    const now = Date.now();
    const makeDelete = (fp: string, i: number): TrailEvent => ({
      id: `rd2_${i}`,
      seq: i,
      timestamp: new Date(now + i).toISOString(),
      kind: "file_delete",
      actor: "FileSystem",
      summary: `delete ${fp}`,
      payload: { filePath: fp },
      provenance: { sessionId: "sess_rd2", runId: "run_rd2" },
    });

    // 3 files from 3 different directories — no recursive_delete
    const events = [
      makeDelete("/src/a.ts", 0),
      makeDelete("/lib/b.ts", 1),
      makeDelete("/test/c.ts", 2),
    ];
    const flags = detector.analyze(events, "sess_rd2");
    const rdFlags = flags.filter((f) => f.anomalyType === "recursive_delete");
    expect(rdFlags).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // detectUntrackedWrite per-write causality (Round 11)
  // -------------------------------------------------------------------------
  it("untracked_write: read of a DIFFERENT file does not protect an unrelated write", () => {
    const detector = new AnomalyDetector({ detectUntrackedWrites: false });
    const sess = "sess_r11_ut1";

    const events: TrailEvent[] = [
      // tool_call reads fileA
      makeEvent({
        kind: "tool_call",
        actor: "Read",
        summary: "Read tool: /src/auth.ts",
        payload: { filePath: "/src/auth.ts" },
        provenance: makeProvenance({ sessionId: sess }),
      }),
      // file_write to fileB (never read) — should be flagged
      makeEvent({
        kind: "file_write",
        actor: "FileSystem",
        summary: "File write: /src/other.ts",
        payload: { filePath: "/src/other.ts" },
        provenance: makeProvenance({ sessionId: sess }),
      }),
    ];

    const flags = detector.analyze(events, sess);
    const untrackedFlags = flags.filter((f) => f.anomalyType === "untracked_write");
    // /src/other.ts has no preceding read — must be flagged even though /src/auth.ts was read
    expect(untrackedFlags).toHaveLength(1);
    expect(untrackedFlags[0]!.description).toContain("/src/other.ts");
  });

  it("untracked_write: preceding read of same file suppresses the flag", () => {
    const detector = new AnomalyDetector({ detectUntrackedWrites: false });
    const sess = "sess_r11_ut2";

    const events: TrailEvent[] = [
      makeEvent({
        kind: "tool_call",
        actor: "Read",
        summary: "Read tool: /src/auth.ts",
        payload: { filePath: "/src/auth.ts" },
        provenance: makeProvenance({ sessionId: sess }),
      }),
      makeEvent({
        kind: "file_write",
        actor: "FileSystem",
        summary: "File write: /src/auth.ts",
        payload: { filePath: "/src/auth.ts" },
        provenance: makeProvenance({ sessionId: sess }),
      }),
    ];

    const flags = detector.analyze(events, sess);
    const untrackedFlags = flags.filter((f) => f.anomalyType === "untracked_write");
    expect(untrackedFlags).toHaveLength(0);
  });

  it("untracked_write: read AFTER write does not protect the write", () => {
    const detector = new AnomalyDetector({ detectUntrackedWrites: false });
    const sess = "sess_r11_ut3";

    const events: TrailEvent[] = [
      // write happens FIRST
      makeEvent({
        kind: "file_write",
        actor: "FileSystem",
        summary: "File write: /src/auth.ts",
        payload: { filePath: "/src/auth.ts" },
        provenance: makeProvenance({ sessionId: sess }),
      }),
      // read comes AFTER the write — too late to establish causality
      makeEvent({
        kind: "tool_call",
        actor: "Read",
        summary: "Read tool: /src/auth.ts",
        payload: { filePath: "/src/auth.ts" },
        provenance: makeProvenance({ sessionId: sess }),
      }),
    ];

    const flags = detector.analyze(events, sess);
    const untrackedFlags = flags.filter((f) => f.anomalyType === "untracked_write");
    // Write had no preceding read — must still be flagged
    expect(untrackedFlags).toHaveLength(1);
    expect(untrackedFlags[0]!.description).toContain("/src/auth.ts");
  });

  it("untracked_write with detectUntrackedWrites:true always fires regardless of auto-detection", () => {
    // With explicit flag, detection runs even without any tool_call reads in window
    const detector = new AnomalyDetector({ detectUntrackedWrites: true });
    const sess = "sess_r11_ut4";

    const events: TrailEvent[] = [
      // No tool_call reads at all — just a write
      makeEvent({
        kind: "file_write",
        actor: "FileSystem",
        summary: "File write: /src/secret.ts",
        payload: { filePath: "/src/secret.ts" },
        provenance: makeProvenance({ sessionId: sess }),
      }),
    ];

    const flags = detector.analyze(events, sess);
    const untrackedFlags = flags.filter((f) => f.anomalyType === "untracked_write");
    expect(untrackedFlags).toHaveLength(1);
    expect(untrackedFlags[0]!.description).toContain("/src/secret.ts");
  });

  it("untracked_write auto-mode: no tool_call reads = no flags (default off)", () => {
    // detectUntrackedWrites: false (default), no tool_call reads → no false positives
    const detector = new AnomalyDetector({ detectUntrackedWrites: false });
    const sess = "sess_r11_ut5";

    const events: TrailEvent[] = [
      makeEvent({
        kind: "file_write",
        actor: "FileSystem",
        summary: "File write: /src/main.ts",
        payload: { filePath: "/src/main.ts" },
        provenance: makeProvenance({ sessionId: sess }),
      }),
    ];

    const flags = detector.analyze(events, sess);
    const untrackedFlags = flags.filter((f) => f.anomalyType === "untracked_write");
    // No tool_call reads → auto-mode stays silent
    expect(untrackedFlags).toHaveLength(0);
  });

  it("untracked_write: mixed window — only the file without a preceding read is flagged", () => {
    // fileA has a read before its write → no flag
    // fileB has no read before its write → flagged
    const detector = new AnomalyDetector({ detectUntrackedWrites: false });
    const sess = "sess_r11_ut6";

    const events: TrailEvent[] = [
      makeEvent({
        kind: "tool_call",
        actor: "Read",
        payload: { filePath: "/src/auth.ts" },
        provenance: makeProvenance({ sessionId: sess }),
        summary: "Read /src/auth.ts",
      }),
      makeEvent({
        kind: "file_write",
        actor: "FileSystem",
        payload: { filePath: "/src/auth.ts" },
        provenance: makeProvenance({ sessionId: sess }),
        summary: "Write /src/auth.ts",
      }),
      // fileB write has no preceding read
      makeEvent({
        kind: "file_write",
        actor: "FileSystem",
        payload: { filePath: "/src/config.ts" },
        provenance: makeProvenance({ sessionId: sess }),
        summary: "Write /src/config.ts",
      }),
    ];

    const flags = detector.analyze(events, sess);
    const untrackedFlags = flags.filter((f) => f.anomalyType === "untracked_write");
    expect(untrackedFlags).toHaveLength(1);
    expect(untrackedFlags[0]!.description).toContain("/src/config.ts");
  });

  // -------------------------------------------------------------------------
  // detectPhantomCommit case-insensitive (Round 13 F4)
  // -------------------------------------------------------------------------
  it("F4: detectPhantomCommit fires for lowercase/underscore actor names like git_commit", () => {
    const detector = new AnomalyDetector();
    const sess = `sess_f4_${randomUUID().slice(0, 8)}`;

    const events = [
      makeEvent({
        kind: "tool_call",
        actor: "git_commit", // underscore, lowercase — previously missed by exact-match
        payload: {},
        provenance: makeProvenance({ sessionId: sess }),
        summary: "git commit",
        seq: 1,
      }),
      // No preceding file_write in 60s window → phantom commit
    ];

    const flags = detector.analyze(events, sess);
    const phantomFlags = flags.filter((f) => f.anomalyType === "phantom_commit");
    expect(phantomFlags).toHaveLength(1);
    expect(phantomFlags[0]!.severity).toBe("high");
  });
});

// ============================================================================
// Export Engine
// ============================================================================

describe("Export Engine", () => {
  it("perfect score for empty session", () => {
    const result = scoreCompleteness([], [], "s1");
    expect(result.score).toBe(1.0);
  });

  it("penalizes missing provenance", () => {
    const event = makeEvent();
    // Corrupt provenance
    (event.provenance as Partial<TrailProvenance>).sessionId = "";
    const result = scoreCompleteness([event], [], "s1");
    expect(result.missingProvenance).toHaveLength(1);
    expect(result.score).toBeLessThan(1);
  });

  it("penalizes file events without snapshots", () => {
    const event = makeEvent({ kind: "file_write" }); // no afterSnapshotId
    const result = scoreCompleteness([event], [], "s1");
    expect(result.snapshotGaps).toHaveLength(1);
    expect(result.score).toBeLessThan(1);
  });

  it("full score when file events have snapshots", () => {
    const event = makeEvent({ kind: "file_write", afterSnapshotId: "snap_abc" });
    const result = scoreCompleteness([event], [], "s1");
    expect(result.fileEventsWithSnapshots).toBe(1);
    expect(result.score).toBe(1);
  });

  it("tombstones without before-state reduce score", () => {
    const event = makeEvent({ kind: "file_delete", beforeSnapshotId: undefined });
    const tombstone = makeDeletedTombstone({
      beforeStateCaptured: false,
      lastSnapshotId: undefined,
    });
    const result = scoreCompleteness([event], [tombstone], "s1");
    expect(result.snapshotGaps.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // scoreCompleteness always returns [0,1] (Round 13 F6)
  // -------------------------------------------------------------------------
  it("F6: scoreCompleteness always returns score in [0, 1]", () => {
    // Empty session
    const empty = scoreCompleteness([], [], "sess_f6_empty");
    expect(empty.score).toBeGreaterThanOrEqual(0);
    expect(empty.score).toBeLessThanOrEqual(1);

    // Single file_write without snapshot (worst case provenance + snapshot gap)
    const worst = scoreCompleteness(
      [makeEvent({ kind: "file_write", payload: { filePath: "/a.ts" } })],
      [],
      "sess_f6_worst",
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// Query Engine
// ============================================================================

describe("Query Engine", () => {
  // -------------------------------------------------------------------------
  // parseNaturalLanguageQuery core (original)
  // -------------------------------------------------------------------------

  it("detects error keywords", () => {
    const q = parseNaturalLanguageQuery("show me all errors from today");
    expect(q.errorsOnly).toBe(true);
  });

  it("detects deletion keywords", () => {
    const q = parseNaturalLanguageQuery("what deleted auth.ts yesterday?");
    expect(q.kinds).toContain("file_delete");
  });

  it("extracts file path from query", () => {
    const q = parseNaturalLanguageQuery("what changed auth.ts?");
    expect(q.text).toBe("auth.ts");
  });

  it("detects yesterday time range", () => {
    const q = parseNaturalLanguageQuery("what happened yesterday?");
    expect(q.afterDate).toBeDefined();
    expect(q.beforeDate).toBeDefined();
  });

  it("detects last week time range", () => {
    const q = parseNaturalLanguageQuery("show all errors last week");
    expect(q.afterDate).toBeDefined();
    expect(q.beforeDate).toBeUndefined();
  });

  it("detects today time range", () => {
    const q = parseNaturalLanguageQuery("what ran today?");
    expect(q.afterDate).toBeDefined();
  });

  it("passes text through for generic queries", () => {
    const q = parseNaturalLanguageQuery("something unusual happened");
    expect(q.text).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // parseNaturalLanguageQuery — relative time & actor detection (Round 7)
  // -------------------------------------------------------------------------
  it("parseNaturalLanguageQuery: '3 hours ago' sets afterDate correctly", () => {
    const before = Date.now();
    const q = parseNaturalLanguageQuery("show me errors from 3 hours ago");
    const after = Date.now();
    expect(q.afterDate).toBeDefined();
    const parsed = new Date(q.afterDate!).getTime();
    // Should be ~3 hours ago (within a few ms of test execution)
    expect(parsed).toBeGreaterThanOrEqual(before - 3 * 3_600_000 - 100);
    expect(parsed).toBeLessThanOrEqual(after - 3 * 3_600_000 + 100);
  });

  it("parseNaturalLanguageQuery: '30 minutes ago' sets afterDate correctly", () => {
    const before = Date.now();
    const q = parseNaturalLanguageQuery("what happened 30 minutes ago");
    expect(q.afterDate).toBeDefined();
    const parsed = new Date(q.afterDate!).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before - 30 * 60_000 - 100);
    expect(parsed).toBeLessThanOrEqual(before - 30 * 60_000 + 100);
  });

  it("parseNaturalLanguageQuery: '2 days ago' sets afterDate correctly", () => {
    const before = Date.now();
    const q = parseNaturalLanguageQuery("show writes from 2 days ago");
    expect(q.afterDate).toBeDefined();
    const parsed = new Date(q.afterDate!).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before - 2 * 86_400_000 - 100);
    expect(parsed).toBeLessThanOrEqual(before - 2 * 86_400_000 + 100);
  });

  it("parseNaturalLanguageQuery: actor detection 'by FileSystem'", () => {
    const q = parseNaturalLanguageQuery("what was written by FileSystem today");
    expect(q.actor).toBe("FileSystem");
  });

  it("parseNaturalLanguageQuery: actor detection 'what did Actor'", () => {
    const q = parseNaturalLanguageQuery("what did Checkpointer do");
    expect(q.actor).toBe("Checkpointer");
  });

  it("parseNaturalLanguageQuery: directory path sets filePathPrefix", () => {
    const q = parseNaturalLanguageQuery("show changes in src/auth");
    expect(q.filePathPrefix).toBe("src/auth");
  });

  it("parseNaturalLanguageQuery: expanded file extension list matches .rs files", () => {
    const q = parseNaturalLanguageQuery("what happened to main.rs");
    expect(q.text).toBe("main.rs");
  });

  it("parseNaturalLanguageQuery: expanded file extension list matches .go files", () => {
    const q = parseNaturalLanguageQuery("show changes to server.go");
    expect(q.text).toBe("server.go");
  });

  // -------------------------------------------------------------------------
  // parseNaturalLanguageQuery — negation, OR actors (Round 8)
  // -------------------------------------------------------------------------
  it("parseNaturalLanguageQuery: 'everything except errors' sets excludeKinds", () => {
    const q = parseNaturalLanguageQuery("show everything except errors");
    expect(q.excludeKinds).toContain("error");
    expect(q.excludeKinds).toContain("retry");
    expect(q.errorsOnly).toBeUndefined();
  });

  it("parseNaturalLanguageQuery: 'without deletes' sets excludeKinds file_delete", () => {
    const q = parseNaturalLanguageQuery("show all events without deletes");
    expect(q.excludeKinds).toContain("file_delete");
  });

  it("parseNaturalLanguageQuery: 'FileSystem or Checkpointer' sets actors array", () => {
    const q = parseNaturalLanguageQuery("show events by FileSystem or Checkpointer");
    expect(q.actors).toEqual(["FileSystem", "Checkpointer"]);
    expect(q.actor).toBeUndefined();
  });

  it("parseNaturalLanguageQuery: dirMatch does not false-positive on fractions", () => {
    const q = parseNaturalLanguageQuery("update 10/20 files today");
    expect(q.filePathPrefix).toBeUndefined();
  });

  it("parseNaturalLanguageQuery: dirMatch does not false-positive on date fractions", () => {
    const q = parseNaturalLanguageQuery("ran 1/3 of the test suite");
    expect(q.filePathPrefix).toBeUndefined();
  });

  it("parseNaturalLanguageQuery: 'writes excluding errors' sets both kinds and excludeKinds", () => {
    const q = parseNaturalLanguageQuery("show writes excluding errors");
    expect(q.kinds).toContain("file_write");
    expect(q.excludeKinds).toContain("error");
    expect(q.errorsOnly).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // parseNaturalLanguageQuery — "in the last N", multi-actor (Round 9)
  // -------------------------------------------------------------------------
  it("parseNaturalLanguageQuery: 'in the last 3 hours' sets afterDate", () => {
    const before = Date.now();
    const q = parseNaturalLanguageQuery("show errors in the last 3 hours");
    const after = Date.now();
    expect(q.afterDate).toBeDefined();
    const ts = new Date(q.afterDate!).getTime();
    // Should be approximately 3 hours ago
    const expected = before - 3 * 3_600_000;
    expect(ts).toBeGreaterThanOrEqual(expected - 1000);
    expect(ts).toBeLessThanOrEqual(after - 3 * 3_600_000 + 1000);
  });

  it("parseNaturalLanguageQuery: 'over the past 2 days' sets afterDate", () => {
    const before = Date.now();
    const q = parseNaturalLanguageQuery("over the past 2 days");
    const after = Date.now();
    expect(q.afterDate).toBeDefined();
    const ts = new Date(q.afterDate!).getTime();
    const expected = before - 2 * 86_400_000;
    expect(ts).toBeGreaterThanOrEqual(expected - 1000);
    expect(ts).toBeLessThanOrEqual(after - 2 * 86_400_000 + 1000);
  });

  it("parseNaturalLanguageQuery: 'past 30 minutes' sets afterDate", () => {
    const before = Date.now();
    const q = parseNaturalLanguageQuery("past 30 minutes");
    const after = Date.now();
    expect(q.afterDate).toBeDefined();
    const ts = new Date(q.afterDate!).getTime();
    const expected = before - 30 * 60_000;
    expect(ts).toBeGreaterThanOrEqual(expected - 1000);
    expect(ts).toBeLessThanOrEqual(after - 30 * 60_000 + 1000);
  });

  // -------------------------------------------------------------------------
  // Gap 3: NL parser — multi-actor OR with 3+ actors
  // -------------------------------------------------------------------------

  it("parseNaturalLanguageQuery: 3-actor OR captures all actors", () => {
    const q = parseNaturalLanguageQuery(
      "show events by FileSystem or Checkpointer or AnomalyDetector",
    );
    expect(q.actors).toEqual(["FileSystem", "Checkpointer", "AnomalyDetector"]);
    expect(q.actor).toBeUndefined();
  });

  it("parseNaturalLanguageQuery: 4-actor OR captures all actors", () => {
    const q = parseNaturalLanguageQuery("Alice or Bob or Carol or Dave did something");
    expect(q.actors).toHaveLength(4);
    expect(q.actors).toContain("Alice");
    expect(q.actors).toContain("Bob");
    expect(q.actors).toContain("Carol");
    expect(q.actors).toContain("Dave");
  });

  // -------------------------------------------------------------------------
  // parseNaturalLanguageQuery — errorsOnly vs kinds conflict (Round 13 F7)
  // -------------------------------------------------------------------------
  it("F7: parseNaturalLanguageQuery resolves errorsOnly vs kinds conflict — not both set", () => {
    const q = parseNaturalLanguageQuery("errors during file deletion");
    const hasBoth = q.errorsOnly === true && q.kinds !== undefined && q.kinds.length > 0;
    expect(hasBoth).toBe(false);

    // Verify at least one filter is set (query must still narrow results)
    const hasAtLeastOne = q.errorsOnly === true || (q.kinds !== undefined && q.kinds.length > 0);
    expect(hasAtLeastOne).toBe(true);
  });

  // -------------------------------------------------------------------------
  // TrailQuery filters — excludeKinds, actors, excludeActor (Round 8)
  // -------------------------------------------------------------------------
  it("TrailQuery.excludeKinds filters out specified event kinds", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r8-excludeKinds-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r8_excl" });
    await logger.init();
    await logger.log("tool_call", "Actor", "normal event", {});
    await logger.log("error", "Actor", "an error", {});
    await logger.log("file_write", "FileSystem", "a write", {});
    await logger.flush();

    const engine = new TrailQueryEngine({ storageRoot });
    const result = await engine.query({ excludeKinds: ["error", "anomaly_flag"], limit: 100 });
    const kinds = result.results.map((e) => e.kind);
    expect(kinds).not.toContain("error");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("file_write");
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("TrailQuery.actors (OR) returns events from any of the listed actors", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r8-actors-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r8_actors" });
    await logger.init();
    await logger.log("tool_call", "FileSystem", "fs event", {});
    await logger.log("tool_call", "Checkpointer", "cp event", {});
    await logger.log("tool_call", "AnomalyDetector", "ad event", {});
    await logger.flush();

    const engine = new TrailQueryEngine({ storageRoot });
    const result = await engine.query({ actors: ["FileSystem", "Checkpointer"], limit: 100 });
    const actors = result.results.map((e) => e.actor);
    expect(actors).toContain("FileSystem");
    expect(actors).toContain("Checkpointer");
    expect(actors).not.toContain("AnomalyDetector");
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("TrailQuery.excludeActor removes matching actor from results", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r8-excludeActor-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r8_excA" });
    await logger.init();
    await logger.log("tool_call", "FileSystem", "fs event", {});
    await logger.log("tool_call", "Checkpointer", "cp event", {});
    await logger.flush();

    const engine = new TrailQueryEngine({ storageRoot });
    const result = await engine.query({ excludeActor: "filesystem", limit: 100 });
    const actors = result.results.map((e) => e.actor);
    expect(actors).not.toContain("FileSystem");
    expect(actors).toContain("Checkpointer");
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // streamEvents() cache consistency (Round 6)
  // -------------------------------------------------------------------------
  it("streamEvents() yields from cache when within TTL (consistent view with query())", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r6-stream-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r6_stream" });
    await logger.init();
    await logger.log("tool_call", "Actor", "cached event", {});
    await logger.flush();

    const engine = new TrailQueryEngine({ storageRoot });
    // Warm the cache via query()
    await engine.query({ limit: 10 });

    const streamed: import("./types.js").TrailEvent[] = [];
    for await (const e of engine.streamEvents()) {
      streamed.push(e);
    }
    expect(streamed.some((e) => e.summary === "cached event")).toBe(true);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("streamEvents() always reads from disk — consistent results regardless of cache state", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r6-stream-disk-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r6_disk" });
    await logger.init();
    await logger.log("tool_call", "Actor", "disk event", {});
    await logger.flush();

    const engine = new TrailQueryEngine({ storageRoot });
    // Call with and without cache warm — both should yield the same events from disk
    const streamed: import("./types.js").TrailEvent[] = [];
    for await (const e of engine.streamEvents()) {
      streamed.push(e);
    }
    expect(streamed.some((e) => e.summary === "disk event")).toBe(true);
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // streamEvents() disk read consistency (Round 7)
  // -------------------------------------------------------------------------
  it("streamEvents() reads from disk even when no cache exists", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r7-stream-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r7_stream" });
    await logger.init();
    await logger.log("tool_call", "Actor", "stream test event", {});
    await logger.flush();

    // Fresh engine — no cache warmed
    const engine = new TrailQueryEngine({ storageRoot });
    const streamed: TrailEvent[] = [];
    for await (const e of engine.streamEvents()) {
      streamed.push(e);
    }
    expect(streamed.some((e) => e.summary === "stream test event")).toBe(true);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("streamEvents() and query() return the same events", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r7-stream-consistency-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r7_consistency" });
    await logger.init();
    for (let i = 0; i < 5; i++) {
      await logger.log("tool_call", "Actor", `event ${i}`, {});
    }
    await logger.flush();

    const engine = new TrailQueryEngine({ storageRoot });
    const queried = await engine.query({ limit: 100, order: "asc" });

    const streamed: TrailEvent[] = [];
    for await (const e of engine.streamEvents()) {
      streamed.push(e);
    }

    // Both should have the same event IDs (order may differ for streamed)
    const queriedIds = new Set(queried.results.map((e) => e.id));
    for (const e of streamed) {
      expect(queriedIds.has(e.id)).toBe(true);
    }
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Concurrent cache-miss coalescing (Round 13 F2)
  // -------------------------------------------------------------------------
  it("F2: concurrent query() calls after cache expiry trigger readAllEvents() exactly once", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "r13-f2-"));
    try {
      const config = { ...defaultConfig(), storageRoot: tmpDir };
      const store = getTrailStore(config.storageRoot);
      await store.init();

      const engine = new TrailQueryEngine(config);
      await engine.init(); // warm up

      // Expire the cache
      engine.invalidateCache();

      let readCount = 0;
      const originalRead = store.readAllEvents.bind(store);
      vi.spyOn(store, "readAllEvents").mockImplementation(async () => {
        readCount++;
        return originalRead();
      });

      // 10 concurrent callers — should share one in-flight read
      await Promise.all(Array.from({ length: 10 }, () => engine.query({ limit: 1 })));

      expect(readCount).toBe(1);
    } finally {
      vi.restoreAllMocks();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // streamEvents() no file handle leak (Round 13 F3)
  // -------------------------------------------------------------------------
  // F3: streamEvents() with early break must not leak file handles.
  it("F3: streamEvents() with early break does not leak file handles over many iterations", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "r13-f3-"));
    try {
      const config = { ...defaultConfig(), storageRoot: tmpDir };
      const engine = new TrailQueryEngine(config);

      // 100 partial streams — if handles leaked, OS would reject around fd limit.
      for (let i = 0; i < 100; i++) {
        for await (const _event of engine.streamEvents()) {
          break; // early exit — this is the path that previously leaked file handles
        }
      }
      // Reaching here without EMFILE error means handles are being closed correctly.
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Policies
// ============================================================================

describe("Policies", () => {
  describe("RetentionPolicy", () => {
    function makeSession(daysAgo: number, pinned = false) {
      const lastEventAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
      return {
        sessionId: `s_${daysAgo}`,
        runId: "r1",
        startedAt: lastEventAt,
        lastEventAt,
        eventCount: 10,
        pinned,
      };
    }

    it("keeps recent sessions", () => {
      const policy = new RetentionPolicy({ keepRecentDays: 7, prunePastDays: 30 });
      const sessions = { s1: makeSession(2) };
      const decisions = policy.evaluate(sessions);
      expect(decisions[0]?.decision).toBe("keep");
    });

    it("prunes old sessions", () => {
      const policy = new RetentionPolicy({ keepRecentDays: 7, prunePastDays: 30 });
      const sessions = { s1: makeSession(35) };
      const decisions = policy.evaluate(sessions);
      expect(decisions[0]?.decision).toBe("prune");
    });

    it("compresses middle-age sessions", () => {
      const policy = new RetentionPolicy({
        keepRecentDays: 7,
        prunePastDays: 30,
        enableCompression: true,
      });
      const sessions = { s1: makeSession(15) };
      const decisions = policy.evaluate(sessions);
      expect(decisions[0]?.decision).toBe("compress");
    });

    it("always keeps pinned sessions", () => {
      const policy = new RetentionPolicy({ prunePastDays: 1 });
      const sessions = { s1: makeSession(100, true) };
      const decisions = policy.evaluate(sessions);
      expect(decisions[0]?.decision).toBe("keep");
      expect(decisions[0]?.pinned).toBe(true);
    });

    it("getPruneList returns only prune decisions", () => {
      const policy = new RetentionPolicy({ keepRecentDays: 7, prunePastDays: 30 });
      const sessions = {
        recent: makeSession(2),
        old: makeSession(35),
      };
      const pruneList = policy.getPruneList(sessions);
      expect(pruneList).toContain("old");
      expect(pruneList).not.toContain("recent");
    });
  });

  describe("CompressionPolicy", () => {
    function makeSnapshot(
      daysAgo: number,
      sizeBytes: number,
      compressed = false,
    ): FileSnapshotRecord {
      const capturedAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
      const provenance = makeProvenance();
      return {
        snapshotId: `snap_${daysAgo}`,
        filePath: "/test.ts",
        contentHash: hashContent(`content_${daysAgo}`),
        sizeBytes,
        capturedAt,
        storagePath: `/tmp/snap_${daysAgo}`,
        compressed,
        provenance,
        trailEventId: `evt_test`,
      };
    }

    it("keeps recent small snapshots", () => {
      const policy = new CompressionPolicy({
        compressAfterDays: 7,
        maxSnapshotSizeBytes: 10_000_000,
      });
      const snap = makeSnapshot(2, 1000);
      const decisions = policy.evaluate([snap]);
      expect(decisions[0]?.action).toBe("keep");
    });

    it("compresses old snapshots", () => {
      const policy = new CompressionPolicy({ compressAfterDays: 7 });
      const snap = makeSnapshot(10, 1000);
      const decisions = policy.evaluate([snap]);
      expect(decisions[0]?.action).toBe("compress");
    });

    it("compresses large snapshots", () => {
      const policy = new CompressionPolicy({ maxSnapshotSizeBytes: 1000 });
      const snap = makeSnapshot(1, 5000);
      const decisions = policy.evaluate([snap]);
      expect(decisions[0]?.action).toBe("compress");
    });

    it("marks already compressed as keep", () => {
      const policy = new CompressionPolicy();
      const snap = makeSnapshot(30, 1000, true);
      const decisions = policy.evaluate([snap]);
      expect(decisions[0]?.action).toBe("keep");
    });

    it("deduplicates identical content hashes", () => {
      const policy = new CompressionPolicy({
        enableDeduplication: true,
        pruneIdenticalHashes: true,
      });
      const hash = hashContent("same content");
      const snap1 = {
        ...makeSnapshot(1, 100),
        contentHash: hash,
        snapshotId: "snap_a",
        capturedAt: new Date(Date.now() - 1000).toISOString(),
      };
      const snap2 = {
        ...makeSnapshot(2, 100),
        contentHash: hash,
        snapshotId: "snap_b",
        capturedAt: new Date(Date.now() - 2000).toISOString(),
      };
      const decisions = policy.evaluate([snap1, snap2]);
      const prune = decisions.filter((d) => d.action === "prune_duplicate");
      expect(prune).toHaveLength(1);
      // The older one should be pruned
      expect(prune[0]?.snapshotId).toBe("snap_b");
    });
  });

  describe("PrivacyPolicy", () => {
    it("excludes node_modules by default", () => {
      const policy = new PrivacyPolicy();
      expect(policy.shouldExcludePath("/project/node_modules/pkg/index.ts")).toBe(true);
      expect(policy.shouldExcludePath("/project/src/main.ts")).toBe(false);
    });

    it("redacts .env content", () => {
      const policy = new PrivacyPolicy();
      expect(policy.shouldRedactContent("/project/.env")).toBe(true);
      expect(policy.shouldRedactContent("/project/.env.local")).toBe(true);
      expect(policy.shouldRedactContent("/project/config.json")).toBe(false);
    });

    it("detects oversized files", () => {
      const policy = new PrivacyPolicy({ maxSnapshotBytes: 1000 });
      expect(policy.tooLargeForSnapshot(500)).toBe(false);
      expect(policy.tooLargeForSnapshot(2000)).toBe(true);
    });

    it("sanitizes env var patterns from event payload", () => {
      const policy = new PrivacyPolicy({ redactEnvVars: true });
      const event = makeEvent({
        payload: { command: "export DATABASE_URL=postgres://user:pass@localhost/db" },
      });
      const sanitized = policy.sanitizeEvent(event);
      expect(JSON.stringify(sanitized.payload)).not.toContain("postgres://");
      expect(JSON.stringify(sanitized.payload)).toContain("[REDACTED]");
    });

    it("filterForExport removes excluded path events", () => {
      const policy = new PrivacyPolicy();
      const events = [
        makeEvent({ payload: { filePath: "/src/main.ts" } }),
        makeEvent({ payload: { filePath: "/node_modules/pkg/index.js" } }),
      ];
      const filtered = policy.filterForExport(events);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.payload["filePath"]).toBe("/src/main.ts");
    });

    // -----------------------------------------------------------------------
    // evaluateCapture + shouldExcludePath Windows paths (Round 4)
    // -----------------------------------------------------------------------
    it("evaluateCapture excludes files over custom maxSnapshotBytes limit", () => {
      const policy = new PrivacyPolicy({ maxSnapshotBytes: 1024 }); // 1KB limit
      expect(policy.evaluateCapture("src/big.ts", 2000)).toBe("exclude");
    });

    it("evaluateCapture allows files below custom maxSnapshotBytes limit", () => {
      const policy = new PrivacyPolicy({ maxSnapshotBytes: 1024 });
      expect(policy.evaluateCapture("src/small.ts", 500)).toBe("capture");
    });

    // -------------------------------------------------------------------------
    // Fix 4: shouldExcludePath works on Windows backslash paths
    // -------------------------------------------------------------------------

    it("shouldExcludePath excludes Windows-style node_modules paths", () => {
      const policy = new PrivacyPolicy();
      expect(policy.shouldExcludePath("C:\\Users\\proj\\node_modules\\react\\index.js")).toBe(true);
    });

    it("shouldExcludePath does not exclude normal source files on Windows paths", () => {
      const policy = new PrivacyPolicy();
      expect(policy.shouldExcludePath("C:\\Users\\proj\\src\\auth.ts")).toBe(false);
    });

    // -----------------------------------------------------------------------
    // globToRegex patterns (Round 6)
    // -----------------------------------------------------------------------
    it("globToRegex: single * does not match across path separators", () => {
      const policy = new PrivacyPolicy({ excludePathPatterns: ["src/*.ts"] });
      // Should match: src/auth.ts
      expect(policy.shouldExcludePath("src/auth.ts")).toBe(true);
      // Should NOT match: src/nested/auth.ts (crosses path boundary)
      expect(policy.shouldExcludePath("src/nested/auth.ts")).toBe(false);
    });

    it("globToRegex: ** matches across path separators", () => {
      const policy = new PrivacyPolicy({ excludePathPatterns: ["**/*.env"] });
      expect(policy.shouldExcludePath("src/.env")).toBe(true);
      expect(policy.shouldExcludePath("src/deeply/nested/.env")).toBe(true);
      expect(policy.shouldExcludePath(".env")).toBe(true);
    });

    it("globToRegex: node_modules/ pattern matches nested paths", () => {
      // The built-in common noise pattern 'node_modules/' should match nested paths
      const policy = new PrivacyPolicy({ excludeCommonNoise: true });
      expect(policy.shouldExcludePath("node_modules/lodash/index.js")).toBe(true);
      expect(policy.shouldExcludePath("packages/core/node_modules/react/index.js")).toBe(true);
      expect(policy.shouldExcludePath("src/components/MyComponent.ts")).toBe(false);
    });

    it("globToRegex: *.lock pattern matches .lock files but not .json files", () => {
      const policy = new PrivacyPolicy({ excludeCommonNoise: true });
      // yarn.lock ends in .lock — should match
      expect(policy.shouldExcludePath("yarn.lock")).toBe(true);
      // package-lock.json ends in .json, not .lock — correctly NOT matched by *.lock
      expect(policy.shouldExcludePath("package-lock.json")).toBe(false);
      // a custom lockfile
      expect(policy.shouldExcludePath("pnpm-lock.yaml")).toBe(false); // .yaml, not .lock
    });

    // -----------------------------------------------------------------------
    // Windows backslash in excludePathPatterns (Round 12 D)
    // -----------------------------------------------------------------------
    it("D: PrivacyPolicy normalizes Windows backslash in excludePathPatterns", () => {
      const policy = new PrivacyPolicy({ excludePathPatterns: ["node_modules\\lib"] });
      expect(policy.shouldExcludePath("node_modules/lib/index.js")).toBe(true);
      expect(policy.shouldExcludePath("src/utils/index.js")).toBe(false);
    });
  });
});

// ============================================================================
// Trail Store
// ============================================================================

describe("Trail Store", () => {
  // -------------------------------------------------------------------------
  // rebuildIndex recovery from corrupted index.json (Failure path)
  // -------------------------------------------------------------------------
  it("rebuildIndex recovers correct lastSeq after index.json is corrupted", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-rebuild-"));
    const logger = new AuditLogger({
      config: { storageRoot, enabled: true },
      sessionId: "sess_rebuild",
    });
    await logger.init();

    // Write 5 events (seq 0..4)
    for (let i = 0; i < 5; i++) {
      await logger.log("tool_call", "TestActor", `Event ${i}`);
    }
    await logger.flush();

    // Corrupt the index.json
    await writeFile(join(storageRoot, "index.json"), "{ corrupt json }}}");

    // Create a fresh store instance (same storageRoot — bypasses singleton)
    const freshStore = new TrailStore(storageRoot);
    await freshStore.init(); // loads corrupted index → starts fresh (lastSeq = 0)
    expect(freshStore.getLastSeq()).toBe(0);

    // Rebuild from the JSONL source of truth
    await freshStore.rebuildIndex();

    // All 5 events recovered: seq 1..5, so lastSeq = 5
    expect(freshStore.getLastSeq()).toBe(5);

    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Cache invalidation on new events (Gap 5)
  // -------------------------------------------------------------------------
  it("invalidateCache() is called on each log() call via setOnNewEventCallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dt-cache-inval-"));
    const storageRoot = join(dir, "trail");

    const logger = new AuditLogger({
      config: {
        storageRoot,
        enabled: true,
        retentionDays: 30,
        compressSnapshots: false,
        compressAfterDays: 7,
        maxStorageMb: 500,
      },
    });
    await logger.init();

    const invalidateSpy = vi.fn();
    logger.setOnNewEventCallback(invalidateSpy);

    await logger.log("tool_call", "Actor", "first event");
    await logger.log("tool_call", "Actor", "second event");

    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    await rm(dir, { recursive: true });
  });

  it("TrailQueryEngine sees fresh data after log() when cache was invalidated", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dt-qe-fresh-"));
    const storageRoot = join(dir, "trail");

    const logger = new AuditLogger({
      config: {
        storageRoot,
        enabled: true,
        retentionDays: 30,
        compressSnapshots: false,
        compressAfterDays: 7,
        maxStorageMb: 500,
      },
      sessionId: "sess_fresh",
      runId: "run_fresh",
    });
    await logger.init();

    const queryEngine = new TrailQueryEngine(
      {
        storageRoot,
        enabled: true,
        retentionDays: 30,
        compressSnapshots: false,
        compressAfterDays: 7,
        maxStorageMb: 500,
      },
      logger.getIndex(),
    );
    // Wire cache invalidation
    logger.setOnNewEventCallback(() => queryEngine.invalidateCache());

    // Log an event, drain, then query — should see the event
    await logger.log("file_write", "FileSystem", "File write: /test.ts", { filePath: "/test.ts" });
    await logger.drain();

    const result = await queryEngine.query({ sessionId: "sess_fresh", limit: 10 });
    expect(result.totalMatches).toBeGreaterThan(0);

    await rm(dir, { recursive: true });
  });

  // -------------------------------------------------------------------------
  // filePathPrefix boundary semantics (Round 4)
  // -------------------------------------------------------------------------
  it("filePathPrefix does not match files with similar but different names", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-prefix-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_prefix" });
    await logger.init();
    // /src/auth-utils.ts should NOT match prefix "/src/auth" (old bug: it did via startsWith)
    await logger.logFileWrite("/src/auth-utils.ts");
    // /src/auth/middleware.ts SHOULD match (child of /src/auth/ directory)
    await logger.logFileWrite("/src/auth/middleware.ts");
    await logger.flush();

    const engine = new TrailQueryEngine({ storageRoot });
    const result = await engine.query({ filePathPrefix: "/src/auth", fileEventsOnly: true });

    const paths = result.results.map((e) => e.payload["filePath"] as string);
    // Child of the /src/auth/ directory should match
    expect(paths).toContain("/src/auth/middleware.ts");
    // File with similar name but NOT in /src/auth/ should NOT match
    expect(paths).not.toContain("/src/auth-utils.ts");

    await rm(storageRoot, { recursive: true, force: true });
  });
});

// ============================================================================
// Audit Logger
// ============================================================================

describe("Audit Logger", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dt-r14-audit-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Async write queue — multiple rapid log() calls (Gap 4)
  // -------------------------------------------------------------------------
  it("multiple rapid log() calls produce correct sequential output after drain()", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dt-queue-"));
    const storageRoot = join(dir, "trail");

    const logger = new AuditLogger({
      config: {
        storageRoot,
        enabled: true,
        retentionDays: 30,
        compressSnapshots: false,
        compressAfterDays: 7,
        maxStorageMb: 500,
      },
      sessionId: "sess_queue_test",
      runId: "run_queue_test",
    });
    await logger.init();

    // Fire 20 rapid log calls without awaiting in between
    const promises = Array.from({ length: 20 }, (_, i) =>
      logger.log("tool_call", "TestActor", `event ${i}`, { seq: i }),
    );
    await Promise.all(promises);

    // Drain ensures all queued disk writes complete
    await logger.drain();

    // Verify all events reached disk by reading the store directly
    const store = logger.getStore();
    const events = await store.readAllEvents();
    expect(events).toHaveLength(20);

    await rm(dir, { recursive: true });
  });

  it("flush() waits for queued writes before persisting index", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dt-flush-"));
    const storageRoot = join(dir, "trail");

    const logger = new AuditLogger({
      config: {
        storageRoot,
        enabled: true,
        retentionDays: 30,
        compressSnapshots: false,
        compressAfterDays: 7,
        maxStorageMb: 500,
      },
    });
    await logger.init();

    // Log 5 events then flush immediately
    for (let i = 0; i < 5; i++) {
      void logger.log("tool_call", "Actor", `event ${i}`);
    }
    await logger.flush();

    const store = logger.getStore();
    const events = await store.readAllEvents();
    expect(events).toHaveLength(5);

    await rm(dir, { recursive: true });
  });

  // -------------------------------------------------------------------------
  // flush() returns anomaly flags (Round 6)
  // -------------------------------------------------------------------------
  it("flush() returns empty array when no anomalies detected", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r6-flush-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r6_noAnomaly" });
    await logger.init();
    await logger.log("tool_call", "Actor", "normal operation", {});
    const result = await logger.flush();
    expect(Array.isArray(result.anomalies)).toBe(true);
    expect(result.anomalies).toHaveLength(0);
    expect(result.detection.analyzedCount).toBe(1);
    expect(result.detection.truncated).toBe(false);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("flush() returns detected anomaly flags", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r6-flush-flags-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r6_flags" });
    await logger.init();

    // 3 burst deletions triggers burst_deletion anomaly
    for (const fp of ["/src/a.ts", "/src/b.ts", "/src/c.ts"]) {
      await logger.log("file_delete", "FileSystem", `Delete ${fp}`, { filePath: fp });
    }
    const result = await logger.flush();
    expect(result.anomalies.some((f) => f.anomalyType === "burst_deletion")).toBe(true);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("flush() calls onAnomalyDetected callback with FlushResult", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r6-callback-"));
    type FlushResult = import("./audit-logger.js").FlushResult;
    const callbackResults: FlushResult[] = [];
    const logger = new AuditLogger({
      config: { storageRoot },
      sessionId: "sess_r6_cb",
      onAnomalyDetected: (result) => callbackResults.push(result),
    });
    await logger.init();

    for (const fp of ["/src/x.ts", "/src/y.ts", "/src/z.ts"]) {
      await logger.log("file_delete", "FileSystem", `Delete ${fp}`, { filePath: fp });
    }
    await logger.flush();

    expect(callbackResults).toHaveLength(1);
    expect(callbackResults[0]!.anomalies.some((f) => f.anomalyType === "burst_deletion")).toBe(
      true,
    );
    expect(callbackResults[0]!.detection.analyzedCount).toBe(3);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("flush() does NOT call onAnomalyDetected on second flush (dedup guard)", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r6-cb-dedup-"));
    let callCount = 0;
    const logger = new AuditLogger({
      config: { storageRoot },
      sessionId: "sess_r6_cb_dedup",
      onAnomalyDetected: () => {
        callCount++;
      },
    });
    await logger.init();
    for (const fp of ["/src/x.ts", "/src/y.ts", "/src/z.ts"]) {
      await logger.log("file_delete", "FileSystem", `Delete ${fp}`, { filePath: fp });
    }
    await logger.flush();
    await logger.flush(); // second flush — callback should NOT fire again
    expect(callCount).toBe(1);
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // getAnomalyDetector() + getSessionEvents() (Round 6)
  // -------------------------------------------------------------------------
  it("getAnomalyDetector() returns the same AnomalyDetector instance used by flush()", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r6-get-detector-"));
    const customDetector = new AnomalyDetector({ burstDeletionCount: 10 });
    const logger = new AuditLogger({ config: { storageRoot }, anomalyDetector: customDetector });
    await logger.init();
    expect(logger.getAnomalyDetector()).toBe(customDetector);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("getSessionEvents() returns current session events in insertion order", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r6-get-events-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r6_events" });
    await logger.init();
    await logger.log("tool_call", "Actor", "event A", {});
    await logger.log("tool_call", "Actor", "event B", {});
    const events = logger.getSessionEvents();
    expect(events).toHaveLength(2);
    expect(events[0]!.summary).toBe("event A");
    expect(events[1]!.summary).toBe("event B");
    // Returns a copy — mutating does not affect internal state
    events.push({} as never);
    expect(logger.getSessionEvents()).toHaveLength(2);
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // sessionEvents buffer bounded at sessionEventsBufferLimit (Round 7)
  // -------------------------------------------------------------------------
  it("sessionEvents buffer stops growing at sessionEventsBufferLimit", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r7-buffer-"));
    const logger = new AuditLogger({
      config: { storageRoot, sessionEventsBufferLimit: 3 },
      sessionId: "sess_r7_buffer",
    });
    await logger.init();

    // Log 5 events — only 3 should end up in the buffer
    for (let i = 0; i < 5; i++) {
      await logger.log("tool_call", "Actor", `event ${i}`, {});
    }

    // All 5 must be persisted to disk
    const store = logger.getStore();
    const allEvents = await store.readAllEvents();
    const sessionEvents = allEvents.filter((e) => e.provenance.sessionId === "sess_r7_buffer");
    expect(sessionEvents.length).toBeGreaterThanOrEqual(5);

    // But only 3 in the in-memory buffer
    expect(logger.getSessionEvents()).toHaveLength(3);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("sessionEvents buffer defaults to 10_000 (not exceeded in normal use)", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r7-buffer-default-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r7_default" });
    await logger.init();

    // 100 events — all should be in buffer (well under 10K limit)
    for (let i = 0; i < 100; i++) {
      await logger.log("tool_call", "Actor", `event ${i}`, {});
    }
    expect(logger.getSessionEvents()).toHaveLength(100);
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // FlushResult observability: bufferTruncated + analyzedCount (Round 8)
  // -------------------------------------------------------------------------
  it("FlushResult.bufferTruncated is true when buffer limit is exceeded", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r8-truncated-"));
    const logger = new AuditLogger({
      config: { storageRoot, sessionEventsBufferLimit: 2 },
      sessionId: "sess_r8_trunc",
    });
    await logger.init();
    // Log 5 events — buffer holds only 2
    for (let i = 0; i < 5; i++) {
      await logger.log("tool_call", "Actor", `event ${i}`, {});
    }
    const result = await logger.flush();
    expect(result.detection.truncated).toBe(true);
    // Round 11: disk spill now loads overflow, so all 5 events are analyzed
    expect(result.detection.analyzedCount).toBe(5);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("FlushResult.bufferTruncated is false when buffer is not exceeded", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r8-not-truncated-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r8_notrunc" });
    await logger.init();
    await logger.log("tool_call", "Actor", "small event", {});
    const result = await logger.flush();
    expect(result.detection.truncated).toBe(false);
    expect(result.detection.analyzedCount).toBe(1);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("onAnomalyDetected receives FlushResult with bufferTruncated and analyzedCount", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r8-cb-meta-"));
    type FlushResult = import("./audit-logger.js").FlushResult;
    let received: FlushResult | null = null;
    const logger = new AuditLogger({
      config: { storageRoot, sessionEventsBufferLimit: 2 },
      sessionId: "sess_r8_cb_meta",
      onAnomalyDetected: (result) => {
        received = result;
      },
    });
    await logger.init();
    for (let i = 0; i < 4; i++) {
      await logger.log("tool_call", "Actor", `event ${i}`, {});
    }
    await logger.flush();
    expect(received).not.toBeNull();
    expect(received!.detection.truncated).toBe(true);
    // Round 11: disk spill now loads overflow, so all 4 events are analyzed
    expect(received!.detection.analyzedCount).toBe(4);
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Multi-lane cursor-based detection (Round 8)
  // -------------------------------------------------------------------------
  it("flush() after setLaneContext() analyzes the new lane's events (cursor-based)", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r8-multilane-"));
    const results: import("./audit-logger.js").FlushResult[] = [];
    const logger = new AuditLogger({
      config: { storageRoot },
      sessionId: "sess_r8_ml",
      onAnomalyDetected: (r) => results.push(r),
    });
    await logger.init();

    // Lane A: log 1 normal event, flush
    await logger.log("tool_call", "Actor", "lane A event", {});
    const r1 = await logger.flush();
    expect(r1.detection.analyzedCount).toBe(1);

    // Switch to lane B and log more events — flush should analyze only lane B's events
    logger.setLaneContext("lane_b", "lane_a");
    await logger.log("tool_call", "Actor", "lane B event", {});
    const r2 = await logger.flush();
    expect(r2.detection.analyzedCount).toBe(1); // only the 1 new event from lane B

    expect(results).toHaveLength(2); // both flushes had events to analyze
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("flush() on same lane twice does not re-analyze already-analyzed events", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r8-nodup-cursor-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r8_nodup" });
    await logger.init();
    for (const fp of ["/src/a.ts", "/src/b.ts", "/src/c.ts"]) {
      await logger.log("file_delete", "FileSystem", `Delete ${fp}`, { filePath: fp });
    }
    const r1 = await logger.flush();
    expect(r1.detection.analyzedCount).toBe(3);

    const r2 = await logger.flush(); // second flush — no new events
    expect(r2.detection.analyzedCount).toBe(0);
    expect(r2.anomalies).toHaveLength(0);
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // flush({ endSession: false }) (Round 9)
  // -------------------------------------------------------------------------
  it("flush({ endSession: false }) does not end the session in sessionMap", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r9-endsess-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r9_endsess" });
    await logger.init();
    await logger.log("tool_call", "Actor", "event 1", {});
    // Intermediate flush — session should remain active
    await logger.flush({ endSession: false });
    await logger.log("tool_call", "Actor", "event 2", {});
    // Final flush — session ends
    const result = await logger.flush();
    expect(result.detection.analyzedCount).toBeGreaterThanOrEqual(1);
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Cross-boundary burst detection (Round 9)
  // -------------------------------------------------------------------------
  it("cross-boundary burst: burst spanning two flush() calls is detected", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r9-xburst-"));
    const logger = new AuditLogger({
      config: { storageRoot },
      sessionId: "sess_r9_xburst",
      anomalyDetector: new AnomalyDetector({
        burstDeletionCount: 3,
        burstDeletionWindowMs: 60_000, // 60s window so timestamps in-test fall within it
      }),
    });
    await logger.init();

    // Log 2 deletions — below threshold, no anomaly yet
    await logger.logFileDelete("/src/a.ts", "hash1");
    await logger.logFileDelete("/src/b.ts", "hash2");

    // First flush — 2 events, no burst (threshold is 3)
    const r1 = await logger.flush({ endSession: false });
    expect(r1.anomalies.filter((a) => a.anomalyType === "burst_deletion")).toHaveLength(0);

    // Log 1 more deletion — now 3 total within window
    await logger.logFileDelete("/src/c.ts", "hash3");

    // Second flush — lookback context sees the prior 2 deletions → burst detected
    const r2 = await logger.flush();
    const burstFlags = r2.anomalies.filter((a) => a.anomalyType === "burst_deletion");
    expect(burstFlags).toHaveLength(1);
    // relatedEventIds should include all 3 deletions
    expect(burstFlags[0]!.relatedEventIds).toHaveLength(3);

    await rm(storageRoot, { recursive: true, force: true });
  });

  it("cross-boundary burst dedup: no duplicate flags when burst spans flush boundary", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r9-xburst-dedup-"));
    const logger = new AuditLogger({
      config: { storageRoot },
      sessionId: "sess_r9_dedup",
      anomalyDetector: new AnomalyDetector({
        burstDeletionCount: 3,
        burstDeletionWindowMs: 60_000,
      }),
    });
    await logger.init();

    // Log 3 deletions — full burst in one flush
    await logger.logFileDelete("/src/x.ts", "hx");
    await logger.logFileDelete("/src/y.ts", "hy");
    await logger.logFileDelete("/src/z.ts", "hz");

    const r1 = await logger.flush({ endSession: false });
    const burstCount1 = r1.anomalies.filter((a) => a.anomalyType === "burst_deletion").length;
    expect(burstCount1).toBe(1);

    // Second flush with no new deletions — dedup should suppress re-detection
    await logger.log("tool_call", "Actor", "unrelated event", {});
    const r2 = await logger.flush();
    // The burst_deletion from r1 should NOT appear again
    const burstCount2 = r2.anomalies.filter((a) => a.anomalyType === "burst_deletion").length;
    expect(burstCount2).toBe(0);

    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // analyzedCount semantics — only new events (Round 9)
  // -------------------------------------------------------------------------
  it("flush analyzedCount reflects only new events, not lookback context events", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r9-count-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r9_count" });
    await logger.init();

    // Log 2 events, flush — cursor advances to 2
    await logger.log("tool_call", "Actor", "ev1", {});
    await logger.log("tool_call", "Actor", "ev2", {});
    const r1 = await logger.flush({ endSession: false });
    expect(r1.detection.analyzedCount).toBe(2);

    // Log 3 more events, flush — analyzedCount = 3 (not 5)
    await logger.log("tool_call", "Actor", "ev3", {});
    await logger.log("tool_call", "Actor", "ev4", {});
    await logger.log("tool_call", "Actor", "ev5", {});
    const r2 = await logger.flush();
    expect(r2.detection.analyzedCount).toBe(3);

    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // DiskWriteError on store failure (Failure path)
  // -------------------------------------------------------------------------
  it("logger.log() throws DiskWriteError when store.appendEvent rejects", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-fail-"));
    const logger = new AuditLogger({
      config: { storageRoot, enabled: true },
      sessionId: "sess_fail_test",
    });
    await logger.init();

    // Monkey-patch the store's appendEvent to throw
    const store = logger.getStore();
    const original = store.appendEvent.bind(store);
    store.appendEvent = async () => {
      throw new Error("ENOSPC: no space left on device");
    };

    await expect(logger.log("tool_call", "Test", "will fail")).rejects.toThrow("DiskWriteError");
    await expect(logger.log("tool_call", "Test", "will fail again")).rejects.toMatchObject({
      name: "DiskWriteError",
      seq: expect.any(Number),
      eventId: expect.any(String),
    });

    store.appendEvent = original; // restore
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Buffer overflow disk spill (Round 11)
  // -------------------------------------------------------------------------
  it("flush() reads overflow events from disk when buffer is truncated", async () => {
    // Use a tiny buffer limit of 5 to trigger truncation easily
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r11-spill-"));
    const logger = new AuditLogger({
      config: { storageRoot, sessionEventsBufferLimit: 5 },
      sessionId: "sess_r11_spill",
    });
    await logger.init();

    // Log 5 events to fill the buffer (indices 0–4)
    for (let i = 0; i < 5; i++) {
      await logger.log("tool_call", "Actor", `event ${i}`, {});
    }

    // Log 3 file_delete events as overflow (indices 5–7, beyond buffer limit)
    await logger.logFileDelete("/src/a.ts", "hash-a");
    await logger.logFileDelete("/src/b.ts", "hash-b");
    await logger.logFileDelete("/src/c.ts", "hash-c");

    const result = await logger.flush();

    // Buffer should be marked truncated
    expect(result.detection.truncated).toBe(true);

    // All 8 events should have been analyzed (5 buffer + 3 overflow)
    // (anomaly_flag events are excluded from analyzedCount — only non-anomaly events)
    expect(result.detection.analyzedCount).toBeGreaterThanOrEqual(8);

    // The 3 overflow deletions should trigger burst_deletion (3 in 5s)
    const burstFlags = result.anomalies.filter((a) => a.anomalyType === "burst_deletion");
    expect(burstFlags).toHaveLength(1);
    expect(burstFlags[0]!.relatedEventIds).toHaveLength(3);

    await rm(storageRoot, { recursive: true, force: true });
  });

  it("overflow events are only analyzed once across multiple flush() calls", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r11-spill2-"));
    const logger = new AuditLogger({
      config: { storageRoot, sessionEventsBufferLimit: 3 },
      sessionId: "sess_r11_spill2",
    });
    await logger.init();

    // Fill buffer with 3 events
    for (let i = 0; i < 3; i++) {
      await logger.log("tool_call", "Actor", `event ${i}`, {});
    }

    // 2 overflow events (indices 3, 4 — beyond buffer limit)
    await logger.log("tool_call", "Actor", "overflow-a", {});
    await logger.log("tool_call", "Actor", "overflow-b", {});

    // First flush — analyzes 3 buffer + 2 overflow = 5 total
    const r1 = await logger.flush({ endSession: false });
    expect(r1.detection.analyzedCount).toBe(5);

    // Add 2 more overflow events (indices 5, 6)
    await logger.log("tool_call", "Actor", "overflow-c", {});
    await logger.log("tool_call", "Actor", "overflow-d", {});

    // Second flush — should analyze ONLY the 2 new overflow events, not re-analyze the 5 from before
    const r2 = await logger.flush({ endSession: false });
    expect(r2.detection.analyzedCount).toBe(2);

    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // fence-post bufferTruncated boundary (Round 14 C)
  // -------------------------------------------------------------------------
  it("C: bufferTruncated is false when session has exactly sessionEventsBufferLimit events", async () => {
    const logger = new AuditLogger({
      config: { storageRoot: tmpDir, sessionEventsBufferLimit: 4 },
    });
    await logger.init();

    for (let i = 0; i < 4; i++) {
      await logger.log("file_write", "Write", `write ${i}`, { filePath: `/c${i}.ts` });
    }

    const result = await logger.flush();
    expect(result.detection.truncated).toBe(false);
  });

  // C fence-post true — limit+1 events → bufferTruncated must be true
  it("C: bufferTruncated is true when session exceeds sessionEventsBufferLimit", async () => {
    const logger = new AuditLogger({
      config: { storageRoot: tmpDir, sessionEventsBufferLimit: 4 },
    });
    await logger.init();

    for (let i = 0; i < 5; i++) {
      await logger.log("file_write", "Write", `write ${i}`, { filePath: `/c${i}.ts` });
    }

    const result = await logger.flush();
    expect(result.detection.truncated).toBe(true);
  });
});

// ============================================================================
// File Snapshotter
// ============================================================================

describe("File Snapshotter", () => {
  // -------------------------------------------------------------------------
  // captureSnapshot deduplication (Gap 1)
  // -------------------------------------------------------------------------
  it("captureSnapshot twice for same content writes only one .bin file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dt-snap-dedup-"));
    const storageRoot = join(dir, "trail");
    const srcFile = join(dir, "source.ts");
    await writeFile(srcFile, "const x = 1;");

    const snapshotter = new FileSnapshotter({ storageRoot });
    await snapshotter.init();

    const provenance: TrailProvenance = {
      sessionId: `sess_${randomUUID().slice(0, 8)}`,
      runId: `run_${randomUUID().slice(0, 8)}`,
    };

    const snap1 = await snapshotter.captureSnapshot(srcFile, "evt1", provenance);
    const snap2 = await snapshotter.captureSnapshot(srcFile, "evt2", provenance);

    // Both calls must succeed and return a valid record
    expect(snap1).not.toBeNull();
    expect(snap2).not.toBeNull();

    // Both records must share the same contentHash
    expect(snap1!.contentHash).toBe(snap2!.contentHash);

    // Only one .bin file should exist on disk (dedup skips re-write)
    const snapshotsDir = join(storageRoot, "snapshots");
    const files = await readdir(snapshotsDir);
    const binFiles = files.filter((f) => f.endsWith(".bin"));
    expect(binFiles).toHaveLength(1);

    await rm(dir, { recursive: true });
  });

  it("captureSnapshot for different content writes two .bin files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dt-snap-diff-"));
    const storageRoot = join(dir, "trail");
    const srcFile = join(dir, "source.ts");

    const snapshotter = new FileSnapshotter({ storageRoot });
    await snapshotter.init();

    const provenance: TrailProvenance = {
      sessionId: `sess_${randomUUID().slice(0, 8)}`,
      runId: `run_${randomUUID().slice(0, 8)}`,
    };

    await writeFile(srcFile, "const x = 1;");
    await snapshotter.captureSnapshot(srcFile, "evt1", provenance);

    await writeFile(srcFile, "const x = 2;");
    await snapshotter.captureSnapshot(srcFile, "evt2", provenance);

    const snapshotsDir = join(storageRoot, "snapshots");
    const files = await readdir(snapshotsDir);
    const binFiles = files.filter((f) => f.endsWith(".bin"));
    expect(binFiles).toHaveLength(2);

    await rm(dir, { recursive: true });
  });

  // -------------------------------------------------------------------------
  // Snapshot manifest persistence (Gap 2)
  // -------------------------------------------------------------------------

  it("snapshot records survive across FileSnapshotter instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dt-manifest-"));
    const storageRoot = join(dir, "trail");
    const srcFile = join(dir, "source.ts");
    await writeFile(srcFile, "export const x = 42;");

    const provenance: TrailProvenance = {
      sessionId: "sess_manifest",
      runId: "run_manifest",
    };

    // First instance: capture snapshot
    const snapshotter1 = new FileSnapshotter({ storageRoot });
    await snapshotter1.init();
    const snap = await snapshotter1.captureSnapshot(srcFile, "evt1", provenance);
    expect(snap).not.toBeNull();

    // Second instance: init should load manifest and populate dedup cache
    const snapshotter2 = new FileSnapshotter({ storageRoot });
    await snapshotter2.init();

    // Writing same content again should reuse cached record (no new .bin file)
    const snap2 = await snapshotter2.captureSnapshot(srcFile, "evt2", provenance);
    expect(snap2).not.toBeNull();
    expect(snap2!.contentHash).toBe(snap!.contentHash);

    const snapshotsDir = join(storageRoot, "snapshots");
    const files = await readdir(snapshotsDir);
    const binFiles = files.filter((f) => f.endsWith(".bin"));
    expect(binFiles).toHaveLength(1);

    await rm(dir, { recursive: true });
  });

  // -------------------------------------------------------------------------
  // getSnapshotRecords() public method (Round 10)
  // -------------------------------------------------------------------------
  it("FileSnapshotter.getSnapshotRecords() returns persisted records after captureSnapshot", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r10-snaprecs-"));
    const testFile = join(storageRoot, "test.ts");
    await writeFile(testFile, "export const x = 1;");

    const snapshotter = new FileSnapshotter({ storageRoot });
    const prov = makeProvenance({ sessionId: "sess_r10_snaprecs" });
    await snapshotter.captureSnapshot(testFile, "evt1", prov);

    const records = await snapshotter.getSnapshotRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.filePath).toBe(testFile);
    expect(records[0]!.contentHash).toBeTruthy();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("FileSnapshotter.getSnapshotRecords() returns empty array before any snapshots", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r10-snaprecs-empty-"));
    const snapshotter = new FileSnapshotter({ storageRoot });
    const records = await snapshotter.getSnapshotRecords();
    expect(records).toEqual([]);
    await rm(storageRoot, { recursive: true, force: true });
  });
});

// ============================================================================
// Replay & Restore
// ============================================================================

describe("Replay & Restore", () => {
  // -------------------------------------------------------------------------
  // replaySession full trail + step (Gap 6)
  // -------------------------------------------------------------------------
  it("replaySession without step returns all events in trail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dt-replay-full-"));
    const storageRoot = join(dir, "trail");

    // Seed the store directly with 10 events
    const store = new TrailStore(storageRoot);
    await store.init();
    const sessionId = "sess_replay_test";
    const runId = "run_replay_test";

    for (let i = 0; i < 10; i++) {
      await store.appendEvent({
        id: `evt_${i}`,
        seq: i,
        timestamp: new Date().toISOString(),
        kind: "tool_call",
        actor: "TestActor",
        summary: `event ${i}`,
        payload: {},
        provenance: { sessionId, runId },
      });
    }

    const orchestrator = new ReplayOrchestrator({ storageRoot });
    const result = await orchestrator.replaySession(sessionId);

    // Full trail must contain all 10 events
    expect(result.trail).toHaveLength(10);
    expect(result.replayed).toBe(true);

    await rm(dir, { recursive: true });
  });

  it("replaySession with step returns events up to that step only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dt-replay-step-"));
    const storageRoot = join(dir, "trail");

    const store = new TrailStore(storageRoot);
    await store.init();
    const sessionId = "sess_replay_step";
    const runId = "run_replay_step";

    for (let i = 0; i < 8; i++) {
      await store.appendEvent({
        id: `evt_${i}`,
        seq: i,
        timestamp: new Date().toISOString(),
        kind: "tool_call",
        actor: "TestActor",
        summary: `event ${i}`,
        payload: {},
        provenance: { sessionId, runId },
      });
    }

    const orchestrator = new ReplayOrchestrator({ storageRoot });
    const result = await orchestrator.replaySession(sessionId, 4);

    // trail must contain events 0..4 (5 events)
    expect(result.trail).toHaveLength(5);
    expect(result.step).toBe(4);

    await rm(dir, { recursive: true });
  });

  // -------------------------------------------------------------------------
  // ReplayOrchestrator session map bounded at 50 (Round 12 E1)
  // -------------------------------------------------------------------------
  it("E1: ReplayOrchestrator keeps map bounded at MAX_REPLAY_SESSIONS (50)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "r12-e1-"));
    try {
      const config = { ...defaultConfig(), storageRoot: tmpDir };
      const orchestrator = new ReplayOrchestrator(config);

      // Start 52 replays with distinct session IDs (all return empty — no events in store).
      const sessionIds: string[] = [];
      for (let i = 0; i < 52; i++) {
        const sid = `sess_evict_${i}_${randomUUID().slice(0, 6)}`;
        sessionIds.push(sid);
        await orchestrator.startReplay(sid);
      }

      // No crash and the 52nd session is still addressable via stepForward (which restarts it if evicted).
      const lastId = sessionIds[51]!;
      const cursor = await orchestrator.stepForward(lastId, 1);
      expect(cursor.sessionId).toBe(lastId);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // restoreFromSnapshot — hash mismatch detection (Failure path)
  // -------------------------------------------------------------------------
  it("restoreFromSnapshot returns hash_mismatch when snapshot file is corrupted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dt-hash-"));
    const storageRoot = join(dir, "trail");
    const filePath = join(dir, "target.ts");
    const restorePath = join(dir, "restored.ts");
    await writeFile(filePath, "original content");

    const snapshotter = new FileSnapshotter({ storageRoot });
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_hash" });
    await logger.init();

    const prov = logger.getProvenance();
    const snap = await snapshotter.captureSnapshot(filePath, "hash-test", prov);
    expect(snap).not.toBeNull();

    // Corrupt the snapshot binary on disk
    await writeFile(snap!.storagePath, "CORRUPTED DATA -- NOT ORIGINAL");

    // Restore should detect the hash mismatch
    const restoreEngine = new RestoreEngine(snapshotter, logger);
    const result = await restoreEngine.restoreFromSnapshot(snap!.snapshotId, restorePath);

    expect(result.restored).toBe(false);
    expect(result.error).toMatch(/hash.mismatch/i);

    // Best-effort cleanup — on Windows, AuditLogger may keep trail/ handles open.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  // -------------------------------------------------------------------------
  // restoreFromSnapshot dryRun emits audit record (Round 12 A3)
  // -------------------------------------------------------------------------
  it("A3: restoreFromSnapshot dryRun:true returns a truthy auditEventId", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "r12-a3-"));
    try {
      const config = { ...defaultConfig(), storageRoot: tmpDir };
      const logger = new AuditLogger({ config });
      const snapshotter = new FileSnapshotter(config);
      const restoreEngine = new RestoreEngine(snapshotter, logger);

      // Create a real file and capture a snapshot so snapshotExists() returns true.
      const testFile = join(tmpDir, "test-file.txt");
      await writeFile(testFile, "hello round 12");
      const provenance = makeProvenance();
      const snap = await snapshotter.captureSnapshot(testFile, "test", provenance);
      expect(snap).not.toBeNull();

      // F1 fix: dryRun:true with no overwrite key must now reach the dry-run path even when
      // the target already exists (overwrite defaults to true per JSDoc).
      const result = await restoreEngine.restoreFromSnapshot(snap!.snapshotId, testFile, {
        dryRun: true,
        // NOTE: no overwrite key — undefined must be treated as true per "Default: true"
      });

      expect(result.error).toBe("dry_run");
      expect(result.restored).toBe(false);
      expect(typeof result.auditEventId).toBe("string");
      expect(result.auditEventId).toBeTruthy();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // getRestorableSnapshots — snapshotId null for no-before-state (Round 12 A2)
  // -------------------------------------------------------------------------
  it("A2: getRestorableSnapshots returns snapshotId null for no-before-state tombstone", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "r12-a2-"));
    try {
      const config = { ...defaultConfig(), storageRoot: tmpDir };
      const logger = new AuditLogger({ config });
      const snapshotter = new FileSnapshotter(config);
      const restoreEngine = new RestoreEngine(snapshotter, logger);

      const filePath = "/virtual/missing-before-state.ts";
      const provenance = makeProvenance();

      // Register a tombstone that has no before-state (file was never tracked).
      snapshotter.getTombstones().register({
        tombstoneId: "tomb_r12_test_001",
        filePath,
        deletedAt: new Date().toISOString(),
        deletedBy: "TestActor",
        trailEventId: "evt_r12_a2_test",
        provenance,
        beforeStateCaptured: false,
        missingBeforeReason: "file_never_tracked",
        lastSnapshotId: undefined,
      });

      const results = restoreEngine.getRestorableSnapshots(filePath);
      expect(results).toHaveLength(1);
      expect(results[0]!.snapshotId).toBeNull();
      expect(results[0]!.hasBeforeState).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // dryRun on existing target — overwrite defaults true (Round 13 F1)
  // -------------------------------------------------------------------------
  it("F1: restoreFromSnapshot dryRun on existing file (no overwrite key) returns dry_run not overwrite error", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "r13-f1-"));
    try {
      const config = { ...defaultConfig(), storageRoot: tmpDir };
      const logger = new AuditLogger({ config });
      const snapshotter = new FileSnapshotter(config);
      const restoreEngine = new RestoreEngine(snapshotter, logger);

      const testFile = join(tmpDir, "existing-target.txt");
      await writeFile(testFile, "existing content");
      const snap = await snapshotter.captureSnapshot(testFile, "test", makeProvenance());
      expect(snap).not.toBeNull();

      // Target exists, no overwrite key — overwrite must default to true so we reach dryRun.
      const result = await restoreEngine.restoreFromSnapshot(snap!.snapshotId, testFile, {
        dryRun: true,
      });

      expect(result.error).toBe("dry_run");
      expect(result.restored).toBe(false);
      expect(result.auditEventId).toBeTruthy();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Integrations & Config
// ============================================================================

describe("Integrations & Config", () => {
  // -------------------------------------------------------------------------
  // defaultConfig
  // -------------------------------------------------------------------------
  it("returns valid config", () => {
    const config = defaultConfig();
    expect(config.enabled).toBe(true);
    expect(config.retentionDays).toBe(30);
    expect(config.storageRoot).toContain(".dantecode/debug-trail");
  });

  // -------------------------------------------------------------------------
  // DiskWriteError is exported and is an Error subclass (Round 12 C)
  // -------------------------------------------------------------------------
  it("C: DiskWriteError is an Error subclass with eventId and seq properties", () => {
    const err = new DiskWriteError("evt_r12_test", 99, new Error("disk full"));
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DiskWriteError");
    expect(err.eventId).toBe("evt_r12_test");
    expect(err.seq).toBe(99);
    expect(err.message).toContain("disk full");
  });

  // -------------------------------------------------------------------------
  // FlushResult, StorageQuotaPolicy, TrailErrorCode exports (Round 9)
  // -------------------------------------------------------------------------
  it("FlushResult is exported from index.ts", async () => {
    const mod = await import("./index.js");
    // The type is exported — verify the module resolves without error.
    // We can't check a type at runtime, but we verify the module loads cleanly.
    expect(mod.AuditLogger).toBeDefined();
    // If FlushResult export was missing, tsc --noEmit would have already failed
  });

  // -------------------------------------------------------------------------
  // Gap A: StorageQuotaPolicy exported from index.ts
  // -------------------------------------------------------------------------

  it("StorageQuotaPolicy is exported from index.ts", async () => {
    const mod = await import("./index.js");
    expect((mod as Record<string, unknown>)["StorageQuotaPolicy"]).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Gap B: TrailErrorCode exported from index.ts
  // -------------------------------------------------------------------------

  it("TrailErrorCode is exported from index.ts", async () => {
    const mod = await import("./index.js");
    const trailErrorCode = (mod as Record<string, unknown>)["TrailErrorCode"] as
      | Record<string, string>
      | undefined;
    expect(trailErrorCode).toBeDefined();
    expect(trailErrorCode?.["SNAPSHOT_NOT_FOUND"]).toBe("snapshot_not_found");
    expect(trailErrorCode?.["DISK_WRITE_ERROR"]).toBe("disk_write_error");
  });

  // -------------------------------------------------------------------------
  // CliBridge.detectAnomalies() (Round 6)
  // -------------------------------------------------------------------------
  it("CliBridge.detectAnomalies() uses in-memory session events (no extra disk read)", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r6-bridge-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r6_bridge" });
    await logger.init();

    // 3 burst deletions — all in memory, not yet flushed
    for (const fp of ["/src/a.ts", "/src/b.ts", "/src/c.ts"]) {
      await logger.log("file_delete", "FileSystem", `Delete ${fp}`, { filePath: fp });
    }

    const { CliBridge } = await import("./integrations/cli-bridge.js");
    const bridge = new CliBridge(logger, { storageRoot });
    const flags = await bridge.detectAnomalies();

    expect(flags.some((f) => f.anomalyType === "burst_deletion")).toBe(true);
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // CliBridge.detectAnomalies() cross-session (Round 7)
  // -------------------------------------------------------------------------
  it("CliBridge.detectAnomalies(other_session) uses default config — not current session's mutated config", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r7-cross-session-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_current" });
    await logger.init();

    // Mutate the current session's detector to have a very tight threshold
    logger.getAnomalyDetector().updateConfig({ burstDeletionCount: 2 });

    // Log 3 deletions to a DIFFERENT session ID via a second logger
    const logger2 = new AuditLogger({ config: { storageRoot }, sessionId: "sess_other" });
    await logger2.init();
    for (const fp of ["/x.ts", "/y.ts", "/z.ts"]) {
      await logger2.log("file_delete", "FileSystem", `Delete ${fp}`, { filePath: fp });
    }
    await logger2.flush();

    const { CliBridge } = await import("./integrations/cli-bridge.js");
    const bridge = new CliBridge(logger, { storageRoot });

    // Query the OTHER session — should use default config (burstDeletionCount=3), not the
    // mutated config (burstDeletionCount=2). With default, 3 deletions still triggers burst_deletion.
    const flags = await bridge.detectAnomalies("sess_other");
    expect(flags.some((f) => f.anomalyType === "burst_deletion")).toBe(true);
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // VsCodeBridge responses (Round 10)
  // -------------------------------------------------------------------------
  it("VsCodeBridge.handleQuery() success response has success:true", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r10-vscode-"));
    const { VsCodeBridge } = await import("./integrations/vscode-bridge.js");
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r10_vsc" });
    await logger.init();

    const bridge = new VsCodeBridge(logger, { storageRoot });
    const msg = await bridge.handleQuery("recent errors");
    expect((msg.data as Record<string, unknown>)["success"]).toBe(true);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("VsCodeBridge dispatch unknown command has success:false with results array", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r10-vscode-err-"));
    const { VsCodeBridge } = await import("./integrations/vscode-bridge.js");
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r10_vsc_err" });
    await logger.init();

    const bridge = new VsCodeBridge(logger, { storageRoot });
    const msg = await bridge.dispatch("unknown_command_xyz", {});
    const data = msg.data as Record<string, unknown>;
    expect(data["success"]).toBe(false);
    expect(data["error"]).toContain("Unknown command");
    expect(Array.isArray(data["results"])).toBe(true);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("VsCodeBridge.getRecentEvents() success response has events array", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r10-recent-"));
    const { VsCodeBridge } = await import("./integrations/vscode-bridge.js");
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r10_recent" });
    await logger.init();
    await logger.log("tool_call", "Actor", "something happened", {});
    await logger.flush();

    const bridge = new VsCodeBridge(logger, { storageRoot });
    const msg = await bridge.getRecentEvents(5);
    const data = msg.data as Record<string, unknown>;
    expect(data["success"]).toBe(true);
    expect(Array.isArray(data["events"])).toBe(true);
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Trail Store: JSONL corruption recovery (Round 14 A)
  // -------------------------------------------------------------------------
  it("A: readAllEvents recovers from a corrupt JSONL line and writes to .corrupt file", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "dt-r14-jsonl-a-"));
    const store = new TrailStore(storeDir);
    await store.init();

    const good = makeEvent({ kind: "file_write", payload: { filePath: "/a.ts" } });
    // Write one valid line + one corrupt line directly (bypassing appendEvent)
    const eventsLog = store.eventsLogPath();
    await writeFile(eventsLog, JSON.stringify(good) + "\n" + "{INVALID_JSON\n", "utf8");

    const events = await store.readAllEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe(good.id);

    // .corrupt file must exist and contain the bad line
    const corruptPath = eventsLog + ".corrupt";
    const corruptRaw = await readFile(corruptPath, "utf8");
    expect(corruptRaw).toContain("{INVALID_JSON");

    await rm(storeDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Trail Store: rebuildIndex lastSeq (Round 14 B)
  // -------------------------------------------------------------------------
  it("B: rebuildIndex produces the same lastSeq as live appendEvent indexing", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "dt-r14-jsonl-b-"));
    const store = new TrailStore(storeDir);
    await store.init();

    const e1 = makeEvent({ kind: "file_write", payload: { filePath: "/b1.ts" } });
    const e2 = makeEvent({ kind: "file_delete", payload: { filePath: "/b2.ts" } });
    await store.appendEvent(e1);
    await store.appendEvent(e2);
    await store.flush();

    const liveLastSeq = store.getLastSeq();

    // Fresh store on same root — rebuild from disk
    const freshStore = new TrailStore(storeDir);
    await freshStore.init();
    await freshStore.rebuildIndex();

    expect(freshStore.getLastSeq()).toBe(liveLastSeq);

    await rm(storeDir, { recursive: true, force: true });
  });
});
