// ============================================================================
// @dantecode/core — Run Report Writer
// Handles filesystem output for run reports.
// ============================================================================

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "./enterprise-logger.js";

export interface WriteRunReportOptions {
  /** Project root directory. */
  projectRoot: string;
  /** Serialized markdown content. */
  markdown: string;
  /** ISO timestamp for filename. */
  timestamp: string;
  /** Whether to auto-commit the report. */
  autoCommit?: boolean;
  /** Commit function (DI for testability). */
  commitFn?: (files: string[], message: string, cwd: string) => Promise<void> | void;
}

/**
 * Generate a safe filename from an ISO timestamp and optional command.
 * Replaces characters unsafe for filenames (`:`) with dashes.
 */
export function reportFileName(isoTimestamp: string, command?: string): string {
  const base = isoTimestamp.replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
  if (!command) return `run-${base}.md`;
  const suffix = command
    .replace(/[^a-z0-9-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `run-${base}-${suffix}.md`;
}

export interface WriteRunReportResult {
  success: boolean;
  path?: string;
  error?: string;
}

/**
 * Writes the run report markdown to `.dantecode/reports/`.
 * Returns success indicator and path if written.
 *
 * Catches errors and logs them — report persistence is non-fatal
 * but honesty requires not implying success when it failed.
 */
export async function writeRunReport(opts: WriteRunReportOptions): Promise<WriteRunReportResult> {
  const reportsDir = join(opts.projectRoot, ".dantecode", "reports");
  const fileName = reportFileName(opts.timestamp);
  const filePath = join(reportsDir, fileName);

  try {
    await mkdir(reportsDir, { recursive: true });
    await writeFile(filePath, opts.markdown, "utf-8");

    if (opts.autoCommit && opts.commitFn) {
      const completeCount = (opts.markdown.match(/\u2705 COMPLETE/g) ?? []).length;
      const totalMatch = opts.markdown.match(/\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*/);
      const totalCount = totalMatch ? totalMatch[1] : "?";
      const message = `dantecode: run report (${completeCount}/${totalCount} complete)`;
      await opts.commitFn([filePath], message, opts.projectRoot);
    }

    return { success: true, path: filePath };
  } catch (err) {
    // Non-fatal — log error, return failure indicator for honesty
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (process.env.DANTECODE_DEBUG) {
      logger.error({ error: err, filePath }, "Failed to write run report");
    }

    return { success: false, error: errorMessage };
  }
}
