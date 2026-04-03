// ============================================================================
// @dantecode/core — Magic Pipeline State
// Checkpoint/resume for multi-step magic pipelines so they survive
// agent-loop termination and can auto-continue across sessions.
// ============================================================================

import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/** Tracks one completed step in the magic pipeline. */
export interface MagicStepResult {
  kind: string;
  status: "ok" | "fail";
  durationMs: number;
  message?: string;
  /** Round at which this step completed (for budget accounting). */
  roundsUsed?: number;
}

/** Persistent state for a magic pipeline execution. */
export interface MagicPipelineState {
  /** Unique pipeline run ID. */
  pipelineId: string;
  /** Magic level (spark | ember | magic | blaze | inferno). */
  level: string;
  /** The user's goal for this pipeline run. */
  goal: string;
  /** Total number of steps in the plan. */
  totalSteps: number;
  /** Index of the step currently executing (0-based). */
  currentStepIndex: number;
  /** Results of completed steps. */
  completedSteps: MagicStepResult[];
  /** Serialized step definitions for the full plan. */
  steps: unknown[];
  /** ISO timestamp when the pipeline started. */
  startedAt: string;
  /** ISO timestamp of the last checkpoint write. */
  lastCheckpointAt: string;
  /** Number of retry attempts on the current step. */
  currentStepRetries: number;
  /** Maximum retries per step before skipping. */
  maxRetriesPerStep: number;
  /** Whether the pipeline completed (all steps done). */
  completed: boolean;
}

/** Default path for magic pipeline state within a project. */
export function getMagicStatePath(projectRoot: string): string {
  return join(projectRoot, ".danteforge", "magic-session.json");
}

/**
 * Save magic pipeline state to disk.
 * Creates .danteforge/ directory if needed.
 */
export async function saveMagicPipelineState(
  projectRoot: string,
  state: MagicPipelineState,
): Promise<void> {
  const filePath = getMagicStatePath(projectRoot);
  await mkdir(dirname(filePath), { recursive: true });
  state.lastCheckpointAt = new Date().toISOString();
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Load magic pipeline state from disk.
 * Returns null if no state file exists.
 */
export async function loadMagicPipelineState(
  projectRoot: string,
): Promise<MagicPipelineState | null> {
  const filePath = getMagicStatePath(projectRoot);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as MagicPipelineState;
  } catch {
    return null;
  }
}

/**
 * Clear magic pipeline state (on completion or explicit reset).
 */
export async function clearMagicPipelineState(projectRoot: string): Promise<void> {
  const filePath = getMagicStatePath(projectRoot);
  try {
    await unlink(filePath);
  } catch {
    // File doesn't exist — that's fine
  }
}

/**
 * Create initial pipeline state for a new magic run.
 */
export function createMagicPipelineState(opts: {
  pipelineId: string;
  level: string;
  goal: string;
  steps: unknown[];
  maxRetriesPerStep?: number;
}): MagicPipelineState {
  return {
    pipelineId: opts.pipelineId,
    level: opts.level,
    goal: opts.goal,
    totalSteps: opts.steps.length,
    currentStepIndex: 0,
    completedSteps: [],
    steps: opts.steps,
    startedAt: new Date().toISOString(),
    lastCheckpointAt: new Date().toISOString(),
    currentStepRetries: 0,
    maxRetriesPerStep: opts.maxRetriesPerStep ?? 2,
    completed: false,
  };
}

/**
 * Advance pipeline state after a step completes successfully.
 */
export function advancePipelineStep(
  state: MagicPipelineState,
  result: MagicStepResult,
): MagicPipelineState {
  const updated = { ...state };
  updated.completedSteps = [...state.completedSteps, result];
  updated.currentStepIndex = state.currentStepIndex + 1;
  updated.currentStepRetries = 0;
  if (updated.currentStepIndex >= updated.totalSteps) {
    updated.completed = true;
  }
  return updated;
}

/**
 * Record a retry attempt on the current step.
 * Returns whether more retries are allowed.
 */
export function recordStepRetry(state: MagicPipelineState): {
  state: MagicPipelineState;
  canRetry: boolean;
} {
  const updated = { ...state };
  updated.currentStepRetries = state.currentStepRetries + 1;
  const canRetry = updated.currentStepRetries < updated.maxRetriesPerStep;
  return { state: updated, canRetry };
}

/**
 * Get the number of remaining steps in the pipeline.
 */
export function remainingSteps(state: MagicPipelineState): number {
  return state.totalSteps - state.currentStepIndex;
}

/**
 * Estimate the number of agent-loop rounds needed for the remaining steps.
 * Used by the dynamic round budget system.
 */
export function estimateRequiredRounds(steps: unknown[]): number {
  let total = 0;
  for (const step of steps) {
    const s = step as { kind: string; maxWaves?: number };
    switch (s.kind) {
      case "oss":
        total += 40; // OSS harvesting is heavy
        break;
      case "autoforge":
        total += (s.maxWaves ?? 8) * 5; // ~5 rounds per wave
        break;
      case "party":
        total += 25; // Multi-lane orchestration
        break;
      case "verify":
      case "synthesize":
      case "retro":
        total += 8;
        break;
      case "lessons-compact":
        total += 3;
        break;
      default:
        total += 5; // review, constitution, specify, clarify, plan, tasks
        break;
    }
  }
  return total;
}

/**
 * Format pipeline progress for display.
 */
export function formatPipelineProgress(state: MagicPipelineState): string {
  const done = state.completedSteps.length;
  const total = state.totalSteps;
  const remaining = total - done;
  const statuses = state.completedSteps
    .map(
      (s) =>
        `  [${s.status === "ok" ? "OK" : "FAIL"}] ${s.kind} (${(s.durationMs / 1000).toFixed(1)}s)`,
    )
    .join("\n");
  return [
    `Pipeline: ${state.level} — ${done}/${total} steps complete, ${remaining} remaining`,
    statuses,
  ]
    .filter(Boolean)
    .join("\n");
}
