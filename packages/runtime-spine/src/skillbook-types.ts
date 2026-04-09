import { z } from "zod";

// Skill stored in the DanteSkillbook
export const SkillSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  section: z.string(),
  trustScore: z.number().min(0).max(1).optional(),
  sourceSessionId: z.string().optional(),
  sourceRunId: z.string().optional(),
  /** Number of times this skill produced a "pass" outcome. */
  successCount: z.number().int().min(0).optional(),
  /** Total times this skill was applied (pass or not). */
  useCount: z.number().int().min(0).optional(),
  /** Computed win-rate: successCount / useCount. */
  winRate: z.number().min(0).max(1).optional(),
  /** Number of sessions where this skill was injected. */
  appliedInSessions: z.number().int().min(0).optional(),
  /** Sessions where skill was injected AND the session succeeded. */
  sessionsSucceeded: z.number().int().min(0).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Skill = z.infer<typeof SkillSchema>;

// Skill update operations
export const UpdateOperationSchema = z.object({
  action: z.enum(["add", "refine", "remove", "merge", "reject"]),
  targetSkillId: z.string().optional(),
  candidateSkill: SkillSchema.optional(),
  rationale: z.string(),
});
export type UpdateOperation = z.infer<typeof UpdateOperationSchema>;

// Verification gate decision for Skillbook
export const SkillbookGateDecisionSchema = z.enum(["pass", "fail", "review-required"]);
export type SkillbookGateDecision = z.infer<typeof SkillbookGateDecisionSchema>;

// Reflection outcome after one reflection cycle
export const ReflectionOutcomeSchema = z.object({
  proposedUpdates: z.array(UpdateOperationSchema),
  verified: z.boolean(),
  gateDecision: SkillbookGateDecisionSchema,
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});
export type ReflectionOutcome = z.infer<typeof ReflectionOutcomeSchema>;

// Skillbook stats
export const SkillbookStatsSchema = z.object({
  totalSkills: z.number().int().min(0),
  sections: z.record(z.number().int().min(0)),
  lastUpdatedAt: z.string().datetime().optional(),
  version: z.string().optional(),
});
export type SkillbookStats = z.infer<typeof SkillbookStatsSchema>;

// Checkpoint reference for Skillbook state
export const SkillbookCheckpointRefSchema = z.object({
  skillbookVersion: z.string().optional(),
  pendingUpdates: z.array(UpdateOperationSchema).default([]),
  lastGateDecision: SkillbookGateDecisionSchema.optional(),
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});
export type SkillbookCheckpointRef = z.infer<typeof SkillbookCheckpointRefSchema>;
