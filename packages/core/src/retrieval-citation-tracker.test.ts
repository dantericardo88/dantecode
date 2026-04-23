// Sprint BK — Dim 2: Retrieval citation tracker — Jaccard upgrade tests
import { describe, it, expect, beforeEach } from "vitest";
import {
  beginRetrievalSession,
  bufferRetrievedFact,
  computeCitationScore,
  jaccardSimilarity,
} from "./retrieval-citation-tracker.js";

describe("jaccardSimilarity (exported utility)", () => {
  it("returns 1.0 for identical token arrays", () => {
    const tokens = ["hello", "world", "typescript"];
    expect(jaccardSimilarity(tokens, tokens)).toBe(1);
  });

  it("returns 0.0 for completely disjoint token arrays", () => {
    const a = ["apple", "banana", "cherry"];
    const b = ["dog", "elephant", "frog"];
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("returns correct partial overlap score", () => {
    const a = ["hello", "world", "foo"];
    const b = ["hello", "world", "bar"];
    // intersection = {hello, world} = 2, union = {hello, world, foo, bar} = 4 → 0.5
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5);
  });

  it("handles empty arrays — returns 0", () => {
    expect(jaccardSimilarity([], [])).toBe(0);
    expect(jaccardSimilarity(["hello"], [])).toBe(0);
    expect(jaccardSimilarity([], ["hello"])).toBe(0);
  });

  it("handles duplicate tokens in arrays (treats as sets)", () => {
    // Jaccard uses sets so duplicates don't inflate the score
    const a = ["foo", "foo", "bar"];
    const b = ["foo", "bar", "baz"];
    // union set = {foo, bar, baz} = 3, intersection set = {foo, bar} = 2
    expect(jaccardSimilarity(a, b)).toBeCloseTo(2 / 3);
  });
});

describe("computeCitationScore — Jaccard-based citation", () => {
  const sessionId = "test-session-bk";

  beforeEach(() => {
    beginRetrievalSession(sessionId);
  });

  it("cites a fact with high token overlap >= 0.25", () => {
    bufferRetrievedFact(sessionId, "fact1", "the quick brown fox jumps over the lazy dog", "source");
    const result = computeCitationScore(sessionId, [
      "The quick brown fox jumped over the lazy dog yesterday.",
    ]);
    expect(result.totalCited).toBe(1);
    expect(result.citationRate).toBeCloseTo(1);
    expect(result.matchConfidence).toBeGreaterThan(0);
  });

  it("does not cite a fact with no token overlap", () => {
    const sid = "test-session-bk-2";
    beginRetrievalSession(sid);
    bufferRetrievedFact(sid, "fact2", "neural network gradient descent backpropagation", "source");
    const result = computeCitationScore(sid, [
      "The weather today is sunny and warm outside.",
    ]);
    expect(result.totalCited).toBe(0);
    expect(result.citationRate).toBe(0);
    expect(result.matchConfidence).toBe(0);
  });

  it("matchConfidence reflects avg Jaccard of cited facts", () => {
    const sid = "test-session-bk-3";
    beginRetrievalSession(sid);
    bufferRetrievedFact(sid, "f1", "useEffect react component lifecycle hook", "src");
    bufferRetrievedFact(sid, "f2", "useState react hook state management", "src");
    const result = computeCitationScore(sid, [
      "In React, useEffect and useState are hooks for managing component state and lifecycle.",
    ]);
    expect(result.matchConfidence).toBeGreaterThan(0);
    expect(result.totalCited).toBeGreaterThanOrEqual(1);
  });

  it("isHighConfidence is true when citationRate >= 0.4 and matchConfidence >= 0.25", () => {
    const sid = "test-session-bk-4";
    beginRetrievalSession(sid);
    bufferRetrievedFact(sid, "f1", "typescript interface generic type parameter constraint", "src");
    const result = computeCitationScore(sid, [
      "TypeScript interface generic type parameter constraint allows type-safe abstractions.",
    ]);
    // High overlap → should trigger isHighConfidence
    if (result.citationRate >= 0.4 && result.matchConfidence >= 0.25) {
      expect(result.isHighConfidence).toBe(true);
    } else {
      expect(result.isHighConfidence).toBe(false);
    }
  });

  it("isHighConfidence is false when matchConfidence is low", () => {
    const sid = "test-session-bk-5";
    beginRetrievalSession(sid);
    bufferRetrievedFact(sid, "f1", "irrelevant zebra mountain", "src");
    const result = computeCitationScore(sid, [
      "The cat sat on the mat.",
    ]);
    expect(result.isHighConfidence).toBe(false);
  });

  it("handles session with zero facts", () => {
    const sid = "test-session-bk-empty";
    beginRetrievalSession(sid);
    const result = computeCitationScore(sid, ["anything"]);
    expect(result.totalRetrieved).toBe(0);
    expect(result.totalCited).toBe(0);
    expect(result.citationRate).toBe(0);
    expect(result.matchConfidence).toBe(0);
    expect(result.isHighConfidence).toBe(false);
  });
});
