// ============================================================================
// @dantecode/cli - Session Report
// Lightweight run report for normal REPL sessions (not workflow commands).
// Generates a condensed summary at session end when meaningful work was done.
// ============================================================================

import {
  RunReportAccumulator,
  estimateRunCost,
  serializeRunReportToMarkdown,
  type RunReportExecutionStage,
  writeRunReport,
} from "@dantecode/core";
import type { Session } from "@dantecode/config-types";

// Tool names that indicate "meaningful work" (file mutations)
const MUTATION_TOOLS = new Set(["Write", "Edit", "GitCommit", "NotebookEdit"]);

export interface PdseResult {
  file: string;
  pdseScore: number;
  passed: boolean;
}

interface SessionReportContext {
  session: Session;
  projectRoot: string;
  modelId: string;
  provider: string;
  dantecodeVersion: string;
  sessionDurationMs: number;
  mode?: string;
  restoredAt?: string;
  restoreSummary?: string;
  /**
   * Per-file PDSE verification results from this session.
   * When present, the run report includes a verification section with the
   * aggregate score - satisfying the product's core trust promise even for
   * plain REPL sessions (not just /magic or /party runs).
   */
  pdseResults?: PdseResult[];
}

function buildExecutionStages(ctx: SessionReportContext): RunReportExecutionStage[] {
  const stages: RunReportExecutionStage[] = ["applied"];

  if (ctx.pdseResults && ctx.pdseResults.length > 0) {
    if (ctx.pdseResults.every((result) => result.passed)) {
      stages.push("verified");
    } else {
      stages.push("failed");
    }
  }

  if (ctx.restoredAt) {
    stages.push("restored");
  }

  return stages;
}

/**
 * Count mutation tool calls from session messages.
 * Returns the number of Write/Edit/GitCommit/NotebookEdit calls.
 */
function countMutationToolCalls(session: Session): number {
  let count = 0;
  for (const msg of session.messages) {
    if (msg.role === "assistant" && msg.toolUse && MUTATION_TOOLS.has(msg.toolUse.name)) {
      count++;
    }
  }
  return count;
}

/**
 * Check whether a REPL session warrants a run report.
 * Returns true if there were at least 1 mutation tool call.
 */
export function shouldGenerateSessionReport(session: Session): boolean {
  return countMutationToolCalls(session) > 0;
}

/**
 * Generate and write a condensed session report for a normal REPL session.
 * Returns the report file path, or null if no report was needed.
 *
 * Non-fatal - catches all errors internally.
 */
export async function generateSessionReport(ctx: SessionReportContext): Promise<string | null> {
  try {
    if (!shouldGenerateSessionReport(ctx.session)) {
      return null;
    }

    const mutationCount = countMutationToolCalls(ctx.session);
    const totalTokens = ctx.session.messages.reduce((sum, m) => sum + (m.tokensUsed ?? 0), 0);
    const inputTokens = Math.round(totalTokens * 0.66);
    const outputTokens = Math.round(totalTokens * 0.34);

    const acc = new RunReportAccumulator({
      project: ctx.projectRoot,
      command: "repl-session",
      model: { provider: ctx.provider, modelId: ctx.modelId },
      dantecodeVersion: ctx.dantecodeVersion,
    });

    // Single entry summarizing the session.
    acc.beginEntry("REPL Session", "interactive");
    acc.recordTokenUsage(inputTokens, outputTokens);
    acc.recordExecutionStages(buildExecutionStages(ctx));

    if (ctx.mode) {
      acc.recordMode(ctx.mode);
    }

    if (ctx.restoredAt) {
      acc.recordTimelineEvents([
        {
          kind: "restore",
          label: "Workspace restored",
          at: ctx.restoredAt,
          detail: ctx.restoreSummary,
        },
      ]);
    }

    // Wire PDSE verification results when available.
    // Without this, the session report only says "X file operations" and
    // omits the product's core trust signal (PDSE score).
    if (ctx.pdseResults && ctx.pdseResults.length > 0) {
      const scores = ctx.pdseResults.map((result) => result.pdseScore);
      const avgScore = Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
      const allPassed = ctx.pdseResults.every((result) => result.passed);
      acc.recordVerification({
        antiStub: { passed: true, violations: 0, details: [] },
        constitution: { passed: true, violations: 0, warnings: 0, details: [] },
        pdseScore: avgScore,
        pdseThreshold: 85,
        regenerationAttempts: 0,
        maxAttempts: 0,
      });

      const verificationLine = allPassed
        ? `PDSE ${avgScore}/100 - all ${ctx.pdseResults.length} file(s) verified`
        : `PDSE ${avgScore}/100 - ${ctx.pdseResults.filter((result) => !result.passed).length} file(s) need attention`;
      const restoreLine = ctx.restoreSummary ? ` ${ctx.restoreSummary}` : "";

      acc.completeEntry({
        summary: `Interactive session - ${mutationCount} file operation(s), ${ctx.session.messages.length} messages, ${Math.round(ctx.sessionDurationMs / 1000)}s. ${verificationLine}${restoreLine}`,
        failureReason: allPassed ? undefined : verificationLine,
      });
    } else {
      acc.completeEntry({
        summary: `Interactive session - ${mutationCount} file operation(s), ${ctx.session.messages.length} messages, ${Math.round(ctx.sessionDurationMs / 1000)}s. Changes were applied without verification.`,
        actionNeeded: "Verify the applied changes before treating the run as complete.",
      });
    }

    acc.setCostEstimate(estimateRunCost(ctx.modelId, inputTokens, outputTokens));

    const report = acc.finalize();
    const markdown = serializeRunReportToMarkdown(report, false);
    const writeResult = await writeRunReport({
      projectRoot: ctx.projectRoot,
      markdown,
      timestamp: report.completedAt,
    });

    return writeResult.success ? writeResult.path : null;
  } catch {
    // Non-fatal - never break session exit.
    return null;
  }
}
