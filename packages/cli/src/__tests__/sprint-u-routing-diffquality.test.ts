// ============================================================================
// Sprint U — Dims 27+13: Cost tier evidence log + diff quality scoring
// Tests that:
//  - emitCostRoutingLog writes JSONL entry to .danteforge/cost-routing-log.json
//  - emitCostRoutingLog entry has all required fields
//  - emitCostRoutingLog is non-fatal when dir missing (creates it)
//  - multiple calls append (not overwrite) entries
//  - scoreDiff computes linesAdded/linesRemoved correctly
//  - scoreDiff detects test files and sets hasTests=true
//  - scoreDiff returns low qualityScore for large diff without tests
//  - scoreDiff returns high qualityScore for diff with tests
//  - emitDiffQualityLog writes JSONL to .danteforge/diff-quality-log.json
//  - emitDiffQualityLog entry contains all DiffQualityScore fields
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { emitCostRoutingLog, type CostRoutingLogEntry } from "@dantecode/core";
import { scoreDiff, emitDiffQualityLog } from "@dantecode/core";

function makeDir() {
  const dir = join(tmpdir(), `sprint-u-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: Cost routing evidence log (dim 27) ───────────────────────────────

describe("emitCostRoutingLog — Sprint U (dim 27)", () => {
  // 1. Writes JSONL entry to correct path
  it("writes cost routing entry to .danteforge/cost-routing-log.json", () => {
    const root = makeDir();
    emitCostRoutingLog(
      { tier: "fast", provider: "anthropic", modelId: "claude-haiku-4-5", taskType: "chat", estimatedInputTokens: 1000 },
      root,
    );
    const logPath = join(root, ".danteforge", "cost-routing-log.json");
    expect(existsSync(logPath)).toBe(true);
  });

  // 2. Entry has all required fields
  it("written entry contains all required CostRoutingLogEntry fields", () => {
    const root = makeDir();
    emitCostRoutingLog(
      { tier: "fast", provider: "anthropic", modelId: "claude-haiku-4-5", taskType: "codegen", estimatedInputTokens: 500 },
      root,
    );
    const logPath = join(root, ".danteforge", "cost-routing-log.json");
    const entry = JSON.parse(readFileSync(logPath, "utf-8").trim()) as CostRoutingLogEntry;
    expect(entry.tier).toBe("fast");
    expect(entry.provider).toBe("anthropic");
    expect(entry.modelId).toBe("claude-haiku-4-5");
    expect(entry.taskType).toBe("codegen");
    expect(entry.estimatedInputTokens).toBe(500);
    expect(typeof entry.timestamp).toBe("string");
  });

  // 3. Creates .danteforge dir if missing
  it("creates .danteforge directory if it does not exist", () => {
    const root = makeDir();
    const danteDir = join(root, ".danteforge");
    // directory not pre-created — emitCostRoutingLog should create it
    emitCostRoutingLog({ tier: "fast", provider: "anthropic", modelId: "haiku", taskType: "chat", estimatedInputTokens: 0 }, root);
    expect(existsSync(danteDir)).toBe(true);
  });

  // 4. Multiple calls append (not overwrite)
  it("appends entries across multiple calls (JSONL format)", () => {
    const root = makeDir();
    emitCostRoutingLog({ tier: "fast", provider: "anthropic", modelId: "haiku", taskType: "chat", estimatedInputTokens: 100 }, root);
    emitCostRoutingLog({ tier: "fast", provider: "openai", modelId: "gpt-4o-mini", taskType: "chat", estimatedInputTokens: 200 }, root);
    const logPath = join(root, ".danteforge", "cost-routing-log.json");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

// ─── Part 2: Diff quality scoring (dim 13) ───────────────────────────────────

describe("scoreDiff — Sprint U (dim 13)", () => {
  // 5. Counts lines added and removed
  it("computes linesAdded and linesRemoved for a simple diff", () => {
    const old = "line1\nline2\nline3";
    const newC = "line1\nline2\nline4\nline5";
    const score = scoreDiff(old, newC);
    expect(score.linesAdded).toBeGreaterThan(0);
    expect(score.linesRemoved).toBeGreaterThan(0);
  });

  // 6. Detects test files (hasTests=true)
  it("sets hasTests=true for test file paths", () => {
    const score = scoreDiff("a\nb", "a\nb\nc", "src/utils.test.ts");
    expect(score.hasTests).toBe(true);
  });

  // 7. Non-test files get hasTests=false
  it("sets hasTests=false for non-test file paths", () => {
    const score = scoreDiff("a\nb", "a\nb\nc", "src/utils.ts");
    expect(score.hasTests).toBe(false);
  });

  // 8. Large diff without tests gets lower qualityScore than with tests
  it("qualityScore is higher when test file included", () => {
    const old = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
    const newContent = Array.from({ length: 100 }, (_, i) => `changed${i}`).join("\n");
    const withTests = scoreDiff(old, newContent, "src/feature.test.ts");
    const withoutTests = scoreDiff(old, newContent, "src/feature.ts");
    expect(withTests.qualityScore).toBeGreaterThan(withoutTests.qualityScore);
  });

  // 9. Empty diff gets low qualityScore
  it("empty diff (identical content) gets low qualityScore", () => {
    const content = "same line\nsame again";
    const score = scoreDiff(content, content, "src/file.ts");
    expect(score.qualityScore).toBeLessThan(0.3);
  });

  // 10. totalLines = linesAdded + linesRemoved
  it("totalLines equals linesAdded + linesRemoved", () => {
    const score = scoreDiff("a\nb\nc", "a\nd\ne\nf", "src/index.ts");
    expect(score.totalLines).toBe(score.linesAdded + score.linesRemoved);
  });
});

describe("emitDiffQualityLog — Sprint U (dim 13)", () => {
  // 11. Writes JSONL entry
  it("writes diff quality entry to .danteforge/diff-quality-log.json", () => {
    const root = makeDir();
    const score = scoreDiff("old\ncode", "new\ncode\nmore", "src/index.ts");
    emitDiffQualityLog(score, "src/index.ts", undefined, root);
    const logPath = join(root, ".danteforge", "diff-quality-log.json");
    expect(existsSync(logPath)).toBe(true);
  });

  // 12. Entry contains all score fields
  it("entry contains all DiffQualityScore fields", () => {
    const root = makeDir();
    const score = scoreDiff("old", "new code here", "src/test.ts");
    emitDiffQualityLog(score, "src/test.ts", "abc123", root);
    const logPath = join(root, ".danteforge", "diff-quality-log.json");
    const entry = JSON.parse(readFileSync(logPath, "utf-8").trim()) as Record<string, unknown>;
    expect(typeof entry["linesAdded"]).toBe("number");
    expect(typeof entry["linesRemoved"]).toBe("number");
    expect(typeof entry["qualityScore"]).toBe("number");
    expect(typeof entry["hasTests"]).toBe("boolean");
    expect(entry["filePath"]).toBe("src/test.ts");
    expect(entry["commitSha"]).toBe("abc123");
  });
});
