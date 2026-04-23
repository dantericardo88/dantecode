// Sprint CC-CD tests: ExplanationQualityMeter (dim 14) + OfflineCapabilityReport (dim 26)

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  analyzeExplanationQuality,
  recordExplanationQuality,
  loadExplanationQualityLog,
  getExplanationQualityStats,
} from "@dantecode/core";

import {
  classifyOllamaModel,
  buildOfflineCapabilityReport,
  recordOfflineCapabilityReport,
  loadOfflineCapabilityReports,
} from "@dantecode/core";

// ── Helpers ───────────────────────────────────────────────────────────────────

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "dante-cc-cd-"));
}

// ── ExplanationQualityMeter tests ─────────────────────────────────────────────

describe("analyzeExplanationQuality", () => {
  it("detects hasCodeExample when text has ``` block", () => {
    const text = "Here is how it works:\n```ts\nconst x = 1;\n```\nThat's it.";
    const result = analyzeExplanationQuality(text);
    expect(result.signals.hasCodeExample).toBe(true);
  });

  it("detects mentionsWhyNotJustWhat with 'because'", () => {
    const text = "We use closures because they capture the surrounding scope.";
    const result = analyzeExplanationQuality(text);
    expect(result.signals.mentionsWhyNotJustWhat).toBe(true);
  });

  it("gives 'excellent' grade when score >= 0.8", () => {
    const text = [
      "Async/await simplifies asynchronous code because it reads like sync code.",
      "Think of it as a pause button for your function.",
      "1. Mark function async. 2. Use await before a promise.",
      "See the MDN documentation for full reference.",
      "```js\nasync function go() { await fetch(url); }\n```",
    ].join(" ");
    const result = analyzeExplanationQuality(text);
    expect(result.grade).toBe("excellent");
    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it("gives 'poor' grade for minimal text", () => {
    const text = "Use map.";
    const result = analyzeExplanationQuality(text);
    expect(result.grade).toBe("poor");
    expect(result.score).toBeLessThan(0.4);
  });

  it("suggestions include code example hint when no code block", () => {
    const text = "Use async/await because it is cleaner than callbacks.";
    const result = analyzeExplanationQuality(text);
    expect(result.suggestions).toContain("Add a code example to illustrate the concept");
  });

  it("detects hasNumberedSteps with '1.' pattern", () => {
    const text = "Follow these steps:\n1. Install dependencies\n2. Run the server";
    const result = analyzeExplanationQuality(text);
    expect(result.signals.hasNumberedSteps).toBe(true);
  });

  it("recordExplanationQuality creates the log file", () => {
    const dir = tempDir();
    try {
      const score = analyzeExplanationQuality("Because closures capture scope, they are powerful.");
      recordExplanationQuality(score, "sess-test-1", dir);
      const entries = loadExplanationQualityLog(dir);
      expect(entries.length).toBe(1);
      expect(entries[0]!.sessionId).toBe("sess-test-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("getExplanationQualityStats returns correct avgScore", () => {
    const entries = [
      { score: 0.8, grade: "excellent" },
      { score: 0.6, grade: "good" },
      { score: 0.4, grade: "fair" },
    ];
    const stats = getExplanationQualityStats(entries);
    expect(stats.avgScore).toBeCloseTo(0.6, 5);
    expect(stats.gradeDistribution["excellent"]).toBe(1);
    expect(stats.gradeDistribution["good"]).toBe(1);
    expect(stats.excellentRate).toBeCloseTo(1 / 3, 5);
  });
});

// ── OfflineCapabilityReport tests ─────────────────────────────────────────────

describe("classifyOllamaModel", () => {
  it("detects supportsFIM for 'deepseek-coder:7b'", () => {
    const info = classifyOllamaModel("deepseek-coder:7b");
    expect(info.supportsFIM).toBe(true);
  });

  it("returns qualityTier 'high' for 'llama3:70b'", () => {
    const info = classifyOllamaModel("llama3:70b");
    expect(info.qualityTier).toBe("high");
  });

  it("returns qualityTier 'medium' for '7b' models", () => {
    const info = classifyOllamaModel("mistral:7b");
    expect(info.qualityTier).toBe("medium");
  });

  it("returns qualityTier 'low' for small models", () => {
    const info = classifyOllamaModel("phi:nano");
    expect(info.qualityTier).toBe("low");
  });

  it("detects supportsFIM false for plain chat model", () => {
    const info = classifyOllamaModel("llama3:8b");
    expect(info.supportsFIM).toBe(false);
  });
});

describe("buildOfflineCapabilityReport", () => {
  it("returns offlineReadinessScore=0 when not available", () => {
    const report = buildOfflineCapabilityReport(false, []);
    expect(report.offlineReadinessScore).toBe(0);
    expect(report.ollamaAvailable).toBe(false);
  });

  it("selects correct recommendedFIMModel", () => {
    const report = buildOfflineCapabilityReport(true, [
      "llama3:8b",
      "deepseek-coder:7b",
      "codellama:70b",
    ]);
    expect(report.recommendedFIMModel).toBeDefined();
    // codellama:70b should win as FIM-capable + high tier
    expect(report.recommendedFIMModel).toBe("codellama:70b");
  });

  it("recordOfflineCapabilityReport creates the log file", () => {
    const dir = tempDir();
    try {
      const report = buildOfflineCapabilityReport(true, ["llama3:8b"]);
      recordOfflineCapabilityReport(report, dir);
      const entries = loadOfflineCapabilityReports(dir);
      expect(entries.length).toBe(1);
      expect(entries[0]!.ollamaAvailable).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadOfflineCapabilityReports reads seeded entries", () => {
    const dir = tempDir();
    try {
      const r1 = buildOfflineCapabilityReport(true, ["qwen:7b"]);
      const r2 = buildOfflineCapabilityReport(false, []);
      recordOfflineCapabilityReport(r1, dir);
      recordOfflineCapabilityReport(r2, dir);
      const entries = loadOfflineCapabilityReports(dir);
      expect(entries.length).toBe(2);
      expect(entries[0]!.ollamaAvailable).toBe(true);
      expect(entries[1]!.ollamaAvailable).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects canDoEmbeddings when nomic model is present", () => {
    const report = buildOfflineCapabilityReport(true, ["nomic-embed-text", "llama3:8b"]);
    expect(report.capabilities.canDoEmbeddings).toBe(true);
  });
});
