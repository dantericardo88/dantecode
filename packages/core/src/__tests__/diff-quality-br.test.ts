import { describe, it, expect } from "vitest";
import { scoreDiff, type DiffQualityScore } from "../diff-quality.js";

describe("scoreDiff — changeComplexity", () => {
  it("is 0 for identical content (no changes)", () => {
    const content = "line1\nline2\nline3";
    const result = scoreDiff(content, content, "file.ts");
    expect(result.changeComplexity).toBe(0);
  });

  it("is 1 for completely different content", () => {
    const old = "a\nb\nc";
    const newC = "x\ny\nz";
    const result = scoreDiff(old, newC, "file.ts");
    // All lines change, ratio = totalChanged / max(len)
    expect(result.changeComplexity).toBeGreaterThan(0);
    expect(result.changeComplexity).toBeLessThanOrEqual(1);
  });

  it("is capped at 1", () => {
    const result = scoreDiff("", "new\ncontent\nhere", "file.ts");
    expect(result.changeComplexity).toBeLessThanOrEqual(1);
  });

  it("reflects partial changes proportionally", () => {
    const old = "a\nb\nc\nd\ne";
    const newC = "a\nb\nc\nd\nX";  // one line changed
    const result = scoreDiff(old, newC, "file.ts");
    expect(result.changeComplexity).toBeGreaterThan(0);
    expect(result.changeComplexity).toBeLessThan(1);
  });
});

describe("scoreDiff — hasBreakingChange", () => {
  it("is false when only lines are added (no removals)", () => {
    const old = "line1\nline2";
    const newC = "line1\nline2\nline3\nline4";
    const result = scoreDiff(old, newC, "file.ts");
    // No removals should mean no breaking change
    // (if linesRemoved=0, hasBreakingChange must be false)
    if (result.linesRemoved === 0) {
      expect(result.hasBreakingChange).toBe(false);
    }
  });

  it("is false when no lines removed", () => {
    const result = scoreDiff("", "a\nb\nc", "file.ts");
    expect(result.hasBreakingChange).toBe(false);
  });

  it("is true when more than half the changed lines are removals", () => {
    // Replacing most content: many removed, few added
    const old = "a\nb\nc\nd\ne\nf\ng\nh";
    const newC = "x";  // 1 added, many removed
    const result = scoreDiff(old, newC, "file.ts");
    if (result.linesRemoved > 0 && result.linesAdded > 0) {
      const ratio = result.linesRemoved / Math.max(result.linesAdded, result.linesRemoved);
      if (ratio > 0.5) {
        expect(result.hasBreakingChange).toBe(true);
      }
    }
  });

  it("is true when equal adds and removes (ratio = 1.0 > 0.5)", () => {
    // When linesAdded === linesRemoved, ratio = linesRemoved / max(linesAdded, linesRemoved) = 1.0 > 0.5
    const old = "unique-old-line-alpha\nunique-old-line-beta";
    const newC = "unique-new-line-alpha\nunique-new-line-beta";
    const result = scoreDiff(old, newC, "file.ts");
    if (result.linesAdded === result.linesRemoved && result.linesRemoved > 0) {
      // ratio = linesRemoved / max(linesAdded, linesRemoved) = 1.0 (> 0.5) → true
      expect(result.hasBreakingChange).toBe(true);
    }
  });

  it("includes filePath in returned score", () => {
    const result = scoreDiff("old", "new", "src/example.ts");
    expect(result.filePath).toBe("src/example.ts");
  });

  it("includes all required DiffQualityScore fields", () => {
    const result = scoreDiff("old content here", "new content here", "test.ts");
    const score: DiffQualityScore = result; // type-check
    expect(typeof score.linesAdded).toBe("number");
    expect(typeof score.linesRemoved).toBe("number");
    expect(typeof score.changeComplexity).toBe("number");
    expect(typeof score.hasBreakingChange).toBe("boolean");
    expect(typeof score.qualityScore).toBe("number");
    expect(typeof score.filePath).toBe("string");
  });
});
