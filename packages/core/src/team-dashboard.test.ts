// ============================================================================
// @dantecode/core — Team Dashboard Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { computeDashboardMetrics, formatDashboardReport, computeTrend } from "./team-dashboard.js";
import type { AuditEvent } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<AuditEvent> & { type: AuditEvent["type"] }): AuditEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: "session-1",
    timestamp: "2026-03-10T10:00:00.000Z",
    payload: {},
    modelId: "grok-4",
    projectRoot: "/project",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeDashboardMetrics", () => {
  it("returns zero metrics for empty events", () => {
    const m = computeDashboardMetrics([]);
    expect(m.totalSessions).toBe(0);
    expect(m.totalVerifications).toBe(0);
    expect(m.passRate).toBe(0);
    expect(m.averagePDSEScore).toBe(0);
    expect(m.totalCostUsd).toBe(0);
    expect(m.filesEdited).toBe(0);
    expect(m.lessonsRecorded).toBe(0);
    expect(m.activeDevelopers).toBe(0);
  });

  it("counts sessions correctly from session_start events", () => {
    const events: AuditEvent[] = [
      makeEvent({ type: "session_start", sessionId: "s1" }),
      makeEvent({ type: "session_start", sessionId: "s2" }),
      makeEvent({ type: "session_start", sessionId: "s3" }),
      makeEvent({ type: "file_read", sessionId: "s1" }),
    ];
    const m = computeDashboardMetrics(events);
    expect(m.totalSessions).toBe(3);
    expect(m.activeDevelopers).toBe(3);
  });

  it("counts verification-specific audit events in total verifications", () => {
    const events: AuditEvent[] = [
      makeEvent({ type: "verification_run", payload: { passed: true, pdseScore: 0.91 } }),
      makeEvent({ type: "qa_suite_run", payload: { passed: false, averagePdseScore: 0.62 } }),
      makeEvent({ type: "critic_debate_run", payload: { consensus: "warn", averageConfidence: 0.7 } }),
    ];

    const m = computeDashboardMetrics(events);

    expect(m.totalVerifications).toBe(3);
  });

  it("computes pass rate from pdse_gate_pass and pdse_gate_fail events", () => {
    const events: AuditEvent[] = [
      makeEvent({
        type: "pdse_gate_pass",
        payload: { score: 0.92 },
      }),
      makeEvent({
        type: "pdse_gate_pass",
        payload: { score: 0.88 },
      }),
      makeEvent({
        type: "pdse_gate_fail",
        payload: { score: 0.45 },
      }),
    ];
    const m = computeDashboardMetrics(events);
    // 2 passes out of 3 total
    expect(m.passRate).toBeCloseTo(2 / 3, 5);
    // average PDSE: (0.92 + 0.88 + 0.45) / 3
    expect(m.averagePDSEScore).toBeCloseTo(0.75, 2);
  });

  it("filters events by date range", () => {
    const events: AuditEvent[] = [
      makeEvent({
        type: "session_start",
        timestamp: "2026-03-01T10:00:00.000Z",
        sessionId: "s1",
      }),
      makeEvent({
        type: "session_start",
        timestamp: "2026-03-05T10:00:00.000Z",
        sessionId: "s2",
      }),
      makeEvent({
        type: "session_start",
        timestamp: "2026-03-10T10:00:00.000Z",
        sessionId: "s3",
      }),
    ];

    const m = computeDashboardMetrics(events, {
      startDate: "2026-03-04T00:00:00.000Z",
      endDate: "2026-03-06T00:00:00.000Z",
    });
    expect(m.totalSessions).toBe(1);
    expect(m.activeDevelopers).toBe(1);
  });

  it("aggregates model usage distribution", () => {
    const events: AuditEvent[] = [
      makeEvent({ type: "file_read", modelId: "grok-4" }),
      makeEvent({ type: "file_read", modelId: "grok-4" }),
      makeEvent({ type: "file_read", modelId: "claude-opus-4" }),
      makeEvent({ type: "file_write", modelId: "grok-4" }),
    ];
    const m = computeDashboardMetrics(events);
    expect(m.modelUsage["grok-4"]).toBe(3);
    expect(m.modelUsage["claude-opus-4"]).toBe(1);
  });

  it("aggregates costs from cost_update events", () => {
    const events: AuditEvent[] = [
      makeEvent({
        type: "cost_update",
        modelId: "grok-4",
        payload: { costUsd: 0.05 },
      }),
      makeEvent({
        type: "cost_update",
        modelId: "grok-4",
        payload: { costUsd: 0.03 },
      }),
      makeEvent({
        type: "cost_update",
        modelId: "claude-opus-4",
        payload: { costUsd: 0.1 },
      }),
    ];
    const m = computeDashboardMetrics(events);
    expect(m.totalCostUsd).toBeCloseTo(0.18, 5);
    expect(m.costByModel["grok-4"]).toBeCloseTo(0.08, 5);
    expect(m.costByModel["claude-opus-4"]).toBeCloseTo(0.1, 5);
  });

  it("counts files edited and lessons recorded", () => {
    const events: AuditEvent[] = [
      makeEvent({ type: "file_write" }),
      makeEvent({ type: "file_edit" }),
      makeEvent({ type: "file_edit" }),
      makeEvent({ type: "lesson_record" }),
    ];
    const m = computeDashboardMetrics(events);
    expect(m.filesEdited).toBe(3);
    expect(m.lessonsRecorded).toBe(1);
  });

  it("computes average session duration", () => {
    const events: AuditEvent[] = [
      makeEvent({
        type: "session_start",
        sessionId: "s1",
        timestamp: "2026-03-10T10:00:00.000Z",
      }),
      makeEvent({
        type: "session_end",
        sessionId: "s1",
        timestamp: "2026-03-10T10:30:00.000Z",
      }),
      makeEvent({
        type: "session_start",
        sessionId: "s2",
        timestamp: "2026-03-10T11:00:00.000Z",
      }),
      makeEvent({
        type: "session_end",
        sessionId: "s2",
        timestamp: "2026-03-10T12:00:00.000Z",
      }),
    ];
    const m = computeDashboardMetrics(events);
    // s1 = 30 min, s2 = 60 min => avg 45 min
    expect(m.averageSessionDurationMin).toBeCloseTo(45, 1);
  });
});

// ---------------------------------------------------------------------------
// formatDashboardReport
// ---------------------------------------------------------------------------

describe("formatDashboardReport", () => {
  it("produces markdown with overview table", () => {
    const metrics = computeDashboardMetrics([
      makeEvent({ type: "session_start" }),
      makeEvent({ type: "pdse_gate_pass", payload: { score: 0.9 } }),
    ]);
    const md = formatDashboardReport(metrics, "Q1 Report");

    expect(md).toContain("# Q1 Report");
    expect(md).toContain("Total Sessions");
    expect(md).toContain("Pass Rate");
    expect(md).toContain("Generated:");
    // Should include markdown table syntax
    expect(md).toContain("|");
  });

  it("uses a default title when none provided", () => {
    const metrics = computeDashboardMetrics([]);
    const md = formatDashboardReport(metrics);
    expect(md).toContain("# Team Dashboard Report");
  });
});

// ---------------------------------------------------------------------------
// computeTrend
// ---------------------------------------------------------------------------

describe("computeTrend", () => {
  it("reports improvement when current is better", () => {
    const prev = computeDashboardMetrics([
      makeEvent({ type: "session_start", sessionId: "s1" }),
      makeEvent({ type: "pdse_gate_fail", payload: { score: 0.4 } }),
      makeEvent({
        type: "cost_update",
        payload: { costUsd: 1.0 },
        modelId: "grok-4",
      }),
    ]);
    const curr = computeDashboardMetrics([
      makeEvent({ type: "session_start", sessionId: "s1" }),
      makeEvent({ type: "session_start", sessionId: "s2" }),
      makeEvent({ type: "pdse_gate_pass", payload: { score: 0.9 } }),
      makeEvent({
        type: "cost_update",
        payload: { costUsd: 0.5 },
        modelId: "grok-4",
      }),
    ]);

    const trend = computeTrend(curr, prev);
    expect(trend.sessionsDelta).toBe(1);
    expect(trend.passRateDelta).toBeGreaterThan(0);
    expect(trend.costDelta).toBeLessThan(0);
    expect(trend.summary).toContain("improved");
    expect(trend.summary).toContain("decreased");
  });

  it("reports regression when current is worse", () => {
    const prev = computeDashboardMetrics([
      makeEvent({ type: "session_start", sessionId: "s1" }),
      makeEvent({ type: "session_start", sessionId: "s2" }),
      makeEvent({ type: "pdse_gate_pass", payload: { score: 0.9 } }),
    ]);
    const curr = computeDashboardMetrics([
      makeEvent({ type: "session_start", sessionId: "s1" }),
      makeEvent({ type: "pdse_gate_fail", payload: { score: 0.3 } }),
    ]);

    const trend = computeTrend(curr, prev);
    expect(trend.sessionsDelta).toBe(-1);
    expect(trend.passRateDelta).toBeLessThan(0);
    expect(trend.summary).toContain("regressed");
  });
});
