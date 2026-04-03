// ============================================================================
// @dantecode/cli — Serve: Prometheus Metrics Export
// Collects and exports server metrics in Prometheus text format.
// Tracks request counts, response times, PDSE scores, errors, and resources.
// ============================================================================

import type { SessionRecord } from "./routes.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestMetric {
  method: string;
  endpoint: string;
  status: number;
  duration: number;
  timestamp: number;
}

interface PDSEMetric {
  score: number;
  timestamp: number;
}

interface ErrorMetric {
  type: string;
  endpoint: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Metrics Store
// ---------------------------------------------------------------------------

/**
 * In-memory metrics collector for Prometheus export.
 * Tracks all key metrics: requests, response times, PDSE scores, errors, sessions.
 */
export class MetricsCollector {
  private requests: RequestMetric[] = [];
  private pdseScores: PDSEMetric[] = [];
  private errors: ErrorMetric[] = [];
  private startTime: number = Date.now();

  // Maximum retention: 1 hour of metrics to prevent unbounded memory growth
  private readonly MAX_AGE_MS = 60 * 60 * 1000;
  private readonly MAX_METRICS = 10_000;

  /**
   * Record an HTTP request completion.
   */
  recordRequest(method: string, endpoint: string, status: number, durationMs: number): void {
    this.requests.push({
      method,
      endpoint: this.normalizeEndpoint(endpoint),
      status,
      duration: durationMs,
      timestamp: Date.now(),
    });
    this.pruneOldMetrics();
  }

  /**
   * Record a PDSE verification score.
   */
  recordPDSE(score: number): void {
    if (score >= 0 && score <= 100) {
      this.pdseScores.push({ score, timestamp: Date.now() });
      this.pruneOldMetrics();
    }
  }

  /**
   * Record an error occurrence.
   */
  recordError(type: string, endpoint: string): void {
    this.errors.push({
      type,
      endpoint: this.normalizeEndpoint(endpoint),
      timestamp: Date.now(),
    });
    this.pruneOldMetrics();
  }

  /**
   * Normalize endpoint paths to avoid cardinality explosion.
   * Replace session IDs and other dynamic segments with placeholders.
   */
  private normalizeEndpoint(path: string): string {
    return path
      .replace(/\/api\/sessions\/[a-zA-Z0-9_-]+/g, "/api/sessions/:id")
      .replace(/\/api\/evidence\/[a-zA-Z0-9_-]+/g, "/api/evidence/:sessionId");
  }

  /**
   * Remove metrics older than MAX_AGE_MS and enforce MAX_METRICS limit.
   */
  private pruneOldMetrics(): void {
    const cutoff = Date.now() - this.MAX_AGE_MS;

    this.requests = this.requests.filter((m) => m.timestamp > cutoff).slice(-this.MAX_METRICS);
    this.pdseScores = this.pdseScores.filter((m) => m.timestamp > cutoff).slice(-this.MAX_METRICS);
    this.errors = this.errors.filter((m) => m.timestamp > cutoff).slice(-this.MAX_METRICS);
  }

  /**
   * Export all metrics in Prometheus text format.
   */
  export(sessions: Map<string, SessionRecord>): string {
    const lines: string[] = [];

    // Uptime
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    lines.push("# HELP dantecode_uptime_seconds Server uptime in seconds");
    lines.push("# TYPE dantecode_uptime_seconds gauge");
    lines.push(`dantecode_uptime_seconds ${uptimeSeconds}`);
    lines.push("");

    // Request count by method and endpoint
    lines.push("# HELP http_requests_total Total HTTP requests");
    lines.push("# TYPE http_requests_total counter");
    const requestCounts = this.aggregateRequestCounts();
    for (const [key, count] of requestCounts.entries()) {
      lines.push(`http_requests_total{${key}} ${count}`);
    }
    lines.push("");

    // Response time histogram (p50, p95, p99)
    lines.push("# HELP http_request_duration_seconds HTTP request duration");
    lines.push("# TYPE http_request_duration_seconds summary");
    const durations = this.requests.map((r) => r.duration).sort((a, b) => a - b);
    if (durations.length > 0) {
      const p50 = this.percentile(durations, 0.5);
      const p95 = this.percentile(durations, 0.95);
      const p99 = this.percentile(durations, 0.99);
      const sum = durations.reduce((a, b) => a + b, 0);
      lines.push(`http_request_duration_seconds{quantile="0.5"} ${(p50 / 1000).toFixed(3)}`);
      lines.push(`http_request_duration_seconds{quantile="0.95"} ${(p95 / 1000).toFixed(3)}`);
      lines.push(`http_request_duration_seconds{quantile="0.99"} ${(p99 / 1000).toFixed(3)}`);
      lines.push(`http_request_duration_seconds_sum ${(sum / 1000).toFixed(3)}`);
      lines.push(`http_request_duration_seconds_count ${durations.length}`);
    }
    lines.push("");

    // PDSE score histogram
    lines.push("# HELP pdse_score PDSE verification scores");
    lines.push("# TYPE pdse_score histogram");
    const pdseBuckets = this.aggregatePDSEBuckets();
    for (const [le, count] of pdseBuckets.entries()) {
      lines.push(`pdse_score_bucket{le="${le}"} ${count}`);
    }
    lines.push(`pdse_score_bucket{le="+Inf"} ${this.pdseScores.length}`);
    const pdseSum = this.pdseScores.reduce((sum, m) => sum + m.score, 0);
    lines.push(`pdse_score_sum ${pdseSum.toFixed(2)}`);
    lines.push(`pdse_score_count ${this.pdseScores.length}`);
    lines.push("");

    // Error rate by type
    lines.push("# HELP errors_total Total errors by type");
    lines.push("# TYPE errors_total counter");
    const errorCounts = this.aggregateErrorCounts();
    for (const [key, count] of errorCounts.entries()) {
      lines.push(`errors_total{${key}} ${count}`);
    }
    lines.push("");

    // Active sessions gauge
    lines.push("# HELP active_sessions_total Active sessions");
    lines.push("# TYPE active_sessions_total gauge");
    const statusCounts = this.aggregateSessionsByStatus(sessions);
    for (const [status, count] of statusCounts.entries()) {
      lines.push(`active_sessions_total{status="${status}"} ${count}`);
    }
    const totalSessions = sessions.size;
    lines.push(`active_sessions_total{status="all"} ${totalSessions}`);
    lines.push("");

    // Memory usage
    lines.push("# HELP process_resident_memory_bytes Resident memory size in bytes");
    lines.push("# TYPE process_resident_memory_bytes gauge");
    const memUsage = process.memoryUsage();
    lines.push(`process_resident_memory_bytes ${memUsage.rss}`);
    lines.push("");

    lines.push("# HELP process_heap_bytes Heap memory size in bytes");
    lines.push("# TYPE process_heap_bytes gauge");
    lines.push(`process_heap_bytes{type="used"} ${memUsage.heapUsed}`);
    lines.push(`process_heap_bytes{type="total"} ${memUsage.heapTotal}`);
    lines.push("");

    // CPU usage (only available on some platforms)
    const cpuUsage = process.cpuUsage();
    lines.push("# HELP process_cpu_seconds_total Total CPU time in seconds");
    lines.push("# TYPE process_cpu_seconds_total counter");
    lines.push(`process_cpu_seconds_total{mode="user"} ${(cpuUsage.user / 1_000_000).toFixed(6)}`);
    lines.push(
      `process_cpu_seconds_total{mode="system"} ${(cpuUsage.system / 1_000_000).toFixed(6)}`,
    );
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Aggregate request counts by method, endpoint, and status.
   */
  private aggregateRequestCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const req of this.requests) {
      const key = `method="${req.method}",endpoint="${req.endpoint}",status="${req.status}"`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Aggregate PDSE scores into histogram buckets.
   */
  private aggregatePDSEBuckets(): Map<number, number> {
    const buckets = new Map<number, number>([
      [50, 0],
      [60, 0],
      [70, 0],
      [80, 0],
      [90, 0],
      [95, 0],
      [100, 0],
    ]);

    for (const metric of this.pdseScores) {
      for (const [le, _count] of buckets) {
        if (metric.score <= le) {
          buckets.set(le, (buckets.get(le) ?? 0) + 1);
        }
      }
    }

    return buckets;
  }

  /**
   * Aggregate error counts by type and endpoint.
   */
  private aggregateErrorCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const err of this.errors) {
      const key = `type="${err.type}",endpoint="${err.endpoint}"`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Aggregate sessions by status.
   */
  private aggregateSessionsByStatus(sessions: Map<string, SessionRecord>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const session of sessions.values()) {
      const status = session.status ?? "unknown";
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Calculate percentile from sorted array.
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]!;
  }
}

// ---------------------------------------------------------------------------
// Global Singleton
// ---------------------------------------------------------------------------

/**
 * Global metrics collector instance.
 * Shared across all server instances to aggregate metrics.
 */
export const globalMetrics = new MetricsCollector();
