import { describe, it, expect } from "vitest";
import { CompressionPolicy } from "./compression-policy.js";
import type { FileSnapshotRecord } from "../types.js";

function makeSnapshot(overrides: Partial<FileSnapshotRecord> = {}): FileSnapshotRecord {
  return {
    snapshotId: "snap-1",
    filePath: "/src/app.ts",
    contentHash: "abc123",
    sizeBytes: 1024,
    capturedAt: new Date().toISOString(),
    storagePath: "/store/snap-1",
    compressed: false,
    provenance: { sessionId: "s1", runId: "r1" },
    trailEventId: "evt-1",
    ...overrides,
  };
}

describe("CompressionPolicy", () => {
  it("keeps recent small snapshots", () => {
    const policy = new CompressionPolicy();
    const decisions = policy.evaluate([makeSnapshot()]);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.action).toBe("keep");
    expect(decisions[0]!.reason).toContain("recent");
  });

  it("compresses old snapshots", () => {
    const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const policy = new CompressionPolicy({ compressAfterDays: 7 });
    const decisions = policy.evaluate([makeSnapshot({ capturedAt: oldDate })]);
    expect(decisions[0]!.action).toBe("compress");
    expect(decisions[0]!.reason).toContain("days");
  });

  it("compresses oversized snapshots regardless of age", () => {
    const policy = new CompressionPolicy({ maxSnapshotSizeBytes: 500 });
    const decisions = policy.evaluate([makeSnapshot({ sizeBytes: 1000 })]);
    expect(decisions[0]!.action).toBe("compress");
    expect(decisions[0]!.reason).toContain("size");
  });

  it("keeps already compressed snapshots", () => {
    const policy = new CompressionPolicy();
    const decisions = policy.evaluate([makeSnapshot({ compressed: true })]);
    expect(decisions[0]!.action).toBe("keep");
    expect(decisions[0]!.reason).toContain("already compressed");
  });

  it("prunes duplicate content hashes", () => {
    const hash = "same-hash";
    const snapshots = [
      makeSnapshot({ snapshotId: "s1", contentHash: hash, capturedAt: new Date().toISOString() }),
      makeSnapshot({
        snapshotId: "s2",
        contentHash: hash,
        capturedAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ];
    const policy = new CompressionPolicy();
    const decisions = policy.evaluate(snapshots);
    const pruned = decisions.filter((d) => d.action === "prune_duplicate");
    expect(pruned).toHaveLength(1);
    expect(pruned[0]!.snapshotId).toBe("s2");
  });

  it("shouldCompress returns correct boolean for old snapshots", () => {
    const policy = new CompressionPolicy({ compressAfterDays: 1 });
    const oldSnap = makeSnapshot({
      capturedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });
    expect(policy.shouldCompress(oldSnap)).toBe(true);
  });

  it("shouldCompress returns false for already compressed", () => {
    const policy = new CompressionPolicy();
    expect(policy.shouldCompress(makeSnapshot({ compressed: true }))).toBe(false);
  });

  it("skips deduplication when disabled", () => {
    const hash = "same-hash";
    const snapshots = [
      makeSnapshot({ snapshotId: "s1", contentHash: hash }),
      makeSnapshot({ snapshotId: "s2", contentHash: hash }),
    ];
    const policy = new CompressionPolicy({ enableDeduplication: false });
    const decisions = policy.evaluate(snapshots);
    const pruned = decisions.filter((d) => d.action === "prune_duplicate");
    expect(pruned).toHaveLength(0);
  });
});
