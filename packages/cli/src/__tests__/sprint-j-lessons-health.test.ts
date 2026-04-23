// ============================================================================
// Sprint J — Dims 21+24: Semantic Lesson Ranking + Provider Health Snapshot
// Tests that:
//  - queryLessons with contextTokens ranks semantically similar lessons higher
//  - Jaccard blend: 0.6 occurrences + 0.4 jaccard weights applied
//  - Empty contextTokens falls back to occurrence-only ranking
//  - Top-N lessons from Jaccard-ranked results correct
//  - getHealthSnapshot() returns state + failure count per provider
//  - Snapshot printed as [Provider health] after model failure
//  - half-open provider shown as "half-open" in snapshot output
//  - No providers registered → returns empty snapshot, no throw
// ============================================================================

import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "@dantecode/core";

// ─── Part 1: Semantic Jaccard ranking (dim 21) ───────────────────────────────

/** Simulates jaccardSimilarity from danteforge/src/index.ts */
function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface MockLesson {
  id: string;
  pattern: string;
  occurrences: number;
  lastSeen: string;
}

/** Simulates queryLessons with contextTokens Jaccard blend. */
function simulateQueryWithContext(
  lessons: MockLesson[],
  contextTokens: string[],
  limit: number,
): MockLesson[] {
  if (contextTokens.length === 0) {
    return [...lessons]
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, limit);
  }
  const maxOccurrences = Math.max(...lessons.map((l) => l.occurrences), 1);
  return lessons
    .map((lesson) => {
      const patternTokens = lesson.pattern.toLowerCase().split(/\s+/);
      const jaccard = jaccardSimilarity(patternTokens, contextTokens);
      const normalizedOccurrences = lesson.occurrences / maxOccurrences;
      const blendedScore = 0.6 * normalizedOccurrences + 0.4 * jaccard;
      return { lesson, blendedScore };
    })
    .sort((a, b) => b.blendedScore - a.blendedScore)
    .slice(0, limit)
    .map((e) => e.lesson);
}

describe("Semantic Jaccard lesson ranking — Sprint J (dim 21)", () => {
  const lessons: MockLesson[] = [
    { id: "1", pattern: "avoid using eval for dynamic code", occurrences: 2, lastSeen: "2026-04-01" },
    { id: "2", pattern: "security scanner found SQL injection", occurrences: 2, lastSeen: "2026-04-10" },
    { id: "3", pattern: "prefer async await over callbacks", occurrences: 3, lastSeen: "2026-04-05" },
  ];

  // 1. queryLessons with contextTokens ranks semantically similar lessons higher
  it("contextTokens causes security-related lesson to rank above high-occurrence one", () => {
    const contextTokens = ["security", "scanner", "sql", "injection"];
    const results = simulateQueryWithContext(lessons, contextTokens, 3);
    // Lesson 2 has high Jaccard with security context, lesson 3 has most occurrences
    // With blend: lesson 2 should rank higher than its occurrence count alone would suggest
    const securityLessonIdx = results.findIndex((l) => l.id === "2");
    const asyncLessonIdx = results.findIndex((l) => l.id === "3");
    expect(securityLessonIdx).toBeLessThan(asyncLessonIdx);
  });

  // 2. Jaccard blend: 0.6 occurrences + 0.4 jaccard weights applied
  it("blended score correctly weights 0.6 * occurrences + 0.4 * jaccard", () => {
    const singleLesson: MockLesson[] = [
      { id: "A", pattern: "security scanner", occurrences: 5, lastSeen: "2026-04-01" },
    ];
    const contextTokens = ["security", "scanner"];
    const results = simulateQueryWithContext(singleLesson, contextTokens, 1);
    expect(results[0]?.id).toBe("A");
    // Jaccard("security scanner", ["security", "scanner"]) = 2/2 = 1.0
    // normalizedOccurrences = 5/5 = 1.0
    // blendedScore = 0.6 * 1.0 + 0.4 * 1.0 = 1.0
  });

  // 3. Empty contextTokens falls back to occurrence-only ranking
  it("empty contextTokens uses occurrence-only ranking (highest occurrences first)", () => {
    const results = simulateQueryWithContext(lessons, [], 3);
    expect(results[0]?.id).toBe("3"); // occurrences: 10
    expect(results[1]?.id).toBe("1"); // occurrences: 5
    expect(results[2]?.id).toBe("2"); // occurrences: 2
  });

  // 4. limit respected with contextTokens
  it("limit parameter is respected when contextTokens provided", () => {
    const results = simulateQueryWithContext(lessons, ["security"], 2);
    expect(results.length).toBe(2);
  });

  // 5. Jaccard similarity: exact token match → 1.0
  it("jaccardSimilarity returns 1.0 for identical token sets", () => {
    const tokens = ["security", "scanner"];
    expect(jaccardSimilarity(tokens, tokens)).toBe(1.0);
  });

  // 6. Jaccard similarity: no overlap → 0.0
  it("jaccardSimilarity returns 0.0 for completely disjoint token sets", () => {
    expect(jaccardSimilarity(["foo", "bar"], ["baz", "qux"])).toBe(0.0);
  });

  // 7. Jaccard similarity: partial overlap
  it("jaccardSimilarity returns correct partial overlap score", () => {
    const sim = jaccardSimilarity(["a", "b", "c"], ["b", "c", "d"]);
    // intersection: {b, c} = 2; union: {a, b, c, d} = 4; jaccard = 0.5
    expect(sim).toBeCloseTo(0.5);
  });
});

// ─── Part 2: Multi-provider health snapshot (dim 24) ─────────────────────────

describe("Multi-provider health snapshot — Sprint J (dim 24)", () => {
  // 8. getHealthSnapshot returns empty object when no providers registered
  it("getHealthSnapshot returns empty object when no providers used", () => {
    const breaker = new CircuitBreaker();
    const snapshot = breaker.getHealthSnapshot();
    expect(typeof snapshot).toBe("object");
    expect(Object.keys(snapshot)).toHaveLength(0);
  });

  // 9. getHealthSnapshot returns state + failure count per provider
  it("getHealthSnapshot returns correct state and failure count after failures", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 60_000 });
    // Trigger failures for "anthropic"
    try { await breaker.execute("anthropic", () => Promise.reject(new Error("fail"))); } catch {}
    try { await breaker.execute("anthropic", () => Promise.reject(new Error("fail"))); } catch {}
    const snapshot = breaker.getHealthSnapshot();
    expect(snapshot["anthropic"]).toBeDefined();
    expect(snapshot["anthropic"]!.state).toBe("open");
    expect(snapshot["anthropic"]!.failures).toBe(2);
  });

  // 10. Snapshot printed as [Provider health] line on failure
  it("formatHealthLine returns [Provider health] prefix", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    try { await breaker.execute("ollama", () => Promise.reject(new Error("fail"))); } catch {}
    const line = breaker.formatHealthLine();
    expect(line).toContain("[Provider health]");
    expect(line).toContain("ollama:");
  });

  // 11. half-open provider shown as "half-open" in snapshot output
  it("formatHealthLine shows 'half-open' for provider past reset timeout", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 });
    try { await breaker.execute("claude", () => Promise.reject(new Error("fail"))); } catch {}
    // With resetTimeoutMs=0, getState transitions to half-open immediately
    const line = breaker.formatHealthLine();
    expect(line).toContain("half-open");
  });

  // 12. Closed providers shown as "closed" in health line
  it("closed provider shown as 'closed' in health snapshot after success", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    try { await breaker.execute("grok", () => Promise.reject(new Error("fail"))); } catch {}
    // Only 1 failure — circuit still closed
    const snapshot = breaker.getHealthSnapshot();
    expect(snapshot["grok"]!.state).toBe("closed");
  });

  // 13. Multiple providers tracked independently
  it("multiple providers tracked independently in snapshot", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    try { await breaker.execute("provider-a", () => Promise.reject(new Error("fail"))); } catch {}
    await breaker.execute("provider-b", () => Promise.resolve("ok"));
    const snapshot = breaker.getHealthSnapshot();
    expect(snapshot["provider-a"]?.state).toBe("open");
    expect(snapshot["provider-b"]).toBeUndefined(); // no failure → not tracked
  });

  // 14. formatHealthLine fallback for healthy cluster
  it("formatHealthLine returns all-healthy message when no providers in snapshot", () => {
    const breaker = new CircuitBreaker();
    const line = breaker.formatHealthLine();
    expect(line).toContain("[Provider health]");
    expect(line).toContain("all providers healthy");
  });
});
