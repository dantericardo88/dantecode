// ============================================================================
// packages/cli/src/cost-tracker.ts
//
// Cost tracking, persistence, and formatting for the DanteCode CLI.
//
// Design:
//   - PROVIDER_RATES mirrors model-router.ts constants (kept in sync manually)
//   - JSONL persistence: crash-safe append-only writes to cost-history.jsonl
//   - formatInlineCost: per-round dim suffix shown after each LLM response
//   - formatCostDashboard: full /cost command output with history + budget bar
//   - Zero circular deps — no imports from agent-loop or slash-commands
// ============================================================================

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CostEstimate } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Provider Rate Table
// Mirrors the constants in packages/core/src/model-router.ts.
// ----------------------------------------------------------------------------

export const PROVIDER_RATES: Record<
  string,
  { label: string; inputPerMTok: number; outputPerMTok: number }
> = {
  grok: { label: "Grok (fast)", inputPerMTok: 0.3, outputPerMTok: 0.6 },
  grok_capable: { label: "Grok (capable)", inputPerMTok: 3.0, outputPerMTok: 6.0 },
  anthropic: { label: "Anthropic", inputPerMTok: 3.0, outputPerMTok: 15.0 },
  openai: { label: "OpenAI", inputPerMTok: 2.5, outputPerMTok: 10.0 },
  google: { label: "Google", inputPerMTok: 1.25, outputPerMTok: 5.0 },
  groq: { label: "Groq", inputPerMTok: 0.05, outputPerMTok: 0.1 },
  ollama: { label: "Ollama (local)", inputPerMTok: 0.0, outputPerMTok: 0.0 },
};

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface SessionCostRecord {
  sessionId: string;
  timestamp: string;
  provider: string;
  totalCostUsd: number;
  totalTokens: number;
  requestCount: number;
  projectRoot: string;
}

// ----------------------------------------------------------------------------
// Formatting
// ----------------------------------------------------------------------------

/**
 * Format a per-round inline cost suffix.
 * Returns an empty string for zero-cost providers (Ollama/local) — silence is
 * better than showing `[$0.00 | session: $0.00]` on every round.
 */
export function formatInlineCost(lastRequestUsd: number, sessionTotalUsd: number): string {
  if (lastRequestUsd <= 0) return "";
  const req = lastRequestUsd < 0.001
    ? `$${lastRequestUsd.toFixed(6)}`
    : `$${lastRequestUsd.toFixed(4)}`;
  const sess = sessionTotalUsd < 0.001
    ? `$${sessionTotalUsd.toFixed(6)}`
    : `$${sessionTotalUsd.toFixed(4)}`;
  return `[${req} | session: ${sess}]`;
}

/**
 * Format a budget progress bar.
 * Returns colored bar: green <50%, yellow 50-80%, red >80%.
 */
function formatBudgetBar(used: number, limit: number): string {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const color = pct >= 80 ? "\x1b[31m" : pct >= 50 ? "\x1b[33m" : "\x1b[32m";
  const reset = "\x1b[0m";
  return `${color}${bar}${reset}  ${pct}%`;
}

/**
 * Format the full /cost dashboard as a plain-text string.
 */
export function formatCostDashboard(
  estimate: CostEstimate,
  provider: string,
  history: SessionCostRecord[],
  budgetSessionUsd?: number,
): string {
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";
  const YELLOW = "\x1b[33m";
  const RESET = "\x1b[0m";

  const lines: string[] = [];
  lines.push(`${BOLD}Cost Dashboard${RESET} — ${provider}`);
  lines.push("");

  // Current session
  const req = estimate.lastRequestUsd > 0
    ? `$${estimate.lastRequestUsd.toFixed(4)}`
    : "(no requests yet)";
  const sess = estimate.sessionTotalUsd > 0
    ? `$${estimate.sessionTotalUsd.toFixed(4)}`
    : "$0.0000";
  const tokens = estimate.tokensUsedSession > 0
    ? `${estimate.tokensUsedSession.toLocaleString()} tokens`
    : "—";

  lines.push(`  Last request:   ${req}`);
  lines.push(`  Session total:  ${sess}  (${tokens})`);

  // Budget bar
  if (budgetSessionUsd !== undefined && budgetSessionUsd > 0) {
    lines.push("");
    const bar = formatBudgetBar(estimate.sessionTotalUsd, budgetSessionUsd);
    lines.push(`  Budget:   ${bar}  ($${estimate.sessionTotalUsd.toFixed(4)} of $${budgetSessionUsd.toFixed(2)})`);
    const pct = (estimate.sessionTotalUsd / budgetSessionUsd) * 100;
    if (pct >= 80) {
      lines.push(`            ${YELLOW}⚠  Warning: ${Math.round(pct)}% of session budget consumed${RESET}`);
    }
  } else {
    lines.push(`  ${DIM}(no session budget configured — set budget.sessionMaxUsd in config)${RESET}`);
  }

  // Recent sessions
  lines.push("");
  lines.push("  Recent sessions (last 5):");
  const recent = history.slice(-5).reverse();
  if (recent.length === 0) {
    lines.push(`    ${DIM}(no session history yet)${RESET}`);
  } else {
    for (const rec of recent) {
      const date = rec.timestamp.slice(0, 10);
      const cost = `$${rec.totalCostUsd.toFixed(4)}`;
      const toks = rec.totalTokens >= 1000
        ? `${(rec.totalTokens / 1000).toFixed(0)}K tokens`
        : `${rec.totalTokens} tokens`;
      lines.push(`    ${date}  ${cost.padEnd(10)} ${toks.padEnd(12)} ${rec.provider}`);
    }
    const totalSpend = recent.reduce((s, r) => s + r.totalCostUsd, 0);
    lines.push(`    ${"─".repeat(45)}`);
    lines.push(`    Total (${recent.length} sessions):  $${totalSpend.toFixed(4)}`);
  }

  // Quick rate preview
  lines.push("");
  lines.push("  Provider rates  ${DIM}(/cost rates for full table)${RESET}:");
  lines.push(`    Groq        $0.05/$0.10   per 1M — cheapest`);
  lines.push(`    Grok fast   $0.30/$0.60   per 1M`);
  lines.push(`    Google      $1.25/$5.00   per 1M`);
  lines.push(`    OpenAI      $2.50/$10.00  per 1M`);
  lines.push(`    Anthropic   $3.00/$15.00  per 1M`);
  lines.push(`    Ollama      free (local)`);

  return lines.join("\n");
}

/**
 * Format the full provider rate comparison table.
 */
export function formatRateTable(): string {
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";

  // Sample 10K token task (7K input + 3K output)
  const sampleInput = 7000;
  const sampleOutput = 3000;

  const lines: string[] = [];
  lines.push(`${BOLD}Provider Rate Table${RESET}  (per 1M tokens)`);
  lines.push("");
  lines.push(
    `  ${"Provider".padEnd(16)} ${"Input".padEnd(10)} ${"Output".padEnd(12)} Sample 10K task`,
  );
  lines.push(`  ${"─".repeat(52)}`);

  const entries: Array<{ key: string; label: string; inputPerMTok: number; outputPerMTok: number }> = [
    { key: "groq", ...PROVIDER_RATES["groq"]! },
    { key: "grok", ...PROVIDER_RATES["grok"]! },
    { key: "grok_capable", ...PROVIDER_RATES["grok_capable"]! },
    { key: "google", ...PROVIDER_RATES["google"]! },
    { key: "openai", ...PROVIDER_RATES["openai"]! },
    { key: "anthropic", ...PROVIDER_RATES["anthropic"]! },
    { key: "ollama", ...PROVIDER_RATES["ollama"]! },
  ];

  for (const e of entries) {
    const inRate =
      e.inputPerMTok === 0 ? "free" : `$${e.inputPerMTok.toFixed(2)}`;
    const outRate =
      e.outputPerMTok === 0 ? "free" : `$${e.outputPerMTok.toFixed(2)}`;
    const sampleCost =
      e.inputPerMTok === 0
        ? `${DIM}$0.000${RESET}`
        : `~$${(
            (sampleInput * e.inputPerMTok + sampleOutput * e.outputPerMTok) /
            1_000_000
          ).toFixed(4)}`;
    lines.push(
      `  ${e.label.padEnd(16)} ${inRate.padEnd(10)} ${outRate.padEnd(12)} ${sampleCost}`,
    );
  }

  lines.push("");
  lines.push(`  ${DIM}Sample task = 7K input tokens + 3K output tokens${RESET}`);

  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------------

const COST_HISTORY_FILE = ".dantecode/cost-history.jsonl";

/**
 * Append one session cost record to .dantecode/cost-history.jsonl.
 * Uses JSONL format (one JSON object per line) for crash-safe atomic appends.
 */
export async function appendSessionCost(record: SessionCostRecord): Promise<void> {
  const dir = join(record.projectRoot, ".dantecode");
  await mkdir(dir, { recursive: true });
  const filePath = join(record.projectRoot, COST_HISTORY_FILE);
  await appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
}

/**
 * Load all session cost records from .dantecode/cost-history.jsonl.
 * Silently skips corrupt/unparseable lines.
 * Returns empty array when file does not exist.
 */
export async function loadCostHistory(projectRoot: string): Promise<SessionCostRecord[]> {
  const filePath = join(projectRoot, COST_HISTORY_FILE);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const records: SessionCostRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as SessionCostRecord);
    } catch {
      // Corrupt line — skip silently
    }
  }
  return records;
}
