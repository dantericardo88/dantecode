import { describe, expect, it, beforeEach } from "vitest";
import {
  VerificationTraceRecorder,
  globalTraceRecorder,
} from "./verification-trace-recorder.js";
import {
  serializeTrace,
  deserializeTrace,
  validateSerializedTrace,
  summarizeTrace,
  filterEvents,
} from "./verification-trace-serializer.js";

describe("VerificationTraceRecorder", () => {
  let recorder: VerificationTraceRecorder;

  beforeEach(() => {
    recorder = new VerificationTraceRecorder();
  });

  it("starts a trace and records the trace_started event", () => {
    const traceId = recorder.startTrace("Deploy the service");
    const trace = recorder.getTrace(traceId);
    expect(trace).toBeDefined();
    expect(trace!.task).toBe("Deploy the service");
    expect(trace!.events).toHaveLength(1);
    expect(trace!.events[0]?.kind).toBe("trace_started");
  });

  it("accepts a pre-set traceId", () => {
    const traceId = recorder.startTrace("task", "my-trace-id");
    expect(traceId).toBe("my-trace-id");
    expect(recorder.getTrace("my-trace-id")).toBeDefined();
  });

  it("records stage_started and stage_completed events", () => {
    const traceId = recorder.startTrace("Verify output");
    recorder.recordStageStart(traceId, "syntactic");
    recorder.recordStageComplete(traceId, "syntactic", true, "Parsed cleanly.");
    const trace = recorder.getTrace(traceId)!;
    const kinds = trace.events.map((e) => e.kind);
    expect(kinds).toContain("stage_started");
    expect(kinds).toContain("stage_completed");
    const completed = trace.events.find((e) => e.kind === "stage_completed");
    expect(completed?.passed).toBe(true);
    expect(completed?.stage).toBe("syntactic");
  });

  it("records metric score events", () => {
    const traceId = recorder.startTrace("task");
    recorder.recordMetric(traceId, "faithfulness", 0.95, true, "No placeholders.");
    const trace = recorder.getTrace(traceId)!;
    const metricEvent = trace.events.find((e) => e.kind === "metric_scored");
    expect(metricEvent?.score).toBe(0.95);
    expect(metricEvent?.stage).toBe("faithfulness");
  });

  it("records rail trigger events", () => {
    const traceId = recorder.startTrace("task");
    recorder.recordRailTrigger(traceId, "rail-no-todo", "block", ["Forbidden pattern: TODO"]);
    const trace = recorder.getTrace(traceId)!;
    const railEvent = trace.events.find((e) => e.kind === "rail_triggered");
    expect(railEvent?.data?.["action"]).toBe("block");
    expect(railEvent?.passed).toBe(false);
  });

  it("records critic opinions and debate completed", () => {
    const traceId = recorder.startTrace("task");
    recorder.recordCriticOpinion(traceId, "critic-1", "pass", 0.9);
    recorder.recordCriticOpinion(traceId, "critic-2", "warn", 0.6, ["Consider adding more context"]);
    recorder.recordDebateComplete(traceId, "warn", 0.75, "Mild concerns.");
    const trace = recorder.getTrace(traceId)!;
    const opinions = trace.events.filter((e) => e.kind === "critic_opinion");
    expect(opinions).toHaveLength(2);
    const debate = trace.events.find((e) => e.kind === "debate_completed");
    expect(debate?.data?.["consensus"]).toBe("warn");
  });

  it("records override request and grant", () => {
    const traceId = recorder.startTrace("task");
    recorder.recordOverrideRequest(traceId, "User override", "user-123");
    recorder.recordOverrideGranted(traceId, "Approved by admin", "admin");
    const trace = recorder.getTrace(traceId)!;
    expect(trace.events.some((e) => e.kind === "override_requested")).toBe(true);
    const granted = trace.events.find((e) => e.kind === "override_granted");
    expect(granted?.data?.["auditTimestamp"]).toBeDefined();
  });

  it("ends trace and sets completedAt + decision", () => {
    const traceId = recorder.startTrace("task");
    const final = recorder.endTrace(traceId, "pass", 0.92, 0.88);
    expect(final).toBeDefined();
    expect(final!.completedAt).toBeDefined();
    expect(final!.decision).toBe("pass");
    expect(final!.finalScore).toBe(0.92);
    expect(final!.events.at(-1)?.kind).toBe("trace_completed");
  });

  it("fails trace with trace_failed event", () => {
    const traceId = recorder.startTrace("task");
    const failed = recorder.failTrace(traceId, "Timeout");
    expect(failed!.events.at(-1)?.kind).toBe("trace_failed");
    expect(failed!.events.at(-1)?.data?.["error"]).toBe("Timeout");
  });

  it("lists all active trace ids", () => {
    recorder.startTrace("task-a");
    recorder.startTrace("task-b");
    expect(recorder.listTraceIds()).toHaveLength(2);
  });

  it("evicts a trace from memory", () => {
    const id = recorder.startTrace("task");
    recorder.evict(id);
    expect(recorder.getTrace(id)).toBeUndefined();
  });

  it("globalTraceRecorder is a shared instance", () => {
    const id = globalTraceRecorder.startTrace("shared task");
    expect(globalTraceRecorder.getTrace(id)).toBeDefined();
    globalTraceRecorder.evict(id);
  });
});

describe("verification-trace-serializer", () => {
  let recorder: VerificationTraceRecorder;

  beforeEach(() => {
    recorder = new VerificationTraceRecorder();
  });

  it("serializes and deserializes a trace round-trip", () => {
    const traceId = recorder.startTrace("Deploy and rollback");
    recorder.recordStageStart(traceId, "syntactic");
    recorder.recordStageComplete(traceId, "syntactic", true, "Clean.");
    recorder.recordMetric(traceId, "faithfulness", 0.92, true, "OK");
    recorder.endTrace(traceId, "pass", 0.92, 0.88);
    const trace = recorder.getTrace(traceId)!;

    const json = serializeTrace(trace);
    const restored = deserializeTrace(json);
    expect(restored).not.toBeNull();
    expect(restored!.traceId).toBe(traceId);
    expect(restored!.task).toBe("Deploy and rollback");
    expect(restored!.events.length).toBe(trace.events.length);
    expect(restored!.decision).toBe("pass");
    expect(restored!.finalScore).toBe(0.92);
  });

  it("deserializeTrace returns null for invalid JSON", () => {
    expect(deserializeTrace("{bad json")).toBeNull();
  });

  it("deserializeTrace returns null for missing required fields", () => {
    expect(deserializeTrace(JSON.stringify({ version: 1, task: "t" }))).toBeNull();
  });

  it("validateSerializedTrace reports missing fields", () => {
    const result = validateSerializedTrace({ version: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("traceId"))).toBe(true);
  });

  it("validateSerializedTrace passes a valid serialized trace", () => {
    const traceId = recorder.startTrace("task");
    const trace = recorder.getTrace(traceId)!;
    const json = serializeTrace(trace);
    const raw = JSON.parse(json) as unknown;
    const result = validateSerializedTrace(raw);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("summarizeTrace includes key fields", () => {
    const traceId = recorder.startTrace("task");
    recorder.endTrace(traceId, "review-required", 0.72, 0.6);
    const trace = recorder.getTrace(traceId)!;
    const summary = summarizeTrace(trace);
    expect(summary).toContain("review-required");
    expect(summary).toContain(traceId);
  });

  it("filterEvents returns only events of the requested kind", () => {
    const traceId = recorder.startTrace("task");
    recorder.recordStageComplete(traceId, "syntactic", true);
    recorder.recordMetric(traceId, "faithfulness", 0.9, true);
    recorder.recordMetric(traceId, "correctness", 0.8, true);
    const trace = recorder.getTrace(traceId)!;
    const metricEvents = filterEvents(trace, "metric_scored");
    expect(metricEvents).toHaveLength(2);
    const stageEvents = filterEvents(trace, "stage_completed");
    expect(stageEvents).toHaveLength(1);
  });
});
