import { runSkill } from "./run-skill.js";
import type { RunSkillOptions, SkillVerification } from "./run-skill.js";
import type { DanteSkill } from "./dante-skill.js";
import type { SkillRunContext } from "./skill-run-context.js";
import type { SkillRunResult } from "./skill-run-result.js";
import type { EventEmitter } from "@dantecode/runtime-spine";

/**
 * Gating strategy for skill chains.
 * - none: No gating, execute all steps unconditionally
 * - pdse: Use PDSE score verification between steps
 * - manual: Require manual approval between steps
 */
export type SkillChainGating = "none" | "pdse" | "manual";

/**
 * Failure handling strategy for individual steps.
 * - abort: Stop chain execution immediately on failure
 * - continue: Continue to next step despite failure
 * - prompt: Ask user what to do (interactive mode)
 */
export type SkillFailureStrategy = "abort" | "continue" | "prompt";

/**
 * Reference to output from a previous step.
 * Used for input substitution in chains.
 */
export interface SkillOutputRef {
  /** Type of reference: "previous" = last step, "step" = specific step by index */
  type: "previous" | "step" | "initial";
  /** Step index when type === "step" (0-based) */
  stepIndex?: number;
  /** Field path to extract (e.g., "output", "files.0", "summary") */
  field: string;
}

/**
 * Individual step in a skill chain.
 */
export interface SkillStep {
  /** Name of the skill to execute */
  skillName: string;
  /** Input to pass to the skill - can be literal string or reference */
  input: string | SkillOutputRef;
  /** What to do if this step fails */
  onFailure: SkillFailureStrategy;
  /** Optional custom PDSE threshold for this step (overrides chain default) */
  pdseThreshold?: number;
}

/**
 * Complete skill chain definition.
 */
export interface SkillChain {
  /** Unique name for this chain */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Steps to execute in order */
  steps: SkillStep[];
  /** Gating strategy between steps */
  gating: SkillChainGating;
  /** Default PDSE threshold (default: 70) */
  pdseThreshold?: number;
}

/**
 * Result of a single step execution.
 */
export interface ChainStepResult {
  /** Step index (0-based) */
  stepIndex: number;
  /** Skill name executed */
  skillName: string;
  /** Skill run result */
  result: SkillRunResult;
  /** Whether this step passed gating (if applicable) */
  gateApproved: boolean;
  /** PDSE score if gating was used */
  pdseScore?: number;
  /** Whether this step failed */
  failed: boolean;
  /** Failure reason if failed */
  failureReason?: string;
}

/**
 * Complete chain execution result.
 */
export interface ChainResult {
  /** Chain name */
  chainName: string;
  /** Whether the entire chain succeeded */
  success: boolean;
  /** Results for each step executed */
  stepResults: ChainStepResult[];
  /** Index of the step that caused failure (if any) */
  failedAtStep?: number;
  /** Reason for overall failure */
  failureReason?: string;
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Options for executing a skill chain.
 */
export interface ExecuteChainOptions {
  /** The chain to execute */
  chain: SkillChain;
  /** Initial input to the chain (available as $initial) */
  initialInput: string;
  /** Base context for skill execution */
  context: SkillRunContext;
  /** Skill loader function */
  skillLoader: (name: string) => Promise<DanteSkill | null>;
  /** Optional script runner for skill execution */
  scriptRunner?: RunSkillOptions["scriptRunner"];
  /** Optional verification provider */
  verificationProvider?: (result: SkillRunResult) => Promise<SkillVerification>;
  /** Optional PDSE gate callback (for custom gating logic) */
  forgeGate?: (result: SkillRunResult, threshold: number) => Promise<{ approved: boolean; score?: number }>;
  /** Optional event engine for skill events */
  eventEngine?: EventEmitter;
  /** Optional task ID for event correlation */
  taskId?: string;
  /** Optional prompt function for interactive failure handling */
  promptUser?: (message: string, options: string[]) => Promise<string>;
}

/**
 * Resolve a skill output reference to a concrete value.
 * Supports path notation like "output", "files.0", "summary".
 */
export function resolveOutputRef(
  ref: SkillOutputRef,
  stepResults: ChainStepResult[],
  initialInput: string,
): string {
  if (ref.type === "initial") {
    return initialInput;
  }

  let targetResult: ChainStepResult | undefined;

  if (ref.type === "previous") {
    if (stepResults.length === 0) {
      throw new Error("SKILL-CHAIN-001: Cannot reference previous step - no previous steps executed");
    }
    targetResult = stepResults[stepResults.length - 1];
  } else if (ref.type === "step") {
    if (ref.stepIndex === undefined) {
      throw new Error("SKILL-CHAIN-002: stepIndex is required when type === 'step'");
    }
    if (ref.stepIndex < 0 || ref.stepIndex >= stepResults.length) {
      throw new Error(
        `SKILL-CHAIN-003: Invalid stepIndex ${ref.stepIndex} (valid range: 0-${stepResults.length - 1})`,
      );
    }
    targetResult = stepResults[ref.stepIndex];
  }

  if (!targetResult) {
    throw new Error("SKILL-CHAIN-004: Failed to resolve output reference");
  }

  // Navigate the field path
  const fieldPath = ref.field.split(".");
  let value: unknown = targetResult.result;

  for (const segment of fieldPath) {
    if (value === null || value === undefined) {
      throw new Error(`SKILL-CHAIN-005: Cannot access field "${segment}" on null/undefined value`);
    }

    if (typeof value === "object") {
      if (Array.isArray(value)) {
        const index = parseInt(segment, 10);
        if (isNaN(index)) {
          throw new Error(`SKILL-CHAIN-006: Invalid array index "${segment}"`);
        }
        value = value[index];
      } else {
        value = (value as Record<string, unknown>)[segment];
      }
    } else {
      throw new Error(`SKILL-CHAIN-007: Cannot access property "${segment}" on non-object value`);
    }
  }

  // Convert result to string
  if (typeof value === "string") {
    return value;
  } else if (value === null || value === undefined) {
    return "";
  } else if (typeof value === "object") {
    return JSON.stringify(value);
  } else {
    return String(value);
  }
}

/**
 * Resolve skill step input - either use literal string or resolve reference.
 */
export function resolveInput(
  input: string | SkillOutputRef,
  stepResults: ChainStepResult[],
  initialInput: string,
): string {
  if (typeof input === "string") {
    // Check for template substitution patterns like $previous.output or $step.0.files
    const templatePattern = /\$([a-z]+)(?:\.(\d+))?\.([a-z._0-9]+)/gi;
    return input.replace(templatePattern, (match, refType, stepIndex, field) => {
      const ref: SkillOutputRef = {
        type: refType === "previous" ? "previous" : refType === "initial" ? "initial" : "step",
        stepIndex: stepIndex !== undefined ? parseInt(stepIndex, 10) : undefined,
        field,
      };
      try {
        return resolveOutputRef(ref, stepResults, initialInput);
      } catch {
        // If resolution fails, leave the template string as-is
        return match;
      }
    });
  } else {
    return resolveOutputRef(input, stepResults, initialInput);
  }
}

/**
 * Handle a gate failure based on the step's failure strategy.
 */
export async function handleGateFailure(
  strategy: SkillFailureStrategy,
  stepIndex: number,
  stepResults: ChainStepResult[],
  promptUser?: (message: string, options: string[]) => Promise<string>,
): Promise<{ shouldAbort: boolean; userChoice?: string }> {
  if (strategy === "abort") {
    return { shouldAbort: true };
  }

  if (strategy === "continue") {
    return { shouldAbort: false };
  }

  // Strategy is "prompt"
  if (!promptUser) {
    // No prompt function provided, default to abort
    return { shouldAbort: true };
  }

  const stepName = stepResults[stepIndex]?.skillName ?? `step ${stepIndex}`;
  const message = `Step ${stepIndex + 1} (${stepName}) failed gating. What would you like to do?`;
  const choice = await promptUser(message, ["abort", "continue"]);

  return {
    shouldAbort: choice === "abort",
    userChoice: choice,
  };
}

/**
 * Default PDSE gate implementation using simple threshold check.
 */
async function defaultForgeGate(
  result: SkillRunResult,
  threshold: number,
): Promise<{ approved: boolean; score?: number }> {
  // Check verification outcome first
  if (result.verificationOutcome === "fail") {
    return { approved: false, score: 0 };
  }

  if (result.verificationOutcome === "pass") {
    return { approved: true, score: 100 };
  }

  // For "applied" or "verified" state without explicit verification, assume pass
  if (result.state === "verified") {
    return { approved: true, score: 95 };
  }

  if (result.state === "applied") {
    return { approved: true, score: 80 };
  }

  // For "proposed" or "partial", use conservative scoring
  if (result.state === "partial") {
    const score = 60;
    return { approved: score >= threshold, score };
  }

  // "proposed" or "failed" state
  if (result.state === "failed") {
    return { approved: false, score: 0 };
  }

  // "proposed" - no concrete execution
  const score = 50;
  return { approved: score >= threshold, score };
}

/**
 * Execute a skill chain with sequential step execution and optional gating.
 */
export async function executeChain(opts: ExecuteChainOptions): Promise<ChainResult> {
  const {
    chain,
    initialInput,
    context,
    skillLoader,
    scriptRunner,
    forgeGate = defaultForgeGate,
    eventEngine,
    taskId,
    promptUser,
  } = opts;

  const startTime = Date.now();
  const stepResults: ChainStepResult[] = [];
  const defaultThreshold = chain.pdseThreshold ?? 70;

  for (const [index, step] of chain.steps.entries()) {
    try {
      // Resolve step input
      resolveInput(step.input, stepResults, initialInput);

      // Load skill
      const skill = await skillLoader(step.skillName);
      if (!skill) {
        const failureReason = `SKILL-CHAIN-008: Skill "${step.skillName}" not found`;
        stepResults.push({
          stepIndex: index,
          skillName: step.skillName,
          result: {
            runId: "chain-error",
            skillName: step.skillName,
            sourceType: "unknown",
            mode: context.mode,
            state: "failed",
            filesTouched: [],
            commandsRun: [],
            verificationOutcome: "fail",
            plainLanguageSummary: failureReason,
            failureReason,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
          gateApproved: false,
          failed: true,
          failureReason,
        });

        return {
          chainName: chain.name,
          success: false,
          stepResults,
          failedAtStep: index,
          failureReason,
          durationMs: Date.now() - startTime,
        };
      }

      // Execute skill
      const skillResult = await runSkill({
        skill,
        context: {
          ...context,
          skillName: step.skillName,
        },
        scriptRunner,
        eventEngine,
        taskId,
      });

      // Check gating if applicable
      let gateApproved = true;
      let pdseScore: number | undefined;

      if (chain.gating === "pdse") {
        const threshold = step.pdseThreshold ?? defaultThreshold;
        const gateResult = await forgeGate(skillResult, threshold);
        gateApproved = gateResult.approved;
        pdseScore = gateResult.score;
      }

      const failed = !gateApproved || skillResult.state === "failed";

      stepResults.push({
        stepIndex: index,
        skillName: step.skillName,
        result: skillResult,
        gateApproved,
        pdseScore,
        failed,
        failureReason: failed ? (skillResult.failureReason ?? "Gate rejected") : undefined,
      });

      // Handle failure
      if (failed) {
        const failureAction = await handleGateFailure(step.onFailure, index, stepResults, promptUser);

        if (failureAction.shouldAbort) {
          return {
            chainName: chain.name,
            success: false,
            stepResults,
            failedAtStep: index,
            failureReason: stepResults[index]!.failureReason ?? "Step failed and chain was aborted",
            durationMs: Date.now() - startTime,
          };
        }
        // If not aborting, continue to next step
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failureReason = `SKILL-CHAIN-009: Step ${index + 1} threw exception - ${message}`;

      stepResults.push({
        stepIndex: index,
        skillName: step.skillName,
        result: {
          runId: "chain-error",
          skillName: step.skillName,
          sourceType: "unknown",
          mode: context.mode,
          state: "failed",
          filesTouched: [],
          commandsRun: [],
          verificationOutcome: "fail",
          plainLanguageSummary: failureReason,
          failureReason,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
        gateApproved: false,
        failed: true,
        failureReason,
      });

      return {
        chainName: chain.name,
        success: false,
        stepResults,
        failedAtStep: index,
        failureReason,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // All steps completed
  const allSucceeded = stepResults.every((r) => !r.failed);
  const firstFailedIndex = allSucceeded ? -1 : stepResults.findIndex((r) => r.failed);

  return {
    chainName: chain.name,
    success: allSucceeded,
    stepResults,
    failedAtStep: firstFailedIndex >= 0 ? firstFailedIndex : undefined,
    failureReason: allSucceeded ? undefined : stepResults.find((r) => r.failed)?.failureReason,
    durationMs: Date.now() - startTime,
  };
}
