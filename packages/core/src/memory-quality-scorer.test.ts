import { describe, it, expect } from "vitest";
import { MemoryQualityScorer } from "./memory-quality-scorer.js";
import type { ScoredMemory } from "./memory-quality-scorer.js";

const NOW = 1_700_000_000_000;
const scorer = new MemoryQualityScorer({ nowFn: () => NOW });

function makeMemory(overrides: Partial<ScoredMemory> = {}): ScoredMemory {
  return {
    content: "A useful piece of information about TypeScript patterns for testing.",
    createdAt: NOW - 3_600_000, // 1 hour ago
    lastAccessedAt: NOW - 600_000, // 10 min ago
    accessCount: 15,
    impactScore: 0.7,
    ...overrides,
  };
}

describe("MemoryQualityScorer", () => {
  it("scoring is deterministic: same input always yields same output", () => {
    const mem = makeMemory();
    const a = scorer.score(mem);
    const b = scorer.score(mem);
    expect(a).toEqual(b);
  });

  it("high-quality memory scores above 60", () => {
    const mem = makeMemory({
      impactScore: 0.9,
      accessCount: 50,
      lastAccessedAt: NOW - 60_000, // 1 min ago
      content: "Detailed information about monorepo configuration with turborepo and tsup for ESM builds.",
    });
    const result = scorer.score(mem);
    expect(result.total).toBeGreaterThan(60);
    expect(result.relevance).toBeGreaterThanOrEqual(0);
    expect(result.relevance).toBeLessThanOrEqual(25);
  });

  it("old, unused memory scores low and is eviction candidate (< 40)", () => {
    const mem = makeMemory({
      impactScore: 0.1,
      accessCount: 1,
      lastAccessedAt: NOW - 80 * 24 * 3600 * 1000, // 80 days ago
      content: "old note",
    });
    const result = scorer.score(mem);
    expect(result.total).toBeLessThan(40);
    expect(scorer.isEvictionCandidate(result)).toBe(true);
  });

  it("high-impact frequently accessed memory is promotion candidate (> 80)", () => {
    const mem = makeMemory({
      impactScore: 1.0,
      accessCount: 100,
      lastAccessedAt: NOW - 1000, // 1 second ago
      content: "Critical architecture pattern for the council orchestrator with detailed lane assignment and merge logic.",
    });
    const result = scorer.score(mem);
    expect(result.total).toBeGreaterThan(80);
    expect(scorer.isPromotionCandidate(result)).toBe(true);
  });

  it("relevance dimension scales with impactScore", () => {
    const low = scorer.score(makeMemory({ impactScore: 0.0 }));
    const high = scorer.score(makeMemory({ impactScore: 1.0 }));
    expect(high.relevance).toBeGreaterThan(low.relevance);
    expect(low.relevance).toBe(0);
    expect(high.relevance).toBe(25);
  });

  it("freshness dimension decreases with age", () => {
    const fresh = scorer.score(makeMemory({ lastAccessedAt: NOW - 1000 }));
    const stale = scorer.score(makeMemory({ lastAccessedAt: NOW - 60 * 24 * 3600 * 1000 }));
    expect(fresh.freshness).toBeGreaterThan(stale.freshness);
  });

  it("utility dimension increases with access count", () => {
    const low = scorer.score(makeMemory({ accessCount: 1 }));
    const high = scorer.score(makeMemory({ accessCount: 80 }));
    expect(high.utility).toBeGreaterThan(low.utility);
  });

  it("each dimension is clamped to 0-25 range", () => {
    const extremeHigh = scorer.score(makeMemory({
      impactScore: 5.0, // over 1
      accessCount: 999,
      lastAccessedAt: NOW + 100_000, // future
    }));
    expect(extremeHigh.relevance).toBeLessThanOrEqual(25);
    expect(extremeHigh.freshness).toBeLessThanOrEqual(25);
    expect(extremeHigh.accuracy).toBeLessThanOrEqual(25);
    expect(extremeHigh.utility).toBeLessThanOrEqual(25);
    expect(extremeHigh.total).toBeLessThanOrEqual(100);
  });
});
