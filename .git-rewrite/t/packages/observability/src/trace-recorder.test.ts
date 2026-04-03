/**
 * trace-recorder.test.ts
 *
 * Tests for TraceRecorder
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TraceRecorder } from "./trace-recorder.js";

describe("TraceRecorder", () => {
  let recorder: TraceRecorder;

  beforeEach(() => {
    recorder = new TraceRecorder();
  });

  describe("startSpan", () => {
    it("creates a new span with unique ID", () => {
      const span = recorder.startSpan("test.operation");
      expect(span.id).toBeDefined();
      expect(span.name).toBe("test.operation");
      expect(span.status).toBe("in_progress");
      expect(span.startTime).toBeGreaterThan(0);
    });

    it("creates span with attributes", () => {
      const span = recorder.startSpan("test.operation", { userId: "123", method: "GET" });
      expect(span.attributes).toEqual({ userId: "123", method: "GET" });
    });

    it("creates nested span with parent ID", () => {
      const parent = recorder.startSpan("parent");
      const child = recorder.startSpan("child", {}, parent.id);
      expect(child.parentId).toBe(parent.id);
    });

    it("creates new trace for root span", () => {
      recorder.startSpan("root");
      expect(recorder.traceCount()).toBe(1);
    });

    it("reuses trace for nested spans", () => {
      const parent = recorder.startSpan("parent");
      recorder.startSpan("child", {}, parent.id);
      expect(recorder.traceCount()).toBe(1);
    });
  });

  describe("endSpan", () => {
    it("marks span as completed", () => {
      const span = recorder.startSpan("test");
      recorder.endSpan(span.id);

      const retrieved = recorder.getSpan(span.id);
      expect(retrieved!.status).toBe("completed");
      expect(retrieved!.endTime).toBeDefined();
      expect(retrieved!.duration).toBeGreaterThanOrEqual(0);
    });

    it("marks span as error when error provided", () => {
      const span = recorder.startSpan("test");
      const error = new Error("test error");
      recorder.endSpan(span.id, error);

      const retrieved = recorder.getSpan(span.id);
      expect(retrieved!.status).toBe("error");
      expect(retrieved!.error).toBe(error);
    });

    it("removes span from active spans", () => {
      const span = recorder.startSpan("test");
      expect(recorder.activeSpanCount()).toBe(1);
      recorder.endSpan(span.id);
      expect(recorder.activeSpanCount()).toBe(0);
    });

    it("handles ending non-existent span gracefully", () => {
      expect(() => recorder.endSpan("nonexistent")).not.toThrow();
    });

    it("updates trace end time when all spans complete", () => {
      const span = recorder.startSpan("test");
      const traceSpans = recorder.getTraceSpans(Array.from(recorder.getTraces())[0]!.traceId);
      expect(traceSpans[0]!.id).toBe(span.id);

      recorder.endSpan(span.id);

      const trace = recorder.getTraces()[0];
      expect(trace!.endTime).toBeDefined();
      expect(trace!.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getSpan", () => {
    it("retrieves span by ID", () => {
      const span = recorder.startSpan("test", { key: "value" });
      const retrieved = recorder.getSpan(span.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("test");
      expect(retrieved!.attributes).toEqual({ key: "value" });
    });

    it("returns undefined for non-existent span", () => {
      expect(recorder.getSpan("nonexistent")).toBeUndefined();
    });
  });

  describe("getTraceSpans", () => {
    it("returns all spans for a trace", () => {
      const parent = recorder.startSpan("parent");
      const child1 = recorder.startSpan("child1", {}, parent.id);
      const child2 = recorder.startSpan("child2", {}, parent.id);

      const traceId = recorder.getTraces()[0]!.traceId;
      const spans = recorder.getTraceSpans(traceId);

      expect(spans).toHaveLength(3);
      expect(spans.map((s) => s.name)).toEqual(["parent", "child1", "child2"]);
    });

    it("returns empty array for non-existent trace", () => {
      expect(recorder.getTraceSpans("nonexistent")).toEqual([]);
    });
  });

  describe("getTrace", () => {
    it("retrieves complete trace record", () => {
      recorder.startSpan("test");
      const traces = recorder.getTraces();
      expect(traces).toHaveLength(1);

      const trace = recorder.getTrace(traces[0]!.traceId);
      expect(trace).toBeDefined();
      expect(trace!.spans).toHaveLength(1);
    });

    it("returns undefined for non-existent trace", () => {
      expect(recorder.getTrace("nonexistent")).toBeUndefined();
    });
  });

  describe("getTraces", () => {
    it("returns empty array when no traces", () => {
      expect(recorder.getTraces()).toEqual([]);
    });

    it("returns all trace records", () => {
      recorder.startSpan("trace1");
      recorder.startSpan("trace2");
      expect(recorder.getTraces()).toHaveLength(2);
    });
  });

  describe("getActiveSpans", () => {
    it("returns active spans", () => {
      const span1 = recorder.startSpan("active1");
      const span2 = recorder.startSpan("active2");

      const active = recorder.getActiveSpans();
      expect(active).toHaveLength(2);
      expect(active.map((s) => s.id)).toContain(span1.id);
      expect(active.map((s) => s.id)).toContain(span2.id);
    });

    it("does not include completed spans", () => {
      const span1 = recorder.startSpan("active");
      const span2 = recorder.startSpan("completed");
      recorder.endSpan(span2.id);

      const active = recorder.getActiveSpans();
      expect(active).toHaveLength(1);
      expect(active[0]!.id).toBe(span1.id);
    });
  });

  describe("clear", () => {
    it("clears all traces and spans", () => {
      recorder.startSpan("test1");
      recorder.startSpan("test2");
      expect(recorder.traceCount()).toBe(2);
      expect(recorder.activeSpanCount()).toBe(2);

      recorder.clear();

      expect(recorder.traceCount()).toBe(0);
      expect(recorder.activeSpanCount()).toBe(0);
      expect(recorder.getTraces()).toEqual([]);
    });
  });

  describe("traceCount", () => {
    it("returns 0 when no traces", () => {
      expect(recorder.traceCount()).toBe(0);
    });

    it("counts traces", () => {
      recorder.startSpan("trace1");
      recorder.startSpan("trace2");
      expect(recorder.traceCount()).toBe(2);
    });
  });

  describe("activeSpanCount", () => {
    it("returns 0 when no active spans", () => {
      expect(recorder.activeSpanCount()).toBe(0);
    });

    it("counts active spans", () => {
      recorder.startSpan("span1");
      recorder.startSpan("span2");
      expect(recorder.activeSpanCount()).toBe(2);
    });

    it("decrements when spans end", () => {
      const span = recorder.startSpan("test");
      expect(recorder.activeSpanCount()).toBe(1);
      recorder.endSpan(span.id);
      expect(recorder.activeSpanCount()).toBe(0);
    });
  });

  describe("withSpan", () => {
    it("executes function within span", async () => {
      const result = await recorder.withSpan("test", async () => {
        return 42;
      });

      expect(result).toBe(42);
      expect(recorder.traceCount()).toBe(1);
      expect(recorder.activeSpanCount()).toBe(0); // Span should be completed
    });

    it("marks span as completed on success", async () => {
      await recorder.withSpan("test", async () => {
        return "success";
      });

      const trace = recorder.getTraces()[0];
      expect(trace!.spans[0]!.status).toBe("completed");
    });

    it("marks span as error on failure", async () => {
      await expect(
        recorder.withSpan("test", async () => {
          throw new Error("test error");
        }),
      ).rejects.toThrow("test error");

      const trace = recorder.getTraces()[0];
      expect(trace!.spans[0]!.status).toBe("error");
      expect(trace!.spans[0]!.error).toBeDefined();
    });

    it("supports nested withSpan calls", async () => {
      await recorder.withSpan("outer", async () => {
        const outerSpan = recorder.getActiveSpans()[0];
        await recorder.withSpan(
          "inner",
          async () => {
            return "nested";
          },
          {},
          outerSpan!.id,
        );
      });

      const trace = recorder.getTraces()[0];
      expect(trace!.spans).toHaveLength(2);
      expect(trace!.spans[1]!.parentId).toBe(trace!.spans[0]!.id);
    });
  });
});
