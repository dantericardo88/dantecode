// packages/core/src/__tests__/sprint-bf-fim-ranker.test.ts
// Sprint BF — FIM candidate ranker tests (dim 1: 7 → 8.5)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scoreFimCandidate,
  rankFimCandidates,
  pickBestFimCandidate,
  recordFimRankingSession,
  loadFimRankingLog,
  getFimRankingStats,
} from "../fim-candidate-ranker.js";
import type {
  FimRankingContext,
  FimRankingSession,
} from "../fim-candidate-ranker.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const d = join(tmpdir(), `fim-bf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function makeCtx(overrides: Partial<FimRankingContext> = {}): FimRankingContext {
  return {
    prefix: "function hello() {\n  const x = 1;\n  ",
    suffix: "\n}",
    language: "typescript",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scoreFimCandidate tests
// ---------------------------------------------------------------------------

describe("scoreFimCandidate", () => {
  // Test 1: completeness bonus when candidate ends with newline
  it("gives completeness bonus when candidate ends with a newline", () => {
    const ctx = makeCtx();
    const withNewline = scoreFimCandidate("return x;\n", ctx);
    const withoutNewline = scoreFimCandidate("return x;", ctx);

    expect(withNewline.scoreBreakdown.completeness).toBeGreaterThan(
      withoutNewline.scoreBreakdown.completeness,
    );
    // Completeness with newline should be 0.25
    expect(withNewline.scoreBreakdown.completeness).toBeCloseTo(0.25);
  });

  // Test 2: penalizes very short candidates (< 5 chars)
  it("penalizes very short candidates (< 5 chars)", () => {
    const ctx = makeCtx();
    const short = scoreFimCandidate("x", ctx);
    const normal = scoreFimCandidate("return x + y + z;\n", ctx);

    expect(short.scoreBreakdown.lengthQuality).toBeLessThan(
      normal.scoreBreakdown.lengthQuality,
    );
    // Very short should have 0 length quality
    expect(short.scoreBreakdown.lengthQuality).toBe(0);
  });

  // Test 3: penalizes candidates that start with the exact last line of prefix
  it("penalizes candidates that repeat the last non-empty line of prefix", () => {
    const ctx = makeCtx({
      prefix: "function hello() {\n  const x = 1;\n  return x;",
    });
    // Last non-empty line is "  return x;" — trimmed = "return x;"
    const repetitive = scoreFimCandidate("return x;\n", ctx);
    const novel = scoreFimCandidate("console.log(x);\n", ctx);

    expect(repetitive.scoreBreakdown.noRepetition).toBeLessThan(
      novel.scoreBreakdown.noRepetition,
    );
    expect(repetitive.scoreBreakdown.noRepetition).toBe(0);
  });

  // Test 4: rewards candidates with low Jaccard overlap with prefix (novel tokens)
  it("rewards candidates with low Jaccard overlap with prefix (novelty)", () => {
    const ctx = makeCtx({
      prefix: "const alpha = 1;\nconst beta = 2;\nconst gamma = 3;\n",
    });
    // Highly overlapping with prefix
    const repetitive = scoreFimCandidate("const alpha = 1;\nconst beta = 2;\n", ctx);
    // Novel tokens not in prefix
    const novel = scoreFimCandidate("return zeta + eta + theta;\n", ctx);

    expect(novel.scoreBreakdown.novelty).toBeGreaterThan(
      repetitive.scoreBreakdown.novelty,
    );
  });

  // Test 5: checks indentation match
  it("rewards candidates that match expected indentation of last prefix line", () => {
    const ctx = makeCtx({
      prefix: "function foo() {\n  if (x) {\n    ",
    });
    // Correct indentation (4 spaces)
    const correctIndent = scoreFimCandidate("    return true;\n", ctx);
    // Wrong indentation (no spaces)
    const wrongIndent = scoreFimCandidate("return true;\n", ctx);

    expect(correctIndent.scoreBreakdown.indentMatch).toBeGreaterThanOrEqual(
      wrongIndent.scoreBreakdown.indentMatch,
    );
  });

  // Test 6: score is always in [0, 1] range for any input
  it("returns score in [0, 1] range for any input", () => {
    const ctx = makeCtx();
    const testCases = [
      "",
      "x",
      "return x;\n",
      "const very = long + string + that + goes + on + for + a + while + and + adds + more;\n",
      "{{{{{{{}}}}}}}",
      "  ".repeat(100),
    ];
    for (const text of testCases) {
      const candidate = scoreFimCandidate(text, ctx);
      expect(candidate.score).toBeGreaterThanOrEqual(0);
      expect(candidate.score).toBeLessThanOrEqual(1);
    }
  });

  // Test: syntactic balance rewards balanced braces
  it("rewards syntactically balanced candidates", () => {
    const ctx = makeCtx();
    const balanced = scoreFimCandidate("if (x) { return y; }\n", ctx);
    const unbalanced = scoreFimCandidate("if (x) { return y;\n", ctx);

    expect(balanced.scoreBreakdown.syntacticBalance).toBeGreaterThan(
      unbalanced.scoreBreakdown.syntacticBalance,
    );
  });

  // Test: scoreBreakdown has all expected keys
  it("returns scoreBreakdown with all required keys", () => {
    const ctx = makeCtx();
    const candidate = scoreFimCandidate("return x;\n", ctx);

    expect(candidate.scoreBreakdown).toHaveProperty("completeness");
    expect(candidate.scoreBreakdown).toHaveProperty("lengthQuality");
    expect(candidate.scoreBreakdown).toHaveProperty("novelty");
    expect(candidate.scoreBreakdown).toHaveProperty("indentMatch");
    expect(candidate.scoreBreakdown).toHaveProperty("noRepetition");
    expect(candidate.scoreBreakdown).toHaveProperty("syntacticBalance");
  });

  // Test: 20-200 char range gets full length quality
  it("gives full lengthQuality to candidates in 20-200 char range", () => {
    const ctx = makeCtx();
    const ideal = scoreFimCandidate("return someVariable + anotherVariable;\n", ctx);
    expect(ideal.scoreBreakdown.lengthQuality).toBeCloseTo(0.20);
  });
});

// ---------------------------------------------------------------------------
// rankFimCandidates tests
// ---------------------------------------------------------------------------

describe("rankFimCandidates", () => {
  // Test 7: returns sorted descending by score
  it("returns candidates sorted descending by score", () => {
    const ctx = makeCtx();
    const candidates = [
      "x",                               // very short — low score
      "return result + delta;\n",        // decent — medium score
      "return computedValue;\n",         // good — high score
    ];
    const ranked = rankFimCandidates(candidates, ctx);

    expect(ranked.length).toBeGreaterThan(0);
    for (let i = 0; i < ranked.length - 1; i++) {
      expect(ranked[i]!.score).toBeGreaterThanOrEqual(ranked[i + 1]!.score);
    }
  });

  // Test 8: deduplicates candidates with identical trimmed text
  it("deduplicates candidates with identical trimmed text", () => {
    const ctx = makeCtx();
    const candidates = [
      "return x;\n",
      "return x;\n",   // duplicate
      "return x;",     // same trimmed content
      "return y;\n",
    ];
    const ranked = rankFimCandidates(candidates, ctx);
    // "return x;\n" and "return x;" both trim to "return x;" — only one should appear
    const returnXCount = ranked.filter((c) => c.text.trim() === "return x;").length;
    expect(returnXCount).toBe(1);
  });

  // Test 9: returns empty array for empty input
  it("returns empty array for empty input", () => {
    const ctx = makeCtx();
    const ranked = rankFimCandidates([], ctx);
    expect(Array.isArray(ranked)).toBe(true);
    expect(ranked.length).toBe(0);
  });

  // Test: all returned items are FimCandidate objects
  it("all returned items are valid FimCandidate objects", () => {
    const ctx = makeCtx();
    const ranked = rankFimCandidates(["return x;\n", "const y = 42;\n"], ctx);
    for (const c of ranked) {
      expect(c).toHaveProperty("text");
      expect(c).toHaveProperty("score");
      expect(c).toHaveProperty("scoreBreakdown");
      expect(typeof c.score).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// pickBestFimCandidate tests
// ---------------------------------------------------------------------------

describe("pickBestFimCandidate", () => {
  // Test 10: returns null for empty array
  it("returns null for empty array", () => {
    const ctx = makeCtx();
    expect(pickBestFimCandidate([], ctx)).toBeNull();
  });

  // Test 11: returns the top-ranked candidate text
  it("returns the text of the top-ranked candidate", () => {
    const ctx = makeCtx();
    // A well-formed complete line should beat a very short one
    const candidates = ["x", "return computedResult + delta;\n"];
    const best = pickBestFimCandidate(candidates, ctx);
    expect(typeof best).toBe("string");
    expect(candidates).toContain(best);
    // Best should be the longer, complete-line candidate
    expect(best).toBe("return computedResult + delta;\n");
  });

  // Test: single candidate returns that candidate
  it("returns the single candidate when only one is provided", () => {
    const ctx = makeCtx();
    const result = pickBestFimCandidate(["return x;\n"], ctx);
    expect(result).toBe("return x;\n");
  });
});

// ---------------------------------------------------------------------------
// recordFimRankingSession and loadFimRankingLog tests
// ---------------------------------------------------------------------------

describe("recordFimRankingSession", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = makeTmpDir();
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  // Test 12: creates .danteforge/fim-ranking-log.json
  it("creates .danteforge/fim-ranking-log.json in project root", () => {
    recordFimRankingSession(
      {
        language: "typescript",
        candidateCount: 3,
        topScore: 0.85,
        bottomScore: 0.40,
        scoreRange: 0.45,
      },
      testRoot,
    );

    const logPath = join(testRoot, ".danteforge/fim-ranking-log.json");
    const raw = readFileSync(logPath, "utf-8");
    expect(raw.trim().length).toBeGreaterThan(0);

    const parsed = JSON.parse(raw.trim()) as FimRankingSession;
    expect(parsed.language).toBe("typescript");
    expect(parsed.candidateCount).toBe(3);
    expect(parsed.topScore).toBeCloseTo(0.85);
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("appends multiple sessions as JSONL", () => {
    for (let i = 0; i < 3; i++) {
      recordFimRankingSession(
        {
          language: "python",
          candidateCount: i + 1,
          topScore: 0.7 + i * 0.05,
          bottomScore: 0.3,
          scoreRange: 0.4 + i * 0.05,
        },
        testRoot,
      );
    }

    const logPath = join(testRoot, ".danteforge/fim-ranking-log.json");
    const raw = readFileSync(logPath, "utf-8");
    const lines = raw.trim().split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(3);
  });

  it("loadFimRankingLog returns empty array when file does not exist", () => {
    const logs = loadFimRankingLog(testRoot);
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBe(0);
  });

  it("loadFimRankingLog parses sessions written by recordFimRankingSession", () => {
    recordFimRankingSession(
      { language: "rust", candidateCount: 5, topScore: 0.9, bottomScore: 0.3, scoreRange: 0.6 },
      testRoot,
    );
    recordFimRankingSession(
      { language: "go", candidateCount: 2, topScore: 0.7, bottomScore: 0.5, scoreRange: 0.2 },
      testRoot,
    );

    const logs = loadFimRankingLog(testRoot);
    expect(logs.length).toBe(2);
    expect(logs[0]!.language).toBe("rust");
    expect(logs[1]!.language).toBe("go");
  });
});

// ---------------------------------------------------------------------------
// getFimRankingStats tests
// ---------------------------------------------------------------------------

describe("getFimRankingStats", () => {
  // Test 13: returns correct avgTopScore from seeded data
  it("returns correct avgTopScore from seeded data", () => {
    const sessions: FimRankingSession[] = [
      { language: "ts", candidateCount: 3, topScore: 0.8, bottomScore: 0.4, scoreRange: 0.4, timestamp: "2026-04-21T10:00:00.000Z" },
      { language: "ts", candidateCount: 2, topScore: 0.6, bottomScore: 0.3, scoreRange: 0.3, timestamp: "2026-04-21T10:05:00.000Z" },
      { language: "ts", candidateCount: 4, topScore: 1.0, bottomScore: 0.5, scoreRange: 0.5, timestamp: "2026-04-21T10:10:00.000Z" },
    ];
    const stats = getFimRankingStats(sessions);
    // avgTopScore = (0.8 + 0.6 + 1.0) / 3 = 0.8
    expect(stats.avgTopScore).toBeCloseTo(0.8);
  });

  it("returns correct avgScoreRange", () => {
    const sessions: FimRankingSession[] = [
      { language: "py", candidateCount: 3, topScore: 0.9, bottomScore: 0.5, scoreRange: 0.4, timestamp: "" },
      { language: "py", candidateCount: 3, topScore: 0.7, bottomScore: 0.5, scoreRange: 0.2, timestamp: "" },
    ];
    const stats = getFimRankingStats(sessions);
    // avgScoreRange = (0.4 + 0.2) / 2 = 0.3
    expect(stats.avgScoreRange).toBeCloseTo(0.3);
  });

  it("returns correct avgCandidateCount", () => {
    const sessions: FimRankingSession[] = [
      { language: "ts", candidateCount: 2, topScore: 0.8, bottomScore: 0.4, scoreRange: 0.4, timestamp: "" },
      { language: "ts", candidateCount: 4, topScore: 0.8, bottomScore: 0.4, scoreRange: 0.4, timestamp: "" },
      { language: "ts", candidateCount: 6, topScore: 0.8, bottomScore: 0.4, scoreRange: 0.4, timestamp: "" },
    ];
    const stats = getFimRankingStats(sessions);
    expect(stats.avgCandidateCount).toBeCloseTo(4);
  });

  it("returns zero stats for empty sessions array", () => {
    const stats = getFimRankingStats([]);
    expect(stats.avgTopScore).toBe(0);
    expect(stats.avgScoreRange).toBe(0);
    expect(stats.avgCandidateCount).toBe(0);
  });
});
