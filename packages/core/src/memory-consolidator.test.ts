import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryConsolidator } from "./memory-consolidator.js";
import type { MemoryItem } from "./memory-consolidator.js";

const NOW = 1_700_000_000_000;

function makeItem(id: string, content: string, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    content,
    createdAt: NOW - 3_600_000,
    lastAccessedAt: NOW - 600_000,
    accessCount: 5,
    impactScore: 0.5,
    ...overrides,
  };
}

describe("MemoryConsolidator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merges duplicate memories with high Jaccard similarity", () => {
    const consolidator = new MemoryConsolidator({ mergeThreshold: 0.5, nowFn: () => NOW });
    const memories: MemoryItem[] = [
      makeItem("a", "typescript patterns for monorepo builds with turborepo"),
      makeItem("b", "typescript patterns for monorepo builds with turborepo and tsup"),
    ];
    const result = consolidator.consolidate(memories);
    expect(result.length).toBe(1);
    // Should keep the longer content
    expect(result[0]!.content).toContain("tsup");
    // Should combine access counts
    expect(result[0]!.accessCount).toBe(10);
  });

  it("does not merge memories with low similarity", () => {
    const consolidator = new MemoryConsolidator({ mergeThreshold: 0.6, nowFn: () => NOW });
    const memories: MemoryItem[] = [
      makeItem("a", "typescript build configuration for the monorepo"),
      makeItem("b", "python data science libraries for machine learning"),
    ];
    const result = consolidator.consolidate(memories);
    expect(result.length).toBe(2);
  });

  it("evicts lowest-scoring memories when exceeding capacity", () => {
    const consolidator = new MemoryConsolidator({ nowFn: () => NOW });
    const memories: MemoryItem[] = [
      makeItem("high", "Important architecture decision for the project.", {
        impactScore: 0.9,
        accessCount: 50,
        lastAccessedAt: NOW - 1000,
      }),
      makeItem("low", "x", {
        impactScore: 0.05,
        accessCount: 1,
        lastAccessedAt: NOW - 80 * 24 * 3600 * 1000,
      }),
      makeItem("mid", "Some moderately useful information about config.", {
        impactScore: 0.5,
        accessCount: 10,
        lastAccessedAt: NOW - 3_600_000,
      }),
    ];
    const result = consolidator.evict(memories, 2);
    expect(result.length).toBe(2);
    // The low-scoring item should be evicted
    const ids = result.map((m) => m.id);
    expect(ids).toContain("high");
    expect(ids).not.toContain("low");
  });

  it("eviction returns all memories when under capacity", () => {
    const consolidator = new MemoryConsolidator({ nowFn: () => NOW });
    const memories = [makeItem("a", "memory one"), makeItem("b", "memory two")];
    const result = consolidator.evict(memories, 10);
    expect(result.length).toBe(2);
  });

  it("handles empty memory list", () => {
    const consolidator = new MemoryConsolidator({ nowFn: () => NOW });
    expect(consolidator.consolidate([])).toEqual([]);
    expect(consolidator.evict([], 5)).toEqual([]);
  });

  it("handles single memory item", () => {
    const consolidator = new MemoryConsolidator({ nowFn: () => NOW });
    const memories = [makeItem("only", "the only memory in the store")];
    const consolidated = consolidator.consolidate(memories);
    expect(consolidated.length).toBe(1);
    expect(consolidated[0]!.id).toBe("only");
  });

  it("scheduleConsolidation triggers periodic callback", () => {
    vi.useFakeTimers();
    const consolidator = new MemoryConsolidator({ nowFn: () => NOW });
    const memories = [makeItem("a", "memory content alpha")];
    const callback = vi.fn();

    consolidator.scheduleConsolidation(1000, () => memories, callback);

    vi.advanceTimersByTime(3500);
    expect(callback).toHaveBeenCalledTimes(3);
    consolidator.stopConsolidation();

    vi.advanceTimersByTime(2000);
    expect(callback).toHaveBeenCalledTimes(3); // no more after stop

    vi.useRealTimers();
  });

  it("evict with capacity 0 returns empty", () => {
    const consolidator = new MemoryConsolidator({ nowFn: () => NOW });
    const memories = [makeItem("a", "something important")];
    expect(consolidator.evict(memories, 0)).toEqual([]);
  });
});
