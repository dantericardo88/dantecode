// ============================================================================
// @dantecode/cli — /cost-history command
//
// Reads .dantecode/cost-history.jsonl and prints aggregated statistics.
//
// Subcommands:
//   (no args)       — summary: Sessions N | Total $X | Avg $Y | Haiku %Z
//   --last N        — show last N sessions as a table
//   --export csv    — emit all sessions as CSV to stdout
// ============================================================================

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostHistoryEntry {
  date: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model: string;
  tier: string;
  taskSummary: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ANSI_RESET = "\x1b[0m";
const ANSI_DIM = "\x1b[2m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_GREEN = "\x1b[32m";

/** Formats a dollar amount to 3 decimal places */
function fmt$(v: number): string {
  return `$${v.toFixed(3)}`;
}

/** Reads and parses .dantecode/cost-history.jsonl */
async function loadHistory(projectRoot: string): Promise<CostHistoryEntry[]> {
  const filePath = join(projectRoot, ".dantecode", "cost-history.jsonl");
  if (!existsSync(filePath)) {
    return [];
  }
  const raw = await readFile(filePath, "utf-8");
  const entries: CostHistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as CostHistoryEntry;
      entries.push(entry);
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

/** Render a summary line */
function renderSummary(entries: CostHistoryEntry[]): string {
  if (entries.length === 0) {
    return `${ANSI_DIM}No cost history recorded yet. Start a session to begin tracking.${ANSI_RESET}`;
  }

  const total = entries.reduce((s, e) => s + (e.cost ?? 0), 0);
  const avg = total / entries.length;

  // Count Haiku (cheap tier) usage
  const haikuCount = entries.filter(
    (e) => e.model?.toLowerCase().includes("haiku") || e.tier?.toLowerCase() === "low",
  ).length;

  const haikuPct = Math.round((haikuCount / entries.length) * 100);

  return [
    `${ANSI_BOLD}Cost History${ANSI_RESET}`,
    `  Sessions: ${ANSI_CYAN}${entries.length}${ANSI_RESET}` +
      `  |  Total: ${ANSI_GREEN}${fmt$(total)}${ANSI_RESET}` +
      `  |  Avg: ${ANSI_YELLOW}${fmt$(avg)}${ANSI_RESET}` +
      `  |  Haiku routed: ${ANSI_DIM}${haikuCount}/${entries.length} (${haikuPct}%)${ANSI_RESET}`,
  ].join("\n");
}

/** Render a table for the last N sessions */
function renderTable(entries: CostHistoryEntry[], n: number): string {
  const slice = entries.slice(-n);
  if (slice.length === 0) {
    return `${ANSI_DIM}No sessions to display.${ANSI_RESET}`;
  }

  const COL_DATE = 10;
  const COL_ID = 12;
  const COL_MODEL = 14;
  const COL_TIER = 8;
  const COL_IN = 8;
  const COL_OUT = 8;
  const COL_COST = 8;
  const COL_SUMMARY = 36;

  function pad(s: string, len: number): string {
    return s.length >= len ? s.slice(0, len - 1) + "…" : s.padEnd(len);
  }

  const header =
    `${ANSI_BOLD}` +
    pad("Date", COL_DATE) +
    pad("Session", COL_ID) +
    pad("Model", COL_MODEL) +
    pad("Tier", COL_TIER) +
    pad("In Tok", COL_IN) +
    pad("Out Tok", COL_OUT) +
    pad("Cost", COL_COST) +
    pad("Task", COL_SUMMARY) +
    ANSI_RESET;

  const sep = "-".repeat(
    COL_DATE + COL_ID + COL_MODEL + COL_TIER + COL_IN + COL_OUT + COL_COST + COL_SUMMARY,
  );

  const rows = slice.map((e) => {
    const shortId = (e.sessionId ?? "").slice(0, COL_ID - 1);
    return (
      pad(e.date ?? "", COL_DATE) +
      pad(shortId, COL_ID) +
      pad(e.model ?? "", COL_MODEL) +
      pad(e.tier ?? "", COL_TIER) +
      pad(String(e.inputTokens ?? 0), COL_IN) +
      pad(String(e.outputTokens ?? 0), COL_OUT) +
      pad(fmt$(e.cost ?? 0), COL_COST) +
      pad(e.taskSummary ?? "", COL_SUMMARY)
    );
  });

  return [header, sep, ...rows].join("\n");
}

/** Render CSV output */
function renderCsv(entries: CostHistoryEntry[]): string {
  const header = "date,sessionId,inputTokens,outputTokens,cost,model,tier,taskSummary";
  const rows = entries.map((e) => {
    const safe = (s: string | number | undefined) =>
      `"${String(s ?? "").replace(/"/g, '""')}"`;
    return [
      safe(e.date),
      safe(e.sessionId),
      safe(e.inputTokens),
      safe(e.outputTokens),
      safe(e.cost),
      safe(e.model),
      safe(e.tier),
      safe(e.taskSummary),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * Main cost-history command handler.
 *
 * @param args - Arguments string (e.g. "--last 10" or "--export csv")
 * @param projectRoot - Absolute path to the project root
 */
export async function costHistoryCommand(args: string, projectRoot: string): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const entries = await loadHistory(projectRoot);

  // --export csv
  if (parts.includes("--export") && parts[parts.indexOf("--export") + 1] === "csv") {
    return renderCsv(entries);
  }

  // --last N
  const lastIdx = parts.indexOf("--last");
  if (lastIdx !== -1) {
    const n = parseInt(parts[lastIdx + 1] ?? "10", 10);
    const count = isNaN(n) || n <= 0 ? 10 : n;
    const table = renderTable(entries, count);
    return `${renderSummary(entries)}\n\n${table}`;
  }

  // Default: summary
  return renderSummary(entries);
}
