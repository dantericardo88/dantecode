// ============================================================================
// @dantecode/cli — Benchmark Report Generator
// Reads SWE-bench result JSON files and formats a summary table.
// ============================================================================

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

interface SWEBenchResult {
  instance_id: string;
  repo: string;
  pass_rate: number;
  time_seconds: number;
  tokens_used: number;
  cost_usd: number;
  pdse_score: number | null;
  error?: string;
}

interface SWEBenchRun {
  run_id: string;
  timestamp: string;
  total_instances: number;
  passed: number;
  failed: number;
  errors: number;
  pass_rate: number;
  avg_time_seconds: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_pdse_score: number | null;
  results: SWEBenchResult[];
}

/**
 * Reads all JSON result files from the benchmark results directories and
 * formats a summary table grouped by run, with per-repo pass rates.
 */
export async function generateBenchmarkReport(projectRoot: string): Promise<string> {
  const searchDirs = [
    join(projectRoot, ".dantecode", "benchmark-results"),
    join(projectRoot, "benchmarks", "swe-bench", "results"),
  ];

  const runs: SWEBenchRun[] = [];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = await readdir(dir);
      const jsonFiles = entries.filter((f) => f.endsWith(".json")).sort().reverse();

      for (const file of jsonFiles.slice(0, 20)) {
        try {
          const raw = await readFile(join(dir, file), "utf-8");
          const parsed = JSON.parse(raw) as SWEBenchRun;
          if (parsed.run_id && parsed.results) {
            runs.push(parsed);
          }
        } catch {
          // Skip malformed files
        }
      }
    } catch {
      // Directory not readable
    }
  }

  if (runs.length === 0) {
    return "No benchmark results found.\nRun: dantecode benchmark run --suite swe-bench";
  }

  // Deduplicate by run_id (same results may appear in both dirs)
  const seen = new Set<string>();
  const uniqueRuns = runs.filter((r) => {
    if (seen.has(r.run_id)) return false;
    seen.add(r.run_id);
    return true;
  });

  // Sort newest first
  uniqueRuns.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const lines: string[] = [
    "",
    "  \x1b[1mDanteCode Benchmark Report\x1b[0m",
    "",
    `  \x1b[2m${uniqueRuns.length} run(s) found\x1b[0m`,
    "",
  ];

  // Per-run summary table
  lines.push("  \x1b[33mRun ID                          Timestamp            Instances  Passed  Pass%  Avg PDSE  Cost\x1b[0m");
  lines.push("  " + "─".repeat(100));

  for (const run of uniqueRuns.slice(0, 10)) {
    const runIdShort = run.run_id.slice(0, 30).padEnd(30);
    const ts = run.timestamp.slice(0, 19).padEnd(19);
    const instances = String(run.total_instances).padStart(9);
    const passed = String(run.passed).padStart(6);
    const passRate = `${(run.pass_rate * 100).toFixed(1)}%`.padStart(5);
    const pdse = run.avg_pdse_score != null
      ? `${run.avg_pdse_score.toFixed(1)}`.padStart(8)
      : "     N/A";
    const cost = `$${run.total_cost_usd.toFixed(3)}`.padStart(6);

    const passColor = run.pass_rate >= 0.5 ? "\x1b[32m" : run.pass_rate >= 0.2 ? "\x1b[33m" : "\x1b[31m";
    lines.push(
      `  \x1b[2m${runIdShort}\x1b[0m  \x1b[2m${ts}\x1b[0m  ${instances}  ${passed}  ${passColor}${passRate}\x1b[0m  ${pdse}  \x1b[2m${cost}\x1b[0m`,
    );
  }

  lines.push("");

  // Per-repo aggregated pass rates across all runs
  const repoStats = new Map<string, { passed: number; total: number }>();
  for (const run of uniqueRuns) {
    for (const result of run.results) {
      const repo = result.repo || result.instance_id.split("__")[0] || "unknown";
      const existing = repoStats.get(repo) ?? { passed: 0, total: 0 };
      existing.total++;
      if (result.pass_rate > 0 && !result.error) existing.passed++;
      repoStats.set(repo, existing);
    }
  }

  if (repoStats.size > 0) {
    lines.push("  \x1b[1mPer-Repository Pass Rates\x1b[0m");
    lines.push("");
    lines.push("  \x1b[33mRepository                    Passed / Total  Pass%\x1b[0m");
    lines.push("  " + "─".repeat(55));

    const sortedRepos = Array.from(repoStats.entries())
      .sort((a, b) => b[1].total - a[1].total);

    for (const [repo, stats] of sortedRepos.slice(0, 15)) {
      const repoShort = repo.padEnd(30);
      const fraction = `${stats.passed} / ${stats.total}`.padStart(14);
      const rate = stats.total > 0 ? (stats.passed / stats.total) * 100 : 0;
      const rateStr = `${rate.toFixed(1)}%`.padStart(5);
      const color = rate >= 50 ? "\x1b[32m" : rate >= 20 ? "\x1b[33m" : "\x1b[31m";
      lines.push(`  ${repoShort}  ${fraction}  ${color}${rateStr}\x1b[0m`);
    }
    lines.push("");
  }

  // Most recent run details
  const latest = uniqueRuns[0];
  if (latest) {
    lines.push(`  \x1b[1mLatest Run: ${latest.run_id}\x1b[0m`);
    lines.push(`  Timestamp: ${latest.timestamp}`);
    lines.push(`  Instances: ${latest.total_instances} (${latest.passed} passed, ${latest.errors} errors)`);
    lines.push(`  Total tokens: ${latest.total_tokens.toLocaleString()}`);
    lines.push(`  Total cost: $${latest.total_cost_usd.toFixed(4)}`);
    if (latest.avg_pdse_score != null) {
      lines.push(`  Avg PDSE: ${latest.avg_pdse_score.toFixed(1)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Helper to format a single run summary (used by /benchmark command).
 */
export function formatRunSummary(run: SWEBenchRun): string {
  const passColor = run.pass_rate >= 0.5 ? "\x1b[32m" : run.pass_rate >= 0.2 ? "\x1b[33m" : "\x1b[31m";
  return [
    `Run: ${run.run_id}`,
    `Pass rate: ${passColor}${(run.pass_rate * 100).toFixed(1)}%\x1b[0m (${run.passed}/${run.total_instances})`,
    `Avg time: ${run.avg_time_seconds.toFixed(1)}s per instance`,
    `Total cost: $${run.total_cost_usd.toFixed(4)}`,
  ].join("  |  ");
}
