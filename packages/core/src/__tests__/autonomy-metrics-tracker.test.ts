import { describe, it, expect } from "vitest";
import {
  getAutonomyReport,
  type AutonomyMetric,
} from "../autonomy-metrics-tracker.js";

function makeEntry(
  overrides: Partial<AutonomyMetric> & { status: AutonomyMetric["status"] },
): AutonomyMetric {
  return {
    sessionId: "s-" + Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString(),
    toolCalls: [],
    durationMs: 1000,
    ...overrides,
  };
}

describe("getAutonomyReport", () => {
  it("returns zeroed report for empty entries", () => {
    const report = getAutonomyReport([]);
    expect(report.totalSessions).toBe(0);
    expect(report.completionRate).toBe(0);
    expect(report.avgToolCallsPerSession).toBe(0);
    expect(report.avgDurationMs).toBe(0);
    expect(report.topTools).toHaveLength(0);
    expect(report.trend).toBe("stable");
  });

  it("counts total sessions correctly", () => {
    const entries: AutonomyMetric[] = [
      makeEntry({ status: "complete" }),
      makeEntry({ status: "failed" }),
      makeEntry({ status: "partial" }),
    ];
    const report = getAutonomyReport(entries);
    expect(report.totalSessions).toBe(3);
  });

  it("computes completionRate as fraction with status complete", () => {
    const entries: AutonomyMetric[] = [
      makeEntry({ status: "complete" }),
      makeEntry({ status: "complete" }),
      makeEntry({ status: "failed" }),
      makeEntry({ status: "failed" }),
    ];
    const report = getAutonomyReport(entries);
    expect(report.completionRate).toBeCloseTo(0.5);
  });

  it("orders topTools by usage count descending", () => {
    const entries: AutonomyMetric[] = [
      makeEntry({ status: "complete", toolCalls: ["Read", "Read", "Edit", "Bash"] }),
      makeEntry({ status: "complete", toolCalls: ["Read", "Bash", "Bash"] }),
      makeEntry({ status: "failed", toolCalls: ["Grep"] }),
    ];
    const report = getAutonomyReport(entries);
    expect(report.topTools[0]?.name).toBe("Read");   // 3 calls
    // count checks
    const readEntry = report.topTools.find((t) => t.name === "Read");
    expect(readEntry?.count).toBe(3);
  });

  it("returns at most 5 topTools", () => {
    const tools = ["A", "B", "C", "D", "E", "F", "G"];
    const entries: AutonomyMetric[] = [
      makeEntry({ status: "complete", toolCalls: tools }),
    ];
    const report = getAutonomyReport(entries);
    expect(report.topTools.length).toBeLessThanOrEqual(5);
  });

  it("detects improving trend when last 5 completion rate >= prior 5 + 0.1", () => {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    // prior 5: 0 complete → rate 0.0
    const prior5: AutonomyMetric[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ status: "failed", timestamp: new Date(base + i * 1000).toISOString() }),
    );
    // last 5: all complete → rate 1.0
    const last5: AutonomyMetric[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ status: "complete", timestamp: new Date(base + (i + 5) * 1000).toISOString() }),
    );
    const report = getAutonomyReport([...prior5, ...last5]);
    expect(report.trend).toBe("improving");
  });

  it("detects declining trend when last 5 completion rate < prior 5 - 0.1", () => {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    // prior 5: all complete → rate 1.0
    const prior5: AutonomyMetric[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ status: "complete", timestamp: new Date(base + i * 1000).toISOString() }),
    );
    // last 5: 0 complete → rate 0.0
    const last5: AutonomyMetric[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ status: "failed", timestamp: new Date(base + (i + 5) * 1000).toISOString() }),
    );
    const report = getAutonomyReport([...prior5, ...last5]);
    expect(report.trend).toBe("declining");
  });

  it("reports stable trend when difference is within threshold", () => {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    // prior 5: 3/5 complete → 0.6
    const prior5: AutonomyMetric[] = [
      makeEntry({ status: "complete", timestamp: new Date(base).toISOString() }),
      makeEntry({ status: "complete", timestamp: new Date(base + 1000).toISOString() }),
      makeEntry({ status: "complete", timestamp: new Date(base + 2000).toISOString() }),
      makeEntry({ status: "failed", timestamp: new Date(base + 3000).toISOString() }),
      makeEntry({ status: "failed", timestamp: new Date(base + 4000).toISOString() }),
    ];
    // last 5: 3/5 complete → 0.6 (same, diff = 0)
    const last5: AutonomyMetric[] = [
      makeEntry({ status: "complete", timestamp: new Date(base + 5000).toISOString() }),
      makeEntry({ status: "complete", timestamp: new Date(base + 6000).toISOString() }),
      makeEntry({ status: "complete", timestamp: new Date(base + 7000).toISOString() }),
      makeEntry({ status: "failed", timestamp: new Date(base + 8000).toISOString() }),
      makeEntry({ status: "failed", timestamp: new Date(base + 9000).toISOString() }),
    ];
    const report = getAutonomyReport([...prior5, ...last5]);
    expect(report.trend).toBe("stable");
  });

  it("computes avgDurationMs correctly", () => {
    const entries: AutonomyMetric[] = [
      makeEntry({ status: "complete", durationMs: 1000 }),
      makeEntry({ status: "failed", durationMs: 3000 }),
    ];
    const report = getAutonomyReport(entries);
    expect(report.avgDurationMs).toBeCloseTo(2000);
  });
});
