import type { SkillRunResult } from "./skill-run-result.js";
import type { SkillReceipt } from "./skill-receipt.js";

/**
 * Build a plain-language run report for a skill execution.
 * Enforces SKILL-010: no "success" without applied/verified state.
 */
export function buildSkillReport(result: SkillRunResult, receipt?: SkillReceipt): string {
  const lines: string[] = [];
  const stateIcon =
    result.state === "verified"
      ? "✅"
      : result.state === "applied"
        ? "✔"
        : result.state === "proposed"
          ? "📋"
          : result.state === "partial"
            ? "⚠️"
            : "❌";

  lines.push(`## Skill Run: ${result.skillName}`);
  lines.push(`**Status**: ${stateIcon} ${result.state.toUpperCase()}`);
  lines.push(`**Run ID**: ${result.runId}`);
  lines.push(`**Source**: ${result.sourceType}`);
  lines.push(`**Mode**: ${result.mode}`);
  lines.push(``);
  lines.push(`### Summary`);
  lines.push(result.plainLanguageSummary);

  if (result.failureReason) {
    lines.push(``);
    lines.push(`### What Went Wrong`);
    lines.push(result.failureReason);
  }

  if (result.filesTouched.length > 0) {
    lines.push(``);
    lines.push(`### Files Touched`);
    for (const f of result.filesTouched) lines.push(`- ${f}`);
  }

  if (result.commandsRun.length > 0) {
    lines.push(``);
    lines.push(`### Commands Run`);
    for (const c of result.commandsRun) lines.push(`- \`${c}\``);
  }

  lines.push(``);
  lines.push(`### Verification`);
  lines.push(`Outcome: **${result.verificationOutcome}**`);

  if (receipt) {
    lines.push(``);
    lines.push(`### Receipt`);
    lines.push(`Receipt ID: \`${receipt.receiptId}\``);
    lines.push(`Issued at: ${receipt.issuedAt}`);
  }

  return lines.join("\n");
}
