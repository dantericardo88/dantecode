/**
 * stop-conditions.ts
 *
 * Stop condition evaluator for the bounded iteration engine.
 * Checks all hard caps and returns the stop reason if any is met.
 */

import type { GaslightConfig, GaslightSession, StopReason } from "./types.js";

export interface BudgetState {
  tokensUsed: number;
  elapsedMs: number;
  iterations: number;
  userStopped: boolean;
}

/**
 * Evaluate whether the session should stop.
 * Returns the stop reason if stopping, or null to continue.
 */
export function evaluateStopConditions(
  session: GaslightSession,
  budget: BudgetState,
  config: GaslightConfig,
): StopReason | null {
  // 1. User stop signal — always wins
  if (budget.userStopped) return "user-stop";

  // 2. Check if the last gate passed
  const lastIteration = session.iterations[session.iterations.length - 1];
  if (lastIteration?.gateDecision === "pass") return "pass";

  // 3. Check confidence threshold
  const lastScore = lastIteration?.gateScore ?? 0;
  if (lastScore >= config.confidenceThreshold) return "confidence";

  // 4. Token budget
  if (budget.tokensUsed >= config.maxTokens) return "budget-tokens";

  // 5. Time budget
  if (budget.elapsedMs >= config.maxSeconds * 1000) return "budget-time";

  // 6. Iteration budget
  if (budget.iterations >= config.maxIterations) return "budget-iterations";

  return null;
}

/**
 * Check if the final output is lesson-eligible.
 * Only lessons from PASS decisions can enter DanteSkillbook.
 */
export function isLessonEligible(session: GaslightSession): boolean {
  return session.finalGateDecision === "pass" && session.iterations.length > 0;
}
