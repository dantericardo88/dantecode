// ============================================================================
// @dantecode/debug-trail — Integration Tests (Golden Flows GF-01 through GF-07)
// Real file I/O: no mocks. Each test gets its own temp dir for isolation.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, readFile, rm, mkdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { AuditLogger, resetGlobalLogger } from "./audit-logger.js";
import { FileSnapshotter } from "./file-snapshotter.js";
import { TrailQueryEngine } from "./trail-query-engine.js";
import { ReplayOrchestrator } from "./replay-orchestrator.js";
import { RestoreEngine } from "./restore-engine.js";
import { ExportEngine } from "./export-engine.js";

// ---------------------------------------------------------------------------
// Test isolation helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return join(
    tmpdir(),
    `debug-trail-test-${Date.now()}${Math.random().toString(36).slice(2)}`,
  );
}

function makeStorageRoot(): string {
  return join(
    tmpdir(),
    `debug-trail-store-${Date.now()}${Math.random().toString(36).slice(2)}`,
  );
}

function makeProvenance(sessionId: string) {
  return { sessionId, runId: `run_${randomUUID()}` };
}

// ---------------------------------------------------------------------------
// GF-01: Full write / snapshot / query cycle
// ---------------------------------------------------------------------------

describe("GF-01: Full write/snapshot/query cycle", () => {
  let tmpDir: string;
  let storageRoot: string;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    storageRoot = makeStorageRoot();
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    resetGlobalLogger();
    await rm(tmpDir, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("logs a file_write event and retrieves it by filePath", async () => {
    const filePath = join(tmpDir, "hello.ts");
    await writeFile(filePath, "export const x = 1;");

    const sessionId = `sess_gf01_${randomUUID().slice(0, 8)}`;
    const config = { storageRoot };
    const logger = new AuditLogger({ config, sessionId });
    await logger.init();

    const snapshotter = new FileSnapshotter(config);
    const prov = makeProvenance(sessionId);

    const snap = await snapshotter.captureSnapshot(filePath, "gf01-event", prov);
    expect(snap).not.toBeNull();
    expect(snap!.filePath).toBe(filePath);

    await logger.logFileWrite(filePath, undefined, snap!.contentHash, undefined, snap!.snapshotId);

    const queryEngine = new TrailQueryEngine(config);
    await queryEngine.init();

    const result = await queryEngine.query({ filePath });

    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results[0]!.payload["filePath"]).toBe(filePath);
    expect(result.results[0]!.kind).toBe("file_write");

    await logger.flush();
  });
});

// ---------------------------------------------------------------------------
// GF-02: Delete tombstone + restore
// ---------------------------------------------------------------------------

describe("GF-02: Delete tombstone + restore", () => {
  let tmpDir: string;
  let storageRoot: string;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    storageRoot = makeStorageRoot();
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    resetGlobalLogger();
    await rm(tmpDir, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("records deletion, deletes file, then restores it with original content", async () => {
    const filePath = join(tmpDir, "deleteme.ts");
    const originalContent = "export const original = true;";
    await writeFile(filePath, originalContent);

    const sessionId = `sess_gf02_${randomUUID().slice(0, 8)}`;
    const config = { storageRoot };
    const logger = new AuditLogger({ config, sessionId });
    await logger.init();

    const snapshotter = new FileSnapshotter(config);
    const prov = makeProvenance(sessionId);

    // Record deletion (captures before-state automatically)
    const tombstone = await snapshotter.recordDeletion(filePath, "gf02-del-event", prov, "TestActor");
    expect(tombstone.beforeStateCaptured).toBe(true);
    expect(tombstone.lastSnapshotId).toBeDefined();

    // Log the delete event
    await logger.logFileDelete(filePath, tombstone.contentHash, tombstone.lastSnapshotId, tombstone.tombstoneId);

    // Actually delete the file from disk
    await unlink(filePath);

    // Restore via RestoreEngine
    const restoreEngine = new RestoreEngine(snapshotter, logger);
    const result = await restoreEngine.restoreDeletedFile(filePath);

    expect(result.restored).toBe(true);
    expect(result.targetPath).toBe(filePath);

    // Verify content on disk
    const restored = await readFile(filePath, "utf8");
    expect(restored).toBe(originalContent);

    await logger.flush();
  });
});

// ---------------------------------------------------------------------------
// GF-03: Before/after snapshot pair
// ---------------------------------------------------------------------------

describe("GF-03: Before/after snapshot pair", () => {
  let tmpDir: string;
  let storageRoot: string;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    storageRoot = makeStorageRoot();
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    resetGlobalLogger();
    await rm(tmpDir, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("captures distinct before/after snapshots with correct content", async () => {
    const filePath = join(tmpDir, "versioned.ts");
    await writeFile(filePath, "v1");

    const sessionId = `sess_gf03_${randomUUID().slice(0, 8)}`;
    const config = { storageRoot };
    const prov = makeProvenance(sessionId);
    const snapshotter = new FileSnapshotter(config);

    // Capture before-state
    const { beforeSnapshotId } = await snapshotter.captureBeforeState(filePath, "gf03-before", prov);
    expect(beforeSnapshotId).not.toBeNull();

    // Mutate the file
    await writeFile(filePath, "v2");

    // Capture after-state
    const { afterSnapshotId } = await snapshotter.captureAfterState(filePath, "gf03-after", prov);
    expect(afterSnapshotId).not.toBeNull();

    // They must be different (different content → different snapshotId)
    expect(beforeSnapshotId).not.toBe(afterSnapshotId);

    // Verify content of each snapshot
    const beforeContent = await snapshotter.readSnapshot(beforeSnapshotId!);
    expect(beforeContent?.toString("utf8")).toBe("v1");

    const afterContent = await snapshotter.readSnapshot(afterSnapshotId!);
    expect(afterContent?.toString("utf8")).toBe("v2");
  });
});

// ---------------------------------------------------------------------------
// GF-04: Natural language query
// ---------------------------------------------------------------------------

describe("GF-04: Natural language query", () => {
  let tmpDir: string;
  let storageRoot: string;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    storageRoot = makeStorageRoot();
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    resetGlobalLogger();
    await rm(tmpDir, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("filters to file_delete events when asked 'what files were deleted'", async () => {
    const sessionId = `sess_gf04_${randomUUID().slice(0, 8)}`;
    const config = { storageRoot };
    const logger = new AuditLogger({ config, sessionId });
    await logger.init();

    // Log a mix of event kinds
    await logger.logFileWrite(join(tmpDir, "wrote.ts"));
    await logger.logFileDelete(join(tmpDir, "deleted.ts"));
    await logger.logError("TestActor", "something went wrong");

    const queryEngine = new TrailQueryEngine(config);
    await queryEngine.init();

    const result = await queryEngine.query("what files were deleted");

    expect(result.results.length).toBeGreaterThanOrEqual(1);
    for (const event of result.results) {
      expect(event.kind).toBe("file_delete");
    }

    await logger.flush();
  });
});

// ---------------------------------------------------------------------------
// GF-05: Session replay
// ---------------------------------------------------------------------------

describe("GF-05: Session replay", () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = makeStorageRoot();
  });

  afterEach(async () => {
    resetGlobalLogger();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("starts replay and jumps to step 3 out of 5 events", async () => {
    const sessionId = `sess_gf05_${randomUUID().slice(0, 8)}`;
    const config = { storageRoot };
    const logger = new AuditLogger({ config, sessionId });
    await logger.init();

    // Log exactly 5 events
    for (let i = 0; i < 5; i++) {
      await logger.log("tool_call", `Actor${i}`, `Step ${i}`);
    }
    await logger.flush();

    const orchestrator = new ReplayOrchestrator(config);

    // Start replay — cursor should be at step 0 with totalSteps = 5
    const startCursor = await orchestrator.startReplay(sessionId);
    expect(startCursor.totalSteps).toBe(5);
    expect(startCursor.currentStep).toBe(0);

    // Jump to step 3
    const cursor = await orchestrator.jumpToStep(sessionId, 3);
    expect(cursor.currentStep).toBe(3);
    expect(cursor.totalSteps).toBe(5);
    expect(cursor.complete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GF-06: Snapshot deduplication
// ---------------------------------------------------------------------------

describe("GF-06: Snapshot deduplication", () => {
  let tmpDir: string;
  let storageRoot: string;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    storageRoot = makeStorageRoot();
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    resetGlobalLogger();
    await rm(tmpDir, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("returns existing cached record for identical content on second snapshot", async () => {
    const sharedContent = "identical content for dedup test";
    const path1 = join(tmpDir, "file-a.ts");
    const path2 = join(tmpDir, "file-b.ts");
    await writeFile(path1, sharedContent);
    await writeFile(path2, sharedContent);

    const sessionId = `sess_gf06_${randomUUID().slice(0, 8)}`;
    const config = { storageRoot };
    const prov = makeProvenance(sessionId);
    const snapshotter = new FileSnapshotter(config);

    const snap1 = await snapshotter.captureSnapshot(path1, "gf06-event-1", prov);
    const snap2 = await snapshotter.captureSnapshot(path2, "gf06-event-2", prov);

    expect(snap1).not.toBeNull();
    expect(snap2).not.toBeNull();

    // Both snapshotIds are returned (non-null)
    expect(snap1!.snapshotId).toBeTruthy();
    expect(snap2!.snapshotId).toBeTruthy();

    // Content hashes must be identical (same content)
    expect(snap1!.contentHash).toBe(snap2!.contentHash);

    // The dedup cache reuses the same snapshotId for identical content
    expect(snap1!.snapshotId).toBe(snap2!.snapshotId);

    // Both snapshots are accessible
    const content1 = await snapshotter.readSnapshot(snap1!.snapshotId);
    expect(content1?.toString("utf8")).toBe(sharedContent);
  });
});

// ---------------------------------------------------------------------------
// GF-07: Audit export
// ---------------------------------------------------------------------------

describe("GF-07: Audit export", () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = makeStorageRoot();
  });

  afterEach(async () => {
    resetGlobalLogger();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("exports session to JSON with correct sessionId and event count", async () => {
    const sessionId = `sess_gf07_${randomUUID().slice(0, 8)}`;
    const config = { storageRoot };
    const logger = new AuditLogger({ config, sessionId });
    await logger.init();

    // Log exactly 3 events
    await logger.log("tool_call", "Actor", "event 1");
    await logger.log("tool_call", "Actor", "event 2");
    await logger.log("verification", "Verification", "event 3");
    await logger.flush();

    const exportEngine = new ExportEngine(config);
    const result = await exportEngine.exportSession(sessionId, { format: "json" });

    expect(result.sessionId).toBe(sessionId);
    expect(result.eventCount).toBe(3);
    expect(result.exportedAt).toBeTruthy();
    expect(result.path).toBeTruthy();

    // Verify the export file is valid JSON with correct structure
    const raw = await readFile(result.path, "utf8");
    const parsed = JSON.parse(raw) as { sessionId: string; events: unknown[] };
    expect(parsed.sessionId).toBe(sessionId);
    expect(parsed.events.length).toBe(3);
  });
});
