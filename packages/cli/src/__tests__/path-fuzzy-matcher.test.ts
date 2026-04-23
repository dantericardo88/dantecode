// packages/cli/src/__tests__/path-fuzzy-matcher.test.ts
// Sprint 38 — Dim 24: File path anti-confabulation (Reliability)
// Tests: scorePathMatch, fuzzyMatchFilePath, formatSuggestions

import { describe, it, expect, vi } from "vitest";
import {
  scorePathMatch,
  fuzzyMatchFilePath,
  formatSuggestions,
  type FuzzyMatchResult,
} from "../path-fuzzy-matcher.js";

// ─── scorePathMatch ───────────────────────────────────────────────────────────

describe("scorePathMatch", () => {
  it("exact basename match scores higher than fuzzy", () => {
    const exactScore = scorePathMatch("src/auth.ts", "src/auth.ts");
    const fuzzyScore = scorePathMatch("src/auth.ts", "src/authentication.ts");
    expect(exactScore).toBeGreaterThan(fuzzyScore);
  });

  it("exact basename match gives maximum basename score (50+)", () => {
    const score = scorePathMatch("packages/cli/src/auth.ts", "packages/cli/src/auth.ts");
    expect(score).toBeGreaterThanOrEqual(50);
  });

  it("completely different files score very low", () => {
    const score = scorePathMatch("src/auth.ts", "packages/vscode/src/completions.ts");
    expect(score).toBeLessThan(30);
  });

  it("matching directory components increases score", () => {
    const sharedDirScore = scorePathMatch("src/api/auth.ts", "src/api/user.ts");
    const noSharedDirScore = scorePathMatch("src/api/auth.ts", "lib/utils/helper.ts");
    expect(sharedDirScore).toBeGreaterThan(noSharedDirScore);
  });

  it("returns a non-negative score", () => {
    const score = scorePathMatch("totally/different/path.ts", "another/file.py");
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ─── fuzzyMatchFilePath ───────────────────────────────────────────────────────

describe("fuzzyMatchFilePath", () => {
  function makeGlob(files: string[]) {
    return vi.fn().mockResolvedValue(files);
  }

  it("returns empty array when scan finds no candidates", async () => {
    const results = await fuzzyMatchFilePath("src/auth.ts", "/project", 3, makeGlob([]));
    expect(results).toEqual([]);
  });

  it("returns top match for an exact filename with wrong directory", async () => {
    const candidates = [
      "packages/cli/src/auth.ts",
      "packages/core/src/config.ts",
      "src/utils.ts",
    ];
    const results = await fuzzyMatchFilePath("src/auth.ts", "/project", 3, makeGlob(candidates));
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toContain("auth.ts");
  });

  it("respects topN limit", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => `src/auth-${i}.ts`);
    const results = await fuzzyMatchFilePath("src/auth.ts", "/project", 2, makeGlob(candidates));
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("results are sorted by score descending", async () => {
    const candidates = ["src/auth.ts", "packages/core/src/auth.ts", "lib/totally-different.py"];
    const results = await fuzzyMatchFilePath("src/auth.ts", "/project", 3, makeGlob(candidates));
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it("result objects have path and score fields", async () => {
    const candidates = ["src/auth.ts"];
    const results = await fuzzyMatchFilePath("src/auth.ts", "/project", 3, makeGlob(candidates));
    if (results.length > 0) {
      expect(results[0]).toHaveProperty("path");
      expect(results[0]).toHaveProperty("score");
    }
  });

  it("filters out low-scoring candidates (score < 20)", async () => {
    // A very different filename should not appear
    const candidates = ["completely_different_name.xyz"];
    const results = await fuzzyMatchFilePath("src/auth.ts", "/project", 3, makeGlob(candidates));
    // score will be low — either empty or very few results
    const allAboveThreshold = results.every((r) => r.score >= 20);
    expect(allAboveThreshold).toBe(true);
  });
});

// ─── formatSuggestions ────────────────────────────────────────────────────────

describe("formatSuggestions", () => {
  it("returns empty string for empty matches", () => {
    expect(formatSuggestions([])).toBe("");
  });

  it("includes 'Did you mean' text for non-empty matches", () => {
    const matches: FuzzyMatchResult[] = [{ path: "src/auth.ts", score: 60 }];
    expect(formatSuggestions(matches)).toContain("Did you mean");
  });

  it("includes each match path in the output", () => {
    const matches: FuzzyMatchResult[] = [
      { path: "src/auth.ts", score: 60 },
      { path: "packages/core/src/auth.ts", score: 50 },
    ];
    const output = formatSuggestions(matches);
    expect(output).toContain("src/auth.ts");
    expect(output).toContain("packages/core/src/auth.ts");
  });

  it("each match is on its own bullet line", () => {
    const matches: FuzzyMatchResult[] = [
      { path: "src/foo.ts", score: 60 },
      { path: "src/bar.ts", score: 50 },
    ];
    const output = formatSuggestions(matches);
    expect(output.split("•").length - 1).toBe(2);
  });
});
