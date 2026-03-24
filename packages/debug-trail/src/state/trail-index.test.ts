import { describe, it, expect, beforeEach } from "vitest";
import { TrailEventIndex } from "./trail-index.js";
import type { TrailEvent } from "../types.js";

function makeEvent(overrides: Partial<TrailEvent> = {}): TrailEvent {
  return {
    id: "evt-1",
    seq: 1,
    timestamp: new Date().toISOString(),
    kind: "tool_call",
    actor: "Bash",
    summary: "ran git status",
    payload: {},
    provenance: { sessionId: "s1", runId: "r1" },
    ...overrides,
  };
}

describe("TrailEventIndex", () => {
  let idx: TrailEventIndex;

  beforeEach(() => {
    idx = new TrailEventIndex();
  });

  it("indexes and retrieves events by session", () => {
    idx.index(makeEvent({ id: "e1", provenance: { sessionId: "s1", runId: "r1" } }));
    idx.index(makeEvent({ id: "e2", provenance: { sessionId: "s2", runId: "r2" } }));
    expect(idx.findBySession("s1")).toHaveLength(1);
    expect(idx.findBySession("s2")).toHaveLength(1);
  });

  it("indexes and retrieves events by file path", () => {
    idx.index(makeEvent({ id: "e1", payload: { filePath: "/src/app.ts" } }));
    idx.index(makeEvent({ id: "e2", payload: { filePath: "/src/index.ts" } }));
    expect(idx.findByFile("/src/app.ts")).toHaveLength(1);
    expect(idx.findByFile("/src/index.ts")).toHaveLength(1);
  });

  it("searches by file path prefix", () => {
    idx.index(makeEvent({ id: "e1", payload: { filePath: "/src/modules/a.ts" } }));
    idx.index(makeEvent({ id: "e2", payload: { filePath: "/src/modules/b.ts" } }));
    idx.index(makeEvent({ id: "e3", payload: { filePath: "/lib/c.ts" } }));
    expect(idx.findByFilePrefix("/src/modules")).toHaveLength(2);
  });

  it("indexes and retrieves events by kind", () => {
    idx.index(makeEvent({ id: "e1", kind: "file_write" }));
    idx.index(makeEvent({ id: "e2", kind: "error" }));
    idx.index(makeEvent({ id: "e3", kind: "file_write" }));
    expect(idx.findByKind("file_write")).toHaveLength(2);
    expect(idx.findByKind("error")).toHaveLength(1);
  });

  it("indexes and retrieves events by actor", () => {
    idx.index(makeEvent({ id: "e1", actor: "Write" }));
    idx.index(makeEvent({ id: "e2", actor: "Bash" }));
    expect(idx.findByActor("Write")).toHaveLength(1);
    expect(idx.findByActor("Bash")).toHaveLength(1);
  });

  it("performs full-text search across summary and file path", () => {
    idx.index(makeEvent({ id: "e1", summary: "compiled TypeScript" }));
    idx.index(makeEvent({ id: "e2", summary: "ran tests", payload: { filePath: "/test/app.test.ts" } }));
    expect(idx.search("typescript")).toHaveLength(1);
    expect(idx.search("test")).toHaveLength(1);
  });

  it("bulk indexes events", () => {
    idx.bulkIndex([
      makeEvent({ id: "e1" }),
      makeEvent({ id: "e2" }),
      makeEvent({ id: "e3" }),
    ]);
    expect(idx.size()).toBe(3);
  });

  it("clears all entries", () => {
    idx.index(makeEvent());
    expect(idx.size()).toBe(1);
    idx.clear();
    expect(idx.size()).toBe(0);
    expect(idx.getSessions()).toEqual([]);
    expect(idx.getFiles()).toEqual([]);
  });

  it("returns empty arrays for missing session/file", () => {
    expect(idx.findBySession("nonexistent")).toEqual([]);
    expect(idx.findByFile("nonexistent")).toEqual([]);
    expect(idx.findByKind("error")).toEqual([]);
  });
});
