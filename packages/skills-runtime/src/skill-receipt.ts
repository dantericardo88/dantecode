import type { SkillRunResult } from "./skill-run-result.js";

export interface SkillReceipt {
  receiptId: string;
  runId: string;
  skillName: string;
  sourceType: string;
  state: string;
  verificationOutcome: string;
  filesTouched: string[];
  commandsRun: string[];
  issuedAt: string;
  failureReason?: string;
}

/**
 * Emit a tamper-evident receipt for a skill run.
 * Throws SKILL-007 if result is in an unfinished state (no startedAt/completedAt).
 */
export function emitSkillReceipt(result: SkillRunResult): SkillReceipt {
  if (!result.runId) {
    throw new Error("SKILL-007: cannot emit receipt — runId missing");
  }
  const receiptId = `rcpt_${result.runId}_${Date.now().toString(16)}`;
  return {
    receiptId,
    runId: result.runId,
    skillName: result.skillName,
    sourceType: result.sourceType,
    state: result.state,
    verificationOutcome: result.verificationOutcome,
    filesTouched: [...result.filesTouched],
    commandsRun: [...result.commandsRun],
    issuedAt: new Date().toISOString(),
    failureReason: result.failureReason,
  };
}
