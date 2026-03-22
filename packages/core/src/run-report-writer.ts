// ============================================================================
// @dantecode/core — Run Report Writer
// Handles filesystem output for run reports.
// ============================================================================

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
 * Generate a safe filename from an ISO timestamp.
 * Replaces characters unsafe for filenames (`:`) with dashes.
 */
export function reportFileName(isoTimestamp: string): string {
  return `run-${isoTimestamp.replace(/:/g, "-").replace(/\.\d+Z$/, "Z")}.md`;
}

/**
 * Writes the run report markdown to `.dantecode/reports/`.
 * Returns the absolute path of the written file.
 *
 * Non-fatal: catches and logs errors rather than rethrowing,
 * so report writing never breaks the main command output.
 */
export async function writeRunReport(opts: WriteRunReportOptions): Promise<string> {
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
  } catch (err) {
    // Non-fatal — log but never rethrow
    if (process.env.DANTECODE_DEBUG) {
      console.error("[run-report-writer] Failed to write report:", err);
    }
  }

  return filePath;
}
