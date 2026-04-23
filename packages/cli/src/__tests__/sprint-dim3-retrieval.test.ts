// ============================================================================
// Sprint Dim 3: retrieval relevance eval + task-outcome impact
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateRetrievalRelevance,
  loadRetrievalRelevanceLog,
  getRetrievalQualityStats,
  getRetrievalImpactOnCompletion,
  recordRetrievalImpact,
} from "@dantecode/core";
import { expandQuery } from "@dantecode/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dim3-test-"));
  mkdirSync(join(tmpDir, ".danteforge"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── evaluateRetrievalRelevance ────────────────────────────────────────────────

describe("evaluateRetrievalRelevance", () => {
  it("returns relevanceScore=1.0 for COMPLETED with results present", () => {
    const entry = evaluateRetrievalRelevance(
      "fix authentication bug",
      [{ filePath: "src/auth.ts", snippet: "export function authenticate(token: string)" }],
      "COMPLETED",
      tmpDir,
    );
    expect(entry.relevanceScore).toBe(1.0);
    expect(entry.taskOutcome).toBe("COMPLETED");
    expect(entry.resultCount).toBe(1);
  });

  it("returns relevanceScore=0 for FAILED regardless of results", () => {
    const entry = evaluateRetrievalRelevance(
      "fix everything",
      [{ filePath: "src/index.ts", snippet: "import { fix } from './utils'" }],
      "FAILED",
      tmpDir,
    );
    expect(entry.relevanceScore).toBe(0);
  });

  it("returns relevanceScore=0.5 for ATTEMPTED with results", () => {
    const entry = evaluateRetrievalRelevance(
      "refactor the database layer",
      [{ filePath: "src/db.ts", snippet: "const db = new Database()" }],
      "ATTEMPTED",
      tmpDir,
    );
    expect(entry.relevanceScore).toBe(0.5);
  });

  it("returns relevanceScore=0 for COMPLETED with NO results", () => {
    const entry = evaluateRetrievalRelevance("some query", [], "COMPLETED", tmpDir);
    expect(entry.relevanceScore).toBe(0);
  });

  it("computes non-zero tokenOverlap when query and snippet share tokens", () => {
    const entry = evaluateRetrievalRelevance(
      "authentication token function",
      [{ filePath: "src/auth.ts", snippet: "function authenticate(token: string)" }],
      "COMPLETED",
      tmpDir,
    );
    expect(entry.tokenOverlap).toBeGreaterThan(0);
  });

  it("writes .danteforge/retrieval-relevance-log.jsonl", () => {
    evaluateRetrievalRelevance("query", [], "COMPLETED", tmpDir);
    expect(existsSync(join(tmpDir, ".danteforge", "retrieval-relevance-log.jsonl"))).toBe(true);
  });

  it("appends multiple entries to the JSONL log", () => {
    evaluateRetrievalRelevance("query 1", [], "COMPLETED", tmpDir);
    evaluateRetrievalRelevance("query 2", [], "FAILED", tmpDir);
    const entries = loadRetrievalRelevanceLog(tmpDir);
    expect(entries).toHaveLength(2);
  });
});

// ── loadRetrievalRelevanceLog ─────────────────────────────────────────────────

describe("loadRetrievalRelevanceLog", () => {
  it("reads back entries from seeded JSONL", () => {
    const lines = [
      JSON.stringify({ query: "q1", resultCount: 2, tokenOverlap: 0.3, relevanceScore: 1.0, taskOutcome: "COMPLETED", timestamp: "" }),
      JSON.stringify({ query: "q2", resultCount: 0, tokenOverlap: 0.0, relevanceScore: 0.0, taskOutcome: "FAILED", timestamp: "" }),
    ];
    writeFileSync(join(tmpDir, ".danteforge", "retrieval-relevance-log.jsonl"), lines.join("\n") + "\n");
    const entries = loadRetrievalRelevanceLog(tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.query).toBe("q1");
    expect(entries[1]!.taskOutcome).toBe("FAILED");
  });

  it("returns empty array when log file does not exist", () => {
    expect(loadRetrievalRelevanceLog(tmpDir)).toEqual([]);
  });
});

// ── getRetrievalQualityStats ──────────────────────────────────────────────────

describe("getRetrievalQualityStats", () => {
  it("returns correct avgRelevanceScore from seeded entries", () => {
    const entries = [
      { query: "q", resultCount: 1, tokenOverlap: 0.3, relevanceScore: 1.0, taskOutcome: "COMPLETED" as const, timestamp: "" },
      { query: "q", resultCount: 1, tokenOverlap: 0.0, relevanceScore: 0.5, taskOutcome: "ATTEMPTED" as const, timestamp: "" },
      { query: "q", resultCount: 1, tokenOverlap: 0.0, relevanceScore: 0.0, taskOutcome: "FAILED" as const, timestamp: "" },
    ];
    const stats = getRetrievalQualityStats(entries);
    // avg = (1.0 + 0.5 + 0.0) / 3 = 0.5
    expect(stats.avgRelevanceScore).toBeCloseTo(0.5, 2);
    expect(stats.totalEvals).toBe(3);
  });

  it("returns correct improvedTaskRate — COMPLETED with tokenOverlap > 0.1", () => {
    const entries = [
      { query: "q", resultCount: 1, tokenOverlap: 0.25, relevanceScore: 1.0, taskOutcome: "COMPLETED" as const, timestamp: "" },
      { query: "q", resultCount: 1, tokenOverlap: 0.05, relevanceScore: 1.0, taskOutcome: "COMPLETED" as const, timestamp: "" }, // overlap too low
      { query: "q", resultCount: 1, tokenOverlap: 0.20, relevanceScore: 0.5, taskOutcome: "ATTEMPTED" as const, timestamp: "" }, // not COMPLETED
    ];
    const stats = getRetrievalQualityStats(entries);
    // Only first entry qualifies: 1/3
    expect(stats.improvedTaskRate).toBeCloseTo(1 / 3, 2);
  });

  it("handles empty entries gracefully", () => {
    const stats = getRetrievalQualityStats([]);
    expect(stats.totalEvals).toBe(0);
    expect(stats.avgRelevanceScore).toBe(0);
    expect(stats.improvedTaskRate).toBe(0);
  });
});

// ── getRetrievalImpactOnCompletion + recordRetrievalImpact ────────────────────

describe("getRetrievalImpactOnCompletion", () => {
  function seedLog(entries: Array<{ tokenOverlap: number; taskOutcome: string }>) {
    const lines = entries.map((e) =>
      JSON.stringify({
        query: "q",
        resultCount: 1,
        tokenOverlap: e.tokenOverlap,
        relevanceScore: e.taskOutcome === "COMPLETED" ? 1.0 : 0,
        taskOutcome: e.taskOutcome,
        timestamp: new Date().toISOString(),
      }),
    );
    writeFileSync(join(tmpDir, ".danteforge", "retrieval-relevance-log.jsonl"), lines.join("\n") + "\n");
  }

  it("returns isSignificant=true when delta > 0.15", () => {
    seedLog([
      { tokenOverlap: 0.3, taskOutcome: "COMPLETED" },
      { tokenOverlap: 0.25, taskOutcome: "COMPLETED" },
      { tokenOverlap: 0.02, taskOutcome: "FAILED" },
      { tokenOverlap: 0.05, taskOutcome: "FAILED" },
    ]);
    const report = getRetrievalImpactOnCompletion(tmpDir);
    // withContext (>0.1): 2 COMPLETED / 2 = 1.0
    // withoutContext (<=0.1): 0 COMPLETED / 2 = 0.0
    // delta = 1.0 > 0.15
    expect(report.isSignificant).toBe(true);
    expect(report.delta).toBeGreaterThan(0.15);
  });

  it("returns isSignificant=false when delta <= 0.15", () => {
    seedLog([
      { tokenOverlap: 0.3, taskOutcome: "COMPLETED" },
      { tokenOverlap: 0.05, taskOutcome: "COMPLETED" },
    ]);
    const report = getRetrievalImpactOnCompletion(tmpDir);
    // both COMPLETED: withContext=1.0, withoutContext=1.0, delta=0
    expect(report.delta).toBe(0);
    expect(report.isSignificant).toBe(false);
  });

  it("writes .danteforge/retrieval-impact-report.json", () => {
    seedLog([{ tokenOverlap: 0.2, taskOutcome: "COMPLETED" }]);
    getRetrievalImpactOnCompletion(tmpDir);
    expect(existsSync(join(tmpDir, ".danteforge", "retrieval-impact-report.json"))).toBe(true);
  });
});

describe("recordRetrievalImpact", () => {
  it("writes retrieval-impact-report.json with expected fields", () => {
    const report = {
      withContextRate: 0.8,
      withoutContextRate: 0.4,
      delta: 0.4,
      isSignificant: true,
      computedAt: new Date().toISOString(),
    };
    recordRetrievalImpact(report, tmpDir);
    expect(existsSync(join(tmpDir, ".danteforge", "retrieval-impact-report.json"))).toBe(true);
  });
});

// ── expandQuery (already in search-query-expander) ───────────────────────────

describe("expandQuery", () => {
  it("returns allTerms containing camelCase expansion of multi-word query", () => {
    // "create user session" → tokens: ["create", "user", "session"]
    // camelCase: "createUserSession"
    const result = expandQuery("create user session");
    expect(result.allTerms).toContain("createUserSession");
    expect(result.tokens).toContain("user");
    expect(result.tokens).toContain("session");
  });

  it("includes original tokens in allTerms", () => {
    const result = expandQuery("fix the bug");
    expect(result.tokens.length).toBeGreaterThan(0);
    // Question-word stripping: tokenizeQuery strips stop words
    // "fix" should remain, "bug" should remain
    expect(result.allTerms.some((t) => t === "fix" || t.startsWith("fix"))).toBe(true);
  });

  it("includes snake_case variant in symbolVariants", () => {
    const result = expandQuery("parse git log");
    expect(result.symbolVariants).toContain("parse_git_log");
  });

  it("returns allTerms with at least 3 items for multi-word query", () => {
    const result = expandQuery("handle authentication error");
    expect(result.allTerms.length).toBeGreaterThanOrEqual(3);
  });
});
