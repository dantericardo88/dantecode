import { describe, it, expect } from "vitest";
import { MemoryConsolidator, type MemoryEntry } from "./memory-consolidator.js";

function makeEntry(key: string, value = "val", timestamp?: string, score?: number): MemoryEntry {
  return {
    key,
    value,
    timestamp: timestamp ?? new Date().toISOString(),
    score,
  };
}

describe("MemoryConsolidator", () => {
  it("initializes with default options", () => {
    const mc = new MemoryConsolidator();
    expect(mc.entryCount).toBe(0);
    expect(mc.consolidationThreshold).toBe(50);
  });

  it("initializes with custom options", () => {
    const mc = new MemoryConsolidator({ consolidationThreshold: 10, maxAgeDays: 30 });
    expect(mc.consolidationThreshold).toBe(10);
  });

  it("addEntries increases count", () => {
    const mc = new MemoryConsolidator();
    mc.addEntries([makeEntry("a"), makeEntry("b")]);
    expect(mc.entryCount).toBe(2);
  });

  it("needsConsolidation returns false below threshold", () => {
    const mc = new MemoryConsolidator({ consolidationThreshold: 5 });
    mc.addEntries([makeEntry("a"), makeEntry("b")]);
    expect(mc.needsConsolidation()).toBe(false);
  });

  it("needsConsolidation returns true at threshold", () => {
    const mc = new MemoryConsolidator({ consolidationThreshold: 3 });
    mc.addEntries([makeEntry("a"), makeEntry("b"), makeEntry("c")]);
    expect(mc.needsConsolidation()).toBe(true);
  });

  it("consolidateIfNeeded returns null when not needed", () => {
    const mc = new MemoryConsolidator({ consolidationThreshold: 100 });
    mc.addEntries([makeEntry("a")]);
    expect(mc.consolidateIfNeeded()).toBeNull();
  });

  it("consolidateIfNeeded runs when threshold exceeded", () => {
    const mc = new MemoryConsolidator({ consolidationThreshold: 2 });
    mc.addEntries([makeEntry("a"), makeEntry("b"), makeEntry("a")]);
    const result = mc.consolidateIfNeeded();
    expect(result).not.toBeNull();
    expect(result!.before).toBe(3);
    expect(result!.merged).toBe(1);
  });

  it("consolidate merges duplicate keys keeping higher score", () => {
    const now = new Date().toISOString();
    const mc = new MemoryConsolidator();
    mc.addEntries([
      makeEntry("x", "low", now, 1),
      makeEntry("x", "high", now, 5),
    ]);
    const result = mc.consolidate();
    expect(result.merged).toBe(1);
    expect(result.after).toBe(1);
    const entries = mc.getEntries();
    expect(entries[0]!.value).toBe("high");
  });

  it("consolidate merges duplicate keys keeping newer when scores equal", () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 60000).toISOString();
    const later = now.toISOString();
    const mc = new MemoryConsolidator();
    mc.addEntries([
      makeEntry("x", "old", earlier, 3),
      makeEntry("x", "new", later, 3),
    ]);
    mc.consolidate();
    const entries = mc.getEntries();
    expect(entries[0]!.value).toBe("new");
  });

  it("consolidate prunes stale entries beyond maxAgeDays", () => {
    const mc = new MemoryConsolidator({ maxAgeDays: 30 });
    mc.addEntries([
      makeEntry("fresh", "v", new Date().toISOString()),
      makeEntry("stale", "v", "2020-01-01T00:00:00Z"),
    ]);
    const result = mc.consolidate();
    expect(result.pruned).toBe(1);
    expect(result.after).toBe(1);
    expect(mc.getEntries()[0]!.key).toBe("fresh");
  });

  it("consolidate prunes entries with invalid timestamps", () => {
    const mc = new MemoryConsolidator();
    mc.addEntries([makeEntry("bad", "v", "not-a-date")]);
    const result = mc.consolidate();
    expect(result.pruned).toBe(1);
    expect(result.after).toBe(0);
  });

  it("getEntries returns a copy", () => {
    const mc = new MemoryConsolidator();
    mc.addEntries([makeEntry("a")]);
    const entries = mc.getEntries();
    entries.pop();
    expect(mc.entryCount).toBe(1);
  });
});
