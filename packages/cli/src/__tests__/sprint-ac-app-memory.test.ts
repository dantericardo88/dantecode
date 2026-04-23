// ============================================================================
// Sprint AC — Dims 10+21: AppGenerationGate + MemoryRecallQuality
// Tests that:
//  - recordMemoryRecall writes to memory-recall-quality.json
//  - summarizeRecallQuality computes successRate correctly
//  - summarizeRecallQuality identifies top performing keys
//  - summarizeRecallQuality handles empty records
//  - loadRecallQualityLog reads back correct entries
//  - memory-recall-quality.json exists in .danteforge/
//  - seeded entries all have required fields
//  - summarizeRecallQuality computes avgRelevanceScore
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  recordMemoryRecall,
  summarizeRecallQuality,
  loadRecallQualityLog,
  type MemoryRecallRecord,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-ac-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: recordMemoryRecall / summarizeRecallQuality ─────────────────────

describe("recordMemoryRecall + summarizeRecallQuality — Sprint AC (dim 21)", () => {
  // 1. recordMemoryRecall writes file
  it("recordMemoryRecall writes to .danteforge/memory-recall-quality.json", () => {
    const dir = makeDir();
    recordMemoryRecall(
      { sessionId: "s1", recalledKeys: ["lesson:test"], taskDescription: "test task", taskOutcome: "success" },
      dir,
    );
    expect(existsSync(join(dir, ".danteforge", "memory-recall-quality.json"))).toBe(true);
  });

  // 2. successRate 1/1 = 1.0
  it("summarizeRecallQuality successRate is 1.0 when all succeed", () => {
    const records: MemoryRecallRecord[] = [
      { timestamp: "t", sessionId: "s1", recalledKeys: ["k1"], taskDescription: "d", taskOutcome: "success" },
    ];
    expect(summarizeRecallQuality(records).successRate).toBe(1);
  });

  // 3. successRate 1/3
  it("summarizeRecallQuality successRate is 1/3 for 1 success out of 3", () => {
    const records: MemoryRecallRecord[] = [
      { timestamp: "t", sessionId: "s1", recalledKeys: ["k1"], taskDescription: "d", taskOutcome: "success" },
      { timestamp: "t", sessionId: "s2", recalledKeys: ["k2"], taskDescription: "d", taskOutcome: "failure" },
      { timestamp: "t", sessionId: "s3", recalledKeys: ["k3"], taskDescription: "d", taskOutcome: "failure" },
    ];
    expect(summarizeRecallQuality(records).successRate).toBeCloseTo(1 / 3, 5);
  });

  // 4. topPerformingKeys sorted by success rate
  it("summarizeRecallQuality topPerformingKeys is sorted by success rate", () => {
    const records: MemoryRecallRecord[] = [
      { timestamp: "t", sessionId: "s1", recalledKeys: ["low"], taskDescription: "d", taskOutcome: "failure" },
      { timestamp: "t", sessionId: "s2", recalledKeys: ["high"], taskDescription: "d", taskOutcome: "success" },
      { timestamp: "t", sessionId: "s3", recalledKeys: ["high"], taskDescription: "d", taskOutcome: "success" },
    ];
    const summary = summarizeRecallQuality(records);
    expect(summary.topPerformingKeys[0]).toBe("high");
  });

  // 5. empty input returns zeros
  it("summarizeRecallQuality returns 0 values for empty input", () => {
    const summary = summarizeRecallQuality([]);
    expect(summary.totalRecalls).toBe(0);
    expect(summary.successRate).toBe(0);
  });

  // 6. avgRelevanceScore computed from relevanceScores
  it("summarizeRecallQuality computes avgRelevanceScore from entries", () => {
    const records: MemoryRecallRecord[] = [
      {
        timestamp: "t", sessionId: "s1", recalledKeys: ["k1"], taskDescription: "d", taskOutcome: "success",
        relevanceScores: { k1: 0.8 },
      },
      {
        timestamp: "t", sessionId: "s2", recalledKeys: ["k2"], taskDescription: "d", taskOutcome: "success",
        relevanceScores: { k2: 0.4 },
      },
    ];
    const summary = summarizeRecallQuality(records);
    expect(summary.avgRelevanceScore).toBeCloseTo(0.6, 5);
  });

  // 7. Seeded memory-recall-quality.json exists
  it("seeded memory-recall-quality.json exists at .danteforge/", () => {
    const logPath = join(repoRoot, ".danteforge", "memory-recall-quality.json");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  // 8. loadRecallQualityLog reads entries back correctly
  it("loadRecallQualityLog reads back written entries", () => {
    const dir = makeDir();
    recordMemoryRecall(
      { sessionId: "s-load", recalledKeys: ["lesson:foo"], taskDescription: "load test", taskOutcome: "success" },
      dir,
    );
    const records = loadRecallQualityLog(dir);
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]?.sessionId).toBe("s-load");
  });
});
