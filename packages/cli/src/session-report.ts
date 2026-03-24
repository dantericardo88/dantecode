// ============================================================================
// @dantecode/cli — Session Report
// Lightweight run report for normal REPL sessions (not workflow commands).
// Generates a condensed summary at session end when meaningful work was done.
// ============================================================================

import {
  RunReportAccumulator,
  serializeRunReportToMarkdown,
  writeRunReport,
  estimateRunCost,
} from "@dantecode/core";
import type { Session } from "@dantecode/config-types";

// Tool names that indicate "meaningful work" (file mutations)
const MUTATION_TOOLS = new Set(["Write", "Edit", "GitCommit", "NotebookEdit"]);

interface SessionReportContext {
  session: Session;
  projectRoot: string;
  modelId: string;
  provider: string;
  dantecodeVersion: string;
  sessionDurationMs: number;
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
 * Non-fatal — catches all errors internally.
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

    // Single entry summarizing the session
    acc.beginEntry("REPL Session", "interactive");
    acc.recordTokenUsage(inputTokens, outputTokens);
    acc.completeEntry({
      status: "complete",
      summary: `Interactive session — ${mutationCount} file operation(s), ${ctx.session.messages.length} messages, ${Math.round(ctx.sessionDurationMs / 1000)}s`,
    });
    acc.setCostEstimate(estimateRunCost(ctx.modelId, inputTokens, outputTokens));

    const report = acc.finalize();
    const md = serializeRunReportToMarkdown(report, false);
    const reportPath = await writeRunReport({
      projectRoot: ctx.projectRoot,
      markdown: md,
      timestamp: report.completedAt,
    });

    return reportPath;
  } catch {
    // Non-fatal — never break session exit
    return null;
  }
}
