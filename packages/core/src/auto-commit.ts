// ============================================================================
// @dantecode/core — LLM Auto-Commit (Aider repo.py pattern)
// Generates conventional-commit messages via an LLM and optionally commits
// modified files automatically when the feature is opt-in enabled.
// ============================================================================

import { execSync } from "node:child_process";
import type { ModelRouterImpl } from "./model-router.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AutoCommitConfig {
  /** Whether auto-commit is active. Default: false (opt-in). */
  enabled: boolean;
  /** Append a Co-Authored-By trailer. Default: true. */
  includeCoAuthoredBy: boolean;
  /** Model ID to use for message generation (prefer fast models). */
  modelId?: string;
}

export interface AutoCommitResult {
  committed: boolean;
  message?: string;
  error?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CO_AUTHORED_BY = "Co-Authored-By: DanteCode <noreply@dantecode.dev>";
const MAX_DIFF_CHARS = 8_000; // truncate very large diffs before sending to LLM
const MAX_MESSAGE_LENGTH = 72;

const COMMIT_SYSTEM_PROMPT = [
  "You are an expert at writing Git commit messages in the conventional-commit style.",
  "Given a git diff, generate ONE concise commit message of at most 72 characters.",
  "Use the format: type(scope): short description",
  "Valid types: feat, fix, refactor, test, docs, chore, perf, build, ci.",
  "Scope is optional but preferred when clear (e.g., auth, api, cli, core).",
  "Do NOT include bullet points, body text, or backticks.",
  "Return ONLY the commit message — nothing else.",
].join("\n");

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return diff.slice(0, MAX_DIFF_CHARS) + "\n... (diff truncated)";
}

function sanitizeMessage(raw: string): string {
  // Strip markdown, quotes, and leading/trailing whitespace
  const cleaned = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\n.*/s, "") // keep only first line
    .trim();
  return cleaned.slice(0, MAX_MESSAGE_LENGTH);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generates a conventional-commit message for the provided git diff by calling
 * the model with a structured prompt. Returns a sanitized, 72-char-max string.
 */
export async function generateCommitMessage(
  diff: string,
  router: ModelRouterImpl,
): Promise<string> {
  const trimmedDiff = truncateDiff(diff);
  const userPrompt = `Generate a conventional commit message for this diff:\n\n${trimmedDiff}`;

  const result = await router.generate(
    [{ role: "user", content: userPrompt }],
    {
      system: COMMIT_SYSTEM_PROMPT,
      maxTokens: 128,
    },
  );

  const raw = typeof result === "string" ? result : (result as { text?: string }).text ?? "";
  return sanitizeMessage(raw);
}

/**
 * Conditionally stages and commits modified files using an LLM-generated message.
 *
 * 1. If config.enabled is false, returns {committed: false} immediately.
 * 2. Obtains `git diff HEAD` for the working tree.
 * 3. Generates a commit message via the LLM.
 * 4. Stages modifiedFiles and commits.
 * 5. Optionally appends a Co-Authored-By trailer.
 */
export async function autoCommitIfEnabled(
  projectRoot: string,
  modifiedFiles: string[],
  config: AutoCommitConfig,
  router: ModelRouterImpl,
  modelLabel: string,
): Promise<AutoCommitResult> {
  if (!config.enabled) {
    return { committed: false };
  }

  if (modifiedFiles.length === 0) {
    return { committed: false, error: "No files to commit" };
  }

  try {
    // Get the diff for the modified files
    const diff = execSync("git diff HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 10_000,
    });

    if (!diff.trim()) {
      return { committed: false, error: "Nothing to commit — working tree is clean" };
    }

    // Generate commit message via LLM
    const message = await generateCommitMessage(diff, router);
    if (!message) {
      return { committed: false, error: "LLM returned an empty commit message" };
    }

    // Stage the specified files
    const quotedFiles = modifiedFiles.map((f) => `"${f}"`).join(" ");
    execSync(`git add ${quotedFiles}`, {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 10_000,
    });

    // Build commit command with optional Co-Authored-By trailer
    const trailer = config.includeCoAuthoredBy
      ? `\n\nCo-Authored-By: DanteCode (${modelLabel}) <noreply@dantecode.dev>\n${CO_AUTHORED_BY}`
      : "";

    const fullMessage = message + trailer;

    execSync(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 15_000,
    });

    return { committed: true, message };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { committed: false, error: errorMessage };
  }
}
