import { describe, it, expect } from "vitest";
import {
  distillEntries,
  extractPlaybook,
  scoreRelevance,
  findDuplicates,
  type DistillableEntry,
} from "./memory-distiller.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<DistillableEntry> & { id: string }): DistillableEntry {
  return {
    content: `Default content for ${overrides.id}`,
    category: "general",
    relevanceScore: 0.5,
    timestamp: "2026-03-19T00:00:00.000Z",
    tags: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// distillEntries
// ---------------------------------------------------------------------------

describe("distillEntries", () => {
  it("returns empty result for empty input", () => {
    const result = distillEntries([]);
    expect(result.distilled).toEqual([]);
    expect(result.removedCount).toBe(0);
    expect(result.mergedCount).toBe(0);
    expect(result.keptCount).toBe(0);
  });

  it("passes through a single entry without merging", () => {
    const entry = makeEntry({ id: "e1", content: "Fix the authentication bug in the login page" });
    const result = distillEntries([entry]);

    expect(result.distilled).toHaveLength(1);
    expect(result.distilled[0]!.sourceIds).toEqual(["e1"]);
    expect(result.distilled[0]!.content).toBe(entry.content);
    expect(result.mergedCount).toBe(0);
    expect(result.keptCount).toBe(1);
  });

  it("merges similar entries within the same category", () => {
    const entries = [
      makeEntry({
        id: "e1",
        content: "Fix the authentication bug in login module",
        category: "bugfix",
        relevanceScore: 0.8,
        timestamp: "2026-03-19T01:00:00.000Z",
      }),
      makeEntry({
        id: "e2",
        content: "Fix the authentication bug in login module with token refresh",
        category: "bugfix",
        relevanceScore: 0.6,
        timestamp: "2026-03-19T02:00:00.000Z",
      }),
    ];

    const result = distillEntries(entries, { mergeThreshold: 0.5 });

    expect(result.distilled).toHaveLength(1);
    expect(result.distilled[0]!.sourceIds).toContain("e1");
    expect(result.distilled[0]!.sourceIds).toContain("e2");
    // Picks the longest content
    expect(result.distilled[0]!.content).toBe(entries[1]!.content);
    // Averages scores
    expect(result.distilled[0]!.combinedScore).toBeCloseTo(0.7, 5);
    // Keeps latest timestamp
    expect(result.distilled[0]!.timestamp).toBe("2026-03-19T02:00:00.000Z");
    expect(result.mergedCount).toBe(1);
  });

  it("keeps dissimilar entries separate", () => {
    const entries = [
      makeEntry({
        id: "e1",
        content: "Fix the authentication bug in login module",
        category: "bugfix",
      }),
      makeEntry({
        id: "e2",
        content: "Implement dark mode toggle for settings page",
        category: "bugfix",
      }),
    ];

    const result = distillEntries(entries, { mergeThreshold: 0.7 });

    expect(result.distilled).toHaveLength(2);
    expect(result.mergedCount).toBe(0);
  });

  it("respects maxOutput by trimming lowest-scored entries", () => {
    const entries = [
      makeEntry({ id: "e1", content: "Alpha strategy approach one", relevanceScore: 0.9 }),
      makeEntry({ id: "e2", content: "Beta different approach two", relevanceScore: 0.3 }),
      makeEntry({ id: "e3", content: "Gamma another unique method", relevanceScore: 0.7 }),
    ];

    const result = distillEntries(entries, { maxOutput: 2 });

    expect(result.distilled).toHaveLength(2);
    expect(result.removedCount).toBe(1);
    expect(result.keptCount).toBe(2);
    // Highest scores kept
    expect(result.distilled[0]!.combinedScore).toBe(0.9);
    expect(result.distilled[1]!.combinedScore).toBe(0.7);
  });

  it("groups by category before merging", () => {
    const entries = [
      makeEntry({
        id: "e1",
        content: "Fix the authentication bug in login module",
        category: "bugfix",
      }),
      makeEntry({
        id: "e2",
        content: "Fix the authentication bug in login module with reset",
        category: "feature",
      }),
    ];

    // Same content but different categories — should NOT merge
    const result = distillEntries(entries, { mergeThreshold: 0.5 });

    expect(result.distilled).toHaveLength(2);
    expect(result.mergedCount).toBe(0);
  });

  it("returns correct counts across multiple categories and merges", () => {
    const entries = [
      makeEntry({
        id: "e1",
        content: "Fix authentication bug in login module",
        category: "bugfix",
        relevanceScore: 0.8,
      }),
      makeEntry({
        id: "e2",
        content: "Fix authentication bug in login module with token",
        category: "bugfix",
        relevanceScore: 0.6,
      }),
      makeEntry({
        id: "e3",
        content: "Implement dark mode toggle for settings",
        category: "feature",
        relevanceScore: 0.9,
      }),
      makeEntry({
        id: "e4",
        content: "Add unit tests for payment processor",
        category: "testing",
        relevanceScore: 0.5,
      }),
    ];

    const result = distillEntries(entries, { mergeThreshold: 0.5 });

    // e1+e2 merge → 1 bugfix, e3 feature, e4 testing = 3 distilled
    expect(result.distilled).toHaveLength(3);
    expect(result.mergedCount).toBe(1);
    expect(result.keptCount).toBe(3);
    expect(result.removedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractPlaybook
// ---------------------------------------------------------------------------

describe("extractPlaybook", () => {
  it("returns entries with category 'strategy' sorted by relevanceScore desc", () => {
    const entries = [
      makeEntry({ id: "s1", content: "Use incremental migration", category: "strategy", relevanceScore: 0.6 }),
      makeEntry({ id: "s2", content: "Prefer composition over inheritance", category: "strategy", relevanceScore: 0.9 }),
      makeEntry({ id: "g1", content: "General note", category: "general", relevanceScore: 1.0 }),
    ];

    const playbook = extractPlaybook(entries);

    expect(playbook).toEqual([
      "Prefer composition over inheritance",
      "Use incremental migration",
    ]);
  });

  it("includes entries with 'playbook' tag regardless of category", () => {
    const entries = [
      makeEntry({
        id: "p1",
        content: "Always write tests first",
        category: "testing",
        tags: ["playbook"],
        relevanceScore: 0.7,
      }),
      makeEntry({
        id: "s1",
        content: "Use feature flags",
        category: "strategy",
        tags: [],
        relevanceScore: 0.8,
      }),
    ];

    const playbook = extractPlaybook(entries);

    expect(playbook).toHaveLength(2);
    expect(playbook).toContain("Always write tests first");
    expect(playbook).toContain("Use feature flags");
    // Sorted by score desc
    expect(playbook[0]).toBe("Use feature flags");
  });

  it("returns empty array when no strategies or playbook tags exist", () => {
    const entries = [
      makeEntry({ id: "g1", content: "General note one", category: "general" }),
      makeEntry({ id: "g2", content: "General note two", category: "bugfix" }),
    ];

    expect(extractPlaybook(entries)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scoreRelevance
// ---------------------------------------------------------------------------

describe("scoreRelevance", () => {
  it("computes Jaccard-based score between content and query", () => {
    const entry = makeEntry({
      id: "r1",
      content: "Fix the authentication bug in the login page",
      category: "bugfix",
    });

    const score = scoreRelevance(entry, "authentication login bug");

    // Should have non-trivial overlap — all 3 query tokens appear in content
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it("gives +0.1 bonus for strategy category", () => {
    const baseEntry = makeEntry({
      id: "r1",
      content: "Use caching for performance improvement",
      category: "general",
    });
    const strategyEntry = makeEntry({
      id: "r2",
      content: "Use caching for performance improvement",
      category: "strategy",
    });

    const baseScore = scoreRelevance(baseEntry, "caching performance");
    const strategyScore = scoreRelevance(strategyEntry, "caching performance");

    expect(strategyScore).toBeCloseTo(baseScore + 0.1, 5);
  });

  it("gives +0.05 per matching tag", () => {
    const entryNoTags = makeEntry({
      id: "r1",
      content: "Database optimization techniques",
      category: "general",
      tags: [],
    });
    const entryWithTags = makeEntry({
      id: "r2",
      content: "Database optimization techniques",
      category: "general",
      tags: ["optimization", "database"],
    });

    const noTagScore = scoreRelevance(entryNoTags, "database optimization query");
    const tagScore = scoreRelevance(entryWithTags, "database optimization query");

    // Both tags match tokens in the query → +0.10
    expect(tagScore).toBeCloseTo(noTagScore + 0.10, 5);
  });
});

// ---------------------------------------------------------------------------
// findDuplicates
// ---------------------------------------------------------------------------

describe("findDuplicates", () => {
  it("groups similar entries into duplicate clusters", () => {
    const entries = [
      makeEntry({ id: "d1", content: "Fix the authentication bug in login module" }),
      makeEntry({ id: "d2", content: "Fix the authentication bug in login module with refresh" }),
      makeEntry({ id: "d3", content: "Implement dark mode toggle for application settings page" }),
    ];

    const duplicates = findDuplicates(entries, 0.6);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toContain("d1");
    expect(duplicates[0]).toContain("d2");
    // d3 is unique — not in any cluster
  });

  it("returns empty array when all entries are unique", () => {
    const entries = [
      makeEntry({ id: "u1", content: "Fix authentication bug in the login page" }),
      makeEntry({ id: "u2", content: "Implement dark mode toggle for settings" }),
      makeEntry({ id: "u3", content: "Add payment processing webhook handler" }),
    ];

    const duplicates = findDuplicates(entries, 0.8);

    expect(duplicates).toEqual([]);
  });

  it("respects custom threshold parameter", () => {
    const entries = [
      makeEntry({ id: "t1", content: "Fix authentication bug in login module handler" }),
      makeEntry({ id: "t2", content: "Fix authentication bug in login module endpoint" }),
    ];

    // Very high threshold — should NOT group them
    const strictDupes = findDuplicates(entries, 0.99);
    expect(strictDupes).toEqual([]);

    // Lower threshold — should group them
    const relaxedDupes = findDuplicates(entries, 0.5);
    expect(relaxedDupes).toHaveLength(1);
    expect(relaxedDupes[0]).toContain("t1");
    expect(relaxedDupes[0]).toContain("t2");
  });
});
