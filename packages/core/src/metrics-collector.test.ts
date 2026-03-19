import { describe, it, expect, beforeEach } from "vitest";
import { MetricsCollector } from "./metrics-collector.js";

describe("MetricsCollector", () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  // 1. increment() creates counter at 0+value
  it("increment() creates counter at 0 + value", () => {
    metrics.increment("new_counter", 5);
    expect(metrics.getCounter("new_counter")).toBe(5);
  });

  // 2. increment() accumulates values
  it("increment() accumulates multiple calls", () => {
    metrics.increment("req_total", 3);
    metrics.increment("req_total", 7);
    expect(metrics.getCounter("req_total")).toBe(10);
  });

  // 3. increment() default increment is 1
  it("increment() default increment is 1", () => {
    metrics.increment("click_count");
    metrics.increment("click_count");
    expect(metrics.getCounter("click_count")).toBe(2);
  });

  // 4. record() sets gauge value
  it("record() sets gauge value", () => {
    metrics.record("memory_bytes", 1024);
    expect(metrics.getGauge("memory_bytes")).toBe(1024);
  });

  // 5. record() overwrites previous value
  it("record() overwrites previous gauge value", () => {
    metrics.record("cpu_usage", 0.4);
    metrics.record("cpu_usage", 0.9);
    expect(metrics.getGauge("cpu_usage")).toBe(0.9);
  });

  // 6. observe() adds to histogram
  it("observe() adds value to histogram", () => {
    metrics.observe("response_time", 0.25);
    metrics.observe("response_time", 0.5);
    const hist = metrics.getHistogram("response_time");
    expect(hist).toContain(0.25);
    expect(hist).toContain(0.5);
    expect(hist).toHaveLength(2);
  });

  // 7. recordTiming() adds timing
  it("recordTiming() adds duration to timings", () => {
    metrics.recordTiming("build_duration_ms", 1500);
    metrics.recordTiming("build_duration_ms", 2300);
    const timings = metrics.getTimings("build_duration_ms");
    expect(timings).toContain(1500);
    expect(timings).toContain(2300);
    expect(timings).toHaveLength(2);
  });

  // 8. getCounter() returns value
  it("getCounter() returns stored counter value", () => {
    metrics.increment("errors", 42);
    expect(metrics.getCounter("errors")).toBe(42);
  });

  // 9. getGauge() returns value or undefined
  it("getGauge() returns undefined for unknown metric", () => {
    expect(metrics.getGauge("nonexistent")).toBeUndefined();
  });

  // 10. getHistogram() returns array
  it("getHistogram() returns empty array for unknown metric", () => {
    expect(metrics.getHistogram("missing")).toEqual([]);
  });

  // 11. toPrometheus() returns non-empty string
  it("toPrometheus() returns non-empty string when metrics recorded", () => {
    metrics.register({
      name: "http_requests",
      help: "Total HTTP requests",
      type: "counter",
    });
    metrics.increment("http_requests", 10);
    const output = metrics.toPrometheus();
    expect(output.length).toBeGreaterThan(0);
  });

  // 12. toPrometheus() contains metric names
  it("toPrometheus() contains registered metric names", () => {
    metrics.register({
      name: "active_connections",
      help: "Current active connections",
      type: "gauge",
    });
    metrics.record("active_connections", 5);
    const output = metrics.toPrometheus();
    expect(output).toContain("active_connections");
    expect(output).toContain("# HELP active_connections");
    expect(output).toContain("# TYPE active_connections gauge");
  });

  // 13. toJSON() returns object with metrics
  it("toJSON() returns object containing counters and gauges", () => {
    metrics.increment("items_processed", 100);
    metrics.record("queue_depth", 3);
    const json = metrics.toJSON();
    expect(json).toHaveProperty("counters");
    expect(json).toHaveProperty("gauges");
    const counters = json["counters"] as Record<string, number>;
    const gauges = json["gauges"] as Record<string, number>;
    expect(counters["items_processed"]).toBe(100);
    expect(gauges["queue_depth"]).toBe(3);
  });

  // 14. reset() clears counters/gauges
  it("reset() clears all metric values", () => {
    metrics.register({
      name: "tasks_run",
      help: "Tasks executed",
      type: "counter",
    });
    metrics.increment("tasks_run", 50);
    metrics.record("temperature", 37.5);
    metrics.reset();
    expect(metrics.getCounter("tasks_run")).toBe(0);
    expect(metrics.getGauge("temperature")).toBeUndefined();
    // Definitions should survive the reset
    const json = metrics.toJSON();
    const defs = json["definitions"] as Record<string, unknown>;
    expect(defs["tasks_run"]).toBeDefined();
  });

  // 15. computePercentile() returns correct p50/p95
  it("computePercentile() returns correct p50 and p95", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p50 = metrics.computePercentile(values, 50);
    const p95 = metrics.computePercentile(values, 95);

    // p50 of [1..10] ≈ 5.5
    expect(p50).toBeCloseTo(5.5, 1);
    // p95 of [1..10] ≈ 9.55
    expect(p95).toBeCloseTo(9.55, 1);
  });
});
