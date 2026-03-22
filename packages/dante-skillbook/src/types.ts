/**
 * types.ts
 *
 * Local type aliases and extensions for dante-skillbook.
 * Core types live in @dantecode/runtime-spine/skillbook-types.
 */

export type {
  Skill,
  UpdateOperation,
  SkillbookGateDecision,
  ReflectionOutcome,
  SkillbookStats,
  SkillbookCheckpointRef,
} from "@dantecode/runtime-spine";

export type { Skill as SkillRecord } from "@dantecode/runtime-spine";

/** Task context for skill retrieval ranking. */
export interface TaskContext {
  taskType?: string;
  projectId?: string;
  worktreePath?: string;
  sessionId?: string;
  keywords?: string[];
}

/** Options when loading the skillbook. */
export interface LoadOptions {
  skillbookPath?: string;
}

/** Options for triggering reflection. */
export interface ReflectionOptions {
  mode?: "lite" | "standard";
  sessionId?: string;
  runId?: string;
  taskType?: string;
}

/** A task result passed into the reflection loop. */
export interface TaskResult {
  runId: string;
  taskType: string;
  outcome: "success" | "partial" | "failure";
  summary: string;
  evidence?: string[];
  sessionId?: string;
}
