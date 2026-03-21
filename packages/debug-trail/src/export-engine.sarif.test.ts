// ============================================================================
// @dantecode/debug-trail — Export Engine SARIF + CSV Tests
// Covers CSV and SARIF format export (builder methods + disk integration).
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExportEngine } from "./export-engine.js";
import type { TrailEvent } from "./types.js";

// ============================================================================
// Test helpers
// ============================================================================

function makeEvent(overrides?: Partial<TrailEvent>): TrailEvent {
  return {
    id: "evt-1",
    seq: 1,
    kind: "tool_call",
    timestamp: "2026-03-21T00:00:00.000Z",
    actor: "agent",
    summary: "Ran bash command",
    payload: { filePath: "src/test.ts" },
    provenance: { sessionId: "sess-1", runId: "run-1" },
    trustScore: 0.9,
    beforeHash: undefined,
    afterHash: undefined,
    beforeSnapshotId: undefined,
    afterSnapshotId: undefined,
    ...overrides,
  };
}

// ============================================================================
// SARIF builder unit tests (via private method access)
// ============================================================================

describe("ExportEngine — buildSARIFReport", () => {
  let engine: ExportEngine;

  beforeEach(() => {
    engine = new ExportEngine();
  });

  it("SARIF-01: output is valid JSON", () => {
    const output = (engine as any).buildSARIFReport("sess-1", [], "2026-03-21T00:00:00.000Z");
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("SARIF-02: $schema field is correct SARIF 2.1.0 schema URL", () => {
    const output = (engine as any).buildSARIFReport("sess-1", [], "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    expect(parsed.$schema).toBe(
      "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0.json",
    );
  });

  it("SARIF-03: version is '2.1.0'", () => {
    const output = (engine as any).buildSARIFReport("sess-1", [], "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    expect(parsed.version).toBe("2.1.0");
  });

  it("SARIF-04: runs array has exactly 1 entry", () => {
    const output = (engine as any).buildSARIFReport("sess-1", [], "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed.runs)).toBe(true);
    expect(parsed.runs).toHaveLength(1);
  });

  it("SARIF-05: runs[0].tool.driver.name is 'DanteCode DebugTrail'", () => {
    const output = (engine as any).buildSARIFReport("sess-1", [], "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    expect(parsed.runs[0].tool.driver.name).toBe("DanteCode DebugTrail");
  });

  it("SARIF-06: runs[0].results is an array (empty for empty session)", () => {
    const output = (engine as any).buildSARIFReport("sess-1", [], "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed.runs[0].results)).toBe(true);
    expect(parsed.runs[0].results).toHaveLength(0);
  });

  it("SARIF-07: results length matches event count", () => {
    const events: TrailEvent[] = [
      makeEvent({ id: "e1", seq: 1, kind: "tool_call" }),
      makeEvent({ id: "e2", seq: 2, kind: "verification" }),
      makeEvent({ id: "e3", seq: 3, kind: "error" }),
    ];
    const output = (engine as any).buildSARIFReport("sess-1", events, "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    expect(parsed.runs[0].results).toHaveLength(3);
  });

  it("SARIF-08: event with kind 'error' maps to level 'error'", () => {
    const events: TrailEvent[] = [makeEvent({ id: "e1", seq: 1, kind: "error" })];
    const output = (engine as any).buildSARIFReport("sess-1", events, "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    expect(parsed.runs[0].results[0].level).toBe("error");
  });

  it("SARIF-09: event with kind 'anomaly_flag' maps to level 'error'", () => {
    const events: TrailEvent[] = [makeEvent({ id: "e1", seq: 1, kind: "anomaly_flag" })];
    const output = (engine as any).buildSARIFReport("sess-1", events, "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    expect(parsed.runs[0].results[0].level).toBe("error");
  });

  it("SARIF-10: event with kind 'verification' maps to level 'warning'", () => {
    const events: TrailEvent[] = [makeEvent({ id: "e1", seq: 1, kind: "verification" })];
    const output = (engine as any).buildSARIFReport("sess-1", events, "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    expect(parsed.runs[0].results[0].level).toBe("warning");
  });

  it("SARIF-11: event with unmapped kind defaults to level 'none'", () => {
    const events: TrailEvent[] = [makeEvent({ id: "e1", seq: 1, kind: "tool_call" })];
    const output = (engine as any).buildSARIFReport("sess-1", events, "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    expect(parsed.runs[0].results[0].level).toBe("none");
  });

  it("SARIF-12: event with filePath includes locations entry", () => {
    const events: TrailEvent[] = [
      makeEvent({ id: "e1", seq: 1, payload: { filePath: "src/index.ts" } }),
    ];
    const output = (engine as any).buildSARIFReport("sess-1", events, "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    const result = parsed.runs[0].results[0];
    expect(result.locations).toBeDefined();
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe("src/index.ts");
  });

  it("SARIF-13: event without filePath has no locations field", () => {
    const events: TrailEvent[] = [makeEvent({ id: "e1", seq: 1, payload: {} })];
    const output = (engine as any).buildSARIFReport("sess-1", events, "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    const result = parsed.runs[0].results[0];
    expect(result.locations).toBeUndefined();
  });

  it("SARIF-14: rules are deduplicated by kind", () => {
    const events: TrailEvent[] = [
      makeEvent({ id: "e1", seq: 1, kind: "tool_call" }),
      makeEvent({ id: "e2", seq: 2, kind: "tool_call" }),
      makeEvent({ id: "e3", seq: 3, kind: "error" }),
    ];
    const output = (engine as any).buildSARIFReport("sess-1", events, "2026-03-21T00:00:00.000Z");
    const parsed = JSON.parse(output);
    // 2 unique kinds: tool_call + error
    expect(parsed.runs[0].tool.driver.rules).toHaveLength(2);
  });

  it("SARIF-15: properties carries sessionId and exportedAt", () => {
    const exportedAt = "2026-03-21T12:34:56.000Z";
    const output = (engine as any).buildSARIFReport("sess-xyz", [], exportedAt);
    const parsed = JSON.parse(output);
    expect(parsed.runs[0].properties.sessionId).toBe("sess-xyz");
    expect(parsed.runs[0].properties.exportedAt).toBe(exportedAt);
  });
});

// ============================================================================
// CSV builder unit tests
// ============================================================================

describe("ExportEngine — buildCSVReport", () => {
  let engine: ExportEngine;

  beforeEach(() => {
    engine = new ExportEngine();
  });

  it("CSV-01: header row is 'timestamp,kind,actor,summary,filePath,outcome'", () => {
    const output = (engine as any).buildCSVReport([]);
    const firstLine = output.split("\n")[0];
    expect(firstLine).toBe("timestamp,kind,actor,summary,filePath,outcome");
  });

  it("CSV-02: empty events produce only the header row", () => {
    const output = (engine as any).buildCSVReport([]);
    const lines = output.split("\n");
    expect(lines).toHaveLength(1);
  });

  it("CSV-03: number of data rows matches event count", () => {
    const events: TrailEvent[] = [
      makeEvent({ id: "e1", seq: 1 }),
      makeEvent({ id: "e2", seq: 2 }),
      makeEvent({ id: "e3", seq: 3 }),
    ];
    const output = (engine as any).buildCSVReport(events);
    const lines = output.split("\n");
    // header + 3 rows
    expect(lines).toHaveLength(4);
  });

  it("CSV-04: error kind produces outcome 'error'", () => {
    const events: TrailEvent[] = [makeEvent({ id: "e1", seq: 1, kind: "error" })];
    const output = (engine as any).buildCSVReport(events);
    const dataRow = output.split("\n")[1]!;
    const fields = dataRow.split(",");
    expect(fields[fields.length - 1]).toBe("error");
  });

  it("CSV-05: non-error kind produces outcome 'ok'", () => {
    const events: TrailEvent[] = [makeEvent({ id: "e1", seq: 1, kind: "tool_call" })];
    const output = (engine as any).buildCSVReport(events);
    const dataRow = output.split("\n")[1]!;
    const fields = dataRow.split(",");
    expect(fields[fields.length - 1]).toBe("ok");
  });

  it("CSV-06: commas in summary are escaped with double-quotes", () => {
    const events: TrailEvent[] = [
      makeEvent({ id: "e1", seq: 1, summary: "step one, step two" }),
    ];
    const output = (engine as any).buildCSVReport(events);
    expect(output).toContain('"step one, step two"');
  });

  it("CSV-07: double-quotes in fields are escaped as double double-quotes", () => {
    const events: TrailEvent[] = [
      makeEvent({ id: "e1", seq: 1, summary: 'He said "hello"' }),
    ];
    const output = (engine as any).buildCSVReport(events);
    expect(output).toContain('"He said ""hello"""');
  });

  it("CSV-08: filePath from payload is included in output", () => {
    const events: TrailEvent[] = [
      makeEvent({ id: "e1", seq: 1, payload: { filePath: "src/main.ts" } }),
    ];
    const output = (engine as any).buildCSVReport(events);
    expect(output).toContain("src/main.ts");
  });

  it("CSV-09: missing filePath in payload produces empty field", () => {
    const events: TrailEvent[] = [makeEvent({ id: "e1", seq: 1, payload: {} })];
    const output = (engine as any).buildCSVReport(events);
    const dataRow = output.split("\n")[1]!;
    // The filePath column (index 4) should be empty: the row ends with ,,ok
    expect(dataRow).toContain(",,ok");
  });

  it("CSV-10: non-string filePath in payload is treated as empty", () => {
    const events: TrailEvent[] = [
      makeEvent({ id: "e1", seq: 1, payload: { filePath: 42 as unknown as string } }),
    ];
    const output = (engine as any).buildCSVReport(events);
    const dataRow = output.split("\n")[1]!;
    expect(dataRow).toContain(",,ok");
  });
});

// ============================================================================
// Disk integration tests (CSV + SARIF written to temp dir)
// ============================================================================

describe("ExportEngine — disk write (csv + sarif)", () => {
  let tmpDir: string;
  let engine: ExportEngine;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dt-sarif-test-"));
    engine = new ExportEngine({ storageRoot: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("DISK-01: CSV export writes a file to the specified outputPath", async () => {
    const outPath = join(tmpDir, "output.csv");
    // Use empty session — no events needed to test file creation
    // We need to seed the store slightly. Use a session that just has no events.
    const result = await engine.exportSession("sess-disk-csv", {
      format: "csv",
      outputPath: outPath,
    });

    expect(result.path).toBe(outPath);
    const content = await readFile(outPath, "utf8");
    // Should at least have the CSV header
    expect(content).toContain("timestamp,kind,actor,summary");
  });

  it("DISK-02: SARIF export writes a file to the specified outputPath", async () => {
    const outPath = join(tmpDir, "output.sarif");
    const result = await engine.exportSession("sess-disk-sarif", {
      format: "sarif",
      outputPath: outPath,
    });

    expect(result.path).toBe(outPath);
    const raw = await readFile(outPath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.runs[0].properties.sessionId).toBe("sess-disk-sarif");
  });

  it("DISK-03: SARIF export uses .sarif extension when no outputPath given", async () => {
    const result = await engine.exportSession("sess-ext-test", {
      format: "sarif",
    });

    expect(result.path).toMatch(/\.sarif$/);
  });

  it("DISK-04: CSV export uses .csv extension when no outputPath given", async () => {
    const result = await engine.exportSession("sess-ext-csv", {
      format: "csv",
    });

    expect(result.path).toMatch(/\.csv$/);
  });

  it("DISK-05: exportedAt field is present in SARIF properties", async () => {
    const outPath = join(tmpDir, "dated.sarif");
    await engine.exportSession("sess-dated", {
      format: "sarif",
      outputPath: outPath,
    });

    const raw = await readFile(outPath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.runs[0].properties.exportedAt).toBeTruthy();
  });
});
