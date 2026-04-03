import { describe, it, expect, vi, beforeEach } from "vitest";
import { SandboxBridge } from "./sandbox-bridge.js";
import type { AuditLogger } from "../audit-logger.js";
import type { FileSnapshotter } from "../file-snapshotter.js";
import type { SandboxContext } from "./sandbox-bridge.js";

function createMockLogger(): AuditLogger {
  return {
    getProvenance: vi.fn().mockReturnValue({ sessionId: "s1", runId: "r1" }),
    logFileWrite: vi.fn().mockResolvedValue("evt-fw-1"),
    logFileDelete: vi.fn().mockResolvedValue("evt-fd-1"),
    log: vi.fn().mockResolvedValue("evt-log-1"),
    setLaneContext: vi.fn(),
  } as unknown as AuditLogger;
}

function createMockSnapshotter(): FileSnapshotter {
  return {
    captureBeforeState: vi.fn().mockResolvedValue({
      beforeHash: "abc123",
      beforeSnapshotId: "snap-before-1",
    }),
    captureAfterState: vi.fn().mockResolvedValue({
      afterHash: "def456",
      afterSnapshotId: "snap-after-1",
    }),
    recordDeletion: vi.fn().mockResolvedValue({
      tombstoneId: "tomb-1",
      contentHash: "hash-del",
      lastSnapshotId: "snap-del-1",
    }),
    getTombstones: vi.fn().mockReturnValue({ all: () => [] }),
  } as unknown as FileSnapshotter;
}

describe("SandboxBridge", () => {
  let bridge: SandboxBridge;
  let logger: AuditLogger;
  let snapshotter: FileSnapshotter;
  const context: SandboxContext = {
    sandboxId: "sb-1",
    sandboxRoot: "/tmp/sandbox",
    parentSessionId: "parent-sess",
    laneId: "lane-42",
  };

  beforeEach(() => {
    logger = createMockLogger();
    snapshotter = createMockSnapshotter();
    bridge = new SandboxBridge(logger, snapshotter, context);
  });

  it("sets lane context on construction when laneId is provided", () => {
    expect(logger.setLaneContext).toHaveBeenCalledWith("lane-42", "parent-sess");
  });

  it("does not set lane context when laneId is absent", () => {
    const noLaneLogger = createMockLogger();
    const noLaneCtx: SandboxContext = {
      sandboxId: "sb-2",
      sandboxRoot: "/tmp/sandbox2",
      parentSessionId: "parent-2",
    };
    new SandboxBridge(noLaneLogger, snapshotter, noLaneCtx);
    expect(noLaneLogger.setLaneContext).not.toHaveBeenCalled();
  });

  it("captures before state and logs file write on onFileWrite", async () => {
    const eventId = await bridge.onFileWrite("/tmp/sandbox/file.ts", "content");
    expect(eventId).toBe("evt-fw-1");
    expect(snapshotter.captureBeforeState).toHaveBeenCalledWith(
      "/tmp/sandbox/file.ts",
      "sandbox-write",
      expect.objectContaining({ sessionId: "s1" }),
    );
  });

  it("captures after state on onFileWriteComplete", async () => {
    await bridge.onFileWriteComplete("/tmp/sandbox/file.ts", "evt-fw-1");
    expect(snapshotter.captureAfterState).toHaveBeenCalledWith(
      "/tmp/sandbox/file.ts",
      "evt-fw-1",
      expect.objectContaining({ sessionId: "s1" }),
    );
    expect(logger.log).toHaveBeenCalledWith(
      "tool_result",
      "SandboxFileSystem",
      expect.stringContaining("File write completed"),
      expect.objectContaining({ filePath: "/tmp/sandbox/file.ts" }),
      expect.any(Object),
    );
  });

  it("records deletion on onFileDelete", async () => {
    const eventId = await bridge.onFileDelete("/tmp/sandbox/old.ts");
    expect(eventId).toBe("evt-fd-1");
    expect(snapshotter.recordDeletion).toHaveBeenCalled();
  });

  it("logs arbitrary sandbox events with sandbox context", async () => {
    const eventId = await bridge.logSandboxEvent("npm", "npm install", { pkg: "vitest" });
    expect(eventId).toBe("evt-log-1");
    expect(logger.log).toHaveBeenCalledWith(
      "tool_call",
      "Sandbox:npm",
      "npm install",
      expect.objectContaining({ sandboxId: "sb-1", sandboxRoot: "/tmp/sandbox", pkg: "vitest" }),
    );
  });
});
