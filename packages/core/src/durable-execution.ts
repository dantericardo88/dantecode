// ============================================================================
// @dantecode/core — Durable Execution Engine
// Every agent-loop round is checkpointed. If the process crashes or is killed,
// the next run can resume from the last checkpoint rather than starting over.
// ============================================================================

import { mkdir, readFile, unlink, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DurableExecutionCheckpointSchema,
  type DurableExecutionCheckpoint as RuntimeDurableExecutionCheckpoint,
  type DurableExecutionRunConfig,
  type CheckpointWorkspaceContext,
} from "@dantecode/runtime-spine";
import { detectInstallContext } from "./runtime-update.js";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type ExecutionCheckpoint = RuntimeDurableExecutionCheckpoint;

export interface DurableExecutionOptions {
  sessionId: string;
  projectRoot: string;
  /** How many steps between checkpoints. Default: 1 (after every step). */
  checkpointEveryN?: number;
  /** Maximum retries per step. Default: 3. */
  maxRetries?: number;
}

const RUNTIME_FILE_PATH = fileURLToPath(import.meta.url);

// ────────────────────────────────────────────────────────────────────────────
// DurableExecutionEngine
// ────────────────────────────────────────────────────────────────────────────

/**
 * Checkpoint-based durable execution engine.
 *
 * Persists progress to `.dantecode/checkpoints/{sessionId}.json` so that a
 * crashed or killed process can resume from where it left off on the next run.
 */
export class DurableExecutionEngine {
  private readonly sessionId: string;
  private readonly projectRoot: string;
  private readonly checkpointEveryN: number;
  private readonly maxRetries: number;

  constructor(options: DurableExecutionOptions) {
    this.sessionId = options.sessionId;
    this.projectRoot = options.projectRoot;
    this.checkpointEveryN = options.checkpointEveryN ?? 1;
    this.maxRetries = options.maxRetries ?? 3;
  }

  /** Absolute path to the checkpoint file for this session. */
  getCheckpointPath(): string {
    return join(this.projectRoot, ".dantecode", "checkpoints", `${this.sessionId}.json`);
  }

  /**
   * Saves a checkpoint to `.dantecode/checkpoints/{sessionId}.json`.
   */
  async checkpoint(
    stepIndex: number,
    completedSteps: string[],
    partialOutput?: string,
  ): Promise<void> {
    const checkpointPath = this.getCheckpointPath();
    const dir = join(this.projectRoot, ".dantecode", "checkpoints");
    await mkdir(dir, { recursive: true });

    const data = DurableExecutionCheckpointSchema.parse({
      sessionId: this.sessionId,
      stepIndex,
      completedSteps: [...completedSteps],
      partialOutput,
      savedAt: new Date().toISOString(),
      projectRoot: this.projectRoot,
      runConfig: this.getRunConfig(),
      workspaceContext: this.getWorkspaceContext(),
    });

    await writeFile(checkpointPath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Loads the most recent checkpoint for this session.
   * Returns null if no checkpoint exists.
   */
  async loadCheckpoint(): Promise<ExecutionCheckpoint | null> {
    const checkpointPath = this.getCheckpointPath();
    try {
      const raw = await readFile(checkpointPath, "utf-8");
      const parsed = DurableExecutionCheckpointSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Removes the checkpoint file for this session after successful completion.
   */
  async clearCheckpoint(): Promise<void> {
    const checkpointPath = this.getCheckpointPath();
    try {
      await unlink(checkpointPath);
    } catch {
      // Non-fatal: file may not exist
    }
  }

  /**
   * Runs a multi-step execution with checkpoint-every-N-steps behavior.
   *
   * - If a checkpoint exists for this session, resumes from
   *   `completedSteps.length` (skipping already-done steps).
   * - Calls `onStep(index, name)` before each step.
   * - Writes a checkpoint after every `checkpointEveryN` steps.
   * - Always clears the checkpoint on successful completion.
   *
   * Returns an array of results (one per step). Steps resumed from a
   * checkpoint return `undefined` cast to T for already-completed steps.
   */
  async run<T>(
    steps: Array<{ name: string; fn: () => Promise<T> }>,
    onStep?: (index: number, name: string) => void,
  ): Promise<T[]> {
    const existingCheckpoint = await this.loadCheckpoint();
    if (existingCheckpoint?.runConfig && !this.hasCompatibleRunConfig(existingCheckpoint.runConfig)) {
      throw new Error(
        `Checkpoint config mismatch for session "${this.sessionId}". ` +
          `Expected checkpointEveryN=${this.checkpointEveryN}, maxRetries=${this.maxRetries}.`,
      );
    }
    const startIndex = existingCheckpoint ? existingCheckpoint.completedSteps.length : 0;
    const completedSteps: string[] = existingCheckpoint
      ? [...existingCheckpoint.completedSteps]
      : [];

    // Pre-fill results for already-completed steps
    const results: T[] = new Array<T>(startIndex).fill(undefined as unknown as T);

    for (let i = startIndex; i < steps.length; i++) {
      const step = steps[i]!;

      if (onStep) {
        onStep(i, step.name);
      }

      let lastError: unknown;
      let succeeded = false;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const result = await step.fn();
          results.push(result);
          succeeded = true;
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!succeeded) {
        throw lastError;
      }

      completedSteps.push(step.name);

      // Checkpoint after every N steps
      if ((i + 1) % this.checkpointEveryN === 0) {
        await this.checkpoint(i, completedSteps);
      }
    }

    // Clear checkpoint on successful completion
    await this.clearCheckpoint();
    return results;
  }

  private getRunConfig(): DurableExecutionRunConfig {
    return {
      checkpointEveryN: this.checkpointEveryN,
      maxRetries: this.maxRetries,
    };
  }

  private getWorkspaceContext(): CheckpointWorkspaceContext {
    return buildWorkspaceContext(this.projectRoot);
  }

  private hasCompatibleRunConfig(runConfig: DurableExecutionRunConfig): boolean {
    return compareRunConfig(runConfig, this.getRunConfig());
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Convenience helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Lists all checkpoints stored in `.dantecode/checkpoints/` for the given
 * project root. Returns them sorted oldest-first by `savedAt`.
 */
export async function listCheckpoints(projectRoot: string): Promise<ExecutionCheckpoint[]> {
  const dir = join(projectRoot, ".dantecode", "checkpoints");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const checkpoints: ExecutionCheckpoint[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      const parsed = DurableExecutionCheckpointSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        checkpoints.push(parsed.data);
      }
    } catch {
      // Skip corrupted files
    }
  }

  return checkpoints.sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime());
}

/**
 * Removes all checkpoint files in `.dantecode/checkpoints/` for the given
 * project root.
 */
export async function clearAllCheckpoints(projectRoot: string): Promise<void> {
  const dir = join(projectRoot, ".dantecode", "checkpoints");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return;
  }

  await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map((f) => unlink(join(dir, f)).catch(() => undefined)),
  );
}

function buildWorkspaceContext(projectRoot: string): CheckpointWorkspaceContext {
  const installContext = detectInstallContext({
    runtimePath: RUNTIME_FILE_PATH,
    cwd: projectRoot,
    workspaceRoot: projectRoot,
  });

  return {
    projectRoot,
    workspaceRoot: projectRoot,
    repoRoot: installContext.repoRoot,
    workspaceIsRepoRoot: installContext.workspaceIsRepoRoot,
    installContextKind: installContext.kind,
  };
}

function compareRunConfig(
  expected: DurableExecutionRunConfig,
  actual: DurableExecutionRunConfig,
): boolean {
  return (
    expected.checkpointEveryN === actual.checkpointEveryN && expected.maxRetries === actual.maxRetries
  );
}
