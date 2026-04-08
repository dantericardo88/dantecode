// ============================================================================
// @dantecode/core — AutonomyOrchestrator
//
// The central wiring hub for autonomous self-correction. Connects:
//   TaskCircuitBreaker  →  recovery trigger
//   LoopDetector        →  stuck detection
//   RecoveryEngine      →  fresh context re-read
//   ScopeReducer        →  focus narrowing
//   ConvergenceMetrics  →  telemetry
//
// When the agent hits a wall (repeated failures, stuck loops), this
// orchestrator decides the exact recovery action and builds the injection
// payload that the agent-loop splices into the conversation.
//
// Devin/OpenHands pattern: verify → fail → diagnose → recover → re-verify.
// We implement the diagnose+recover step that was previously missing.
// ============================================================================

import { RecoveryEngine } from "./recovery-engine.js";
import type { RecoveryResult } from "./recovery-engine.js";
import type { FailureAction } from "./task-circuit-breaker.js";
import type { LoopDetectionResult } from "./loop-detector.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** The action the orchestrator recommends. */
export type AutonomyActionType =
  | "continue"         // No intervention needed
  | "recover"          // Re-read files + inject fresh context
  | "scope_reduce"     // Narrow focus to single file/error
  | "strategy_switch"  // Fundamental approach change
  | "escalate";        // All recovery exhausted, surface to user

/** A constraint that narrows what the agent works on next. */
export interface ScopeConstraint {
  /** Files to focus on exclusively. Empty = no restriction. */
  focusFiles: string[];
  /** The single most important error to fix first. */
  primaryError: string;
  /** Max number of files to touch in the next attempt. */
  maxEditTargets: number;
  /** Human-readable instruction to prepend to the agent prompt. */
  instruction: string;
}

/** The full recovery decision returned by `decide()`. */
export interface AutonomyDecision {
  /** What action the agent-loop should take. */
  type: AutonomyActionType;
  /** Human-readable reason (logged to console). */
  reason: string;
  /**
   * Messages to inject as `role: "user"` into the conversation.
   * Ordered: first is highest priority.
   */
  injectedMessages: string[];
  /** Fresh file context from re-read (if type === "recover"). */
  freshContext?: RecoveryResult;
  /** Scope constraints for the next attempt. */
  scopeConstraint?: ScopeConstraint;
  /** Strategy override. */
  strategy: "standard" | "reduced_scope" | "minimal";
  /** Whether the orchestrator recommends a backoff delay before retrying. */
  backoffMs: number;
  /** Running count of recovery attempts this session. */
  recoveryAttempt: number;
}

/** Input to `decide()`. */
export interface AutonomyInput {
  /** Result from TaskCircuitBreaker.recordFailure(). */
  breakerAction?: FailureAction;
  /** Result from LoopDetector.recordAction(). */
  loopResult?: LoopDetectionResult;
  /** The error message that triggered recovery (if any). */
  errorMessage?: string;
  /** Files touched in this session (for scope reduction). */
  touchedFiles?: string[];
  /** Current project root (for re-read). */
  projectRoot: string;
  /** Primary file the agent is working on (best target for re-read). */
  primaryTargetFile?: string;
  /** Current round/iteration number. */
  round: number;
}

/** Configuration for the orchestrator. */
export interface AutonomyOrchestratorOptions {
  /** Maximum total recovery attempts per session. Default: 4. */
  maxRecoveryAttempts?: number;
  /** Maximum scope-reduction attempts before escalation. Default: 2. */
  maxScopeReductions?: number;
  /** Injectable recovery engine (for testing). */
  recoveryEngine?: RecoveryEngine;
}

// ----------------------------------------------------------------------------
// AutonomyOrchestrator
// ----------------------------------------------------------------------------

/**
 * Decides the recovery action when the agent gets stuck.
 *
 * Usage in agent-loop:
 *
 *   const decision = await orchestrator.decide({ breakerAction, loopResult, ... });
 *   if (decision.type !== "continue") {
 *     decision.injectedMessages.forEach(m => messages.push({ role: "user", content: m }));
 *     if (decision.freshContext?.targetContent) {
 *       // splice fresh file content into next prompt
 *     }
 *   }
 */
export class AutonomyOrchestrator {
  private readonly maxRecoveryAttempts: number;
  private readonly maxScopeReductions: number;
  private readonly recoveryEngine: RecoveryEngine;

  /** Session-level recovery attempt counter. */
  private recoveryAttempts = 0;
  /** Session-level scope reduction counter. */
  private scopeReductions = 0;
  /** Strategy currently in effect. */
  private currentStrategy: "standard" | "reduced_scope" | "minimal" = "standard";
  /** History of decisions for trend analysis. */
  private decisionHistory: Array<{ type: AutonomyActionType; round: number }> = [];

  constructor(options: AutonomyOrchestratorOptions = {}) {
    this.maxRecoveryAttempts = options.maxRecoveryAttempts ?? 4;
    this.maxScopeReductions = options.maxScopeReductions ?? 2;
    this.recoveryEngine = options.recoveryEngine ?? new RecoveryEngine();
  }

  /**
   * Evaluates the current agent state and returns the recommended action.
   * The caller is responsible for applying the decision.
   */
  async decide(input: AutonomyInput): Promise<AutonomyDecision> {
    const { breakerAction, loopResult, errorMessage, touchedFiles = [], projectRoot, primaryTargetFile, round } = input;

    // ── Guard: nothing to recover from ────────────────────────────────────────
    const needsRecovery =
      (breakerAction && (breakerAction.action === "pause_and_recover" || breakerAction.action === "escalate")) ||
      (loopResult && loopResult.stuck);

    if (!needsRecovery) {
      return this.noop(round);
    }

    // ── Guard: all recovery exhausted ─────────────────────────────────────────
    if (breakerAction?.action === "escalate" || this.recoveryAttempts >= this.maxRecoveryAttempts) {
      return this.escalate(round, errorMessage);
    }

    this.recoveryAttempts++;

    // ── Stuck loop: scope reduction before re-read ────────────────────────────
    if (loopResult?.stuck && this.scopeReductions < this.maxScopeReductions) {
      this.scopeReductions++;
      this.currentStrategy = this.scopeReductions >= 2 ? "minimal" : "reduced_scope";
      return this.buildScopeReduction(round, loopResult, touchedFiles, errorMessage);
    }

    // ── Circuit breaker pause: re-read + inject fresh context ────────────────
    return this.buildRecovery(round, projectRoot, primaryTargetFile, touchedFiles, errorMessage, breakerAction);
  }

  // --------------------------------------------------------------------------
  // Decision builders
  // --------------------------------------------------------------------------

  private noop(round: number): AutonomyDecision {
    this.decisionHistory.push({ type: "continue", round });
    return {
      type: "continue",
      reason: "No recovery needed",
      injectedMessages: [],
      strategy: this.currentStrategy,
      backoffMs: 0,
      recoveryAttempt: this.recoveryAttempts,
    };
  }

  private escalate(round: number, errorMessage?: string): AutonomyDecision {
    this.decisionHistory.push({ type: "escalate", round });
    const msg = buildEscalationMessage(errorMessage, this.recoveryAttempts);
    return {
      type: "escalate",
      reason: `All ${this.recoveryAttempts} recovery attempts exhausted`,
      injectedMessages: [msg],
      strategy: "minimal",
      backoffMs: 0,
      recoveryAttempt: this.recoveryAttempts,
    };
  }

  private buildScopeReduction(
    round: number,
    loopResult: LoopDetectionResult,
    touchedFiles: string[],
    errorMessage?: string,
  ): AutonomyDecision {
    this.decisionHistory.push({ type: "scope_reduce", round });

    const primaryFile = touchedFiles[0] ?? "(unknown file)";
    const constraint = buildScopeConstraint(primaryFile, touchedFiles, errorMessage, this.currentStrategy);

    return {
      type: "scope_reduce",
      reason: `Stuck loop detected (${loopResult.reason ?? "pattern"}), attempt ${this.scopeReductions}/${this.maxScopeReductions}`,
      injectedMessages: [constraint.instruction],
      scopeConstraint: constraint,
      strategy: this.currentStrategy,
      backoffMs: 0,
      recoveryAttempt: this.recoveryAttempts,
    };
  }

  private async buildRecovery(
    round: number,
    projectRoot: string,
    primaryTargetFile: string | undefined,
    touchedFiles: string[],
    errorMessage: string | undefined,
    breakerAction: FailureAction | undefined,
  ): Promise<AutonomyDecision> {
    this.decisionHistory.push({ type: "recover", round });

    // Re-read primary file for fresh context
    let freshContext: RecoveryResult | undefined;
    const targetFile = primaryTargetFile ?? touchedFiles[0];
    if (targetFile) {
      try {
        freshContext = await this.recoveryEngine.rereadAndRecover(targetFile, projectRoot);
      } catch {
        // non-fatal — proceed without fresh context
      }
    }

    const messages = buildRecoveryMessages(
      freshContext,
      errorMessage,
      breakerAction,
      this.recoveryAttempts,
      this.currentStrategy,
    );

    return {
      type: "recover",
      reason: `Circuit breaker triggered (attempt ${this.recoveryAttempts}/${this.maxRecoveryAttempts})`,
      injectedMessages: messages,
      freshContext,
      strategy: this.currentStrategy,
      backoffMs: 250 * Math.pow(2, this.recoveryAttempts - 1), // 250ms, 500ms, 1s, 2s
      recoveryAttempt: this.recoveryAttempts,
    };
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  getStrategy(): "standard" | "reduced_scope" | "minimal" {
    return this.currentStrategy;
  }

  getRecoveryAttempts(): number {
    return this.recoveryAttempts;
  }

  getDecisionHistory(): Array<{ type: AutonomyActionType; round: number }> {
    return [...this.decisionHistory];
  }

  reset(): void {
    this.recoveryAttempts = 0;
    this.scopeReductions = 0;
    this.currentStrategy = "standard";
    this.decisionHistory = [];
  }
}

// ----------------------------------------------------------------------------
// Message builders
// ----------------------------------------------------------------------------

function buildRecoveryMessages(
  freshContext: RecoveryResult | undefined,
  errorMessage: string | undefined,
  breakerAction: FailureAction | undefined,
  attempt: number,
  strategy: string,
): string[] {
  const messages: string[] = [];

  // Core recovery instruction
  const intro = attempt === 1
    ? "[AutonomyOrchestrator] Recovery attempt 1: I've re-read the target file with fresh eyes."
    : `[AutonomyOrchestrator] Recovery attempt ${attempt}: Trying a different approach.`;

  let body = intro;

  if (errorMessage) {
    body += `\n\nThe recurring error is:\n${errorMessage.slice(0, 400)}`;
  }

  if (freshContext?.recovered && freshContext.targetContent) {
    body += `\n\nFresh file content (${freshContext.contextFiles.length} context files also re-read):\n`;
    body += `— File content is now loaded fresh from disk. Please re-examine it carefully before making changes.`;
  } else if (freshContext && !freshContext.recovered) {
    body += `\n\n⚠ Could not re-read target file: ${freshContext.error ?? "unknown error"}`;
  }

  if (strategy === "reduced_scope") {
    body += "\n\n**Strategy: reduced scope** — Focus on fixing ONE error at a time. Do not attempt broad refactors.";
  } else if (strategy === "minimal") {
    body += "\n\n**Strategy: minimal** — Make the smallest possible change that fixes the immediate error. Nothing else.";
  }

  if (breakerAction) {
    body += `\n\n(Recovery context: ${breakerAction.identicalCount} identical failures, ${breakerAction.recoveryAttempts} recovery attempts so far)`;
  }

  messages.push(body);
  return messages;
}

function buildEscalationMessage(errorMessage: string | undefined, attempts: number): string {
  let msg = `[AutonomyOrchestrator] Escalating after ${attempts} recovery attempt(s).`;
  if (errorMessage) {
    msg += `\n\nThe unresolved error is:\n${errorMessage.slice(0, 300)}`;
  }
  msg += "\n\nThis problem requires a fundamentally different approach or manual intervention. Please describe what you tried and what the blocker is.";
  return msg;
}

function buildScopeConstraint(
  primaryFile: string,
  touchedFiles: string[],
  errorMessage: string | undefined,
  strategy: "standard" | "reduced_scope" | "minimal",
): ScopeConstraint {
  const maxTargets = strategy === "minimal" ? 1 : 2;
  const focusFiles = touchedFiles.slice(0, maxTargets);

  const primaryError = errorMessage
    ? errorMessage.split("\n")[0]?.slice(0, 200) ?? errorMessage.slice(0, 200)
    : "the most critical error";

  const strategyLabel = strategy === "minimal"
    ? "MINIMAL MODE: Make the single smallest change to fix one error."
    : "REDUCED SCOPE: Focus exclusively on one file and one error.";

  const instruction = [
    `[AutonomyOrchestrator] Stuck loop detected. Switching to ${strategy} strategy.`,
    ``,
    strategyLabel,
    ``,
    `Focus file: ${primaryFile}`,
    focusFiles.length > 1 ? `Also allowed: ${focusFiles.slice(1).join(", ")}` : "",
    ``,
    `Priority error to fix:\n${primaryError}`,
    ``,
    `Do NOT touch any other files until this specific error is resolved. Do NOT refactor. Do NOT add new features.`,
  ].filter((l) => l !== undefined && !(l === "" && false)).join("\n");

  return {
    focusFiles,
    primaryError,
    maxEditTargets: maxTargets,
    instruction,
  };
}
