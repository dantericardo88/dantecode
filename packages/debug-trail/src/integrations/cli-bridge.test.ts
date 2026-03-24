import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliBridge } from "./cli-bridge.js";
import type { AuditLogger } from "../audit-logger.js";
import { TrailEventIndex } from "../state/trail-index.js";
import { SessionMap } from "../state/session-map.js";
import { AnomalyDetector } from "../anomaly-detector.js";


function createMockLogger(): AuditLogger {
  const index = new TrailEventIndex();
  const sessionMap = new SessionMap();
  sessionMap.startSession({ sessionId: "sess-1" });
  const detector = new AnomalyDetector();

  return {
    getSessionId: vi.fn().mockReturnValue("sess-1"),
    getProvenance: vi.fn().mockReturnValue({ sessionId: "sess-1", runId: "run-1" }),
    getIndex: vi.fn().mockReturnValue(index),
    getSessionMap: vi.fn().mockReturnValue(sessionMap),
    getAnomalyDetector: vi.fn().mockReturnValue(detector),
    getSessionEvents: vi.fn().mockReturnValue([]),
    logFileWrite: vi.fn().mockResolvedValue("evt-fw-1"),
    log: vi.fn().mockResolvedValue("evt-log-1"),
    setOnNewEventCallback: vi.fn(),
    getStore: vi.fn().mockReturnValue({
      init: vi.fn(),
      readAllEvents: vi.fn().mockResolvedValue([]),
    }),
  } as unknown as AuditLogger;
}

describe("CliBridge", () => {
  let bridge: CliBridge;
  let logger: AuditLogger;

  beforeEach(() => {
    logger = createMockLogger();
    bridge = new CliBridge(logger, { storageRoot: "/tmp/test-trail" });
  });

  it("returns recent events when no query is provided", async () => {
    const result = await bridge.debugTrail();
    expect(result.results).toEqual([]);
    expect(result.totalMatches).toBe(0);
  });

  it("returns session snapshot when no file is specified", async () => {
    const result = await bridge.debugSnapshot();
    expect(result.created).toBe(true);
    expect(result.snapshotId).toContain("session:");
    expect(result.target).toBe("sess-1");
  });

  it("returns session list from session map", () => {
    const sessions = bridge.getSessionList();
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions[0]!.sessionId).toBe("sess-1");
  });

  it("returns file list from index", () => {
    const files = bridge.getFileList();
    expect(Array.isArray(files)).toBe(true);
  });

  it("generates a human-readable summary", async () => {
    const summary = await bridge.summary();
    expect(summary).toContain("Debug Trail Summary");
    expect(summary).toContain("sess-1");
  });

  it("detects anomalies returns an array", async () => {
    const anomalies = await bridge.detectAnomalies();
    expect(Array.isArray(anomalies)).toBe(true);
  });
});
