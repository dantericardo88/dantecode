/**
 * trace.ts - Trace visualization and inspection commands
 *
 * Commands:
 * - dantecode trace list              - List all traces
 * - dantecode trace show <traceId>    - Show trace details
 * - dantecode trace tree <traceId>    - Show trace as tree
 * - dantecode trace stats             - Show trace statistics
 * - dantecode trace clean [--days=7]  - Clean old traces
 */

import { readdir, readFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import type { TraceSummary } from "@dantecode/core";

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

interface TraceListOptions {
  limit?: number;
  status?: "pending" | "success" | "error";
}

interface TraceTreeOptions {
  depth?: number;
  showEvents?: boolean;
  showDecisions?: boolean;
}

/**
 * List all traces
 */
export async function cmdTraceList(
  projectRoot: string,
  options: TraceListOptions = {},
): Promise<void> {
  const traceDir = join(projectRoot, ".dantecode", "traces");

  try {
    const files = await readdir(traceDir);
    const traceFiles = files.filter((f) => f.endsWith(".json"));

    if (traceFiles.length === 0) {
      console.log(`${DIM}No traces found in ${traceDir}${RESET}`);
      return;
    }

    const traces: Array<{ file: string; summary: TraceSummary; mtime: number }> = [];

    for (const file of traceFiles) {
      const filePath = join(traceDir, file);
      const content = await readFile(filePath, "utf-8");
      const summary = JSON.parse(content) as TraceSummary;
      const stats = await stat(filePath);
      traces.push({ file, summary, mtime: stats.mtimeMs });
    }

    // Filter by status if provided
    let filtered = traces;
    if (options.status) {
      filtered = traces.filter((t) => t.summary.status === options.status);
    }

    // Sort by modification time (newest first)
    filtered.sort((a, b) => b.mtime - a.mtime);

    // Limit results
    const limit = options.limit ?? 20;
    const displayed = filtered.slice(0, limit);

    console.log(`\n${BOLD}Traces (${displayed.length}/${filtered.length} shown)${RESET}\n`);

    for (const { summary } of displayed) {
      const statusColor =
        summary.status === "success" ? GREEN : summary.status === "error" ? RED : YELLOW;
      const duration = summary.durationMs ? `${summary.durationMs}ms` : "in progress";

      console.log(
        `${CYAN}${summary.traceId.slice(0, 8)}${RESET} ${statusColor}${summary.status}${RESET} ${DIM}${duration}${RESET}`,
      );
      console.log(
        `  Spans: ${summary.totalSpans} | Events: ${summary.totalEvents} | Decisions: ${summary.totalDecisions}`,
      );
      console.log(`  Started: ${new Date(summary.startTime).toLocaleString()}`);
      console.log();
    }

    if (filtered.length > limit) {
      console.log(
        `${DIM}... and ${filtered.length - limit} more. Use --limit to see more.${RESET}\n`,
      );
    }
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log(`${DIM}No traces directory found at ${traceDir}${RESET}`);
    } else {
      console.error(`${RED}Error reading traces: ${error.message}${RESET}`);
    }
  }
}

/**
 * Show trace details
 */
export async function cmdTraceShow(projectRoot: string, traceId: string): Promise<void> {
  const traceDir = join(projectRoot, ".dantecode", "traces");
  const traceFile = join(traceDir, `${traceId}.json`);

  try {
    const content = await readFile(traceFile, "utf-8");
    const summary = JSON.parse(content) as TraceSummary;

    console.log(`\n${BOLD}Trace: ${summary.traceId}${RESET}\n`);
    console.log(
      `Status: ${summary.status === "success" ? GREEN : summary.status === "error" ? RED : YELLOW}${summary.status}${RESET}`,
    );
    console.log(`Duration: ${summary.durationMs ?? "in progress"}ms`);
    console.log(`Started: ${new Date(summary.startTime).toLocaleString()}`);
    if (summary.endTime) {
      console.log(`Ended: ${new Date(summary.endTime).toLocaleString()}`);
    }
    console.log();

    console.log(`${BOLD}Summary:${RESET}`);
    console.log(`  Total Spans: ${summary.totalSpans}`);
    console.log(`  Total Events: ${summary.totalEvents}`);
    console.log(`  Total Decisions: ${summary.totalDecisions}`);
    console.log();

    if (summary.events.length > 0) {
      console.log(`${BOLD}Recent Events:${RESET}`);
      const recentEvents = summary.events.slice(-5);
      for (const event of recentEvents) {
        const levelColor = event.level === "error" ? RED : event.level === "info" ? CYAN : DIM;
        console.log(
          `  ${levelColor}[${event.level}]${RESET} ${event.message} ${DIM}(${new Date(event.timestamp).toLocaleTimeString()})${RESET}`,
        );
      }
      console.log();
    }

    if (summary.decisions.length > 0) {
      console.log(`${BOLD}Decisions:${RESET}`);
      for (const decision of summary.decisions) {
        const confidence =
          decision.confidence !== undefined ? ` (${(decision.confidence * 100).toFixed(0)}%)` : "";
        console.log(
          `  ${CYAN}${decision.point}${RESET}: ${GREEN}${decision.selected}${RESET}${confidence}`,
        );
        console.log(`    Reason: ${DIM}${decision.reason}${RESET}`);
      }
      console.log();
    }
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.error(`${RED}Trace not found: ${traceId}${RESET}`);
      console.log(`${DIM}Use 'dantecode trace list' to see available traces${RESET}`);
    } else {
      console.error(`${RED}Error reading trace: ${error.message}${RESET}`);
    }
  }
}

/**
 * Show trace as tree
 */
export async function cmdTraceTree(
  projectRoot: string,
  traceId: string,
  options: TraceTreeOptions = {},
): Promise<void> {
  const traceDir = join(projectRoot, ".dantecode", "traces");
  const traceFile = join(traceDir, `${traceId}.json`);

  try {
    const content = await readFile(traceFile, "utf-8");
    const summary = JSON.parse(content) as TraceSummary;

    console.log(`\n${BOLD}Trace Tree: ${summary.traceId.slice(0, 8)}${RESET}\n`);

    // Build tree structure
    const spanMap = new Map(summary.spans.map((s) => [s.spanId, s]));
    const rootSpans = summary.spans.filter((s) => !s.parentSpanId);

    function printSpan(spanId: string, indent: string, isLast: boolean): void {
      const span = spanMap.get(spanId);
      if (!span) return;

      const prefix = indent + (isLast ? "└── " : "├── ");
      const statusColor =
        span.status === "success" ? GREEN : span.status === "error" ? RED : YELLOW;
      const duration = span.durationMs !== undefined ? ` ${DIM}(${span.durationMs}ms)${RESET}` : "";

      console.log(
        `${prefix}${CYAN}${span.name}${RESET} ${statusColor}${span.status}${RESET}${duration}`,
      );

      // Show events if requested
      if (options.showEvents) {
        const spanEvents = summary.events.filter((e) => e.spanId === spanId);
        for (const event of spanEvents) {
          const eventIndent = indent + (isLast ? "    " : "│   ");
          console.log(`${eventIndent}${DIM}• ${event.message}${RESET}`);
        }
      }

      // Show decisions if requested
      if (options.showDecisions) {
        const spanDecisions = summary.decisions.filter((d) => d.spanId === spanId);
        for (const decision of spanDecisions) {
          const decisionIndent = indent + (isLast ? "    " : "│   ");
          console.log(
            `${decisionIndent}${YELLOW}⚡ ${decision.point}: ${decision.selected}${RESET}`,
          );
        }
      }

      // Recurse to children
      const children = summary.spans.filter((s) => s.parentSpanId === spanId);
      const maxDepth = options.depth ?? Infinity;
      const currentDepth = indent.length / 4;

      if (children.length > 0 && currentDepth < maxDepth) {
        const childIndent = indent + (isLast ? "    " : "│   ");
        children.forEach((child, index) => {
          printSpan(child.spanId, childIndent, index === children.length - 1);
        });
      } else if (children.length > 0 && currentDepth >= maxDepth) {
        const childIndent = indent + (isLast ? "    " : "│   ");
        console.log(`${childIndent}${DIM}... ${children.length} more spans${RESET}`);
      }
    }

    rootSpans.forEach((span, index) => {
      printSpan(span.spanId, "", index === rootSpans.length - 1);
    });

    console.log();
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.error(`${RED}Trace not found: ${traceId}${RESET}`);
    } else {
      console.error(`${RED}Error reading trace: ${error.message}${RESET}`);
    }
  }
}

/**
 * Show trace statistics
 */
export async function cmdTraceStats(projectRoot: string): Promise<void> {
  const traceDir = join(projectRoot, ".dantecode", "traces");

  try {
    const files = await readdir(traceDir);
    const traceFiles = files.filter((f) => f.endsWith(".json"));

    if (traceFiles.length === 0) {
      console.log(`${DIM}No traces found${RESET}`);
      return;
    }

    let totalTraces = 0;
    let successTraces = 0;
    let errorTraces = 0;
    let pendingTraces = 0;
    let totalSpans = 0;
    let totalEvents = 0;
    let totalDecisions = 0;
    let totalDuration = 0;

    for (const file of traceFiles) {
      const filePath = join(traceDir, file);
      const content = await readFile(filePath, "utf-8");
      const summary = JSON.parse(content) as TraceSummary;

      totalTraces++;
      if (summary.status === "success") successTraces++;
      else if (summary.status === "error") errorTraces++;
      else pendingTraces++;

      totalSpans += summary.totalSpans;
      totalEvents += summary.totalEvents;
      totalDecisions += summary.totalDecisions;
      if (summary.durationMs) totalDuration += summary.durationMs;
    }

    console.log(`\n${BOLD}Trace Statistics${RESET}\n`);
    console.log(`Total Traces: ${totalTraces}`);
    console.log(`  ${GREEN}Success: ${successTraces}${RESET}`);
    console.log(`  ${RED}Error: ${errorTraces}${RESET}`);
    console.log(`  ${YELLOW}Pending: ${pendingTraces}${RESET}`);
    console.log();
    console.log(`Total Spans: ${totalSpans}`);
    console.log(`Total Events: ${totalEvents}`);
    console.log(`Total Decisions: ${totalDecisions}`);
    console.log();
    console.log(`Average Duration: ${(totalDuration / totalTraces).toFixed(0)}ms`);
    console.log(`Average Spans per Trace: ${(totalSpans / totalTraces).toFixed(1)}`);
    console.log(`Average Events per Trace: ${(totalEvents / totalTraces).toFixed(1)}`);
    console.log(`Average Decisions per Trace: ${(totalDecisions / totalTraces).toFixed(1)}`);
    console.log();
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log(`${DIM}No traces directory found${RESET}`);
    } else {
      console.error(`${RED}Error reading traces: ${error.message}${RESET}`);
    }
  }
}

/**
 * Clean old traces
 */
export async function cmdTraceClean(projectRoot: string, daysOld: number = 7): Promise<void> {
  const traceDir = join(projectRoot, ".dantecode", "traces");
  const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;

  try {
    const files = await readdir(traceDir);
    const traceFiles = files.filter((f) => f.endsWith(".json"));

    let removed = 0;

    for (const file of traceFiles) {
      const filePath = join(traceDir, file);
      const stats = await stat(filePath);

      if (stats.mtimeMs < cutoffTime) {
        await rm(filePath);
        removed++;
      }
    }

    console.log(`${GREEN}Removed ${removed} trace(s) older than ${daysOld} days${RESET}`);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log(`${DIM}No traces directory found${RESET}`);
    } else {
      console.error(`${RED}Error cleaning traces: ${error.message}${RESET}`);
    }
  }
}
