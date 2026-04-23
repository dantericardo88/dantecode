// ============================================================================
// packages/cli/src/auto-lint-gate.ts
//
// Auto-lint gate: run `tsc --noEmit --skipLibCheck` after every .ts/.tsx file
// mutation to catch type errors in the round they are introduced.
//
// Design:
//   - Only runs for .ts / .tsx files — all others → skipped: true
//   - Uses execFile (not shell: true) to avoid command injection
//   - 10-second hard timeout; tsc not in PATH → skipped gracefully
//   - roundCache: Set<string> prevents >1 check per absolute path per round
//   - Errors prefixed "AUTO-LINT: " for agent-loop recognition
//   - Zero deps on agent-loop or slash-commands
// ============================================================================

import { execFile } from "node:child_process";
import { resolve, extname } from "node:path";
import type { ErrorClass } from "./debug-protocol.js";
import { classifyError } from "./debug-protocol.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface LintGateResult {
  /** True when tsc found type errors. */
  hasErrors: boolean;
  /**
   * Formatted error output, prefixed "AUTO-LINT: " so the agent-loop can
   * identify lint results in the message stream.
   * Empty string when hasErrors is false.
   */
  formattedErrors: string;
  /** Error class from debug-protocol's classifyError(). */
  errorClass: ErrorClass;
  /**
   * True when the lint was skipped (non-TS file, tsc not found, or file
   * already checked this round). When skipped, hasErrors is always false.
   */
  skipped: boolean;
}

// ----------------------------------------------------------------------------
// Round cache factory
// ----------------------------------------------------------------------------

/**
 * Create a fresh per-round cache set.
 * Declare one above the agent while-loop; reset by replacing with a new Set
 * at the top of each round iteration.
 */
export function createLintRoundCache(): Set<string> {
  return new Set<string>();
}

// ----------------------------------------------------------------------------
// runAutoLintGate
// ----------------------------------------------------------------------------

const TS_EXTENSIONS = new Set([".ts", ".tsx"]);
const LINT_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 2_000;

/**
 * Run tsc --noEmit --skipLibCheck on a single TypeScript file.
 *
 * @param absoluteFilePath  Absolute path to the file that was just written.
 * @param projectRoot       Root directory of the project (used for tsc cwd).
 * @param roundCache        Set of already-checked absolute paths for this round.
 *                          The function adds the path on first check and skips on repeat.
 */
export async function runAutoLintGate(
  absoluteFilePath: string,
  projectRoot: string,
  roundCache: Set<string>,
): Promise<LintGateResult> {
  const ext = extname(absoluteFilePath).toLowerCase();

  // Skip non-TypeScript files
  if (!TS_EXTENSIONS.has(ext)) {
    return { hasErrors: false, formattedErrors: "", errorClass: "UnknownError", skipped: true };
  }

  // Normalize to absolute path for cache key
  const absPath = resolve(absoluteFilePath);

  // Skip files already checked this round
  if (roundCache.has(absPath)) {
    return { hasErrors: false, formattedErrors: "", errorClass: "UnknownError", skipped: true };
  }
  roundCache.add(absPath);

  try {
    const stderr = await runTsc(absPath, projectRoot);
    if (!stderr) {
      // tsc exited 0 — no errors
      return { hasErrors: false, formattedErrors: "", errorClass: "UnknownError", skipped: false };
    }

    // tsc found errors
    const truncated =
      stderr.length > MAX_ERROR_LENGTH
        ? stderr.slice(0, MAX_ERROR_LENGTH) + "\n...(truncated)"
        : stderr;

    const errorClass = classifyError(stderr, 1);
    const formattedErrors = `AUTO-LINT: ${truncated}`;

    return { hasErrors: true, formattedErrors, errorClass, skipped: false };
  } catch (err: unknown) {
    // tsc not found in PATH, permission error, or other exec failure → skip gracefully
    if (isTscNotFound(err)) {
      return {
        hasErrors: false,
        formattedErrors: "",
        errorClass: "UnknownError",
        skipped: true,
      };
    }
    // Unexpected error — treat as skipped rather than crashing the loop
    return { hasErrors: false, formattedErrors: "", errorClass: "UnknownError", skipped: true };
  }
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

/**
 * Run `tsc --noEmit --skipLibCheck <file>` with a hard timeout.
 * Resolves with stderr on type errors (exit code != 0), resolves with ""
 * on success.
 * Rejects when tsc is not found or exec fails for system reasons.
 */
function runTsc(absoluteFilePath: string, projectRoot: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "tsc",
      ["--noEmit", "--skipLibCheck", absoluteFilePath],
      {
        cwd: projectRoot,
        timeout: LINT_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, _stdout, stderr) => {
        if (!error) {
          // Exit 0 — no errors
          resolve("");
          return;
        }
        // ENOENT = tsc not installed
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(error);
          return;
        }
        // Exit non-zero = type errors found
        const output = (stderr || "").trim() || (error.message || "").trim();
        resolve(output);
      },
    );
    // Belt-and-suspenders: kill after timeout if the execFile timeout doesn't fire
    setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
    }, LINT_TIMEOUT_MS + 500);
  });
}

function isTscNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "EACCES";
}
