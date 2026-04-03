import { describe, it, expect, vi, beforeEach } from "vitest";
import { CheckpointerBridge } from "./checkpointer-bridge.js";
import type { AuditLogger } from "../audit-logger.js";
import type { TrailEvent } from "../types.js";

function createMockLogger(sessionId = "sess-1"): AuditLogger {
  const mockStore = {
    init: vi.fn().mockResolvedValue(undefined),
    readAllEvents: vi.fn().mockResolvedValue([]),
  };
  return {
    getSessionId: vi.fn().mockReturnValue(sessionId),
    logCheckpointTransition: vi.fn().mockResolvedValue("evt-cp-1"),
    setCheckpointContext: vi.fn(),
    log: vi.fn().mockResolvedValue("evt-log-1"),
    getStore: vi.fn().mockReturnValue(mockStore),
  } as unknown as AuditLogger;
}

describe("CheckpointerBridge", () => {
  let bridge: CheckpointerBridge;
  let logger: AuditLogger;

  beforeEach(() => {
    logger = createMockLogger();
    bridge = new CheckpointerBridge(logger);
  });

  it("creates a checkpoint and returns an event ID", async () => {
    const eventId = await bridge.onCheckpointCreated("cp-001", 5);
    expect(eventId).toBe("evt-cp-1");
    expect(logger.logCheckpointTransition).toHaveBeenCalledWith("cp-001", 5);
    expect(logger.setCheckpointContext).toHaveBeenCalledWith("cp-001");
  });

  it("records linkage with correct session and step", async () => {
    await bridge.onCheckpointCreated("cp-002", 3);
    const linkages = bridge.getLinkages();
    expect(linkages).toHaveLength(1);
    expect(linkages[0]!.checkpointId).toBe("cp-002");
    expect(linkages[0]!.step).toBe(3);
    expect(linkages[0]!.sessionId).toBe("sess-1");
  });

  it("appends event IDs to existing linkage on duplicate checkpoint", async () => {
    await bridge.onCheckpointCreated("cp-dup", 1);
    (logger.logCheckpointTransition as ReturnType<typeof vi.fn>).mockResolvedValue("evt-cp-2");
    await bridge.onCheckpointCreated("cp-dup", 1);
    const events = bridge.getEventsForCheckpoint("cp-dup");
    expect(events).toHaveLength(2);
    expect(events).toContain("evt-cp-1");
    expect(events).toContain("evt-cp-2");
  });

  it("links external events to a checkpoint", async () => {
    bridge.linkEventsToCheckpoint("cp-ext", ["e1", "e2"]);
    const events = bridge.getEventsForCheckpoint("cp-ext");
    expect(events).toEqual(["e1", "e2"]);
  });

  it("deduplicates linked event IDs", () => {
    bridge.linkEventsToCheckpoint("cp-dedup", ["e1", "e2"]);
    bridge.linkEventsToCheckpoint("cp-dedup", ["e2", "e3"]);
    const events = bridge.getEventsForCheckpoint("cp-dedup");
    expect(events).toEqual(["e1", "e2", "e3"]);
  });

  it("returns null for checkpointBefore when no linkages exist", () => {
    const result = bridge.checkpointBefore(new Date().toISOString());
    expect(result).toBeNull();
  });

  it("finds the checkpoint before a given timestamp", async () => {
    await bridge.onCheckpointCreated("cp-early", 1);
    const linkage = bridge.checkpointBefore(new Date(Date.now() + 60_000).toISOString());
    expect(linkage).not.toBeNull();
    expect(linkage!.checkpointId).toBe("cp-early");
  });

  it("returns checkpoint ID from event provenance", () => {
    const event = {
      provenance: { sessionId: "s1", runId: "r1", checkpointId: "cp-prov" },
    } as TrailEvent;
    expect(bridge.checkpointForEvent(event)).toBe("cp-prov");
  });
});
