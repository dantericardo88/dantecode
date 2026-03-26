/**
 * fearset-types.ts
 *
 * Canonical contracts for the DanteFearSet engine.
 * Tim Ferriss Fear-Setting: Define → Prevent → Repair + Benefits + Inaction Cost.
 * Integrated inside DanteGaslight — no new packages.
 */

import { z } from "zod";
import { RuntimeEventSchema } from "./runtime-events.js";

// ─── Trigger channels ──────────────────────────────────────────────────────────

export const FearSetTriggerChannelSchema = z.enum([
  "explicit-user", // /fearset command
  "long-horizon", // task classified as spanning >N steps / long duration
  "destructive", // task contains irreversible or high-blast-radius actions
  "weak-robustness", // DanteForge or DanteGaslight marks the plan fragile
  "high-risk-council", // multi-agent/council plan rated high-risk
  "repeated-failure", // same failure pattern seen in prior sessions
  "policy", // task class policy requires fear-setting
]);
export type FearSetTriggerChannel = z.infer<typeof FearSetTriggerChannelSchema>;

export const FearSetTriggerSchema = z.object({
  channel: FearSetTriggerChannelSchema,
  taskClass: z.string().optional(),
  sessionId: z.string().optional(),
  rationale: z.string().optional(),
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});
export type FearSetTrigger = z.infer<typeof FearSetTriggerSchema>;

// ─── Column names ──────────────────────────────────────────────────────────────

export const FearSetColumnNameSchema = z.enum([
  "define", // What is the realistic worst case?
  "prevent", // How do we stop it from happening?
  "repair", // If it happens anyway, how do we recover?
  "benefits", // What do we gain by acting?
  "inaction", // What is the cost of doing nothing?
]);
export type FearSetColumnName = z.infer<typeof FearSetColumnNameSchema>;

// ─── Prevention action ─────────────────────────────────────────────────────────

export const SimulationStatusSchema = z.enum([
  "simulatable", // Can and should be sandbox-tested
  "partially-simulatable", // Some components exercisable, others reasoned
  "non-simulatable", // Reasoning + verification only
  "simulated", // Actually ran through DanteSandbox
  "simulation-failed", // Ran but did not pass
]);
export type SimulationStatus = z.infer<typeof SimulationStatusSchema>;

export const PreventionActionSchema = z.object({
  id: z.string(),
  description: z.string(),
  /** How concretely this prevents or reduces the risk. */
  mechanism: z.string(),
  /** Estimated probability reduction (0-1). */
  riskReduction: z.number().min(0).max(1).optional(),
  simulationStatus: SimulationStatusSchema.default("non-simulatable"),
  /** Evidence from sandbox simulation run, if available. */
  simulationEvidence: z.string().optional(),
});
export type PreventionAction = z.infer<typeof PreventionActionSchema>;

// ─── Repair plan ───────────────────────────────────────────────────────────────

export const RepairPlanSchema = z.object({
  id: z.string(),
  description: z.string(),
  steps: z.array(z.string()),
  /** Estimated time-to-recovery in plain language. */
  estimatedRecovery: z.string().optional(),
  simulationStatus: SimulationStatusSchema.default("non-simulatable"),
  simulationEvidence: z.string().optional(),
});
export type RepairPlan = z.infer<typeof RepairPlanSchema>;

// ─── Inaction cost ────────────────────────────────────────────────────────────

export const InactionCostSchema = z.object({
  description: z.string(),
  /** Time horizon for the cost to materialize. */
  timeHorizon: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});
export type InactionCost = z.infer<typeof InactionCostSchema>;

// ─── Column ───────────────────────────────────────────────────────────────────

export const FearColumnSchema = z.object({
  name: FearSetColumnNameSchema,
  rawOutput: z.string(),
  /** For "define" columns: extracted worst-case statements. */
  worstCases: z.array(z.string()).default([]),
  /** For "prevent" columns: structured actions. */
  preventionActions: z.array(PreventionActionSchema).default([]),
  /** For "repair" columns: structured plans. */
  repairPlans: z.array(RepairPlanSchema).default([]),
  /** For "benefits" columns: benefit statements. */
  benefits: z.array(z.string()).default([]),
  /** For "inaction" columns: cost items. */
  inactionCosts: z.array(InactionCostSchema).default([]),
  /** Quality score from DanteForge (0-1). */
  robustnessScore: z.number().min(0).max(1).optional(),
  /** True when column was truncated due to token/time budget exhaustion. */
  stoppedByBudget: z.boolean().default(false),
  /** Validation warnings (e.g., "no worst-cases extracted"). Empty = clean. */
  validationWarnings: z.array(z.string()).default([]),
  completedAt: z.string().datetime().optional(),
});
export type FearColumn = z.infer<typeof FearColumnSchema>;

// ─── Robustness scoring ───────────────────────────────────────────────────────

export const FearSetRobustnessScoreSchema = z.object({
  /** Overall plan robustness (0-1). */
  overall: z.number().min(0).max(1),
  /** Per-column breakdown. */
  byColumn: z.record(FearSetColumnNameSchema, z.number().min(0).max(1)).optional(),
  /** Whether at least one Prevent/Repair action was sandbox-simulated. */
  hasSimulationEvidence: z.boolean().default(false),
  /** Estimated aggregate risk reduction (0-1). */
  estimatedRiskReduction: z.number().min(0).max(1).optional(),
  /** DanteForge gate decision: pass / fail / review-required. */
  gateDecision: z.enum(["pass", "fail", "review-required"]),
  /** Human-readable justification. */
  justification: z.string(),
  scoredAt: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});
export type FearSetRobustnessScore = z.infer<typeof FearSetRobustnessScoreSchema>;

// ─── Full result ──────────────────────────────────────────────────────────────

/** Synthesized go/no-go/conditional decision after the gate passes. */
export const FearSetRecommendationSchema = z.object({
  decision: z.enum(["go", "no-go", "conditional"]),
  reasoning: z.string(),
  /** Conditions that must be met if decision === "conditional". */
  conditions: z.array(z.string()).default([]),
});
export type FearSetRecommendation = z.infer<typeof FearSetRecommendationSchema>;

export const FearSetResultSchema = z.object({
  id: z.string().uuid(),
  trigger: FearSetTriggerSchema,
  /** The decision context or task being fear-set. */
  context: z.string(),
  columns: z.array(FearColumnSchema),
  robustnessScore: FearSetRobustnessScoreSchema.optional(),
  /** Synthesized decision produced after a passing gate. */
  synthesizedRecommendation: FearSetRecommendationSchema.optional(),
  /** Whether this result has been distilled into DanteSkillbook. */
  distilledAt: z.string().datetime().optional(),
  /** Whether the full run passed the DanteForge gate. */
  passed: z.boolean().default(false),
  /** Operating mode. */
  mode: z.enum(["standard", "lite"]).default("standard"),
  /** Captured shared runtime events emitted during the FearSet run. */
  runtimeEvents: z.array(RuntimeEventSchema).optional(),
  /** Why the run ended (user-stop, budget, policy-abort, or completed normally). */
  stopReason: z.enum(["user-stop", "budget-exhausted", "policy-abort", "completed"]).optional(),
  /** ISO timestamp when the run was stopped early (user-stop / budget / policy). */
  stoppedAt: z.string().datetime().optional(),
  startedAt: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
  completedAt: z.string().datetime().optional(),
});
export type FearSetResult = z.infer<typeof FearSetResultSchema>;

// ─── Config ───────────────────────────────────────────────────────────────────

export interface FearSetConfig {
  /** Whether FearSet is enabled. Default: false (opt-in). */
  enabled: boolean;
  /** Operating mode. lite = faster, fewer columns, lower budget. */
  mode: "standard" | "lite";
  /** Max tokens per column. Default: 2000. */
  maxTokensPerColumn: number;
  /** Max wall-clock seconds per column. Default: 60. */
  maxSecondsPerColumn: number;
  /** Minimum robustness score to accept plan. Default: 0.7. */
  robustnessPassThreshold: number;
  /** Minimum estimated risk reduction (0-1) or explicit justification required. Default: 0.2. */
  minRiskReduction: number;
  /** Task classes that require FearSet by policy. */
  policyTaskClasses: string[];
  /** Whether to attempt sandbox simulation for risky Prevent/Repair actions. */
  sandboxSimulation: boolean;
  /**
   * Max results to keep on disk. Oldest results are deleted after each save.
   * Default: 200. Set to 0 to disable cleanup.
   */
  maxResults: number;
}

export const DEFAULT_FEARSET_CONFIG: FearSetConfig = {
  enabled: false,
  mode: "standard",
  maxTokensPerColumn: 2_000,
  maxSecondsPerColumn: 60,
  robustnessPassThreshold: 0.7,
  minRiskReduction: 0.2,
  policyTaskClasses: [
    "destructive-op",
    "long-horizon",
    "multi-agent-plan",
    "architecture-decision",
  ],
  sandboxSimulation: true,
  maxResults: 200,
};
