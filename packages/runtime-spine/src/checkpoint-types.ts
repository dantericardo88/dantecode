/**
 * checkpoint-types.ts
 *
 * Types for parent/child checkpointing in nested agent sessions.
 */

import { z } from "zod";
import { RuntimeTaskPacketSchema } from "./task-packets.js";
import { SkillbookCheckpointRefSchema } from "./skillbook-types.js";
import { SandboxAuditRefSchema } from "./sandbox-types.js";
import { FearSetColumnNameSchema, FearSetRobustnessScoreSchema } from "./fearset-types.js";

// ─── FearSet trace ref ────────────────────────────────────────────────────────

/**
 * Lightweight FearSet trace embedded in each Checkpoint.
 * Links to the full FearSetResult without duplicating the data.
 */
export const FearSetCheckpointRefSchema = z.object({
  /** ID of the FearSetResult this checkpoint window participates in. */
  fearSetResultId: z.string().uuid().optional(),
  /** Current column being processed when checkpoint was taken. */
  currentColumn: FearSetColumnNameSchema.optional(),
  /** Columns completed so far. */
  completedColumns: z.array(FearSetColumnNameSchema).default([]),
  /** Whether sandbox simulation has run for at least one action. */
  hasSimulationEvidence: z.boolean().default(false),
  /** Partial or final robustness score if available. */
  robustnessScore: FearSetRobustnessScoreSchema.optional(),
  /** Whether the full run passed the DanteForge gate. */
  gatePassed: z.boolean().optional(),
  /** ISO-8601 timestamp. */
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});
export type FearSetCheckpointRef = z.infer<typeof FearSetCheckpointRefSchema>;

export const CheckpointReplaySummarySchema = z.object({
  eventCount: z.number().int().min(0),
  pendingWriteCount: z.number().int().min(0),
  digest: z.string().min(16),
  lastEventIndex: z.number().int().min(0).optional(),
});
export type CheckpointReplaySummary = z.infer<typeof CheckpointReplaySummarySchema>;

export const CheckpointWorkspaceContextSchema = z.object({
  projectRoot: z.string(),
  workspaceRoot: z.string(),
  repoRoot: z.string().optional(),
  workspaceIsRepoRoot: z.boolean(),
  installContextKind: z.enum([
    "repo_checkout",
    "npm_global_cli",
    "npm_local_dependency",
    "npx_ephemeral",
    "vscode_extension_host",
  ]),
  worktreePath: z.string().optional(),
});
export type CheckpointWorkspaceContext = z.infer<typeof CheckpointWorkspaceContextSchema>;

export const DurableExecutionRunConfigSchema = z.object({
  checkpointEveryN: z.number().int().min(1),
  maxRetries: z.number().int().min(0),
});
export type DurableExecutionRunConfig = z.infer<typeof DurableExecutionRunConfigSchema>;

export const DurableExecutionCheckpointSchema = z.object({
  sessionId: z.string().min(1),
  stepIndex: z.number().int().min(0),
  totalSteps: z.number().int().min(0).optional(),
  completedSteps: z.array(z.string()).default([]),
  partialOutput: z.string().optional(),
  savedAt: z.string().datetime(),
  projectRoot: z.string(),
  runConfig: DurableExecutionRunConfigSchema.optional(),
  workspaceContext: CheckpointWorkspaceContextSchema.optional(),
});
export type DurableExecutionCheckpoint = z.infer<typeof DurableExecutionCheckpointSchema>;

export const CheckpointSchema = z.object({
  /** Unique ID for the checkpoint. */
  id: z.string().uuid(),

  /** The full task packet associated with this checkpoint. */
  task: RuntimeTaskPacketSchema,

  /** Parent task ID for hierarchy. */
  parentId: z.string().uuid().optional(),

  /** Progress markers (e.g., "completed 3 of 5 steps"). */
  progress: z.string(),

  /** Current retry count for this task. */
  retries: z.number().int().min(0).default(0),

  /** State snapshot of the task (task-specific). */
  state: z.record(z.unknown()).default({}),

  /** Output artifacts produced so far. */
  artifacts: z.array(z.string()).default([]),

  /** Handoff metadata if this checkpoint was part of an agent transfer. */
  handoff: z
    .object({
      fromId: z.string().uuid(),
      toRole: z.string(),
      reason: z.string(),
    })
    .optional(),

  /** Reference to isolated git worktree path, if any. */
  worktreePath: z.string().optional(),

  /** ISO-8601 timestamp. */
  timestamp: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),

  /** Reference to the Skillbook state at this checkpoint. */
  skillbookRef: SkillbookCheckpointRefSchema.optional(),

  /** Sandbox audit trail summary for this checkpoint window. */
  sandboxAuditRef: SandboxAuditRefSchema.optional(),

  /** FearSet trace for this checkpoint window. */
  fearSetRef: FearSetCheckpointRefSchema.optional(),

  /** Deterministic replay summary for the persisted checkpoint state. */
  replaySummary: CheckpointReplaySummarySchema.optional(),

  /** Explicit workspace/install boundary captured at checkpoint time. */
  workspaceContext: CheckpointWorkspaceContextSchema.optional(),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;
