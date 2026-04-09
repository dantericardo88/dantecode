// ============================================================================
// @dantecode/cli — /pdse-report command
// Reads .dantecode/sessions/*.json sorted by date (newest first),
// extracts id, pdseScore, taskDescription, durationMs, cost,
// and prints a formatted table (or CSV with --export csv).
// ============================================================================

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export interface SessionReportRow {
  id: string;
  pdseScore: number | null;
  taskDescription: string;
  durationMs: number | null;
  cost: number | null;
  updatedAt: string;
}

async function readSessionRows(
  sessionsDir: string,
  limit: number,
): Promise<SessionReportRow[]> {
  let files: string[];
  try {
    files = (await readdir(sessionsDir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  // Sort by mtime descending (fastest — avoids reading full JSON for every file)
  const withMtime = await Promise.all(
    files.map(async (file) => {
      try {
        const s = await stat(join(sessionsDir, file));
        return { file, mtime: s.mtimeMs };
      } catch {
        return { file, mtime: 0 };
      }
    }),
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);

  const rows: SessionReportRow[] = [];
  for (const { file } of withMtime.slice(0, limit)) {
    try {
      const raw = await readFile(join(sessionsDir, file), "utf-8");
      const session = JSON.parse(raw) as Record<string, unknown>;

      const id = typeof session["id"] === "string" ? session["id"] : file.replace(".json", "");
      const updatedAt = typeof session["updatedAt"] === "string" ? session["updatedAt"] : "";

      // pdseScore — look in several common locations
      let pdseScore: number | null = null;
      if (typeof session["pdseScore"] === "number") {
        pdseScore = session["pdseScore"];
      } else if (
        session["pdse"] !== null &&
        typeof session["pdse"] === "object" &&
        typeof (session["pdse"] as Record<string, unknown>)["overall"] === "number"
      ) {
        pdseScore = (session["pdse"] as Record<string, unknown>)["overall"] as number;
      } else if (
        session["verificationSummary"] !== null &&
        typeof session["verificationSummary"] === "object" &&
        typeof (session["verificationSummary"] as Record<string, unknown>)["pdseScore"] === "number"
      ) {
        pdseScore = (session["verificationSummary"] as Record<string, unknown>)[
          "pdseScore"
        ] as number;
      }

      // taskDescription — look in title, summary, or first user message
      let taskDescription = "(no description)";
      if (typeof session["title"] === "string" && session["title"].trim()) {
        taskDescription = session["title"].trim();
      } else if (typeof session["summary"] === "string" && session["summary"].trim()) {
        taskDescription = session["summary"].trim().slice(0, 80);
      } else if (Array.isArray(session["messages"])) {
        const firstUser = (session["messages"] as Array<Record<string, unknown>>).find(
          (m) => m["role"] === "user",
        );
        if (firstUser && typeof firstUser["content"] === "string") {
          taskDescription = firstUser["content"].slice(0, 80).replace(/\n/g, " ");
        }
      }

      // durationMs
      let durationMs: number | null = null;
      if (typeof session["durationMs"] === "number") {
        durationMs = session["durationMs"];
      }

      // cost
      let cost: number | null = null;
      if (typeof session["totalCostUsd"] === "number") {
        cost = session["totalCostUsd"];
      } else if (typeof session["costUsd"] === "number") {
        cost = session["costUsd"];
      }

      rows.push({ id, pdseScore, taskDescription, durationMs, cost, updatedAt });
    } catch {
      // Skip unparseable files
    }
  }

  return rows;
}

function pdseColor(score: number | null): string {
  if (score === null) return DIM;
  if (score >= 85) return GREEN;
  if (score >= 70) return YELLOW;
  return RED;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatCost(cost: number | null): string {
  if (cost === null) return "-";
  return `$${cost.toFixed(4)}`;
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 1) + "…" : str;
}

function formatTableRow(row: SessionReportRow): string {
  const score = row.pdseScore !== null ? `${row.pdseScore.toFixed(0)}` : "-";
  const color = pdseColor(row.pdseScore);
  const id = row.id.slice(0, 12);
  const task = truncate(row.taskDescription, 42);
  const dur = formatDuration(row.durationMs);
  const cost = formatCost(row.cost);

  return (
    `  ${DIM}${id}${RESET}  ` +
    `${color}${score.padStart(3)}${RESET}  ` +
    `${truncate(task, 42).padEnd(43)}  ` +
    `${dur.padStart(8)}  ` +
    `${cost.padStart(9)}`
  );
}

function formatCsvRow(row: SessionReportRow): string {
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return [
    escape(row.id),
    row.pdseScore !== null ? row.pdseScore.toFixed(1) : "",
    escape(row.taskDescription),
    row.durationMs !== null ? String(row.durationMs) : "",
    row.cost !== null ? row.cost.toFixed(6) : "",
    escape(row.updatedAt),
  ].join(",");
}

export async function pdseReportCommand(args: string[], projectRoot: string): Promise<void> {
  const argStr = args.join(" ");

  // Parse --last N
  const lastMatch = /--last\s+(\d+)/.exec(argStr);
  const limit = lastMatch ? parseInt(lastMatch[1]!, 10) : 10;

  // Parse --export csv
  const exportCsv = /--export\s+csv/i.test(argStr);

  const sessionsDir = join(projectRoot, ".dantecode", "sessions");
  const rows = await readSessionRows(sessionsDir, Math.max(1, limit));

  if (rows.length === 0) {
    process.stdout.write(
      `${YELLOW}No session history found. Run a task first.${RESET}\n`,
    );
    return;
  }

  if (exportCsv) {
    const header = "id,pdseScore,taskDescription,durationMs,cost,updatedAt";
    const lines = [header, ...rows.map(formatCsvRow)];
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }

  // Table header
  const header =
    `  ${"ID".padEnd(12)}  ` +
    `${"PDSE".padStart(4)}  ` +
    `${"Task".padEnd(43)}  ` +
    `${"Duration".padStart(8)}  ` +
    `${"Cost".padStart(9)}`;

  const separator = "─".repeat(header.length);

  process.stdout.write(
    `\n${BOLD}${CYAN}PDSE Session Report${RESET}${DIM} (last ${rows.length} session${rows.length === 1 ? "" : "s"})${RESET}\n`,
  );
  process.stdout.write(`${DIM}${separator}${RESET}\n`);
  process.stdout.write(`${DIM}${header}${RESET}\n`);
  process.stdout.write(`${DIM}${separator}${RESET}\n`);

  for (const row of rows) {
    process.stdout.write(formatTableRow(row) + "\n");
  }

  process.stdout.write(`${DIM}${separator}${RESET}\n`);

  // Summary stats
  const scored = rows.filter((r) => r.pdseScore !== null);
  if (scored.length > 0) {
    const avg =
      scored.reduce((sum, r) => sum + (r.pdseScore ?? 0), 0) / scored.length;
    const passing = scored.filter((r) => (r.pdseScore ?? 0) >= 85).length;
    process.stdout.write(
      `${DIM}Avg PDSE: ${pdseColor(avg)}${avg.toFixed(1)}${RESET}${DIM}  |  ` +
        `${GREEN}${passing}${RESET}${DIM}/${scored.length} passing (≥85)${RESET}\n\n`,
    );
  }
}
