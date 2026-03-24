import { describe, it, expect } from "vitest";
import { RetentionPolicy } from "./retention-policy.js";
import type { SessionRecord } from "../sqlite-store.js";

function makeSessions(
  overrides: Record<string, Partial<SessionRecord>> = {},
): Record<string, SessionRecord> {
  const now = new Date().toISOString();
  const base: Record<string, SessionRecord> = {
    "recent-sess": {
      sessionId: "recent-sess",
      runId: "r1",
      startedAt: now,
      lastEventAt: now,
      eventCount: 10,
      pinned: false,
    } as SessionRecord,
  };
  for (const [id, overr] of Object.entries(overrides)) {
    base[id] = { ...base["recent-sess"]!, sessionId: id, ...overr } as SessionRecord;
  }
  return base;
}

describe("RetentionPolicy", () => {
  it("keeps recent sessions", () => {
    const policy = new RetentionPolicy({ keepRecentDays: 7 });
    const sessions = makeSessions();
    const decisions = policy.evaluate(sessions);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.decision).toBe("keep");
    expect(decisions[0]!.reason).toContain("within");
  });

  it("prunes sessions older than prunePastDays", () => {
    const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const policy = new RetentionPolicy({ prunePastDays: 30 });
    const sessions = makeSessions({ old: { lastEventAt: oldDate } });
    const decisions = policy.evaluate(sessions);
    const pruned = decisions.find((d) => d.sessionId === "old");
    expect(pruned!.decision).toBe("prune");
  });

  it("compresses sessions in the middle range", () => {
    const midDate = new Date(Date.now() - 15 * 86_400_000).toISOString();
    const policy = new RetentionPolicy({ keepRecentDays: 7, prunePastDays: 30 });
    const sessions = makeSessions({ mid: { lastEventAt: midDate } });
    const decisions = policy.evaluate(sessions);
    const mid = decisions.find((d) => d.sessionId === "mid");
    expect(mid!.decision).toBe("compress");
  });

  it("keeps pinned sessions regardless of age", () => {
    const oldDate = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const policy = new RetentionPolicy();
    const sessions = makeSessions({ pinned: { lastEventAt: oldDate, pinned: true } });
    const decisions = policy.evaluate(sessions);
    const pinned = decisions.find((d) => d.sessionId === "pinned");
    expect(pinned!.decision).toBe("keep");
    expect(pinned!.pinned).toBe(true);
  });

  it("respects enableCompression=false by keeping instead of compressing", () => {
    const midDate = new Date(Date.now() - 15 * 86_400_000).toISOString();
    const policy = new RetentionPolicy({
      keepRecentDays: 7,
      prunePastDays: 30,
      enableCompression: false,
    });
    const sessions = makeSessions({ mid: { lastEventAt: midDate } });
    const decisions = policy.evaluate(sessions);
    const mid = decisions.find((d) => d.sessionId === "mid");
    expect(mid!.decision).toBe("keep");
  });

  it("getPruneList returns only session IDs marked for pruning", () => {
    const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const policy = new RetentionPolicy({ prunePastDays: 30 });
    const sessions = makeSessions({
      old: { lastEventAt: oldDate },
      "recent-sess": { lastEventAt: new Date().toISOString() },
    });
    const pruneList = policy.getPruneList(sessions);
    expect(pruneList).toContain("old");
    expect(pruneList).not.toContain("recent-sess");
  });

  it("getCompressList returns only session IDs marked for compression", () => {
    const midDate = new Date(Date.now() - 15 * 86_400_000).toISOString();
    const policy = new RetentionPolicy({ keepRecentDays: 7, prunePastDays: 30 });
    const sessions = makeSessions({ mid: { lastEventAt: midDate } });
    const compressList = policy.getCompressList(sessions);
    expect(compressList).toContain("mid");
  });

  it("includes policyId in all decisions", () => {
    const policy = new RetentionPolicy({ policyId: "test-policy" });
    const decisions = policy.evaluate(makeSessions());
    for (const d of decisions) {
      expect(d.policyId).toBe("test-policy");
    }
  });
});
