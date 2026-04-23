// ============================================================================
// Sprint CA-CB: Compliance Audit Trail (dim 25) + Collaborative Context (dim 9)
// ============================================================================

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";

import {
  createAuditEvent,
  recordAuditEvent,
  loadAuditTrail,
  buildAuditTrailSummary,
  exportAuditTrailCSV,
} from "@dantecode/core";

import {
  buildCollaborativeSnapshot,
  formatSnapshotForPrompt,
  recordCollaborativeSnapshot,
  loadCollaborativeSnapshots,
  getCollaborationStats,
} from "@dantecode/core";

import type { DeveloperContext } from "@dantecode/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `sprint-ca-cb-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".danteforge"), { recursive: true });
  return dir;
}

function makeDev(overrides: Partial<DeveloperContext> = {}): DeveloperContext {
  return {
    developerId: `dev-${randomUUID()}`,
    currentFile: "src/index.ts",
    cursorLine: 1,
    recentFiles: ["src/index.ts"],
    activeSymbol: "main",
    editSessionId: randomUUID(),
    lastActiveAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sprint CA — Audit Trail Tests
// ---------------------------------------------------------------------------

describe("createAuditEvent", () => {
  it("assigns severity 'error' for security_alert events", () => {
    const event = createAuditEvent("sess-1", "security_alert", "system");
    expect(event.severity).toBe("error");
    expect(event.eventType).toBe("security_alert");
  });

  it("assigns severity 'warn' for policy_violation events", () => {
    const event = createAuditEvent("sess-1", "policy_violation", "agent");
    expect(event.severity).toBe("warn");
    expect(event.eventType).toBe("policy_violation");
  });

  it("defaults to 'info' severity for non-critical event types", () => {
    const event = createAuditEvent("sess-1", "file_read", "agent", "src/main.ts");
    expect(event.severity).toBe("info");
    expect(event.eventType).toBe("file_read");
  });

  it("allows severity override via parameter", () => {
    const event = createAuditEvent("sess-1", "file_write", "agent", undefined, undefined, "warn");
    expect(event.severity).toBe("warn");
  });

  it("generates a unique eventId for each call", () => {
    const e1 = createAuditEvent("sess-1", "tool_call", "agent");
    const e2 = createAuditEvent("sess-1", "tool_call", "agent");
    expect(e1.eventId).not.toBe(e2.eventId);
  });
});

describe("recordAuditEvent + loadAuditTrail", () => {
  it("recordAuditEvent creates .danteforge/audit-trail.json", () => {
    const dir = makeTmpDir();
    const event = createAuditEvent("sess-1", "session_start", "system");
    recordAuditEvent(event, dir);

    const loaded = loadAuditTrail(dir);
    expect(loaded.length).toBe(1);
    expect(loaded[0]!.eventId).toBe(event.eventId);
    expect(loaded[0]!.eventType).toBe("session_start");
  });

  it("loadAuditTrail reads and parses multiple JSONL lines", () => {
    const dir = makeTmpDir();
    const events = [
      createAuditEvent("sess-2", "file_read", "agent", "foo.ts"),
      createAuditEvent("sess-2", "file_write", "agent", "bar.ts"),
      createAuditEvent("sess-2", "tool_call", "agent", "Bash"),
    ];
    for (const e of events) recordAuditEvent(e, dir);

    const loaded = loadAuditTrail(dir);
    expect(loaded.length).toBe(3);
    expect(loaded[1]!.eventType).toBe("file_write");
  });

  it("loadAuditTrail returns empty array when file does not exist", () => {
    const dir = makeTmpDir();
    const result = loadAuditTrail(dir);
    expect(result).toEqual([]);
  });
});

describe("buildAuditTrailSummary", () => {
  it("correctly counts fileWriteCount", () => {
    const sessionId = "sess-count";
    const events = [
      createAuditEvent(sessionId, "file_write", "agent", "a.ts"),
      createAuditEvent(sessionId, "file_write", "agent", "b.ts"),
      createAuditEvent(sessionId, "file_read", "agent", "c.ts"),
      createAuditEvent(sessionId, "tool_call", "agent", "Bash"),
      createAuditEvent(sessionId, "security_alert", "system"),
      createAuditEvent("other-session", "file_write", "agent", "x.ts"),
    ];

    const summary = buildAuditTrailSummary(sessionId, events);
    expect(summary.fileWriteCount).toBe(2);
    expect(summary.toolCallCount).toBe(1);
    expect(summary.securityAlertCount).toBe(1);
    expect(summary.eventCount).toBe(5); // excludes other-session
  });
});

describe("exportAuditTrailCSV", () => {
  it("returns CSV string with correct header and row count", () => {
    const events = [
      createAuditEvent("sess-csv", "file_read", "agent", "main.ts"),
      createAuditEvent("sess-csv", "file_write", "agent", "output.ts"),
      createAuditEvent("sess-csv", "security_alert", "system"),
    ];

    const csv = exportAuditTrailCSV(events);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("eventId,sessionId,eventType,timestamp,actor,resource,severity");
    expect(lines.length).toBe(4); // header + 3 rows
  });

  it("handles resource values containing commas by quoting them", () => {
    const event = createAuditEvent("sess-csv", "file_read", "agent", "path/with,comma.ts");
    const csv = exportAuditTrailCSV([event]);
    expect(csv).toContain('"path/with,comma.ts"');
  });
});

// ---------------------------------------------------------------------------
// Sprint CB — Collaborative Context Tests
// ---------------------------------------------------------------------------

describe("buildCollaborativeSnapshot", () => {
  it("identifies conflictRisk when 2+ devs have the same currentFile", () => {
    const devs = [
      makeDev({ currentFile: "src/shared.ts" }),
      makeDev({ currentFile: "src/shared.ts" }),
      makeDev({ currentFile: "src/other.ts" }),
    ];

    const snap = buildCollaborativeSnapshot("proj-1", devs);
    expect(snap.sharedContext.conflictRisk).toContain("src/shared.ts");
    expect(snap.sharedContext.conflictRisk).not.toContain("src/other.ts");
  });

  it("identifies hotFiles as files in recentFiles of >= 2 developers", () => {
    const devs = [
      makeDev({ recentFiles: ["src/shared.ts", "src/a.ts"] }),
      makeDev({ recentFiles: ["src/shared.ts", "src/b.ts"] }),
      makeDev({ recentFiles: ["src/b.ts", "src/c.ts"] }),
    ];

    const snap = buildCollaborativeSnapshot("proj-2", devs);
    expect(snap.sharedContext.hotFiles).toContain("src/shared.ts");
    expect(snap.sharedContext.hotFiles).toContain("src/b.ts");
    expect(snap.sharedContext.hotFiles).not.toContain("src/a.ts");
    expect(snap.sharedContext.hotFiles).not.toContain("src/c.ts");
  });

  it("openFiles contains unique currentFile values", () => {
    const devs = [
      makeDev({ currentFile: "src/alpha.ts" }),
      makeDev({ currentFile: "src/beta.ts" }),
      makeDev({ currentFile: "src/alpha.ts" }),
    ];

    const snap = buildCollaborativeSnapshot("proj-3", devs);
    expect(snap.sharedContext.openFiles).toHaveLength(2);
    expect(snap.sharedContext.openFiles).toContain("src/alpha.ts");
    expect(snap.sharedContext.openFiles).toContain("src/beta.ts");
  });
});

describe("formatSnapshotForPrompt", () => {
  it("includes '## Collaborative Context' heading", () => {
    const devs = [makeDev(), makeDev()];
    const snap = buildCollaborativeSnapshot("proj-fmt", devs);
    const output = formatSnapshotForPrompt(snap);
    expect(output).toContain("## Collaborative Context");
  });

  it("includes active dev count", () => {
    const devs = [makeDev(), makeDev(), makeDev()];
    const snap = buildCollaborativeSnapshot("proj-fmt2", devs);
    const output = formatSnapshotForPrompt(snap);
    expect(output).toContain("Active devs: 3");
  });
});

describe("recordCollaborativeSnapshot + loadCollaborativeSnapshots", () => {
  it("recordCollaborativeSnapshot creates .danteforge/collaborative-snapshots.json", () => {
    const dir = makeTmpDir();
    const snap = buildCollaborativeSnapshot("proj-persist", [makeDev()]);
    recordCollaborativeSnapshot(snap, dir);

    const loaded = loadCollaborativeSnapshots(dir);
    expect(loaded.length).toBe(1);
    expect(loaded[0]!.projectId).toBe("proj-persist");
  });
});

describe("getCollaborationStats", () => {
  it("returns correct avgDeveloperCount", () => {
    const snap1 = buildCollaborativeSnapshot("p", [makeDev(), makeDev()]);        // 2 devs
    const snap2 = buildCollaborativeSnapshot("p", [makeDev(), makeDev(), makeDev()]); // 3 devs

    const stats = getCollaborationStats([snap1, snap2]);
    expect(stats.avgDeveloperCount).toBe(2.5);
    expect(stats.totalSnapshots).toBe(2);
  });

  it("correctly aggregates hotFilesList across snapshots (deduped)", () => {
    const devs1 = [
      makeDev({ recentFiles: ["src/foo.ts", "src/bar.ts"] }),
      makeDev({ recentFiles: ["src/foo.ts", "src/baz.ts"] }),
    ];
    const devs2 = [
      makeDev({ recentFiles: ["src/bar.ts", "src/qux.ts"] }),
      makeDev({ recentFiles: ["src/bar.ts", "src/qux.ts"] }),
    ];

    const snap1 = buildCollaborativeSnapshot("p", devs1);
    const snap2 = buildCollaborativeSnapshot("p", devs2);

    const stats = getCollaborationStats([snap1, snap2]);
    // snap1 hotFiles: foo.ts; snap2 hotFiles: bar.ts, qux.ts
    expect(stats.hotFilesList).toContain("src/foo.ts");
    expect(stats.hotFilesList).toContain("src/bar.ts");
    expect(stats.hotFilesList).toContain("src/qux.ts");
    // deduped
    const uniqueCount = new Set(stats.hotFilesList).size;
    expect(uniqueCount).toBe(stats.hotFilesList.length);
  });

  it("returns zeros for empty snapshot array", () => {
    const stats = getCollaborationStats([]);
    expect(stats.totalSnapshots).toBe(0);
    expect(stats.avgDeveloperCount).toBe(0);
    expect(stats.totalConflictRiskEvents).toBe(0);
    expect(stats.hotFilesList).toEqual([]);
  });
});
