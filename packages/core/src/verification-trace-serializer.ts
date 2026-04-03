// =============================================================================
// Verification Trace Serializer — serialize/deserialize verification traces
// to/from JSON for persistence, cross-session recall, and audit logs.
// =============================================================================

import type { VerificationTrace, VerificationTraceEvent } from "./verification-trace-recorder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SerializedTrace {
  version: number;
  traceId: string;
  task: string;
  startedAt: string;
  completedAt?: string;
  decision?: string;
  finalScore?: number;
  finalConfidence?: number;
  events: VerificationTraceEvent[];
}

export interface TraceValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

const CURRENT_VERSION = 1;

/**
 * Serialize a VerificationTrace to a JSON string.
 */
export function serializeTrace(trace: VerificationTrace): string {
  const serialized: SerializedTrace = {
    version: CURRENT_VERSION,
    traceId: trace.traceId,
    task: trace.task,
    startedAt: trace.startedAt,
    ...(trace.completedAt !== undefined ? { completedAt: trace.completedAt } : {}),
    ...(trace.decision !== undefined ? { decision: trace.decision } : {}),
    ...(trace.finalScore !== undefined ? { finalScore: trace.finalScore } : {}),
    ...(trace.finalConfidence !== undefined ? { finalConfidence: trace.finalConfidence } : {}),
    events: trace.events,
  };
  return JSON.stringify(serialized, null, 2);
}

/**
 * Deserialize a JSON string into a VerificationTrace.
 * Returns null if parsing fails.
 */
export function deserializeTrace(json: string): VerificationTrace | null {
  try {
    const raw: unknown = JSON.parse(json);
    const validation = validateSerializedTrace(raw);
    if (!validation.valid) {
      return null;
    }
    const serialized = raw as SerializedTrace;
    return {
      traceId: serialized.traceId,
      task: serialized.task,
      startedAt: serialized.startedAt,
      ...(serialized.completedAt !== undefined ? { completedAt: serialized.completedAt } : {}),
      ...(serialized.decision !== undefined ? { decision: serialized.decision } : {}),
      ...(serialized.finalScore !== undefined ? { finalScore: serialized.finalScore } : {}),
      ...(serialized.finalConfidence !== undefined
        ? { finalConfidence: serialized.finalConfidence }
        : {}),
      events: serialized.events,
    };
  } catch {
    return null;
  }
}

/**
 * Validate a parsed object as a SerializedTrace.
 */
export function validateSerializedTrace(raw: unknown): TraceValidationResult {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null) {
    errors.push("Root must be an object.");
    return { valid: false, errors };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj["traceId"] !== "string" || obj["traceId"].length === 0) {
    errors.push("Missing or empty traceId.");
  }
  if (typeof obj["task"] !== "string") {
    errors.push("Missing or non-string task.");
  }
  if (typeof obj["startedAt"] !== "string") {
    errors.push("Missing startedAt.");
  }
  if (!Array.isArray(obj["events"])) {
    errors.push("Missing events array.");
  }
  if (typeof obj["version"] !== "number") {
    errors.push("Missing or non-numeric version.");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Extract a compact summary of a serialized trace for display.
 */
export function summarizeTrace(trace: VerificationTrace): string {
  const eventCount = trace.events.length;
  const decision = trace.decision ?? "pending";
  const score = trace.finalScore !== undefined ? `score=${trace.finalScore.toFixed(2)}` : "";
  const parts = [`traceId=${trace.traceId}`, `events=${eventCount}`, `decision=${decision}`];
  if (score) parts.push(score);
  return parts.join(" | ");
}

/**
 * Filter events from a trace by kind.
 */
export function filterEvents(
  trace: VerificationTrace,
  kind: VerificationTraceEvent["kind"],
): VerificationTraceEvent[] {
  return trace.events.filter((event) => event.kind === kind);
}
