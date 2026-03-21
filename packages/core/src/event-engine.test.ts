/**
 * event-engine.test.ts
 *
 * 30 unit tests for EventEngine.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEngine, type DanteEvent, type WorkflowDefinition } from "./event-engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "wf-1",
    name: "Test Workflow",
    trigger: "git:commit",
    handler: vi.fn().mockResolvedValue(undefined),
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventEngine", () => {
  let engine: EventEngine;

  beforeEach(() => {
    engine = new EventEngine();
  });

  // 1
  it("registerWorkflow() adds a workflow", () => {
    const wf = makeWorkflow();
    engine.registerWorkflow(wf);
    expect(engine.getWorkflows()).toHaveLength(1);
    expect(engine.getWorkflows()[0]!.id).toBe("wf-1");
  });

  // 2
  it("registerWorkflow() throws on duplicate ID", () => {
    engine.registerWorkflow(makeWorkflow());
    expect(() => engine.registerWorkflow(makeWorkflow())).toThrow(/already registered/);
  });

  // 3
  it("unregisterWorkflow() removes workflow and returns true", () => {
    engine.registerWorkflow(makeWorkflow());
    const removed = engine.unregisterWorkflow("wf-1");
    expect(removed).toBe(true);
    expect(engine.getWorkflows()).toHaveLength(0);
  });

  // 4
  it("unregisterWorkflow() returns false for unknown ID", () => {
    const removed = engine.unregisterWorkflow("does-not-exist");
    expect(removed).toBe(false);
  });

  // 5
  it("enableWorkflow() and disableWorkflow() toggle enabled flag", () => {
    engine.registerWorkflow(makeWorkflow({ enabled: false }));
    expect(engine.getWorkflows()[0]!.enabled).toBe(false);

    const enabled = engine.enableWorkflow("wf-1");
    expect(enabled).toBe(true);
    expect(engine.getWorkflows()[0]!.enabled).toBe(true);

    const disabled = engine.disableWorkflow("wf-1");
    expect(disabled).toBe(true);
    expect(engine.getWorkflows()[0]!.enabled).toBe(false);
  });

  // 6
  it("enqueue() creates an event with the correct type", () => {
    const event = engine.enqueue("git:push", { branch: "main" });
    expect(event.type).toBe("git:push");
  });

  // 7
  it("enqueue() respects maxQueueSize", () => {
    const small = new EventEngine({ maxQueueSize: 2 });
    small.enqueue("git:commit", {});
    small.enqueue("git:commit", {});
    small.enqueue("git:commit", {}); // should be silently dropped
    expect(small.getQueueLength()).toBe(2);
  });

  // 8
  it("enqueue() returns the created event", () => {
    const event = engine.enqueue("fs:change", { path: "/foo/bar.ts" });
    expect(event).toMatchObject({
      type: "fs:change",
      payload: { path: "/foo/bar.ts" },
      processed: false,
    });
    expect(typeof event.id).toBe("string");
    expect(typeof event.timestamp).toBe("string");
  });

  // 9
  it("processNext() handles empty queue gracefully", async () => {
    const result = await engine.processNext();
    expect(result.processed).toBe(false);
    expect(result.event).toBeUndefined();
  });

  // 10
  it("processNext() calls matching workflow handler", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    engine.registerWorkflow(makeWorkflow({ handler }));
    engine.enqueue("git:commit", {});
    await engine.processNext();
    expect(handler).toHaveBeenCalledOnce();
  });

  // 11
  it("processNext() marks event as processed", async () => {
    engine.registerWorkflow(makeWorkflow());
    engine.enqueue("git:commit", {});
    const result = await engine.processNext();
    expect(result.processed).toBe(true);
    expect(result.event?.processed).toBe(true);
  });

  // 12
  it("processNext() skips disabled workflows", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    engine.registerWorkflow(makeWorkflow({ enabled: false, handler }));
    engine.enqueue("git:commit", {});
    await engine.processNext();
    expect(handler).not.toHaveBeenCalled();
  });

  // 13
  it("processNext() handles handler errors gracefully", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    // maxAttempts=1 so a single attempt exhausts retries
    const eng = new EventEngine({ maxAttempts: 1 });
    eng.registerWorkflow(makeWorkflow({ handler }));
    eng.enqueue("git:commit", {});
    const result = await eng.processNext();
    // After exhausting attempts the event is still marked processed
    expect(result.processed).toBe(true);
    expect(result.error).toBe("boom");
  });

  // 14
  it("processAll() processes all events and returns the count", async () => {
    engine.registerWorkflow(makeWorkflow());
    engine.enqueue("git:commit", {});
    engine.enqueue("git:commit", {});
    engine.enqueue("git:commit", {});
    const count = await engine.processAll();
    expect(count).toBe(3);
    expect(engine.getQueueLength()).toBe(0);
  });

  // 15
  it("routeEvent() returns matching enabled workflows", () => {
    engine.registerWorkflow(makeWorkflow({ id: "wf-a", trigger: "git:commit" }));
    engine.registerWorkflow(makeWorkflow({ id: "wf-b", trigger: "git:push" }));
    const event = engine.createEvent("git:commit", {});
    const matches = engine.routeEvent(event);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe("wf-a");
  });

  // 16
  it("routeEvent() filters by event type", () => {
    engine.registerWorkflow(makeWorkflow({ id: "wf-1", trigger: "git:push" }));
    const event = engine.createEvent("git:commit", {});
    expect(engine.routeEvent(event)).toHaveLength(0);
  });

  // 17
  it("routeEvent() skips disabled workflows", () => {
    engine.registerWorkflow(makeWorkflow({ enabled: false }));
    const event = engine.createEvent("git:commit", {});
    expect(engine.routeEvent(event)).toHaveLength(0);
  });

  // 18
  it("getQueueLength() returns current queue size", () => {
    expect(engine.getQueueLength()).toBe(0);
    engine.enqueue("git:commit", {});
    engine.enqueue("git:push", {});
    expect(engine.getQueueLength()).toBe(2);
  });

  // 19
  it("getProcessedEvents() returns processed events", async () => {
    engine.registerWorkflow(makeWorkflow());
    engine.enqueue("git:commit", { msg: "hello" });
    await engine.processAll();
    const processed = engine.getProcessedEvents();
    expect(processed).toHaveLength(1);
    expect(processed[0]!.payload).toEqual({ msg: "hello" });
  });

  // 20
  it("clearQueue() empties the queue", () => {
    engine.enqueue("git:commit", {});
    engine.enqueue("git:push", {});
    engine.clearQueue();
    expect(engine.getQueueLength()).toBe(0);
  });

  // 21
  it("getWorkflows() returns all registered workflows", () => {
    engine.registerWorkflow(makeWorkflow({ id: "a" }));
    engine.registerWorkflow(makeWorkflow({ id: "b" }));
    expect(engine.getWorkflows()).toHaveLength(2);
  });

  // 22
  it("matchesConditions() returns true when all conditions match", () => {
    const event = engine.createEvent("git:commit", { branch: "main", env: "prod" });
    const result = engine.matchesConditions(event, [
      { field: "branch", value: "main" },
      { field: "env", value: "prod" },
    ]);
    expect(result).toBe(true);
  });

  // 23
  it("matchesConditions() returns false when any condition mismatches", () => {
    const event = engine.createEvent("git:commit", { branch: "dev" });
    const result = engine.matchesConditions(event, [{ field: "branch", value: "main" }]);
    expect(result).toBe(false);
  });

  // 24
  it("matchesConditions() returns true for empty/undefined conditions", () => {
    const event = engine.createEvent("custom", {});
    expect(engine.matchesConditions(event, undefined)).toBe(true);
    expect(engine.matchesConditions(event, [])).toBe(true);
  });

  // 25
  it("workflow with array trigger matches multiple event types", () => {
    engine.registerWorkflow(makeWorkflow({ trigger: ["git:commit", "git:push"] }));
    const commitEvent = engine.createEvent("git:commit", {});
    const pushEvent = engine.createEvent("git:push", {});
    const otherEvent = engine.createEvent("fs:change", {});

    expect(engine.routeEvent(commitEvent)).toHaveLength(1);
    expect(engine.routeEvent(pushEvent)).toHaveLength(1);
    expect(engine.routeEvent(otherEvent)).toHaveLength(0);
  });

  // 26
  it("createEvent() creates an event with a timestamp and unique ID", () => {
    const e1 = engine.createEvent("custom", {});
    const e2 = engine.createEvent("custom", {});
    expect(e1.id).not.toBe(e2.id);
    expect(Date.parse(e1.timestamp)).not.toBeNaN();
  });

  // 27
  it("multiple workflows trigger on the same event", async () => {
    const h1 = vi.fn().mockResolvedValue(undefined);
    const h2 = vi.fn().mockResolvedValue(undefined);
    engine.registerWorkflow(makeWorkflow({ id: "a", handler: h1 }));
    engine.registerWorkflow(makeWorkflow({ id: "b", handler: h2 }));
    engine.enqueue("git:commit", {});
    await engine.processNext();
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  // 28
  it("processNext() retries on transient errors up to maxAttempts", async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue(undefined);

    const eng = new EventEngine({ maxAttempts: 3 });
    eng.registerWorkflow(makeWorkflow({ handler }));
    eng.enqueue("git:commit", {});

    // First attempt — fails, re-queued
    const r1 = await eng.processNext();
    expect(r1.processed).toBe(false);
    expect(eng.getQueueLength()).toBe(1);

    // Second attempt — succeeds
    const r2 = await eng.processNext();
    expect(r2.processed).toBe(true);
    expect(eng.getQueueLength()).toBe(0);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  // 29
  it("event payload is preserved through processing", async () => {
    const captured: DanteEvent[] = [];
    engine.registerWorkflow(
      makeWorkflow({
        handler: (ev) => {
          captured.push(ev);
        },
      }),
    );
    engine.enqueue("git:commit", { branch: "feature/x", sha: "abc123" });
    await engine.processAll();
    expect(captured[0]!.payload).toEqual({ branch: "feature/x", sha: "abc123" });
  });

  // 30
  it("workflow conditions filter events so only matching ones trigger handler", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    engine.registerWorkflow(
      makeWorkflow({
        conditions: [{ field: "branch", value: "main" }],
        handler,
      }),
    );

    engine.enqueue("git:commit", { branch: "feature/y" }); // should NOT trigger
    engine.enqueue("git:commit", { branch: "main" }); // should trigger

    await engine.processAll();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].payload.branch).toBe("main");
  });
});
