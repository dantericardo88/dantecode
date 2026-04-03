// ============================================================================
// @dantecode/core — Compliance Export
// SOC2-compatible audit log export in CSV and JSON formats.
// Supports field masking for sensitive data and date range filtering.
// ============================================================================

import type { AuditEvent } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface ComplianceExportOptions {
  /** Output format */
  format: "csv" | "json";
  /** Fields to include (if empty, all fields) */
  includeFields?: string[];
  /** Fields to mask/redact */
  maskFields?: string[];
  /** Start date filter (ISO string) */
  startDate?: string;
  /** End date filter (ISO string) */
  endDate?: string;
  /** Event types to include (if empty, all types) */
  eventTypes?: string[];
  /** Whether to include the full payload */
  includePayload?: boolean;
  /** Mask string for redacted fields (default: "[REDACTED]") */
  maskString?: string;
}

export interface ComplianceExportResult {
  data: string;
  format: "csv" | "json";
  eventCount: number;
  dateRange: { start: string; end: string };
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Top-level columns for CSV output (excludes nested payload)
// ---------------------------------------------------------------------------

const TOP_LEVEL_FIELDS: (keyof AuditEvent)[] = [
  "id",
  "sessionId",
  "timestamp",
  "type",
  "modelId",
  "projectRoot",
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Export audit events in a compliance-ready format.
 */
export function exportAuditLog(
  events: AuditEvent[],
  options: ComplianceExportOptions,
): ComplianceExportResult {
  // 1. Filter events
  let filtered = filterEvents(events, options);

  // 2. Mask sensitive fields
  if (options.maskFields && options.maskFields.length > 0) {
    filtered = filtered.map((e) => maskSensitiveFields(e, options.maskFields!, options.maskString));
  }

  // 3. Convert to the requested format
  const data =
    options.format === "csv"
      ? eventsToCSV(filtered, options.includePayload)
      : eventsToJSON(filtered, options.includePayload);

  // 4. Compute date range from filtered events
  const timestamps = filtered.map((e) => e.timestamp).sort();
  const start = timestamps[0] ?? "";
  const end = timestamps[timestamps.length - 1] ?? "";

  return {
    data,
    format: options.format,
    eventCount: filtered.length,
    dateRange: { start, end },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Mask sensitive fields in an audit event.
 * Returns a deep-cloned event with specified fields replaced by the mask string.
 */
export function maskSensitiveFields(
  event: AuditEvent,
  fields: string[],
  maskString?: string,
): AuditEvent {
  const mask = maskString ?? "[REDACTED]";
  // Deep clone so we don't mutate the original
  const clone: AuditEvent = JSON.parse(JSON.stringify(event));

  for (const field of fields) {
    // Check top-level fields
    if (field in clone) {
      (clone as unknown as Record<string, unknown>)[field] = mask;
    }
    // Check inside payload
    if (clone.payload && field in clone.payload) {
      clone.payload[field] = mask;
    }
  }

  return clone;
}

/**
 * Filter events by date range and type.
 */
export function filterEvents(
  events: AuditEvent[],
  options: Pick<ComplianceExportOptions, "startDate" | "endDate" | "eventTypes">,
): AuditEvent[] {
  let filtered = [...events];

  if (options.startDate) {
    const start = new Date(options.startDate).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= start);
  }

  if (options.endDate) {
    const end = new Date(options.endDate).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= end);
  }

  if (options.eventTypes && options.eventTypes.length > 0) {
    const types = new Set(options.eventTypes);
    filtered = filtered.filter((e) => types.has(e.type));
  }

  return filtered;
}

/**
 * Escape a value for RFC 4180 CSV.
 * If the value contains a comma, double-quote, or newline, it is wrapped in
 * double-quotes with internal double-quotes escaped by doubling.
 */
function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Convert events to CSV format with headers.
 * RFC 4180 compliant: fields containing commas, quotes, or newlines are
 * properly quoted and escaped.
 */
export function eventsToCSV(events: AuditEvent[], includePayload?: boolean): string {
  const headers = [...TOP_LEVEL_FIELDS];
  if (includePayload) {
    headers.push("payload" as keyof AuditEvent);
  }

  const lines: string[] = [];
  lines.push(headers.map((h) => csvEscape(String(h))).join(","));

  for (const event of events) {
    const row: string[] = [];
    for (const field of TOP_LEVEL_FIELDS) {
      row.push(csvEscape(String(event[field] ?? "")));
    }
    if (includePayload) {
      row.push(csvEscape(JSON.stringify(event.payload)));
    }
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

/**
 * Convert events to formatted JSON.
 */
export function eventsToJSON(events: AuditEvent[], includePayload?: boolean): string {
  if (!includePayload) {
    // Strip payloads
    const stripped = events.map((e) => {
      const { payload: _payload, ...rest } = e;
      return rest;
    });
    return JSON.stringify(stripped, null, 2);
  }
  return JSON.stringify(events, null, 2);
}

/**
 * Generate a compliance summary header for the export.
 */
export function generateComplianceHeader(result: ComplianceExportResult): string {
  const lines: string[] = [];
  lines.push("========================================");
  lines.push("SOC2 Compliance Audit Log Export");
  lines.push("========================================");
  lines.push(`Format:       ${result.format.toUpperCase()}`);
  lines.push(`Event Count:  ${result.eventCount}`);
  lines.push(
    `Date Range:   ${result.dateRange.start || "N/A"} to ${result.dateRange.end || "N/A"}`,
  );
  lines.push(`Generated At: ${result.generatedAt}`);
  lines.push("========================================");
  return lines.join("\n");
}
