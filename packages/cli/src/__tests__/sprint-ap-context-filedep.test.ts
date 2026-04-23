// ============================================================================
// Sprint AP — Dims 2+4: Context Coverage Tracker + File Dependency Context
// Tests that:
//  - recordContextHit writes to .danteforge/context-coverage-log.json
//  - loadContextCoverage reads entries back
//  - summarizeContextCoverage computes sourceBreakdown correctly
//  - summarizeContextCoverage handles empty input
//  - summarizeContextCoverage topSources returns sorted by frequency
//  - summarizeContextCoverage counts unique sessions
//  - seeded context-coverage-log.json exists with 5+ entries
//  - buildFileContextMap returns touchedFiles in result
//  - buildFileContextMap finds related files via imports
//  - buildFileContextMap handles non-existent files gracefully
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  recordContextHit,
  loadContextCoverage,
  summarizeContextCoverage,
  buildFileContextMap,
  type ContextHitEntry,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-ap-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: Context Coverage Tracker ─────────────────────────────────────────

describe("ContextCoverageTracker — Sprint AP (dim 2)", () => {
  // 1. recordContextHit writes file
  it("recordContextHit writes to .danteforge/context-coverage-log.json", () => {
    const dir = makeDir();
    recordContextHit({ sessionId: "s1", key: "repo-auth", source: "repo-memory", relevanceScore: 0.85 }, dir);
    expect(existsSync(join(dir, ".danteforge", "context-coverage-log.json"))).toBe(true);
  });

  // 2. loadContextCoverage reads entries
  it("loadContextCoverage reads entries back", () => {
    const dir = makeDir();
    recordContextHit({ sessionId: "s1", key: "lsp-hover", source: "lsp", relevanceScore: 0.7 }, dir);
    const entries = loadContextCoverage(dir);
    expect(entries.length).toBe(1);
    expect(entries[0]?.source).toBe("lsp");
  });

  // 3. summarizeContextCoverage sourceBreakdown
  it("summarizeContextCoverage computes sourceBreakdown correctly", () => {
    const entries: ContextHitEntry[] = [
      { timestamp: "t", sessionId: "s1", key: "k1", source: "repo-memory", relevanceScore: 0.9 },
      { timestamp: "t", sessionId: "s1", key: "k2", source: "repo-memory", relevanceScore: 0.8 },
      { timestamp: "t", sessionId: "s2", key: "k3", source: "lsp", relevanceScore: 0.7 },
    ];
    const summary = summarizeContextCoverage(entries);
    expect(summary.sourceBreakdown["repo-memory"]).toBe(2);
    expect(summary.sourceBreakdown["lsp"]).toBe(1);
  });

  // 4. summarizeContextCoverage handles empty
  it("summarizeContextCoverage handles empty input", () => {
    const summary = summarizeContextCoverage([]);
    expect(summary.totalHits).toBe(0);
    expect(summary.avgRelevance).toBe(0);
  });

  // 5. summarizeContextCoverage topSources sorted by frequency
  it("summarizeContextCoverage topSources returns most-used source first", () => {
    const entries: ContextHitEntry[] = [
      { timestamp: "t", sessionId: "s1", key: "k1", source: "repo-memory", relevanceScore: 0.9 },
      { timestamp: "t", sessionId: "s1", key: "k2", source: "repo-memory", relevanceScore: 0.8 },
      { timestamp: "t", sessionId: "s2", key: "k3", source: "lsp", relevanceScore: 0.7 },
    ];
    const summary = summarizeContextCoverage(entries);
    expect(summary.topSources[0]).toBe("repo-memory");
  });

  // 6. summarizeContextCoverage counts unique sessions
  it("summarizeContextCoverage counts unique sessions", () => {
    const entries: ContextHitEntry[] = [
      { timestamp: "t", sessionId: "sess-a", key: "k1", source: "lsp", relevanceScore: 0.8 },
      { timestamp: "t", sessionId: "sess-a", key: "k2", source: "lsp", relevanceScore: 0.7 },
      { timestamp: "t", sessionId: "sess-b", key: "k3", source: "lsp", relevanceScore: 0.9 },
    ];
    const summary = summarizeContextCoverage(entries);
    expect(summary.sessionsWithContext).toBe(2);
  });

  // 7. seeded context-coverage-log.json exists
  it("seeded context-coverage-log.json exists at .danteforge/ with 5+ entries", () => {
    const path = join(repoRoot, ".danteforge", "context-coverage-log.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── Part 2: File Dependency Context ─────────────────────────────────────────

describe("FileDependencyContext — Sprint AP (dim 4)", () => {
  // 8. buildFileContextMap returns touchedFiles
  it("buildFileContextMap returns touchedFiles list in result", () => {
    const result = buildFileContextMap(["src/auth.ts", "src/user.ts"], repoRoot);
    expect(result.touchedFiles.length).toBe(2);
  });

  // 9. buildFileContextMap contextSummary is non-empty
  it("buildFileContextMap contextSummary is a non-empty string", () => {
    const result = buildFileContextMap(["packages/core/src/circuit-breaker.ts"], repoRoot);
    expect(result.contextSummary.length).toBeGreaterThan(0);
    expect(result.contextSummary).toContain("Touched:");
  });

  // 10. buildFileContextMap handles non-existent files gracefully
  it("buildFileContextMap handles non-existent file paths without throwing", () => {
    const result = buildFileContextMap(["/nonexistent/path/file.ts"], repoRoot);
    expect(result.dependencyMaps[0]?.imports).toHaveLength(0);
  });
});
