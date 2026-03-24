import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RunReportAccumulator,
  serializeRunReportToMarkdown,
  estimateRunCost,
  computeRunDuration,
  type RunReport,
} from "../../run-report.js";
import { EventSourcedCheckpointer } from "../../checkpointer.js";
import { scorePdseMetrics, type VerificationMetricScore } from "../../pdse-scorer.js";

// ---------------------------------------------------------------------------
// Test Suite — full pipeline e2e with real file I/O
// ---------------------------------------------------------------------------

describe("Full pipeline — RunReport + Checkpointer + PDSE integration", () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "full-pipeline-e2e-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    tmpDirs.length = 0;
  });

  it("RunReportAccumulator builds a complete report and serializes to markdown", () => {
    const acc = new RunReportAccumulator({
      project: "test-project",
      command: "/autoforge PRD-001",
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      dantecodeVersion: "0.9.0",
    });

    // Begin first entry
    acc.beginEntry("PRD-001: Feature X", "prds/prd-001.md");
    acc.recordFilesCreated([
      { path: "src/feature-x.ts", lines: 120 },
      { path: "src/feature-x.test.ts", lines: 45 },
    ]);
    acc.recordFilesModified([
      { path: "src/index.ts", added: 3, removed: 0 },
    ]);
    acc.recordTests({ created: 5, passing: 5, failing: 0 });
    acc.recordVerification({
      antiStub: { passed: true, violations: 0, details: [] },
      constitution: { passed: true, violations: 0, warnings: 0, details: [] },
      pdseScore: 92,
      pdseThreshold: 85,
      regenerationAttempts: 0,
      maxAttempts: 3,
    });
    acc.recordTokenUsage(50000, 8000);
    acc.completeEntry({
      status: "complete",
      summary: "Implemented Feature X with full test coverage",
    });

    // Begin second entry (failed)
    acc.beginEntry("PRD-002: Feature Y", "prds/prd-002.md");
    acc.recordTokenUsage(10000, 2000);
    acc.completeEntry({
      status: "failed",
      summary: "Could not implement Feature Y",
      failureReason: "TypeScript compiler errors",
      actionNeeded: "Fix type imports in src/feature-y.ts",
    });

    // Add manifest
    acc.addToManifest([
      { action: "created", path: "src/feature-x.ts", lines: 120 },
      { action: "created", path: "src/feature-x.test.ts", lines: 45 },
      { action: "modified", path: "src/index.ts", diff: "+3 -0" },
    ]);

    const report = acc.finalize();

    // Verify report structure
    expect(report.entries).toHaveLength(2);
    expect(report.entries[0]!.status).toBe("complete");
    expect(report.entries[1]!.status).toBe("failed");
    expect(report.tokenUsage.input).toBe(60000);
    expect(report.tokenUsage.output).toBe(10000);
    expect(report.costEstimate).toBeGreaterThan(0);
    expect(report.filesManifest).toHaveLength(3);

    // Serialize and verify markdown output
    const md = serializeRunReportToMarkdown(report);
    expect(md).toContain("# DanteCode Run Report");
    expect(md).toContain("test-project");
    expect(md).toContain("PRD-001: Feature X");
    expect(md).toContain("COMPLETE");
    expect(md).toContain("PRD-002: Feature Y");
    expect(md).toContain("FAILED");
    expect(md).toContain("TypeScript compiler errors");

    // Verbose mode includes more detail
    const mdVerbose = serializeRunReportToMarkdown(report, true);
    expect(mdVerbose).toContain("Anti-stub");
    expect(mdVerbose).toContain("Constitution");
    expect(mdVerbose).toContain("PDSE");
  });

  it("report can be persisted as JSON and re-read from disk", () => {
    const persistDir = makeTmpDir();

    const acc = new RunReportAccumulator({
      project: "persist-test",
      command: "/party",
      model: { provider: "anthropic", modelId: "claude-opus-4-6" },
      dantecodeVersion: "1.0.0",
    });

    acc.beginEntry("PRD-A", "a.md");
    acc.recordTests({ created: 3, passing: 3, failing: 0 });
    acc.completeEntry({ status: "complete", summary: "Done" });

    const report = acc.finalize();

    // Write to disk
    const reportPath = join(persistDir, "run-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

    // Read back
    const raw = readFileSync(reportPath, "utf-8");
    const loaded = JSON.parse(raw) as RunReport;

    expect(loaded.project).toBe("persist-test");
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0]!.prdName).toBe("PRD-A");
    expect(loaded.entries[0]!.tests.passing).toBe(3);
  });

  it("PDSE scores feed into RunReport verification data", () => {
    const metrics: VerificationMetricScore[] = [
      { name: "faithfulness", score: 0.95, passed: true, reason: "ok" },
      { name: "correctness", score: 0.9, passed: true, reason: "ok" },
      { name: "hallucination", score: 0.85, passed: true, reason: "ok" },
      { name: "completeness", score: 0.92, passed: true, reason: "ok" },
      { name: "safety", score: 1.0, passed: true, reason: "ok" },
    ];

    const pdseResult = scorePdseMetrics(metrics);
    expect(pdseResult.overallScore).toBeGreaterThan(0.85);
    expect(pdseResult.passedGate).toBe(true);

    // Use in report
    const acc = new RunReportAccumulator({
      project: "pdse-integration",
      command: "/verify",
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      dantecodeVersion: "0.9.0",
    });

    acc.beginEntry("Feature-Z", "z.md");
    acc.recordVerification({
      antiStub: { passed: true, violations: 0, details: [] },
      constitution: { passed: true, violations: 0, warnings: 0, details: [] },
      pdseScore: Math.round(pdseResult.overallScore * 100),
      pdseThreshold: 85,
      regenerationAttempts: 0,
      maxAttempts: 3,
    });
    acc.completeEntry({ status: "complete", summary: "Verified" });

    const report = acc.finalize();
    expect(report.entries[0]!.verification.pdseScore).toBeGreaterThanOrEqual(85);
  });

  it("checkpointer + report accumulator simulate a full session lifecycle", async () => {
    const persistDir = makeTmpDir();
    const sessionId = "pipeline-session";

    // Phase 1: Init checkpoint
    const checkpointer = new EventSourcedCheckpointer("unused", sessionId, {
      baseDir: persistDir,
    });

    await checkpointer.put(
      { phase: "started", prdCount: 2 },
      { source: "input", step: 0, triggerCommand: "/party prds/a.md prds/b.md" },
    );

    // Phase 2: Build report while checkpointing progress
    const acc = new RunReportAccumulator({
      project: "lifecycle-test",
      command: "/party",
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      dantecodeVersion: "0.9.0",
    });

    acc.beginEntry("PRD-A", "a.md");
    acc.recordFilesCreated([{ path: "src/a.ts", lines: 50 }]);
    acc.completeEntry({ status: "complete", summary: "A done" });

    await checkpointer.putWrite({
      taskId: "prd-a",
      channel: "prd-a-status",
      value: "complete",
      timestamp: new Date().toISOString(),
    });

    acc.beginEntry("PRD-B", "b.md");
    acc.completeEntry({
      status: "failed",
      summary: "B failed",
      failureReason: "build error",
    });

    await checkpointer.putWrite({
      taskId: "prd-b",
      channel: "prd-b-status",
      value: "failed",
      timestamp: new Date().toISOString(),
    });

    // Finalize
    const report = acc.finalize();
    const reportPath = join(persistDir, "final-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

    // Phase 3: Verify everything on disk
    const baseStatePath = join(persistDir, sessionId, "base_state.json");
    expect(existsSync(baseStatePath)).toBe(true);
    expect(existsSync(reportPath)).toBe(true);

    const loadedReport = JSON.parse(readFileSync(reportPath, "utf-8")) as RunReport;
    expect(loadedReport.entries).toHaveLength(2);
    expect(loadedReport.entries[0]!.status).toBe("complete");
    expect(loadedReport.entries[1]!.status).toBe("failed");

    // Phase 4: New checkpointer instance can recover
    const checkpointer2 = new EventSourcedCheckpointer("unused", sessionId, {
      baseDir: persistDir,
    });
    const eventsReplayed = await checkpointer2.resume();
    expect(eventsReplayed).toBeGreaterThan(0);

    const tuple = await checkpointer2.getTuple();
    expect(tuple).not.toBeNull();
    expect(tuple!.pendingWrites).toHaveLength(2);
    expect(tuple!.pendingWrites[0]!.value).toBe("complete");
    expect(tuple!.pendingWrites[1]!.value).toBe("failed");
  });

  it("cost estimation produces correct values for known models", () => {
    // claude-sonnet-4-6: $3/M input, $15/M output
    const cost = estimateRunCost("claude-sonnet-4-6", 1_000_000, 100_000);
    expect(cost).toBeCloseTo(3 + 1.5, 2); // $3 input + $1.5 output

    // claude-opus-4-6: $15/M input, $75/M output
    const costOpus = estimateRunCost("claude-opus-4-6", 500_000, 50_000);
    expect(costOpus).toBeCloseTo(7.5 + 3.75, 2); // $7.5 input + $3.75 output
  });

  it("duration formatting handles various time ranges", () => {
    const now = new Date();
    const seconds30 = new Date(now.getTime() + 30_000);
    const minutes5 = new Date(now.getTime() + 5 * 60_000 + 12_000);
    const hours2 = new Date(now.getTime() + 2 * 3600_000 + 15 * 60_000);

    expect(computeRunDuration(now.toISOString(), seconds30.toISOString())).toBe("30s");
    expect(computeRunDuration(now.toISOString(), minutes5.toISOString())).toBe("5m 12s");
    expect(computeRunDuration(now.toISOString(), hours2.toISOString())).toBe("2h 15m");
  });
});
