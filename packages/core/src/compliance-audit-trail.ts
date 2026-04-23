// ============================================================================
// @dantecode/core — Compliance Audit Trail Builder (dim 25)
// Append-only JSONL audit trail for SOC2-grade compliance tracking.
// ============================================================================

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export type AuditEventType =
  | "file_read"
  | "file_write"
  | "file_delete"
  | "tool_call"
  | "llm_request"
  | "user_input"
  | "session_start"
  | "session_end"
  | "security_alert"
  | "policy_violation";

export interface AuditEvent {
  eventId: string;
  sessionId: string;
  eventType: AuditEventType;
  timestamp: string;
  actor: "user" | "agent" | "system";
  resource?: string;
  metadata?: Record<string, string | number | boolean>;
  severity: "info" | "warn" | "error";
}

export interface AuditTrailSummary {
  sessionId: string;
  eventCount: number;
  fileWriteCount: number;
  toolCallCount: number;
  securityAlertCount: number;
  policyViolationCount: number;
  startTime: string;
  endTime: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a new audit event with sensible severity defaults.
 * - "security_alert" → "error"
 * - "policy_violation" → "warn"
 * - everything else → "info" (unless overridden via `severity`)
 */
export function createAuditEvent(
  sessionId: string,
  eventType: AuditEventType,
  actor: AuditEvent["actor"],
  resource?: string,
  metadata?: Record<string, string | number | boolean>,
  severity?: AuditEvent["severity"],
): AuditEvent {
  let defaultSeverity: AuditEvent["severity"] = "info";
  if (eventType === "security_alert") defaultSeverity = "error";
  else if (eventType === "policy_violation") defaultSeverity = "warn";

  return {
    eventId: randomUUID(),
    sessionId,
    eventType,
    timestamp: new Date().toISOString(),
    actor,
    resource,
    metadata,
    severity: severity ?? defaultSeverity,
  };
}

/**
 * Append a single audit event as a JSONL line to
 * `<projectRoot>/.danteforge/audit-trail.json`.
 */
export function recordAuditEvent(event: AuditEvent, projectRoot?: string): void {
  const root = projectRoot ?? process.cwd();
  const dir = join(root, ".danteforge");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = join(dir, "audit-trail.json");
  appendFileSync(filePath, JSON.stringify(event) + "\n", "utf8");
}

/**
 * Read and parse the JSONL audit trail file.
 * Returns an empty array if the file does not exist or is empty.
 */
export function loadAuditTrail(projectRoot?: string): AuditEvent[] {
  const root = projectRoot ?? process.cwd();
  const filePath = join(root, ".danteforge", "audit-trail.json");
  if (!existsSync(filePath)) return [];

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return [];

  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuditEvent);
}

/**
 * Build a summary of audit events for a given session.
 */
export function buildAuditTrailSummary(
  sessionId: string,
  events: AuditEvent[],
): AuditTrailSummary {
  const sessionEvents = events.filter((e) => e.sessionId === sessionId);

  const timestamps = sessionEvents.map((e) => e.timestamp).sort();
  const startTime = timestamps[0] ?? new Date().toISOString();
  const endTime = timestamps[timestamps.length - 1] ?? startTime;

  return {
    sessionId,
    eventCount: sessionEvents.length,
    fileWriteCount: sessionEvents.filter((e) => e.eventType === "file_write").length,
    toolCallCount: sessionEvents.filter((e) => e.eventType === "tool_call").length,
    securityAlertCount: sessionEvents.filter((e) => e.eventType === "security_alert").length,
    policyViolationCount: sessionEvents.filter((e) => e.eventType === "policy_violation").length,
    startTime,
    endTime,
    durationMs: Date.parse(endTime) - Date.parse(startTime),
  };
}

/**
 * Export audit events as a CSV string.
 * Header: eventId,sessionId,eventType,timestamp,actor,resource,severity
 */
export function exportAuditTrailCSV(events: AuditEvent[]): string {
  const header = "eventId,sessionId,eventType,timestamp,actor,resource,severity";

  const rows = events.map((e) => {
    const resource = e.resource ? csvEscapeField(e.resource) : "";
    return [e.eventId, e.sessionId, e.eventType, e.timestamp, e.actor, resource, e.severity].join(
      ",",
    );
  });

  return [header, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function csvEscapeField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
