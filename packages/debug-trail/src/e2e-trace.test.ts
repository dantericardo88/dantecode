import { describe, it, expect } from "vitest";
import { TrailEventIndex } from "./state/trail-index.js";
import { SessionMap } from "./state/session-map.js";
import { TombstoneRegistry } from "./state/tombstones.js";
import { CompressionPolicy } from "./policies/compression-policy.js";
import { PrivacyPolicy } from "./policies/privacy-policy.js";
import { RetentionPolicy } from "./policies/retention-policy.js";
import type { TrailEvent, FileSnapshotRecord } from "./types.js";

function makeEvent(overrides: Partial<TrailEvent> = {}): TrailEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    seq: 1,
    timestamp: new Date().toISOString(),
    kind: "tool_call",
    actor: "Bash",
    summary: "ran command",
    payload: {},
    provenance: { sessionId: "e2e-sess", runId: "e2e-run" },
    ...overrides,
  };
}

describe("E2E Trace: agent action -> debug trail -> query -> reconstruct", () => {
  it("indexes events, queries them, and reconstructs file state", () => {
    const index = new TrailEventIndex();
    const sessionMap = new SessionMap();
    const tombstones = new TombstoneRegistry();

    // Phase 1: Start session
    const session = sessionMap.startSession({
      sessionId: "e2e-sess",
      runId: "e2e-run",
    });
    expect(session.sessionId).toBe("e2e-sess");

    // Phase 2: Simulate agent actions (tool calls + file writes)
    const events: TrailEvent[] = [
      makeEvent({ seq: 1, kind: "tool_call", actor: "Bash", summary: "git status" }),
      makeEvent({
        seq: 2,
        kind: "file_write",
        actor: "Write",
        summary: "wrote src/app.ts",
        payload: { filePath: "/src/app.ts" },
        beforeHash: "hash-before",
        afterHash: "hash-after",
        afterSnapshotId: "snap-1",
      }),
      makeEvent({
        seq: 3,
        kind: "file_delete",
        actor: "Bash",
        summary: "deleted old.ts",
        payload: { filePath: "/src/old.ts" },
      }),
      makeEvent({
        seq: 4,
        kind: "verification",
        actor: "DanteForge",
        summary: "PDSE score: 92%",
        payload: { pdseScore: 0.92 },
      }),
    ];

    // Phase 3: Index all events
    index.bulkIndex(events);
    for (const evt of events) {
      const kind =
        evt.kind === "file_write"
          ? "file_write"
          : evt.kind === "file_delete"
            ? "file_delete"
            : "other";
      sessionMap.recordEvent("e2e-sess", kind);
    }

    // Phase 4: Register tombstone for deleted file
    tombstones.register({
      tombstoneId: "tomb-e2e",
      filePath: "/src/old.ts",
      deletedAt: new Date().toISOString(),
      deletedBy: "Bash",
      beforeStateCaptured: true,
      lastSnapshotId: "snap-old",
      contentHash: "hash-old",
      provenance: { sessionId: "e2e-sess", runId: "e2e-run" },
      trailEventId: "evt-del",
    });

    // Phase 5: Query and verify
    expect(index.size()).toBe(4);
    expect(index.findBySession("e2e-sess")).toHaveLength(4);

    // Find file writes
    const writes = index.findByKind("file_write");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.filePath).toBe("/src/app.ts");

    // Find file operations in /src/
    const srcEvents = index.findByFilePrefix("/src/");
    expect(srcEvents.length).toBeGreaterThanOrEqual(1);

    // Check session counts
    const sessionInfo = sessionMap.get("e2e-sess")!;
    expect(sessionInfo.eventCount).toBe(4);
    expect(sessionInfo.fileModCount).toBe(1);
    expect(sessionInfo.fileDeleteCount).toBe(1);

    // Check tombstone
    expect(tombstones.latestForFile("/src/old.ts")).toBeDefined();
    expect(tombstones.latestForFile("/src/old.ts")!.lastSnapshotId).toBe("snap-old");

    // Full-text search
    const pdseResults = index.search("PDSE");
    expect(pdseResults).toHaveLength(1);
    expect(pdseResults[0]!.kind).toBe("verification");
  });

  it("applies policies to trail data for lifecycle management", () => {
    // Compression policy
    const compressionPolicy = new CompressionPolicy({ compressAfterDays: 3 });
    const oldSnapshot: FileSnapshotRecord = {
      snapshotId: "snap-old",
      filePath: "/src/old.ts",
      contentHash: "hash-old",
      sizeBytes: 2048,
      capturedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      storagePath: "/store/snap-old",
      compressed: false,
      provenance: { sessionId: "s1", runId: "r1" },
      trailEventId: "evt-1",
    };
    const decisions = compressionPolicy.evaluate([oldSnapshot]);
    expect(decisions[0]!.action).toBe("compress");

    // Privacy policy
    const privacyPolicy = new PrivacyPolicy();
    expect(privacyPolicy.shouldExcludePath("node_modules/pkg/file.js")).toBe(true);
    expect(privacyPolicy.shouldExcludePath("src/app.ts")).toBe(false);

    // Retention policy
    const retentionPolicy = new RetentionPolicy({ keepRecentDays: 7, prunePastDays: 30 });
    const sessions = {
      active: {
        sessionId: "active",
        runId: "r1",
        startedAt: new Date().toISOString(),
        lastEventAt: new Date().toISOString(),
        eventCount: 5,
        pinned: false,
      },
    };
    const retDecisions = retentionPolicy.evaluate(sessions);
    expect(retDecisions[0]!.decision).toBe("keep");
  });

  it("supports concurrent sessions in session map", () => {
    const sm = new SessionMap();
    sm.startSession({ sessionId: "s-alpha" });
    sm.startSession({ sessionId: "s-beta" });

    // Current should be s-beta (last started)
    expect(sm.current()!.sessionId).toBe("s-beta");

    // Both are tracked
    expect(sm.get("s-alpha")).toBeDefined();
    expect(sm.get("s-beta")).toBeDefined();

    // End one, other is still accessible
    sm.endSession("s-beta");
    expect(sm.get("s-beta")!.endedAt).toBeDefined();
    expect(sm.get("s-alpha")!.endedAt).toBeUndefined();
  });
});
