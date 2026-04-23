// ============================================================================
// Sprint AU — Dims 15+5: Hard-task finish-rate + SWE-bench mini-tranche
// Tests that:
//  - classifyTaskDifficulty returns correct difficulty bucket
//  - recordFinishRate appends JSONL to .danteforge/finish-rate-log.json
//  - loadFinishRates reads and parses all entries
//  - getFinishRateStats computes per-difficulty finish rates correctly
//  - bench-results.json reproduced_tranche has 5 valid entries
//  - getReproducedTranche reads the tranche from bench-results.json
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  classifyTaskDifficulty,
  recordFinishRate,
  loadFinishRates,
  getFinishRateStats,
} from "@dantecode/core";
import { getReproducedTranche } from "../swe-bench-runner.js";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-au-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("classifyTaskDifficulty — Sprint AU (dim 15)", () => {
  // 1. Hard when prompt > 200 chars
  it("returns 'hard' when prompt length exceeds 200 characters", () => {
    const longPrompt = "a".repeat(201);
    expect(classifyTaskDifficulty(longPrompt, [])).toBe("hard");
  });

  // 2. Hard when touchedFiles > 3
  it("returns 'hard' when touchedFiles.length exceeds 3", () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"];
    expect(classifyTaskDifficulty("short", files)).toBe("hard");
  });

  // 3. Easy for short prompt + 1 file
  it("returns 'easy' for short prompt and 1 file", () => {
    expect(classifyTaskDifficulty("fix bug", ["main.ts"])).toBe("easy");
  });

  // 4. Medium for mid-length prompt
  it("returns 'medium' when prompt is between 101-200 chars", () => {
    const medPrompt = "b".repeat(150);
    expect(classifyTaskDifficulty(medPrompt, [])).toBe("medium");
  });

  // 5. Medium when touchedFiles = 2
  it("returns 'medium' when touchedFiles.length is 2", () => {
    expect(classifyTaskDifficulty("short", ["a.ts", "b.ts"])).toBe("medium");
  });
});

describe("recordFinishRate + loadFinishRates — Sprint AU (dim 15)", () => {
  // 6. recordFinishRate creates and appends to finish-rate-log.json
  it("recordFinishRate creates .danteforge/finish-rate-log.json and appends JSONL", () => {
    const dir = makeDir();
    recordFinishRate({
      taskId: "t1",
      taskDifficulty: "hard",
      finishedCleanly: true,
      roundsUsed: 10,
      touchedFiles: 5,
      verifyPassed: true,
    }, dir);
    const path = join(dir, ".danteforge", "finish-rate-log.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
  });

  // 7. loadFinishRates reads and parses all entries
  it("loadFinishRates reads and parses entries written by recordFinishRate", () => {
    const dir = makeDir();
    recordFinishRate({ taskId: "t1", taskDifficulty: "hard", finishedCleanly: true, roundsUsed: 8, touchedFiles: 4, verifyPassed: true }, dir);
    recordFinishRate({ taskId: "t2", taskDifficulty: "easy", finishedCleanly: false, roundsUsed: 3, touchedFiles: 1, verifyPassed: false }, dir);
    const entries = loadFinishRates(dir);
    expect(entries.length).toBe(2);
    expect(entries[0]!.taskId).toBe("t1");
    expect(entries[1]!.taskDifficulty).toBe("easy");
  });
});

describe("getFinishRateStats — Sprint AU (dim 15)", () => {
  // 8. hardTaskFinishRate = 1.0 for 2 hard tasks both finishing cleanly
  it("computes hardTaskFinishRate = 1.0 when all hard tasks finish cleanly", () => {
    const dir = makeDir();
    recordFinishRate({ taskId: "h1", taskDifficulty: "hard", finishedCleanly: true, roundsUsed: 10, touchedFiles: 4, verifyPassed: true }, dir);
    recordFinishRate({ taskId: "h2", taskDifficulty: "hard", finishedCleanly: true, roundsUsed: 9, touchedFiles: 5, verifyPassed: true }, dir);
    const stats = getFinishRateStats(loadFinishRates(dir));
    expect(stats.hardTaskFinishRate).toBe(1.0);
    expect(stats.totalTasks).toBe(2);
  });

  // 9. hardTaskFinishRate = 0 when all hard tasks fail
  it("returns hardTaskFinishRate = 0 when all hard tasks fail", () => {
    const dir = makeDir();
    recordFinishRate({ taskId: "h1", taskDifficulty: "hard", finishedCleanly: false, roundsUsed: 15, touchedFiles: 6, verifyPassed: false }, dir);
    const stats = getFinishRateStats(loadFinishRates(dir));
    expect(stats.hardTaskFinishRate).toBe(0);
  });
});

describe("bench-results.json reproduced_tranche — Sprint AU (dim 5)", () => {
  // bench-results.json is in the repo root, 2 levels above packages/cli
  const benchPath = resolve(process.cwd(), "../../bench-results.json");

  // Extra: getReproducedTranche reads the tranche array
  it("getReproducedTranche returns an array of tranche entries", () => {
    const tranche = getReproducedTranche(benchPath);
    expect(Array.isArray(tranche)).toBe(true);
    expect(tranche.length).toBeGreaterThanOrEqual(5);
  });

  // Extra: each tranche entry has the correct shape
  it("each reproduced_tranche entry has instanceId, patchApplied, testsPassed, resolvedAt", () => {
    const tranche = getReproducedTranche(benchPath);
    for (const entry of tranche) {
      expect(typeof entry.instanceId).toBe("string");
      expect(typeof entry.patchApplied).toBe("boolean");
      expect(typeof entry.testsPassed).toBe("boolean");
      expect(typeof entry.resolvedAt).toBe("string");
    }
  });
});
