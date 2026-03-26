import { persistSkillReceipt } from "./skill-receipt.js";
import { makeRunId } from "./skill-run-result.js";
import type { DanteSkill } from "./dante-skill.js";
import type { SkillRunContext } from "./skill-run-context.js";
import type { SkillRunResult } from "./skill-run-result.js";

export interface SkillVerification {
  outcome: "pass" | "fail" | "partial";
  summary?: string;
}

export interface RunSkillOptions {
  skill: DanteSkill;
  context: SkillRunContext;
  /** Injectable executor for scripts (default: no-op for instruction-only) */
  scriptRunner?: (scriptPath: string, context: SkillRunContext) => Promise<string[]>;
  verification?: SkillVerification;
}

async function finalizeSkillRun(
  context: SkillRunContext,
  result: SkillRunResult,
): Promise<SkillRunResult> {
  const receipt = await persistSkillReceipt(
    {
      ...result,
      policySnapshot: context.policy,
    },
    context.projectRoot,
    {
      policySnapshot: context.policy,
      verificationSummary: result.verificationSummary,
      artifactRefs: result.artifactRefs,
      ledgerRef: result.ledgerRef,
    },
  );

  return {
    ...result,
    receiptRef: receipt.receiptRef,
    policySnapshot: receipt.policySnapshot,
    evidenceHashes: receipt.evidenceHashes,
    verificationSummary: receipt.verificationSummary,
    artifactRefs: receipt.artifactRefs,
    ledgerRef: receipt.ledgerRef,
  };
}

/**
 * Execute a skill under the DanteCode runtime.
 * Instruction-only or dry-run skills stay in "proposed" until concrete execution happens.
 * Script-backed skills become "applied" only after command execution, and "verified"
 * only when explicit verification evidence passes.
 */
export async function runSkill(opts: RunSkillOptions): Promise<SkillRunResult> {
  const { skill, context } = opts;
  const runId = makeRunId();
  const startedAt = new Date().toISOString();

  const hasScripts = Boolean(skill.scripts);
  const hasConcreteExecution = hasScripts && Boolean(opts.scriptRunner) && !context.dryRun;

  if (!hasConcreteExecution) {
    const completedAt = new Date().toISOString();
    const proposedResult: SkillRunResult = {
      runId,
      skillName: skill.name,
      sourceType: skill.sourceType,
      mode: context.mode,
      state: "proposed",
      filesTouched: [],
      commandsRun: [],
      verificationOutcome: "skipped",
      verificationSummary: context.dryRun
        ? "Dry-run mode: instructions proposed only."
        : "No concrete execution evidence was captured for this skill run.",
      plainLanguageSummary: context.dryRun
        ? `Proposed skill "${skill.name}" â€” review instructions before applying.`
        : `Proposed skill "${skill.name}" â€” instructions are ready for operator review.`,
      startedAt,
      completedAt,
    };

    return finalizeSkillRun(context, proposedResult);
  }

  try {
    const commands = await opts.scriptRunner!(skill.scripts!, context);
    const completedAt = new Date().toISOString();
    const verification = opts.verification;

    if (verification?.outcome === "fail") {
      return finalizeSkillRun(context, {
        runId,
        skillName: skill.name,
        sourceType: skill.sourceType,
        mode: context.mode,
        state: "failed",
        filesTouched: [],
        commandsRun: commands,
        verificationOutcome: "fail",
        verificationSummary: verification.summary,
        plainLanguageSummary: `Skill "${skill.name}" failed verification after execution.`,
        failureReason:
          verification.summary ??
          `SKILL-009: verification failed after running ${commands.length} command(s).`,
        startedAt,
        completedAt,
      });
    }

    if (verification?.outcome === "partial") {
      return finalizeSkillRun(context, {
        runId,
        skillName: skill.name,
        sourceType: skill.sourceType,
        mode: context.mode,
        state: "partial",
        filesTouched: [],
        commandsRun: commands,
        verificationOutcome: "partial",
        verificationSummary: verification.summary,
        plainLanguageSummary: `Applied skill "${skill.name}" â€” verification is still partial.`,
        startedAt,
        completedAt,
      });
    }

    if (verification?.outcome === "pass") {
      return finalizeSkillRun(context, {
        runId,
        skillName: skill.name,
        sourceType: skill.sourceType,
        mode: context.mode,
        state: "verified",
        filesTouched: [],
        commandsRun: commands,
        verificationOutcome: "pass",
        verificationSummary: verification.summary,
        plainLanguageSummary:
          verification.summary ??
          `Verified skill "${skill.name}" â€” ${commands.length} command(s) executed and checked.`,
        startedAt,
        completedAt,
      });
    }

    return finalizeSkillRun(context, {
      runId,
      skillName: skill.name,
      sourceType: skill.sourceType,
      mode: context.mode,
      state: "applied",
      filesTouched: [],
      commandsRun: commands,
      verificationOutcome: "skipped",
      plainLanguageSummary: `Applied skill "${skill.name}" â€” ${commands.length} command(s) executed.`,
      startedAt,
      completedAt,
    });
  } catch (err) {
    const completedAt = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);

    return finalizeSkillRun(context, {
      runId,
      skillName: skill.name,
      sourceType: skill.sourceType,
      mode: context.mode,
      state: "failed",
      filesTouched: [],
      commandsRun: [],
      verificationOutcome: "fail",
      plainLanguageSummary: `Skill "${skill.name}" failed during execution.`,
      failureReason: `SKILL-007: script execution error â€” ${message}`,
      startedAt,
      completedAt,
    });
  }
}
