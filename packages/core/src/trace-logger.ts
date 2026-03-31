/**
 * trace-logger.ts
 *
 * Observable trace logging for agentic decision-making.
 * Records reasoning steps, tool calls, decisions, and outcomes for explainability.
 *
 * Inspired by LangSmith, Weights & Biases Traces, and OpenTelemetry.
 */

import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "./enterprise-logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TraceLevel = "debug" | "info" | "decision" | "tool" | "error";
export type TraceStatus = "pending" | "success" | "error" | "skipped";

export interface TraceSpan {
  /** Unique span ID */
  spanId: string;
  /** Parent span ID (for nested spans) */
  parentSpanId?: string;
  /** Trace ID (groups related spans) */
  traceId: string;
  /** Span name (e.g., "agent-loop", "tool-call", "reasoning") */
  name: string;
  /** Span type */
  type: "agent" | "tool" | "reasoning" | "verification" | "system";
  /** Timestamp when span started */
  startTime: string;
  /** Timestamp when span ended */
  endTime?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Current status */
  status: TraceStatus;
  /** Input data */
  input?: unknown;
  /** Output data */
  output?: unknown;
  /** Error information */
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  /** Metadata (model, tokens, cost, etc.) */
  metadata?: Record<string, unknown>;
  /** Nested child spans */
  children?: TraceSpan[];
}

export interface TraceEvent {
  /** Event ID */
  eventId: string;
  /** Associated span ID */
  spanId: string;
  /** Trace ID */
  traceId: string;
  /** Event timestamp */
  timestamp: string;
  /** Event level */
  level: TraceLevel;
  /** Event message */
  message: string;
  /** Additional data */
  data?: Record<string, unknown>;
}

export interface TraceDecision {
  /** Decision ID */
  decisionId: string;
  /** Associated span ID */
  spanId: string;
  /** Trace ID */
  traceId: string;
  /** Decision timestamp */
  timestamp: string;
  /** Decision point (e.g., "model-selection", "tool-choice") */
  point: string;
  /** Options considered */
  options: Array<{
    name: string;
    score?: number;
    reason?: string;
  }>;
  /** Selected option */
  selected: string;
  /** Reason for selection */
  reason: string;
  /** Confidence (0-1) */
  confidence?: number;
}

export interface TraceSummary {
  traceId: string;
  rootSpanId: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  totalSpans: number;
  totalEvents: number;
  totalDecisions: number;
  status: TraceStatus;
  spans: TraceSpan[];
  events: TraceEvent[];
  decisions: TraceDecision[];
}

export interface TraceLoggerOptions {
  /** Project root directory */
  projectRoot: string;
  /** Enable trace logging (default: true) */
  enabled?: boolean;
  /** Log to file (default: true) */
  logToFile?: boolean;
  /** Log to console (default: false) */
  logToConsole?: boolean;
  /** Trace directory (default: .dantecode/traces) */
  traceDir?: string;
  /** Auto-flush interval in ms (default: 5000) */
  autoFlushMs?: number;
}

// ---------------------------------------------------------------------------
// TraceLogger
// ---------------------------------------------------------------------------

/**
 * Observable trace logger for agentic execution.
 *
 * Records:
 * - Reasoning steps
 * - Tool calls and results
 * - Decision points
 * - Model interactions
 * - Verification outcomes
 *
 * Enables:
 * - Explainability (why did agent do X?)
 * - Debugging (what went wrong?)
 * - Performance analysis (where are bottlenecks?)
 * - Trust (audit trail of decisions)
 */
export class TraceLogger {
  private readonly options: Required<TraceLoggerOptions>;
  private readonly activeSpans: Map<string, TraceSpan> = new Map();
  private readonly completedSpans: TraceSpan[] = [];
  private readonly events: TraceEvent[] = [];
  private readonly decisions: TraceDecision[] = [];
  private flushTimer?: NodeJS.Timeout;

  constructor(options: TraceLoggerOptions) {
    this.options = {
      enabled: options.enabled ?? true,
      logToFile: options.logToFile ?? true,
      logToConsole: options.logToConsole ?? false,
      traceDir: options.traceDir ?? join(options.projectRoot, ".dantecode", "traces"),
      autoFlushMs: options.autoFlushMs ?? 5000,
      projectRoot: options.projectRoot,
    };

    if (this.options.enabled && this.options.autoFlushMs > 0) {
      this.flushTimer = setInterval(() => this.flush(), this.options.autoFlushMs);
    }
  }

  // ── Span Management ────────────────────────────────────────────────────

  /**
   * Start a new trace span.
   */
  startSpan(
    name: string,
    type: TraceSpan["type"],
    options?: {
      traceId?: string;
      parentSpanId?: string;
      input?: unknown;
      metadata?: Record<string, unknown>;
    },
  ): TraceSpan {
    if (!this.options.enabled) {
      // Return a no-op span when disabled
      return this.createNoOpSpan(name, type);
    }

    const spanId = randomUUID();
    const traceId = options?.traceId ?? randomUUID();
    const parentSpanId = options?.parentSpanId;

    const span: TraceSpan = {
      spanId,
      parentSpanId,
      traceId,
      name,
      type,
      startTime: new Date().toISOString(),
      status: "pending",
      input: options?.input,
      metadata: options?.metadata,
      children: [],
    };

    this.activeSpans.set(spanId, span);

    // Add to parent's children if exists
    if (parentSpanId) {
      const parent = this.activeSpans.get(parentSpanId) || this.findCompletedSpan(parentSpanId);
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(span);
      }
    }

    if (this.options.logToConsole) {
      logger.debug({ spanId, name, type, traceId }, "TRACE: Start span");
    }

    return span;
  }

  /**
   * End a trace span.
   */
  endSpan(
    spanId: string,
    options?: {
      status?: TraceStatus;
      output?: unknown;
      error?: { message: string; stack?: string; code?: string };
      metadata?: Record<string, unknown>;
    },
  ): void {
    if (!this.options.enabled) return;

    const span = this.activeSpans.get(spanId);
    if (!span) return;

    const endTime = new Date().toISOString();
    const durationMs = new Date(endTime).getTime() - new Date(span.startTime).getTime();

    span.endTime = endTime;
    span.durationMs = durationMs;
    span.status = options?.status ?? "success";
    span.output = options?.output;
    span.error = options?.error;

    if (options?.metadata) {
      span.metadata = { ...span.metadata, ...options.metadata };
    }

    this.activeSpans.delete(spanId);
    this.completedSpans.push(span);

    if (this.options.logToConsole) {
      logger.debug(
        { spanId, name: span.name, status: span.status, durationMs },
        "TRACE: End span"
      );
    }
  }

  // ── Event Logging ──────────────────────────────────────────────────────

  /**
   * Log a trace event.
   */
  logEvent(
    spanId: string,
    level: TraceLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (!this.options.enabled) return;

    const span = this.activeSpans.get(spanId) || this.findCompletedSpan(spanId);
    if (!span) return;

    const event: TraceEvent = {
      eventId: randomUUID(),
      spanId,
      traceId: span.traceId,
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };

    this.events.push(event);

    if (this.options.logToConsole) {
      logger.debug({ spanId, level, traceId: span.traceId, data }, `TRACE: ${message}`);
    }
  }

  // ── Decision Logging ───────────────────────────────────────────────────

  /**
   * Log a decision point.
   */
  logDecision(
    spanId: string,
    point: string,
    options: Array<{ name: string; score?: number; reason?: string }>,
    selected: string,
    reason: string,
    confidence?: number,
  ): void {
    if (!this.options.enabled) return;

    const span = this.activeSpans.get(spanId) || this.findCompletedSpan(spanId);
    if (!span) return;

    const decision: TraceDecision = {
      decisionId: randomUUID(),
      spanId,
      traceId: span.traceId,
      timestamp: new Date().toISOString(),
      point,
      options,
      selected,
      reason,
      confidence,
    };

    this.decisions.push(decision);

    if (this.options.logToConsole) {
      logger.debug(
        { spanId, point, selected, confidence, traceId: span.traceId },
        "TRACE: Decision"
      );
    }
  }

  // ── Trace Retrieval ────────────────────────────────────────────────────

  /**
   * Get a trace summary by trace ID.
   */
  getTrace(traceId: string): TraceSummary | null {
    const spans = [
      ...this.completedSpans.filter((s) => s.traceId === traceId),
      ...Array.from(this.activeSpans.values()).filter((s) => s.traceId === traceId),
    ];

    if (spans.length === 0) return null;

    const rootSpan = spans.find((s) => !s.parentSpanId);
    if (!rootSpan) return null;

    const events = this.events.filter((e) => e.traceId === traceId);
    const decisions = this.decisions.filter((d) => d.traceId === traceId);

    const startTime = rootSpan.startTime;
    const endTime = rootSpan.endTime;
    const durationMs = endTime
      ? new Date(endTime).getTime() - new Date(startTime).getTime()
      : undefined;

    const status = rootSpan.status;

    return {
      traceId,
      rootSpanId: rootSpan.spanId,
      startTime,
      endTime,
      durationMs,
      totalSpans: spans.length,
      totalEvents: events.length,
      totalDecisions: decisions.length,
      status,
      spans,
      events,
      decisions,
    };
  }

  /**
   * Get all active traces.
   */
  getActiveTraces(): TraceSummary[] {
    const traceIds = new Set<string>();
    for (const span of this.activeSpans.values()) {
      traceIds.add(span.traceId);
    }

    return Array.from(traceIds)
      .map((id) => this.getTrace(id))
      .filter((t): t is TraceSummary => t !== null);
  }

  // ── Persistence ────────────────────────────────────────────────────────

  /**
   * Flush traces to disk.
   */
  async flush(): Promise<void> {
    if (!this.options.enabled || !this.options.logToFile) return;
    if (this.completedSpans.length === 0 && this.events.length === 0) return;

    await mkdir(this.options.traceDir, { recursive: true });

    // Group by trace ID
    const traceGroups = new Map<string, TraceSpan[]>();
    for (const span of this.completedSpans) {
      const group = traceGroups.get(span.traceId) || [];
      group.push(span);
      traceGroups.set(span.traceId, group);
    }

    // Write each trace to a file
    for (const [traceId, _spans] of traceGroups) {
      const summary = this.getTrace(traceId);
      if (!summary) continue;

      const filename = `${traceId}.json`;
      const filepath = join(this.options.traceDir, filename);

      await writeFile(filepath, JSON.stringify(summary, null, 2), "utf-8");
    }

    // Clear flushed data
    this.completedSpans.length = 0;
    this.events.length = 0;
    this.decisions.length = 0;
  }

  /**
   * Cleanup and flush on exit.
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flush();
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private findCompletedSpan(spanId: string): TraceSpan | undefined {
    return this.completedSpans.find((s) => s.spanId === spanId);
  }

  private createNoOpSpan(name: string, type: TraceSpan["type"]): TraceSpan {
    return {
      spanId: "noop",
      traceId: "noop",
      name,
      type,
      startTime: new Date().toISOString(),
      status: "pending",
    };
  }
}

// ---------------------------------------------------------------------------
// Global Trace Logger
// ---------------------------------------------------------------------------

let _globalTraceLogger: TraceLogger | null = null;

/**
 * Get or create the global trace logger.
 */
export function getGlobalTraceLogger(options?: TraceLoggerOptions): TraceLogger {
  if (!_globalTraceLogger && options) {
    _globalTraceLogger = new TraceLogger(options);
  }
  if (!_globalTraceLogger) {
    throw new Error("TraceLogger not initialized. Call getGlobalTraceLogger(options) first.");
  }
  return _globalTraceLogger;
}

/**
 * Set the global trace logger.
 */
export function setGlobalTraceLogger(logger: TraceLogger): void {
  _globalTraceLogger = logger;
}

/**
 * Check if global trace logger is initialized.
 */
export function hasGlobalTraceLogger(): boolean {
  return _globalTraceLogger !== null;
}
