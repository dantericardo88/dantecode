// =============================================================================
// Verification Trace Recorder — event-by-event trace recording for
// verification runs. Captures stage transitions, metric scores, rail triggers,
// critic outputs, and override events with full observability.
// Inspired by LangGraph's checkpointed trace model + OpenHands event log.
// =============================================================================

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerificationTraceEventKind =
  | "trace_started"
  | "stage_started"
  | "stage_completed"
  | "metric_scored"
  | "rail_triggered"
  | "critic_opinion"
  | "debate_completed"
  | "confidence_synthesized"
  | "override_requested"
  | "override_granted"
  | "trace_completed"
  | "trace_failed";

export interface VerificationTraceEvent {
  eventId: string;
  traceId: string;
  kind: VerificationTraceEventKind;
  timestamp: string;
  stage?: string;
  passed?: boolean;
  score?: number;
  data?: Record<string, unknown>;
}

export interface VerificationTrace {
  traceId: string;
  task: string;
  startedAt: string;
  completedAt?: string;
  events: VerificationTraceEvent[];
  decision?: string;
  finalScore?: number;
  finalConfidence?: number;
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

export class VerificationTraceRecorder {
  private readonly traces = new Map<string, VerificationTrace>();

  /** Start a new trace for the given task. Returns the traceId. */
  startTrace(task: string, traceId?: string): string {
    const id = traceId ?? randomUUID();
    const trace: VerificationTrace = {
      traceId: id,
      task,
      startedAt: new Date().toISOString(),
      events: [],
    };
    this.traces.set(id, trace);
    this.addEvent(id, {
      kind: "trace_started",
      data: { task },
    });
    return id;
  }

  /** Record a stage start event. */
  recordStageStart(traceId: string, stage: string): void {
    this.addEvent(traceId, { kind: "stage_started", stage });
  }

  /** Record a stage completion event. */
  recordStageComplete(traceId: string, stage: string, passed: boolean, summary?: string): void {
    this.addEvent(traceId, {
      kind: "stage_completed",
      stage,
      passed,
      data: summary ? { summary } : undefined,
    });
  }

  /** Record a metric score. */
  recordMetric(
    traceId: string,
    metricId: string,
    score: number,
    passed: boolean,
    reason?: string,
  ): void {
    this.addEvent(traceId, {
      kind: "metric_scored",
      stage: metricId,
      score,
      passed,
      data: reason ? { reason } : undefined,
    });
  }

  /** Record a rail trigger event. */
  recordRailTrigger(
    traceId: string,
    railId: string,
    action: "allow" | "warn" | "block",
    violations?: string[],
  ): void {
    this.addEvent(traceId, {
      kind: "rail_triggered",
      stage: railId,
      passed: action === "allow",
      data: { action, violations: violations ?? [] },
    });
  }

  /** Record a single critic opinion. */
  recordCriticOpinion(
    traceId: string,
    agentId: string,
    verdict: string,
    confidence?: number,
    findings?: string[],
  ): void {
    this.addEvent(traceId, {
      kind: "critic_opinion",
      data: { agentId, verdict, confidence, findings: findings ?? [] },
    });
  }

  /** Record the final debate result. */
  recordDebateComplete(
    traceId: string,
    consensus: string,
    confidence: number,
    rationale?: string,
  ): void {
    this.addEvent(traceId, {
      kind: "debate_completed",
      data: { consensus, confidence, rationale },
    });
  }

  /** Record the confidence synthesis result. */
  recordConfidenceSynthesis(
    traceId: string,
    decision: string,
    confidence: number,
    score: number,
  ): void {
    this.addEvent(traceId, {
      kind: "confidence_synthesized",
      score,
      data: { decision, confidence },
    });
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.decision = decision;
      trace.finalScore = score;
      trace.finalConfidence = confidence;
    }
  }

  /** Record an override request. */
  recordOverrideRequest(traceId: string, reason: string, requesterId?: string): void {
    this.addEvent(traceId, {
      kind: "override_requested",
      data: { reason, requesterId },
    });
  }

  /** Record an override grant (with audit log). */
  recordOverrideGranted(traceId: string, reason: string, grantedBy?: string): void {
    this.addEvent(traceId, {
      kind: "override_granted",
      data: { reason, grantedBy, auditTimestamp: new Date().toISOString() },
    });
  }

  /** Complete the trace with a final decision. */
  endTrace(
    traceId: string,
    decision: string,
    score?: number,
    confidence?: number,
  ): VerificationTrace | null {
    const trace = this.traces.get(traceId);
    if (!trace) return null;

    trace.completedAt = new Date().toISOString();
    if (score !== undefined) trace.finalScore = score;
    if (confidence !== undefined) trace.finalConfidence = confidence;
    trace.decision = decision;

    this.addEvent(traceId, {
      kind: "trace_completed",
      passed: decision === "pass" || decision === "soft-pass",
      score,
      data: { decision, confidence },
    });

    return { ...trace, events: [...trace.events] };
  }

  /** Mark trace as failed. */
  failTrace(traceId: string, error: string): VerificationTrace | null {
    const trace = this.traces.get(traceId);
    if (!trace) return null;
    trace.completedAt = new Date().toISOString();
    this.addEvent(traceId, {
      kind: "trace_failed",
      passed: false,
      data: { error },
    });
    return { ...trace, events: [...trace.events] };
  }

  /** Retrieve a trace snapshot. */
  getTrace(traceId: string): VerificationTrace | undefined {
    const trace = this.traces.get(traceId);
    if (!trace) return undefined;
    return { ...trace, events: [...trace.events] };
  }

  /** List all active trace ids. */
  listTraceIds(): string[] {
    return [...this.traces.keys()];
  }

  /** Evict a trace from memory. */
  evict(traceId: string): void {
    this.traces.delete(traceId);
  }

  /** Clear all traces. */
  clear(): void {
    this.traces.clear();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private addEvent(
    traceId: string,
    partial: Omit<VerificationTraceEvent, "eventId" | "traceId" | "timestamp">,
  ): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;
    const event: VerificationTraceEvent = {
      eventId: randomUUID(),
      traceId,
      timestamp: new Date().toISOString(),
      ...partial,
    };
    trace.events.push(event);
  }
}

/** Global in-process trace recorder instance. */
export const globalTraceRecorder = new VerificationTraceRecorder();
