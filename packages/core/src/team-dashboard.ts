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
export function computeDashboardMetrics(
  events: AuditEvent[],
  filter?: DashboardFilter,
): DashboardMetrics {
  const filtered = applyFilter(events, filter);

  // Track unique sessions, session start/end times, developers
  const sessionIds = new Set<string>();
  const sessionStartTimes = new Map<string, number>();
  const sessionEndTimes = new Map<string, number>();
  const eventCounts: Record<string, number> = {};
  const costByModel: Record<string, number> = {};
  const modelUsage: Record<string, number> = {};
  const sessionsPerDay: Record<string, number> = {};

  let totalCostUsd = 0;
  let totalVerifications = 0;
  let pdsePassCount = 0;
  let pdseFailCount = 0;
  let pdseScoreSum = 0;
  let pdseScoreCount = 0;
  let filesEdited = 0;
  let lessonsRecorded = 0;

  for (const event of filtered) {
    // Count events by type
    eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;

    // Track model usage
    if (event.modelId) {
      modelUsage[event.modelId] = (modelUsage[event.modelId] ?? 0) + 1;
    }

    // Track sessions
    sessionIds.add(event.sessionId);

    // Sessions per day (based on session_start events)
    if (event.type === "session_start") {
      const day = event.timestamp.slice(0, 10); // YYYY-MM-DD
      sessionsPerDay[day] = (sessionsPerDay[day] ?? 0) + 1;

      // Track session start time
      const ts = new Date(event.timestamp).getTime();
      const existing = sessionStartTimes.get(event.sessionId);
      if (!existing || ts < existing) {
        sessionStartTimes.set(event.sessionId, ts);
      }
    }

    // Track session end time
    if (event.type === "session_end") {
      const ts = new Date(event.timestamp).getTime();
      const existing = sessionEndTimes.get(event.sessionId);
      if (!existing || ts > existing) {
        sessionEndTimes.set(event.sessionId, ts);
      }
    }

    // Cost tracking
    if (event.type === "cost_update") {
      const cost = Number(event.payload["costUsd"] ?? 0);
      totalCostUsd += cost;
      if (event.modelId) {
        costByModel[event.modelId] = (costByModel[event.modelId] ?? 0) + cost;
      }
    }

    // Autoforge / verification tracking
    if (
      event.type === "autoforge_start" ||
      event.type === "verification_run" ||
      event.type === "qa_suite_run" ||
      event.type === "critic_debate_run"
    ) {
      totalVerifications++;
    }

    // PDSE gate events
    if (event.type === "pdse_gate_pass") {
      pdsePassCount++;
      const score = Number(event.payload["score"] ?? event.payload["overall"] ?? 0);
      if (score > 0) {
        pdseScoreSum += score;
        pdseScoreCount++;
      }
    }
    if (event.type === "pdse_gate_fail") {
      pdseFailCount++;
      const score = Number(event.payload["score"] ?? event.payload["overall"] ?? 0);
      if (score > 0) {
        pdseScoreSum += score;
        pdseScoreCount++;
      }
    }

    // File edits
    if (event.type === "file_write" || event.type === "file_edit") {
      filesEdited++;
    }

    // Lessons
    if (event.type === "lesson_record") {
      lessonsRecorded++;
    }
  }

  // Compute pass rate
  const totalGated = pdsePassCount + pdseFailCount;
  const passRate = totalGated > 0 ? pdsePassCount / totalGated : 0;

  // Average PDSE score
  const averagePDSEScore = pdseScoreCount > 0 ? pdseScoreSum / pdseScoreCount : 0;

  // Active developers: count unique sessionIds that have a session_start event
  const starterSessions = new Set<string>();
  for (const event of filtered) {
    if (event.type === "session_start") {
      starterSessions.add(event.sessionId);
    }
  }
  const activeDevelopers = starterSessions.size;

  // Total sessions (based on session_start events, or fall back to unique session IDs)
  const totalSessions =
    (eventCounts["session_start"] ?? 0) > 0 ? (eventCounts["session_start"] ?? 0) : sessionIds.size;

  // Average session duration
  let totalDurationMin = 0;
  let durationCount = 0;
  for (const [sid, startTs] of sessionStartTimes) {
    const endTs = sessionEndTimes.get(sid);
    if (endTs && endTs > startTs) {
      totalDurationMin += (endTs - startTs) / 60_000;
      durationCount++;
    }
  }
  const averageSessionDurationMin = durationCount > 0 ? totalDurationMin / durationCount : 0;

  return {
    totalSessions,
    totalVerifications,
    passRate,
    averagePDSEScore,
    totalCostUsd,
    costByModel,
    eventCounts,
    sessionsPerDay,
    modelUsage,
    activeDevelopers,
    averageSessionDurationMin,
    filesEdited,
    lessonsRecorded,
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
