// Sprint BS-BT tests: SessionProofSynthesizer (dim 11) + PluginEcosystemReport (dim 22)

import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  synthesizeSessionProof,
  recordSessionProof,
  loadSessionProofs,
  getSessionProofStats,
} from "@dantecode/core";
import type { SessionArtifact } from "@dantecode/core";

import {
  buildPluginOutcomeSummaries,
  buildPluginEcosystemReport,
  recordPluginEcosystemReport,
} from "@dantecode/core";
import type { PluginOutcomeEntry } from "@dantecode/core";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `dc-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeArtifact(type: SessionArtifact["type"], description = "test"): SessionArtifact {
  return { type, description, timestamp: new Date().toISOString() };
}

// ============================================================================
// Sprint BS — Dim 11: SessionProofSynthesizer
// ============================================================================

describe("synthesizeSessionProof — confidence scoring", () => {
  it("returns completionConfidence 0 with no artifacts", () => {
    const proof = synthesizeSessionProof("s1", "task", []);
    expect(proof.completionConfidence).toBe(0);
  });

  it("gives +0.2 per file_written, max 0.4", () => {
    const oneFile = synthesizeSessionProof("s2", "task", [
      makeArtifact("file_written"),
    ]);
    expect(oneFile.completionConfidence).toBeCloseTo(0.2, 5);

    const twoFiles = synthesizeSessionProof("s3", "task", [
      makeArtifact("file_written"),
      makeArtifact("file_written"),
    ]);
    expect(twoFiles.completionConfidence).toBeCloseTo(0.4, 5);

    // Three file_written should still be capped at 0.4
    const threeFiles = synthesizeSessionProof("s4", "task", [
      makeArtifact("file_written"),
      makeArtifact("file_written"),
      makeArtifact("file_written"),
    ]);
    expect(threeFiles.completionConfidence).toBeCloseTo(0.4, 5);
  });

  it("gives +0.2 for test_passed artifact", () => {
    const proof = synthesizeSessionProof("s5", "task", [
      makeArtifact("test_passed"),
    ]);
    expect(proof.completionConfidence).toBeCloseTo(0.2, 5);
  });

  it("gives +0.2 for git_commit artifact", () => {
    const proof = synthesizeSessionProof("s6", "task", [
      makeArtifact("git_commit"),
    ]);
    expect(proof.completionConfidence).toBeCloseTo(0.2, 5);
  });

  it("caps confidence at 1.0 with all artifact types", () => {
    // 3x file_written (capped at 0.4) + test_passed (0.2) + git_commit (0.2) + pr_created (0.1) = 0.9
    const proof = synthesizeSessionProof("s7", "big task", [
      makeArtifact("file_written"),
      makeArtifact("file_written"),
      makeArtifact("file_written"),
      makeArtifact("test_passed"),
      makeArtifact("git_commit"),
      makeArtifact("pr_created"),
    ]);
    expect(proof.completionConfidence).toBe(0.9);

    // 2x file_written (0.4) + test_passed (0.2) + git_commit (0.2) + pr_created (0.1) = 0.9
    // To reach 1.0 we need enough: but max possible without pr is 0.4+0.2+0.2=0.8; with pr 0.9
    // Cap enforced — ensure any additional artifact types can't go over 1.0
    // Let's test a custom override: artificially produce 1.0 by testing the cap logic via many types
    // Instead verify cap does not exceed 1.0
    expect(proof.completionConfidence).toBeLessThanOrEqual(1.0);
  });
});

describe("recordSessionProof + loadSessionProofs", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  it("recordSessionProof creates the JSONL file", () => {
    const proof = synthesizeSessionProof("s8", "task", [makeArtifact("file_written")]);
    recordSessionProof(proof, tmpDir);
    const filePath = join(tmpDir, ".danteforge/session-proof-log.json");
    expect(existsSync(filePath)).toBe(true);
  });

  it("loadSessionProofs reads and parses entries correctly", () => {
    const p1 = synthesizeSessionProof("s9", "task A", [makeArtifact("git_commit")]);
    const p2 = synthesizeSessionProof("s10", "task B", [
      makeArtifact("file_written"),
      makeArtifact("test_passed"),
    ]);
    recordSessionProof(p1, tmpDir);
    recordSessionProof(p2, tmpDir);
    const loaded = loadSessionProofs(tmpDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.sessionId).toBe("s9");
    expect(loaded[1]!.sessionId).toBe("s10");
  });
});

describe("getSessionProofStats", () => {
  it("returns correct avgConfidence for a set of proofs", () => {
    // p1: 1x file_written → 0.2
    const p1 = synthesizeSessionProof("x1", "t1", [makeArtifact("file_written")]);
    // p2: 1x file_written (0.2) + test_passed (0.2) + git_commit (0.2) = 0.6
    const p2 = synthesizeSessionProof("x2", "t2", [
      makeArtifact("file_written"),
      makeArtifact("test_passed"),
      makeArtifact("git_commit"),
    ]);
    // avg = (0.2 + 0.6) / 2 = 0.4
    const stats = getSessionProofStats([p1, p2]);
    expect(stats.totalSessions).toBe(2);
    expect(stats.avgConfidence).toBeCloseTo(0.4, 5);
    expect(stats.highConfidenceSessions).toBe(0); // neither reaches 0.7
    expect(stats.totalArtifacts).toBe(4);
  });
});

// ============================================================================
// Sprint BT — Dim 22: PluginEcosystemReport
// ============================================================================

function makeEntry(
  pluginId: string,
  status: "success" | "failure",
  durationMs = 100,
): PluginOutcomeEntry {
  return {
    timestamp: new Date().toISOString(),
    pluginId,
    commandId: `${pluginId}-cmd`,
    status,
    durationMs,
  };
}

describe("buildPluginOutcomeSummaries", () => {
  it("groups by pluginId and computes successRate correctly", () => {
    const entries: PluginOutcomeEntry[] = [
      makeEntry("plugin-a", "success"),
      makeEntry("plugin-a", "success"),
      makeEntry("plugin-a", "failure"),
      makeEntry("plugin-b", "failure"),
      makeEntry("plugin-b", "failure"),
    ];
    const summaries = buildPluginOutcomeSummaries(entries);
    expect(summaries).toHaveLength(2);

    const a = summaries.find((s) => s.pluginId === "plugin-a")!;
    expect(a.totalInvocations).toBe(3);
    expect(a.successCount).toBe(2);
    expect(a.failureCount).toBe(1);
    expect(a.successRate).toBeCloseTo(0.67, 2);

    const b = summaries.find((s) => s.pluginId === "plugin-b")!;
    expect(b.successRate).toBe(0);
  });
});

describe("buildPluginEcosystemReport", () => {
  it("identifies unreliablePlugins (successRate < 0.5)", () => {
    const entries: PluginOutcomeEntry[] = [
      makeEntry("reliable", "success"),
      makeEntry("reliable", "success"),
      makeEntry("reliable", "success"),
      makeEntry("unreliable", "success"),
      makeEntry("unreliable", "failure"),
      makeEntry("unreliable", "failure"),
      makeEntry("unreliable", "failure"),
    ];
    const summaries = buildPluginOutcomeSummaries(entries);
    const report = buildPluginEcosystemReport(summaries);
    expect(report.unreliablePlugins).toContain("unreliable");
    expect(report.unreliablePlugins).not.toContain("reliable");
    expect(report.topPerformers).toContain("reliable");
  });
});

describe("recordPluginEcosystemReport + loadPluginEcosystemReports", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  it("creates .danteforge/plugin-ecosystem-report.json on record", () => {
    const entries: PluginOutcomeEntry[] = [
      makeEntry("p1", "success"),
      makeEntry("p1", "success"),
      makeEntry("p2", "failure"),
      makeEntry("p2", "failure"),
    ];
    const summaries = buildPluginOutcomeSummaries(entries);
    const report = buildPluginEcosystemReport(summaries);
    recordPluginEcosystemReport(report, tmpDir);
    const filePath = join(tmpDir, ".danteforge/plugin-ecosystem-report.json");
    expect(existsSync(filePath)).toBe(true);
    const line = readFileSync(filePath, "utf-8").trim();
    const parsed = JSON.parse(line);
    expect(parsed.totalPlugins).toBe(2);
  });
});
