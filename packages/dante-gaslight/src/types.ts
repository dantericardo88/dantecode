/**
 * types.ts
 *
 * Core types for the DanteGaslight engine.
 * Bounded adversarial refinement loop with explicit stop conditions.
 */

import { z } from "zod";

// ────────────────────────────────────────────────────────
// Trigger channels
// ────────────────────────────────────────────────────────

export const TriggerChannelSchema = z.enum([
  "explicit-user", // "go deeper", "again but better", /gaslight on
  "verification", // score below threshold
  "policy", // task-class policy (e.g. code-generation, long-research)
  "audit", // random configurable audit rate
  "novel-task", // confidence score < 0.5 on unfamiliar task type
]);
export type TriggerChannel = z.infer<typeof TriggerChannelSchema>;

export const GaslightTriggerSchema = z.object({
  channel: TriggerChannelSchema,
  phrase: z.string().optional(), // for explicit-user
  score: z.number().min(0).max(1).optional(), // for verification
  taskClass: z.string().optional(), // for policy
  sessionId: z.string().optional(),
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});
export type GaslightTrigger = z.infer<typeof GaslightTriggerSchema>;

// ────────────────────────────────────────────────────────
// Critique
// ────────────────────────────────────────────────────────

export const CritiquePointSchema = z.object({
  aspect: z.enum([
    "shallow-reasoning",
    "unsupported-claim",
    "missing-structure",
    "missing-evidence",
    "missing-tool",
    "failure-pattern",
    "other",
  ]),
  description: z.string(),
  severity: z.enum(["low", "medium", "high"]),
});
export type CritiquePoint = z.infer<typeof CritiquePointSchema>;

export const GaslightCritiqueSchema = z.object({
  iteration: z.number().int().min(1),
  points: z.array(CritiquePointSchema),
  summary: z.string(),
  needsEvidenceEscalation: z.boolean().default(false),
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});
export type GaslightCritique = z.infer<typeof GaslightCritiqueSchema>;

// ────────────────────────────────────────────────────────
// Gate decisions
// ────────────────────────────────────────────────────────

export const GaslightGateDecisionSchema = z.enum(["pass", "fail", "review-required"]);
export type GaslightGateDecision = z.infer<typeof GaslightGateDecisionSchema>;

// ────────────────────────────────────────────────────────
// Iteration record
// ────────────────────────────────────────────────────────

export const IterationRecordSchema = z.object({
  iteration: z.number().int().min(1),
  draft: z.string(),
  critique: GaslightCritiqueSchema.optional(),
  gateDecision: GaslightGateDecisionSchema.optional(),
  gateScore: z.number().min(0).max(1).optional(),
  tokensUsed: z.number().int().min(0).optional(),
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});
export type IterationRecord = z.infer<typeof IterationRecordSchema>;

// ────────────────────────────────────────────────────────
// Stop reasons
// ────────────────────────────────────────────────────────

export const StopReasonSchema = z.enum([
  "pass", // DanteForge returned PASS
  "confidence", // confidence threshold reached
  "budget-tokens", // token budget exhausted
  "budget-time", // wall-clock limit hit
  "budget-iterations", // max iterations reached
  "user-stop", // explicit stop signal
  "policy-abort", // policy says not worth it
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

// ────────────────────────────────────────────────────────
// Session
// ────────────────────────────────────────────────────────

export const GaslightSessionSchema = z.object({
  sessionId: z.string(),
  trigger: GaslightTriggerSchema,
  iterations: z.array(IterationRecordSchema).default([]),
  stopReason: StopReasonSchema.optional(),
  finalOutput: z.string().optional(),
  finalGateDecision: GaslightGateDecisionSchema.optional(),
  lessonEligible: z.boolean().default(false),
  /** ISO timestamp set when this session has been distilled into the Skillbook. */
  distilledAt: z.string().datetime().optional(),
  startedAt: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
  endedAt: z.string().datetime().optional(),
});
export type GaslightSession = z.infer<typeof GaslightSessionSchema>;

// ────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────

export interface GaslightConfig {
  /** Whether the engine is globally enabled. Default: true (enabled out of the box with safe budget). Set DANTECODE_GASLIGHT=0 to disable. */
  enabled: boolean;
  /** Max iterations per session. Default: 3. */
  maxIterations: number;
  /** Max total tokens per session. Default: 5000. */
  maxTokens: number;
  /** Max wall-clock seconds per session. Default: 60. */
  maxSeconds: number;
  /** DanteForge pass threshold (0-1). Default: 0.75. */
  passThreshold: number;
  /** Confidence threshold to stop early. Default: 0.9. */
  confidenceThreshold: number;
  /** Enable auto-trigger on verification score below this. 0 = disabled. */
  autoTriggerThreshold: number;
  /** Task classes that allow policy-based auto-trigger. */
  policyTaskClasses: string[];
  /** Random audit rate (0-1). 0 = disabled. */
  auditRate: number;
  /**
   * Max sessions to keep on disk. Oldest sessions are deleted after each save.
   * Default: 100. Set to 0 to disable cleanup.
   */
  maxSessions: number;
}

export const DEFAULT_GASLIGHT_CONFIG: GaslightConfig = {
  enabled: true,
  maxIterations: 3,
  maxTokens: 5_000,
  maxSeconds: 60,
  passThreshold: 0.75,
  confidenceThreshold: 0.9,
  autoTriggerThreshold: 0,
  policyTaskClasses: ["code-generation", "long-research", "plan", "patch-synthesis"],
  auditRate: 0,
  maxSessions: 100,
};

// ────────────────────────────────────────────────────────
// Stats
// ────────────────────────────────────────────────────────

export interface GaslightStats {
  totalSessions: number;
  sessionsWithPass: number;
  sessionsAborted: number;
  averageIterations: number;
  lessonEligibleCount: number;
  distilledCount: number;
}
