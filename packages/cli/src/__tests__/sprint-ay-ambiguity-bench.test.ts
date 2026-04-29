// ============================================================================
// Sprint AY — Dims 15+5: Task ambiguity detector + patch applicability
// Tests that:
//  - detectTaskAmbiguity fires too_short for prompt < 60 chars
//  - detectTaskAmbiguity fires vague_verb for "improve the auth system"
//  - detectTaskAmbiguity fires no_file_path when no file extension in prompt
//  - detectTaskAmbiguity returns isAmbiguous=false for specific prompt
//  - detectTaskAmbiguity generates non-empty assumptionText when ambiguous
//  - recordAmbiguityDetection creates .danteforge/ambiguity-log.json
//  - loadAmbiguityLog reads and parses JSONL entries
//  - getAmbiguityStats returns correct ambiguousRate for seeded log
//  - verifyPatchApplicability returns boolean (true or false, not throws)
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  detectTaskAmbiguity,
  recordAmbiguityDetection,
  loadAmbiguityLog,
  getAmbiguityStats,
} from "@dantecode/core";
import { verifyPatchApplicability, getReproducedTranche, runVerifiedTranche } from "../swe-bench-runner.js";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-ay-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("detectTaskAmbiguity — Sprint AY (dim 15)", () => {
  // 1. too_short fires for prompt < 60 chars
  it("fires too_short signal for prompt shorter than 60 characters", () => {
    const result = detectTaskAmbiguity("fix the bug");
    const types = result.signals.map((s) => s.type);
    expect(types).toContain("too_short");
    expect(result.score).toBeGreaterThanOrEqual(1);
  });

  // 2. vague_verb fires for "improve the auth system"
  it("fires vague_verb signal for 'improve the auth system'", () => {
    const result = detectTaskAmbiguity("improve the auth system to be faster and more secure");
    const types = result.signals.map((s) => s.type);
    expect(types).toContain("vague_verb");
  });

  // 3. no_file_path fires when no .ts/.py in prompt
  it("fires no_file_path signal when no file extension or src/ path found", () => {
    const result = detectTaskAmbiguity("Please refactor the authentication logic so that it handles edge cases properly");
    const types = result.signals.map((s) => s.type);
    expect(types).toContain("no_file_path");
  });

  // 4. isAmbiguous=false for specific, well-formed prompt
  it("returns isAmbiguous=false for a specific prompt with file path and acceptance criteria", () => {
    const prompt =
      "Add a `maxRetries` parameter to `ModelRouterImpl.generate()` in packages/core/src/model-router.ts. " +
      "It should retry up to 3 times on network errors. Tests must pass and typecheck must be clean.";
    const result = detectTaskAmbiguity(prompt);
    expect(result.isAmbiguous).toBe(false);
    expect(result.score).toBeLessThan(2);
  });

  // 5. assumptionText is non-empty when ambiguous
  it("generates non-empty assumptionText when prompt is ambiguous", () => {
    const result = detectTaskAmbiguity("fix it");
    expect(result.isAmbiguous).toBe(true);
    expect(result.assumptionText.length).toBeGreaterThan(0);
    expect(result.assumptionText).toContain("Assuming:");
  });
});

describe("recordAmbiguityDetection + loadAmbiguityLog — Sprint AY (dim 15)", () => {
  // 6. recordAmbiguityDetection creates .danteforge/ambiguity-log.json
  it("recordAmbiguityDetection creates .danteforge/ambiguity-log.json", () => {
    const dir = makeDir();
    recordAmbiguityDetection({
      sessionId: "sess-test-1",
      prompt: "fix the thing",
      isAmbiguous: true,
      score: 3,
      signalTypes: ["too_short", "no_file_path", "no_acceptance_criteria"],
      assumptionText: "Assuming: limited scope.",
    }, dir);
    expect(existsSync(join(dir, ".danteforge", "ambiguity-log.json"))).toBe(true);
  });

  // 7. loadAmbiguityLog reads and parses JSONL entries
  it("loadAmbiguityLog reads and parses entries written by recordAmbiguityDetection", () => {
    const dir = makeDir();
    recordAmbiguityDetection({
      sessionId: "s1",
      prompt: "make it better",
      isAmbiguous: true,
      score: 4,
      signalTypes: ["too_short", "no_file_path", "vague_verb", "no_acceptance_criteria"],
      assumptionText: "Assuming: limited scope.",
    }, dir);
    recordAmbiguityDetection({
      sessionId: "s2",
      prompt: "Add `timeout` param to `fetchData()` in src/api/client.ts. Should throw after 5s. Tests must pass.",
      isAmbiguous: false,
      score: 0,
      signalTypes: [],
      assumptionText: "",
    }, dir);
    const entries = loadAmbiguityLog(dir);
    expect(entries.length).toBe(2);
    expect(entries[0]!.sessionId).toBe("s1");
    expect(entries[1]!.isAmbiguous).toBe(false);
  });

  // 8. getAmbiguityStats returns correct ambiguousRate
  it("getAmbiguityStats returns correct ambiguousRate for mixed log", () => {
    const entries = [
      { sessionId: "s1", prompt: "fix", isAmbiguous: true, score: 3, signalTypes: ["too_short"], assumptionText: "...", timestamp: "" },
      { sessionId: "s2", prompt: "improve", isAmbiguous: true, score: 4, signalTypes: ["vague_verb"], assumptionText: "...", timestamp: "" },
      { sessionId: "s3", prompt: "Add `validate()` to src/validator.ts. Must throw on null. Tests should pass.", isAmbiguous: false, score: 0, signalTypes: [], assumptionText: "", timestamp: "" },
    ];
    const stats = getAmbiguityStats(entries);
    expect(stats.ambiguousRate).toBeCloseTo(2 / 3, 5);
    expect(stats.totalDetected).toBe(3);
    expect(stats.avgScore).toBeGreaterThan(0);
  });
});

describe("verifyPatchApplicability — Sprint AY (dim 5)", () => {
  // 9. verifyPatchApplicability returns a boolean (does not throw)
  it("verifyPatchApplicability returns a boolean without throwing", async () => {
    const patchContent = "diff --git a/test.txt b/test.txt\n--- a/test.txt\n+++ b/test.txt\n@@ -1 +1 @@\n-old line\n+new line\n";
    const result = await verifyPatchApplicability(patchContent);
    expect(typeof result).toBe("boolean");
  }, 20_000);

  // 10. verifyPatchApplicability returns false for malformed patch
  it("verifyPatchApplicability returns false for a malformed patch string", async () => {
    const result = await verifyPatchApplicability("this is not a valid patch at all!!!!");
    expect(result).toBe(false);
  }, 20_000);

  // 11. runVerifiedTranche produces verified_instances with correct schema
  it("runVerifiedTranche produces verified_instances array with correct schema", async () => {
    const dir = makeDir();
    // Use synthetic patches: one valid (adds to a file in temp repo), one malformed
    const instances = [
      {
        instanceId: "test-instance-valid",
        patchContent: [
          "diff --git a/src/main.py b/src/main.py",
          "--- a/src/main.py",
          "+++ b/src/main.py",
          "@@ -1,2 +1,3 @@",
          " import os",
          " import sys",
          "+import json",
        ].join("\n") + "\n",
      },
      {
        instanceId: "test-instance-malformed",
        patchContent: "not a valid patch at all!!!",
      },
    ];
    const results = await runVerifiedTranche(instances, dir);
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(typeof r.instanceId).toBe("string");
      expect(typeof r.patchApplicable).toBe("boolean");
      expect(typeof r.verifiedAt).toBe("string");
    }
    // Malformed patch must not be applicable
    const malformed = results.find((r) => r.instanceId === "test-instance-malformed");
    expect(malformed?.patchApplicable).toBe(false);
  }, 30_000);

  // 12. getReproducedTranche reads from a seeded bench-results.json in tmpdir
  it("getReproducedTranche reads reproduced_tranche from a seeded file", () => {
    const dir = makeDir();
    const benchPath = join(dir, "bench-results.json");
    const data = {
      reproduced_tranche: [
        { instanceId: "a1", patchApplied: true, testsPassed: true, resolvedAt: new Date().toISOString() },
        { instanceId: "a2", patchApplied: true, testsPassed: false, resolvedAt: new Date().toISOString() },
        { instanceId: "a3", patchApplied: false, testsPassed: false, resolvedAt: new Date().toISOString() },
        { instanceId: "a4", patchApplied: true, testsPassed: true, resolvedAt: new Date().toISOString() },
        { instanceId: "a5", patchApplied: true, testsPassed: true, resolvedAt: new Date().toISOString() },
      ],
    };
    writeFileSync(benchPath, JSON.stringify(data), "utf-8");
    const tranche = getReproducedTranche(benchPath);
    expect(tranche.length).toBeGreaterThanOrEqual(5);
  });
});
