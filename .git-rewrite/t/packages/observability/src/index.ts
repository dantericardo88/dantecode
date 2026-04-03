/**
 * @dantecode/observability
 *
 * Zero-dependency observability system for metrics, tracing, and health checks.
 *
 * @example
 * ```typescript
 * import { MetricCounter, TraceRecorder, HealthSurface } from '@dantecode/observability';
 *
 * // Metrics
 * const metrics = new MetricCounter();
 * metrics.increment('api.requests');
 * metrics.gauge('memory.usage', 75);
 *
 * // Tracing
 * const tracer = new TraceRecorder();
 * const span = tracer.startSpan('api.call', { method: 'GET' });
 * // ... do work ...
 * tracer.endSpan(span.id);
 *
 * // Health checks
 * const health = new HealthSurface();
 * health.registerCheck('database', async () => {
 *   // check database connection
 *   return 'healthy';
 * });
 * const report = await health.runChecks();
 * ```
 */

export { MetricCounter } from "./metric-counter.js";
export { TraceRecorder } from "./trace-recorder.js";
export { HealthSurface } from "./health-surface.js";

export type {
  Metric,
  MetricValue,
  MetricType,
  Span,
  SpanAttributes,
  SpanStatus,
  TraceRecord,
  HealthStatus,
  HealthCheckResult,
  HealthReport,
  HealthCheckFn,
} from "./types.js";
