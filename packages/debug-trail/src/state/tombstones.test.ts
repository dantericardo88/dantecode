import { describe, it, expect, beforeEach } from "vitest";
import { TombstoneRegistry } from "./tombstones.js";
import type { DeleteTombstone } from "../types.js";

function makeTombstone(overrides: Partial<DeleteTombstone> = {}): DeleteTombstone {
  return {
    tombstoneId: "tomb-1",
    filePath: "/src/deleted.ts",
    deletedAt: new Date().toISOString(),
    deletedBy: "agent",
    beforeStateCaptured: true,
    provenance: { sessionId: "s1", runId: "r1" },
    trailEventId: "evt-1",
    ...overrides,
  };
}

describe("TombstoneRegistry", () => {
  let registry: TombstoneRegistry;

  beforeEach(() => {
    registry = new TombstoneRegistry();
  });

  it("registers and retrieves a tombstone by ID", () => {
    registry.register(makeTombstone({ tombstoneId: "t1" }));
    expect(registry.getById("t1")).toBeDefined();
    expect(registry.getById("t1")!.tombstoneId).toBe("t1");
  });

  it("returns undefined for unknown tombstone ID", () => {
    expect(registry.getById("nonexistent")).toBeUndefined();
  });

  it("tracks tombstones by file path", () => {
    registry.register(makeTombstone({ tombstoneId: "t1", filePath: "/src/a.ts" }));
    registry.register(makeTombstone({ tombstoneId: "t2", filePath: "/src/a.ts" }));
    const forFile = registry.allForFile("/src/a.ts");
    expect(forFile).toHaveLength(2);
  });

  it("returns latest tombstone for a file", () => {
    const older = new Date(Date.now() - 10000).toISOString();
    const newer = new Date().toISOString();
    registry.register(makeTombstone({ tombstoneId: "t-old", filePath: "/f.ts", deletedAt: older }));
    registry.register(makeTombstone({ tombstoneId: "t-new", filePath: "/f.ts", deletedAt: newer }));
    const latest = registry.latestForFile("/f.ts");
    expect(latest!.tombstoneId).toBe("t-new");
  });

  it("bulk loads tombstones", () => {
    const tombstones = [makeTombstone({ tombstoneId: "t1" }), makeTombstone({ tombstoneId: "t2" })];
    registry.bulkLoad(tombstones);
    expect(registry.size()).toBe(2);
  });

  it("finds tombstones for a session", () => {
    registry.register(
      makeTombstone({ tombstoneId: "ts1", provenance: { sessionId: "sa", runId: "r1" } }),
    );
    registry.register(
      makeTombstone({ tombstoneId: "ts2", provenance: { sessionId: "sb", runId: "r2" } }),
    );
    const forSession = registry.forSession("sa");
    expect(forSession).toHaveLength(1);
    expect(forSession[0]!.tombstoneId).toBe("ts1");
  });

  it("finds tombstones by path prefix", () => {
    registry.register(makeTombstone({ tombstoneId: "t1", filePath: "/src/modules/a.ts" }));
    registry.register(makeTombstone({ tombstoneId: "t2", filePath: "/src/modules/b.ts" }));
    registry.register(makeTombstone({ tombstoneId: "t3", filePath: "/lib/c.ts" }));
    const results = registry.forPathPrefix("/src/modules");
    expect(results).toHaveLength(2);
  });

  it("tracks deleted file paths", () => {
    registry.register(makeTombstone({ filePath: "/a.ts" }));
    registry.register(makeTombstone({ tombstoneId: "t2", filePath: "/b.ts" }));
    const files = registry.deletedFiles();
    expect(files).toContain("/a.ts");
    expect(files).toContain("/b.ts");
  });

  it("identifies tombstones without before state", () => {
    registry.register(makeTombstone({ tombstoneId: "t-ok", beforeStateCaptured: true }));
    registry.register(makeTombstone({ tombstoneId: "t-gap", beforeStateCaptured: false }));
    const gaps = registry.withoutBeforeState();
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.tombstoneId).toBe("t-gap");
  });
});
