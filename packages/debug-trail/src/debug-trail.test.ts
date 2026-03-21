// ============================================================================
// @dantecode/debug-trail — Test Suite
// Covers all 7 golden flows + unit tests for every module.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";

// --- Modules under test ---
import { hashContent, hashFile, makeSnapshotId, makeTombstoneId, shortHash, hashesEqual } from "./hash-engine.js";
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
import { defaultConfig } from "./types.js";
import { FileSnapshotter } from "./file-snapshotter.js";
import { AuditLogger } from "./audit-logger.js";
import { ReplayOrchestrator } from "./replay-orchestrator.js";
import { TrailStore } from "./sqlite-store.js";
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

describe("hash-engine", () => {
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

describe("diff-engine", () => {
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
});

// ============================================================================
// Trail Event Index
// ============================================================================

describe("trail-index", () => {
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
// Session Map
// ============================================================================

describe("session-map", () => {
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
// Tombstone Registry
// ============================================================================

describe("tombstone-registry", () => {
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
});

// ============================================================================
// Anomaly Detector
// ============================================================================

describe("anomaly-detector", () => {
  it("detects burst deletions", () => {
    const detector = new AnomalyDetector({ burstDeletionCount: 3, burstDeletionWindowMs: 5000 });
    const sessionId = "s1";
    const now = Date.now();
    const events: TrailEvent[] = [
      makeEvent({ kind: "file_delete", timestamp: new Date(now).toISOString(), payload: { filePath: "/a.ts" } }),
      makeEvent({ kind: "file_delete", timestamp: new Date(now + 1000).toISOString(), payload: { filePath: "/b.ts" } }),
      makeEvent({ kind: "file_delete", timestamp: new Date(now + 2000).toISOString(), payload: { filePath: "/c.ts" } }),
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
      makeEvent({ kind: "tool_call", actor: "Bash", timestamp: new Date(now + i * 1000).toISOString() }),
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
});

// ============================================================================
// Export Engine — scoreCompleteness
// ============================================================================

describe("export-engine scoreCompleteness", () => {
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
    const tombstone = makeDeletedTombstone({ beforeStateCaptured: false, lastSnapshotId: undefined });
    const result = scoreCompleteness([event], [tombstone], "s1");
    expect(result.snapshotGaps.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Natural Language Query Parser
// ============================================================================

describe("parseNaturalLanguageQuery", () => {
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
});

// ============================================================================
// Retention Policy
// ============================================================================

describe("retention-policy", () => {
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
    const policy = new RetentionPolicy({ keepRecentDays: 7, prunePastDays: 30, enableCompression: true });
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

// ============================================================================
// Compression Policy
// ============================================================================

describe("compression-policy", () => {
  function makeSnapshot(daysAgo: number, sizeBytes: number, compressed = false): FileSnapshotRecord {
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
    const policy = new CompressionPolicy({ compressAfterDays: 7, maxSnapshotSizeBytes: 10_000_000 });
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
    const policy = new CompressionPolicy({ enableDeduplication: true, pruneIdenticalHashes: true });
    const hash = hashContent("same content");
    const snap1 = { ...makeSnapshot(1, 100), contentHash: hash, snapshotId: "snap_a", capturedAt: new Date(Date.now() - 1000).toISOString() };
    const snap2 = { ...makeSnapshot(2, 100), contentHash: hash, snapshotId: "snap_b", capturedAt: new Date(Date.now() - 2000).toISOString() };
    const decisions = policy.evaluate([snap1, snap2]);
    const prune = decisions.filter((d) => d.action === "prune_duplicate");
    expect(prune).toHaveLength(1);
    // The older one should be pruned
    expect(prune[0]?.snapshotId).toBe("snap_b");
  });
});

// ============================================================================
// Privacy Policy
// ============================================================================

describe("privacy-policy", () => {
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
});

// ============================================================================
// Default config
// ============================================================================

describe("defaultConfig", () => {
  it("returns valid config", () => {
    const config = defaultConfig();
    expect(config.enabled).toBe(true);
    expect(config.retentionDays).toBe(30);
    expect(config.storageRoot).toContain(".dantecode/debug-trail");
  });
});

// ============================================================================
// Gap fixes
// ============================================================================

describe("Gap fixes", () => {
  // -------------------------------------------------------------------------
  // Gap 1 — Snapshot deduplication
  // -------------------------------------------------------------------------
  describe("Gap 1: snapshot deduplication", () => {
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
  });

  // -------------------------------------------------------------------------
  // Gap 3 — Iterative LCS diff
  // -------------------------------------------------------------------------
  describe("Gap 3: iterative LCS diff", () => {
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

  // -------------------------------------------------------------------------
  // Gap 4 — Async write queue
  // -------------------------------------------------------------------------
  describe("Gap 4: async write queue", () => {
    it("multiple rapid log() calls produce correct sequential output after drain()", async () => {
      const dir = await mkdtemp(join(tmpdir(), "dt-queue-"));
      const storageRoot = join(dir, "trail");

      const logger = new AuditLogger({
        config: { storageRoot, enabled: true, retentionDays: 30, compressSnapshots: false, compressAfterDays: 7, maxStorageMb: 500 },
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
        config: { storageRoot, enabled: true, retentionDays: 30, compressSnapshots: false, compressAfterDays: 7, maxStorageMb: 500 },
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
  });

  // -------------------------------------------------------------------------
  // Gap 5 — Cache invalidation
  // -------------------------------------------------------------------------
  describe("Gap 5: cache invalidation on new events", () => {
    it("invalidateCache() is called on each log() call via setOnNewEventCallback", async () => {
      const dir = await mkdtemp(join(tmpdir(), "dt-cache-inval-"));
      const storageRoot = join(dir, "trail");

      const logger = new AuditLogger({
        config: { storageRoot, enabled: true, retentionDays: 30, compressSnapshots: false, compressAfterDays: 7, maxStorageMb: 500 },
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
        config: { storageRoot, enabled: true, retentionDays: 30, compressSnapshots: false, compressAfterDays: 7, maxStorageMb: 500 },
        sessionId: "sess_fresh",
        runId: "run_fresh",
      });
      await logger.init();

      const queryEngine = new TrailQueryEngine(
        { storageRoot, enabled: true, retentionDays: 30, compressSnapshots: false, compressAfterDays: 7, maxStorageMb: 500 },
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
  });

  // -------------------------------------------------------------------------
  // Gap 6 — ReplayOrchestrator returns full trail
  // -------------------------------------------------------------------------
  describe("Gap 6: replaySession returns full trail", () => {
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
  });

  // -------------------------------------------------------------------------
  // Gap 2 — Snapshot manifest persistence
  // -------------------------------------------------------------------------
  describe("Gap 2: snapshot manifest persistence", () => {
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
  });
});

// ============================================================================
// Failure path hardening
// ============================================================================

describe("Failure path hardening", () => {
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

    await rm(dir, { recursive: true, force: true });
  });

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
});

// ============================================================================
// Round 4 fixes
// ============================================================================

describe("Round 4 fixes", () => {
  // -------------------------------------------------------------------------
  // Fix 3: evaluateCapture respects maxSnapshotBytes config
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Fix 5: filePathPrefix does not over-match similar file names
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

  // -------------------------------------------------------------------------
  // Round 4 Lane A: missing anomaly detectors implemented
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
  // AnomalyDetector flush integration: anomaly_flag events appear in trail
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
});

// ============================================================================
// Round 5 fixes
// ============================================================================

describe("Round 5 fixes", () => {
  // -------------------------------------------------------------------------
  // Fix 1: flush() uses in-memory buffer — no duplicate anomalies on re-flush
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
});

// ============================================================================
// Round 6 fixes
// ============================================================================

describe("Round 6 fixes", () => {
  // -------------------------------------------------------------------------
  // Fix 1: AnomalyDetector.updateConfig() — mid-session reconfiguration
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
    expect(detector.analyze([write], provenance.sessionId).some((f) => f.anomalyType === "untracked_write")).toBe(false);

    // Enable mid-session
    detector.updateConfig({ detectUntrackedWrites: true });
    expect(detector.analyze([write], provenance.sessionId).some((f) => f.anomalyType === "untracked_write")).toBe(true);
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
    expect(detector.analyze(deletions, provenance.sessionId).some((f) => f.anomalyType === "burst_deletion")).toBe(false);

    // Lower threshold mid-session
    detector.updateConfig({ burstDeletionCount: 3 });
    expect(detector.analyze(deletions, provenance.sessionId).some((f) => f.anomalyType === "burst_deletion")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Fix 2: flush() returns detected AnomalyFlag[]
  // -------------------------------------------------------------------------

  it("flush() returns empty array when no anomalies detected", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r6-flush-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r6_noAnomaly" });
    await logger.init();
    await logger.log("tool_call", "Actor", "normal operation", {});
    const result = await logger.flush();
    expect(Array.isArray(result.anomalies)).toBe(true);
    expect(result.anomalies).toHaveLength(0);
    expect(result.analyzedCount).toBe(1);
    expect(result.bufferTruncated).toBe(false);
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
    expect(callbackResults[0]!.anomalies.some((f) => f.anomalyType === "burst_deletion")).toBe(true);
    expect(callbackResults[0]!.analyzedCount).toBe(3);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("flush() does NOT call onAnomalyDetected on second flush (dedup guard)", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r6-cb-dedup-"));
    let callCount = 0;
    const logger = new AuditLogger({
      config: { storageRoot },
      sessionId: "sess_r6_cb_dedup",
      onAnomalyDetected: () => { callCount++; },
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
  // Fix 3: AuditLogger exposes getAnomalyDetector() + getSessionEvents()
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
  // Fix 4: CliBridge.detectAnomalies() uses logger's detector + in-memory buffer
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
  // Fix 5: streamEvents() uses cache when fresh
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
  // Fix 6: globToRegex — ** support and single * boundary
  // -------------------------------------------------------------------------

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
});

// ============================================================================
// Round 7 fixes
// ============================================================================

describe("Round 7 fixes", () => {
  // -------------------------------------------------------------------------
  // Fix 1: streamEvents() always reads from disk — no cache path
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
  // Fix 2: sessionEvents buffer is bounded
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
  // Fix 3: detectUntrackedWrites auto-detection from tool_call reads
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
  // Fix 4: cross-session detectAnomalies uses fresh detector config
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
  // Fix 5: NL query parser — relative time, actor detection, dir paths
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
});

// ============================================================================
// Round 8 fixes
// ============================================================================

describe("Round 8 fixes", () => {
  // -------------------------------------------------------------------------
  // Fix 1: FlushResult — bufferTruncated + analyzedCount observability
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
    expect(result.bufferTruncated).toBe(true);
    expect(result.analyzedCount).toBe(2); // only the 2 buffered events were analyzed
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("FlushResult.bufferTruncated is false when buffer is not exceeded", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r8-not-truncated-"));
    const logger = new AuditLogger({ config: { storageRoot }, sessionId: "sess_r8_notrunc" });
    await logger.init();
    await logger.log("tool_call", "Actor", "small event", {});
    const result = await logger.flush();
    expect(result.bufferTruncated).toBe(false);
    expect(result.analyzedCount).toBe(1);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("onAnomalyDetected receives FlushResult with bufferTruncated and analyzedCount", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-r8-cb-meta-"));
    type FlushResult = import("./audit-logger.js").FlushResult;
    let received: FlushResult | null = null;
    const logger = new AuditLogger({
      config: { storageRoot, sessionEventsBufferLimit: 2 },
      sessionId: "sess_r8_cb_meta",
      onAnomalyDetected: (result) => { received = result; },
    });
    await logger.init();
    for (let i = 0; i < 4; i++) {
      await logger.log("tool_call", "Actor", `event ${i}`, {});
    }
    await logger.flush();
    expect(received).not.toBeNull();
    expect(received!.bufferTruncated).toBe(true);
    expect(received!.analyzedCount).toBe(2);
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Fix 2: Multi-lane detection cursor — each lane's flush analyzes only new events
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
    expect(r1.analyzedCount).toBe(1);

    // Switch to lane B and log more events — flush should analyze only lane B's events
    logger.setLaneContext("lane_b", "lane_a");
    await logger.log("tool_call", "Actor", "lane B event", {});
    const r2 = await logger.flush();
    expect(r2.analyzedCount).toBe(1); // only the 1 new event from lane B

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
    expect(r1.analyzedCount).toBe(3);

    const r2 = await logger.flush(); // second flush — no new events
    expect(r2.analyzedCount).toBe(0);
    expect(r2.anomalies).toHaveLength(0);
    await rm(storageRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Fix 3: TrailQuery.excludeKinds, actors, excludeActor filters
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
  // Fix 4: NL parser — negation, OR actors, dirMatch false-positive fix
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
});
