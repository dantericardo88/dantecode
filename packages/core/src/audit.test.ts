import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendAuditEvent, readAuditEvents, countAuditEvents } from "./audit.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("audit logger", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dantecode-audit-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("appendAuditEvent", () => {
    it("creates the .dantecode directory if missing", async () => {
      const event = await appendAuditEvent(testDir, {
        sessionId: "test-session-1",
        timestamp: new Date().toISOString(),
        type: "session_start",
        payload: { source: "test" },
        modelId: "test-model",
        projectRoot: testDir,
      });

      expect(event.id).toBeTruthy();
      expect(event.type).toBe("session_start");
    });

    it("assigns a UUID id to each event", async () => {
      const event = await appendAuditEvent(testDir, {
        sessionId: "test-session-1",
        timestamp: new Date().toISOString(),
        type: "session_start",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });

      expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("persists events that can be read back", async () => {
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T10:00:00Z",
        type: "session_start",
        payload: { msg: "hello" },
        modelId: "test-model",
        projectRoot: testDir,
      });

      const events = await readAuditEvents(testDir);
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("session_start");
      expect(events[0]?.payload).toEqual({ msg: "hello" });
    });

    it("appends multiple events in order", async () => {
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T10:00:00Z",
        type: "session_start",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T10:01:00Z",
        type: "file_read",
        payload: { path: "/src/index.ts" },
        modelId: "test-model",
        projectRoot: testDir,
      });
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T10:02:00Z",
        type: "session_end",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });

      const events = await readAuditEvents(testDir);
      expect(events).toHaveLength(3);
      expect(events[0]?.type).toBe("session_start");
      expect(events[1]?.type).toBe("file_read");
      expect(events[2]?.type).toBe("session_end");
    });
  });

  describe("readAuditEvents", () => {
    it("returns empty array when log file does not exist", async () => {
      const events = await readAuditEvents(testDir);
      expect(events).toEqual([]);
    });

    it("filters by sessionId", async () => {
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T10:00:00Z",
        type: "session_start",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });
      await appendAuditEvent(testDir, {
        sessionId: "s2",
        timestamp: "2026-03-15T10:01:00Z",
        type: "session_start",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });

      const events = await readAuditEvents(testDir, { sessionId: "s1" });
      expect(events).toHaveLength(1);
      expect(events[0]?.sessionId).toBe("s1");
    });

    it("filters by event type", async () => {
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T10:00:00Z",
        type: "session_start",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T10:01:00Z",
        type: "file_read",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });

      const events = await readAuditEvents(testDir, { type: "file_read" });
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("file_read");
    });

    it("filters by time range (since)", async () => {
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T08:00:00Z",
        type: "session_start",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T12:00:00Z",
        type: "session_end",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });

      const events = await readAuditEvents(testDir, {
        since: "2026-03-15T10:00:00Z",
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("session_end");
    });

    it("supports pagination with limit and offset", async () => {
      for (let i = 0; i < 5; i++) {
        await appendAuditEvent(testDir, {
          sessionId: "s1",
          timestamp: `2026-03-15T10:0${i}:00Z`,
          type: "file_read",
          payload: { index: i },
          modelId: "test-model",
          projectRoot: testDir,
        });
      }

      const page = await readAuditEvents(testDir, { limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
      expect(page[0]?.payload).toEqual({ index: 1 });
      expect(page[1]?.payload).toEqual({ index: 2 });
    });

    it("returns events in chronological order", async () => {
      // Insert out of order
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T12:00:00Z",
        type: "session_end",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T08:00:00Z",
        type: "session_start",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });

      const events = await readAuditEvents(testDir);
      expect(events[0]?.type).toBe("session_start");
      expect(events[1]?.type).toBe("session_end");
    });
  });

  describe("countAuditEvents", () => {
    it("returns 0 for empty log", async () => {
      const count = await countAuditEvents(testDir);
      expect(count).toBe(0);
    });

    it("counts filtered events", async () => {
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T10:00:00Z",
        type: "session_start",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });
      await appendAuditEvent(testDir, {
        sessionId: "s1",
        timestamp: "2026-03-15T10:01:00Z",
        type: "file_read",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });
      await appendAuditEvent(testDir, {
        sessionId: "s2",
        timestamp: "2026-03-15T10:02:00Z",
        type: "session_start",
        payload: {},
        modelId: "test-model",
        projectRoot: testDir,
      });

      const totalCount = await countAuditEvents(testDir);
      expect(totalCount).toBe(3);

      const sessionCount = await countAuditEvents(testDir, { sessionId: "s1" });
      expect(sessionCount).toBe(2);
    });
  });
});
