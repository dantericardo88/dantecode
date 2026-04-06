// ============================================================================
// @dantecode/core — Arena Mode
// Runs the same prompt against multiple models in isolated git worktrees,
// scores each result with PDSE, and lets the user choose the winner.
// Based on QwenCode's arena.md pattern.
// ============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { ModelRouterImpl } from "./model-router.js";
import type { CoreMessage } from "ai";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface ArenaModel {
  modelId: string;
  provider: "anthropic" | "grok" | "openai" | "google" | "groq" | "ollama" | "custom";
  apiKey?: string;
  label?: string;
}

export interface ArenaRunConfig {
  prompt: string;
  models: ArenaModel[]; // 2-4 models max
  projectRoot: string;
  sessionId: string;
  maxRoundsPerModel?: number; // default 10
}

export interface ArenaResult {
  modelId: string;
  provider: string;
  label: string;
  filesModified: string[];
  pdseScore?: number;
  durationMs: number;
  tokenCount?: number;
  toolCallCount: number;
  status: "success" | "error" | "timeout";
  errorMessage?: string;
  worktreePath: string;
}

export interface ArenaSession {
  sessionId: string;
  prompt: string;
  results: ArenaResult[];
  winnerId?: string;
  startedAt: string;
  completedAt?: string;
}

// ─── PDSE Scoring ────────────────────────────────────────────────────────────

/**
 * Lightweight PDSE proxy scorer for arena results.
 * Reads modified files from the worktree and scores aggregate content quality.
 * Returns 0-100; 0 on error.
 */
async function runLocalPDSEOnWorktree(
  worktreePath: string,
  modifiedFiles: string[],
): Promise<number> {
  if (modifiedFiles.length === 0) return 0;

  try {
    // Attempt to import runLocalPDSEScorer from danteforge (optional peer dep)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forge = await import("@dantecode/danteforge" as any).catch(() => null);
    if (!forge?.runLocalPDSEScorer) return estimatePDSEHeuristic(worktreePath, modifiedFiles);

    const scores: number[] = [];
    for (const relPath of modifiedFiles.slice(0, 10)) {
      const absPath = join(worktreePath, relPath);
      if (!existsSync(absPath)) continue;
      try {
        const code = readFileSync(absPath, "utf-8");
        const result = forge.runLocalPDSEScorer(code, worktreePath);
        if (typeof result?.overall === "number") scores.push(result.overall);
      } catch {
        // skip unreadable files
      }
    }
    if (scores.length === 0) return estimatePDSEHeuristic(worktreePath, modifiedFiles);
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  } catch {
    return estimatePDSEHeuristic(worktreePath, modifiedFiles);
  }
}

/**
 * Heuristic PDSE estimate when DanteForge is unavailable.
 * Scans for stub violations instead of using file-size heuristic.
 */
function estimatePDSEHeuristic(worktreePath: string, modifiedFiles: string[]): number {
  // Improved: scan for stub violations instead of file-size heuristic
  let stubViolations = 0;
  let readableCount = 0;
  const stubPatterns = [
    /\bTODO\b/i,
    /\bFIXME\b/i,
    /throw new Error\(['"]not implemented/i,
    /\bas\s+any\b/,
  ];
  for (const relPath of modifiedFiles.slice(0, 10)) {
    const absPath = join(worktreePath, relPath);
    try {
      const content = readFileSync(absPath, "utf-8");
      readableCount++;
      for (const pat of stubPatterns) {
        if (pat.test(content)) stubViolations++;
      }
    } catch {
      // ignore unreadable files
    }
  }
  if (readableCount === 0) return 0;
  // Base 70 — deduct 10 per stub violation, minimum 30
  return Math.max(30, 70 - stubViolations * 10);
}

// ─── Worktree Helpers ─────────────────────────────────────────────────────────

/**
 * Create a git worktree for the given path. The worktree is checked out at HEAD.
 * Throws if git command fails.
 */
function createWorktree(projectRoot: string, worktreePath: string): void {
  execFileSync("git", ["worktree", "add", "--detach", worktreePath, "HEAD"], {
    cwd: projectRoot,
    stdio: "pipe",
  });
}

/**
 * Remove a git worktree by path.
 */
function removeWorktree(projectRoot: string, worktreePath: string): void {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    // Fallback: prune + manual removal
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: projectRoot, stdio: "pipe" });
    } catch {
      // ignore
    }
  }
}

/**
 * List files modified in the worktree relative to the base commit (HEAD of projectRoot).
 */
function listWorktreeModifiedFiles(worktreePath: string): string[] {
  try {
    const output = execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf-8",
    });
    return output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    // Worktree may not have committed changes; check status instead
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
}

// ─── Model Execution in Worktree ──────────────────────────────────────────────

interface WorktreeRunResult {
  tokenCount: number;
  toolCallCount: number;
  status: "success" | "error" | "timeout";
  errorMessage?: string;
}

const ARENA_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per model

/**
 * Run the prompt against a single model in the given worktree directory.
 * Uses the ModelRouterImpl to stream the prompt; counts tokens and tool-call
 * markers in the response text.
 */
async function runModelInWorktree(
  router: ModelRouterImpl,
  prompt: string,
  worktreePath: string,
  modelLabel: string,
  onProgress?: (modelId: string, status: string, roundNum?: number) => void,
): Promise<WorktreeRunResult> {
  const messages: CoreMessage[] = [
    {
      role: "user",
      content: `You are working inside the directory: ${worktreePath}\n\n${prompt}`,
    },
  ];

  const timeoutPromise = new Promise<WorktreeRunResult>((resolve) =>
    setTimeout(
      () =>
        resolve({
          tokenCount: 0,
          toolCallCount: 0,
          status: "timeout",
          errorMessage: `Model timed out after ${ARENA_TIMEOUT_MS / 1000}s`,
        }),
      ARENA_TIMEOUT_MS,
    ),
  );

  const runPromise = (async (): Promise<WorktreeRunResult> => {
    try {
      onProgress?.(modelLabel, "running", 1);
      const response = await router.generate(messages, {
        system: `You are a coding assistant. Work within ${worktreePath}. Implement the requested changes carefully.`,
        taskMode: "arena",
      });

      // Count rough token usage via word count proxy
      const wordCount = response.split(/\s+/).length;
      const tokenCount = Math.ceil(wordCount * 1.3); // ~1.3 tokens per word

      // Heuristic: count structured tool-call patterns in the response
      const toolCallMatches = response.match(/<tool_call|<function_calls|"tool_name"\s*:/g);
      const toolCallCount = toolCallMatches?.length ?? 0;

      onProgress?.(modelLabel, "complete");
      return { tokenCount, toolCallCount, status: "success" };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      onProgress?.(modelLabel, "error");
      return { tokenCount: 0, toolCallCount: 0, status: "error", errorMessage };
    }
  })();

  return Promise.race([runPromise, timeoutPromise]);
}

// ─── Arena Runner ─────────────────────────────────────────────────────────────

export class ArenaRunner {
  constructor(private readonly config: ArenaRunConfig) {}

  /**
   * Run the same prompt against all configured models in parallel worktrees.
   * Each model gets its own isolated git worktree.
   * Returns results sorted by PDSE score descending.
   */
  async run(
    onProgress?: (modelId: string, status: string, roundNum?: number) => void,
  ): Promise<ArenaSession> {
    const { prompt, models, projectRoot, sessionId } = this.config;
    const clampedModels = models.slice(0, 4); // max 4 models

    const startedAt = new Date().toISOString();
    const arenaBase = join(projectRoot, ".dantecode", "arena", sessionId);
    await mkdir(arenaBase, { recursive: true });

    // Create worktrees for all models upfront
    const worktreePaths: Map<string, string> = new Map();
    for (const model of clampedModels) {
      const slug = model.modelId.replace(/[^a-zA-Z0-9-]/g, "-");
      const wtPath = join(arenaBase, slug);
      try {
        createWorktree(projectRoot, wtPath);
        worktreePaths.set(model.modelId, wtPath);
        onProgress?.(model.modelId, "worktree-ready");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onProgress?.(model.modelId, `worktree-error: ${msg}`);
      }
    }

    // Run all models in parallel
    const runPromises = clampedModels.map(async (model): Promise<ArenaResult> => {
      const worktreePath = worktreePaths.get(model.modelId);
      const label = model.label ?? model.modelId;

      if (!worktreePath) {
        return {
          modelId: model.modelId,
          provider: model.provider,
          label,
          filesModified: [],
          durationMs: 0,
          toolCallCount: 0,
          status: "error",
          errorMessage: "Worktree creation failed",
          worktreePath: "",
        };
      }

      const startMs = Date.now();

      // Build a per-model router config using the model's own credentials
      const routerConfig = buildArenaRouterConfig(model);

      let runResult: WorktreeRunResult;
      try {
        // Dynamically import to avoid circular deps
        const { ModelRouterImpl } = await import("./model-router.js");
        const router = new ModelRouterImpl(routerConfig, worktreePath, randomUUID());
        runResult = await runModelInWorktree(
          router,
          prompt,
          worktreePath,
          model.modelId,
          onProgress,
        );
      } catch (err) {
        runResult = {
          tokenCount: 0,
          toolCallCount: 0,
          status: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }

      const durationMs = Date.now() - startMs;
      const filesModified = listWorktreeModifiedFiles(worktreePath);
      const pdseScore =
        runResult.status === "success"
          ? await runLocalPDSEOnWorktree(worktreePath, filesModified)
          : 0;

      return {
        modelId: model.modelId,
        provider: model.provider,
        label,
        filesModified,
        pdseScore,
        durationMs,
        tokenCount: runResult.tokenCount,
        toolCallCount: runResult.toolCallCount,
        status: runResult.status,
        errorMessage: runResult.errorMessage,
        worktreePath,
      };
    });

    const results = await Promise.all(runPromises);

    // Sort by PDSE score descending; errors last
    results.sort((a, b) => {
      if (a.status !== "success" && b.status === "success") return 1;
      if (a.status === "success" && b.status !== "success") return -1;
      return (b.pdseScore ?? 0) - (a.pdseScore ?? 0);
    });

    return {
      sessionId,
      prompt,
      results,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Apply the winner's worktree changes back to the main working directory.
   * Cleans up all other worktrees.
   */
  async applyWinner(session: ArenaSession, winnerId: string): Promise<void> {
    const { projectRoot } = this.config;
    const winner = session.results.find((r) => r.modelId === winnerId);
    if (!winner || !winner.worktreePath || winner.status !== "success") {
      throw new Error(`Winner model "${winnerId}" not found or failed in session ${session.sessionId}`);
    }

    await applyVariantToMain(winner.worktreePath, projectRoot);
    await this.cleanup(session);
  }

  /**
   * Clean up all worktrees from a completed session.
   */
  async cleanup(session: ArenaSession): Promise<void> {
    const { projectRoot } = this.config;
    const arenaBase = join(projectRoot, ".dantecode", "arena", session.sessionId);

    for (const result of session.results) {
      if (result.worktreePath) {
        removeWorktree(projectRoot, result.worktreePath);
      }
    }

    // Remove the session directory tree if it exists and is now empty
    try {
      await rm(arenaBase, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  /**
   * Format a comparison summary for display.
   * Shows: Model | Duration | Tokens | Files | PDSE | Status
   */
  static formatComparison(session: ArenaSession): string {
    const lines: string[] = [
      `Arena Session: ${session.sessionId}`,
      `Started: ${session.startedAt}`,
      `Completed: ${session.completedAt ?? "in-progress"}`,
      "",
      "Results:",
      padRow("Model", "Duration", "Tokens", "Files", "PDSE", "Status"),
      "─".repeat(72),
    ];

    for (const r of session.results) {
      const label = (r.label ?? r.modelId).slice(0, 20).padEnd(20);
      const dur = `${(r.durationMs / 1000).toFixed(1)}s`.padStart(8);
      const tok = String(r.tokenCount ?? "-").padStart(8);
      const files = String(r.filesModified.length).padStart(6);
      const pdse = r.pdseScore != null ? String(r.pdseScore).padStart(5) : "  N/A";
      const status = r.status.padStart(8);
      lines.push(`${label} ${dur} ${tok} ${files} ${pdse} ${status}`);
    }

    if (session.winnerId) {
      lines.push("", `Winner: ${session.winnerId}`);
    }

    return lines.join("\n");
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function padRow(
  model: string,
  dur: string,
  tok: string,
  files: string,
  pdse: string,
  status: string,
): string {
  return `${model.padEnd(20)} ${dur.padStart(8)} ${tok.padStart(8)} ${files.padStart(6)} ${pdse.padStart(5)} ${status.padStart(8)}`;
}

/**
 * Build a minimal ModelRouterConfig for a given ArenaModel.
 * Uses the model's apiKey if provided, else falls back to environment variables.
 */
function buildArenaRouterConfig(
  model: ArenaModel,
): import("@dantecode/config-types").ModelRouterConfig {
  const modelConfig: import("@dantecode/config-types").ModelConfig = {
    modelId: model.modelId,
    provider: model.provider === "custom" ? "openai" : model.provider,
    apiKey: model.apiKey,
    maxTokens: 8192,
    temperature: 0.2,
    contextWindow: 128_000,
    supportsVision: false,
    supportsToolCalls: true,
  };

  return {
    default: modelConfig,
    fallback: [],
    overrides: {},
  };
}

// ─── Shared: apply worktree changes to main ───────────────────────────────────

/**
 * Transfer changes from a variant worktree back to the main project directory
 * using `git diff` + `git apply`.
 */
export async function applyVariantToMain(
  variantWorktreePath: string,
  projectRoot: string,
): Promise<{ appliedFiles: string[] }> {
  // Get the diff from the worktree relative to HEAD
  let diff: string;
  try {
    diff = execFileSync("git", ["diff", "HEAD"], {
      cwd: variantWorktreePath,
      stdio: "pipe",
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50 MB
    });
  } catch (err) {
    throw new Error(
      `Failed to get diff from worktree ${variantWorktreePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!diff.trim()) {
    // Also check untracked files in worktree status
    return { appliedFiles: [] };
  }

  // Apply the diff to the main working directory
  try {
    execFileSync("git", ["apply", "--whitespace=fix", "-"], {
      cwd: projectRoot,
      input: diff,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    // Try with --reject flag to apply what we can
    try {
      execFileSync("git", ["apply", "--whitespace=fix", "--reject", "-"], {
        cwd: projectRoot,
        input: diff,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      throw new Error(
        `Failed to apply worktree diff to ${projectRoot}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Extract applied file paths from the diff header
  const appliedFiles = Array.from(
    new Set(
      [...diff.matchAll(/^(?:\+\+\+|---)\s+(?:a\/|b\/)?(.+)$/gm)]
        .map((m) => m[1]?.trim() ?? "")
        .filter((f) => f.length > 0 && f !== "/dev/null"),
    ),
  );

  return { appliedFiles };
}
