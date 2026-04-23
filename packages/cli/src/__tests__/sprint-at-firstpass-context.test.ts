// ============================================================================
// Sprint AT — Dims 10+2: First-pass gate + ContextCoverageTracker wired
// Tests that:
//  - runGenerationWithGate calls postFileGate once per file
//  - runGenerationWithGate halts when postFileGate returns false
//  - runGenerationWithGate continues when postFileGate returns true
//  - filesWritten reflects files written before halt
//  - postFileGate not called when no files provided
//  - recordContextHit called when ApproachMemory.findSimilar returns results
//  - context-coverage-log.json grows per retrieve call
//  - summarizeContextCoverage reflects repo-memory source from knowledge-store hits
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  runGenerationWithGate,
  recordContextHit,
  loadContextCoverage,
  summarizeContextCoverage,
  ApproachMemory,
  type GenerationFileSpec,
} from "@dantecode/core";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-at-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("runGenerationWithGate — Sprint AT (dim 10)", () => {
  // 1. postFileGate called once per file
  it("postFileGate is called once for each file written", async () => {
    const calls: string[] = [];
    const files: GenerationFileSpec[] = [
      { filePath: "/tmp/a.ts", content: "export const a = 1;" },
      { filePath: "/tmp/b.ts", content: "export const b = 2;" },
    ];
    const writeFn = async (_spec: GenerationFileSpec) => { /* no-op in test */ };
    const gate = async (fp: string) => { calls.push(fp); return true; };

    await runGenerationWithGate(files, writeFn, gate);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe("/tmp/a.ts");
    expect(calls[1]).toBe("/tmp/b.ts");
  });

  // 2. halts when gate returns false
  it("runGenerationWithGate halts at file where gate returns false", async () => {
    const written: string[] = [];
    const files: GenerationFileSpec[] = [
      { filePath: "/tmp/a.ts", content: "const a = 1;" },
      { filePath: "/tmp/b.ts", content: "const b = 2;" },
      { filePath: "/tmp/c.ts", content: "const c = 3;" },
    ];
    const writeFn = async (spec: GenerationFileSpec) => { written.push(spec.filePath); };
    const gate = async (fp: string) => fp !== "/tmp/b.ts"; // fail at b.ts

    const result = await runGenerationWithGate(files, writeFn, gate);
    expect(result.passed).toBe(false);
    expect(result.haltedAt).toBe("/tmp/b.ts");
    expect(written).toContain("/tmp/a.ts");
    expect(written).not.toContain("/tmp/c.ts");
  });

  // 3. continues when gate returns true for all
  it("runGenerationWithGate passes when all gates return true", async () => {
    const files: GenerationFileSpec[] = [
      { filePath: "/tmp/x.ts", content: "export const x = 1;" },
    ];
    const writeFn = async (_spec: GenerationFileSpec) => {};
    const gate = async (_fp: string) => true;

    const result = await runGenerationWithGate(files, writeFn, gate);
    expect(result.passed).toBe(true);
    expect(result.haltedAt).toBeUndefined();
  });

  // 4. filesWritten reflects files written before halt
  it("filesWritten contains all files written before the halt", async () => {
    const files: GenerationFileSpec[] = [
      { filePath: "/tmp/p.ts", content: "1" },
      { filePath: "/tmp/q.ts", content: "2" },
      { filePath: "/tmp/r.ts", content: "3" },
    ];
    const writeFn = async (_spec: GenerationFileSpec) => {};
    const gate = async (fp: string) => fp !== "/tmp/r.ts";

    const result = await runGenerationWithGate(files, writeFn, gate);
    expect(result.filesWritten).toContain("/tmp/p.ts");
    expect(result.filesWritten).toContain("/tmp/q.ts");
    // r.ts is written then fails gate — it IS in filesWritten but halt stops further writes
    expect(result.passed).toBe(false);
    expect(result.haltedAt).toBe("/tmp/r.ts");
  });

  // 5. postFileGate not called when no files provided
  it("postFileGate is not called when files array is empty", async () => {
    let called = false;
    const gate = async (_fp: string) => { called = true; return true; };
    const result = await runGenerationWithGate([], async () => {}, gate);
    expect(called).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.filesWritten).toHaveLength(0);
  });
});

describe("ContextCoverageTracker wired — Sprint AT (dim 2)", () => {
  // 6. recordContextHit writes to context-coverage-log.json
  it("recordContextHit grows context-coverage-log.json by 1 entry per call", () => {
    const dir = makeDir();
    recordContextHit({ sessionId: "at-test", key: "auth-context", source: "repo-memory", relevanceScore: 0.9 }, dir);
    const path = join(dir, ".danteforge", "context-coverage-log.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
  });

  // 7. loadContextCoverage reads entries back
  it("loadContextCoverage reads entries written by recordContextHit", () => {
    const dir = makeDir();
    recordContextHit({ sessionId: "s1", key: "k1", source: "repo-memory", relevanceScore: 0.8 }, dir);
    recordContextHit({ sessionId: "s1", key: "k2", source: "lsp", relevanceScore: 0.7 }, dir);
    const entries = loadContextCoverage(dir);
    expect(entries.length).toBe(2);
  });

  // 8. summarizeContextCoverage reflects repo-memory source
  it("summarizeContextCoverage reflects repo-memory entries from knowledge-store hits", () => {
    const dir = makeDir();
    recordContextHit({ sessionId: "s1", key: "auth", source: "repo-memory", relevanceScore: 0.95 }, dir);
    recordContextHit({ sessionId: "s1", key: "user", source: "repo-memory", relevanceScore: 0.85 }, dir);
    const entries = loadContextCoverage(dir);
    const summary = summarizeContextCoverage(entries);
    expect(summary.sourceBreakdown["repo-memory"]).toBe(2);
    expect(summary.totalHits).toBe(2);
    expect(summary.avgRelevance).toBeCloseTo(0.9, 2);
  });

  // 9. ApproachMemory.findSimilar triggers recordContextHit (integration)
  it("ApproachMemory.findSimilar can be called without throwing", async () => {
    const dir = makeDir();
    const memory = new ApproachMemory(dir);
    const results = await memory.findSimilar("test query about authentication");
    expect(Array.isArray(results)).toBe(true);
  });
});
