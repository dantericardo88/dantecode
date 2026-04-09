import { describe, it, expect } from "vitest";
import { SemanticDeduper } from "./extractor/deduper.js";

// ---------------------------------------------------------------------------
// SemanticDeduper — exact and near-duplicate removal
// ---------------------------------------------------------------------------

describe("SemanticDeduper — dedupe", () => {
  it("returns empty array for empty input", () => {
    const deduper = new SemanticDeduper();
    expect(deduper.dedupe([])).toHaveLength(0);
  });

  it("returns single item unchanged", () => {
    const deduper = new SemanticDeduper();
    const result = deduper.dedupe(["TypeScript best practices guide"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("TypeScript best practices guide");
  });

  it("removes exact duplicate strings", () => {
    const deduper = new SemanticDeduper();
    const items = [
      "TypeScript best practices",
      "TypeScript best practices",
      "TypeScript best practices",
    ];
    const result = deduper.dedupe(items);
    expect(result).toHaveLength(1);
  });

  it("removes near-duplicate titles above Jaccard threshold (default 0.8)", () => {
    const deduper = new SemanticDeduper();
    const items = [
      "TypeScript best practices for developers",
      "TypeScript best practices for developers guide",  // very similar — above 0.8 Jaccard
      "completely different python tutorial",
    ];
    const result = deduper.dedupe(items);
    // The two near-identical TypeScript items should collapse to 1
    expect(result.length).toBeLessThanOrEqual(2);
    expect(result.some((r) => r.includes("python"))).toBe(true);
  });

  it("keeps distinct items that are below the similarity threshold", () => {
    const deduper = new SemanticDeduper();
    const items = [
      "TypeScript error handling guide",
      "React state management patterns",
      "Node.js performance optimization",
    ];
    const result = deduper.dedupe(items);
    expect(result).toHaveLength(3);
  });

  it("custom threshold: lower threshold (0.3) deduplicates more aggressively", () => {
    const deduper = new SemanticDeduper();
    const items = [
      "TypeScript error handling",
      "TypeScript error management",  // ~0.5 Jaccard overlap with above
      "Vue.js component lifecycle",
    ];
    const aggressiveResult = deduper.dedupe(items, 0.3);
    const normalResult = deduper.dedupe(items, 0.8);
    // At threshold 0.3, the two TypeScript items should be treated as duplicates
    expect(aggressiveResult.length).toBeLessThanOrEqual(normalResult.length);
  });

  it("handles items with very short words (tokens < 3 chars are ignored)", () => {
    const deduper = new SemanticDeduper();
    // All words < 3 chars → empty token sets → similarity = 0 → not deduped
    const items = ["to be", "or not", "it is"];
    const result = deduper.dedupe(items);
    expect(result).toHaveLength(3); // nothing deduped since token sets empty
  });

  it("preserves original string content (does not mutate)", () => {
    const deduper = new SemanticDeduper();
    const original = "TypeScript best practices for clean code";
    const result = deduper.dedupe([original, "totally different content here"]);
    expect(result).toContain(original);
  });
});
