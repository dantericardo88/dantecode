// ============================================================================
// packages/vscode/src/vscode-lint-check.ts
//
// Runs tsc --noEmit after batch edits and returns structured error output.
// Used by the linter feedback loop in sidebar-provider.ts (Machine 5 wiring).
//
// Design:
//   - Filters changedFiles to .ts / .tsx / .mts / .cts only; empty set → fast exit
//   - Uses spawn (not execSync) to avoid blocking the extension host thread
//   - 15-second hard timeout via setTimeout + child.kill('SIGTERM')
//   - Parses tsc pretty=false output: file(line,col): error TSxxxx: message
//   - Groups errors by file path into byFile Map
//   - formattedErrors capped at 40 lines to avoid token overflow
//   - Pure Node.js — zero vscode imports, zero external packages
//   - Never throws; all errors are caught internally
// ============================================================================

import { spawn } from "node:child_process";
import { resolve } from "node:path";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface LintCheckResult {
  hasErrors: boolean;
  errorCount: number;
  /** Human-readable, suitable for a code block in chat. Empty when no errors. */
  formattedErrors: string;
  /** Errors grouped by file path (as reported by tsc). */
  byFile: Map<string, LintFileError[]>;
}

export interface LintFileError {
  file: string;
  line: number;
  col: number;
  /** TypeScript error code, e.g. 2322 */
  code: number;
  message: string;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const LINT_TIMEOUT_MS = 15_000;
const MAX_FORMATTED_LINES = 40;

/** tsc --pretty false error line pattern: path(line,col): error TSxxxx: message */
const TSC_ERROR_RE = /^(.+)\((\d+),(\d+)\): error TS(\d+): (.+)$/;

// ----------------------------------------------------------------------------
// runVscodeLintCheck
// ----------------------------------------------------------------------------

/**
 * Run `tsc --noEmit --skipLibCheck --pretty false` in `projectRoot` and return
 * structured lint results.
 *
 * @param projectRoot  Absolute path to the TypeScript project root (where
 *                     tsconfig.json lives). Used as cwd for the tsc process.
 * @param changedFiles List of file paths that were just modified. May be
 *                     absolute or relative; only TypeScript files are checked.
 */
export async function runVscodeLintCheck(
  projectRoot: string,
  changedFiles: string[],
): Promise<LintCheckResult> {
  const empty: LintCheckResult = {
    hasErrors: false,
    errorCount: 0,
    formattedErrors: "",
    byFile: new Map(),
  };

  try {
    // Step 1 — filter to TS files only
    const tsFiles = changedFiles.filter((f) => {
      const lower = f.toLowerCase();
      const dotIdx = lower.lastIndexOf(".");
      if (dotIdx === -1) return false;
      return TS_EXTENSIONS.has(lower.slice(dotIdx));
    });

    if (tsFiles.length === 0) {
      return empty;
    }

    // Step 2-4 — spawn tsc, collect output, enforce timeout
    let rawOutput: string;
    try {
      rawOutput = await spawnTsc(projectRoot);
    } catch (e) {
      if (e instanceof TscTimeoutError) {
        return { ...TSC_TIMEOUT_RESULT, byFile: new Map() };
      }
      // Unexpected spawn error — return safe empty result
      return empty;
    }

    // Step 5-6 — parse error lines
    const lines = rawOutput.split(/\r?\n/);
    const byFile = new Map<string, LintFileError[]>();
    const errorLines: string[] = [];

    for (const line of lines) {
      const match = TSC_ERROR_RE.exec(line);
      if (!match) continue;

      const [, file, lineStr, colStr, codeStr, message] = match;
      if (!file || !lineStr || !colStr || !codeStr || !message) continue;
      const entry: LintFileError = {
        file,
        line: parseInt(lineStr, 10),
        col: parseInt(colStr, 10),
        code: parseInt(codeStr, 10),
        message: message.trim(),
      };

      const existing = byFile.get(file);
      if (existing) {
        existing.push(entry);
      } else {
        byFile.set(file, [entry]);
      }

      errorLines.push(line);
    }

    const errorCount = errorLines.length;
    if (errorCount === 0) {
      return empty;
    }

    // Step 7 — build formattedErrors (max 40 lines)
    const cappedLines = errorLines.slice(0, MAX_FORMATTED_LINES);
    const truncationNote =
      errorCount > MAX_FORMATTED_LINES
        ? `\n...(${errorCount - MAX_FORMATTED_LINES} more errors omitted)`
        : "";
    const formattedErrors = cappedLines.join("\n") + truncationNote;

    // Step 8 — return complete result
    return {
      hasErrors: true,
      errorCount,
      formattedErrors,
      byFile,
    };
  } catch {
    // Never throw — return a safe empty result on unexpected failure
    return empty;
  }
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

/**
 * Spawn `tsc --noEmit --skipLibCheck --pretty false` with a 15-second timeout.
 *
 * Resolves with the combined stdout+stderr output string (may be empty on
 * success). On timeout, resolves with a sentinel timeout message so the caller
 * can surface it as a structured error.
 */
function spawnTsc(projectRoot: string): Promise<string> {
  return new Promise<string>((resolvePromise) => {
    const resolvedRoot = resolve(projectRoot);
    let settled = false;
    let outputBuffer = "";

    const child = spawn("tsc", ["--noEmit", "--skipLibCheck", "--pretty", "false"], {
      cwd: resolvedRoot,
      stdio: ["ignore", "pipe", "pipe"],
      // windowsHide keeps the console window hidden on Windows
      windowsHide: true,
    });

    // Collect stdout
    child.stdout.on("data", (chunk: Buffer) => {
      outputBuffer += chunk.toString("utf8");
    });

    // Collect stderr (tsc occasionally writes to stderr)
    child.stderr.on("data", (chunk: Buffer) => {
      outputBuffer += chunk.toString("utf8");
    });

    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(outputBuffer);
    });

    child.on("error", () => {
      // tsc not found (ENOENT) or other spawn error — treat as no errors
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise("");
    });

    // Hard timeout: kill the child and resolve with a timeout sentinel
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore kill errors
      }
      resolvePromise("__TIMEOUT__");
    }, LINT_TIMEOUT_MS);
  }).then((output) => {
    // Translate the timeout sentinel into a structured timeout result
    if (output === "__TIMEOUT__") {
      // Caller will see errorCount: -1 via the outer wrapper
      throw new TscTimeoutError();
    }
    return output;
  });
}

// ----------------------------------------------------------------------------
// TscTimeoutError — used internally to signal a timeout through the promise
// chain without leaking implementation details
// ----------------------------------------------------------------------------

class TscTimeoutError extends Error {
  constructor() {
    super("tsc timed out after 15s");
    this.name = "TscTimeoutError";
  }
}

// Re-export the timeout result shape so callers can detect it
export const TSC_TIMEOUT_RESULT: LintCheckResult = {
  hasErrors: true,
  errorCount: -1,
  formattedErrors: "tsc timed out after 15s",
  byFile: new Map(),
};
