/**
 * Observability, health monitoring, and PDSE-gated production readiness engine.
 *
 * Responsibilities:
 * - Recording and querying time-series metrics
 * - Computing statistical aggregates (min/max/avg/p95)
 * - Running extensible health checks
 * - PDSE score gating for production promotion decisions
 * - Human-readable health report formatting
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single recorded metric data point. */
export interface ProductionMetric {
  /** Metric name, e.g. "api.latency". */
  name: string;
  /** Numeric measurement. */
  value: number;
  /** Unit of measurement, e.g. "ms", "bytes", "count". */
  unit: string;
  /** ISO-8601 timestamp of when the metric was recorded. */
  timestamp: string;
  /** Arbitrary key-value labels for slicing/dicing. */
  tags: Record<string, string>;
}

/** Overall health status of the system. */
export interface HealthStatus {
  /** Aggregate health outcome. */
  status: "healthy" | "degraded" | "unhealthy";
  /** Individual check results. */
  checks: HealthCheck[];
  /** ISO-8601 timestamp of the health evaluation. */
  timestamp: string;
  /** PDSE score passed into this evaluation (0-1). */
  pdseScore: number;
}

/** Result of a single health check. */
export interface HealthCheck {
  /** Unique name for this check. */
  name: string;
  /** Outcome of the check. */
  status: "pass" | "fail" | "warn";
  /** Human-readable description of the result. */
  message: string;
  /** Optional latency in milliseconds for the check itself. */
  latencyMs?: number;
}

/** Aggregate statistics for a named metric. */
export interface MetricAggregates {
  min: number;
  max: number;
  avg: number;
  /** 95th-percentile value. */
  p95: number;
  count: number;
}

/** Construction options for {@link ProductionEngine}. */
export interface ProductionEngineOptions {
  /**
   * Minimum PDSE score required for a "healthy" gate decision.
   * Default: 0.7
   */
  healthThreshold?: number;
  /**
   * Maximum number of metric data points to retain in memory.
   * Oldest entries are evicted when the limit is exceeded.
   * Default: 1000
   */
  maxMetrics?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Compute the p95 of a sorted array (must be sorted ascending). */
function p95Sorted(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)] as number;
}

// ---------------------------------------------------------------------------
// ProductionEngine
// ---------------------------------------------------------------------------

/**
 * Central engine for production observability and readiness gating.
 *
 * @example
 * ```typescript
 * const engine = new ProductionEngine({ healthThreshold: 0.75 });
 * engine.recordMetric("http.latency", 42, "ms", { route: "/api/v1" });
 * const status = engine.healthCheck(pdseScore);
 * if (!engine.pdseHealthGate(pdseScore)) throw new Error("Not production-ready");
 * ```
 */
export class ProductionEngine {
  private metrics: ProductionMetric[] = [];
  private readonly customChecks: Map<string, () => HealthCheck> = new Map();
  private readonly options: Required<ProductionEngineOptions>;

  constructor(options: ProductionEngineOptions = {}) {
    this.options = {
      healthThreshold: options.healthThreshold ?? 0.7,
      maxMetrics: options.maxMetrics ?? 1000,
    };
  }

  // -------------------------------------------------------------------------
  // Metric ingestion
  // -------------------------------------------------------------------------

  /**
   * Record a metric data point.
   *
   * If the internal buffer exceeds `maxMetrics`, the oldest entry is evicted
   * before the new one is appended.
   *
   * @param name  - Metric name.
   * @param value - Numeric measurement.
   * @param unit  - Unit string (default: "count").
   * @param tags  - Optional label map.
   */
  recordMetric(
    name: string,
    value: number,
    unit = "count",
    tags: Record<string, string> = {},
  ): void {
    if (this.metrics.length >= this.options.maxMetrics) {
      this.metrics.shift(); // evict oldest
    }

    this.metrics.push({
      name,
      value,
      unit,
      timestamp: new Date().toISOString(),
      tags,
    });
  }

  // -------------------------------------------------------------------------
  // Metric queries
  // -------------------------------------------------------------------------

  /**
   * Retrieve recorded metrics, optionally filtered by name and/or time.
   *
   * @param name  - When provided, only metrics with this exact name are returned.
   * @param since - When provided, only metrics recorded at or after this date.
   * @returns Matching metric data points in insertion order.
   */
  getMetrics(name?: string, since?: Date): ProductionMetric[] {
    let results = this.metrics;

    if (name !== undefined) {
      results = results.filter((m) => m.name === name);
    }

    if (since !== undefined) {
      const sinceMs = since.getTime();
      results = results.filter((m) => new Date(m.timestamp).getTime() >= sinceMs);
    }

    return results;
  }

  /**
   * Compute statistical aggregates for all data points matching `name`.
   *
   * Returns zeros for all fields when no matching metrics exist.
   *
   * @param name - Metric name to aggregate.
   */
  computeAggregates(name: string): MetricAggregates {
    const values = this.metrics
      .filter((m) => m.name === name)
      .map((m) => m.value);

    if (values.length === 0) {
      return { min: 0, max: 0, avg: 0, p95: 0, count: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((acc, v) => acc + v, 0);

    return {
      min: sorted[0] as number,
      max: sorted[sorted.length - 1] as number,
      avg: sum / values.length,
      p95: p95Sorted(sorted),
      count: values.length,
    };
  }

  // -------------------------------------------------------------------------
  // Health checks
  // -------------------------------------------------------------------------

  /**
   * Run all registered health checks plus built-in checks, returning a
   * {@link HealthStatus} summary.
   *
   * Built-in checks:
   * - **metrics_count**: Warns when > 800 metrics are buffered (approaching limit).
   * - **memory**: Checks heap usage against a 90% threshold.
   *
   * Overall status:
   * - `"unhealthy"` — any check failed.
   * - `"degraded"` — any check warned (but none failed).
   * - `"healthy"` — all checks passed.
   *
   * @param pdseScore - Optional PDSE score (0-1) to record in the status object.
   *                    Defaults to 0 when omitted.
   */
  healthCheck(pdseScore = 0): HealthStatus {
    const checks: HealthCheck[] = [];

    // Built-in: metrics buffer utilisation
    const bufferPct = (this.metrics.length / this.options.maxMetrics) * 100;
    if (bufferPct >= 100) {
      checks.push({
        name: "metrics_count",
        status: "fail",
        message: `Metrics buffer is full (${this.metrics.length}/${this.options.maxMetrics})`,
      });
    } else if (bufferPct >= 80) {
      checks.push({
        name: "metrics_count",
        status: "warn",
        message: `Metrics buffer is ${bufferPct.toFixed(0)}% full (${this.metrics.length}/${this.options.maxMetrics})`,
      });
    } else {
      checks.push({
        name: "metrics_count",
        status: "pass",
        message: `Metrics buffer healthy: ${this.metrics.length}/${this.options.maxMetrics}`,
      });
    }

    // Built-in: heap memory
    const mem = process.memoryUsage();
    const heapPct = (mem.heapUsed / mem.heapTotal) * 100;
    if (heapPct >= 95) {
      checks.push({
        name: "memory",
        status: "fail",
        message: `Heap usage critical: ${heapPct.toFixed(1)}%`,
        latencyMs: 0,
      });
    } else if (heapPct >= 80) {
      checks.push({
        name: "memory",
        status: "warn",
        message: `Heap usage elevated: ${heapPct.toFixed(1)}%`,
        latencyMs: 0,
      });
    } else {
      checks.push({
        name: "memory",
        status: "pass",
        message: `Heap usage nominal: ${heapPct.toFixed(1)}%`,
        latencyMs: 0,
      });
    }

    // Custom checks
    for (const [, checkFn] of this.customChecks) {
      const start = Date.now();
      try {
        const result = checkFn();
        const latencyMs = Date.now() - start;
        checks.push({ ...result, latencyMs: result.latencyMs ?? latencyMs });
      } catch (err) {
        checks.push({
          name: "unknown",
          status: "fail",
          message: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Aggregate status
    let status: HealthStatus["status"] = "healthy";
    for (const check of checks) {
      if (check.status === "fail") {
        status = "unhealthy";
        break;
      }
      if (check.status === "warn" && status === "healthy") {
        status = "degraded";
      }
    }

    return {
      status,
      checks,
      timestamp: new Date().toISOString(),
      pdseScore,
    };
  }

  /**
   * Gate a production promotion decision based on the PDSE score.
   *
   * @param pdseScore - Score in the range [0, 1].
   * @returns `true` when the score meets or exceeds the configured threshold.
   */
  pdseHealthGate(pdseScore: number): boolean {
    return pdseScore >= this.options.healthThreshold;
  }

  // -------------------------------------------------------------------------
  // Check registry
  // -------------------------------------------------------------------------

  /**
   * Register a custom health check function.
   *
   * If a check with the same name already exists it will be overwritten.
   *
   * @param name    - Unique name for this check.
   * @param checkFn - Synchronous function returning a {@link HealthCheck}.
   */
  registerCheck(name: string, checkFn: () => HealthCheck): void {
    this.customChecks.set(name, checkFn);
  }

  /**
   * Remove a previously registered custom check.
   *
   * @param name - Name of the check to remove.
   * @returns `true` when the check was found and removed, `false` otherwise.
   */
  unregisterCheck(name: string): boolean {
    return this.customChecks.delete(name);
  }

  // -------------------------------------------------------------------------
  // Maintenance
  // -------------------------------------------------------------------------

  /** Remove all buffered metrics. */
  clearMetrics(): void {
    this.metrics = [];
  }

  // -------------------------------------------------------------------------
  // System info
  // -------------------------------------------------------------------------

  /**
   * Return current process memory usage figures.
   *
   * Delegates directly to `process.memoryUsage()`.
   */
  getMemoryUsage(): {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  } {
    const { heapUsed, heapTotal, rss, external } = process.memoryUsage();
    return { heapUsed, heapTotal, rss, external };
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  /**
   * Format a {@link HealthStatus} as a human-readable text report.
   *
   * @param status - The health status to format.
   * @returns A multi-line string report.
   */
  formatHealthReport(status: HealthStatus): string {
    const statusIcon =
      status.status === "healthy"
        ? "[OK]"
        : status.status === "degraded"
          ? "[WARN]"
          : "[FAIL]";

    const lines: string[] = [
      `Health Report — ${status.timestamp}`,
      `Status: ${statusIcon} ${status.status.toUpperCase()}`,
      `PDSE Score: ${(status.pdseScore * 100).toFixed(1)}%`,
      "",
      "Checks:",
    ];

    for (const check of status.checks) {
      const icon =
        check.status === "pass" ? "  +" : check.status === "warn" ? "  ?" : "  !";
      const latency =
        check.latencyMs !== undefined ? ` (${check.latencyMs}ms)` : "";
      lines.push(`${icon} ${check.name}: ${check.message}${latency}`);
    }

    return lines.join("\n");
  }
}

// Re-export randomUUID for any consumers that import from this module
export { randomUUID };
