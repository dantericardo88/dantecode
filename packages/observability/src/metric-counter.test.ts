/**
 * metric-counter.test.ts
 *
 * Tests for MetricCounter
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MetricCounter } from "./metric-counter.js";

describe("MetricCounter", () => {
  let counter: MetricCounter;

  beforeEach(() => {
    counter = new MetricCounter();
  });

  describe("increment", () => {
    it("increments a counter by 1 by default", () => {
      counter.increment("requests");
      expect(counter.get("requests")).toBe(1);
    });

    it("increments a counter by specified value", () => {
      counter.increment("bytes", 1024);
      expect(counter.get("bytes")).toBe(1024);
    });

    it("accumulates multiple increments", () => {
      counter.increment("requests");
      counter.increment("requests");
      counter.increment("requests", 3);
      expect(counter.get("requests")).toBe(5);
    });

    it("starts from 0 for new counters", () => {
      counter.increment("new_counter");
      expect(counter.get("new_counter")).toBe(1);
    });
  });

  describe("decrement", () => {
    it("decrements a counter by 1 by default", () => {
      counter.increment("requests", 10);
      counter.decrement("requests");
      expect(counter.get("requests")).toBe(9);
    });

    it("decrements a counter by specified value", () => {
      counter.increment("requests", 10);
      counter.decrement("requests", 5);
      expect(counter.get("requests")).toBe(5);
    });

    it("can decrement below zero", () => {
      counter.decrement("requests", 5);
      expect(counter.get("requests")).toBe(-5);
    });
  });

  describe("gauge", () => {
    it("sets a gauge to a specific value", () => {
      counter.gauge("cpu_usage", 75.5);
      expect(counter.get("cpu_usage")).toBe(75.5);
    });

    it("overwrites previous gauge value", () => {
      counter.gauge("memory", 100);
      counter.gauge("memory", 200);
      expect(counter.get("memory")).toBe(200);
    });

    it("can set gauge to zero", () => {
      counter.gauge("idle_workers", 0);
      expect(counter.get("idle_workers")).toBe(0);
    });

    it("can set negative gauge values", () => {
      counter.gauge("temperature", -10);
      expect(counter.get("temperature")).toBe(-10);
    });
  });

  describe("get", () => {
    it("returns undefined for non-existent metric", () => {
      expect(counter.get("nonexistent")).toBeUndefined();
    });

    it("returns counter value", () => {
      counter.increment("count", 42);
      expect(counter.get("count")).toBe(42);
    });

    it("returns gauge value", () => {
      counter.gauge("level", 99);
      expect(counter.get("level")).toBe(99);
    });
  });

  describe("getCounters", () => {
    it("returns empty object when no counters", () => {
      expect(counter.getCounters()).toEqual({});
    });

    it("returns all counters", () => {
      counter.increment("a", 1);
      counter.increment("b", 2);
      expect(counter.getCounters()).toEqual({ a: 1, b: 2 });
    });

    it("does not include gauges", () => {
      counter.increment("counter", 1);
      counter.gauge("gauge", 2);
      expect(counter.getCounters()).toEqual({ counter: 1 });
    });
  });

  describe("getGauges", () => {
    it("returns empty object when no gauges", () => {
      expect(counter.getGauges()).toEqual({});
    });

    it("returns all gauges", () => {
      counter.gauge("a", 10);
      counter.gauge("b", 20);
      expect(counter.getGauges()).toEqual({ a: 10, b: 20 });
    });

    it("does not include counters", () => {
      counter.increment("counter", 1);
      counter.gauge("gauge", 2);
      expect(counter.getGauges()).toEqual({ gauge: 2 });
    });
  });

  describe("getMetrics", () => {
    it("returns empty object when no metrics", () => {
      expect(counter.getMetrics()).toEqual({});
    });

    it("returns both counters and gauges", () => {
      counter.increment("requests", 100);
      counter.gauge("cpu", 75);
      expect(counter.getMetrics()).toEqual({
        requests: 100,
        cpu: 75,
      });
    });
  });

  describe("getMetricsDetailed", () => {
    it("returns empty array when no metrics", () => {
      expect(counter.getMetricsDetailed()).toEqual([]);
    });

    it("returns detailed metric information", () => {
      counter.increment("requests", 10);
      counter.gauge("cpu", 50);

      const metrics = counter.getMetricsDetailed();
      expect(metrics).toHaveLength(2);

      const requestsMetric = metrics.find((m) => m.name === "requests");
      expect(requestsMetric).toBeDefined();
      expect(requestsMetric!.value).toBe(10);
      expect(requestsMetric!.type).toBe("counter");
      expect(requestsMetric!.timestamp).toBeGreaterThan(0);

      const cpuMetric = metrics.find((m) => m.name === "cpu");
      expect(cpuMetric).toBeDefined();
      expect(cpuMetric!.value).toBe(50);
      expect(cpuMetric!.type).toBe("gauge");
    });
  });

  describe("reset", () => {
    it("resets a counter", () => {
      counter.increment("requests", 10);
      const result = counter.reset("requests");
      expect(result).toBe(true);
      expect(counter.get("requests")).toBeUndefined();
    });

    it("resets a gauge", () => {
      counter.gauge("cpu", 75);
      const result = counter.reset("cpu");
      expect(result).toBe(true);
      expect(counter.get("cpu")).toBeUndefined();
    });

    it("returns false for non-existent metric", () => {
      const result = counter.reset("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("resetAll", () => {
    it("resets all metrics", () => {
      counter.increment("a", 1);
      counter.increment("b", 2);
      counter.gauge("c", 3);
      counter.resetAll();

      expect(counter.size()).toBe(0);
      expect(counter.getMetrics()).toEqual({});
    });

    it("works when no metrics exist", () => {
      counter.resetAll();
      expect(counter.size()).toBe(0);
    });
  });

  describe("size", () => {
    it("returns 0 when no metrics", () => {
      expect(counter.size()).toBe(0);
    });

    it("counts both counters and gauges", () => {
      counter.increment("a");
      counter.increment("b");
      counter.gauge("c", 10);
      expect(counter.size()).toBe(3);
    });

    it("updates after reset", () => {
      counter.increment("a");
      counter.increment("b");
      expect(counter.size()).toBe(2);
      counter.reset("a");
      expect(counter.size()).toBe(1);
    });
  });
});
