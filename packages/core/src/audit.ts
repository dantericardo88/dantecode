// ============================================================================
// @dantecode/core — Audit Logger (append-only JSONL)
// ============================================================================

import { readFile, appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  AuditEventType,
  ToolCallRecord,
  MutationRecord,
  ValidationRecord,
  CompletionGateResult,
} from "@dantecode/config-types";

/**
 * The relative path within the project root where the audit log is stored.
 */
const AUDIT_LOG_RELATIVE_PATH = ".dantecode/audit.jsonl";

/**
 * Input type for appending a new audit event. The `id` field is generated
 * automatically and should not be supplied by callers.
 */
export type AuditEventInput = Omit<AuditEvent, "id">;

/**
 * Options for filtering audit events when reading the log.
 */
export interface ReadAuditOptions {
  /** Filter events by session ID. */
  sessionId?: string;
  /** Filter events by type. */
  type?: AuditEventType;
  /** Return only events after this ISO timestamp (inclusive). */
  since?: string;
  /** Return only events before this ISO timestamp (inclusive). */
  until?: string;
  /** Maximum number of events to return. Defaults to no limit. */
  limit?: number;
  /** Offset from the beginning of the filtered results. Defaults to 0. */
  offset?: number;
}

/**
 * Resolves the absolute path to the audit log file for a given project root.
 */
function auditLogPath(projectRoot: string): string {
  return join(projectRoot, AUDIT_LOG_RELATIVE_PATH);
}

/**
 * Appends a single audit event to the append-only JSONL audit log.
 *
 * Automatically assigns a UUID `id` and normalizes the `timestamp` field.
 * Creates the `.dantecode/` directory if it does not exist.
 *
 * Each event is serialized as a single JSON line terminated by `\n`,
 * ensuring safe concurrent appends.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @param event - The audit event data (without `id`).
 * @returns The complete AuditEvent with its assigned `id`.
 */
export async function appendAuditEvent(
  projectRoot: string,
  event: AuditEventInput,
): Promise<AuditEvent> {
  const logPath = auditLogPath(projectRoot);

  // Ensure the directory exists
  await mkdir(dirname(logPath), { recursive: true });

  const fullEvent: AuditEvent = {
    id: randomUUID(),
    sessionId: event.sessionId,
    timestamp: event.timestamp || new Date().toISOString(),
    type: event.type,
    payload: event.payload,
    modelId: event.modelId,
    projectRoot: event.projectRoot,
  };

  const line = JSON.stringify(fullEvent) + "\n";
  await appendFile(logPath, line, "utf-8");

  return fullEvent;
}

/**
 * Reads audit events from the JSONL log file with optional filtering.
 *
 * Parses each line as a JSON object, applies the requested filters
 * (sessionId, type, time range), and returns the matching events
 * in chronological order.
 *
 * If the log file does not exist, returns an empty array without error.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @param options - Optional filters and pagination.
 * @returns An array of AuditEvent objects matching the filter criteria.
 */
export async function readAuditEvents(
  projectRoot: string,
  options: ReadAuditOptions = {},
): Promise<AuditEvent[]> {
  const logPath = auditLogPath(projectRoot);

  let content: string;
  try {
    content = await readFile(logPath, "utf-8");
  } catch (err: unknown) {
    // If the file doesn't exist yet, return empty results
    if (isNodeError(err) && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  let events: AuditEvent[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as AuditEvent;
      events.push(parsed);
    } catch {
      // Skip malformed lines — the log may have been partially written
      // during a crash. Silently ignoring preserves read resilience.
    }
  }

  // Apply filters
  if (options.sessionId !== undefined) {
    events = events.filter((e) => e.sessionId === options.sessionId);
  }

  if (options.type !== undefined) {
    events = events.filter((e) => e.type === options.type);
  }

  if (options.since !== undefined) {
    const sinceDate = new Date(options.since).getTime();
    events = events.filter((e) => new Date(e.timestamp).getTime() >= sinceDate);
  }

  if (options.until !== undefined) {
    const untilDate = new Date(options.until).getTime();
    events = events.filter((e) => new Date(e.timestamp).getTime() <= untilDate);
  }

  // Sort chronologically
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Apply pagination
  const offset = options.offset ?? 0;
  if (offset > 0) {
    events = events.slice(offset);
  }

  if (options.limit !== undefined && options.limit > 0) {
    events = events.slice(0, options.limit);
  }

  return events;
}

/**
 * Counts the total number of audit events matching optional filters.
 *
 * This is a convenience wrapper around readAuditEvents that returns
 * only the count.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @param options - Optional filters (limit/offset are ignored for counting).
 * @returns The number of matching events.
 */
export async function countAuditEvents(
  projectRoot: string,
  options: Omit<ReadAuditOptions, "limit" | "offset"> = {},
): Promise<number> {
  const events = await readAuditEvents(projectRoot, options);
  return events.length;
}

/**
 * Records a tool call execution in the audit log.
 */
export async function recordToolCall(
  projectRoot: string,
  sessionId: string,
  modelId: string,
  toolCallRecord: ToolCallRecord,
): Promise<void> {
  const type: AuditEventType = toolCallRecord.result.isError
    ? "tool_call_failed"
    : "tool_call_succeeded";
  await appendAuditEvent(projectRoot, {
    sessionId,
    timestamp: toolCallRecord.timestamp,
    type,
    payload: {
      toolCallId: toolCallRecord.id,
      toolName: toolCallRecord.toolName,
      input: toolCallRecord.input,
      result: toolCallRecord.result,
    },
    modelId,
    projectRoot,
  });
}

/**
 * Records an observed mutation in the audit log.
 */
export async function recordMutation(
  projectRoot: string,
  sessionId: string,
  modelId: string,
  mutationRecord: MutationRecord,
): Promise<void> {
  await appendAuditEvent(projectRoot, {
    sessionId,
    timestamp: mutationRecord.timestamp || new Date().toISOString(),
    type: "mutation_observed",
    payload: {
      mutationId: mutationRecord.id,
      toolCallId: mutationRecord.toolCallId,
      path: mutationRecord.path,
      beforeHash: mutationRecord.beforeHash,
      afterHash: mutationRecord.afterHash,
      diffSummary: mutationRecord.diffSummary,
      lineCount: mutationRecord.lineCount,
      additions: mutationRecord.additions,
      deletions: mutationRecord.deletions,
    },
    modelId,
    projectRoot,
  });
}

/**
 * Records an observed validation in the audit log.
 */
export async function recordValidation(
  projectRoot: string,
  sessionId: string,
  modelId: string,
  validationRecord: ValidationRecord,
): Promise<void> {
  await appendAuditEvent(projectRoot, {
    sessionId,
    timestamp: validationRecord.timestamp,
    type: "validation_observed",
    payload: {
      validationId: validationRecord.id,
      toolCallId: validationRecord.toolCallId,
      type: validationRecord.type,
      command: validationRecord.command,
      exitCode: validationRecord.exitCode,
      output: validationRecord.output,
      passed: validationRecord.passed,
    },
    modelId,
    projectRoot,
  });
}

/**
 * Records a completion gate evaluation in the audit log.
 */
export async function recordCompletionGate(
  projectRoot: string,
  sessionId: string,
  modelId: string,
  gateResult: CompletionGateResult,
): Promise<void> {
  const type: AuditEventType = gateResult.ok ? "completion_gate_passed" : "completion_gate_failed";
  await appendAuditEvent(projectRoot, {
    sessionId,
    timestamp: gateResult.timestamp,
    type,
    payload: {
      ok: gateResult.ok,
      reasonCode: gateResult.reasonCode,
      message: gateResult.message,
    },
    modelId,
    projectRoot,
  });
}

/**
 * Type guard for Node.js errors with a `code` property (e.g. ENOENT).
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
