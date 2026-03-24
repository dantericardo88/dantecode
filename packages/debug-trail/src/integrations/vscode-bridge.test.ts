import { describe, it, expect, vi, beforeEach } from "vitest";
import { VsCodeBridge } from "./vscode-bridge.js";
import type { AuditLogger } from "../audit-logger.js";
import { TrailEventIndex } from "../state/trail-index.js";
import { SessionMap } from "../state/session-map.js";
import { AnomalyDetector } from "../anomaly-detector.js";
import type { TrailEvent } from "../types.js";

function createMockLogger(): AuditLogger {
  const index = new TrailEventIndex();
  const sessionMap = new SessionMap();
  sessionMap.startSession({ sessionId: "sess-1" });

  return {
    getSessionId: vi.fn().mockReturnValue("sess-1"),
    getProvenance: vi.fn().mockReturnValue({ sessionId: "sess-1", runId: "run-1" }),
    getIndex: vi.fn().mockReturnValue(index),
    getSessionMap: vi.fn().mockReturnValue(sessionMap),
    getAnomalyDetector: vi.fn().mockReturnValue(new AnomalyDetector()),
    getSessionEvents: vi.fn().mockReturnValue([]),
    logFileWrite: vi.fn().mockResolvedValue("evt-1"),
    log: vi.fn().mockResolvedValue("evt-1"),
    setOnNewEventCallback: vi.fn(),
    getStore: vi.fn().mockReturnValue({
      init: vi.fn(),
      readAllEvents: vi.fn().mockResolvedValue([]),
    }),
  } as unknown as AuditLogger;
}

describe("VsCodeBridge", () => {
  let bridge: VsCodeBridge;

  beforeEach(() => {
    const logger = createMockLogger();
    bridge = new VsCodeBridge(logger, { storageRoot: "/tmp/test-trail" });
  });

  it("handles query command via dispatch", async () => {
    const msg = await bridge.dispatch("query", {});
    expect(msg.kind).toBe("trail_query_result");
    expect(msg.timestamp).toBeDefined();
    const data = msg.data as { success: boolean };
    expect(data.success).toBe(true);
  });

  it("handles snapshot command via dispatch", async () => {
    const msg = await bridge.dispatch("snapshot", {});
    expect(msg.kind).toBe("snapshot_result");
    const data = msg.data as { success: boolean };
    expect(data.success).toBe(true);
  });

  it("returns session list as VsCodeTrailMessage", () => {
    const msg = bridge.handleSessionList();
    expect(msg.kind).toBe("session_list");
    const data = msg.data as { sessions: unknown[] };
    expect(data.sessions.length).toBeGreaterThanOrEqual(1);
  });

  it("returns file list as VsCodeTrailMessage", () => {
    const msg = bridge.handleFileList();
    expect(msg.kind).toBe("file_list");
    const data = msg.data as { files: string[] };
    expect(Array.isArray(data.files)).toBe(true);
  });

  it("returns error for unknown dispatch command", async () => {
    const msg = await bridge.dispatch("nonexistent", {});
    expect(msg.kind).toBe("trail_query_result");
    const data = msg.data as { success: boolean; error: string };
    expect(data.success).toBe(false);
    expect(data.error).toContain("Unknown command");
  });

  it("formats event for sidebar with expected fields", () => {
    const event: TrailEvent = {
      id: "evt-1",
      seq: 1,
      timestamp: new Date().toISOString(),
      kind: "file_write",
      actor: "Write",
      summary: "wrote file",
      payload: { filePath: "/src/app.ts" },
      provenance: { sessionId: "s1", runId: "r1" },
      afterSnapshotId: "snap-1",
    };
    const formatted = VsCodeBridge.formatEventForSidebar(event);
    expect(formatted.id).toBe("evt-1");
    expect(formatted.kind).toBe("file_write");
    expect(formatted.filePath).toBe("/src/app.ts");
    expect(formatted.hasSnapshot).toBe(true);
    expect(formatted.sessionId).toBe("s1");
  });
});
