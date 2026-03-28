import { persistSkillReceipt } from "./skill-receipt.js";
import { makeRunId } from "./skill-run-result.js";
import type { DanteSkill } from "./dante-skill.js";
import type { SkillRunContext } from "./skill-run-context.js";
import type { SkillRunResult } from "./skill-run-result.js";
import { buildRuntimeEvent, type EventEmitter } from "@dantecode/runtime-spine";
import { randomUUID } from "node:crypto";

export interface SkillVerification {
  outcome: "pass" | "fail" | "partial";
  summary?: string;
}

export interface FileReceipt {
  filePath: string;
  state: "success" | "failed" | "skipped";
  action: "read" | "write" | "create" | "delete";
  hash?: string; // Content hash for verification
  error?: string; // Only present when state === "failed"
}

export interface ScriptResult {
  commands: string[];
  fileReceipts: FileReceipt[];
  allSucceeded: boolean;
}

export interface RunSkillOptions {
  skill: DanteSkill;
  context: SkillRunContext;
  /** Injectable executor for scripts (returns commands run, optionally with file receipts for Wave 1 closure) */
  scriptRunner?: (scriptPath: string, context: SkillRunContext) => Promise<ScriptResult | string[]>;
  verification?: SkillVerification;
  /** Optional event engine for emitting skill load and execution events */
  eventEngine?: EventEmitter;
  /** Optional task ID for event correlation (generates UUID if not provided) */
  taskId?: string;
}

async function emitSkillExecutedEvent(
  eventEngine: EventEmitter | undefined,
  taskId: string,
  skill: DanteSkill,
  result: SkillRunResult,
  startedAt: string,
): Promise<void> {
  if (!eventEngine) return;

  const completedAt = result.completedAt;
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const success = result.state === "verified" || result.state === "applied";

  await eventEngine.emit(
    buildRuntimeEvent({
      kind: "run.skill.executed",
      taskId,
      payload: {
        skillId: result.runId,
        skillName: skill.name,
        durationMs,
        success,
        error: result.failureReason,
      },
    }),
  );
}

async function finalizeSkillRun(
  context: SkillRunContext,
  result: SkillRunResult,
  fileReceipts?: FileReceipt[],
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
      fileReceipts,
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
  const { skill, context, eventEngine, taskId } = opts;
  const runId = makeRunId();
  const startedAt = new Date().toISOString();
  const correlationTaskId = taskId ?? randomUUID();

  // Emit skill.loaded event
  if (eventEngine) {
    await eventEngine.emit(
      buildRuntimeEvent({
        kind: "run.skill.loaded",
        taskId: correlationTaskId,
        payload: {
          skillId: runId,
          skillName: skill.name,
          source: skill.sourceType,
          license: skill.license,
          trustTier: skill.metadata?.trustTier ?? "unknown",
        },
      }),
    );
  }

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
        ? `Proposed skill "${skill.name}" - review instructions before applying.`
        : `Proposed skill "${skill.name}" - instructions are ready for operator review.`,
      startedAt,
      completedAt,
    };

    const finalResult = await finalizeSkillRun(context, proposedResult, undefined);
    await emitSkillExecutedEvent(eventEngine, correlationTaskId, skill, finalResult, startedAt);
    return finalResult;
  }

  try {
    const scriptOutput = await opts.scriptRunner!(skill.scripts!, context);
    const completedAt = new Date().toISOString();
    const verification = opts.verification;

    // Handle backward compatibility: scriptRunner can return string[] or ScriptResult
    const scriptResult: ScriptResult = Array.isArray(scriptOutput)
      ? { commands: scriptOutput, fileReceipts: [], allSucceeded: true }
      : scriptOutput;

    // Extract files from receipts, separating successful and failed
    const successfulFiles = scriptResult.fileReceipts
      .filter((receipt) => receipt.state === "success")
      .map((receipt) => receipt.filePath);
    const failedReceipts = scriptResult.fileReceipts.filter(
      (receipt) => receipt.state === "failed",
    );

    // Determine overall state based on file receipts and verification
    let finalState: SkillRunResult["state"];
    let verificationOutcome: SkillRunResult["verificationOutcome"];
    let failureReason: string | undefined;

    if (verification?.outcome === "fail" || failedReceipts.length > 0) {
      finalState = "failed";
      verificationOutcome = "fail";
      failureReason =
        verification?.summary ??
        (failedReceipts.length > 0
          ? `SKILL-011: ${failedReceipts.length} file operations failed: ${failedReceipts.map((r) => `${r.filePath}: ${r.error}`).join("; ")}`
          : `SKILL-009: verification failed after running ${scriptResult.commands.length} command(s).`);
    } else if (verification?.outcome === "partial" || !scriptResult.allSucceeded) {
      finalState = "partial";
      verificationOutcome = "partial";
      failureReason = verification?.summary ?? "Some file operations were skipped or incomplete";
    } else if (verification?.outcome === "pass") {
      finalState = "verified";
      verificationOutcome = "pass";
    } else {
      finalState = "applied";
      verificationOutcome = "skipped";
    }

    // Executed commands are concrete evidence of application, even when the
    // runner does not emit file receipts.
    const hasAppliedState =
      scriptResult.commands.length > 0 ||
      successfulFiles.length > 0 ||
      verification?.outcome === "pass" ||
      verification?.outcome === "partial";

    if (!hasAppliedState && (finalState === "applied" || finalState === "verified")) {
      finalState = "proposed";
      verificationOutcome = "skipped";
    }

    const finalResult = await finalizeSkillRun(
      context,
      {
        runId,
        skillName: skill.name,
        sourceType: skill.sourceType,
        mode: context.mode,
        state: finalState,
        filesTouched: successfulFiles,
        commandsRun: scriptResult.commands,
        verificationOutcome,
        verificationSummary: verification?.summary,
        plainLanguageSummary:
          finalState === "failed"
            ? `Skill "${skill.name}" failed during execution.`
            : finalState === "verified"
              ? (verification?.summary ??
                `Verified skill "${skill.name}" - ${scriptResult.commands.length} command(s) executed, ${successfulFiles.length} files touched.`)
              : finalState === "partial"
                ? `Partially applied skill "${skill.name}" - verification is incomplete.`
                : finalState === "applied"
                  ? `Applied skill "${skill.name}" - ${scriptResult.commands.length} command(s) executed, ${successfulFiles.length} files touched.`
                  : `Proposed skill "${skill.name}" - instructions are ready for review.`,
        failureReason,
        startedAt,
        completedAt,
      },
      scriptResult.fileReceipts,
    );

    await emitSkillExecutedEvent(eventEngine, correlationTaskId, skill, finalResult, startedAt);
    return finalResult;
  } catch (err) {
    const completedAt = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);

    const failedResult = await finalizeSkillRun(
      context,
      {
        runId,
        skillName: skill.name,
        sourceType: skill.sourceType,
        mode: context.mode,
        state: "failed",
        filesTouched: [],
        commandsRun: [],
        verificationOutcome: "fail",
        plainLanguageSummary: `Skill "${skill.name}" failed during execution.`,
        failureReason: `SKILL-007: script execution error - ${message}`,
        startedAt,
        completedAt,
      },
      undefined,
    );

    await emitSkillExecutedEvent(eventEngine, correlationTaskId, skill, failedResult, startedAt);
    return failedResult;
  }
}
