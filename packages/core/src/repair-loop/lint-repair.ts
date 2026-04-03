/**
 * lint-repair.ts
 *
 * Post-apply lint repair loop following Aider's base_coder.py pattern.
 * Automatically fixes lint errors after code mutations.
 */

import { execSync } from "node:child_process";
import { parseLintOutput } from "./lint-parsers.js";
import type { LintError } from "./lint-parsers.js";
import type { EventEngine } from "../event-engine.js";
import { buildRuntimeEvent } from "@dantecode/runtime-spine";
import { randomUUID } from "node:crypto";

export interface LintConfig {
  command: string; // e.g., "npm run lint"
  fixCommand?: string; // e.g., "npm run lint -- --fix" (defaults to command + " --fix")
  maxRetries: number; // default: 3
  autoCommitFixes: boolean; // default: true
  tool?: "eslint" | "prettier" | "tsc"; // For parser selection
}

export interface LintResult {
  success: boolean;
  errors: LintError[];
  fixesApplied: boolean;
  autoCommitHash?: string; // Git commit SHA of auto-fixes
  iteration: number; // Which retry iteration this result is from
}

export interface RunLintRepairOptions {
  changedFiles: string[];
  config: LintConfig;
  projectRoot: string;
  eventEngine?: EventEngine;
  taskId?: string;
  /** Injectable git commit function for testing */
  gitCommit?: (message: string, projectRoot: string) => string;
  /** Injectable exec function for testing */
  execFn?: (command: string, options: any) => Buffer;
}

/**
 * Run lint command and parse output
 */
function runLint(
  command: string,
  projectRoot: string,
  tool: "eslint" | "prettier" | "tsc" | undefined,
  execFn?: (command: string, options: any) => Buffer,
): { output: string; errors: LintError[] } {
  const exec = execFn || execSync;

  try {
    const output = exec(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const outputStr = typeof output === "string" ? output : output.toString("utf-8");
    const errors = parseLintOutput(outputStr, tool);

    return { output: outputStr, errors };
  } catch (error: any) {
    // Lint tools return non-zero exit code when errors found
    const output = error.stdout?.toString("utf-8") || error.stderr?.toString("utf-8") || "";
    const errors = parseLintOutput(output, tool);

    return { output, errors };
  }
}

/**
 * Attempt to auto-fix lint errors
 */
function runLintFix(
  fixCommand: string,
  projectRoot: string,
  execFn?: (command: string, options: any) => Buffer,
): { success: boolean; output: string } {
  const exec = execFn || execSync;

  try {
    const output = exec(fixCommand, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const outputStr = typeof output === "string" ? output : output.toString("utf-8");

    return { success: true, output: outputStr };
  } catch (error: any) {
    // Some lint tools return non-zero even after successful fixes
    const output = error.stdout?.toString("utf-8") || error.stderr?.toString("utf-8") || "";

    return { success: false, output };
  }
}

/**
 * Commit auto-fixes to git
 */
function commitAutoFixes(
  projectRoot: string,
  gitCommit?: (message: string, projectRoot: string) => string,
): string {
  const commit = gitCommit || defaultGitCommit;
  return commit("chore: auto-fix lint errors", projectRoot);
}

function defaultGitCommit(message: string, projectRoot: string): string {
  try {
    // Stage all changes
    execSync("git add -A", { cwd: projectRoot });

    // Commit
    execSync(`git commit -m "${message}"`, { cwd: projectRoot });

    // Get commit hash
    const hash = execSync("git rev-parse HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
    }).trim();

    return hash;
  } catch (error: any) {
    throw new Error(`Failed to commit auto-fixes: ${error.message}`);
  }
}

/**
 * Build fix command from base command
 */
function buildFixCommand(config: LintConfig): string {
  if (config.fixCommand) {
    return config.fixCommand;
  }

  // Auto-detect fix flag based on tool
  const baseCommand = config.command;

  if (config.tool === "prettier") {
    return `${baseCommand} --write`;
  }

  if (config.tool === "tsc") {
    // TSC doesn't have auto-fix
    return baseCommand;
  }

  // Default: ESLint-style --fix
  return `${baseCommand} --fix`;
}

/**
 * Format lint errors for display
 */
export function formatLintErrors(errors: LintError[]): string {
  if (errors.length === 0) {
    return "No lint errors found.";
  }

  const errorsByFile = new Map<string, LintError[]>();

  for (const error of errors) {
    const existing = errorsByFile.get(error.file) || [];
    existing.push(error);
    errorsByFile.set(error.file, existing);
  }

  const lines: string[] = [];
  lines.push(`Found ${errors.length} lint error(s) in ${errorsByFile.size} file(s):\n`);

  for (const [file, fileErrors] of errorsByFile.entries()) {
    lines.push(`${file}:`);

    for (const err of fileErrors) {
      const location = err.line > 0 ? `  ${err.line}:${err.column}` : "  ";
      const severity = err.severity === "error" ? "error" : "warn";
      lines.push(`${location} ${severity} ${err.message} (${err.rule})`);
    }

    lines.push(""); // Blank line between files
  }

  return lines.join("\n");
}

/**
 * Run lint repair loop
 *
 * Follows Aider pattern:
 * 1. Run lint on changed files
 * 2. Parse output
 * 3. If auto-fix available: run lint --fix, commit changes
 * 4. If errors remain: return for model to fix
 * 5. Repeat up to maxRetries
 */
export async function runLintRepair(options: RunLintRepairOptions): Promise<LintResult> {
  const { changedFiles, config, projectRoot, eventEngine, taskId, gitCommit, execFn } = options;

  const effectiveTaskId = taskId || randomUUID();
  const startedAt = new Date().toISOString();

  // Emit started event
  if (eventEngine) {
    await eventEngine.emit(
      buildRuntimeEvent({
        kind: "run.repair.lint.started",
        taskId: effectiveTaskId,
        payload: {
          changedFiles,
          maxRetries: config.maxRetries,
          autoCommitFixes: config.autoCommitFixes,
        },
      }),
    );
  }

  let iteration = 0;
  let lastErrors: LintError[] = [];
  let fixesApplied = false;
  let autoCommitHash: string | undefined;

  try {
    // Initial lint run
    const initialResult = runLint(config.command, projectRoot, config.tool, execFn);
    lastErrors = initialResult.errors;

    // If no errors, we're done
    if (lastErrors.length === 0) {
      const result: LintResult = {
        success: true,
        errors: [],
        fixesApplied: false,
        iteration: 0,
      };

      await emitCompletedEvent(eventEngine, effectiveTaskId, result, startedAt);
      return result;
    }

    // Auto-fix loop
    const fixCommand = buildFixCommand(config);
    const canAutoFix = config.tool !== "tsc"; // TSC can't auto-fix

    // If can't auto-fix, return errors immediately
    if (!canAutoFix) {
      const result: LintResult = {
        success: false,
        errors: lastErrors,
        fixesApplied: false,
        iteration: 0,
      };

      await emitCompletedEvent(eventEngine, effectiveTaskId, result, startedAt);
      return result;
    }

    while (iteration < config.maxRetries && lastErrors.length > 0) {
      iteration++;

      // Run auto-fix
      const fixResult = runLintFix(fixCommand, projectRoot, execFn);
      fixesApplied = true;

      // Commit fixes if configured
      if (config.autoCommitFixes && fixResult.success) {
        try {
          autoCommitHash = commitAutoFixes(projectRoot, gitCommit);
        } catch {
          // Commit failed, but fixes may still be applied
        }
      }

      // Re-run lint to check if errors remain
      const recheckResult = runLint(config.command, projectRoot, config.tool, execFn);
      lastErrors = recheckResult.errors;

      // If no errors remain, success
      if (lastErrors.length === 0) {
        break;
      }

      // If errors didn't decrease, stop trying
      if (recheckResult.errors.length >= initialResult.errors.length) {
        break;
      }
    }

    const result: LintResult = {
      success: lastErrors.length === 0,
      errors: lastErrors,
      fixesApplied,
      autoCommitHash,
      iteration,
    };

    await emitCompletedEvent(eventEngine, effectiveTaskId, result, startedAt);
    return result;
  } catch (error: any) {
    // Emit failed completion event
    const result: LintResult = {
      success: false,
      errors: lastErrors,
      fixesApplied,
      autoCommitHash,
      iteration,
    };

    await emitCompletedEvent(eventEngine, effectiveTaskId, result, startedAt, error);
    return result;
  }
}

async function emitCompletedEvent(
  eventEngine: EventEngine | undefined,
  taskId: string,
  result: LintResult,
  startedAt: string,
  error?: Error,
): Promise<void> {
  if (!eventEngine) return;

  const completedAt = new Date().toISOString();
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

  await eventEngine.emit(
    buildRuntimeEvent({
      kind: "run.repair.lint.completed",
      taskId,
      payload: {
        success: result.success,
        errorCount: result.errors.length,
        fixesApplied: result.fixesApplied,
        autoCommitHash: result.autoCommitHash,
        iteration: result.iteration,
        durationMs,
        error: error?.message,
      },
    }),
  );
}
