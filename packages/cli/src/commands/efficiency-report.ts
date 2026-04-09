// ============================================================================
// @dantecode/cli — /efficiency-report command
//
// Reads .dantecode/cost-history.jsonl and produces a token efficiency report:
//   - Haiku routing savings vs all-Sonnet baseline
//   - Cost per task tier
//   - Token efficiency trend over time
//
// Usage:
//   /efficiency-report [--last N] [--export csv]
// ============================================================================

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { CostHistoryEntry } from "./cost-history.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

// Approximate cost per 1M tokens (Sonnet vs Haiku)
// Sonnet rate used for "projected all-Sonnet" cost comparison
const SONNET_COST_PER_TOKEN = 3.0 / 1_000_000; // $3.00 / 1M input tokens

interface EfficiencyStats {
  totalSessions: number;
  totalCost: number;
  totalInputTokens: number;
  haikuSessions: number;
  haikuCost: number;
  haikuTokens: number;
  sonnetSessions: number;
  sonnetCost: number;
  sonnetTokens: number;
  projectedAllSonnetCost: number;
  savings: number;
  savingsPercent: number;
  avgCostPerSession: number;
  avgCostHaiku: number;
  avgCostSonnet: number;
}

function computeStats(entries: CostHistoryEntry[]): EfficiencyStats {
  let totalCost = 0;
  let totalInputTokens = 0;
  let haikuSessions = 0;
  let haikuCost = 0;
  let haikuTokens = 0;
  let sonnetSessions = 0;
  let sonnetCost = 0;
  let sonnetTokens = 0;

  for (const e of entries) {
    totalCost += e.cost ?? 0;
    totalInputTokens += e.inputTokens ?? 0;

    const isHaiku = e.model?.toLowerCase().includes("haiku") ?? false;
    if (isHaiku) {
      haikuSessions++;
      haikuCost += e.cost ?? 0;
      haikuTokens += e.inputTokens ?? 0;
    } else {
      sonnetSessions++;
      sonnetCost += e.cost ?? 0;
      sonnetTokens += e.inputTokens ?? 0;
    }
  }

  // Project: what would haiku sessions have cost at Sonnet rates?
  const haikuProjectedAtSonnet = haikuTokens * SONNET_COST_PER_TOKEN;
  const projectedAllSonnetCost = sonnetCost + haikuProjectedAtSonnet;
  const savings = projectedAllSonnetCost - totalCost;
  const savingsPercent = projectedAllSonnetCost > 0 ? (savings / projectedAllSonnetCost) * 100 : 0;

  return {
    totalSessions: entries.length,
    totalCost,
    totalInputTokens,
    haikuSessions,
    haikuCost,
    haikuTokens,
    sonnetSessions,
    sonnetCost,
    sonnetTokens,
    projectedAllSonnetCost,
    savings,
    savingsPercent,
    avgCostPerSession: entries.length > 0 ? totalCost / entries.length : 0,
    avgCostHaiku: haikuSessions > 0 ? haikuCost / haikuSessions : 0,
    avgCostSonnet: sonnetSessions > 0 ? sonnetCost / sonnetSessions : 0,
  };
}

function fmt$(n: number): string {
  return `$${n.toFixed(4)}`;
}

export async function runEfficiencyReport(
  args: string,
  projectRoot: string,
): Promise<string> {
  const parts = args.trim().split(/\s+/);
  let lastN = 0;
  let exportCsv = false;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "--last" && parts[i + 1]) {
      lastN = parseInt(parts[i + 1]!, 10);
      i++;
    } else if (parts[i] === "--export" && parts[i + 1] === "csv") {
      exportCsv = true;
      i++;
    }
  }

  const costHistoryPath = join(projectRoot, ".dantecode/cost-history.jsonl");

  if (!existsSync(costHistoryPath)) {
    return [
      `${YELLOW}No cost history found at ${costHistoryPath}${RESET}`,
      "",
      "Token cost data is recorded automatically during agent sessions.",
      "Run a few sessions first, then check back for efficiency insights.",
    ].join("\n");
  }

  let raw: string;
  try {
    raw = await readFile(costHistoryPath, "utf-8");
  } catch (e) {
    return `Failed to read cost history: ${e instanceof Error ? e.message : String(e)}`;
  }

  let entries: CostHistoryEntry[] = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as CostHistoryEntry;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as CostHistoryEntry[];

  if (entries.length === 0) {
    return "Cost history is empty — no sessions recorded yet.";
  }

  if (lastN > 0) {
    entries = entries.slice(-lastN);
  }

  if (exportCsv) {
    const header = "date,sessionId,model,tier,inputTokens,outputTokens,cost,taskSummary";
    const rows = entries.map((e) =>
      [
        e.date,
        e.sessionId,
        e.model,
        e.tier,
        e.inputTokens,
        e.outputTokens,
        e.cost.toFixed(6),
        `"${(e.taskSummary ?? "").replace(/"/g, '""')}"`,
      ].join(","),
    );
    return [header, ...rows].join("\n");
  }

  const stats = computeStats(entries);
  const haikuRoutingRate =
    stats.totalSessions > 0
      ? ((stats.haikuSessions / stats.totalSessions) * 100).toFixed(1)
      : "0.0";

  const lines: string[] = [
    `${BOLD}Token Efficiency Report${RESET}`,
    "─".repeat(60),
    "",
    `${CYAN}Sessions analyzed:${RESET}    ${stats.totalSessions}${lastN > 0 ? ` (last ${lastN})` : ""}`,
    `${CYAN}Total tokens used:${RESET}    ${stats.totalInputTokens.toLocaleString()} input tokens`,
    `${CYAN}Total cost:${RESET}           ${fmt$(stats.totalCost)}`,
    `${CYAN}Avg cost/session:${RESET}     ${fmt$(stats.avgCostPerSession)}`,
    "",
    `${BOLD}Model Routing Breakdown${RESET}`,
    "─".repeat(60),
    `  Haiku sessions:  ${stats.haikuSessions} / ${stats.totalSessions} (${haikuRoutingRate}%)`,
    `  Sonnet sessions: ${stats.sonnetSessions} / ${stats.totalSessions}`,
    "",
  ];

  if (stats.haikuSessions > 0) {
    lines.push(
      `${BOLD}Haiku Routing Savings${RESET}`,
      "─".repeat(60),
      `  Actual cost (haiku routed):    ${fmt$(stats.totalCost)}`,
      `  Projected (all-Sonnet):        ${fmt$(stats.projectedAllSonnetCost)}`,
      `  ${GREEN}Savings:                       ${fmt$(stats.savings)} (${stats.savingsPercent.toFixed(1)}% cheaper)${RESET}`,
      "",
      `  Avg cost/session (Haiku):  ${fmt$(stats.avgCostHaiku)}`,
      `  Avg cost/session (Sonnet): ${fmt$(stats.avgCostSonnet)}`,
    );
  } else {
    lines.push(
      `${DIM}No Haiku-routed sessions found.${RESET}`,
      `${DIM}Haiku routing triggers automatically for small/simple tasks.${RESET}`,
    );
  }

  lines.push("");
  lines.push(
    `${DIM}Note: Savings calculated using $3.00/1M Sonnet vs $0.25/1M Haiku input tokens.${RESET}`,
  );

  return lines.join("\n");
}
