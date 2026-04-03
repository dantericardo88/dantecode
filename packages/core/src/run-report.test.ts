import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RunReportAccumulator,
  serializeRunReportToMarkdown,
  computeRunDuration,
  estimateRunCost,
} from "./run-report.js";
import type { RunReport, RunReportEntry } from "./run-report.js";

// ─── Helper ─────────────────────────────────────────────────────────────────

function makeAccumulator() {
  return new RunReportAccumulator({
    project: "TestProject",
    command: "/party --autoforge build everything",
    model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
    dantecodeVersion: "1.3.0",
  });
}

function makeCompleteEntry(acc: RunReportAccumulator, name: string, pdseScore = 90) {
  acc.beginEntry(name, `prds/${name}.md`);
  acc.recordFilesCreated([{ path: `src/${name}.ts`, lines: 100 }]);
  acc.recordFilesModified([{ path: "src/index.ts", added: 5, removed: 1 }]);
  acc.recordVerification({
    antiStub: { passed: true, violations: 0, details: [] },
    constitution: { passed: true, violations: 0, warnings: 0, details: [] },
    pdseScore,
    pdseThreshold: 85,
    regenerationAttempts: 0,
    maxAttempts: 3,
  });
  acc.recordTests({ created: 5, passing: 5, failing: 0 });
  acc.recordTokenUsage(5000, 3000);
  acc.completeEntry({ status: "complete", summary: `Built the ${name} feature.` });
}

// ─── RunReportAccumulator ───────────────────────────────────────────────────

describe("RunReportAccumulator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T14:30:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructs with correct defaults", () => {
    const acc = makeAccumulator();
    const report = acc.snapshot();
    expect(report.project).toBe("TestProject");
    expect(report.command).toBe("/party --autoforge build everything");
    expect(report.model.provider).toBe("anthropic");
    expect(report.entries).toHaveLength(0);
    expect(report.tokenUsage).toEqual({ input: 0, output: 0 });
    expect(report.costEstimate).toBe(0);
    expect(report.dantecodeVersion).toBe("1.3.0");
  });

  it("beginEntry creates a pending entry", () => {
    const acc = makeAccumulator();
    acc.beginEntry("auth", "prds/01-auth.md");
    const report = acc.snapshot();
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]!.prdName).toBe("auth");
    expect(report.entries[0]!.prdFile).toBe("prds/01-auth.md");
    expect(report.entries[0]!.status).toBe("not_attempted");
  });

  it("completeEntry sets status, summary, and timestamps", () => {
    const acc = makeAccumulator();
    acc.beginEntry("auth", "prds/01-auth.md");

    vi.setSystemTime(new Date("2026-03-22T14:45:00Z"));
    acc.completeEntry({
      status: "complete",
      summary: "Built auth system.",
    });

    const entry = acc.snapshot().entries[0]!;
    expect(entry.status).toBe("complete");
    expect(entry.summary).toBe("Built auth system.");
    expect(entry.completedAt).toBe("2026-03-22T14:45:00.000Z");
  });

  it("records file operations", () => {
    const acc = makeAccumulator();
    acc.beginEntry("auth", "prds/01-auth.md");
    acc.recordFilesCreated([
      { path: "src/auth.ts", lines: 100 },
      { path: "src/auth.test.ts", lines: 50 },
    ]);
    acc.recordFilesModified([{ path: "src/index.ts", added: 3, removed: 0 }]);
    acc.recordFilesDeleted(["src/old-auth.ts"]);

    const entry = acc.snapshot().entries[0]!;
    expect(entry.filesCreated).toHaveLength(2);
    expect(entry.filesModified).toHaveLength(1);
    expect(entry.filesDeleted).toEqual(["src/old-auth.ts"]);
  });

  it("records verification results", () => {
    const acc = makeAccumulator();
    acc.beginEntry("auth", "prds/01-auth.md");
    acc.recordVerification({
      antiStub: { passed: false, violations: 2, details: ["empty fn at line 12"] },
      constitution: { passed: true, violations: 0, warnings: 1, details: ["hardcoded config"] },
      pdseScore: 78,
      pdseThreshold: 85,
      regenerationAttempts: 2,
      maxAttempts: 3,
    });

    const v = acc.snapshot().entries[0]!.verification;
    expect(v.antiStub.passed).toBe(false);
    expect(v.antiStub.violations).toBe(2);
    expect(v.pdseScore).toBe(78);
    expect(v.regenerationAttempts).toBe(2);
  });

  it("records test results", () => {
    const acc = makeAccumulator();
    acc.beginEntry("auth", "prds/01-auth.md");
    acc.recordTests({ created: 10, passing: 8, failing: 2 });

    const t = acc.snapshot().entries[0]!.tests;
    expect(t.created).toBe(10);
    expect(t.passing).toBe(8);
    expect(t.failing).toBe(2);
  });

  it("accumulates token usage per entry", () => {
    const acc = makeAccumulator();
    acc.beginEntry("auth", "prds/01-auth.md");
    acc.recordTokenUsage(1000, 500);
    acc.recordTokenUsage(2000, 1500);

    const usage = acc.snapshot().entries[0]!.tokenUsage;
    expect(usage.input).toBe(3000);
    expect(usage.output).toBe(2000);
  });

  it("snapshot returns valid partial report mid-execution", () => {
    const acc = makeAccumulator();
    makeCompleteEntry(acc, "auth");
    acc.beginEntry("api", "prds/02-api.md"); // Not completed yet

    const report = acc.snapshot();
    expect(report.entries).toHaveLength(2);
    expect(report.entries[0]!.status).toBe("complete");
    expect(report.entries[1]!.status).toBe("not_attempted");
  });

  it("finalize sets completedAt and computes totals", () => {
    const acc = makeAccumulator();
    makeCompleteEntry(acc, "auth");
    makeCompleteEntry(acc, "api");

    vi.setSystemTime(new Date("2026-03-22T15:30:00Z"));
    const report = acc.finalize();

    expect(report.completedAt).toBe("2026-03-22T15:30:00.000Z");
    expect(report.tokenUsage.input).toBe(10000); // 5000 * 2
    expect(report.tokenUsage.output).toBe(6000); // 3000 * 2
    expect(report.costEstimate).toBeGreaterThan(0);
  });

  it("finalize respects explicitly set global token usage", () => {
    const acc = makeAccumulator();
    makeCompleteEntry(acc, "auth");
    acc.setGlobalTokenUsage(50000, 30000);

    const report = acc.finalize();
    expect(report.tokenUsage.input).toBe(50000);
    expect(report.tokenUsage.output).toBe(30000);
  });

  it("markRemainingNotAttempted creates entries for unstarted PRDs", () => {
    const acc = makeAccumulator();
    makeCompleteEntry(acc, "auth");
    acc.markRemainingNotAttempted("Context window exhausted", ["api", "deploy"]);

    const report = acc.snapshot();
    expect(report.entries).toHaveLength(3);
    expect(report.entries[1]!.prdName).toBe("api");
    expect(report.entries[1]!.status).toBe("not_attempted");
    expect(report.entries[1]!.actionNeeded).toBe("Context window exhausted");
    expect(report.entries[2]!.prdName).toBe("deploy");
  });

  it("markRemainingNotAttempted skips already-existing entries", () => {
    const acc = makeAccumulator();
    makeCompleteEntry(acc, "auth");
    acc.markRemainingNotAttempted("Stopped early", ["auth", "api"]);

    const report = acc.snapshot();
    expect(report.entries).toHaveLength(2); // auth (complete) + api (not_attempted)
    expect(report.entries[0]!.status).toBe("complete");
    expect(report.entries[1]!.prdName).toBe("api");
  });

  it("addToManifest appends to global manifest", () => {
    const acc = makeAccumulator();
    acc.addToManifest([
      { action: "created", path: "src/auth.ts", lines: 100 },
      { action: "modified", path: "src/index.ts" },
    ]);

    const report = acc.snapshot();
    expect(report.filesManifest).toHaveLength(2);
    expect(report.filesManifest[0]!.action).toBe("created");
    expect(report.filesManifest[1]!.action).toBe("modified");
  });

  it("completeEntry with failure fields", () => {
    const acc = makeAccumulator();
    acc.beginEntry("api", "prds/02-api.md");
    acc.completeEntry({
      status: "failed",
      summary: "Route handlers generated.",
      failureReason: "Empty function bodies for write operations.",
      actionNeeded: "Implement POST/PUT/DELETE handlers manually.",
    });

    const entry = acc.snapshot().entries[0]!;
    expect(entry.status).toBe("failed");
    expect(entry.failureReason).toContain("Empty function bodies");
    expect(entry.actionNeeded).toContain("Implement POST/PUT/DELETE");
  });

  it("setSealHash stamps sealHash onto finalized report", () => {
    const acc = makeAccumulator();
    const hash = "a".repeat(64);
    acc.setSealHash(hash);
    const report = acc.finalize();
    expect(report.sealHash).toBe(hash);
  });

  it("setSealHash is reflected in snapshot before finalize", () => {
    const acc = makeAccumulator();
    const hash = "b".repeat(64);
    acc.setSealHash(hash);
    expect(acc.snapshot().sealHash).toBe(hash);
  });
});

// ─── computeRunDuration ─────────────────────────────────────────────────────

describe("computeRunDuration", () => {
  it("formats sub-minute durations", () => {
    expect(computeRunDuration("2026-03-22T14:30:00Z", "2026-03-22T14:30:45Z")).toBe("45s");
  });

  it("formats minute-scale durations", () => {
    expect(computeRunDuration("2026-03-22T14:30:00Z", "2026-03-22T14:37:22Z")).toBe("7m 22s");
  });

  it("formats multi-hour durations", () => {
    expect(computeRunDuration("2026-03-22T14:30:00Z", "2026-03-22T16:15:00Z")).toBe("1h 45m");
  });

  it("handles zero duration", () => {
    expect(computeRunDuration("2026-03-22T14:30:00Z", "2026-03-22T14:30:00Z")).toBe("0s");
  });

  it("handles negative/reversed timestamps gracefully", () => {
    expect(computeRunDuration("2026-03-22T16:00:00Z", "2026-03-22T14:00:00Z")).toBe("0s");
  });
});

// ─── estimateRunCost ────────────────────────────────────────────────────────

describe("estimateRunCost", () => {
  it("computes cost for known model", () => {
    const cost = estimateRunCost("claude-sonnet-4-6", 100_000, 50_000);
    // 100K * 3/1M + 50K * 15/1M = 0.3 + 0.75 = 1.05
    expect(cost).toBeCloseTo(1.05, 2);
  });

  it("uses default rates for unknown model", () => {
    const cost = estimateRunCost("unknown-model", 100_000, 50_000);
    // Default: same as sonnet rates = 1.05
    expect(cost).toBeCloseTo(1.05, 2);
  });

  it("returns 0 for zero tokens", () => {
    expect(estimateRunCost("claude-sonnet-4-6", 0, 0)).toBe(0);
  });
});

// ─── serializeRunReportToMarkdown ───────────────────────────────────────────

describe("serializeRunReportToMarkdown", () => {
  function makeReport(overrides?: Partial<RunReport>): RunReport {
    return {
      project: "TestProject",
      command: "/party --autoforge build everything",
      startedAt: "2026-03-22T14:30:00Z",
      completedAt: "2026-03-22T15:45:00Z",
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      entries: [],
      filesManifest: [],
      tokenUsage: { input: 125000, output: 89000 },
      costEstimate: 1.71,
      dantecodeVersion: "1.3.0",
      environment: { nodeVersion: "v20.11.1", os: "win32 x64" },
      ...overrides,
    };
  }

  function makeEntry(overrides?: Partial<RunReportEntry>): RunReportEntry {
    return {
      prdName: "auth",
      prdFile: "prds/01-auth.md",
      status: "complete",
      filesCreated: [{ path: "src/auth.ts", lines: 100 }],
      filesModified: [{ path: "src/index.ts", added: 5, removed: 1 }],
      filesDeleted: [],
      verification: {
        antiStub: { passed: true, violations: 0, details: [] },
        constitution: { passed: true, violations: 0, warnings: 0, details: [] },
        pdseScore: 94,
        pdseThreshold: 85,
        regenerationAttempts: 0,
        maxAttempts: 3,
      },
      tests: { created: 5, passing: 5, failing: 0 },
      summary: "Built the auth feature.",
      startedAt: "2026-03-22T14:30:00Z",
      completedAt: "2026-03-22T14:45:00Z",
      tokenUsage: { input: 5000, output: 3000 },
      ...overrides,
    };
  }

  it("produces valid markdown with header", () => {
    const md = serializeRunReportToMarkdown(makeReport(), true);
    expect(md).toContain("# DanteCode Run Report");
    expect(md).toContain("**Project:** TestProject");
    expect(md).toContain("**Command:** /party --autoforge build everything");
    expect(md).toContain("**Duration:** 1h 15m");
    expect(md).toContain("**Model:** claude-sonnet-4-6 (anthropic)");
  });

  it("renders completion status table with correct counts", () => {
    const report = makeReport({
      entries: [
        makeEntry({ status: "complete", prdName: "auth" }),
        makeEntry({ status: "complete", prdName: "db" }),
        makeEntry({ status: "partial", prdName: "email" }),
        makeEntry({ status: "failed", prdName: "api" }),
        makeEntry({ status: "not_attempted", prdName: "deploy" }),
      ],
    });

    const md = serializeRunReportToMarkdown(report);
    expect(md).toContain("## Completion status");
    expect(md).toContain("Complete | 2");
    expect(md).toContain("Partial | 1");
    expect(md).toContain("Failed | 1");
    expect(md).toContain("Not attempted | 1");
    expect(md).toContain("**Total** | **5**");
    expect(md).toContain("**Completion rate: 40% (2/5)**");
  });

  it("shows needs-attention list for non-complete entries", () => {
    const report = makeReport({
      entries: [
        makeEntry({ status: "complete", prdName: "auth" }),
        makeEntry({ status: "failed", prdName: "api" }),
        makeEntry({ status: "partial", prdName: "email" }),
      ],
    });

    const md = serializeRunReportToMarkdown(report);
    expect(md).toContain("**Needs attention: api, email**");
  });

  it("renders status emojis correctly", () => {
    const report = makeReport({
      entries: [
        makeEntry({ status: "complete", prdName: "auth" }),
        makeEntry({ status: "failed", prdName: "api" }),
      ],
    });

    const md = serializeRunReportToMarkdown(report);
    expect(md).toContain("### auth \u2705 COMPLETE");
    expect(md).toContain("### api \u274C FAILED");
  });

  it("renders file lists in entry sections", () => {
    const report = makeReport({
      entries: [makeEntry()],
    });

    const md = serializeRunReportToMarkdown(report);
    expect(md).toContain("`src/auth.ts` (100 lines)");
    expect(md).toContain("`src/index.ts` \u2014 +5 -1");
  });

  it("renders verification details in verbose mode", () => {
    const report = makeReport({
      entries: [
        makeEntry({
          verification: {
            antiStub: { passed: false, violations: 2, details: ["empty fn at line 12"] },
            constitution: { passed: true, violations: 0, warnings: 1, details: ["hardcoded SMTP"] },
            pdseScore: 78,
            pdseThreshold: 85,
            regenerationAttempts: 3,
            maxAttempts: 3,
          },
        }),
      ],
    });

    const md = serializeRunReportToMarkdown(report, true);
    expect(md).toContain("Anti-stub: \u274C FAILED (2 violations)");
    expect(md).toContain("empty fn at line 12");
    expect(md).toContain("PDSE: 78/100 (below threshold 85)");
    expect(md).toContain("Regeneration attempts: 3/3");
  });

  it("renders failure and action-needed fields", () => {
    const report = makeReport({
      entries: [
        makeEntry({
          status: "failed",
          failureReason: "Empty function bodies.",
          actionNeeded: "Implement manually.",
        }),
      ],
    });

    const md = serializeRunReportToMarkdown(report);
    expect(md).toContain("**What went wrong:** Empty function bodies.");
    expect(md).toContain("**What needs to happen:** Implement manually.");
  });

  it("renders files changed table", () => {
    const report = makeReport({
      filesManifest: [
        { action: "created", path: "src/auth.ts", lines: 100 },
        { action: "modified", path: "src/index.ts", diff: "+5 -1" },
        { action: "deleted", path: "src/old.ts" },
      ],
    });

    const md = serializeRunReportToMarkdown(report);
    expect(md).toContain("## Files changed");
    expect(md).toContain("| CREATED | src/auth.ts | 100 |");
    expect(md).toContain("| MODIFIED | src/index.ts | +5 -1 |");
    expect(md).toContain("| DELETED | src/old.ts | - |");
    expect(md).toContain("**Total: 1 files created, 1 files modified, 1 files deleted**");
  });

  it("renders verification summary table in verbose mode", () => {
    const report = makeReport({
      entries: [
        makeEntry({ status: "complete" }),
        makeEntry({
          status: "failed",
          prdName: "api",
          verification: {
            antiStub: { passed: false, violations: 2, details: [] },
            constitution: { passed: true, violations: 0, warnings: 0, details: [] },
            pdseScore: 40,
            pdseThreshold: 85,
            regenerationAttempts: 3,
            maxAttempts: 3,
          },
        }),
      ],
    });

    const md = serializeRunReportToMarkdown(report, true);
    expect(md).toContain("## Verification summary");
    expect(md).toContain("| Anti-stub scan | 1 | 1 | 2 |");
    expect(md).toContain("| PDSE >= threshold | 1 | 1 | 2 |");
  });

  it("generates reproduction command for failed entries", () => {
    const report = makeReport({
      entries: [
        makeEntry({ status: "complete" }),
        makeEntry({
          status: "failed",
          prdName: "api",
          prdFile: "prds/02-api.md",
        }),
        makeEntry({
          status: "not_attempted",
          prdName: "deploy",
          prdFile: "prds/05-deploy.md",
        }),
      ],
    });

    const md = serializeRunReportToMarkdown(report);
    expect(md).toContain("prds/02-api.md");
    expect(md).toContain("prds/05-deploy.md");
  });

  it("shows 'no re-run needed' when all pass", () => {
    const report = makeReport({
      entries: [makeEntry({ status: "complete" })],
    });

    const md = serializeRunReportToMarkdown(report);
    expect(md).toContain("All tasks completed successfully. No re-run needed.");
  });

  it("renders environment section in verbose mode", () => {
    const md = serializeRunReportToMarkdown(makeReport(), true);
    expect(md).toContain("## Environment");
    expect(md).toContain("- DanteCode version: 1.3.0");
    expect(md).toContain("- Node.js: v20.11.1");
    expect(md).toContain("- Provider: anthropic");
  });

  it("handles empty entries gracefully", () => {
    const md = serializeRunReportToMarkdown(makeReport({ entries: [] }));
    expect(md).toContain("## Completion status");
    expect(md).toContain("**Total** | **0**");
    expect(md).toContain("**Completion rate: 0% (0/0)**");
  });

  it("contains all 6 required D-12 headings", () => {
    const report = makeReport({
      entries: [makeEntry()],
      filesManifest: [{ action: "created", path: "src/auth.ts", lines: 100 }],
    });
    const md = serializeRunReportToMarkdown(report);
    expect(md).toContain("## What was built");
    expect(md).toContain("## What needs attention");
    expect(md).toContain("## Completion status");
    expect(md).toContain("## Verification summary");
    expect(md).toContain("## Files changed");
    expect(md).toContain("## Reproduction");
  });

  it("contains all 6 required D-12 headings even with empty report", () => {
    const md = serializeRunReportToMarkdown(makeReport({ entries: [] }));
    expect(md).toContain("## What was built");
    expect(md).toContain("## What needs attention");
    expect(md).toContain("## Completion status");
    expect(md).toContain("## Verification summary");
    expect(md).toContain("## Files changed");
    expect(md).toContain("## Reproduction");
  });
});

// ─── Human-Friendly Output (non-verbose) ────────────────────────────────────

describe("serializeRunReportToMarkdown (human-friendly)", () => {
  function makeReport(overrides?: Partial<RunReport>): RunReport {
    return {
      project: "TestProject",
      command: "/party --autoforge build everything",
      startedAt: "2026-03-22T14:30:00Z",
      completedAt: "2026-03-22T15:45:00Z",
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      entries: [],
      filesManifest: [],
      tokenUsage: { input: 125000, output: 89000 },
      costEstimate: 1.71,
      dantecodeVersion: "1.3.0",
      environment: { nodeVersion: "v20.11.1", os: "win32 x64" },
      ...overrides,
    };
  }

  function makeEntry(overrides?: Partial<RunReportEntry>): RunReportEntry {
    return {
      prdName: "auth",
      prdFile: "prds/01-auth.md",
      status: "complete",
      filesCreated: [{ path: "src/auth.ts", lines: 100 }],
      filesModified: [{ path: "src/index.ts", added: 5, removed: 1 }],
      filesDeleted: [],
      verification: {
        antiStub: { passed: true, violations: 0, details: [] },
        constitution: { passed: true, violations: 0, warnings: 0, details: [] },
        pdseScore: 94,
        pdseThreshold: 85,
        regenerationAttempts: 0,
        maxAttempts: 3,
      },
      tests: { created: 5, passing: 5, failing: 0 },
      summary: "Built the auth feature.",
      startedAt: "2026-03-22T14:30:00Z",
      completedAt: "2026-03-22T14:45:00Z",
      tokenUsage: { input: 5000, output: 3000 },
      ...overrides,
    };
  }

  // Anti-jargon assertions
  it("does not contain 'Anti-stub' in non-verbose mode", () => {
    const md = serializeRunReportToMarkdown(makeReport({ entries: [makeEntry()] }));
    expect(md).not.toContain("Anti-stub");
  });

  it("does not contain 'PDSE' or raw score in non-verbose mode", () => {
    const md = serializeRunReportToMarkdown(makeReport({ entries: [makeEntry()] }));
    expect(md).not.toContain("PDSE");
    expect(md).not.toContain("94/100");
  });

  it("does not contain 'Constitution' in non-verbose mode", () => {
    const md = serializeRunReportToMarkdown(makeReport({ entries: [makeEntry()] }));
    expect(md).not.toContain("Constitution");
  });

  it("does not contain 'Regeneration' in non-verbose mode", () => {
    const md = serializeRunReportToMarkdown(makeReport({ entries: [makeEntry()] }));
    expect(md).not.toContain("Regeneration");
  });

  it("does not contain token counts in non-verbose mode", () => {
    const md = serializeRunReportToMarkdown(makeReport());
    expect(md).not.toContain("tokens");
  });

  it("contains 'Verification summary' in non-verbose mode", () => {
    const md = serializeRunReportToMarkdown(makeReport({ entries: [makeEntry()] }));
    expect(md).toContain("## Verification summary");
  });

  it("does not contain 'Environment' section in non-verbose mode", () => {
    const md = serializeRunReportToMarkdown(makeReport());
    expect(md).not.toContain("## Environment");
  });

  it("does not contain 'Model:' in non-verbose mode", () => {
    const md = serializeRunReportToMarkdown(makeReport());
    expect(md).not.toContain("**Model:**");
  });

  // Positive human-friendly checks
  it("shows 'All N tests pass' when all tests pass", () => {
    const md = serializeRunReportToMarkdown(
      makeReport({
        entries: [makeEntry({ tests: { created: 10, passing: 10, failing: 0 } })],
      }),
    );
    expect(md).toContain("All 10 tests pass");
  });

  it("shows 'N of M tests pass' when some tests fail", () => {
    const md = serializeRunReportToMarkdown(
      makeReport({
        entries: [makeEntry({ tests: { created: 10, passing: 8, failing: 2 } })],
      }),
    );
    expect(md).toContain("8 of 10 tests pass");
    expect(md).toContain("2 need attention");
  });

  it("omits test line when no tests were created", () => {
    const md = serializeRunReportToMarkdown(
      makeReport({
        entries: [makeEntry({ tests: { created: 0, passing: 0, failing: 0 } })],
      }),
    );
    expect(md).not.toContain("tests pass");
    expect(md).not.toContain("Tests:");
  });

  it("omits per-entry verification block for clean pass with zero regen", () => {
    const md = serializeRunReportToMarkdown(
      makeReport({
        entries: [makeEntry()],
      }),
    );
    // Per-entry section should have no verification lines
    expect(md).not.toContain("caught");
    expect(md).not.toContain("Review recommended");
    // Verification summary at the bottom is fine — it's the summary, not per-entry jargon
    expect(md).toContain("## Verification summary");
  });

  it("shows human verdict for caught-and-fixed issues", () => {
    const md = serializeRunReportToMarkdown(
      makeReport({
        entries: [
          makeEntry({
            verification: {
              antiStub: { passed: true, violations: 0, details: [] },
              constitution: { passed: true, violations: 0, warnings: 0, details: [] },
              pdseScore: 90,
              pdseThreshold: 85,
              regenerationAttempts: 3,
              maxAttempts: 3,
            },
          }),
        ],
      }),
    );
    expect(md).toContain("caught 3 issue(s) and fixed all of them");
  });

  it("shows stub violation language for anti-stub failures", () => {
    const md = serializeRunReportToMarkdown(
      makeReport({
        entries: [
          makeEntry({
            verification: {
              antiStub: { passed: false, violations: 2, details: ["empty fn at line 12"] },
              constitution: { passed: true, violations: 0, warnings: 0, details: [] },
              pdseScore: 78,
              pdseThreshold: 85,
              regenerationAttempts: 0,
              maxAttempts: 3,
            },
          }),
        ],
      }),
    );
    expect(md).toContain("stub violation");
    expect(md).toContain("empty fn at line 12");
    expect(md).not.toContain("Anti-stub");
  });

  it("shows cost without token counts in non-verbose mode", () => {
    const md = serializeRunReportToMarkdown(makeReport());
    expect(md).toContain("~$1.71");
    expect(md).not.toContain("input:");
    expect(md).not.toContain("output:");
  });

  it("shows 'Verification summary' heading in non-verbose mode", () => {
    const md = serializeRunReportToMarkdown(
      makeReport({
        entries: [makeEntry()],
      }),
    );
    expect(md).toContain("## Verification summary");
  });

  it("renders 'What needs attention' for non-complete entries", () => {
    const md = serializeRunReportToMarkdown(
      makeReport({
        entries: [
          makeEntry({ status: "complete" }),
          makeEntry({ status: "failed", prdName: "api", actionNeeded: "Implement manually." }),
        ],
      }),
    );
    expect(md).toContain("## What needs attention");
    expect(md).toContain("api");
    expect(md).toContain("Implement manually.");
  });

  it("shows 'Nothing requires attention' when all tasks complete", () => {
    const md = serializeRunReportToMarkdown(
      makeReport({
        entries: [makeEntry({ status: "complete" })],
      }),
    );
    expect(md).toContain("## What needs attention");
    expect(md).toContain("Nothing requires attention.");
  });
});

// ─── sealHash and pdseDetail tests ──────────────────────────────────────────

describe("serializeRunReportToMarkdown — sealHash and pdseDetail", () => {
  function makeReport(overrides?: Partial<RunReport>): RunReport {
    return {
      project: "TestProject",
      command: "/party --autoforge build everything",
      startedAt: "2026-03-22T14:30:00Z",
      completedAt: "2026-03-22T15:45:00Z",
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      entries: [],
      filesManifest: [],
      tokenUsage: { input: 125000, output: 89000 },
      costEstimate: 1.71,
      dantecodeVersion: "1.3.0",
      environment: { nodeVersion: "v20.11.1", os: "win32 x64" },
      ...overrides,
    };
  }

  function makeEntry(overrides?: Partial<RunReportEntry>): RunReportEntry {
    return {
      prdName: "auth",
      prdFile: "prds/01-auth.md",
      status: "complete",
      filesCreated: [{ path: "src/auth.ts", lines: 100 }],
      filesModified: [],
      filesDeleted: [],
      verification: {
        antiStub: { passed: true, violations: 0, details: [] },
        constitution: { passed: true, violations: 0, warnings: 0, details: [] },
        pdseScore: 94,
        pdseThreshold: 85,
        regenerationAttempts: 0,
        maxAttempts: 3,
      },
      tests: { created: 5, passing: 5, failing: 0 },
      summary: "Built the auth feature.",
      startedAt: "2026-03-22T14:30:00Z",
      completedAt: "2026-03-22T14:45:00Z",
      tokenUsage: { input: 5000, output: 3000 },
      ...overrides,
    };
  }

  // ── sealHash tests ──────────────────────────────────────────────────────

  it("renders Receipt Seal footer when sealHash is set", () => {
    const sealHash = "a".repeat(64); // 64-char hex string
    const md = serializeRunReportToMarkdown(makeReport({ sealHash }));
    expect(md).toContain("**Receipt Seal**");
    expect(md).toContain("SHA256:");
  });

  it("omits Receipt Seal section when sealHash is undefined", () => {
    const md = serializeRunReportToMarkdown(makeReport());
    expect(md).not.toContain("**Receipt Seal**");
    expect(md).not.toContain("SHA256:");
  });

  it("sealHash display uses correct 16-char prefix and 8-char suffix format", () => {
    // 64-char hex hash (typical SHA-256)
    const sealHash = "0123456789abcdef".repeat(4); // 64 chars
    const md = serializeRunReportToMarkdown(makeReport({ sealHash }));
    // First 16 chars: "0123456789abcdef"
    // Last 8 chars: "abcdef" repeated last portion = "cdef0123" at position 56..64 = "cdef0123"
    // Actually: repeat 4 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    // slice(0,16) = "0123456789abcdef"
    // slice(-8)   = "89abcdef"
    expect(md).toContain("0123456789abcdef...89abcdef");
  });

  it("sealHash is shown after the Reproduction section", () => {
    const sealHash = "deadbeef".repeat(8); // 64 chars
    const md = serializeRunReportToMarkdown(makeReport({ sealHash }));
    const reproIdx = md.indexOf("## Reproduction");
    const sealIdx = md.indexOf("**Receipt Seal**");
    expect(reproIdx).toBeGreaterThanOrEqual(0);
    expect(sealIdx).toBeGreaterThanOrEqual(0);
    expect(sealIdx).toBeGreaterThan(reproIdx);
  });

  // ── pdseDetail tests ────────────────────────────────────────────────────

  it("shows PDSE dimension detail in verbose mode when pdseDetail present and score below threshold", () => {
    const md = serializeRunReportToMarkdown(
      makeReport({
        entries: [
          makeEntry({
            verification: {
              antiStub: { passed: true, violations: 0, details: [] },
              constitution: { passed: true, violations: 0, warnings: 0, details: [] },
              pdseScore: 71,
              pdseThreshold: 85,
              regenerationAttempts: 0,
              maxAttempts: 3,
              pdseDetail: {
                completeness: 41,
                correctness: 88,
                clarity: 72,
                consistency: 83,
              },
            },
          }),
        ],
      }),
      true, // verbose
    );
    expect(md).toContain("PDSE: 71/100 (below threshold 85)");
    expect(md).toContain("Completeness: 41");
    expect(md).toContain("Correctness: 88");
    expect(md).toContain("Clarity: 72");
    expect(md).toContain("Consistency: 83");
  });

  it("shows plain PDSE line in verbose mode when no pdseDetail", () => {
    const md = serializeRunReportToMarkdown(
      makeReport({
        entries: [
          makeEntry({
            verification: {
              antiStub: { passed: true, violations: 0, details: [] },
              constitution: { passed: true, violations: 0, warnings: 0, details: [] },
              pdseScore: 71,
              pdseThreshold: 85,
              regenerationAttempts: 0,
              maxAttempts: 3,
            },
          }),
        ],
      }),
      true,
    );
    expect(md).toContain("PDSE: 71/100 (below threshold 85)");
    expect(md).not.toContain("Completeness:");
  });

  it("shows PDSE dimension detail in human-friendly failure text when pdseDetail present", () => {
    const md = serializeRunReportToMarkdown(
      makeReport({
        entries: [
          makeEntry({
            verification: {
              antiStub: { passed: true, violations: 0, details: [] },
              constitution: { passed: true, violations: 0, warnings: 0, details: [] },
              pdseScore: 55,
              pdseThreshold: 85,
              regenerationAttempts: 0,
              maxAttempts: 3,
              pdseDetail: {
                completeness: 41,
                correctness: 88,
                clarity: 72,
                consistency: 83,
              },
            },
          }),
        ],
      }),
    );
    // In non-verbose mode, the humanizeVerification function should show dimension detail
    expect(md).toContain("PDSE 55/100");
    expect(md).toContain("Completeness: 41");
    expect(md).toContain("Correctness: 88");
    expect(md).toContain("Clarity: 72");
    expect(md).toContain("Consistency: 83");
  });

  it("RunReport interface accepts sealHash as optional field", () => {
    const report = makeReport({ sealHash: "abc123".padEnd(64, "0") });
    expect(report.sealHash).toBe("abc123".padEnd(64, "0"));

    const reportNoSeal = makeReport();
    expect(reportNoSeal.sealHash).toBeUndefined();
  });

  it("serializeRunReportToMarkdown renders Receipt Seal footer when sealHash present", () => {
    const hash = "c".repeat(64);
    const md = serializeRunReportToMarkdown(makeReport({ sealHash: hash }), false);
    expect(md).toContain("Receipt Seal");
    expect(md).toContain("SHA256:");
    expect(md).toContain(hash.slice(0, 16));
  });
});
