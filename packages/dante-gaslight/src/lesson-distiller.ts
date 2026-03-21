/**
 * lesson-distiller.ts
 *
 * Distills a lesson-eligible GaslightSession into a Skillbook UpdateOperation.
 * This is the bridge between a successful critique cycle and permanent learning.
 *
 * Rules:
 * - Only call with session.lessonEligible === true (throws otherwise)
 * - Trust score derives from final gate score, floored at 0.5
 * - Section derives from trigger channel (or taskClass for policy triggers)
 * - Content = finalOutput + high-severity critique insights
 */

import { randomUUID } from "node:crypto";
import type { GaslightSession, TriggerChannel } from "./types.js";
import type { Skill, UpdateOperation } from "@dantecode/runtime-spine";

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export interface LessonDistillerOptions {
  /** Override the derived section name. */
  section?: string;
  /** Override the derived title. */
  title?: string;
  /** Override the trust score (0-1). Still floored at 0.5. */
  trustScore?: number;
}

export interface DistilledLesson {
  proposal: UpdateOperation;
  section: string;
  trustScore: number;
}

// ────────────────────────────────────────────────────────
// Section derivation
// ────────────────────────────────────────────────────────

export const CHANNEL_TO_SECTION: Record<TriggerChannel, string> = {
  "explicit-user": "refinement",
  "verification": "quality-gates",
  "policy": "task-patterns",
  "audit": "general",
};

/**
 * Derive a Skillbook section from the trigger channel.
 * For policy triggers, prefers the task class name if provided.
 */
export function deriveSectionFromTrigger(
  channel: TriggerChannel,
  taskClass?: string,
): string {
  if (channel === "policy" && taskClass) return taskClass;
  return CHANNEL_TO_SECTION[channel];
}

// ────────────────────────────────────────────────────────
// Insight extraction
// ────────────────────────────────────────────────────────

/**
 * Extract unique high-severity critique descriptions from all iterations.
 */
export function extractHighSeverityInsights(
  session: GaslightSession,
  max = 5,
): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const iter of session.iterations) {
    if (!iter.critique) continue;
    for (const point of iter.critique.points) {
      if (point.severity === "high" && !seen.has(point.description)) {
        seen.add(point.description);
        results.push(point.description);
        if (results.length >= max) return results;
      }
    }
  }
  return results;
}

// ────────────────────────────────────────────────────────
// Main distillation function
// ────────────────────────────────────────────────────────

/**
 * Distill a lesson-eligible session into a Skillbook UpdateOperation.
 *
 * @throws if `!session.lessonEligible`
 */
export function distillLesson(
  session: GaslightSession,
  opts: LessonDistillerOptions = {},
): DistilledLesson {
  if (!session.lessonEligible) {
    throw new Error(
      `Session ${session.sessionId} is not lesson-eligible (finalGateDecision !== "pass" or no iterations).`,
    );
  }

  const channel = session.trigger.channel;
  const taskClass = session.trigger.taskClass;
  const section = opts.section ?? deriveSectionFromTrigger(channel, taskClass);

  // Trust score from last iteration's gate score, floored at 0.5
  const lastIter = session.iterations[session.iterations.length - 1];
  const rawScore = opts.trustScore ?? lastIter?.gateScore ?? 0.75;
  const trustScore = Math.max(0.5, Math.min(1, rawScore));

  // Build content
  const finalOutput = session.finalOutput ?? "";
  const insights = extractHighSeverityInsights(session);
  const insightBlock =
    insights.length > 0
      ? `\n\n### Key Critique Insights\n\n${insights.map((i) => `- ${i}`).join("\n")}`
      : "";
  const content = `${finalOutput}${insightBlock}`;

  // Build title
  const iterCount = session.iterations.length;
  const title =
    opts.title ??
    `Lesson from ${channel} trigger (${iterCount} iteration${iterCount === 1 ? "" : "s"})`;

  const now = new Date().toISOString();
  const candidateSkill: Skill = {
    id: randomUUID(),
    title,
    content,
    section,
    trustScore,
    sourceSessionId: session.sessionId,
    createdAt: session.endedAt ?? now,
    updatedAt: now,
  };

  const proposal: UpdateOperation = {
    action: "add",
    candidateSkill,
    rationale: `Distilled from gaslight session ${session.sessionId} (trigger: ${channel}, stop: ${session.stopReason ?? "unknown"}, gate: pass)`,
  };

  return { proposal, section, trustScore };
}
