/**
 * iteration-engine.ts
 *
 * The Iteration Engine — orchestrates the bounded refinement loop.
 *
 * Pipeline per iteration:
 * 1. Critique (Gaslighter role)
 * 2. Optional evidence escalation
 * 3. Rewrite (Agent role)
 * 4. DanteForge gate
 * 5. Stop condition check
 * 6. Repeat or stop
 */

import { randomUUID } from "node:crypto";
import type {
  GaslightConfig,
  GaslightSession,
  GaslightTrigger,
  GaslightGateDecision,
  StopReason,
} from "./types.js";
import { BudgetController } from "./budget-controller.js";
import { IterationHistory } from "./iteration-history.js";
import { buildGaslighterPrompt, buildFallbackCritique, parseGaslighterOutput, GASLIGHTER_SYSTEM_PROMPT } from "./gaslighter-role.js";
import { evaluateStopConditions, isLessonEligible } from "./stop-conditions.js";
import { DEFAULT_GASLIGHT_CONFIG } from "./types.js";

export interface IterationEngineOptions {
  config?: Partial<GaslightConfig>;
}

export interface GateResult {
  decision: GaslightGateDecision;
  score: number;
}

export interface EngineCallbacks {
  /**
   * Called when the Gaslighter critique prompt is ready.
   * Returns the LLM critique text, or null to use fallback.
   */
  onCritique?: (systemPrompt: string, userPrompt: string) => Promise<string | null>;

  /**
   * Called when a rewrite is needed based on critique.
   * Receives original draft + critique summary. Returns rewritten draft.
   */
  onRewrite?: (originalDraft: string, critiqueSummary: string) => Promise<string>;

  /**
   * Called for DanteForge gate evaluation.
   * Returns gate decision and score.
   */
  onGate?: (draft: string, iteration: number) => Promise<GateResult>;

  /**
   * Called when the engine stops (informational).
   */
  onStop?: (reason: StopReason, session: GaslightSession) => void;
}

/**
 * Run a bounded Gaslight refinement session.
 *
 * @param initialDraft - The initial output to refine.
 * @param trigger - What triggered this session.
 * @param callbacks - LLM/gate integration hooks.
 * @param options - Engine configuration.
 * @returns The completed GaslightSession.
 */
export async function runIterationEngine(
  initialDraft: string,
  trigger: GaslightTrigger,
  callbacks: EngineCallbacks = {},
  options: IterationEngineOptions = {},
): Promise<GaslightSession> {
  const config: GaslightConfig = { ...DEFAULT_GASLIGHT_CONFIG, ...options.config };
  const sessionId = randomUUID();
  const budget = new BudgetController(config);
  const history = new IterationHistory();
  let currentDraft = initialDraft;
  let stopReason: StopReason | undefined;
  let finalGateDecision: GaslightGateDecision | undefined;

  const session: GaslightSession = {
    sessionId,
    trigger,
    iterations: [],
    lessonEligible: false,
    startedAt: new Date().toISOString(),
  };

  while (!budget.isExhausted()) {
    budget.incrementIteration();
    const iterNum = history.count() + 1;

    // Record this draft
    history.recordDraft(currentDraft);

    // 1. Critique
    let critiqueText: string | null = null;
    if (callbacks.onCritique) {
      critiqueText = await callbacks.onCritique(
        GASLIGHTER_SYSTEM_PROMPT,
        buildGaslighterPrompt(currentDraft, iterNum),
      );
    }

    const critique = critiqueText
      ? (parseGaslighterOutput(critiqueText, iterNum) ?? buildFallbackCritique(currentDraft, iterNum))
      : buildFallbackCritique(currentDraft, iterNum);
    history.attachCritique(critique);

    // 2. Rewrite
    if (callbacks.onRewrite) {
      currentDraft = await callbacks.onRewrite(currentDraft, critique.summary);
    }
    // If no rewrite hook, keep same draft (gate will likely fail → stop on budget)

    // 3. Gate
    let gateDecision: GaslightGateDecision = "fail";
    let gateScore = 0;
    if (callbacks.onGate) {
      const gateResult = await callbacks.onGate(currentDraft, iterNum);
      gateDecision = gateResult.decision;
      gateScore = gateResult.score;
      // Rough token estimate: ~4 chars per token
      budget.addTokens(Math.ceil(currentDraft.length / 4));
    }
    history.attachGateResult(gateDecision, gateScore);

    finalGateDecision = gateDecision;

    // 4. Check stop conditions
    session.iterations = history.toSessionIterations();
    const budgetSnap = budget.snapshot();
    const stop = evaluateStopConditions(session, budgetSnap, config);
    if (stop) {
      stopReason = stop;
      break;
    }
  }

  // If loop exited due to budget exhaustion without an explicit stop reason
  if (!stopReason) {
    stopReason = "budget-iterations";
  }

  const endedAt = new Date().toISOString();
  session.iterations = history.toSessionIterations();
  session.stopReason = stopReason;
  session.finalOutput = currentDraft;
  session.finalGateDecision = finalGateDecision;
  session.endedAt = endedAt;
  session.lessonEligible = isLessonEligible(session);

  if (callbacks.onStop) {
    callbacks.onStop(stopReason, session);
  }

  return session;
}

/**
 * Signal an immediate user stop.
 * This sets a flag that causes the running engine to stop at the next check.
 * In production, wire this to a shared abort controller.
 */
export function createStopController(): { stop: () => void; stopped: () => boolean } {
  let _stopped = false;
  return {
    stop: () => { _stopped = true; },
    stopped: () => _stopped,
  };
}
