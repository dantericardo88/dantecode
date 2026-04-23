// ============================================================================
// Sprint AG — Dims 6+10: InlineEditLog + AppGenerationGate
// Tests that:
//  - emitInlineEditLog writes to .danteforge/inline-edit-log.json
//  - summarizeInlineEdits computes avgConfidenceScore correctly
//  - summarizeInlineEdits counts highConfidenceEdits
//  - summarizeInlineEdits handles empty input
//  - loadInlineEditLog reads entries back
//  - seeded inline-edit-log.json exists with 5+ entries
//  - AppGenerationGate.checkFile() records result
//  - AppGenerationGate.getReport() returns correct pass counts
//  - seeded app-generation-log.json exists
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  emitInlineEditLog,
  loadInlineEditLog,
  summarizeInlineEdits,
  AppGenerationGate,
  type InlineEditLogEntry,
  type StackTemplate,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-ag-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: InlineEditLog ────────────────────────────────────────────────────

describe("InlineEditLog — Sprint AG (dim 6)", () => {
  // 1. emitInlineEditLog writes file
  it("emitInlineEditLog writes to .danteforge/inline-edit-log.json", () => {
    const dir = makeDir();
    emitInlineEditLog({ filePath: "src/foo.ts", editType: "insert", linesAdded: 10, linesRemoved: 0, confidenceScore: 0.85, qualityScore: 0.8 }, dir);
    expect(existsSync(join(dir, ".danteforge", "inline-edit-log.json"))).toBe(true);
  });

  // 2. summarizeInlineEdits avgConfidenceScore
  it("summarizeInlineEdits computes avgConfidenceScore correctly", () => {
    const entries: InlineEditLogEntry[] = [
      { timestamp: "t", filePath: "a.ts", editType: "insert", linesAdded: 5, linesRemoved: 0, confidenceScore: 0.8, qualityScore: 0.7 },
      { timestamp: "t", filePath: "b.ts", editType: "modify", linesAdded: 3, linesRemoved: 2, confidenceScore: 0.6, qualityScore: 0.5 },
    ];
    const summary = summarizeInlineEdits(entries);
    expect(summary.avgConfidenceScore).toBeCloseTo(0.7, 2);
  });

  // 3. summarizeInlineEdits highConfidenceEdits count
  it("summarizeInlineEdits counts highConfidenceEdits (score >= 0.75)", () => {
    const entries: InlineEditLogEntry[] = [
      { timestamp: "t", filePath: "a.ts", editType: "insert", linesAdded: 5, linesRemoved: 0, confidenceScore: 0.9, qualityScore: 0.85 },
      { timestamp: "t", filePath: "b.ts", editType: "modify", linesAdded: 3, linesRemoved: 2, confidenceScore: 0.4, qualityScore: 0.35 },
    ];
    const summary = summarizeInlineEdits(entries);
    expect(summary.highConfidenceEdits).toBe(1);
    expect(summary.lowConfidenceEdits).toBe(1);
  });

  // 4. empty input returns zeros
  it("summarizeInlineEdits handles empty input", () => {
    const summary = summarizeInlineEdits([]);
    expect(summary.totalEdits).toBe(0);
    expect(summary.avgConfidenceScore).toBe(0);
  });

  // 5. loadInlineEditLog reads entries
  it("loadInlineEditLog reads back written entries", () => {
    const dir = makeDir();
    emitInlineEditLog({ filePath: "test.ts", editType: "replace", linesAdded: 2, linesRemoved: 2, confidenceScore: 0.75, qualityScore: 0.72 }, dir);
    const entries = loadInlineEditLog(dir);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.filePath).toBe("test.ts");
  });

  // 6. seeded inline-edit-log.json exists
  it("seeded inline-edit-log.json exists at .danteforge/", () => {
    const logPath = join(repoRoot, ".danteforge", "inline-edit-log.json");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── Part 2: AppGenerationGate ────────────────────────────────────────────────

describe("AppGenerationGate — Sprint AG (dim 10)", () => {
  // 7. checkFile with no typecheckCmd always passes (unknown stack)
  it("checkFile passes when template has no typecheckCmd", async () => {
    const dir = makeDir();
    const gate = new AppGenerationGate("sess-ag-test", dir);
    const template: StackTemplate = { stack: "unknown", scaffoldHint: "", entryPoints: [], typecheckCmd: "", testCmd: "" };
    const result = await gate.checkFile("src/foo.ts", template);
    expect(result.passed).toBe(true);
  });

  // 8. getReport counts files correctly
  it("getReport.totalFiles counts checked files", async () => {
    const dir = makeDir();
    const gate = new AppGenerationGate("sess-ag-count", dir);
    const template: StackTemplate = { stack: "unknown", scaffoldHint: "", entryPoints: [], typecheckCmd: "", testCmd: "" };
    await gate.checkFile("src/a.ts", template);
    await gate.checkFile("src/b.ts", template);
    const report = gate.getReport();
    expect(report.totalFiles).toBe(2);
  });

  // 9. seeded app-generation-log.json exists
  it("seeded app-generation-log.json exists at .danteforge/", () => {
    const logPath = join(repoRoot, ".danteforge", "app-generation-log.json");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});
