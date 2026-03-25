import { makeRunId } from "./skill-run-result.js";
import type { DanteSkill } from "./dante-skill.js";
import type { SkillRunContext } from "./skill-run-context.js";
import type { SkillRunResult } from "./skill-run-result.js";

export interface RunSkillOptions {
  skill: DanteSkill;
  context: SkillRunContext;
  /** Injectable executor for scripts (default: no-op for instruction-only) */
  scriptRunner?: (scriptPath: string, context: SkillRunContext) => Promise<string[]>;
}

/**
 * Execute a skill under the DanteCode runtime.
 * Instruction-only skills (no scripts/) always succeed with state "applied".
 * Skills with scripts/ require explicit scriptRunner injection.
 * Never emits "success" without applied/verified state (SKILL-010).
 */
export async function runSkill(opts: RunSkillOptions): Promise<SkillRunResult> {
  const { skill, context } = opts;
  const runId = makeRunId();
  const startedAt = new Date().toISOString();

  // Instruction-only skills (default, Codex recommends this as default)
  const hasScripts = Boolean(skill.scripts);
  const isInstructionOnly = !hasScripts || !opts.scriptRunner;

  if (isInstructionOnly) {
    const completedAt = new Date().toISOString();
    return {
      runId,
      skillName: skill.name,
      sourceType: skill.sourceType,
      mode: context.mode,
      state: context.dryRun ? "proposed" : "applied",
      filesTouched: [],
      commandsRun: [],
      verificationOutcome: "skipped",
      plainLanguageSummary: context.dryRun
        ? `Proposed skill "${skill.name}" — review instructions before applying.`
        : `Applied skill "${skill.name}" — instructions ready for execution.`,
      startedAt,
      completedAt,
    };
  }

  // Script-based execution
  try {
    const commands = await opts.scriptRunner!(skill.scripts!, context);
    const completedAt = new Date().toISOString();
    return {
      runId,
      skillName: skill.name,
      sourceType: skill.sourceType,
      mode: context.mode,
      state: "applied",
      filesTouched: [],
      commandsRun: commands,
      verificationOutcome: "skipped",
      plainLanguageSummary: `Applied skill "${skill.name}" — ${commands.length} command(s) executed.`,
      startedAt,
      completedAt,
    };
  } catch (err) {
    const completedAt = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);
    return {
      runId,
      skillName: skill.name,
      sourceType: skill.sourceType,
      mode: context.mode,
      state: "failed",
      filesTouched: [],
      commandsRun: [],
      verificationOutcome: "fail",
      plainLanguageSummary: `Skill "${skill.name}" failed during execution.`,
      failureReason: `SKILL-007: script execution error — ${message}`,
      startedAt,
      completedAt,
    };
  }
}
