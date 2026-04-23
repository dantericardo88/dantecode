// ============================================================================
// Sprint V — Dim 18: Review outcome tracking + review-history.json artifact
// Tests that:
//  - trackReviewOutcome writes entry to .danteforge/review-history.json
//  - entry contains reviewId, resolvedCount, totalComments, resolutionRate
//  - resolutionRate is correct (resolvedCount / totalComments)
//  - entry includes timestamp ISO string
//  - prTitle stored when provided
//  - zero totalComments yields resolutionRate=1 (100%)
//  - multiple calls append (JSONL format)
//  - returns the ReviewOutcomeEntry object directly
//  - entry persists across separate reads (not in-memory only)
//  - review-history.json created with correct directory structure
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { trackReviewOutcome, type ReviewOutcomeEntry } from "@dantecode/core";

function makeDir() {
  const dir = join(tmpdir(), `sprint-v-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("trackReviewOutcome — Sprint V (dim 18)", () => {
  // 1. Writes entry to review-history.json
  it("writes entry to .danteforge/review-history.json", () => {
    const root = makeDir();
    trackReviewOutcome("rev-001", 3, 5, undefined, root);
    const logPath = join(root, ".danteforge", "review-history.json");
    expect(existsSync(logPath)).toBe(true);
  });

  // 2. Entry has required fields
  it("entry contains reviewId, resolvedCount, totalComments, resolutionRate", () => {
    const root = makeDir();
    trackReviewOutcome("rev-002", 4, 8, undefined, root);
    const logPath = join(root, ".danteforge", "review-history.json");
    const entry = JSON.parse(readFileSync(logPath, "utf-8").trim()) as ReviewOutcomeEntry;
    expect(entry.reviewId).toBe("rev-002");
    expect(entry.resolvedCount).toBe(4);
    expect(entry.totalComments).toBe(8);
    expect(entry.resolutionRate).toBe(0.5);
  });

  // 3. resolutionRate = resolvedCount / totalComments
  it("computes resolutionRate correctly", () => {
    const root = makeDir();
    const result = trackReviewOutcome("rev-003", 3, 4, undefined, root);
    expect(result.resolutionRate).toBeCloseTo(0.75, 5);
  });

  // 4. Entry includes valid ISO timestamp
  it("entry contains valid ISO timestamp", () => {
    const root = makeDir();
    trackReviewOutcome("rev-004", 1, 1, undefined, root);
    const logPath = join(root, ".danteforge", "review-history.json");
    const entry = JSON.parse(readFileSync(logPath, "utf-8").trim()) as ReviewOutcomeEntry;
    expect(() => new Date(entry.timestamp)).not.toThrow();
    expect(new Date(entry.timestamp).getFullYear()).toBeGreaterThan(2024);
  });

  // 5. prTitle stored when provided
  it("stores prTitle when provided", () => {
    const root = makeDir();
    trackReviewOutcome("rev-005", 2, 3, "Add user auth flow", root);
    const logPath = join(root, ".danteforge", "review-history.json");
    const entry = JSON.parse(readFileSync(logPath, "utf-8").trim()) as ReviewOutcomeEntry;
    expect(entry.prTitle).toBe("Add user auth flow");
  });

  // 6. Zero totalComments → resolutionRate=1.0
  it("zero totalComments yields resolutionRate=1 (perfect by default)", () => {
    const root = makeDir();
    const result = trackReviewOutcome("rev-006", 0, 0, undefined, root);
    expect(result.resolutionRate).toBe(1);
  });

  // 7. Multiple calls append (JSONL format)
  it("appends entries across multiple calls", () => {
    const root = makeDir();
    trackReviewOutcome("rev-007a", 1, 2, undefined, root);
    trackReviewOutcome("rev-007b", 3, 4, undefined, root);
    const logPath = join(root, ".danteforge", "review-history.json");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    const ids = lines.map((l) => (JSON.parse(l) as ReviewOutcomeEntry).reviewId);
    expect(ids).toContain("rev-007a");
    expect(ids).toContain("rev-007b");
  });

  // 8. Returns the ReviewOutcomeEntry object
  it("returns ReviewOutcomeEntry object directly", () => {
    const root = makeDir();
    const result = trackReviewOutcome("rev-008", 5, 10, "Fix bug", root);
    expect(result.reviewId).toBe("rev-008");
    expect(result.resolvedCount).toBe(5);
    expect(result.prTitle).toBe("Fix bug");
    expect(typeof result.timestamp).toBe("string");
  });

  // 9. Creates .danteforge directory if missing
  it("creates .danteforge directory if it does not exist", () => {
    const root = makeDir();
    trackReviewOutcome("rev-009", 0, 1, undefined, root);
    expect(existsSync(join(root, ".danteforge"))).toBe(true);
  });

  // 10. Entry persists when file read again (not in-memory)
  it("entry persists on disk across separate reads", () => {
    const root = makeDir();
    trackReviewOutcome("rev-010", 7, 10, "Sprint V PR", root);
    const logPath = join(root, ".danteforge", "review-history.json");
    // Read file twice to confirm it's not ephemeral
    const first = readFileSync(logPath, "utf-8");
    const second = readFileSync(logPath, "utf-8");
    expect(first).toBe(second);
    const entry = JSON.parse(first.trim()) as ReviewOutcomeEntry;
    expect(entry.reviewId).toBe("rev-010");
  });
});
