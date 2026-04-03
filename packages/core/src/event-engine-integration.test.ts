/**
 * event-engine-integration.test.ts
 *
 * Integration tests for EventEngine + DurableEventStore
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { EventEngine } from "./event-engine.js";
import { JsonlEventStore } from "./durable-event-store.js";
import type { RuntimeEvent } from "@dantecode/runtime-spine";

const TEST_DIR = resolve(process.cwd(), ".test-events-integration");
const TEST_SESSION_ID = "integration-session";

describe("EventEngine + DurableEventStore Integration", () => {
  let eventStore: JsonlEventStore;
  let eventEngine: EventEngine;

  beforeEach(async () => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
    await mkdir(TEST_DIR, { recursive: true });

    eventStore = new JsonlEventStore(TEST_SESSION_ID, TEST_DIR);
    eventEngine = new EventEngine({ eventStore });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("emits events to the store", async () => {
    const taskId = randomUUID();
    const event: RuntimeEvent = {
      at: new Date().toISOString(),
      kind: "run.tool.started",
      taskId,
      payload: { tool: "bash", command: "echo hello" },
    };

    const eventId = await eventEngine.emit(event);

    expect(eventId).toBe(1);

    // Verify event was persisted
    const stored = await eventStore.getEvent(1);
    expect(stored.kind).toBe("run.tool.started");
    expect(stored.taskId).toBe(taskId);
  });

  it("emits multiple events with monotonic IDs", async () => {
    const taskId = randomUUID();

    const id1 = await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.tool.started",
      taskId,
      payload: {},
    });

    const id2 = await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.tool.completed",
      taskId,
      payload: {},
    });

    const id3 = await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.checkpoint.saved",
      taskId,
      payload: {},
    });

    expect([id1, id2, id3]).toEqual([1, 2, 3]);
  });

  it("allows searching events via the store", async () => {
    const taskId = randomUUID();

    await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.tool.started",
      taskId,
      payload: {},
    });

    await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.tool.completed",
      taskId,
      payload: {},
    });

    await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.tool.failed",
      taskId,
      payload: {},
    });

    // Search via the engine's store
    const store = eventEngine.getEventStore();
    expect(store).toBeDefined();

    const results = [];
    for await (const event of store!.search({ kind: "run.tool.started" })) {
      results.push(event);
    }

    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("run.tool.started");
  });

  it("persists events across engine instances", async () => {
    const taskId = randomUUID();

    // First engine instance
    await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.tool.started",
      taskId,
      payload: { index: 1 },
    });

    await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.tool.completed",
      taskId,
      payload: { index: 2 },
    });

    // Create new engine + store instances (simulates restart)
    const newStore = new JsonlEventStore(TEST_SESSION_ID, TEST_DIR);
    const newEngine = new EventEngine({ eventStore: newStore });

    // Emit more events
    await newEngine.emit({
      at: new Date().toISOString(),
      kind: "run.checkpoint.saved",
      taskId,
      payload: { index: 3 },
    });

    // Verify all events are readable
    const results = [];
    for await (const event of newStore.search({})) {
      results.push(event);
    }

    expect(results).toHaveLength(3);
    expect(results[0]?.payload?.index).toBe(1);
    expect(results[1]?.payload?.index).toBe(2);
    expect(results[2]?.payload?.index).toBe(3);
  });

  it("works without a store configured", async () => {
    const engineWithoutStore = new EventEngine();

    const result = await engineWithoutStore.emit({
      at: new Date().toISOString(),
      kind: "run.tool.started",
      taskId: randomUUID(),
      payload: {},
    });

    expect(result).toBeUndefined();
    expect(engineWithoutStore.getEventStore()).toBeUndefined();
  });

  it("supports filtering events by runId", async () => {
    const taskId1 = randomUUID();
    const taskId2 = randomUUID();

    await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.tool.started",
      taskId: taskId1,
      payload: {},
    });

    await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.tool.started",
      taskId: taskId2,
      payload: {},
    });

    await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.tool.completed",
      taskId: taskId1,
      payload: {},
    });

    const store = eventEngine.getEventStore();
    const results = [];
    for await (const event of store!.search({ runId: taskId1 })) {
      results.push(event);
    }

    expect(results).toHaveLength(2);
    expect(results.every((e) => e.taskId === taskId1)).toBe(true);
  });

  it("supports getEventsForRun convenience method", async () => {
    const taskId = randomUUID();

    await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.tool.started",
      taskId,
      payload: {},
    });

    await eventEngine.emit({
      at: new Date().toISOString(),
      kind: "run.tool.completed",
      taskId,
      payload: {},
    });

    const store = eventEngine.getEventStore();
    const results = [];
    for await (const event of store!.getEventsForRun(taskId)) {
      results.push(event);
    }

    expect(results).toHaveLength(2);
  });
});
