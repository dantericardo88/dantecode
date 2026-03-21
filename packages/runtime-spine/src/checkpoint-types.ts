/**
 * checkpoint-types.ts
 *
 * Types for parent/child checkpointing in nested agent sessions.
 */

import { z } from "zod";
import { RuntimeTaskPacketSchema } from "./task-packets.js";
import { SkillbookCheckpointRefSchema } from "./skillbook-types.js";

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
  handoff: z.object({
    fromId: z.string().uuid(),
    toRole: z.string(),
    reason: z.string(),
  }).optional(),
  
  /** Reference to isolated git worktree path, if any. */
  worktreePath: z.string().optional(),
  
  /** ISO-8601 timestamp. */
  timestamp: z.string().datetime().default(() => new Date().toISOString()),

  /** Reference to the Skillbook state at this checkpoint. */
  skillbookRef: SkillbookCheckpointRefSchema.optional(),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;
