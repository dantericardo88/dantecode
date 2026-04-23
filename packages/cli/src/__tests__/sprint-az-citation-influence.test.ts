// ============================================================================
// Sprint AZ — Dims 2+21: Retrieval citation tracker + memory decision influence
// Tests that:
//  - bufferRetrievedFact + computeCitationScore detects cited fact
//  - computeCitationScore returns citationRate=0 when no facts appear in messages
//  - computeCitationScore returns citationRate=1 when all facts appear
//  - recordCitationResult creates retrieval-citation-log.json
//  - loadCitationResults reads and parses entries
//  - getOverallCitationRate returns correct average across entries
//  - computeMemoryDecisionInfluence detects influenced facts correctly
//  - recordMemoryDecisionInfluence creates memory-decision-log.json
//  - getMemoryInfluenceStats returns correct avgInfluenceRate
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  beginRetrievalSession,
  bufferRetrievedFact,
  computeCitationScore,
  recordCitationResult,
  loadCitationResults,
  getOverallCitationRate,
  computeMemoryDecisionInfluence,
  recordMemoryDecisionInfluence,
  getMemoryInfluenceStats,
} from "@dantecode/core";
import type { MemoryDecisionEntry } from "@dantecode/core";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-az-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("bufferRetrievedFact + computeCitationScore — Sprint AZ (dim 2)", () => {
  // 1. detects cited fact via substring match
  it("computeCitationScore detects when a buffered fact appears in assistant messages", () => {
    const sessionId = `test-cite-${randomUUID()}`;
    beginRetrievalSession(sessionId);
    bufferRetrievedFact(sessionId, "key-1", "use error boundaries around async calls", "repo-memory");
    const result = computeCitationScore(sessionId, [
      "I recommend you use error boundaries around async calls for safety.",
    ]);
    expect(result.totalCited).toBe(1);
    expect(result.citationRate).toBe(1);
    expect(result.citedKeys).toContain("key-1");
  });

  // 2. returns citationRate=0 when no facts appear in messages
  it("computeCitationScore returns citationRate=0 when no facts appear in messages", () => {
    const sessionId = `test-no-cite-${randomUUID()}`;
    beginRetrievalSession(sessionId);
    bufferRetrievedFact(sessionId, "key-x", "use reactive programming with rxjs streams", "repo-memory");
    const result = computeCitationScore(sessionId, ["I used a for loop to iterate the array."]);
    expect(result.citationRate).toBe(0);
    expect(result.uncitedKeys).toContain("key-x");
  });

  // 3. returns citationRate=1 when all facts appear
  it("computeCitationScore returns citationRate=1 when all buffered facts appear in messages", () => {
    const sessionId = `test-all-cite-${randomUUID()}`;
    beginRetrievalSession(sessionId);
    bufferRetrievedFact(sessionId, "k1", "prefer early return over nested ifs", "approach-memory");
    bufferRetrievedFact(sessionId, "k2", "validate inputs at system boundaries", "repo-memory");
    const result = computeCitationScore(sessionId, [
      "I prefer early return over nested ifs to reduce complexity.",
      "Always validate inputs at system boundaries before processing.",
    ]);
    expect(result.citationRate).toBe(1);
    expect(result.totalCited).toBe(2);
  });

  // 4. recordCitationResult creates retrieval-citation-log.json
  it("recordCitationResult creates .danteforge/retrieval-citation-log.json", () => {
    const dir = makeDir();
    const sessionId = `test-record-${randomUUID()}`;
    beginRetrievalSession(sessionId);
    const result = computeCitationScore(sessionId, []);
    recordCitationResult(result, dir);
    expect(existsSync(join(dir, ".danteforge", "retrieval-citation-log.json"))).toBe(true);
  });

  // 5. loadCitationResults reads and parses entries
  it("loadCitationResults reads and parses entries correctly", () => {
    const dir = makeDir();
    const sessionId1 = `test-load-1-${randomUUID()}`;
    const sessionId2 = `test-load-2-${randomUUID()}`;
    beginRetrievalSession(sessionId1);
    bufferRetrievedFact(sessionId1, "k1", "test fact one here", "repo-memory");
    const r1 = computeCitationScore(sessionId1, ["test fact one here"]);
    recordCitationResult(r1, dir);
    beginRetrievalSession(sessionId2);
    const r2 = computeCitationScore(sessionId2, []);
    recordCitationResult(r2, dir);
    const loaded = loadCitationResults(dir);
    expect(loaded.length).toBe(2);
    expect(loaded[0]!.citationRate).toBe(1);
    expect(loaded[1]!.totalRetrieved).toBe(0);
  });

  // 6. getOverallCitationRate returns correct average
  it("getOverallCitationRate returns correct average across results", () => {
    const results = [
      { sessionId: "s1", totalRetrieved: 4, totalCited: 4, citationRate: 1.0, citedKeys: [], uncitedKeys: [], isHighConfidence: true, matchConfidence: 0.6, timestamp: "" },
      { sessionId: "s2", totalRetrieved: 4, totalCited: 0, citationRate: 0.0, citedKeys: [], uncitedKeys: [], isHighConfidence: false, matchConfidence: 0, timestamp: "" },
    ];
    const rate = getOverallCitationRate(results);
    expect(rate).toBe(0.5); // 4 cited out of 8 total
  });
});

describe("computeMemoryDecisionInfluence — Sprint AZ (dim 21)", () => {
  // 7. detects influenced facts correctly
  it("computeMemoryDecisionInfluence detects facts that appear in assistant messages", () => {
    const sessionId = `test-influence-${randomUUID()}`;
    const injectedFacts = [
      "Always use guard clauses to handle null early",
      "Prefer async/await over raw promise chains",
    ];
    const assistantMessages = [
      "Always use guard clauses to handle null early when dealing with optional parameters.",
    ];
    const result = computeMemoryDecisionInfluence(sessionId, injectedFacts, assistantMessages);
    expect(result.influencedFactCount).toBe(1);
    expect(result.influenceRate).toBeCloseTo(0.5, 5);
    expect(result.influencedSnippets.length).toBe(1);
  });

  // 8. recordMemoryDecisionInfluence creates memory-decision-log.json
  it("recordMemoryDecisionInfluence creates .danteforge/memory-decision-log.json", () => {
    const dir = makeDir();
    const entry: MemoryDecisionEntry = {
      sessionId: "s1",
      injectedFactCount: 2,
      influencedFactCount: 1,
      influenceRate: 0.5,
      influencedSnippets: ["guard clauses to handle null"],
      avgJaccardScore: 0.4,
      timestamp: new Date().toISOString(),
    };
    recordMemoryDecisionInfluence(entry, dir);
    expect(existsSync(join(dir, ".danteforge", "memory-decision-log.json"))).toBe(true);
  });

  // 9. getMemoryInfluenceStats returns correct avgInfluenceRate
  it("getMemoryInfluenceStats returns correct avgInfluenceRate across entries", () => {
    const entries: MemoryDecisionEntry[] = [
      { sessionId: "s1", injectedFactCount: 4, influencedFactCount: 4, influenceRate: 1.0, influencedSnippets: [], avgJaccardScore: 0.5, timestamp: "" },
      { sessionId: "s2", injectedFactCount: 4, influencedFactCount: 2, influenceRate: 0.5, influencedSnippets: [], avgJaccardScore: 0.3, timestamp: "" },
      { sessionId: "s3", injectedFactCount: 4, influencedFactCount: 0, influenceRate: 0.0, influencedSnippets: [], avgJaccardScore: 0.0, timestamp: "" },
    ];
    const stats = getMemoryInfluenceStats(entries);
    expect(stats.avgInfluenceRate).toBeCloseTo(0.5, 5);
    expect(stats.sessionsWithInfluence).toBe(2);
    expect(stats.totalSessions).toBe(3);
  });
});
