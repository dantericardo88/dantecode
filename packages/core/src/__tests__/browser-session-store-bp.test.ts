import { describe, it, expect } from "vitest";
import {
  getSessionSummary,
  getMostRecentSessions,
  type BrowserSessionRecord,
} from "../browser-session-store.js";

function makeRecord(
  sessionId: string,
  startedAt: string,
  overrides: Partial<BrowserSessionRecord> = {},
): BrowserSessionRecord {
  return {
    sessionId,
    taskDescription: "test task",
    startUrl: "https://example.com",
    startedAt,
    stepCount: 0,
    steps: [],
    status: "completed",
    ...overrides,
  };
}

describe("getSessionSummary", () => {
  it("returns null when sessionId not found", () => {
    const result = getSessionSummary("nonexistent", []);
    expect(result).toBeNull();
  });

  it("returns summary with correct sessionId", () => {
    const record = makeRecord("abc123", "2026-01-01T00:00:00Z");
    const result = getSessionSummary("abc123", [record]);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("abc123");
  });

  it("counts actionCount from steps array", () => {
    const record = makeRecord("s1", "2026-01-01T00:00:00Z", {
      steps: [
        { action: "navigate", url: "https://a.com", timestamp: "2026-01-01T00:00:01Z" },
        { action: "click", url: "https://a.com", timestamp: "2026-01-01T00:00:02Z" },
      ],
      stepCount: 2,
    });
    const result = getSessionSummary("s1", [record])!;
    expect(result.actionCount).toBe(2);
  });

  it("computes distinctUrls from step URLs", () => {
    const record = makeRecord("s2", "2026-01-01T00:00:00Z", {
      steps: [
        { action: "navigate", url: "https://a.com", timestamp: "t1" },
        { action: "click", url: "https://a.com", timestamp: "t2" },
        { action: "navigate", url: "https://b.com", timestamp: "t3" },
      ],
      stepCount: 3,
    });
    const result = getSessionSummary("s2", [record])!;
    expect(result.distinctUrls).toBe(2);
  });

  it("computes totalDurationMs from startedAt to completedAt", () => {
    const record = makeRecord("s3", "2026-01-01T00:00:00Z", {
      completedAt: "2026-01-01T00:00:05Z",
    });
    const result = getSessionSummary("s3", [record])!;
    expect(result.totalDurationMs).toBe(5000);
  });

  it("sets lastAction to last step action", () => {
    const record = makeRecord("s4", "2026-01-01T00:00:00Z", {
      steps: [
        { action: "navigate", timestamp: "t1" },
        { action: "extract", timestamp: "t2" },
      ],
      stepCount: 2,
    });
    const result = getSessionSummary("s4", [record])!;
    expect(result.lastAction).toBe("extract");
  });

  it("sets lastAction to empty string when no steps", () => {
    const record = makeRecord("s5", "2026-01-01T00:00:00Z");
    const result = getSessionSummary("s5", [record])!;
    expect(result.lastAction).toBe("");
  });
});

describe("getMostRecentSessions", () => {
  const records: BrowserSessionRecord[] = [
    makeRecord("old", "2026-01-01T00:00:00Z", { completedAt: "2026-01-01T00:00:01Z" }),
    makeRecord("mid", "2026-01-02T00:00:00Z", { completedAt: "2026-01-02T00:00:01Z" }),
    makeRecord("new", "2026-01-03T00:00:00Z", { completedAt: "2026-01-03T00:00:01Z" }),
  ];

  it("returns most recent first", () => {
    const result = getMostRecentSessions(records, 3);
    expect(result[0]!.sessionId).toBe("new");
    expect(result[1]!.sessionId).toBe("mid");
    expect(result[2]!.sessionId).toBe("old");
  });

  it("respects the limit parameter", () => {
    const result = getMostRecentSessions(records, 2);
    expect(result).toHaveLength(2);
    expect(result[0]!.sessionId).toBe("new");
  });

  it("returns empty array for empty input", () => {
    const result = getMostRecentSessions([], 5);
    expect(result).toHaveLength(0);
  });
});
