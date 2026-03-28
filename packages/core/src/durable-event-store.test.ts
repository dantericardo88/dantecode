/**
 * durable-event-store.test.ts
 *
 * Tests for JSONL-based durable event store.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { JsonlEventStore, type StoredEvent } from "./durable-event-store.js";
import type { RuntimeEvent } from "@dantecode/runtime-spine";

const TEST_DIR = resolve(process.cwd(), ".test-events");
const TEST_SESSION_ID = "test-session-123";

describe("JsonlEventStore", () => {
  let store: JsonlEventStore;

  beforeEach(async () => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
    await mkdir(TEST_DIR, { recursive: true });

    store = new JsonlEventStore(TEST_SESSION_ID, TEST_DIR);
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Append Events (10 tests)
  // =========================================================================

  describe("append", () => {
    it("appends first event with id 1", async () => {
      const event: RuntimeEvent = {
        at: new Date().toISOString(),
        kind: "run.tool.started",
        taskId: randomUUID(),
        payload: { tool: "bash" },
      };

      const id = await store.append(event);

      expect(id).toBe(1);
    });

    it("assigns monotonically increasing ids", async () => {
      const taskId = randomUUID();
      const ids: number[] = [];

      for (let i = 0; i < 5; i++) {
        const event: RuntimeEvent = {
          at: new Date().toISOString(),
          kind: "run.tool.started",
          taskId,
          payload: { index: i },
        };
        ids.push(await store.append(event));
      }

      expect(ids).toEqual([1, 2, 3, 4, 5]);
    });

    it("persists events to disk", async () => {
      const event: RuntimeEvent = {
        at: new Date().toISOString(),
        kind: "run.checkpoint.saved",
        taskId: randomUUID(),
        payload: { version: 1 },
      };

      await store.append(event);

      expect(existsSync(store.getFilePath())).toBe(true);
    });

    it("writes one JSON object per line", async () => {
      const taskId = randomUUID();
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.completed", taskId, payload: {} });

      const content = await (await import("node:fs/promises")).readFile(store.getFilePath(), "utf-8");
      const lineArray = content.trim().split("\n");

      expect(lineArray).toHaveLength(2);
      expect(() => JSON.parse(lineArray[0] ?? "")).not.toThrow();
      expect(() => JSON.parse(lineArray[1] ?? "")).not.toThrow();
    });

    it("preserves event payload structure", async () => {
      const event: RuntimeEvent = {
        at: "2026-03-28T10:00:00Z",
        kind: "run.plan.created",
        taskId: randomUUID(),
        payload: { steps: 5, complexity: "high" },
      };

      const id = await store.append(event);
      const retrieved = await store.getEvent(id);

      expect(retrieved.payload).toEqual(event.payload);
      expect(retrieved.kind).toBe(event.kind);
      expect(retrieved.taskId).toBe(event.taskId);
    });

    it("handles events with optional parentId", async () => {
      const event: RuntimeEvent = {
        at: new Date().toISOString(),
        kind: "subagent.spawned",
        taskId: randomUUID(),
        parentId: randomUUID(),
        payload: { name: "test-agent" },
      };

      const id = await store.append(event);
      const retrieved = await store.getEvent(id);

      expect(retrieved.parentId).toBe(event.parentId);
    });

    it("handles empty payload", async () => {
      const event: RuntimeEvent = {
        at: new Date().toISOString(),
        kind: "run.mode.selected",
        taskId: randomUUID(),
        payload: {},
      };

      const id = await store.append(event);
      const retrieved = await store.getEvent(id);

      expect(retrieved.payload).toEqual({});
    });

    it("handles large payloads", async () => {
      const largePayload = {
        data: Array(1000)
          .fill(0)
          .map((_, i) => ({ index: i, value: `item-${i}` })),
      };

      const event: RuntimeEvent = {
        at: new Date().toISOString(),
        kind: "runtime.synthesis.completed",
        taskId: randomUUID(),
        payload: largePayload,
      };

      const id = await store.append(event);
      const retrieved = await store.getEvent(id);

      expect(retrieved.payload).toEqual(largePayload);
    });

    it("creates directory if it does not exist", async () => {
      const deepPath = resolve(TEST_DIR, "deep", "nested", "path");
      const deepStore = new JsonlEventStore("deep-session", deepPath);

      await deepStore.append({
        at: new Date().toISOString(),
        kind: "run.tool.started",
        taskId: randomUUID(),
        payload: {},
      });

      expect(existsSync(deepStore.getFilePath())).toBe(true);
    });

    it("initializes nextId from existing file", async () => {
      // Append 3 events
      const taskId = randomUUID();
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });

      // Create new store instance pointing to same file
      const store2 = new JsonlEventStore(TEST_SESSION_ID, TEST_DIR);
      const id = await store2.append({
        at: new Date().toISOString(),
        kind: "run.tool.started",
        taskId,
        payload: {},
      });

      expect(id).toBe(4);
    });
  });

  // =========================================================================
  // Search with Filters (15 tests)
  // =========================================================================

  describe("search", () => {
    it("returns all events when no filter provided", async () => {
      const taskId = randomUUID();
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.completed", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.checkpoint.saved", taskId, payload: {} });

      const results: StoredEvent[] = [];
      for await (const event of store.search({})) {
        results.push(event);
      }

      expect(results).toHaveLength(3);
    });

    it("filters by runId (taskId)", async () => {
      const taskId1 = randomUUID();
      const taskId2 = randomUUID();

      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId: taskId1, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId: taskId2, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.completed", taskId: taskId1, payload: {} });

      const results: StoredEvent[] = [];
      for await (const event of store.search({ runId: taskId1 })) {
        results.push(event);
      }

      expect(results).toHaveLength(2);
      expect(results.every((e) => e.taskId === taskId1)).toBe(true);
    });

    it("filters by kind (single string)", async () => {
      const taskId = randomUUID();
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.completed", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });

      const results: StoredEvent[] = [];
      for await (const event of store.search({ kind: "run.tool.started" })) {
        results.push(event);
      }

      expect(results).toHaveLength(2);
      expect(results.every((e) => e.kind === "run.tool.started")).toBe(true);
    });

    it("filters by kind (array of strings)", async () => {
      const taskId = randomUUID();
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.completed", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.checkpoint.saved", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.failed", taskId, payload: {} });

      const results: StoredEvent[] = [];
      for await (const event of store.search({ kind: ["run.tool.started", "run.tool.failed"] })) {
        results.push(event);
      }

      expect(results).toHaveLength(2);
      expect(results.map((e) => e.kind).sort()).toEqual(["run.tool.failed", "run.tool.started"]);
    });

    it("filters by afterId (exclusive)", async () => {
      const taskId = randomUUID();
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} }); // id=1
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} }); // id=2
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} }); // id=3
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} }); // id=4

      const results: StoredEvent[] = [];
      for await (const event of store.search({ afterId: 2 })) {
        results.push(event);
      }

      expect(results).toHaveLength(2);
      expect(results.map((e) => e.id)).toEqual([3, 4]);
    });

    it("filters by beforeId (exclusive)", async () => {
      const taskId = randomUUID();
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} }); // id=1
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} }); // id=2
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} }); // id=3
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} }); // id=4

      const results: StoredEvent[] = [];
      for await (const event of store.search({ beforeId: 3 })) {
        results.push(event);
      }

      expect(results).toHaveLength(2);
      expect(results.map((e) => e.id)).toEqual([1, 2]);
    });

    it("filters by range (afterId and beforeId)", async () => {
      const taskId = randomUUID();
      for (let i = 0; i < 10; i++) {
        await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });
      }

      const results: StoredEvent[] = [];
      for await (const event of store.search({ afterId: 3, beforeId: 7 })) {
        results.push(event);
      }

      expect(results).toHaveLength(3);
      expect(results.map((e) => e.id)).toEqual([4, 5, 6]);
    });

    it("respects limit", async () => {
      const taskId = randomUUID();
      for (let i = 0; i < 10; i++) {
        await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });
      }

      const results: StoredEvent[] = [];
      for await (const event of store.search({ limit: 3 })) {
        results.push(event);
      }

      expect(results).toHaveLength(3);
      expect(results.map((e) => e.id)).toEqual([1, 2, 3]);
    });

    it("combines multiple filters", async () => {
      const taskId1 = randomUUID();
      const taskId2 = randomUUID();

      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId: taskId1, payload: {} }); // 1
      await store.append({ at: new Date().toISOString(), kind: "run.tool.completed", taskId: taskId1, payload: {} }); // 2
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId: taskId2, payload: {} }); // 3
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId: taskId1, payload: {} }); // 4
      await store.append({ at: new Date().toISOString(), kind: "run.tool.completed", taskId: taskId1, payload: {} }); // 5

      const results: StoredEvent[] = [];
      for await (const event of store.search({
        runId: taskId1,
        kind: "run.tool.started",
        afterId: 1,
        limit: 1,
      })) {
        results.push(event);
      }

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(4);
      expect(results[0]?.kind).toBe("run.tool.started");
      expect(results[0]?.taskId).toBe(taskId1);
    });

    it("returns empty iterable for empty store", async () => {
      const results: StoredEvent[] = [];
      for await (const event of store.search({})) {
        results.push(event);
      }

      expect(results).toHaveLength(0);
    });

    it("skips corrupted lines with warning", async () => {
      const taskId = randomUUID();
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });

      // Manually corrupt a line
      const filePath = store.getFilePath();
      await writeFile(
        filePath,
        (await import("node:fs/promises").then((m) => m.readFile(filePath, "utf-8"))) + "{corrupted json\n",
        "utf-8",
      );

      await store.append({ at: new Date().toISOString(), kind: "run.tool.completed", taskId, payload: {} });

      const results: StoredEvent[] = [];
      for await (const event of store.search({})) {
        results.push(event);
      }

      // Should skip corrupted line
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.kind)).toEqual(["run.tool.started", "run.tool.completed"]);
    });

    it("handles empty lines gracefully", async () => {
      const taskId = randomUUID();
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });

      // Add empty lines
      const filePath = store.getFilePath();
      await writeFile(
        filePath,
        (await import("node:fs/promises").then((m) => m.readFile(filePath, "utf-8"))) + "\n\n\n",
        "utf-8",
      );

      await store.append({ at: new Date().toISOString(), kind: "run.tool.completed", taskId, payload: {} });

      const results: StoredEvent[] = [];
      for await (const event of store.search({})) {
        results.push(event);
      }

      expect(results).toHaveLength(2);
    });

    it("supports streaming large result sets", async () => {
      const taskId = randomUUID();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: { i } });
      }

      let seen = 0;
      for await (const event of store.search({})) {
        expect(event.id).toBe(seen + 1);
        seen++;
      }

      expect(seen).toBe(count);
    });

    it("returns events in insertion order", async () => {
      const taskId = randomUUID();
      const timestamps: string[] = [];

      for (let i = 0; i < 5; i++) {
        const ts = new Date(Date.now() + i * 1000).toISOString();
        timestamps.push(ts);
        await store.append({ at: ts, kind: "run.tool.started", taskId, payload: {} });
      }

      const results: StoredEvent[] = [];
      for await (const event of store.search({})) {
        results.push(event);
      }

      expect(results.map((e) => e.at)).toEqual(timestamps);
    });

    it("handles Unicode in payloads", async () => {
      const event: RuntimeEvent = {
        at: new Date().toISOString(),
        kind: "run.plan.created",
        taskId: randomUUID(),
        payload: { description: "测试 Unicode 🚀" },
      };

      const id = await store.append(event);
      const retrieved = await store.getEvent(id);

      expect(retrieved.payload.description).toBe("测试 Unicode 🚀");
    });
  });

  // =========================================================================
  // Edge Cases (10 tests)
  // =========================================================================

  describe("edge cases", () => {
    it("getEvent throws when event not found", async () => {
      await expect(store.getEvent(999)).rejects.toThrow("Event with id 999 not found");
    });

    it("getLatestId returns 0 for empty store", async () => {
      const latestId = await store.getLatestId();
      expect(latestId).toBe(0);
    });

    it("getLatestId returns correct id after appends", async () => {
      const taskId = randomUUID();
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });

      const latestId = await store.getLatestId();
      expect(latestId).toBe(3);
    });

    it("getEventsForRun is equivalent to search with runId", async () => {
      const taskId1 = randomUUID();
      const taskId2 = randomUUID();

      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId: taskId1, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId: taskId2, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.completed", taskId: taskId1, payload: {} });

      const results1: StoredEvent[] = [];
      for await (const event of store.getEventsForRun(taskId1)) {
        results1.push(event);
      }

      const results2: StoredEvent[] = [];
      for await (const event of store.search({ runId: taskId1 })) {
        results2.push(event);
      }

      expect(results1).toEqual(results2);
    });

    it("flush is a no-op", async () => {
      await expect(store.flush()).resolves.toBeUndefined();
    });

    it("getFilePath returns correct path", () => {
      expect(store.getFilePath()).toBe(resolve(TEST_DIR, `${TEST_SESSION_ID}.jsonl`));
    });

    it("getSessionId returns session id", () => {
      expect(store.getSessionId()).toBe(TEST_SESSION_ID);
    });

    it("handles concurrent appends", async () => {
      const taskId = randomUUID();
      const promises = Array(10)
        .fill(0)
        .map((_, i) =>
          store.append({
            at: new Date().toISOString(),
            kind: "run.tool.started",
            taskId,
            payload: { i },
          }),
        );

      const ids = await Promise.all(promises);

      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);

      // IDs should be in range [1, 10]
      expect(Math.min(...ids)).toBe(1);
      expect(Math.max(...ids)).toBe(10);
    });

    it("survives process restart (durability test)", async () => {
      const taskId = randomUUID();

      // Append 100 events
      for (let i = 0; i < 100; i++) {
        await store.append({
          at: new Date().toISOString(),
          kind: "run.tool.started",
          taskId,
          payload: { index: i },
        });
      }

      // Create new store instance (simulates process restart)
      const store2 = new JsonlEventStore(TEST_SESSION_ID, TEST_DIR);

      // Verify all 100 events are readable
      const results: StoredEvent[] = [];
      for await (const event of store2.search({})) {
        results.push(event);
      }

      expect(results).toHaveLength(100);
      expect(results[0]?.id).toBe(1);
      expect(results[99]?.id).toBe(100);
      expect(results[99]?.payload?.index).toBe(99);
    });

    it("handles corrupted last line during getLatestId", async () => {
      const taskId = randomUUID();
      await store.append({ at: new Date().toISOString(), kind: "run.tool.started", taskId, payload: {} });
      await store.append({ at: new Date().toISOString(), kind: "run.tool.completed", taskId, payload: {} });

      // Corrupt last line
      const filePath = store.getFilePath();
      await writeFile(
        filePath,
        (await import("node:fs/promises").then((m) => m.readFile(filePath, "utf-8"))) + "{corrupted\n",
        "utf-8",
      );

      const latestId = await store.getLatestId();
      expect(latestId).toBe(2); // Should skip corrupted line and return last valid
    });
  });
});
