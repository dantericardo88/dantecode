// ============================================================================
// @dantecode/git-engine — Diff Parsing and Review
// ============================================================================

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { DiffHunk } from "@dantecode/config-types";

// Re-export the DiffHunk type so consumers can import from this module
export type { DiffHunk } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Execute a git command synchronously in the given working directory.
 * Returns the raw stdout as a string.
 */
function git(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024, // 50 MB for large diffs
    });
  } catch (error: unknown) {
    const err = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    // git diff exits with 1 when there are differences — that's not an error
    if (err.status === 1 && typeof err.stdout === "string") {
      return err.stdout;
    }
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    const msg = stderr || err.message || "Unknown git error";
    throw new Error(`git ${args.split(" ")[0]}: ${msg}`);
  }
}

// ----------------------------------------------------------------------------
// Hunk header regex
// ----------------------------------------------------------------------------

/**
 * Matches unified diff hunk headers like:
 *   @@ -10,7 +10,8 @@ optional context
 */
const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

/**
 * Matches diff file headers like:
 *   diff --git a/path/to/file b/path/to/file
 */
const DIFF_FILE_HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/;

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Get the raw unified diff for the working tree (unstaged changes).
 * If `ref` is provided, produces the diff between that ref and HEAD.
 *
 * @param projectRoot - Absolute path to the repository root.
 * @param ref - Optional git ref to diff against (e.g. "HEAD~3", "main", a SHA).
 * @returns The raw unified diff output as a string.
 */
export function getDiff(projectRoot: string, ref?: string): string {
  if (ref) {
    return git(`diff "${ref}"`, projectRoot);
  }
  return git("diff", projectRoot);
}

/**
 * Get the raw unified diff of staged (index) changes.
 *
 * @param projectRoot - Absolute path to the repository root.
 * @returns The raw unified diff output as a string.
 */
export function getStagedDiff(projectRoot: string): string {
  return git("diff --cached", projectRoot);
}

/**
 * Parse a raw unified diff string into structured DiffHunk objects.
 *
 * Each hunk includes the file it belongs to, the line range information,
 * and the hunk content (including the `@@` header line).
 *
 * @param diffOutput - Raw unified diff text (from `git diff`).
 * @returns Array of parsed DiffHunk objects.
 */
export function parseDiffHunks(diffOutput: string): DiffHunk[] {
  if (!diffOutput || diffOutput.trim().length === 0) {
    return [];
  }

  const hunks: DiffHunk[] = [];
  const lines = diffOutput.split("\n");
  let currentFile = "";
  let currentHunkLines: string[] = [];
  let currentOldStart = 0;
  let currentOldLines = 0;
  let currentNewStart = 0;
  let currentNewLines = 0;
  let inHunk = false;

  function flushHunk(): void {
    if (inHunk && currentHunkLines.length > 0 && currentFile) {
      hunks.push({
        file: currentFile,
        oldStart: currentOldStart,
        oldLines: currentOldLines,
        newStart: currentNewStart,
        newLines: currentNewLines,
        content: currentHunkLines.join("\n"),
      });
    }
    currentHunkLines = [];
    inHunk = false;
  }

  for (const line of lines) {
    // Check for a new file header
    const fileMatch = DIFF_FILE_HEADER_RE.exec(line);
    if (fileMatch) {
      flushHunk();
      // Use the "b" side path (the destination) as the canonical file name
      currentFile = fileMatch[2]!;
      continue;
    }

    // Check for a hunk header
    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      flushHunk();
      currentOldStart = parseInt(hunkMatch[1]!, 10);
      currentOldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      currentNewStart = parseInt(hunkMatch[3]!, 10);
      currentNewLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
      inHunk = true;
      currentHunkLines.push(line);
      continue;
    }

    // Inside a hunk: collect context, addition, and deletion lines
    if (inHunk) {
      if (
        line.startsWith(" ") ||
        line.startsWith("+") ||
        line.startsWith("-") ||
        line === "\\ No newline at end of file"
      ) {
        currentHunkLines.push(line);
      } else if (line.startsWith("diff ")) {
        // A new diff block started (without --git prefix, e.g. combined diff)
        flushHunk();
      }
      // Other lines inside a hunk (e.g. empty lines at end of diff) are ignored
    }
  }

  // Flush any remaining hunk
  flushHunk();

  return hunks;
}

/**
 * Apply a single diff hunk to the repository using `git apply`.
 *
 * Constructs a minimal patch file containing just the given hunk and applies
 * it via `git apply --allow-empty`.
 *
 * @param hunk - The diff hunk to apply.
 * @param projectRoot - Absolute path to the repository root.
 */
export function applyDiff(hunk: DiffHunk, projectRoot: string): void {
  // Build a minimal unified diff patch for this single hunk
  const patchLines: string[] = [
    `--- a/${hunk.file}`,
    `+++ b/${hunk.file}`,
    hunk.content,
  ];

  // Add trailing newline if not present
  let patch = patchLines.join("\n");
  if (!patch.endsWith("\n")) {
    patch += "\n";
  }

  // Write patch to a temporary file to avoid shell escaping issues
  const tmpName = `dantecode-patch-${randomBytes(8).toString("hex")}.patch`;
  const tmpPath = join(tmpdir(), tmpName);

  try {
    writeFileSync(tmpPath, patch, "utf-8");

    execSync(`git apply --allow-empty "${tmpPath}"`, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    const msg = stderr || err.message || "Unknown git error";
    throw new Error(`git apply: ${msg}`);
  } finally {
    // Clean up the temporary patch file
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup failures
    }
  }
}
