// ============================================================================
// @dantecode/core — Compliance Export Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  exportAuditLog,
  maskSensitiveFields,
  filterEvents,
  eventsToCSV,
  eventsToJSON,
  generateComplianceHeader,
} from "./compliance-export.js";
import type { AuditEvent } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  overrides?: Partial<AuditEvent>,
): AuditEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: "session-1",
    timestamp: "2026-03-10T10:00:00.000Z",
    type: "file_read",
    payload: { path: "/src/index.ts", apiKey: "sk-secret-123" },
    modelId: "grok-4",
    projectRoot: "/project",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// exportAuditLog
// ---------------------------------------------------------------------------

describe("exportAuditLog", () => {
  it("produces CSV output with headers and data rows", () => {
    const events = [
      makeEvent({ id: "e1", type: "file_read" }),
      makeEvent({ id: "e2", type: "file_write" }),
    ];
    const result = exportAuditLog(events, { format: "csv" });

    expect(result.format).toBe("csv");
    expect(result.eventCount).toBe(2);
    // Should have a header row + 2 data rows
    const lines = result.data.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("sessionId");
    expect(lines[0]).toContain("timestamp");
    expect(lines[0]).toContain("type");
  });

  it("produces JSON output", () => {
    const events = [
      makeEvent({ id: "e1" }),
      makeEvent({ id: "e2" }),
    ];
    const result = exportAuditLog(events, { format: "json" });

    expect(result.format).toBe("json");
    expect(result.eventCount).toBe(2);
    const parsed = JSON.parse(result.data);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it("includes payload in JSON when requested", () => {
    const events = [makeEvent({ payload: { secret: "hello" } })];
    const result = exportAuditLog(events, {
      format: "json",
      includePayload: true,
    });
    const parsed = JSON.parse(result.data);
    expect(parsed[0].payload).toBeDefined();
    expect(parsed[0].payload.secret).toBe("hello");
  });

  it("excludes payload from JSON by default", () => {
    const events = [makeEvent({ payload: { secret: "hello" } })];
    const result = exportAuditLog(events, { format: "json" });
    const parsed = JSON.parse(result.data);
    expect(parsed[0].payload).toBeUndefined();
  });

  it("applies masking during export", () => {
    const events = [
      makeEvent({ payload: { path: "/src/a.ts", apiKey: "sk-xyz" } }),
    ];
    const result = exportAuditLog(events, {
      format: "json",
      includePayload: true,
      maskFields: ["apiKey"],
    });
    const parsed = JSON.parse(result.data);
    expect(parsed[0].payload.apiKey).toBe("[REDACTED]");
    expect(parsed[0].payload.path).toBe("/src/a.ts");
  });

  it("returns empty data for empty events", () => {
    const result = exportAuditLog([], { format: "csv" });
    expect(result.eventCount).toBe(0);
    // Should still have the header row
    const lines = result.data.split("\n");
    expect(lines.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// maskSensitiveFields
// ---------------------------------------------------------------------------

describe("maskSensitiveFields", () => {
  it("redacts specified top-level fields with default mask", () => {
    const event = makeEvent({ modelId: "grok-4" });
    const masked = maskSensitiveFields(event, ["modelId"]);
    expect(masked.modelId).toBe("[REDACTED]");
    // Original should not be mutated
    expect(event.modelId).toBe("grok-4");
  });

  it("redacts payload fields", () => {
    const event = makeEvent({ payload: { apiKey: "sk-123", path: "/foo" } });
    const masked = maskSensitiveFields(event, ["apiKey"]);
    expect(masked.payload["apiKey"]).toBe("[REDACTED]");
    expect(masked.payload["path"]).toBe("/foo");
  });

  it("uses a custom mask string", () => {
    const event = makeEvent({ payload: { apiKey: "sk-abc" } });
    const masked = maskSensitiveFields(event, ["apiKey"], "***");
    expect(masked.payload["apiKey"]).toBe("***");
  });
});

// ---------------------------------------------------------------------------
// filterEvents
// ---------------------------------------------------------------------------

describe("filterEvents", () => {
  const events: AuditEvent[] = [
    makeEvent({
      type: "session_start",
      timestamp: "2026-03-01T00:00:00.000Z",
    }),
    makeEvent({
      type: "file_read",
      timestamp: "2026-03-05T12:00:00.000Z",
    }),
    makeEvent({
      type: "file_write",
      timestamp: "2026-03-10T18:00:00.000Z",
    }),
    makeEvent({
      type: "session_end",
      timestamp: "2026-03-15T00:00:00.000Z",
    }),
  ];

  it("filters by date range", () => {
    const filtered = filterEvents(events, {
      startDate: "2026-03-04T00:00:00.000Z",
      endDate: "2026-03-11T00:00:00.000Z",
    });
    expect(filtered).toHaveLength(2);
    expect(filtered[0]!.type).toBe("file_read");
    expect(filtered[1]!.type).toBe("file_write");
  });

  it("filters by event type", () => {
    const filtered = filterEvents(events, {
      eventTypes: ["session_start", "session_end"],
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.type.startsWith("session"))).toBe(true);
  });

  it("returns all events when no filters provided", () => {
    const filtered = filterEvents(events, {});
    expect(filtered).toHaveLength(4);
  });

  it("combines date and type filters", () => {
    const filtered = filterEvents(events, {
      startDate: "2026-03-04T00:00:00.000Z",
      eventTypes: ["file_read"],
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.type).toBe("file_read");
  });
});

// ---------------------------------------------------------------------------
// eventsToCSV — RFC 4180 compliance
// ---------------------------------------------------------------------------

describe("eventsToCSV", () => {
  it("escapes fields containing commas", () => {
    const event = makeEvent({ projectRoot: "/path,with,commas" });
    const csv = eventsToCSV([event]);
    // The field should be wrapped in double quotes
    expect(csv).toContain('"/path,with,commas"');
  });

  it("escapes fields containing double quotes", () => {
    const event = makeEvent({ projectRoot: '/path"with"quotes' });
    const csv = eventsToCSV([event]);
    // RFC 4180: double-quotes inside are escaped by doubling
    expect(csv).toContain('"/path""with""quotes"');
  });

  it("escapes fields containing newlines", () => {
    const event = makeEvent({ projectRoot: "/path\nwith\nnewlines" });
    const csv = eventsToCSV([event]);
    expect(csv).toContain('"/path\nwith\nnewlines"');
  });

  it("includes payload column when requested", () => {
    const event = makeEvent({ payload: { key: "value" } });
    const csv = eventsToCSV([event], true);
    const header = csv.split("\n")[0];
    expect(header).toContain("payload");
    // The data row should contain the serialized payload
    const dataRow = csv.split("\n")[1];
    expect(dataRow).toContain("key");
  });
});

// ---------------------------------------------------------------------------
// eventsToJSON
// ---------------------------------------------------------------------------

describe("eventsToJSON", () => {
  it("produces pretty-printed JSON", () => {
    const events = [makeEvent()];
    const json = eventsToJSON(events, true);
    // Pretty-printed JSON has newlines and indentation
    expect(json).toContain("\n");
    expect(json).toContain("  ");
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
  });

  it("strips payload when includePayload is false", () => {
    const events = [makeEvent({ payload: { secret: "x" } })];
    const json = eventsToJSON(events, false);
    const parsed = JSON.parse(json);
    expect(parsed[0].payload).toBeUndefined();
    // But other fields should be present
    expect(parsed[0].id).toBeDefined();
    expect(parsed[0].type).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// generateComplianceHeader
// ---------------------------------------------------------------------------

describe("generateComplianceHeader", () => {
  it("includes all metadata fields", () => {
    const result = exportAuditLog(
      [
        makeEvent({ timestamp: "2026-03-01T00:00:00.000Z" }),
        makeEvent({ timestamp: "2026-03-15T00:00:00.000Z" }),
      ],
      { format: "csv" },
    );

    const header = generateComplianceHeader(result);

    expect(header).toContain("SOC2 Compliance Audit Log Export");
    expect(header).toContain("CSV");
    expect(header).toContain("Event Count:  2");
    expect(header).toContain("2026-03-01");
    expect(header).toContain("2026-03-15");
    expect(header).toContain("Generated At:");
  });

  it("handles empty export results with N/A date range", () => {
    const result = exportAuditLog([], { format: "json" });
    const header = generateComplianceHeader(result);
    expect(header).toContain("N/A");
    expect(header).toContain("Event Count:  0");
  });
});
