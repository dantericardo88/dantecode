// ============================================================================
// @dantecode/core — EventSourcedCheckpointer Tests
// Tests for LangGraph-style checkpointer + OpenHands event-sourced state.
// Covers: put/getTuple/resume, incremental writes, compaction, event log.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventSourcedCheckpointer, hashCheckpointContent } from "./checkpointer.js";
import type { PendingWrite, CheckpointTuple } from "./checkpointer.js";
import {
  CheckpointReplaySummarySchema,
  CheckpointWorkspaceContextSchema,
  type ApplyReceipt,
} from "@dantecode/runtime-spine";

describe("EventSourcedCheckpointer", () => {
  let cp: EventSourcedCheckpointer;
  const written = new Map<string, string>();
  const dirs = new Set<string>();

  const mockWrite = vi.fn(async (path: string, data: string) => {
    written.set(path.replace(/\\/g, "/"), data);
  });
  const mockRead = vi.fn(async (path: string) => {
    const norm = path.replace(/\\/g, "/");
    const data = written.get(norm);
    if (!data) throw new Error(`ENOENT: ${norm}`);
    return data;
  });
  const mockMkdir = vi.fn(async (path: string) => {
    dirs.add(path.replace(/\\/g, "/"));
    return undefined;
  });
  const mockReaddir = vi.fn(async (path: string) => {
    const norm = path.replace(/\\/g, "/");
    const files: string[] = [];
    for (const key of written.keys()) {
      const parent = key.substring(0, key.lastIndexOf("/"));
      if (parent === norm) {
        files.push(key.substring(key.lastIndexOf("/") + 1));
      }
    }
    return files.sort();
  });
  const mockUnlink = vi.fn(async (path: string) => {
    written.delete(path.replace(/\\/g, "/"));
  });

  beforeEach(() => {
    written.clear();
    dirs.clear();
    vi.clearAllMocks();
    cp = new EventSourcedCheckpointer("/project", "sess-001", {
      writeFileFn: mockWrite,
      readFileFn: mockRead,
      mkdirFn: mockMkdir,
      readdirFn: mockReaddir,
      unlinkFn: mockUnlink,
      maxEventsBeforeCompaction: 5,
    });
  });

  // --------------------------------------------------------------------------
  // put() — base state creation
  // --------------------------------------------------------------------------

  describe("put()", () => {
    it("creates a checkpoint and writes base_state.json", async () => {
      const id = await cp.put(
        { currentFile: "index.ts", pdseScore: 85 },
        { source: "loop", step: 0 },
      );

      expect(id).toBeTruthy();
      expect(id.length).toBe(12);

      // Verify base_state.json was written
      const baseStatePath = Array.from(written.keys()).find((k) => k.includes("base_state.json"));
      expect(baseStatePath).toBeTruthy();

      const baseState = JSON.parse(written.get(baseStatePath!)!);
      expect(baseState.checkpoint.channelValues.currentFile).toBe("index.ts");
      expect(baseState.checkpoint.step).toBe(0);
      expect(baseState.metadata.source).toBe("loop");
    });

    it("appends a checkpoint event to the event log", async () => {
      await cp.put({ step: 1 }, { source: "loop", step: 1 });

      const eventFiles = Array.from(written.keys()).filter((k) => k.includes("event-00000-"));
      expect(eventFiles.length).toBe(1);

      const event = JSON.parse(written.get(eventFiles[0]!)!);
      expect(event.kind).toBe("checkpoint");
      expect(event.source).toBe("system");
    });

    it("tracks parent checkpoint ID", async () => {
      const id1 = await cp.put({ v: 1 }, { source: "input", step: 0 });
      await cp.put({ v: 2 }, { source: "loop", step: 1 });

      const tuple = await cp.getTuple();
      expect(tuple).not.toBeNull();
      expect(tuple!.metadata.parentId).toBe(id1);
    });

    it("auto-bumps channel versions", async () => {
      await cp.put({ a: 1, b: 2 }, { source: "input", step: 0 });

      const tuple = await cp.getTuple();
      expect(tuple!.checkpoint.channelVersions.a).toBe(1);
      expect(tuple!.checkpoint.channelVersions.b).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // putWrite() — incremental writes
  // --------------------------------------------------------------------------

  describe("putWrite()", () => {
    it("stores an incremental write as an event", async () => {
      await cp.put({ initial: true }, { source: "input", step: 0 });

      const write: PendingWrite = {
        taskId: "task-1",
        channel: "pdseScore",
        value: 92,
        timestamp: new Date().toISOString(),
      };
      await cp.putWrite(write);

      const writes = cp.getPendingWrites();
      expect(writes.length).toBe(1);
      expect(writes[0]!.channel).toBe("pdseScore");
      expect(writes[0]!.value).toBe(92);
    });

    it("deduplicates writes with same taskId + channel", async () => {
      await cp.put({ initial: true }, { source: "input", step: 0 });

      const write: PendingWrite = {
        taskId: "task-1",
        channel: "score",
        value: 80,
        timestamp: new Date().toISOString(),
      };
      await cp.putWrite(write);
      await cp.putWrite({ ...write, value: 90 }); // Same taskId+channel

      expect(cp.getPendingWrites().length).toBe(1);
      expect(cp.getPendingWrites()[0]!.value).toBe(80); // First write wins
    });

    it("allows different channels for same taskId", async () => {
      await cp.put({ initial: true }, { source: "input", step: 0 });

      await cp.putWrite({
        taskId: "task-1",
        channel: "score",
        value: 80,
        timestamp: new Date().toISOString(),
      });
      await cp.putWrite({
        taskId: "task-1",
        channel: "status",
        value: "passed",
        timestamp: new Date().toISOString(),
      });

      expect(cp.getPendingWrites().length).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // getTuple() — reconstruct state
  // --------------------------------------------------------------------------

  describe("getTuple()", () => {
    it("returns null when no session exists", async () => {
      const fresh = new EventSourcedCheckpointer("/empty", "none", {
        writeFileFn: mockWrite,
        readFileFn: mockRead,
        mkdirFn: mockMkdir,
        readdirFn: mockReaddir,
        unlinkFn: mockUnlink,
      });
      const tuple = await fresh.getTuple();
      expect(tuple).toBeNull();
    });

    it("returns full tuple with checkpoint + metadata + writes", async () => {
      await cp.put({ file: "a.ts" }, { source: "loop", step: 1, triggerCommand: "/autoforge" });
      await cp.putWrite({
        taskId: "t1",
        channel: "result",
        value: "ok",
        timestamp: new Date().toISOString(),
      });

      const tuple = await cp.getTuple();
      expect(tuple).not.toBeNull();
      expect(tuple!.checkpoint.channelValues.file).toBe("a.ts");
      expect(tuple!.metadata.triggerCommand).toBe("/autoforge");
      expect(tuple!.pendingWrites.length).toBe(1);
      expect(tuple!.replaySummary?.eventCount).toBe(2);
      expect(tuple!.replaySummary?.pendingWriteCount).toBe(1);
      expect(tuple!.replaySummary?.digest).toHaveLength(16);
    });

    it("persists runtime envelopes that match the shared runtime-spine schemas", async () => {
      await cp.put(
        { file: "a.ts" },
        { source: "loop", step: 1, triggerCommand: "/autoforge" },
        undefined,
        {
          workspaceContext: {
            projectRoot: "/project",
            workspaceRoot: "/project/worktree",
            repoRoot: "/project",
            workspaceIsRepoRoot: false,
            installContextKind: "repo_checkout",
            worktreePath: "/project/worktree",
          },
        },
      );

      const baseStatePath = Array.from(written.keys()).find((k) => k.includes("base_state.json"));
      const persisted = JSON.parse(written.get(baseStatePath!)!);

      expect(CheckpointReplaySummarySchema.safeParse(persisted.replaySummary).success).toBe(true);
      expect(CheckpointWorkspaceContextSchema.safeParse(persisted.workspaceContext).success).toBe(
        true,
      );
    });

    it("returns from memory when already loaded", async () => {
      await cp.put({ x: 1 }, { source: "input", step: 0 });

      const t1 = await cp.getTuple();
      const t2 = await cp.getTuple();

      expect(t1).toEqual(t2);
      // Only one base_state write (not re-read from disk on second call)
    });
  });

  // --------------------------------------------------------------------------
  // resume() — load base + replay events
  // --------------------------------------------------------------------------

  describe("resume()", () => {
    it("resumes from disk with base state + event replay", async () => {
      // Create session with checkpoint + writes
      await cp.put({ task: "self-improve", iteration: 5 }, { source: "loop", step: 5 });
      await cp.putWrite({
        taskId: "t1",
        channel: "pdse",
        value: 88,
        timestamp: new Date().toISOString(),
      });
      await cp.putWrite({
        taskId: "t2",
        channel: "lesson",
        value: "avoid stubs",
        timestamp: new Date().toISOString(),
      });

      // Create fresh checkpointer (simulates restart)
      const resumed = new EventSourcedCheckpointer("/project", "sess-001", {
        writeFileFn: mockWrite,
        readFileFn: mockRead,
        mkdirFn: mockMkdir,
        readdirFn: mockReaddir,
        unlinkFn: mockUnlink,
      });

      const eventCount = await resumed.resume();
      // checkpoint event + 2 write events = 3
      expect(eventCount).toBe(3);

      const tuple = await resumed.getTuple();
      expect(tuple).not.toBeNull();
      expect(tuple!.checkpoint.channelValues.iteration).toBe(5);
      expect(tuple!.pendingWrites.length).toBe(2);
      expect(tuple!.replaySummary?.eventCount).toBe(3);
      expect(tuple!.replaySummary?.pendingWriteCount).toBe(2);
      expect(tuple!.replaySummary?.digest).toHaveLength(16);

      const secondResume = new EventSourcedCheckpointer("/project", "sess-001", {
        writeFileFn: mockWrite,
        readFileFn: mockRead,
        mkdirFn: mockMkdir,
        readdirFn: mockReaddir,
        unlinkFn: mockUnlink,
      });
      await secondResume.resume();
      const resumedAgain = await secondResume.getTuple();
      expect(resumedAgain?.replaySummary?.digest).toBe(tuple!.replaySummary?.digest);
    });

    it("returns 0 when no session exists on disk", async () => {
      const fresh = new EventSourcedCheckpointer("/empty", "nonexistent", {
        writeFileFn: mockWrite,
        readFileFn: mockRead,
        mkdirFn: mockMkdir,
        readdirFn: mockReaddir,
        unlinkFn: mockUnlink,
      });

      const count = await fresh.resume();
      expect(count).toBe(0);
    });

    it("rebuilds invalid replay summaries and drops invalid workspace context on resume", async () => {
      await cp.put({ task: "self-improve", iteration: 5 }, { source: "loop", step: 5 }, undefined, {
        workspaceContext: {
          projectRoot: "/project",
          workspaceRoot: "/project",
          workspaceIsRepoRoot: true,
          installContextKind: "repo_checkout",
        },
      });
      await cp.putWrite({
        taskId: "t1",
        channel: "pdse",
        value: 88,
        timestamp: new Date().toISOString(),
      });

      const baseStatePath = Array.from(written.keys()).find((k) => k.includes("base_state.json"));
      expect(baseStatePath).toBeTruthy();

      const persisted = JSON.parse(written.get(baseStatePath!)!);
      persisted.replaySummary = {
        eventCount: -1,
        pendingWriteCount: -1,
        digest: "short",
      };
      persisted.workspaceContext = {
        projectRoot: "/project",
        workspaceRoot: "/project",
        workspaceIsRepoRoot: true,
        installContextKind: "unsupported_install",
      };
      written.set(baseStatePath!, JSON.stringify(persisted, null, 2));

      const resumed = new EventSourcedCheckpointer("/project", "sess-001", {
        writeFileFn: mockWrite,
        readFileFn: mockRead,
        mkdirFn: mockMkdir,
        readdirFn: mockReaddir,
        unlinkFn: mockUnlink,
      });

      const eventCount = await resumed.resume();
      expect(eventCount).toBe(2);

      const tuple = await resumed.getTuple();
      expect(tuple?.replaySummary).toBeDefined();
      expect(tuple?.replaySummary?.eventCount).toBe(2);
      expect(tuple?.replaySummary?.pendingWriteCount).toBe(1);
      expect(tuple?.replaySummary?.digest).toHaveLength(16);
      expect(tuple?.workspaceContext).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // compact() — merge writes into base state
  // --------------------------------------------------------------------------

  describe("compact()", () => {
    it("merges pending writes into channel values", async () => {
      await cp.put({ score: 70, file: "a.ts" }, { source: "loop", step: 1 });
      await cp.putWrite({
        taskId: "t1",
        channel: "score",
        value: 95,
        timestamp: new Date().toISOString(),
      });

      await cp.compact();

      const tuple = await cp.getTuple();
      expect(tuple!.checkpoint.channelValues.score).toBe(95);
      expect(tuple!.pendingWrites.length).toBe(0);
      expect(cp.getEventCount()).toBe(0);
    });

    it("auto-compacts when event count exceeds threshold", async () => {
      await cp.put({ v: 1 }, { source: "input", step: 0 });

      // maxEventsBeforeCompaction is 5 — put() already added 1 event
      // Add 4 more writes to trigger compaction on the 5th
      for (let i = 0; i < 4; i++) {
        await cp.putWrite({
          taskId: `t${i}`,
          channel: `ch${i}`,
          value: i,
          timestamp: new Date().toISOString(),
        });
      }

      // Event count should be reset after auto-compaction
      // (1 checkpoint event + 4 write events = 5 = threshold → compact)
      expect(cp.getEventCount()).toBe(0);
      expect(cp.getPendingWrites().length).toBe(0);
    });

    it("does nothing when no checkpoint exists", async () => {
      await cp.compact(); // Should not throw
      expect(cp.getEventCount()).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // list() — async generator
  // --------------------------------------------------------------------------

  describe("list()", () => {
    it("yields current checkpoint", async () => {
      await cp.put({ item: 1 }, { source: "loop", step: 1 });

      const results: CheckpointTuple[] = [];
      for await (const tuple of cp.list()) {
        results.push(tuple);
      }

      expect(results.length).toBe(1);
      expect(results[0]!.checkpoint.channelValues.item).toBe(1);
    });

    it("yields nothing when no checkpoint exists", async () => {
      const fresh = new EventSourcedCheckpointer("/empty", "none", {
        writeFileFn: mockWrite,
        readFileFn: mockRead,
        mkdirFn: mockMkdir,
        readdirFn: mockReaddir,
        unlinkFn: mockUnlink,
      });

      const results: CheckpointTuple[] = [];
      for await (const tuple of fresh.list()) {
        results.push(tuple);
      }

      expect(results.length).toBe(0);
    });

    it("filters by metadata source", async () => {
      await cp.put({ x: 1 }, { source: "loop", step: 1 });

      const noMatch: CheckpointTuple[] = [];
      for await (const tuple of cp.list({ filter: { source: "input" } })) {
        noMatch.push(tuple);
      }
      expect(noMatch.length).toBe(0);

      const match: CheckpointTuple[] = [];
      for await (const tuple of cp.list({ filter: { source: "loop" } })) {
        match.push(tuple);
      }
      expect(match.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Session metadata
  // --------------------------------------------------------------------------

  describe("session management", () => {
    it("returns the session ID", () => {
      expect(cp.getSessionId()).toBe("sess-001");
    });

    it("returns null checkpoint before put", () => {
      expect(cp.getCurrentCheckpoint()).toBeNull();
    });

    it("returns checkpoint after put", async () => {
      await cp.put({ v: 1 }, { source: "input", step: 0 });
      const checkpoint = cp.getCurrentCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.v).toBe(1);
    });

    it("tracks event count", async () => {
      expect(cp.getEventCount()).toBe(0);
      await cp.put({ v: 1 }, { source: "input", step: 0 });
      expect(cp.getEventCount()).toBe(1); // checkpoint event
    });
  });

  // --------------------------------------------------------------------------
  // Apply receipts
  // --------------------------------------------------------------------------

  describe("apply receipts", () => {
    beforeEach(() => {
      cp = new EventSourcedCheckpointer("test", "sess-apply", {
        writeFileFn: mockWrite,
        readFileFn: mockRead,
        mkdirFn: mockMkdir,
        readdirFn: mockReaddir,
        unlinkFn: mockUnlink,
      });
    });

    it("stores apply receipts as pending writes", async () => {
      await cp.put({ initial: true }, { source: "input", step: 0 });

      const receipt: ApplyReceipt = {
        stepId: "step-1",
        state: "success",
        affectedFiles: ["file1.ts"],
        appliedAt: new Date().toISOString(),
      };

      await cp.putApplyReceipt(receipt, { stepId: "step-1", state: "success" });

      const writes = cp.getPendingWrites();
      expect(writes).toHaveLength(1);
      expect(writes[0]!.channel).toBe("apply_receipt");
      expect(writes[0]!.value).toEqual(receipt);
    });

    it("deduplicates receipts for the same stepId", async () => {
      await cp.put({ initial: true }, { source: "input", step: 0 });

      const receipt1: ApplyReceipt = {
        stepId: "step-1",
        state: "success",
        affectedFiles: ["file1.ts"],
        appliedAt: "2023-01-01T00:00:00.000Z",
      };

      const receipt2: ApplyReceipt = {
        stepId: "step-1",
        state: "failed",
        affectedFiles: ["file1.ts"],
        appliedAt: "2023-01-01T00:01:00.000Z",
      };

      await cp.putApplyReceipt(receipt1, { stepId: "step-1", state: "success" });
      await cp.putApplyReceipt(receipt2, { stepId: "step-1", state: "failed" }); // should skip

      const writes = cp.getPendingWrites();
      expect(writes).toHaveLength(1);
      expect((writes[0]!.value as ApplyReceipt).state).toBe("success");
    });

    it("recovers apply receipts after resume", async () => {
      await cp.put({ initial: true }, { source: "input", step: 0 });

      const receipt: ApplyReceipt = {
        stepId: "step-1",
        state: "success",
        affectedFiles: ["file1.ts"],
        appliedAt: new Date().toISOString(),
      };

      await cp.putApplyReceipt(receipt, { stepId: "step-1", state: "success" });

      // Create new checkpointer to simulate restart
      const cp2 = new EventSourcedCheckpointer("test", "sess-apply", {
        writeFileFn: mockWrite,
        readFileFn: mockRead,
        mkdirFn: mockMkdir,
        readdirFn: mockReaddir,
        unlinkFn: mockUnlink,
      });

      await cp2.resume();

      const tuple = await cp2.getTuple();
      expect(tuple).not.toBeNull();
      expect(tuple!.pendingWrites).toHaveLength(1);
      expect(tuple!.pendingWrites[0]!.channel).toBe("apply_receipt");
    });
  });

  // --------------------------------------------------------------------------
  // hashCheckpointContent utility
  // --------------------------------------------------------------------------

  describe("hashCheckpointContent", () => {
    it("produces consistent 16-char hex hashes", () => {
      const hash1 = hashCheckpointContent("hello world");
      const hash2 = hashCheckpointContent("hello world");
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(16);
    });

    it("produces different hashes for different content", () => {
      const hash1 = hashCheckpointContent("content A");
      const hash2 = hashCheckpointContent("content B");
      expect(hash1).not.toBe(hash2);
    });
  });
});
