// ============================================================================
// @dantecode/core — Run Report Types, Accumulator, and Serializer
// D-11: Run Report Generation — The Trust Layer
// ============================================================================

// ─── Types ──────────────────────────────────────────────────────────────────

export type RunReportStatus = "complete" | "partial" | "failed" | "not_attempted";
export type RunReportExecutionStage =
  | "planned"
  | "proposed"
  | "applied"
  | "verified"
  | "failed"
  | "restored";

export interface RunReportTimelineEvent {
  kind:
    | "checkpoint"
    | "approval_requested"
    | "approval_granted"
    | "approval_denied"
    | "restore"
    | "skill_receipt"
    | "artifact";
  label: string;
  at: string;
  detail?: string;
  artifactRef?: string;
}

export interface RunReportFileCreated {
  path: string;
  lines: number;
}

export interface RunReportFileModified {
  path: string;
  added: number;
  removed: number;
}

export interface RunReportVerification {
  antiStub: { passed: boolean; violations: number; details: string[] };
  constitution: {
    passed: boolean;
    violations: number;
    warnings: number;
    details: string[];
  };
  pdseScore: number;
  pdseThreshold: number;
  regenerationAttempts: number;
  maxAttempts: number;
  /** Breakdown of PDSE score by dimension */
  pdseDetail?: {
    completeness: number;
    correctness: number;
    clarity: number;
    consistency: number;
  };
}

export interface RunReportTests {
  created: number;
  passing: number;
  failing: number;
}

export interface RunReportEntry {
  prdName: string;
  prdFile: string;
  status: RunReportStatus;
  executionStages?: RunReportExecutionStage[];
  filesCreated: RunReportFileCreated[];
  filesModified: RunReportFileModified[];
  filesDeleted: string[];
  verification: RunReportVerification;
  tests: RunReportTests;
  completionVerification?: import("./completion-verifier.js").CompletionVerification;
  mode?: string;
  timeline?: RunReportTimelineEvent[];
  receiptRefs?: string[];
  artifactRefs?: string[];
  summary: string;
  failureReason?: string;
  actionNeeded?: string;
  startedAt: string;
  completedAt: string;
  tokenUsage: { input: number; output: number };
}

export interface RunReportManifestEntry {
  action: "created" | "modified" | "deleted";
  path: string;
  lines?: number;
  diff?: string;
}

export interface RunReport {
  project: string;
  command: string;
  startedAt: string;
  completedAt: string;
  model: { provider: string; modelId: string };
  entries: RunReportEntry[];
  filesManifest: RunReportManifestEntry[];
  tokenUsage: { input: number; output: number };
  costEstimate: number;
  dantecodeVersion: string;
  environment: { nodeVersion: string; os: string };
  /** Cryptographic seal hash from evidence-chain EvidenceSealer. Shown in report footer. */
  sealHash?: string;
}

const EXECUTION_STAGE_ORDER: RunReportExecutionStage[] = [
  "planned",
  "proposed",
  "applied",
  "verified",
  "failed",
  "restored",
];

// ─── Cost Estimation ────────────────────────────────────────────────────────

const COST_PER_1M: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
};

export function estimateRunCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = COST_PER_1M[modelId] ?? { input: 3, output: 15 };
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

// ─── Duration Formatting ────────────────────────────────────────────────────

export function computeRunDuration(startedAt: string, completedAt: string): string {
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(completedAt).getTime();
  const diffMs = Math.max(0, endMs - startMs);

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// ─── Default Verification ───────────────────────────────────────────────────

function defaultVerification(): RunReportVerification {
  return {
    antiStub: { passed: true, violations: 0, details: [] },
    constitution: { passed: true, violations: 0, warnings: 0, details: [] },
    pdseScore: 0,
    pdseThreshold: 85,
    regenerationAttempts: 0,
    maxAttempts: 0,
  };
}

function defaultTests(): RunReportTests {
  return { created: 0, passing: 0, failing: 0 };
}

export function normalizeExecutionStages(
  stages: RunReportExecutionStage[] | undefined,
): RunReportExecutionStage[] {
  const seen = new Set<RunReportExecutionStage>();
  const normalized: RunReportExecutionStage[] = [];

  for (const stage of stages ?? []) {
    if (!EXECUTION_STAGE_ORDER.includes(stage) || seen.has(stage)) {
      continue;
    }
    seen.add(stage);
    normalized.push(stage);
  }

  return normalized;
}

export function deriveStatusFromExecutionStages(
  stages: RunReportExecutionStage[] | undefined,
): RunReportStatus {
  const normalized = normalizeExecutionStages(stages);
  if (normalized.length === 0) {
    return "not_attempted";
  }

  if (normalized.includes("verified")) {
    return "complete";
  }

  if (normalized.includes("failed") && !normalized.includes("restored")) {
    return "failed";
  }

  if (
    normalized.includes("restored") ||
    normalized.includes("applied") ||
    normalized.includes("proposed")
  ) {
    return "partial";
  }

  return "not_attempted";
}

export function countExecutionStages(
  entries: RunReportEntry[],
): Record<RunReportExecutionStage, number> {
  const counts: Record<RunReportExecutionStage, number> = {
    planned: 0,
    proposed: 0,
    applied: 0,
    verified: 0,
    failed: 0,
    restored: 0,
  };

  for (const entry of entries) {
    for (const stage of normalizeExecutionStages(entry.executionStages)) {
      counts[stage]++;
    }
  }

  return counts;
}

// ─── Accumulator ────────────────────────────────────────────────────────────

export interface RunReportAccumulatorOptions {
  project: string;
  command: string;
  model: { provider: string; modelId: string };
  dantecodeVersion: string;
}

export class RunReportAccumulator {
  private report: RunReport;
  private currentEntryIndex: number = -1;

  constructor(opts: RunReportAccumulatorOptions) {
    const now = new Date().toISOString();
    this.report = {
      project: opts.project,
      command: opts.command,
      startedAt: now,
      completedAt: now,
      model: opts.model,
      entries: [],
      filesManifest: [],
      tokenUsage: { input: 0, output: 0 },
      costEstimate: 0,
      dantecodeVersion: opts.dantecodeVersion,
      environment: {
        nodeVersion: process.version,
        os: `${process.platform} ${process.arch}`,
      },
    };
  }

  /** Start tracking a new PRD/task entry. */
  beginEntry(prdName: string, prdFile: string): void {
    const now = new Date().toISOString();
    this.report.entries.push({
      prdName,
      prdFile,
      status: "not_attempted",
      executionStages: [],
      filesCreated: [],
      filesModified: [],
      filesDeleted: [],
      verification: defaultVerification(),
      tests: defaultTests(),
      timeline: [],
      receiptRefs: [],
      artifactRefs: [],
      summary: "",
      startedAt: now,
      completedAt: now,
      tokenUsage: { input: 0, output: 0 },
    });
    this.currentEntryIndex = this.report.entries.length - 1;
  }

  /** Record files created for the current entry. */
  recordFilesCreated(files: RunReportFileCreated[]): void {
    const entry = this.currentEntry();
    if (entry) entry.filesCreated.push(...files);
  }

  /** Record files modified for the current entry. */
  recordFilesModified(files: RunReportFileModified[]): void {
    const entry = this.currentEntry();
    if (entry) entry.filesModified.push(...files);
  }

  /** Record files deleted for the current entry. */
  recordFilesDeleted(paths: string[]): void {
    const entry = this.currentEntry();
    if (entry) entry.filesDeleted.push(...paths);
  }

  /** Record verification results for the current entry. */
  recordVerification(verification: RunReportVerification): void {
    const entry = this.currentEntry();
    if (entry) entry.verification = verification;
  }

  /** Record test results for the current entry. */
  recordTests(tests: RunReportTests): void {
    const entry = this.currentEntry();
    if (entry) entry.tests = tests;
  }

  /** Record the execution stages observed for the current entry. */
  recordExecutionStages(stages: RunReportExecutionStage[]): void {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.executionStages = normalizeExecutionStages(stages);
  }

  /** Append a single execution stage to the current entry. */
  appendExecutionStage(stage: RunReportExecutionStage): void {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.executionStages = normalizeExecutionStages([...(entry.executionStages ?? []), stage]);
  }

  /** Record the operator/runtime mode used for this entry. */
  recordMode(mode: string): void {
    const entry = this.currentEntry();
    if (entry) entry.mode = mode;
  }

  /** Append timeline events for the current entry. */
  recordTimelineEvents(events: RunReportTimelineEvent[]): void {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.timeline = [...(entry.timeline ?? []), ...events];
  }

  /** Record durable receipt references for the current entry. */
  recordReceiptRefs(receiptRefs: string[]): void {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.receiptRefs = Array.from(new Set([...(entry.receiptRefs ?? []), ...receiptRefs]));
  }

  /** Record artifact references for the current entry. */
  recordArtifactRefs(artifactRefs: string[]): void {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.artifactRefs = Array.from(new Set([...(entry.artifactRefs ?? []), ...artifactRefs]));
  }

  /** Record completion verification for the current entry. */
  recordCompletionVerification(
    verification: import("./completion-verifier.js").CompletionVerification,
  ): void {
    const entry = this.currentEntry();
    if (entry) entry.completionVerification = verification;
  }

  /** Record token usage for the current entry. */
  recordTokenUsage(input: number, output: number): void {
    const entry = this.currentEntry();
    if (entry) {
      entry.tokenUsage.input += input;
      entry.tokenUsage.output += output;
    }
  }

  /** Complete the current entry with status and summaries. */
  completeEntry(opts: {
    status?: RunReportStatus;
    summary: string;
    failureReason?: string;
    actionNeeded?: string;
  }): void {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.status = opts.status ?? deriveStatusFromExecutionStages(entry.executionStages);
    entry.summary = opts.summary;
    entry.failureReason = opts.failureReason;
    entry.actionNeeded = opts.actionNeeded;
    entry.completedAt = new Date().toISOString();
  }

  /** Mark PRDs that were never started as not_attempted. */
  markRemainingNotAttempted(reason: string, prdNames: string[]): void {
    for (const name of prdNames) {
      const exists = this.report.entries.some((e) => e.prdName === name);
      if (!exists) {
        const now = new Date().toISOString();
        this.report.entries.push({
          prdName: name,
          prdFile: "",
          status: "not_attempted",
          executionStages: ["planned"],
          filesCreated: [],
          filesModified: [],
          filesDeleted: [],
          verification: defaultVerification(),
          tests: defaultTests(),
          timeline: [],
          receiptRefs: [],
          artifactRefs: [],
          summary: "",
          actionNeeded: reason,
          startedAt: now,
          completedAt: now,
          tokenUsage: { input: 0, output: 0 },
        });
      }
    }
  }

  /** Add entries to the global files manifest. */
  addToManifest(entries: RunReportManifestEntry[]): void {
    this.report.filesManifest.push(...entries);
  }

  /** Set global token usage totals. */
  setGlobalTokenUsage(input: number, output: number): void {
    this.report.tokenUsage = { input, output };
  }

  /** Set cost estimate. */
  setCostEstimate(cost: number): void {
    this.report.costEstimate = cost;
  }

  /** Stamp the evidence-chain seal hash onto the report. */
  setSealHash(hash: string): void {
    this.report.sealHash = hash;
  }

  /** Get a snapshot of the current state (for crash-safe partial writes). */
  snapshot(): RunReport {
    return { ...this.report, entries: [...this.report.entries] };
  }

  /** Finalize: set completedAt, compute token totals if not already set. */
  finalize(): RunReport {
    this.report.completedAt = new Date().toISOString();

    // Sum per-entry token usage if global wasn't explicitly set
    if (this.report.tokenUsage.input === 0 && this.report.tokenUsage.output === 0) {
      let totalIn = 0;
      let totalOut = 0;
      for (const entry of this.report.entries) {
        totalIn += entry.tokenUsage.input;
        totalOut += entry.tokenUsage.output;
      }
      this.report.tokenUsage = { input: totalIn, output: totalOut };
    }

    // Compute cost if not already set
    if (this.report.costEstimate === 0 && this.report.tokenUsage.input > 0) {
      this.report.costEstimate = estimateRunCost(
        this.report.model.modelId,
        this.report.tokenUsage.input,
        this.report.tokenUsage.output,
      );
    }

    return { ...this.report, entries: [...this.report.entries] };
  }

  private currentEntry(): RunReportEntry | undefined {
    return this.currentEntryIndex >= 0 ? this.report.entries[this.currentEntryIndex] : undefined;
  }
}

// ─── Markdown Serializer ────────────────────────────────────────────────────

const STATUS_EMOJI: Record<RunReportStatus, string> = {
  complete: "\u2705", // ✅
  partial: "\u26A0\uFE0F", // ⚠️
  failed: "\u274C", // ❌
  not_attempted: "\u23ED\uFE0F", // ⏭️
};

const STATUS_LABEL: Record<RunReportStatus, string> = {
  complete: "COMPLETE",
  partial: "PARTIAL",
  failed: "FAILED",
  not_attempted: "NOT ATTEMPTED",
};

function formatExecutionTruth(stages: RunReportExecutionStage[] | undefined): string | null {
  const normalized = normalizeExecutionStages(stages);
  return normalized.length > 0 ? normalized.join(" -> ") : null;
}

export function serializeRunReportToMarkdown(report: RunReport, verbose: boolean = false): string {
  const lines: string[] = [];
  const duration = computeRunDuration(report.startedAt, report.completedAt);
  const costStr = `~$${report.costEstimate.toFixed(2)}`;

  // Header
  lines.push("# DanteCode Run Report");
  lines.push("");
  lines.push(`**Project:** ${report.project}`);
  lines.push(`**Command:** ${report.command}`);
  lines.push(`**Started:** ${report.startedAt}`);
  lines.push(`**Completed:** ${report.completedAt}`);
  lines.push(`**Duration:** ${duration}`);
  if (verbose) {
    lines.push(`**Model:** ${report.model.modelId} (${report.model.provider})`);
    lines.push(
      `**Cost estimate:** ${costStr} (input: ${formatTokens(report.tokenUsage.input)}, output: ${formatTokens(report.tokenUsage.output)})`,
    );
  } else {
    lines.push(`**Cost:** ${costStr}`);
  }
  lines.push("");

  // ── What was built ──────────────────────────────────────────────────────
  lines.push("## What was built");
  lines.push("");
  const builtSummaries = report.entries.filter((e) => e.summary);
  if (builtSummaries.length > 0) {
    for (const entry of builtSummaries) {
      const emoji = STATUS_EMOJI[entry.status];
      lines.push(`- **${entry.prdName}** ${emoji}: ${entry.summary}`);
    }
  } else {
    lines.push("No tasks produced output.");
  }
  lines.push("");

  // ── What needs attention ──────────────────────────────────────────────
  lines.push("## What needs attention");
  lines.push("");
  renderAttentionSection(lines, report);

  // ── Completion status ─────────────────────────────────────────────────
  const counts = countStatuses(report.entries);
  const total = report.entries.length;
  const completionRate = total > 0 ? Math.round((counts.complete / total) * 100) : 0;

  lines.push("## Completion status");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("|--------|-------|");
  lines.push(`| ${STATUS_EMOJI.complete} Complete | ${counts.complete} |`);
  lines.push(`| ${STATUS_EMOJI.partial} Partial | ${counts.partial} |`);
  lines.push(`| ${STATUS_EMOJI.failed} Failed | ${counts.failed} |`);
  lines.push(`| ${STATUS_EMOJI.not_attempted} Not attempted | ${counts.not_attempted} |`);
  lines.push(`| **Total** | **${total}** |`);
  lines.push("");
  lines.push(`**Completion rate: ${completionRate}% (${counts.complete}/${total})**`);

  const needsAttention = report.entries
    .filter((e) => e.status !== "complete")
    .map((e) => e.prdName);
  if (needsAttention.length > 0) {
    lines.push(`**Needs attention: ${needsAttention.join(", ")}**`);
  }
  lines.push("");

  const executionCounts = countExecutionStages(report.entries);
  lines.push("## Execution truth");
  lines.push("");
  lines.push("| Stage | Count |");
  lines.push("|-------|-------|");
  for (const stage of EXECUTION_STAGE_ORDER) {
    lines.push(`| ${stage} | ${executionCounts[stage]} |`);
  }
  lines.push("");

  lines.push("---");
  lines.push("");

  // Per-entry detail sections
  lines.push("### Task details");
  lines.push("");

  for (const [i, entry] of report.entries.entries()) {
    const emoji = STATUS_EMOJI[entry.status];
    const label = STATUS_LABEL[entry.status];
    const executionTruth = formatExecutionTruth(entry.executionStages);

    lines.push(`### ${entry.prdName} ${emoji} ${label}`);
    lines.push("");

    if (executionTruth) {
      lines.push(`**Execution truth:** ${executionTruth}`);
      lines.push("");
    }

    if (entry.mode) {
      lines.push(`**Mode:** ${entry.mode}`);
      lines.push("");
    }

    // Files created
    if (entry.filesCreated.length > 0) {
      lines.push("**Files created:**");
      for (const f of entry.filesCreated) {
        lines.push(`- \`${f.path}\` (${f.lines} lines)`);
      }
      lines.push("");
    }

    // Files modified
    if (entry.filesModified.length > 0) {
      lines.push("**Files modified:**");
      for (const f of entry.filesModified) {
        lines.push(`- \`${f.path}\` \u2014 +${f.added} -${f.removed}`);
      }
      lines.push("");
    }

    // Files deleted
    if (entry.filesDeleted.length > 0) {
      lines.push("**Files deleted:**");
      for (const f of entry.filesDeleted) {
        lines.push(`- \`${f}\``);
      }
      lines.push("");
    }

    // Verification
    if (verbose) {
      lines.push("**Verification:**");
      const v = entry.verification;
      const antiStubIcon = v.antiStub.passed ? "\u2705" : "\u274C";
      const constIcon = v.constitution.passed ? "\u2705" : "\u274C";
      lines.push(
        `- Anti-stub: ${antiStubIcon} ${v.antiStub.passed ? "Passed" : "FAILED"} (${v.antiStub.violations} violations)`,
      );
      if (v.antiStub.details.length > 0) {
        for (const d of v.antiStub.details) {
          lines.push(`  - ${d}`);
        }
      }
      lines.push(
        `- Constitution: ${constIcon} ${v.constitution.passed ? "Passed" : "FAILED"} (${v.constitution.violations} violations${v.constitution.warnings > 0 ? `, ${v.constitution.warnings} warnings` : ""})`,
      );
      if (v.constitution.details.length > 0) {
        for (const d of v.constitution.details) {
          lines.push(`  - ${d}`);
        }
      }
      if (v.pdseDetail && v.pdseScore < v.pdseThreshold) {
        const d = v.pdseDetail;
        lines.push(
          `- PDSE: ${v.pdseScore}/100 (below threshold ${v.pdseThreshold}) \u2014 Completeness: ${d.completeness}, Correctness: ${d.correctness}, Clarity: ${d.clarity}, Consistency: ${d.consistency}`,
        );
      } else {
        lines.push(
          `- PDSE: ${v.pdseScore}/100${v.pdseScore < v.pdseThreshold ? ` (below threshold ${v.pdseThreshold})` : ""}`,
        );
      }
      if (v.regenerationAttempts > 0) {
        lines.push(`- Regeneration attempts: ${v.regenerationAttempts}/${v.maxAttempts}`);
      }

      // Tests (verbose)
      const t = entry.tests;
      if (t.created > 0) {
        lines.push(
          `- Tests: ${t.created} created, ${t.passing} passing${t.failing > 0 ? `, ${t.failing} failing` : ""}`,
        );
      } else {
        lines.push("- Tests: none created");
      }
      lines.push("");
    } else {
      // Human-friendly verification + tests
      const vLines = humanizeVerification(entry.verification);
      if (vLines.length > 0) {
        for (const vl of vLines) {
          lines.push(vl);
        }
        lines.push("");
      }
      const testLine = humanizeTests(entry.tests);
      if (testLine) {
        lines.push(testLine);
        lines.push("");
      }
    }

    // Summary
    if (entry.summary) {
      lines.push(`**What was built:** ${entry.summary}`);
      lines.push("");
    }

    // Failure reason
    if (entry.failureReason) {
      lines.push(`**What went wrong:** ${entry.failureReason}`);
      lines.push("");
    }

    // Action needed
    if (entry.actionNeeded) {
      lines.push(`**What needs to happen:** ${entry.actionNeeded}`);
      lines.push("");
    }

    if ((entry.receiptRefs?.length ?? 0) > 0) {
      lines.push("**Receipts:**");
      for (const receiptRef of entry.receiptRefs ?? []) {
        lines.push(`- \`${receiptRef}\``);
      }
      lines.push("");
    }

    if ((entry.artifactRefs?.length ?? 0) > 0) {
      lines.push("**Artifacts:**");
      for (const artifactRef of entry.artifactRefs ?? []) {
        lines.push(`- \`${artifactRef}\``);
      }
      lines.push("");
    }

    if ((entry.timeline?.length ?? 0) > 0) {
      lines.push("**Timeline:**");
      for (const event of entry.timeline ?? []) {
        const detail = event.detail ? ` — ${event.detail}` : "";
        const artifact = event.artifactRef ? ` (\`${event.artifactRef}\`)` : "";
        lines.push(`- ${event.at} ${event.kind}: ${event.label}${detail}${artifact}`);
      }
      lines.push("");
    }

    if (i < report.entries.length - 1) {
      lines.push("---");
      lines.push("");
    }
  }

  lines.push("");

  // Files changed
  lines.push("## Files changed");
  lines.push("");
  if (report.filesManifest.length > 0) {
    lines.push("| Action | File | Lines |");
    lines.push("|--------|------|-------|");
    for (const f of report.filesManifest) {
      const action = f.action.toUpperCase();
      const lineInfo = f.lines != null ? String(f.lines) : (f.diff ?? "-");
      lines.push(`| ${action} | ${f.path} | ${lineInfo} |`);
    }

    const created = report.filesManifest.filter((f) => f.action === "created").length;
    const modified = report.filesManifest.filter((f) => f.action === "modified").length;
    const deleted = report.filesManifest.filter((f) => f.action === "deleted").length;
    lines.push("");
    lines.push(
      `**Total: ${created} files created, ${modified} files modified, ${deleted} files deleted**`,
    );
  } else {
    lines.push("No files were changed.");
  }
  lines.push("");

  // Verification summary
  lines.push("## Verification summary");
  lines.push("");
  if (verbose) {
    lines.push("| Check | Passed | Failed | Total |");
    lines.push("|-------|--------|--------|-------|");

    const attempted = report.entries.filter((e) => e.status !== "not_attempted");
    const antiStubPassed = attempted.filter((e) => e.verification.antiStub.passed).length;
    const constPassed = attempted.filter((e) => e.verification.constitution.passed).length;
    const pdsePassed = attempted.filter(
      (e) => e.verification.pdseScore >= e.verification.pdseThreshold,
    ).length;
    const testsPassed = attempted.filter(
      (e) => e.tests.created > 0 && e.tests.failing === 0,
    ).length;
    const testsNoTests = attempted.filter((e) => e.tests.created === 0).length;

    lines.push(
      `| Anti-stub scan | ${antiStubPassed} | ${attempted.length - antiStubPassed} | ${attempted.length} |`,
    );
    lines.push(
      `| Constitution check | ${constPassed} | ${attempted.length - constPassed} | ${attempted.length} |`,
    );
    lines.push(
      `| PDSE >= threshold | ${pdsePassed} | ${attempted.length - pdsePassed} | ${attempted.length} |`,
    );
    lines.push(
      `| Tests passing | ${testsPassed} | ${attempted.length - testsPassed - testsNoTests} | ${attempted.length}${testsNoTests > 0 ? ` (${testsNoTests} no tests)` : ""} |`,
    );
    lines.push("");
  } else {
    renderQualityCheckContent(lines, report);
  }

  // Completion verification (if any entry has it)
  renderCompletionVerificationSummary(lines, report);

  // Reproduction command
  lines.push("## Reproduction");
  lines.push("");
  const reproduction = buildReproductionCommand(report);
  lines.push(reproduction);
  lines.push("");

  // Receipt seal (when sealHash is present)
  if (report.sealHash) {
    const short = `${report.sealHash.slice(0, 16)}...${report.sealHash.slice(-8)}`;
    lines.push(`\n---\n**Receipt Seal** \`SHA256: ${short}\`\n`);
  }

  // Environment (verbose only)
  if (verbose) {
    lines.push("## Environment");
    lines.push("");
    lines.push(`- DanteCode version: ${report.dantecodeVersion}`);
    lines.push(`- Node.js: ${report.environment.nodeVersion}`);
    lines.push(`- OS: ${report.environment.os}`);
    lines.push(`- Provider: ${report.model.provider}`);
    lines.push(`- Model: ${report.model.modelId}`);
    const firstEntry = report.entries[0] as RunReportEntry | undefined;
    lines.push(`- PDSE threshold: ${firstEntry?.verification.pdseThreshold ?? 85}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Human-Friendly Helpers ─────────────────────────────────────────────────

function humanizeVerification(v: RunReportVerification): string[] {
  const allPassed = v.antiStub.passed && v.constitution.passed && v.pdseScore >= v.pdseThreshold;

  if (allPassed && v.regenerationAttempts === 0) {
    return [];
  }

  if (allPassed && v.regenerationAttempts > 0) {
    return [`DanteCode caught ${v.regenerationAttempts} issue(s) and fixed all of them`];
  }

  const result: string[] = [];

  if (!v.antiStub.passed) {
    result.push(`Found ${v.antiStub.violations} stub violation(s) that need real implementations`);
    for (const d of v.antiStub.details.slice(0, 3)) {
      result.push(`  - ${d}`);
    }
  }

  if (!v.constitution.passed) {
    result.push(`${v.constitution.violations} issue(s) with project standards`);
    for (const d of v.constitution.details.slice(0, 3)) {
      result.push(`  - ${d}`);
    }
  } else if (v.constitution.warnings > 0) {
    result.push(`${v.constitution.warnings} minor suggestion(s) for improvement`);
  }

  if (v.pdseScore < v.pdseThreshold) {
    if (v.pdseDetail) {
      const d = v.pdseDetail;
      const dimensionStr = `Completeness: ${d.completeness}, Correctness: ${d.correctness}, Clarity: ${d.clarity}, Consistency: ${d.consistency}`;
      result.push(`PDSE ${v.pdseScore}/100 \u2014 ${dimensionStr}`);
    } else if (v.pdseScore >= 50) {
      result.push("Review recommended");
    } else {
      result.push("Needs attention \u2014 additional review required");
    }
  }

  if (v.regenerationAttempts > 0) {
    result.push(
      `DanteCode made ${v.regenerationAttempts} fix attempt(s) but could not resolve all issues`,
    );
  }

  return result;
}

function humanizeTests(t: RunReportTests): string | null {
  if (t.created === 0) return null;
  if (t.failing === 0) return `All ${t.passing} tests pass`;
  return `${t.passing} of ${t.created} tests pass \u2014 ${t.failing} need attention`;
}

function renderAttentionSection(lines: string[], report: RunReport): void {
  const items = report.entries.filter((e) => e.status !== "complete");
  if (items.length === 0) {
    lines.push("Nothing requires attention.");
    lines.push("");
    return;
  }

  for (const entry of items) {
    const executionTruth = formatExecutionTruth(entry.executionStages);
    const reason =
      entry.actionNeeded ??
      entry.failureReason ??
      (entry.status === "partial" && executionTruth
        ? `Execution truth: ${executionTruth}`
        : `Status: ${entry.status}`);
    lines.push(`- **${entry.prdName}**: ${reason}`);
  }
  lines.push("");
}

function renderQualityCheckContent(lines: string[], report: RunReport): void {
  const attempted = report.entries.filter((e) => e.status !== "not_attempted");
  if (attempted.length === 0) {
    lines.push("No tasks were attempted.");
    lines.push("");
    return;
  }

  const allVerified = attempted.every(
    (e) =>
      e.verification.antiStub.passed &&
      e.verification.constitution.passed &&
      e.verification.pdseScore >= e.verification.pdseThreshold,
  );
  const allTestsPass = attempted.every((e) => e.tests.created === 0 || e.tests.failing === 0);
  const noPlaceholders = attempted.every((e) => e.verification.antiStub.passed);

  const parts: string[] = [];
  if (allVerified) {
    parts.push(`All ${attempted.length} task(s) passed verification.`);
  } else {
    const passed = attempted.filter(
      (e) =>
        e.verification.antiStub.passed &&
        e.verification.constitution.passed &&
        e.verification.pdseScore >= e.verification.pdseThreshold,
    ).length;
    parts.push(`${passed} of ${attempted.length} task(s) passed all checks.`);
  }
  if (noPlaceholders) {
    parts.push("No stub violations were found.");
  }
  if (allTestsPass) {
    parts.push("All tests are passing.");
  }

  lines.push(parts.join(" "));
  lines.push("");
}

function renderCompletionVerificationSummary(lines: string[], report: RunReport): void {
  const verified = report.entries.filter((e) => e.completionVerification != null);
  if (verified.length === 0) return;

  lines.push("**Completion verification:**");
  for (const entry of verified) {
    const cv = entry.completionVerification!;
    const verdictIcon =
      cv.verdict === "complete" ? "\u2705" : cv.verdict === "partial" ? "\u26A0\uFE0F" : "\u274C";
    lines.push(
      `- ${entry.prdName}: ${verdictIcon} ${cv.verdict} (confidence: ${cv.confidence}, ${cv.passed.length} passed, ${cv.failed.length} failed)`,
    );
  }
  lines.push("");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function countStatuses(entries: RunReportEntry[]): Record<RunReportStatus, number> {
  const counts: Record<RunReportStatus, number> = {
    complete: 0,
    partial: 0,
    failed: 0,
    not_attempted: 0,
  };
  for (const e of entries) {
    counts[e.status]++;
  }
  return counts;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K tokens`;
  return `${tokens} tokens`;
}

function buildReproductionCommand(report: RunReport): string {
  const failedEntries = report.entries.filter(
    (e) => e.status === "failed" || e.status === "partial" || e.status === "not_attempted",
  );

  if (failedEntries.length === 0) {
    return "All tasks completed successfully. No re-run needed.";
  }

  const prdFiles = failedEntries
    .map((e) => e.prdFile)
    .filter((f) => f && f !== "multi-agent-lane" && f !== "party-autoforge");

  if (prdFiles.length > 0) {
    return `To re-run failed/partial tasks:\n\`\`\`bash\ndantecode --one-shot "/party --prds ${prdFiles.join(" ")}"\n\`\`\``;
  }

  const names = failedEntries.map((e) => e.prdName).join(", ");
  return `To re-run failed/partial tasks:\n\`\`\`bash\ndantecode --one-shot "/party ${names}"\n\`\`\``;
}
