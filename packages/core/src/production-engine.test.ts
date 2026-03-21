import { describe, it, expect, beforeEach } from "vitest";
import { ProductionEngine } from "./production-engine.js";
import type { HealthCheck } from "./production-engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEngine(opts?: ConstructorParameters<typeof ProductionEngine>[0]) {
  return new ProductionEngine(opts);
}

/** Return a check function that always passes. */
function passingCheck(name: string): () => HealthCheck {
  return () => ({ name, status: "pass", message: "All good" });
}

/** Return a check function that always warns. */
function warningCheck(name: string): () => HealthCheck {
  return () => ({ name, status: "warn", message: "Watch out" });
}

/** Return a check function that always fails. */
function failingCheck(name: string): () => HealthCheck {
  return () => ({ name, status: "fail", message: "Something broke" });
}

// ---------------------------------------------------------------------------
// recordMetric()
// ---------------------------------------------------------------------------

describe("ProductionEngine.recordMetric()", () => {
  let engine: ProductionEngine;

  beforeEach(() => {
    engine = makeEngine();
  });

  it("1. stores a metric", () => {
    engine.recordMetric("cpu.usage", 42, "percent");
    const metrics = engine.getMetrics("cpu.usage");
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.value).toBe(42);
    expect(metrics[0]!.unit).toBe("percent");
  });

  it("2. enforces maxMetrics limit by evicting oldest", () => {
    engine = makeEngine({ maxMetrics: 3 });
    engine.recordMetric("m", 1);
    engine.recordMetric("m", 2);
    engine.recordMetric("m", 3);
    engine.recordMetric("m", 4); // should evict value=1

    const all = engine.getMetrics("m");
    expect(all).toHaveLength(3);
    expect(all.map((m) => m.value)).toEqual([2, 3, 4]);
  });

  it("3. sets a valid ISO-8601 timestamp", () => {
    engine.recordMetric("ts.test", 1);
    const [metric] = engine.getMetrics("ts.test");
    expect(metric).toBeDefined();
    const ts = new Date(metric!.timestamp);
    expect(ts.getTime()).not.toBeNaN();
  });

  it("26. stores custom tags", () => {
    engine.recordMetric("req", 1, "count", { route: "/api", method: "GET" });
    const [metric] = engine.getMetrics("req");
    expect(metric!.tags).toEqual({ route: "/api", method: "GET" });
  });
});

// ---------------------------------------------------------------------------
// getMetrics()
// ---------------------------------------------------------------------------

describe("ProductionEngine.getMetrics()", () => {
  let engine: ProductionEngine;

  beforeEach(() => {
    engine = makeEngine();
    engine.recordMetric("alpha", 1);
    engine.recordMetric("beta", 2);
    engine.recordMetric("alpha", 3);
  });

  it("4. returns all metrics when no filter is given", () => {
    expect(engine.getMetrics()).toHaveLength(3);
  });

  it("5. filters by name", () => {
    const results = engine.getMetrics("alpha");
    expect(results).toHaveLength(2);
    expect(results.every((m) => m.name === "alpha")).toBe(true);
  });

  it("6. filters by since date", () => {
    const before = new Date();
    // Record a metric slightly "in the future" by forcing a new entry after
    // establishing a reference timestamp
    engine.recordMetric("gamma", 99);
    const results = engine.getMetrics(undefined, before);

    // "gamma" should be included since it was recorded after `before`
    expect(results.some((m) => m.name === "gamma")).toBe(true);
  });

  it("28. since filter excludes metrics recorded before the date", () => {
    // All existing metrics were recorded before `now`; add one after
    const now = new Date(Date.now() + 1000); // 1 second in the future
    const results = engine.getMetrics(undefined, now);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeAggregates()
// ---------------------------------------------------------------------------

describe("ProductionEngine.computeAggregates()", () => {
  let engine: ProductionEngine;

  beforeEach(() => {
    engine = makeEngine();
  });

  it("7. computes min, max, and avg correctly", () => {
    [10, 20, 30, 40, 50].forEach((v) => engine.recordMetric("lat", v, "ms"));
    const agg = engine.computeAggregates("lat");

    expect(agg.min).toBe(10);
    expect(agg.max).toBe(50);
    expect(agg.avg).toBe(30);
  });

  it("8. computes p95 correctly", () => {
    // 20 values from 1..20; p95 of 20 sorted values: ceil(0.95*20)-1 = 18th (0-indexed) = value 19
    for (let i = 1; i <= 20; i++) engine.recordMetric("lat", i, "ms");
    const agg = engine.computeAggregates("lat");
    expect(agg.p95).toBe(19);
  });

  it("9. returns zeros for unknown metric name", () => {
    const agg = engine.computeAggregates("nonexistent");
    expect(agg).toEqual({ min: 0, max: 0, avg: 0, p95: 0, count: 0 });
  });

  it("25. aggregates multiple data points with same name", () => {
    engine.recordMetric("x", 100);
    engine.recordMetric("x", 200);
    engine.recordMetric("x", 300);
    const agg = engine.computeAggregates("x");
    expect(agg.count).toBe(3);
    expect(agg.avg).toBeCloseTo(200);
  });

  it("27. count reflects exact number of matching metrics", () => {
    for (let i = 0; i < 7; i++) engine.recordMetric("cnt", i);
    const agg = engine.computeAggregates("cnt");
    expect(agg.count).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// healthCheck()
// ---------------------------------------------------------------------------

describe("ProductionEngine.healthCheck()", () => {
  let engine: ProductionEngine;

  beforeEach(() => {
    engine = makeEngine();
  });

  it("10. returns a HealthStatus object", () => {
    const status = engine.healthCheck(0.8);
    expect(status).toHaveProperty("status");
    expect(status).toHaveProperty("checks");
    expect(status).toHaveProperty("timestamp");
    expect(status).toHaveProperty("pdseScore");
  });

  it("11. passes pdseScore through to HealthStatus", () => {
    const status = engine.healthCheck(0.42);
    expect(status.pdseScore).toBe(0.42);
  });

  it("12. status is healthy when all checks pass", () => {
    engine.registerCheck("custom", passingCheck("custom"));
    const status = engine.healthCheck(0.9);
    expect(status.status).toBe("healthy");
  });

  it("13. status is degraded when any check warns", () => {
    engine.registerCheck("custom", warningCheck("custom"));
    const status = engine.healthCheck(0.9);
    expect(status.status).toBe("degraded");
  });

  it("14. status is unhealthy when any check fails", () => {
    engine.registerCheck("custom", failingCheck("custom"));
    const status = engine.healthCheck(0.9);
    expect(status.status).toBe("unhealthy");
  });

  it("24. includes custom check results in checks array", () => {
    engine.registerCheck("my_check", passingCheck("my_check"));
    const status = engine.healthCheck(0.8);
    const names = status.checks.map((c) => c.name);
    expect(names).toContain("my_check");
  });

  it("29. uses 0 as default pdseScore when omitted", () => {
    const status = engine.healthCheck();
    expect(status.pdseScore).toBe(0);
  });

  it("30. custom check result is reflected in overall status", () => {
    engine.registerCheck("db", failingCheck("db"));
    const status = engine.healthCheck(1.0);
    const dbCheck = status.checks.find((c) => c.name === "db");
    expect(dbCheck).toBeDefined();
    expect(dbCheck!.status).toBe("fail");
    expect(status.status).toBe("unhealthy");
  });
});

// ---------------------------------------------------------------------------
// pdseHealthGate()
// ---------------------------------------------------------------------------

describe("ProductionEngine.pdseHealthGate()", () => {
  it("15. returns true when score meets threshold", () => {
    const engine = makeEngine({ healthThreshold: 0.7 });
    expect(engine.pdseHealthGate(0.7)).toBe(true);
    expect(engine.pdseHealthGate(0.9)).toBe(true);
  });

  it("16. returns false when score is below threshold", () => {
    const engine = makeEngine({ healthThreshold: 0.7 });
    expect(engine.pdseHealthGate(0.69)).toBe(false);
    expect(engine.pdseHealthGate(0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// registerCheck() / unregisterCheck()
// ---------------------------------------------------------------------------

describe("ProductionEngine check registry", () => {
  let engine: ProductionEngine;

  beforeEach(() => {
    engine = makeEngine();
  });

  it("17. registerCheck() adds a custom check", () => {
    engine.registerCheck("ping", passingCheck("ping"));
    const status = engine.healthCheck(1.0);
    expect(status.checks.map((c) => c.name)).toContain("ping");
  });

  it("18. unregisterCheck() removes the check and returns true", () => {
    engine.registerCheck("ping", passingCheck("ping"));
    const removed = engine.unregisterCheck("ping");
    expect(removed).toBe(true);

    const status = engine.healthCheck(1.0);
    expect(status.checks.map((c) => c.name)).not.toContain("ping");
  });

  it("19. unregisterCheck() returns false for unknown name", () => {
    expect(engine.unregisterCheck("does_not_exist")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clearMetrics()
// ---------------------------------------------------------------------------

describe("ProductionEngine.clearMetrics()", () => {
  it("20. empties the metrics buffer", () => {
    const engine = makeEngine();
    engine.recordMetric("x", 1);
    engine.recordMetric("y", 2);
    engine.clearMetrics();
    expect(engine.getMetrics()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getMemoryUsage()
// ---------------------------------------------------------------------------

describe("ProductionEngine.getMemoryUsage()", () => {
  it("21. returns heapUsed, heapTotal, rss, and external fields", () => {
    const engine = makeEngine();
    const mem = engine.getMemoryUsage();

    expect(typeof mem.heapUsed).toBe("number");
    expect(typeof mem.heapTotal).toBe("number");
    expect(typeof mem.rss).toBe("number");
    expect(typeof mem.external).toBe("number");
    expect(mem.heapUsed).toBeGreaterThan(0);
    expect(mem.heapTotal).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatHealthReport()
// ---------------------------------------------------------------------------

describe("ProductionEngine.formatHealthReport()", () => {
  let engine: ProductionEngine;

  beforeEach(() => {
    engine = makeEngine();
  });

  it("22. returns a non-empty string", () => {
    const status = engine.healthCheck(0.8);
    const report = engine.formatHealthReport(status);
    expect(typeof report).toBe("string");
    expect(report.length).toBeGreaterThan(0);
  });

  it("23. report contains the status word", () => {
    const status = engine.healthCheck(0.8);
    const report = engine.formatHealthReport(status);
    // status is one of healthy / degraded / unhealthy
    expect(report.toLowerCase()).toContain(status.status);
  });
});
