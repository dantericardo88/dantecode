// ============================================================================
// @dantecode/core — Team Dashboard
// Aggregates audit events into team-level metrics: verification pass rates,
// cost per developer, model usage distribution, and productivity trends.
// ============================================================================

import type { AuditEvent } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface DashboardMetrics {
  /** Total number of sessions in the period */
  totalSessions: number;
  /** Total verifications (autoforge runs) */
  totalVerifications: number;
  /** Verification pass rate (0-1) */
  passRate: number;
  /** Average PDSE score across all scored artifacts */
  averagePDSEScore: number;
  /** Total estimated cost in USD */
  totalCostUsd: number;
  /** Cost breakdown by model */
  costByModel: Record<string, number>;
  /** Event counts by type */
  eventCounts: Record<string, number>;
  /** Sessions per day for the period */
  sessionsPerDay: Record<string, number>;
  /** Model usage distribution */
  modelUsage: Record<string, number>;
  /** Active developer count (unique session starters) */
  activeDevelopers: number;
  /** Average session duration in minutes */
  averageSessionDurationMin: number;
  /** Files edited count */
  filesEdited: number;
  /** Lessons learned count */
  lessonsRecorded: number;
}

export interface DashboardFilter {
  /** Start date (ISO string) */
  startDate?: string;
  /** End date (ISO string) */
  endDate?: string;
  /** Filter by model ID */
  modelId?: string;
  /** Filter by session ID */
  sessionId?: string;
}

export interface TrendReport {
  sessionsDelta: number;
  passRateDelta: number;
  costDelta: number;
  pdseDelta: number;
  activeDevelopersDelta: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Apply dashboard filters to the event list.
 */
function applyFilter(events: AuditEvent[], filter?: DashboardFilter): AuditEvent[] {
  if (!filter) return events;

  let filtered = events;

  if (filter.startDate) {
    const start = new Date(filter.startDate).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= start);
  }
  if (filter.endDate) {
    const end = new Date(filter.endDate).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= end);
  }
  if (filter.modelId) {
    filtered = filtered.filter((e) => e.modelId === filter.modelId);
  }
  if (filter.sessionId) {
    filtered = filtered.filter((e) => e.sessionId === filter.sessionId);
  }

  return filtered;
}

/**
 * Compute dashboard metrics from a set of audit events.
 */
/** Mutable accumulator threaded through the per-event scan. */
interface DashboardAccumulator {
  sessionIds: Set<string>;
  sessionStartTimes: Map<string, number>;
  sessionEndTimes: Map<string, number>;
  eventCounts: Record<string, number>;
  costByModel: Record<string, number>;
  modelUsage: Record<string, number>;
  sessionsPerDay: Record<string, number>;
  totalCostUsd: number;
  totalVerifications: number;
  pdsePassCount: number;
  pdseFailCount: number;
  pdseScoreSum: number;
  pdseScoreCount: number;
  filesEdited: number;
  lessonsRecorded: number;
}

function newDashboardAccumulator(): DashboardAccumulator {
  return {
    sessionIds: new Set<string>(),
    sessionStartTimes: new Map<string, number>(),
    sessionEndTimes: new Map<string, number>(),
    eventCounts: {},
    costByModel: {},
    modelUsage: {},
    sessionsPerDay: {},
    totalCostUsd: 0,
    totalVerifications: 0,
    pdsePassCount: 0,
    pdseFailCount: 0,
    pdseScoreSum: 0,
    pdseScoreCount: 0,
    filesEdited: 0,
    lessonsRecorded: 0,
  };
}

function recordPdseScore(acc: DashboardAccumulator, payload: Record<string, unknown>): void {
  const score = Number(payload["score"] ?? payload["overall"] ?? 0);
  if (score > 0) {
    acc.pdseScoreSum += score;
    acc.pdseScoreCount++;
  }
}

/** Single-pass accumulator over the filtered event stream. */
function accumulateDashboardEvents(events: AuditEvent[]): DashboardAccumulator {
  const acc = newDashboardAccumulator();
  for (const event of events) {
    acc.eventCounts[event.type] = (acc.eventCounts[event.type] ?? 0) + 1;
    if (event.modelId) acc.modelUsage[event.modelId] = (acc.modelUsage[event.modelId] ?? 0) + 1;
    acc.sessionIds.add(event.sessionId);

    if (event.type === "session_start") {
      const day = event.timestamp.slice(0, 10);
      acc.sessionsPerDay[day] = (acc.sessionsPerDay[day] ?? 0) + 1;
      const ts = new Date(event.timestamp).getTime();
      const existing = acc.sessionStartTimes.get(event.sessionId);
      if (!existing || ts < existing) acc.sessionStartTimes.set(event.sessionId, ts);
    }
    if (event.type === "session_end") {
      const ts = new Date(event.timestamp).getTime();
      const existing = acc.sessionEndTimes.get(event.sessionId);
      if (!existing || ts > existing) acc.sessionEndTimes.set(event.sessionId, ts);
    }
    if (event.type === "cost_update") {
      const cost = Number(event.payload["costUsd"] ?? 0);
      acc.totalCostUsd += cost;
      if (event.modelId) acc.costByModel[event.modelId] = (acc.costByModel[event.modelId] ?? 0) + cost;
    }
    if (event.type === "autoforge_start") acc.totalVerifications++;
    if (event.type === "pdse_gate_pass") { acc.pdsePassCount++; recordPdseScore(acc, event.payload); }
    if (event.type === "pdse_gate_fail") { acc.pdseFailCount++; recordPdseScore(acc, event.payload); }
    if (event.type === "file_write" || event.type === "file_edit") acc.filesEdited++;
    if (event.type === "lesson_record") acc.lessonsRecorded++;
  }
  return acc;
}

/** Average session duration in minutes from start/end timestamp maps. */
function averageSessionDuration(
  startTimes: Map<string, number>,
  endTimes: Map<string, number>,
): number {
  let totalMin = 0;
  let count = 0;
  for (const [sid, startTs] of startTimes) {
    const endTs = endTimes.get(sid);
    if (endTs && endTs > startTs) {
      totalMin += (endTs - startTs) / 60_000;
      count++;
    }
  }
  return count > 0 ? totalMin / count : 0;
}

export function computeDashboardMetrics(
  events: AuditEvent[],
  filter?: DashboardFilter,
): DashboardMetrics {
  const filtered = applyFilter(events, filter);
  const acc = accumulateDashboardEvents(filtered);

  const totalGated = acc.pdsePassCount + acc.pdseFailCount;
  const passRate = totalGated > 0 ? acc.pdsePassCount / totalGated : 0;
  const averagePDSEScore = acc.pdseScoreCount > 0 ? acc.pdseScoreSum / acc.pdseScoreCount : 0;
  const activeDevelopers = filtered.reduce((set, e) => {
    if (e.type === "session_start") set.add(e.sessionId);
    return set;
  }, new Set<string>()).size;
  const totalSessions =
    (acc.eventCounts["session_start"] ?? 0) > 0
      ? (acc.eventCounts["session_start"] ?? 0)
      : acc.sessionIds.size;
  const averageSessionDurationMin = averageSessionDuration(acc.sessionStartTimes, acc.sessionEndTimes);

  return {
    totalSessions,
    totalVerifications: acc.totalVerifications,
    passRate,
    averagePDSEScore,
    totalCostUsd: acc.totalCostUsd,
    costByModel: acc.costByModel,
    eventCounts: acc.eventCounts,
    sessionsPerDay: acc.sessionsPerDay,
    modelUsage: acc.modelUsage,
    activeDevelopers,
    averageSessionDurationMin,
    filesEdited: acc.filesEdited,
    lessonsRecorded: acc.lessonsRecorded,
  };
}

/**
 * Generate a markdown summary report from dashboard metrics.
 */
export function formatDashboardReport(metrics: DashboardMetrics, title?: string): string {
  const heading = title ?? "Team Dashboard Report";
  const lines: string[] = [];

  lines.push(`# ${heading}`);
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Sessions | ${metrics.totalSessions} |`);
  lines.push(`| Active Developers | ${metrics.activeDevelopers} |`);
  lines.push(`| Total Verifications | ${metrics.totalVerifications} |`);
  lines.push(`| Pass Rate | ${(metrics.passRate * 100).toFixed(1)}% |`);
  lines.push(`| Average PDSE Score | ${metrics.averagePDSEScore.toFixed(2)} |`);
  lines.push(`| Total Cost (USD) | $${metrics.totalCostUsd.toFixed(2)} |`);
  lines.push(`| Avg Session Duration | ${metrics.averageSessionDurationMin.toFixed(1)} min |`);
  lines.push(`| Files Edited | ${metrics.filesEdited} |`);
  lines.push(`| Lessons Recorded | ${metrics.lessonsRecorded} |`);
  lines.push("");

  // Model usage
  const modelEntries = Object.entries(metrics.modelUsage);
  if (modelEntries.length > 0) {
    lines.push("## Model Usage");
    lines.push("");
    lines.push("| Model | Events |");
    lines.push("|-------|--------|");
    for (const [model, count] of modelEntries.sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${model} | ${count} |`);
    }
    lines.push("");
  }

  // Cost breakdown
  const costEntries = Object.entries(metrics.costByModel);
  if (costEntries.length > 0) {
    lines.push("## Cost Breakdown");
    lines.push("");
    lines.push("| Model | Cost (USD) |");
    lines.push("|-------|------------|");
    for (const [model, cost] of costEntries.sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${model} | $${cost.toFixed(2)} |`);
    }
    lines.push("");
  }

  // Sessions per day
  const dayEntries = Object.entries(metrics.sessionsPerDay);
  if (dayEntries.length > 0) {
    lines.push("## Sessions Per Day");
    lines.push("");
    lines.push("| Date | Sessions |");
    lines.push("|------|----------|");
    for (const [day, count] of dayEntries.sort()) {
      lines.push(`| ${day} | ${count} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Compute trend data comparing two time periods.
 */
export function computeTrend(current: DashboardMetrics, previous: DashboardMetrics): TrendReport {
  const sessionsDelta = current.totalSessions - previous.totalSessions;
  const passRateDelta = current.passRate - previous.passRate;
  const costDelta = current.totalCostUsd - previous.totalCostUsd;
  const pdseDelta = current.averagePDSEScore - previous.averagePDSEScore;
  const activeDevelopersDelta = current.activeDevelopers - previous.activeDevelopers;

  // Build a human-readable summary
  const parts: string[] = [];

  if (sessionsDelta > 0) {
    parts.push(`Sessions increased by ${sessionsDelta}`);
  } else if (sessionsDelta < 0) {
    parts.push(`Sessions decreased by ${Math.abs(sessionsDelta)}`);
  } else {
    parts.push("Sessions unchanged");
  }

  if (passRateDelta > 0) {
    parts.push(`pass rate improved by ${(passRateDelta * 100).toFixed(1)}pp`);
  } else if (passRateDelta < 0) {
    parts.push(`pass rate regressed by ${(Math.abs(passRateDelta) * 100).toFixed(1)}pp`);
  }

  if (costDelta > 0) {
    parts.push(`cost increased by $${costDelta.toFixed(2)}`);
  } else if (costDelta < 0) {
    parts.push(`cost decreased by $${Math.abs(costDelta).toFixed(2)}`);
  }

  if (pdseDelta > 0) {
    parts.push(`PDSE score improved by ${pdseDelta.toFixed(2)}`);
  } else if (pdseDelta < 0) {
    parts.push(`PDSE score regressed by ${Math.abs(pdseDelta).toFixed(2)}`);
  }

  const summary = parts.join("; ") + ".";

  return {
    sessionsDelta,
    passRateDelta,
    costDelta,
    pdseDelta,
    activeDevelopersDelta,
    summary,
  };
}
