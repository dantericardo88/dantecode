// ============================================================================
// @dantecode/core — Plugin Outcome Tracker (Sprint AH — dim 22)
// Records skill/plugin command invocations with success/failure/duration,
// providing outcome evidence for the plugin ecosystem.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type PluginOutcomeStatus = "success" | "failure" | "skipped" | "timeout";

export interface PluginOutcomeEntry {
  timestamp: string;
  pluginId: string;
  commandId: string;
  status: PluginOutcomeStatus;
  durationMs: number;
  exitCode?: number;
  errorMessage?: string;
  outputLines?: number;
}

export interface PluginOutcomeSummary {
  totalInvocations: number;
  successCount: number;
  successRate: number;
  avgDurationMs: number;
  topCommands: string[];
  failingCommands: string[];
}

const OUTCOMES_FILE = ".danteforge/plugin-outcomes.json";

export function recordPluginOutcome(
  entry: Omit<PluginOutcomeEntry, "timestamp">,
  projectRoot?: string,
): void {
  const root = projectRoot ?? resolve(process.cwd());
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    const record: PluginOutcomeEntry = { timestamp: new Date().toISOString(), ...entry };
    appendFileSync(join(root, OUTCOMES_FILE), JSON.stringify(record) + "\n", "utf-8");
  } catch {
    // non-fatal
  }
}

export function loadPluginOutcomes(projectRoot?: string): PluginOutcomeEntry[] {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, OUTCOMES_FILE);
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as PluginOutcomeEntry);
  } catch {
    return [];
  }
}

export function summarizePluginOutcomes(entries: PluginOutcomeEntry[]): PluginOutcomeSummary {
  if (entries.length === 0) {
    return { totalInvocations: 0, successCount: 0, successRate: 0, avgDurationMs: 0, topCommands: [], failingCommands: [] };
  }

  const successCount = entries.filter((e) => e.status === "success").length;
  const successRate = successCount / entries.length;
  const avgDurationMs = entries.reduce((s, e) => s + e.durationMs, 0) / entries.length;

  // Count commands by frequency
  const commandCounts: Record<string, number> = {};
  const commandFailures: Record<string, number> = {};
  for (const entry of entries) {
    commandCounts[entry.commandId] = (commandCounts[entry.commandId] ?? 0) + 1;
    if (entry.status === "failure") {
      commandFailures[entry.commandId] = (commandFailures[entry.commandId] ?? 0) + 1;
    }
  }

  const topCommands = Object.entries(commandCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cmd]) => cmd);

  const failingCommands = Object.entries(commandFailures)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cmd]) => cmd);

  return {
    totalInvocations: entries.length,
    successCount,
    successRate: Math.round(successRate * 100) / 100,
    avgDurationMs: Math.round(avgDurationMs),
    topCommands,
    failingCommands,
  };
}

// ============================================================================
// Sprint BT — Dim 22: Plugin Ecosystem Report
// ============================================================================

const ECOSYSTEM_REPORT_FILE = ".danteforge/plugin-ecosystem-report.json";

export interface PluginOutcomeSummaryByPlugin {
  pluginId: string;
  totalInvocations: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  successRate: number;
  lastUsed: string;
}

export interface PluginEcosystemReport {
  totalPlugins: number;
  activePlugins: number; // at least 1 invocation
  overallSuccessRate: number;
  topPerformers: string[]; // top 3 plugin IDs by success rate (min 2 invocations)
  unreliablePlugins: string[]; // plugin IDs with successRate < 0.5 (min 2 invocations)
  generatedAt: string;
}

export function buildPluginOutcomeSummaries(
  entries: PluginOutcomeEntry[],
): PluginOutcomeSummaryByPlugin[] {
  const grouped: Record<string, PluginOutcomeEntry[]> = {};
  for (const entry of entries) {
    if (!grouped[entry.pluginId]) grouped[entry.pluginId] = [];
    grouped[entry.pluginId]!.push(entry);
  }

  return Object.entries(grouped).map(([pluginId, pluginEntries]) => {
    const successCount = pluginEntries.filter((e) => e.status === "success").length;
    const failureCount = pluginEntries.filter((e) => e.status === "failure").length;
    const avgDurationMs =
      Math.round(pluginEntries.reduce((s, e) => s + e.durationMs, 0) / pluginEntries.length);
    const successRate = Math.round((successCount / pluginEntries.length) * 100) / 100;
    const lastUsed = pluginEntries
      .map((e) => e.timestamp)
      .sort()
      .reverse()[0] ?? new Date().toISOString();
    return {
      pluginId,
      totalInvocations: pluginEntries.length,
      successCount,
      failureCount,
      avgDurationMs,
      successRate,
      lastUsed,
    };
  });
}

export function buildPluginEcosystemReport(
  summaries: PluginOutcomeSummaryByPlugin[],
): PluginEcosystemReport {
  const totalPlugins = summaries.length;
  const activePlugins = summaries.filter((s) => s.totalInvocations >= 1).length;

  const totalInvocations = summaries.reduce((s, p) => s + p.totalInvocations, 0);
  const totalSuccesses = summaries.reduce((s, p) => s + p.successCount, 0);
  const overallSuccessRate =
    totalInvocations === 0
      ? 0
      : Math.round((totalSuccesses / totalInvocations) * 100) / 100;

  // Min 2 invocations for performer ranking
  const eligible = summaries.filter((s) => s.totalInvocations >= 2);
  const topPerformers = [...eligible]
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, 3)
    .map((s) => s.pluginId);

  const unreliablePlugins = eligible
    .filter((s) => s.successRate < 0.5)
    .map((s) => s.pluginId);

  return {
    totalPlugins,
    activePlugins,
    overallSuccessRate,
    topPerformers,
    unreliablePlugins,
    generatedAt: new Date().toISOString(),
  };
}

export function recordPluginEcosystemReport(
  report: PluginEcosystemReport,
  projectRoot?: string,
): void {
  const root = projectRoot ?? resolve(process.cwd());
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    appendFileSync(join(root, ECOSYSTEM_REPORT_FILE), JSON.stringify(report) + "\n", "utf-8");
  } catch {
    // non-fatal
  }
}

export function loadPluginEcosystemReports(projectRoot?: string): PluginEcosystemReport[] {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, ECOSYSTEM_REPORT_FILE);
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as PluginEcosystemReport);
  } catch {
    return [];
  }
}

export class PluginOutcomeTracker {
  private readonly _projectRoot: string;

  constructor(projectRoot?: string) {
    this._projectRoot = projectRoot ?? resolve(process.cwd());
  }

  record(entry: Omit<PluginOutcomeEntry, "timestamp">): void {
    recordPluginOutcome(entry, this._projectRoot);
  }

  async runTracked<T>(
    pluginId: string,
    commandId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.record({ pluginId, commandId, status: "success", durationMs: Date.now() - start });
      return result;
    } catch (err) {
      this.record({
        pluginId,
        commandId,
        status: "failure",
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
