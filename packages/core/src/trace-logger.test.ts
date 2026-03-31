import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TraceLogger, getGlobalTraceLogger, setGlobalTraceLogger } from "./trace-logger.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("TraceLogger", () => {
  let tmpDir: string;
  let logger: TraceLogger;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "trace-logger-test-"));
    logger = new TraceLogger({
      projectRoot: tmpDir,
      enabled: true,
      logToFile: false, // Disable file I/O for speed
      logToConsole: false,
      autoFlushMs: 0, // Disable auto-flush
    });
  });

  afterEach(async () => {
    await logger.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("startSpan", () => {
    it("creates a new span", () => {
      const span = logger.startSpan("test-span", "agent");

      expect(span.spanId).toBeDefined();
      expect(span.traceId).toBeDefined();
      expect(span.name).toBe("test-span");
      expect(span.type).toBe("agent");
      expect(span.status).toBe("pending");
      expect(span.startTime).toBeDefined();
    });

    it("supports custom trace ID", () => {
      const customTraceId = "custom-trace-123";
      const span = logger.startSpan("test", "agent", { traceId: customTraceId });

      expect(span.traceId).toBe(customTraceId);
    });

    it("supports parent span", () => {
      const parent = logger.startSpan("parent", "agent");
      const child = logger.startSpan("child", "tool", {
        traceId: parent.traceId,
        parentSpanId: parent.spanId,
      });

      expect(child.parentSpanId).toBe(parent.spanId);
      expect(child.traceId).toBe(parent.traceId);
    });

    it("stores input and metadata", () => {
      const input = { foo: "bar" };
      const metadata = { model: "gpt-4" };
      const span = logger.startSpan("test", "agent", { input, metadata });

      expect(span.input).toEqual(input);
      expect(span.metadata).toEqual(metadata);
    });
  });

  describe("endSpan", () => {
    it("marks span as complete", () => {
      const span = logger.startSpan("test", "agent");
      logger.endSpan(span.spanId, { status: "success", output: { result: "ok" } });

      const trace = logger.getTrace(span.traceId);
      expect(trace).not.toBeNull();
      expect(trace!.spans[0]!.status).toBe("success");
      expect(trace!.spans[0]!.output).toEqual({ result: "ok" });
      expect(trace!.spans[0]!.endTime).toBeDefined();
      expect(trace!.spans[0]!.durationMs).toBeGreaterThanOrEqual(0); // Can be 0ms if very fast
    });

    it("records error information", () => {
      const span = logger.startSpan("test", "agent");
      const error = { message: "Test error", stack: "stack trace", code: "ERR_TEST" };
      logger.endSpan(span.spanId, { status: "error", error });

      const trace = logger.getTrace(span.traceId);
      expect(trace!.spans[0]!.status).toBe("error");
      expect(trace!.spans[0]!.error).toEqual(error);
    });

    it("merges metadata", () => {
      const span = logger.startSpan("test", "agent", { metadata: { a: 1 } });
      logger.endSpan(span.spanId, { metadata: { b: 2 } });

      const trace = logger.getTrace(span.traceId);
      expect(trace!.spans[0]!.metadata).toEqual({ a: 1, b: 2 });
    });
  });

  describe("logEvent", () => {
    it("logs events to span", () => {
      const span = logger.startSpan("test", "agent");
      logger.logEvent(span.spanId, "info", "Test message", { data: "value" });

      const trace = logger.getTrace(span.traceId);
      expect(trace!.totalEvents).toBe(1);
      expect(trace!.events[0]!.level).toBe("info");
      expect(trace!.events[0]!.message).toBe("Test message");
      expect(trace!.events[0]!.data).toEqual({ data: "value" });
    });

    it("supports multiple events", () => {
      const span = logger.startSpan("test", "agent");
      logger.logEvent(span.spanId, "debug", "Event 1");
      logger.logEvent(span.spanId, "info", "Event 2");
      logger.logEvent(span.spanId, "error", "Event 3");

      const trace = logger.getTrace(span.traceId);
      expect(trace!.totalEvents).toBe(3);
    });
  });

  describe("logDecision", () => {
    it("logs decision points", () => {
      const span = logger.startSpan("test", "agent");
      const options = [
        { name: "option-a", score: 0.8, reason: "Fast" },
        { name: "option-b", score: 0.6, reason: "Slow" },
      ];
      logger.logDecision(span.spanId, "model-selection", options, "option-a", "Fastest", 0.9);

      const trace = logger.getTrace(span.traceId);
      expect(trace!.totalDecisions).toBe(1);
      expect(trace!.decisions[0]!.point).toBe("model-selection");
      expect(trace!.decisions[0]!.selected).toBe("option-a");
      expect(trace!.decisions[0]!.reason).toBe("Fastest");
      expect(trace!.decisions[0]!.confidence).toBe(0.9);
      expect(trace!.decisions[0]!.options).toEqual(options);
    });
  });

  describe("getTrace", () => {
    it("returns complete trace summary", () => {
      const span = logger.startSpan("root", "agent");
      logger.logEvent(span.spanId, "info", "Event 1");
      logger.logDecision(span.spanId, "test", [{ name: "a" }], "a", "test");
      logger.endSpan(span.spanId);

      const trace = logger.getTrace(span.traceId);
      expect(trace).not.toBeNull();
      expect(trace!.traceId).toBe(span.traceId);
      expect(trace!.rootSpanId).toBe(span.spanId);
      expect(trace!.totalSpans).toBe(1);
      expect(trace!.totalEvents).toBe(1);
      expect(trace!.totalDecisions).toBe(1);
      expect(trace!.status).toBe("success");
    });

    it("handles nested spans", () => {
      const root = logger.startSpan("root", "agent");
      const child1 = logger.startSpan("child1", "tool", {
        traceId: root.traceId,
        parentSpanId: root.spanId,
      });
      const child2 = logger.startSpan("child2", "tool", {
        traceId: root.traceId,
        parentSpanId: root.spanId,
      });

      logger.endSpan(child1.spanId);
      logger.endSpan(child2.spanId);
      logger.endSpan(root.spanId);

      const trace = logger.getTrace(root.traceId);
      expect(trace!.totalSpans).toBe(3);
    });

    it("returns null for non-existent trace", () => {
      const trace = logger.getTrace("non-existent");
      expect(trace).toBeNull();
    });
  });

  describe("getActiveTraces", () => {
    it("returns active traces", () => {
      const span1 = logger.startSpan("test1", "agent");
      const span2 = logger.startSpan("test2", "agent");

      const active = logger.getActiveTraces();
      expect(active.length).toBe(2);
      expect(active.map((t) => t.traceId)).toContain(span1.traceId);
      expect(active.map((t) => t.traceId)).toContain(span2.traceId);
    });

    it("excludes completed traces", () => {
      const span1 = logger.startSpan("test1", "agent");
      const span2 = logger.startSpan("test2", "agent");

      logger.endSpan(span1.spanId);

      const active = logger.getActiveTraces();
      expect(active.length).toBe(1);
      expect(active[0]!.traceId).toBe(span2.traceId);
    });
  });

  describe("disabled logger", () => {
    it("returns no-op spans when disabled", () => {
      const disabledLogger = new TraceLogger({
        projectRoot: tmpDir,
        enabled: false,
      });

      const span = disabledLogger.startSpan("test", "agent");
      expect(span.spanId).toBe("noop");
      expect(span.traceId).toBe("noop");

      disabledLogger.logEvent(span.spanId, "info", "Test");
      disabledLogger.logDecision(span.spanId, "test", [], "a", "test");
      disabledLogger.endSpan(span.spanId);

      const trace = disabledLogger.getTrace(span.traceId);
      expect(trace).toBeNull();
    });
  });

  describe("global logger", () => {
    afterEach(() => {
      // Reset global state
      setGlobalTraceLogger(null as any);
    });

    it("creates global logger", () => {
      const global = getGlobalTraceLogger({ projectRoot: tmpDir });
      expect(global).toBeDefined();
    });

    it("reuses global logger", () => {
      const global1 = getGlobalTraceLogger({ projectRoot: tmpDir });
      const global2 = getGlobalTraceLogger();
      expect(global2).toBe(global1);
    });

    it("throws if accessed before init", () => {
      expect(() => getGlobalTraceLogger()).toThrow();
    });
  });

  describe("performance", () => {
    it("handles many spans efficiently", () => {
      const start = Date.now();
      const root = logger.startSpan("root", "agent");

      for (let i = 0; i < 100; i++) {
        const child = logger.startSpan(`child-${i}`, "tool", {
          traceId: root.traceId,
          parentSpanId: root.spanId,
        });
        logger.logEvent(child.spanId, "info", `Event ${i}`);
        logger.endSpan(child.spanId);
      }

      logger.endSpan(root.spanId);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100); // Should be very fast

      const trace = logger.getTrace(root.traceId);
      expect(trace!.totalSpans).toBe(101);
      expect(trace!.totalEvents).toBe(100);
    });
  });
});
