/**
 * runtime-events.ts
 *
 * Fixed event vocabulary for the DanteCode Research and Orchestration machines.
 */

import { z } from "zod";

export const RuntimeEventKindSchema = z.enum([
  "research.search.started",
  "research.search.completed",
  "research.fetch.started",
  "research.fetch.completed",
  "research.extract.completed",
  "research.cache.hit",
  "subagent.spawned",
  "subagent.progress",
  "subagent.handoff",
  "subagent.timeout",
  "subagent.terminated",
  "runtime.synthesis.completed",
  "runtime.verification.passed",
  "runtime.verification.failed",
  "runtime.apply.started",
  "runtime.apply.completed",
  "runtime.apply.receipt.emit",
  "skillbook.update.proposed",
  "skillbook.update.accepted",
  "skillbook.update.rejected",
  "skillbook.update.review-required",
  "skillbook.reflection.started",
  "skillbook.reflection.completed",
  "skillbook.loaded",
  "skillbook.saved",
  "gaslight.session.started",
  "gaslight.session.completed",
  "gaslight.critique.completed",
  "gaslight.iteration.gated",
  "gaslight.lesson.written",
  "gaslight.stopped",
  "sandbox.execution.requested",
  "sandbox.execution.allowed",
  "sandbox.execution.blocked",
  "sandbox.execution.completed",
  "sandbox.danteforge.gate.passed",
  "sandbox.danteforge.gate.failed",
  "sandbox.violation",
  "fearset.triggered",
  "fearset.column.started",
  "fearset.column.completed",
  "fearset.danteforge.passed",
  "fearset.danteforge.failed",
  "fearset.sandbox.simulated",
  "fearset.lesson.distilled",
  "fearset.stopped",
  // Permission engine events
  "runtime.permission.evaluated",
  // Run intake events
  "run.intake.created",
  // Boundary drift events
  "run.boundary.drift",
  // Plan mode events
  "plan.generated",
  "plan.approved",
  "plan.rejected",
  "plan.step.started",
  "plan.step.completed",
  "plan.step.failed",
  "plan.execution.completed",
  // Wave 2: Run lifecycle events
  "run.task.classified",
  "run.mode.selected",
  "run.mode.changed",
  // Wave 2: Permission events
  "run.permission.denied",
  // Wave 2: Context & Skills events
  "run.context.assembled",
  "run.skill.loaded",
  "run.skill.executed",
  // Wave 2: Planning events
  "run.plan.created",
  "run.decomposition.started",
  "run.decomposition.completed",
  // Wave 2: Tool lifecycle events
  "run.tool.started",
  "run.tool.completed",
  "run.tool.failed",
  // Wave 2: Checkpointing events
  "run.checkpoint.saved",
  "run.checkpoint.restored",
  // Wave 2: Repair loop events
  "run.repair.lint.started",
  "run.repair.lint.completed",
  "run.repair.test.started",
  "run.repair.test.completed",
  "repair.final_gate.started",
  "repair.final_gate.completed",
  // Wave 2: Reporting events
  "run.report.written",
  // Wave 2: Worktree events
  "run.worktree.created",
  "run.worktree.merged",
  "run.worktree.cleaned",
]);

export type RuntimeEventKind = z.infer<typeof RuntimeEventKindSchema>;

export const RuntimeEventSchema = z.object({
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
  kind: RuntimeEventKindSchema,
  taskId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).default({}),
});

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
export type RuntimeEventInput = z.input<typeof RuntimeEventSchema>;

export function buildRuntimeEvent(event: RuntimeEventInput): RuntimeEvent {
  return RuntimeEventSchema.parse(event);
}

// ============================================================================
// Wave 2: Payload Type Definitions
// ============================================================================

// Run lifecycle payloads
export const RunTaskClassifiedPayloadSchema = z.object({
  taskClass: z.enum(["code", "research", "plan", "verify", "repair", "other"]),
  confidence: z.number().min(0).max(1),
});
export type RunTaskClassifiedPayload = z.infer<typeof RunTaskClassifiedPayloadSchema>;

export const RunModeSelectedPayloadSchema = z.object({
  mode: z.enum(["autonomous", "interactive", "council", "party", "plan"]),
  reason: z.string().optional(),
});
export type RunModeSelectedPayload = z.infer<typeof RunModeSelectedPayloadSchema>;

export const RunModeChangedPayloadSchema = z.object({
  fromMode: z.enum(["autonomous", "interactive", "council", "party", "plan"]),
  toMode: z.enum(["autonomous", "interactive", "council", "party", "plan"]),
  reason: z.string(),
});
export type RunModeChangedPayload = z.infer<typeof RunModeChangedPayloadSchema>;

// Permission payloads
export const RunPermissionDeniedPayloadSchema = z.object({
  resource: z.string(),
  action: z.string(),
  reason: z.string(),
  boundary: z.string().optional(),
});
export type RunPermissionDeniedPayload = z.infer<typeof RunPermissionDeniedPayloadSchema>;

// Context & Skills payloads
export const RunContextAssembledPayloadSchema = z.object({
  contextSize: z.number(),
  skillsLoaded: z.number(),
  tokensEstimated: z.number(),
});
export type RunContextAssembledPayload = z.infer<typeof RunContextAssembledPayloadSchema>;

export const RunSkillLoadedPayloadSchema = z.object({
  skillId: z.string(),
  skillName: z.string(),
  source: z.enum(["local", "remote", "bridge", "builtin"]),
});
export type RunSkillLoadedPayload = z.infer<typeof RunSkillLoadedPayloadSchema>;

export const RunSkillExecutedPayloadSchema = z.object({
  skillId: z.string(),
  skillName: z.string(),
  durationMs: z.number(),
  success: z.boolean(),
  error: z.string().optional(),
});
export type RunSkillExecutedPayload = z.infer<typeof RunSkillExecutedPayloadSchema>;

// Planning payloads
export const RunPlanCreatedPayloadSchema = z.object({
  planId: z.string(),
  stepCount: z.number(),
  complexity: z.enum(["simple", "moderate", "complex", "epic"]),
});
export type RunPlanCreatedPayload = z.infer<typeof RunPlanCreatedPayloadSchema>;

export const RunDecompositionStartedPayloadSchema = z.object({
  taskDescription: z.string(),
  targetSteps: z.number().optional(),
});
export type RunDecompositionStartedPayload = z.infer<typeof RunDecompositionStartedPayloadSchema>;

export const RunDecompositionCompletedPayloadSchema = z.object({
  stepCount: z.number(),
  durationMs: z.number(),
  success: z.boolean(),
});
export type RunDecompositionCompletedPayload = z.infer<
  typeof RunDecompositionCompletedPayloadSchema
>;

// Tool lifecycle payloads
export const RunToolStartedPayloadSchema = z.object({
  toolName: z.string(),
  toolId: z.string().optional(),
  params: z.record(z.unknown()).optional(),
});
export type RunToolStartedPayload = z.infer<typeof RunToolStartedPayloadSchema>;

export const RunToolCompletedPayloadSchema = z.object({
  toolName: z.string(),
  toolId: z.string().optional(),
  durationMs: z.number(),
  outputSize: z.number().optional(),
});
export type RunToolCompletedPayload = z.infer<typeof RunToolCompletedPayloadSchema>;

export const RunToolFailedPayloadSchema = z.object({
  toolName: z.string(),
  toolId: z.string().optional(),
  error: z.string(),
  durationMs: z.number(),
  retryable: z.boolean().optional(),
});
export type RunToolFailedPayload = z.infer<typeof RunToolFailedPayloadSchema>;

// Checkpointing payloads
export const RunCheckpointSavedPayloadSchema = z.object({
  checkpointId: z.string(),
  version: z.number(),
  eventId: z.number(),
  sizeBytes: z.number().optional(),
});
export type RunCheckpointSavedPayload = z.infer<typeof RunCheckpointSavedPayloadSchema>;

export const RunCheckpointRestoredPayloadSchema = z.object({
  checkpointId: z.string(),
  version: z.number(),
  eventId: z.number(),
  replayEventsCount: z.number(),
});
export type RunCheckpointRestoredPayload = z.infer<typeof RunCheckpointRestoredPayloadSchema>;

// Repair loop payloads
export const RunRepairLintStartedPayloadSchema = z.object({
  filesCount: z.number(),
  linter: z.string(),
});
export type RunRepairLintStartedPayload = z.infer<typeof RunRepairLintStartedPayloadSchema>;

export const RunRepairLintCompletedPayloadSchema = z.object({
  filesCount: z.number(),
  errorsFound: z.number(),
  errorsFixed: z.number(),
  durationMs: z.number(),
});
export type RunRepairLintCompletedPayload = z.infer<typeof RunRepairLintCompletedPayloadSchema>;

export const RunRepairTestStartedPayloadSchema = z.object({
  testCount: z.number(),
  testRunner: z.string(),
});
export type RunRepairTestStartedPayload = z.infer<typeof RunRepairTestStartedPayloadSchema>;

export const RunRepairTestCompletedPayloadSchema = z.object({
  testCount: z.number(),
  passed: z.number(),
  failed: z.number(),
  durationMs: z.number(),
});
export type RunRepairTestCompletedPayload = z.infer<typeof RunRepairTestCompletedPayloadSchema>;

// Reporting payloads
export const RunReportWrittenPayloadSchema = z.object({
  reportPath: z.string(),
  reportType: z.enum(["run", "session", "verification", "checkpoint", "other"]),
  sizeBytes: z.number().optional(),
});
export type RunReportWrittenPayload = z.infer<typeof RunReportWrittenPayloadSchema>;

// Worktree payloads
export const RunWorktreeCreatedPayloadSchema = z.object({
  worktreePath: z.string(),
  worktreeBranch: z.string(),
  laneId: z.string().optional(),
});
export type RunWorktreeCreatedPayload = z.infer<typeof RunWorktreeCreatedPayloadSchema>;

export const RunWorktreeMergedPayloadSchema = z.object({
  worktreeBranch: z.string(),
  targetBranch: z.string(),
  commitSha: z.string(),
  laneId: z.string().optional(),
});
export type RunWorktreeMergedPayload = z.infer<typeof RunWorktreeMergedPayloadSchema>;

export const RunWorktreeCleanedPayloadSchema = z.object({
  worktreePath: z.string(),
  worktreeBranch: z.string(),
  preserved: z.boolean(),
  reason: z.string().optional(),
});
export type RunWorktreeCleanedPayload = z.infer<typeof RunWorktreeCleanedPayloadSchema>;
