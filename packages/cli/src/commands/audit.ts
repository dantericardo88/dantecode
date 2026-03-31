/**
 * audit.ts
 *
 * CLI command: dantecode audit <subcommand>
 *
 * Subcommands:
 *   export <format> <outputPath> [--session <id>]
 *     Export audit trail in specified format (json|ndjson|markdown|csv|sarif)
 */

import { ExportEngine } from "@dantecode/debug-trail";
import type { ExportFormat } from "@dantecode/debug-trail";
import { logger } from "@dantecode/core";

// ────────────────────────────────────────────────────────
// ANSI helpers
// ────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ────────────────────────────────────────────────────────
// Sub-command: export
// ────────────────────────────────────────────────────────

async function cmdExport(args: string[]): Promise<void> {
  const validFormats: ExportFormat[] = ["json", "ndjson", "markdown", "csv", "sarif"];

  // Parse positional args: export <format> <outputPath> [--session <id>]
  let sessionId: string | undefined;

  const positionals: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === "--session" || arg === "-s") {
      sessionId = args[i + 1];
      i += 2;
      continue;
    }
    positionals.push(arg);
    i += 1;
  }

  const format = positionals[0];
  const outputPath = positionals[1];

  if (!format) {
    logger.error({ command: "audit export", validFormats }, "Missing format parameter");
    console.error(
      `${YELLOW}Usage: dantecode audit export <format> <outputPath> [--session <id>]${RESET}`,
    );
    console.error(`Valid formats: ${validFormats.join(", ")}`);
    process.exit(1);
  }

  if (!validFormats.includes(format as ExportFormat)) {
    logger.error({ command: "audit export", format, validFormats }, "Invalid format specified");
    console.error(`${YELLOW}Invalid format "${format}". Valid: ${validFormats.join(", ")}${RESET}`);
    process.exit(1);
  }

  if (!sessionId) {
    logger.error({ command: "audit export" }, "Missing session ID parameter");
    console.error(`${YELLOW}--session <id> is required${RESET}`);
    process.exit(1);
  }

  const engine = new ExportEngine();

  const result = await engine.exportSession(sessionId, {
    format: format as ExportFormat,
    outputPath,
    includeCompleteness: true,
  });

  logger.info(
    {
      command: "audit export",
      sessionId,
      format,
      path: result.path,
      eventCount: result.eventCount,
      completenessScore: result.completenessScore,
    },
    "Audit export completed successfully",
  );

  console.log(`\n${BOLD}Audit Export Complete${RESET}`);
  console.log(`  ${GREEN}Exported to:${RESET} ${CYAN}${result.path}${RESET}`);
  console.log(`  ${DIM}Events:${RESET}      ${result.eventCount}`);
  if (result.completenessScore !== undefined) {
    const pct = (result.completenessScore * 100).toFixed(0);
    console.log(`  ${DIM}Completeness:${RESET} ${pct}%`);
  }
}

// ────────────────────────────────────────────────────────
// Help
// ────────────────────────────────────────────────────────

function printAuditHelp(): void {
  console.log(`
${BOLD}dantecode audit${RESET} — Audit trail export and forensic operations

${BOLD}Usage:${RESET}
  dantecode audit <subcommand> [options]

${BOLD}Subcommands:${RESET}
  ${CYAN}export <format> <outputPath> --session <id>${RESET}
    Export audit trail for a session in the specified format.

${BOLD}Formats:${RESET}
  ${CYAN}json${RESET}       Full JSON document with completeness metadata
  ${CYAN}ndjson${RESET}     Newline-delimited JSON (one event per line)
  ${CYAN}markdown${RESET}   Human-readable forensic report
  ${CYAN}csv${RESET}        CSV with columns: timestamp,kind,actor,summary,filePath,outcome
  ${CYAN}sarif${RESET}      SARIF 2.1.0 — compatible with GitHub Code Scanning, VS Code SARIF viewer

${BOLD}Examples:${RESET}
  dantecode audit export sarif ./report.sarif --session sess_abc123
  dantecode audit export csv ./trail.csv --session sess_abc123
  dantecode audit export markdown ./report.md --session sess_abc123
`);
}

// ────────────────────────────────────────────────────────
// Main router
// ────────────────────────────────────────────────────────

/**
 * Entry point for `dantecode audit <subcommand> [args]`.
 */
export async function runAuditCommand(args: string[], _projectRoot: string): Promise<void> {
  const sub = args[0]?.toLowerCase();
  const rest = args.slice(1);

  switch (sub) {
    case "export":
      await cmdExport(rest);
      return;
    default:
      printAuditHelp();
      return;
  }
}
