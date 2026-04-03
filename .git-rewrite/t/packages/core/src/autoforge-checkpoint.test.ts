// ============================================================================
// @dantecode/core — Autoforge Checkpoint Manager Tests
// Tests for long-run resume, periodic checkpointing, and hash auditing.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AutoforgeCheckpointManager, hashContent } from "./autoforge-checkpoint.js";
import type { AutoforgeCheckpointFile } from "./autoforge-checkpoint.js";

describe("AutoforgeCheckpointManager", () => {
  let mgr: AutoforgeCheckpointManager;
  const written: Map<string, string> = new Map();

  const mockWriteFile = vi.fn(async (path: string, data: string) => {
    written.set(path, data);
  });
  const mockReadFile = vi.fn(async (path: string) => {
    const data = written.get(path);
    if (!data) throw new Error(`ENOENT: ${path}`);
    return data;
  });
  const mockMkdir = vi.fn(async () => undefined);

  beforeEach(() => {
    written.clear();
    mockWriteFile.mockClear();
    mockReadFile.mockClear();
    mockMkdir.mockClear();
    mgr = new AutoforgeCheckpointManager("/project", "test-session", {
      writeFileFn: mockWriteFile,
      readFileFn: mockReadFile,
      mkdirFn: mockMkdir,
      maxCheckpoints: 10,
      intervalMs: 1000,
    });
  });

  afterEach(() => {
    mgr.stopPeriodicCheckpoints();
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Checkpoint creation
  // --------------------------------------------------------------------------

  describe("createCheckpoint", () => {
    it("creates a checkpoint with all fields populated", async () => {
      const cp = await mgr.createCheckpoint({
        triggerCommand: "/autoforge --self-improve",
        currentStep: 5,
        elapsedMs: 30_000,
        targetFilePath: "/project/src/foo.ts",
        targetFileContent: "const x = 1;",
        pdseScores: [{ filePath: "src/foo.ts", overall: 85, passedGate: true, iteration: 5 }],
        worktreeBranches: [],
        lessonsDelta: ["lesson-1"],
        metadata: { flag: true },
      });

      expect(cp.id).toBeTruthy();
      expect(cp.label).toBe("step-5");
      expect(cp.triggerCommand).toBe("/autoforge --self-improve");
      expect(cp.currentStep).toBe(5);
      expect(cp.elapsedMs).toBe(30_000);
      expect(cp.pdseScores).toHaveLength(1);
      expect(cp.lessonsDelta).toEqual(["lesson-1"]);
      expect(cp.targetFileHash).toBeTruthy();
      expect(cp.metadata).toEqual({ flag: true });
    });

    it("persists checkpoint to disk", async () => {
      await mgr.createCheckpoint({
        triggerCommand: "/autoforge",
        currentStep: 1,
        elapsedMs: 1000,
      });

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mockMkdir).toHaveBeenCalledTimes(1);

      const writtenPath = mockWriteFile.mock.calls[0]![0] as string;
      expect(writtenPath).toContain("test-session.json");

      const writtenData = JSON.parse(
        mockWriteFile.mock.calls[0]![1] as string,
      ) as AutoforgeCheckpointFile;
      expect(writtenData.version).toBe(2);
      expect(writtenData.sessionId).toBe("test-session");
      expect(writtenData.checkpoints).toHaveLength(1);
    });

    it("uses custom label when provided", async () => {
      const cp = await mgr.createCheckpoint({
        label: "custom-label",
        triggerCommand: "/autoforge",
        currentStep: 1,
        elapsedMs: 1000,
      });

      expect(cp.label).toBe("custom-label");
    });

    it("hashes target file content when provided", async () => {
      const cp = await mgr.createCheckpoint({
        triggerCommand: "/autoforge",
        currentStep: 1,
        elapsedMs: 1000,
        targetFileContent: "hello world",
      });

      expect(cp.targetFileHash).toBe(hashContent("hello world"));
    });

    it("omits target file hash when no content provided", async () => {
      const cp = await mgr.createCheckpoint({
        triggerCommand: "/autoforge",
        currentStep: 1,
        elapsedMs: 1000,
      });

      expect(cp.targetFileHash).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Checkpoint trimming
  // --------------------------------------------------------------------------

  describe("checkpoint trimming", () => {
    it("trims checkpoints to maxCheckpoints, keeping latest", async () => {
      for (let i = 0; i < 15; i++) {
        await mgr.createCheckpoint({
          triggerCommand: "/autoforge",
          currentStep: i,
          elapsedMs: i * 1000,
        });
      }

      const allCheckpoints = mgr.listCheckpoints();
      expect(allCheckpoints).toHaveLength(10); // maxCheckpoints = 10
      expect(allCheckpoints[0]!.currentStep).toBe(5); // first 5 trimmed
      expect(allCheckpoints[9]!.currentStep).toBe(14);
    });
  });

  // --------------------------------------------------------------------------
  // Resume from checkpoint (loadSession)
  // --------------------------------------------------------------------------

  describe("loadSession", () => {
    it("loads a previously persisted session", async () => {
      // Create and persist checkpoints
      await mgr.createCheckpoint({
        triggerCommand: "/autoforge",
        currentStep: 3,
        elapsedMs: 15000,
      });
      await mgr.createCheckpoint({
        triggerCommand: "/autoforge",
        currentStep: 7,
        elapsedMs: 45000,
      });

      // Create a new manager and load the session
      const mgr2 = new AutoforgeCheckpointManager("/project", "test-session", {
        writeFileFn: mockWriteFile,
        readFileFn: mockReadFile,
        mkdirFn: mockMkdir,
      });

      const loaded = await mgr2.loadSession("test-session");
      expect(loaded).toBe(2);

      const latest = mgr2.getLatestCheckpoint();
      expect(latest).not.toBeNull();
      expect(latest!.currentStep).toBe(7);
    });

    it("returns 0 when session file does not exist", async () => {
      const loaded = await mgr.loadSession("nonexistent");
      expect(loaded).toBe(0);
    });

    it("returns 0 when session file has invalid format", async () => {
      written.set(mgr["getSessionPath"]("bad-session"), JSON.stringify({ version: 99, bad: true }));

      const loaded = await mgr.loadSession("bad-session");
      expect(loaded).toBe(0);
    });

    it("correctly restores session ID and startedAt after load", async () => {
      await mgr.createCheckpoint({
        triggerCommand: "/autoforge",
        currentStep: 1,
        elapsedMs: 1000,
      });

      const mgr2 = new AutoforgeCheckpointManager("/project", "different-id", {
        writeFileFn: mockWriteFile,
        readFileFn: mockReadFile,
        mkdirFn: mockMkdir,
      });

      await mgr2.loadSession("test-session");
      expect(mgr2.getSessionId()).toBe("test-session");
    });
  });

  // --------------------------------------------------------------------------
  // Latest checkpoint retrieval
  // --------------------------------------------------------------------------

  describe("getLatestCheckpoint", () => {
    it("returns null when no checkpoints exist", () => {
      expect(mgr.getLatestCheckpoint()).toBeNull();
    });

    it("returns the most recent checkpoint", async () => {
      await mgr.createCheckpoint({
        triggerCommand: "/autoforge",
        currentStep: 1,
        elapsedMs: 1000,
      });
      await mgr.createCheckpoint({
        triggerCommand: "/autoforge",
        currentStep: 5,
        elapsedMs: 5000,
      });

      const latest = mgr.getLatestCheckpoint();
      expect(latest!.currentStep).toBe(5);
    });
  });

  // --------------------------------------------------------------------------
  // File integrity verification
  // --------------------------------------------------------------------------

  describe("verifyFileIntegrity", () => {
    it("returns matches=true when content has not changed", async () => {
      const content = "const x = 42;";
      await mgr.createCheckpoint({
        triggerCommand: "/autoforge",
        currentStep: 1,
        elapsedMs: 1000,
        targetFilePath: "/project/src/foo.ts",
        targetFileContent: content,
      });

      const result = mgr.verifyFileIntegrity("/project/src/foo.ts", content);
      expect(result.matches).toBe(true);
      expect(result.currentHash).toBe(result.checkpointHash);
    });

    it("returns matches=false when content has changed", async () => {
      await mgr.createCheckpoint({
        triggerCommand: "/autoforge",
        currentStep: 1,
        elapsedMs: 1000,
        targetFilePath: "/project/src/foo.ts",
        targetFileContent: "const x = 42;",
      });

      const result = mgr.verifyFileIntegrity("/project/src/foo.ts", "const x = 99;");
      expect(result.matches).toBe(false);
      expect(result.currentHash).not.toBe(result.checkpointHash);
    });

    it("returns matches=false when no checkpoint exists for the file", () => {
      const result = mgr.verifyFileIntegrity("/project/src/unknown.ts", "content");
      expect(result.matches).toBe(false);
      expect(result.checkpointHash).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Periodic checkpointing
  // --------------------------------------------------------------------------

  describe("periodic checkpointing", () => {
    it("starts and stops periodic checkpointing", () => {
      expect(mgr.isPeriodicActive()).toBe(false);

      mgr.startPeriodicCheckpoints(() => ({
        triggerCommand: "/autoforge",
        currentStep: 0,
        elapsedMs: 0,
      }));

      expect(mgr.isPeriodicActive()).toBe(true);

      mgr.stopPeriodicCheckpoints();
      expect(mgr.isPeriodicActive()).toBe(false);
    });

    it("creates checkpoints at the specified interval", async () => {
      vi.useFakeTimers();

      let step = 0;
      mgr.startPeriodicCheckpoints(() => ({
        triggerCommand: "/autoforge",
        currentStep: step++,
        elapsedMs: step * 1000,
      }));

      // Advance past 3 intervals (1000ms each)
      await vi.advanceTimersByTimeAsync(3100);

      const checkpoints = mgr.listCheckpoints();
      expect(checkpoints.length).toBeGreaterThanOrEqual(3);

      mgr.stopPeriodicCheckpoints();
      vi.useRealTimers();
    });

    it("replaces previous periodic checkpoint when restarted", () => {
      mgr.startPeriodicCheckpoints(() => ({
        triggerCommand: "/autoforge",
        currentStep: 0,
        elapsedMs: 0,
      }));

      expect(mgr.isPeriodicActive()).toBe(true);

      // Restart with a different function
      mgr.startPeriodicCheckpoints(() => ({
        triggerCommand: "/party",
        currentStep: 10,
        elapsedMs: 50000,
      }));

      expect(mgr.isPeriodicActive()).toBe(true);
      mgr.stopPeriodicCheckpoints();
    });
  });
});

// ----------------------------------------------------------------------------
// hashContent utility
// ----------------------------------------------------------------------------

describe("hashContent", () => {
  it("produces consistent SHA-256 hex for the same input", () => {
    const hash1 = hashContent("hello world");
    const hash2 = hashContent("hello world");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it("produces different hashes for different inputs", () => {
    const hash1 = hashContent("aaa");
    const hash2 = hashContent("bbb");
    expect(hash1).not.toBe(hash2);
  });
});
