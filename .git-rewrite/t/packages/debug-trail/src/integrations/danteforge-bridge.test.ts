import { describe, it, expect, vi, beforeEach } from "vitest";
import { DanteForgeBridge } from "./danteforge-bridge.js";
import type { AuditLogger } from "../audit-logger.js";
import type { TrailStore } from "../sqlite-store.js";
import type { TrailEvent } from "../types.js";

function makeEvent(overrides: Partial<TrailEvent> = {}): TrailEvent {
  return {
    id: "evt-1",
    seq: 1,
    timestamp: new Date().toISOString(),
    kind: "tool_call",
    actor: "Bash",
    summary: "ran command",
    payload: {},
    provenance: { sessionId: "sess-1", runId: "run-1" },
    ...overrides,
  };
}

function createMockStore(events: TrailEvent[] = []): TrailStore {
  return {
    init: vi.fn(),
    queryBySession: vi.fn().mockResolvedValue(events),
    readAllEvents: vi.fn().mockResolvedValue(events),
    readAllTombstones: vi.fn().mockResolvedValue([]),
  } as unknown as TrailStore;
}

function createMockLogger(): AuditLogger {
  return {
    log: vi.fn().mockResolvedValue("evt-log-1"),
  } as unknown as AuditLogger;
}

describe("DanteForgeBridge", () => {
  let bridge: DanteForgeBridge;
  let logger: AuditLogger;
  let store: TrailStore;

  beforeEach(() => {
    logger = createMockLogger();
    store = createMockStore([
      makeEvent({ id: "e1", provenance: { sessionId: "sess-1", runId: "r1" } }),
      makeEvent({ id: "e2", provenance: { sessionId: "sess-1", runId: "r1" } }),
    ]);
    bridge = new DanteForgeBridge(logger, store);
  });

  it("scores a session and returns a trust result", async () => {
    const result = await bridge.scoreSession("sess-1");
    expect(result.sessionId).toBe("sess-1");
    expect(typeof result.trustScore).toBe("number");
    expect(result.trustScore).toBeGreaterThanOrEqual(0);
    expect(result.trustScore).toBeLessThanOrEqual(1);
    expect(["A", "B", "C", "D", "F"]).toContain(result.pdseGrade);
  });

  it("logs a verification event after scoring", async () => {
    await bridge.scoreSession("sess-1");
    expect(logger.log).toHaveBeenCalledWith(
      "verification",
      "DanteForgeBridge",
      expect.stringContaining("Trail completeness"),
      expect.objectContaining({ sessionId: "sess-1" }),
      expect.any(Object),
    );
  });

  it("reports grade F for sessions with no events", async () => {
    const emptyStore = createMockStore([]);
    const emptyBridge = new DanteForgeBridge(logger, emptyStore);
    const result = await emptyBridge.scoreSession("empty-session");
    expect(result.issues).toContain("Session has no recorded events — trail may be missing");
  });

  it("checks trust against a minimum score", async () => {
    const trusted = await bridge.isTrusted("sess-1", 0.0);
    expect(trusted).toBe(true);
  });

  it("returns completeness score object", async () => {
    const completeness = await bridge.getCompleteness("sess-1");
    expect(completeness.sessionId).toBe("sess-1");
    expect(typeof completeness.score).toBe("number");
    expect(typeof completeness.totalEvents).toBe("number");
  });

  it("annotates an export result with trust metadata", async () => {
    const exportResult = {
      sessionId: "sess-1",
      path: "/tmp/export.json",
      eventCount: 2,
      snapshotCount: 0,
      exportedAt: new Date().toISOString(),
    };
    const annotated = await bridge.annotateExport(exportResult);
    expect(annotated.trust).toBeDefined();
    expect(annotated.trust.sessionId).toBe("sess-1");
    expect(annotated.path).toBe("/tmp/export.json");
  });
});
