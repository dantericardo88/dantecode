/**
 * task-packets.ts
 *
 * Unified task packet structure for Research and Orchestration.
 */

import { z } from "zod";

export const RuntimeTaskPacketSchema = z.object({
  /** Unique identifier for the task. */
  id: z.string().uuid(),
  
  /** The kind of task being executed. */
  kind: z.enum(["research", "fetch-extract", "subagent-task", "synthesis"]),
  
  /** Parent task ID if this is a sub-task. */
  parentId: z.string().uuid().optional(),
  
  /** Human-readable objective or goal. */
  objective: z.string(),
  
  /** Arbitrary context data for the task. */
  context: z.record(z.unknown()).default({}),
  
  /** Assigned role or specialist type (e.g., "researcher", "frontend-dev"). */
  role: z.string().optional(),
  
  /** Execution constraints. */
  constraints: z.object({
    maxDepth: z.number().int().min(0).optional(),
    maxParallel: z.number().int().min(1).optional(),
    timeoutMs: z.number().int().min(1000).optional(),
    budgetTokens: z.number().int().min(0).optional(),
  }).optional(),
  
  /** Input parameters specific to the task kind. */
  inputs: z.object({
    query: z.string().optional(),
    url: z.string().url().optional(),
    schema: z.record(z.unknown()).optional(),
    instructions: z.string().optional(),
  }).optional(),
  
  /** ISO-8601 timestamp of creation. */
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type RuntimeTaskPacket = z.infer<typeof RuntimeTaskPacketSchema>;
