/**
 * trace-recorder.ts
 *
 * Distributed tracing with span trees and timestamps.
 * Supports nested spans for tracking operation hierarchies.
 */

import { randomUUID } from "node:crypto";
import type { Span, TraceRecord, SpanAttributes, SpanStatus } from "./types.js";

/**
 * TraceRecorder - Records trace spans with hierarchy support
 *
 * Tracks operations as spans organized into traces. Supports:
 * - Nested spans (parent-child relationships)
 * - Automatic duration calculation
 * - Span attributes for metadata
 * - Error tracking
 */
export class TraceRecorder {
  private traces: Map<string, TraceRecord> = new Map();
  private activeSpans: Map<string, Span> = new Map();
  private spanToTrace: Map<string, string> = new Map();

  /**
   * Start a new span
   * @param name - Span name (e.g., "api.request", "db.query")
   * @param attributes - Optional span attributes
   * @param parentSpanId - Optional parent span ID for nested spans
   * @returns Span object with unique ID
   */
  startSpan(name: string, attributes: SpanAttributes = {}, parentSpanId?: string): Span {
    const spanId = randomUUID();
    const startTime = Date.now();

    // Determine trace ID: use parent's trace or create new one
    let traceId: string;
    if (parentSpanId) {
      traceId = this.spanToTrace.get(parentSpanId) ?? randomUUID();
    } else {
      traceId = randomUUID();
    }

    const span: Span = {
      id: spanId,
      name,
      startTime,
      attributes,
      status: "in_progress" as SpanStatus,
      parentId: parentSpanId,
    };

    this.activeSpans.set(spanId, span);
    this.spanToTrace.set(spanId, traceId);

    // Get or create trace record
    let trace = this.traces.get(traceId);
    if (!trace) {
      trace = {
        traceId,
        spans: [],
        startTime,
      };
      this.traces.set(traceId, trace);
    }

    trace.spans.push(span);

    return span;
  }

  /**
   * End an active span
   * @param spanId - Span ID to end
   * @param error - Optional error if span failed
   */
  endSpan(spanId: string, error?: Error): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      return; // Span not found or already ended
    }

    const endTime = Date.now();
    span.endTime = endTime;
    span.duration = endTime - span.startTime;
    span.status = error ? ("error" as SpanStatus) : ("completed" as SpanStatus);
    if (error) {
      span.error = error;
    }

    this.activeSpans.delete(spanId);

    // Update trace end time if this is the last span
    const traceId = this.spanToTrace.get(spanId);
    if (traceId) {
      const trace = this.traces.get(traceId);
      if (trace) {
        const hasActiveSpans = trace.spans.some((s) => this.activeSpans.has(s.id));
        if (!hasActiveSpans) {
          trace.endTime = endTime;
          trace.duration = endTime - trace.startTime;
        }
      }
    }
  }

  /**
   * Get a specific span by ID
   * @param spanId - Span ID
   * @returns Span object or undefined if not found
   */
  getSpan(spanId: string): Span | undefined {
    const traceId = this.spanToTrace.get(spanId);
    if (!traceId) return undefined;

    const trace = this.traces.get(traceId);
    if (!trace) return undefined;

    return trace.spans.find((s) => s.id === spanId);
  }

  /**
   * Get all spans for a trace
   * @param traceId - Trace ID
   * @returns Array of spans in the trace
   */
  getTraceSpans(traceId: string): Span[] {
    const trace = this.traces.get(traceId);
    return trace ? trace.spans : [];
  }

  /**
   * Get a complete trace record
   * @param traceId - Trace ID
   * @returns TraceRecord or undefined if not found
   */
  getTrace(traceId: string): TraceRecord | undefined {
    return this.traces.get(traceId);
  }

  /**
   * Get all trace records
   * @returns Array of all traces
   */
  getTraces(): TraceRecord[] {
    return Array.from(this.traces.values());
  }

  /**
   * Get all active (incomplete) spans
   * @returns Array of spans that haven't been ended
   */
  getActiveSpans(): Span[] {
    return Array.from(this.activeSpans.values());
  }

  /**
   * Clear all traces and spans
   */
  clear(): void {
    this.traces.clear();
    this.activeSpans.clear();
    this.spanToTrace.clear();
  }

  /**
   * Get the number of recorded traces
   * @returns Count of traces
   */
  traceCount(): number {
    return this.traces.size;
  }

  /**
   * Get the number of active (incomplete) spans
   * @returns Count of active spans
   */
  activeSpanCount(): number {
    return this.activeSpans.size;
  }

  /**
   * Helper: Execute a function within a span
   * @param name - Span name
   * @param fn - Function to execute
   * @param attributes - Optional span attributes
   * @param parentSpanId - Optional parent span ID
   * @returns Function result
   */
  async withSpan<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: SpanAttributes,
    parentSpanId?: string,
  ): Promise<T> {
    const span = this.startSpan(name, attributes, parentSpanId);
    try {
      const result = await fn();
      this.endSpan(span.id);
      return result;
    } catch (error) {
      this.endSpan(span.id, error as Error);
      throw error;
    }
  }
}
