// ============================================================================
// @dantecode/swe-bench-runner — Report Generator
// Generates EvalReport and formats markdown output.
// ============================================================================

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { RunResult, EvalReport } from "./types.js";

export interface ReportOptions {
  runId?: string;
}

export class ReportGenerator {
  /**
   * Build an EvalReport from a list of RunResults.
   */
  generateReport(results: RunResult[], options: ReportOptions = {}): EvalReport {
    const runId = options.runId ?? `run_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const timestamp = new Date().toISOString();
    const total = results.length;
    const resolved = results.filter((r) => r.resolved).length;
    const passRate = total > 0 ? resolved / total : 0;

    // Per-repo aggregation
    const perRepo: Record<string, { total: number; resolved: number }> = {};
    for (const result of results) {
      // instance_id format: "owner__repo__NNN" or "ts-utils__NNN"
      const parts = result.instance_id.split("__");
      const repo = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0] ?? result.instance_id;
      if (!perRepo[repo]) perRepo[repo] = { total: 0, resolved: 0 };
      perRepo[repo].total++;
      if (result.resolved) perRepo[repo].resolved++;
    }

    return {
      run_id: runId,
      timestamp,
      total,
      resolved,
      pass_rate: passRate,
      pass_at_1: passRate,
      per_repo: perRepo,
      results,
    };
  }

  /**
   * Format an EvalReport as a human-readable markdown string.
   */
  formatMarkdown(report: EvalReport): string {
    const date = report.timestamp.slice(0, 10);
    const passPercent = (report.pass_rate * 100).toFixed(1);

    const lines: string[] = [
      `# SWE-bench Results — ${date}`,
      "",
      `Run ID: ${report.run_id}`,
      `Total instances: ${report.total}`,
      `Resolved: ${report.resolved} (${passPercent}% pass@1)`,
      "",
    ];

    if (report.pass_at_3 != null) {
      lines.push(`pass@3: ${(report.pass_at_3 * 100).toFixed(1)}%`);
      lines.push("");
    }

    // Per-repo table
    lines.push("## Per-Repository Breakdown");
    lines.push("");
    lines.push("| Repo | Total | Resolved | Pass Rate |");
    lines.push("|------|-------|----------|-----------|");
    const sortedRepos = Object.entries(report.per_repo).sort(
      ([, a], [, b]) => b.total - a.total,
    );
    for (const [repo, stats] of sortedRepos) {
      const rate = stats.total > 0 ? ((stats.resolved / stats.total) * 100).toFixed(1) : "0.0";
      lines.push(`| ${repo} | ${stats.total} | ${stats.resolved} | ${rate}% |`);
    }
    lines.push("");

    // Results table
    lines.push("## Results");
    lines.push("");
    lines.push("| Instance | Resolved | Duration |");
    lines.push("|----------|----------|----------|");
    for (const result of report.results) {
      const resolved = result.resolved ? "yes" : "no";
      const duration = `${result.durationMs}ms`;
      lines.push(`| ${result.instance_id} | ${resolved} | ${duration} |`);
      if (result.error) {
        lines.push(`| _(error)_ ${result.error.slice(0, 60)} | | |`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Save the report as a JSON file at the given path.
   */
  async saveReport(report: EvalReport, outputPath: string): Promise<void> {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");
  }
}
