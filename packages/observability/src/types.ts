/**
 * types.ts
 *
 * Core types for the observability system
 */

/** Metric value types */
export type MetricValue = number;

/** Metric type classification */
export type MetricType = "counter" | "gauge";

/** Metric entry with metadata */
export interface Metric {
  name: string;
  value: MetricValue;
  type: MetricType;
  timestamp: number;
}

/** Span attributes */
export type SpanAttributes = Record<string, string | number | boolean | null>;

/** Span status */
export type SpanStatus = "in_progress" | "completed" | "error";

/** Trace span */
export interface Span {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  attributes: SpanAttributes;
  status: SpanStatus;
  parentId?: string;
  error?: Error;
}

/** Trace record containing multiple spans */
export interface TraceRecord {
  traceId: string;
  spans: Span[];
  startTime: number;
  endTime?: number;
  duration?: number;
}

/** Health check status */
export type HealthStatus = "healthy" | "degraded" | "unhealthy";

/** Health check result */
export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message?: string;
  timestamp: number;
  duration: number;
  error?: Error;
}

/** Health report aggregating all checks */
export interface HealthReport {
  status: HealthStatus;
  checks: HealthCheckResult[];
  timestamp: number;
  totalChecks: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
}

/** Health check function */
export type HealthCheckFn = () => Promise<HealthStatus>;
