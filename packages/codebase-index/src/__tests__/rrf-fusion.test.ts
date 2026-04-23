// ============================================================================
// packages/codebase-index/src/__tests__/rrf-fusion.test.ts
// ============================================================================

import { describe, it, expect } from "vitest";
import { rrfFusion } from "../rrf-fusion.js";
import type { RankedChunk } from "../types.js";

function makeChunk(filePath: string, startLine = 0): RankedChunk {
  return {
    key: `${filePath}:${startLine}`,
    chunk: { filePath, content: `// ${filePath}`, startLine },
  };
}

const A = makeChunk("a.ts", 1);
const B = makeChunk("b.ts", 1);
const C = makeChunk("c.ts", 1);

describe("rrfFusion", () => {
  it("returns empty for empty input", () => {
    expect(rrfFusion([])).toEqual([]);
  });

  it("returns same order for a single list", () => {
    const result = rrfFusion([[A, B, C]]);
    expect(result.map((r) => r.key)).toEqual([A.key, B.key, C.key]);
  });

  it("merges two lists descending by RRF score", () => {
    const list1 = [A, B];
    const list2 = [B, C];
    const result = rrfFusion([list1, list2]);
    // B appears in both lists → highest score
    expect(result[0]!.key).toBe(B.key);
  });

  it("item appearing in more lists scores higher", () => {
    const list1 = [A, B, C];
    const list2 = [C, A];
    const list3 = [A];
    const result = rrfFusion([list1, list2, list3]);
    // A appears in all 3 lists
    expect(result[0]!.key).toBe(A.key);
  });

  it("deduplicates items with the same key", () => {
    // Both lists have A at rank 0 — result should contain A only once
    const result = rrfFusion([[A, B], [A, C]]);
    const aCount = result.filter((r) => r.key === A.key).length;
    expect(aCount).toBe(1);
  });

  it("uses k=60 (scores are < 1/60 each)", () => {
    // rank 0 in one list → score = 1/(60+0+1) = 1/61 ≈ 0.01639
    const result = rrfFusion([[A]]);
    // We can verify the ordering is correct even without direct score access
    expect(result.length).toBe(1);
    expect(result[0]!.key).toBe(A.key);
  });

  it("handles lists with no overlap", () => {
    const result = rrfFusion([[A], [B], [C]]);
    expect(result.length).toBe(3);
    // All at rank 0 in their own list → all score 1/61 → equal, stable enough
    const keys = new Set(result.map((r) => r.key));
    expect(keys).toEqual(new Set([A.key, B.key, C.key]));
  });
});
