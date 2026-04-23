// Sprint BO — Dim 7: Multi-file autonomy report
// Computes structured AutonomyReport from raw AutonomyMetric entries.
// Covers tool call frequency, completion rate, trend comparison, and top tools.

export interface AutonomyMetric {
  sessionId: string;
  timestamp: string;
  toolCalls: string[];          // names of tools called in session
  durationMs: number;
  status: "complete" | "partial" | "failed" | "loop";
}

export interface AutonomyReport {
  totalSessions: number;
  avgToolCallsPerSession: number;
  avgDurationMs: number;
  completionRate: number;        // fraction with status "complete"
  topTools: Array<{ name: string; count: number }>; // top 5 by usage
  trend: "improving" | "stable" | "declining";      // compare last 5 vs prior 5 sessions
}

/**
 * Compute a structured autonomy report from a list of AutonomyMetric entries.
 * Trend is determined by comparing the completion rate of the last 5 sessions
 * versus the 5 sessions before that:
 *   last5 >= prior5 + 0.1  → "improving"
 *   last5 <  prior5 - 0.1  → "declining"
 *   otherwise              → "stable"
 */
export function getAutonomyReport(entries: AutonomyMetric[]): AutonomyReport {
  if (entries.length === 0) {
    return {
      totalSessions: 0,
      avgToolCallsPerSession: 0,
      avgDurationMs: 0,
      completionRate: 0,
      topTools: [],
      trend: "stable",
    };
  }

  const totalSessions = entries.length;
  const completionRate =
    entries.filter((e) => e.status === "complete").length / totalSessions;

  const avgToolCallsPerSession =
    entries.reduce((sum, e) => sum + e.toolCalls.length, 0) / totalSessions;

  const avgDurationMs =
    entries.reduce((sum, e) => sum + e.durationMs, 0) / totalSessions;

  // Count all tool names across all sessions
  const toolCounts = new Map<string, number>();
  for (const entry of entries) {
    for (const tool of entry.toolCalls) {
      toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
    }
  }
  const topTools = Array.from(toolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // Trend: compare last 5 vs prior 5 completion rates
  const trend = computeAutonomyTrend(entries);

  return { totalSessions, avgToolCallsPerSession, avgDurationMs, completionRate, topTools, trend };
}

function computeAutonomyTrend(
  entries: AutonomyMetric[],
): AutonomyReport["trend"] {
  if (entries.length < 2) return "stable";

  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const last5 = sorted.slice(-5);
  const prior5 = sorted.slice(-10, -5);

  if (prior5.length === 0) return "stable";

  const last5Rate =
    last5.filter((e) => e.status === "complete").length / last5.length;
  const prior5Rate =
    prior5.filter((e) => e.status === "complete").length / prior5.length;

  if (last5Rate >= prior5Rate + 0.1) return "improving";
  if (last5Rate < prior5Rate - 0.1) return "declining";
  return "stable";
}
