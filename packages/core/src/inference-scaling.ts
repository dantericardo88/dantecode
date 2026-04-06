// ============================================================================
// @dantecode/core — Inference-Time Scaling
// Run N solution variants in parallel worktrees, score each with PDSE,
// return the best one.
// Based on OpenHands' approach of running multiple solution attempts.
// ============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { ModelRouterImpl } from "./model-router.js";
import type { CoreMessage } from "ai";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface ScalingConfig {
  /** Number of variants to try (2-4 recommended, capped at 8). */
  n: number;
  prompt: string;
  projectRoot: string;
  sessionId: string;
  /**
   * Optional custom scoring function.
   * Receives the worktree path and list of modified files, returns 0-100.
   * If not provided, uses the built-in PDSE heuristic scorer.
   */
  scoringFn?: (worktreePath: string, modifiedFiles: string[]) => Promise<number>;
}

export interface ScaledResult {
  variantIndex: number;
  worktreePath: string;
  pdseScore: number;
  modifiedFiles: string[];
  durationMs: number;
  status: "success" | "error";
  errorMessage?: string;
}

// ─── PDSE Scoring (shared logic) ─────────────────────────────────────────────

/**
 * Score a worktree using the DanteForge PDSE scorer when available,
 * falling back to a lightweight heuristic otherwise.
 */
async function scoreWorktree(
  worktreePath: string,
  modifiedFiles: string[],
  scoringFn?: (p: string, f: string[]) => Promise<number>,
): Promise<number> {
  if (scoringFn) {
    try {
      return await scoringFn(worktreePath, modifiedFiles);
    } catch {
      return 0;
    }
  }

  if (modifiedFiles.length === 0) return 0;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forge = await import("@dantecode/danteforge" as any).catch(() => null);
    if (!forge?.runLocalPDSEScorer) return scoreHeuristic(worktreePath, modifiedFiles);

    const scores: number[] = [];
    for (const relPath of modifiedFiles.slice(0, 10)) {
      const absPath = join(worktreePath, relPath);
      if (!existsSync(absPath)) continue;
      try {
        const code = readFileSync(absPath, "utf-8");
        const result = forge.runLocalPDSEScorer(code, worktreePath);
        if (typeof result?.overall === "number") scores.push(result.overall);
      } catch {
        // skip
      }
    }
    return scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : scoreHeuristic(worktreePath, modifiedFiles);
  } catch {
    return scoreHeuristic(worktreePath, modifiedFiles);
  }
}

function scoreHeuristic(worktreePath: string, modifiedFiles: string[]): number {
  let totalBytes = 0;
  let readable = 0;
  for (const relPath of modifiedFiles.slice(0, 10)) {
    try {
      const content = readFileSync(join(worktreePath, relPath));
      totalBytes += content.length;
      readable++;
    } catch {
      // ignore
    }
  }
  if (readable === 0) return 0;
  const base = Math.min(55 + readable * 4, 70);
  const byteBonus = Math.min(Math.floor(totalBytes / 600), 20);
  return Math.min(base + byteBonus, 90);
}

// ─── Worktree Utilities ───────────────────────────────────────────────────────

function createWorktree(projectRoot: string, worktreePath: string): void {
  execFileSync("git", ["worktree", "add", "--detach", worktreePath, "HEAD"], {
    cwd: projectRoot,
    stdio: "pipe",
  });
}

function removeWorktree(projectRoot: string, worktreePath: string): void {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: projectRoot, stdio: "pipe" });
    } catch {
      // ignore
    }
  }
}

function listModifiedFiles(worktreePath: string): string[] {
  try {
    const output = execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf-8",
    });
    const tracked = output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (tracked.length > 0) return tracked;
  } catch {
    // fall through to status
  }
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf-8",
    });
    return output
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ─── Variant Runner ───────────────────────────────────────────────────────────

const SCALING_TIMEOUT_MS = 4 * 60 * 1000; // 4 min per variant

async function runVariant(
  router: ModelRouterImpl,
  prompt: string,
  variantIndex: number,
  worktreePath: string,
): Promise<{ status: "success" | "error"; errorMessage?: string }> {
  const messages: CoreMessage[] = [
    {
      role: "user",
      content: `You are working inside the directory: ${worktreePath}\n\n${prompt}`,
    },
  ];

  const timeout = new Promise<{ status: "error"; errorMessage: string }>((resolve) =>
    setTimeout(
      () =>
        resolve({
          status: "error",
          errorMessage: `Variant ${variantIndex} timed out after ${SCALING_TIMEOUT_MS / 1000}s`,
        }),
      SCALING_TIMEOUT_MS,
    ),
  );

  const run = (async () => {
    try {
      await router.generate(messages, {
        system: `You are a coding assistant (variant ${variantIndex + 1}). Work within ${worktreePath}. Implement the requested changes, then stop.`,
        taskMode: "inference-scaling",
      });
      return { status: "success" as const };
    } catch (err) {
      return {
        status: "error" as const,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  })();

  return Promise.race([run, timeout]);
}

// ─── Parallelism Helpers ──────────────────────────────────────────────────────

/**
 * Run an array of async thunks with limited concurrency.
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      results[idx] = await tasks[idx]!();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Run N variants of the prompt in parallel worktrees, score each, apply the
 * best result back to the main project directory, and clean up.
 */
export async function runInferenceScaling(
  config: ScalingConfig,
  modelRouter: ModelRouterImpl,
): Promise<{
  bestVariant: ScaledResult;
  allVariants: ScaledResult[];
  appliedToMain: boolean;
}> {
  const { n, prompt, projectRoot, sessionId, scoringFn } = config;
  const count = Math.max(2, Math.min(n, 8)); // clamp 2-8

  const scalingBase = join(projectRoot, ".dantecode", "scaling", sessionId);
  await mkdir(scalingBase, { recursive: true });

  // 1. Create all worktrees
  const worktreePaths: string[] = [];
  for (let i = 0; i < count; i++) {
    const wtPath = join(scalingBase, `variant-${i}`);
    try {
      createWorktree(projectRoot, wtPath);
      worktreePaths.push(wtPath);
    } catch {
      // If worktree creation fails, record an empty path placeholder
      worktreePaths.push("");
    }
  }

  // 2. Run variants concurrently (max 3 at a time to avoid API rate limits)
  const tasks = worktreePaths.map((worktreePath, idx) => async (): Promise<ScaledResult> => {
    if (!worktreePath) {
      return {
        variantIndex: idx,
        worktreePath: "",
        pdseScore: 0,
        modifiedFiles: [],
        durationMs: 0,
        status: "error",
        errorMessage: "Worktree creation failed",
      };
    }

    const startMs = Date.now();
    const runResult = await runVariant(modelRouter, prompt, idx, worktreePath);
    const durationMs = Date.now() - startMs;
    const modifiedFiles = listModifiedFiles(worktreePath);
    const pdseScore =
      runResult.status === "success" ? await scoreWorktree(worktreePath, modifiedFiles, scoringFn) : 0;

    return {
      variantIndex: idx,
      worktreePath,
      pdseScore,
      modifiedFiles,
      durationMs,
      status: runResult.status,
      errorMessage: runResult.errorMessage,
    };
  });

  const allVariants = await runWithConcurrency(tasks, 3);

  // 3. Pick the best variant (highest PDSE score among successful runs)
  const successful = allVariants.filter((v) => v.status === "success");
  const bestVariantOrUndef: ScaledResult | undefined =
    successful.length > 0
      ? successful.reduce((best, cur) => (cur.pdseScore > best.pdseScore ? cur : best))
      : allVariants[0];

  // Synthesize a sentinel if every variant slot failed to even produce a record
  const bestVariant: ScaledResult = bestVariantOrUndef ?? {
    variantIndex: 0,
    worktreePath: "",
    pdseScore: 0,
    modifiedFiles: [],
    durationMs: 0,
    status: "error",
    errorMessage: "All variants failed to produce results",
  };

  // 4. Apply best result to main working directory
  let appliedToMain = false;
  if (bestVariant.worktreePath && bestVariant.status === "success") {
    try {
      const { applyVariantToMain } = await import("./arena-mode.js");
      await applyVariantToMain(bestVariant.worktreePath, projectRoot);
      appliedToMain = true;
    } catch {
      appliedToMain = false;
    }
  }

  // 5. Clean up all worktrees
  for (const wtPath of worktreePaths) {
    if (wtPath) removeWorktree(projectRoot, wtPath);
  }
  try {
    await rm(scalingBase, { recursive: true, force: true });
  } catch {
    // ignore
  }

  return { bestVariant, allVariants, appliedToMain };
}

/**
 * Transfer changes from a variant worktree to the main project directory
 * using `git diff` + `git apply`.
 *
 * Re-exported here for direct use; the implementation lives in arena-mode.ts
 * to avoid duplication.
 */
export async function applyVariantToMain(
  variantWorktreePath: string,
  projectRoot: string,
): Promise<{ appliedFiles: string[] }> {
  const { applyVariantToMain: _apply } = await import("./arena-mode.js");
  return _apply(variantWorktreePath, projectRoot);
}
