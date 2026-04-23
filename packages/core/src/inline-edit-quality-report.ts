// packages/core/src/inline-edit-quality-report.ts
// InlineEditQualityReport — session-level metrics and trend analysis for dim 6.
// Builds on top of the existing inline-edit-scorer.ts primitives.

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InlineEditQualityMetrics {
  sessionId: string;
  editCount: number;
  acceptedCount: number;
  rejectedCount: number;
  partialCount: number;
  /** Mean Levenshtein distance of accepted edits */
  avgEditDistance: number;
  /** acceptedCount / editCount */
  acceptanceRate: number;
  /** 0-1: acceptanceRate * (1 - avgEditDistance/200) */
  qualityScore: number;
  timestamp: string;
}

export interface InlineEditQualityReport {
  sessions: InlineEditQualityMetrics[];
  overallAcceptanceRate: number;
  overallQualityScore: number;
  trendDirection: "improving" | "stable" | "declining";
  generatedAt: string;
}

// ─── Builders ─────────────────────────────────────────────────────────────────

/**
 * Build per-session quality metrics from a list of edit events.
 */
export function buildInlineEditMetrics(
  sessionId: string,
  edits: Array<{ accepted: boolean; partial: boolean; editDistance: number }>,
): InlineEditQualityMetrics {
  const editCount = edits.length;
  const acceptedCount = edits.filter((e) => e.accepted && !e.partial).length;
  const partialCount = edits.filter((e) => e.partial).length;
  const rejectedCount = edits.filter((e) => !e.accepted && !e.partial).length;

  const acceptedEdits = edits.filter((e) => e.accepted && !e.partial);
  const avgEditDistance =
    acceptedEdits.length === 0
      ? 0
      : acceptedEdits.reduce((s, e) => s + e.editDistance, 0) /
        acceptedEdits.length;

  const acceptanceRate = editCount === 0 ? 0 : acceptedCount / editCount;
  const qualityScore =
    acceptanceRate * (1 - Math.min(avgEditDistance, 200) / 200);

  return {
    sessionId,
    editCount,
    acceptedCount,
    rejectedCount,
    partialCount,
    avgEditDistance,
    acceptanceRate,
    qualityScore,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a report across multiple sessions, including trend detection.
 *
 * Trend: compare last 3 sessions avg qualityScore vs earlier sessions avg.
 * - improving: recent avg > earlier avg + 0.05
 * - declining: recent avg < earlier avg - 0.05
 * - stable: otherwise
 */
export function buildInlineEditQualityReport(
  metrics: InlineEditQualityMetrics[],
): InlineEditQualityReport {
  const overallAcceptanceRate =
    metrics.length === 0
      ? 0
      : metrics.reduce((s, m) => s + m.acceptanceRate, 0) / metrics.length;

  const overallQualityScore =
    metrics.length === 0
      ? 0
      : metrics.reduce((s, m) => s + m.qualityScore, 0) / metrics.length;

  let trendDirection: "improving" | "stable" | "declining" = "stable";
  if (metrics.length >= 2) {
    const recent = metrics.slice(-3);
    const earlier = metrics.slice(0, Math.max(1, metrics.length - 3));
    const recentAvg =
      recent.reduce((s, m) => s + m.qualityScore, 0) / recent.length;
    const earlierAvg =
      earlier.reduce((s, m) => s + m.qualityScore, 0) / earlier.length;
    if (recentAvg > earlierAvg + 0.05) {
      trendDirection = "improving";
    } else if (recentAvg < earlierAvg - 0.05) {
      trendDirection = "declining";
    }
  }

  return {
    sessions: metrics,
    overallAcceptanceRate,
    overallQualityScore,
    trendDirection,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const REPORT_LOG_FILE = ".danteforge/inline-edit-quality-report.json";

function getReportLogPath(projectRoot?: string): string {
  return path.join(projectRoot ?? process.cwd(), REPORT_LOG_FILE);
}

/**
 * Appends the report as a JSONL entry to .danteforge/inline-edit-quality-report.json.
 */
export function recordInlineEditReport(
  report: InlineEditQualityReport,
  projectRoot?: string,
): void {
  const logPath = getReportLogPath(projectRoot);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(report) + "\n", "utf8");
}

/**
 * Reads all reports from .danteforge/inline-edit-quality-report.json.
 */
export function loadInlineEditReports(
  projectRoot?: string,
): InlineEditQualityReport[] {
  const logPath = getReportLogPath(projectRoot);
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l) as InlineEditQualityReport);
}
