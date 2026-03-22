/**
 * stats.ts
 *
 * Aggregates statistics across Gaslight sessions.
 */

import type { GaslightSession, GaslightStats } from "./types.js";

export function computeStats(sessions: GaslightSession[]): GaslightStats {
  let sessionsWithPass = 0;
  let sessionsAborted = 0;
  let totalIterations = 0;
  let lessonEligibleCount = 0;
  let distilledCount = 0;

  for (const s of sessions) {
    const stopReason = s.stopReason;
    if (stopReason === "pass") sessionsWithPass++;
    if (stopReason === "user-stop" || stopReason === "policy-abort") sessionsAborted++;
    totalIterations += s.iterations.length;
    if (s.lessonEligible) lessonEligibleCount++;
    if (s.distilledAt) distilledCount++;
  }

  const averageIterations = sessions.length > 0 ? totalIterations / sessions.length : 0;

  return {
    totalSessions: sessions.length,
    sessionsWithPass,
    sessionsAborted,
    averageIterations,
    lessonEligibleCount,
    distilledCount,
  };
}
