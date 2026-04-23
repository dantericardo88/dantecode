// packages/core/src/__tests__/agent-message-bus.test.ts
import { describe, it, expect } from "vitest";
import { AgentMessageBus, AgentChannel, createAgentChannel, globalAgentBus } from "../agent-message-bus.js";

// ─── AgentMessageBus — basic pub/sub ─────────────────────────────────────────

describe("AgentMessageBus — subscribe and send", () => {
  it("delivers message to subscribed lane", () => {
    const bus = new AgentMessageBus();
    const received: unknown[] = [];
    bus.subscribe("tester", (msg) => {
      received.push(msg);
    });

    bus.send({ from: "coder", to: "tester", kind: "task_result", priority: "normal", payload: { result: "ok" } });
    expect(received).toHaveLength(1);
  });

  it("does not deliver message to wrong lane", () => {
    const bus = new AgentMessageBus();
    const received: unknown[] = [];
    bus.subscribe("reviewer", (msg) => {
      received.push(msg);
    });

    bus.send({ from: "coder", to: "tester", kind: "task_result", priority: "normal", payload: {} });
    expect(received).toHaveLength(0);
  });

  it("broadcast delivers to all lanes except sender", () => {
    const bus = new AgentMessageBus();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const c: unknown[] = [];
    bus.subscribe("lane_a", (msg) => {
      a.push(msg);
    });
    bus.subscribe("lane_b", (msg) => {
      b.push(msg);
    });
    bus.subscribe("lane_c", (msg) => {
      c.push(msg);
    });

    bus.broadcast("lane_a", "status_update", { progress: 0.5 });
    expect(a).toHaveLength(0);  // sender excluded
    expect(b).toHaveLength(1);
    expect(c).toHaveLength(1);
  });

  it("unsubscribe stops delivery", () => {
    const bus = new AgentMessageBus();
    const received: unknown[] = [];
    const unsub = bus.subscribe("tester", (msg) => {
      received.push(msg);
    });

    bus.send({ from: "coder", to: "tester", kind: "task_result", priority: "normal", payload: {} });
    expect(received).toHaveLength(1);

    unsub();
    bus.send({ from: "coder", to: "tester", kind: "task_result", priority: "normal", payload: {} });
    expect(received).toHaveLength(1);  // still 1 — not delivered after unsub
  });

  it("kind filter only delivers matching kind", () => {
    const bus = new AgentMessageBus();
    const handoffs: unknown[] = [];
    bus.subscribe(
      "tester",
      (msg) => {
        handoffs.push(msg);
      },
      "handoff",
    );

    bus.send({ from: "coder", to: "tester", kind: "task_result", priority: "normal", payload: {} });
    bus.send({ from: "coder", to: "tester", kind: "handoff", priority: "high", payload: { diff: "..." } });
    expect(handoffs).toHaveLength(1);
  });

  it("message has id, timestamp, hops fields", () => {
    const bus = new AgentMessageBus();
    const sent = bus.send({ from: "a", to: "b", kind: "status_update", priority: "normal", payload: {} });
    expect(sent.id).toMatch(/^msg_/);
    expect(new Date(sent.timestamp).toISOString()).toBe(sent.timestamp);
    expect(sent.hops).toBe(0);
  });

  it("does not throw when subscriber throws", () => {
    const bus = new AgentMessageBus();
    bus.subscribe("tester", () => { throw new Error("handler error"); });
    expect(() => bus.send({ from: "a", to: "tester", kind: "error", priority: "critical", payload: {} })).not.toThrow();
  });
});

// ─── AgentMessageBus — handoff and request/response ──────────────────────────

describe("AgentMessageBus — handoff and request/response", () => {
  it("handoff sets kind=handoff and priority=high", () => {
    const bus = new AgentMessageBus();
    const received: unknown[] = [];
    bus.subscribe("reviewer", (msg) => {
      received.push(msg);
    });

    const msg = bus.handoff("coder", "reviewer", { diff: "..." });
    expect(msg.kind).toBe("handoff");
    expect(msg.priority).toBe("high");
    expect(received).toHaveLength(1);
  });

  it("request returns correlation ID for response matching", () => {
    const bus = new AgentMessageBus();
    const corrId = bus.request("coder", "tester", { query: "run tests" });
    expect(typeof corrId).toBe("string");
    expect(corrId.length).toBeGreaterThan(0);
  });

  it("respond sends message with correlationId set", () => {
    const bus = new AgentMessageBus();
    const responses: unknown[] = [];
    bus.subscribe(
      "coder",
      (msg) => {
        responses.push(msg);
      },
      "response",
    );

    const corrId = bus.request("coder", "tester", { query: "status?" });
    bus.respond("tester", "coder", corrId, { status: "passing" });

    expect(responses).toHaveLength(1);
    expect((responses[0] as { correlationId: string }).correlationId).toBe(corrId);
  });
});

// ─── AgentMessageBus — history ────────────────────────────────────────────────

describe("AgentMessageBus — history", () => {
  it("records all sent messages in history", () => {
    const bus = new AgentMessageBus();
    bus.send({ from: "a", to: "b", kind: "status_update", priority: "normal", payload: {} });
    bus.send({ from: "b", to: "a", kind: "status_update", priority: "normal", payload: {} });
    expect(bus.historySize).toBe(2);
  });

  it("getHistory with lane filter returns relevant messages", () => {
    const bus = new AgentMessageBus();
    bus.send({ from: "coder", to: "tester", kind: "handoff", priority: "high", payload: {} });
    bus.send({ from: "reviewer", to: "deployer", kind: "task_result", priority: "normal", payload: {} });

    const coderHistory = bus.getHistory({ lane: "coder" });
    expect(coderHistory).toHaveLength(1);
    expect(coderHistory[0]!.from).toBe("coder");
  });

  it("getPendingHandoffs returns only handoff messages for lane", () => {
    const bus = new AgentMessageBus();
    bus.handoff("coder", "tester", { code: "..." });
    bus.send({ from: "coder", to: "tester", kind: "status_update", priority: "normal", payload: {} });

    const handoffs = bus.getPendingHandoffs("tester");
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]!.kind).toBe("handoff");
  });

  it("respects maxHistory limit", () => {
    const bus = new AgentMessageBus({ maxHistory: 3 });
    for (let i = 0; i < 5; i++) {
      bus.send({ from: "a", to: "b", kind: "status_update", priority: "normal", payload: { i } });
    }
    expect(bus.historySize).toBe(3);
  });

  it("reset clears history and subscriptions", () => {
    const bus = new AgentMessageBus();
    bus.subscribe("lane", () => {});
    bus.send({ from: "a", to: "lane", kind: "status_update", priority: "normal", payload: {} });

    bus.reset();
    expect(bus.historySize).toBe(0);
    expect(bus.subscriberCount).toBe(0);
  });
});

// ─── AgentMessageBus — formatForContext ───────────────────────────────────────

describe("AgentMessageBus — formatForContext", () => {
  it("returns empty string when no messages for lane", () => {
    const bus = new AgentMessageBus();
    expect(bus.formatForContext("idle-lane")).toBe("");
  });

  it("includes message kind and payload snippet", () => {
    const bus = new AgentMessageBus();
    bus.subscribe("reviewer", () => {});  // Make sure reviewer is reachable
    bus.handoff("coder", "reviewer", { result: "tests pass" });

    const ctx = bus.formatForContext("reviewer");
    expect(ctx).toContain("handoff");
    expect(ctx).toContain("coder");
  });
});

// ─── AgentChannel ─────────────────────────────────────────────────────────────

describe("AgentChannel", () => {
  it("can send messages via channel", () => {
    const bus = new AgentMessageBus();
    const received: unknown[] = [];
    bus.subscribe("tester", (msg) => {
      received.push(msg);
    });

    const channel = new AgentChannel(bus, "coder");
    channel.send("tester", "task_result", { output: "built" });
    expect(received).toHaveLength(1);
  });

  it("accumulates task_result messages directed at it", () => {
    const bus = new AgentMessageBus();
    const channel = new AgentChannel(bus, "orchestrator");

    bus.send({ from: "coder", to: "orchestrator", kind: "task_result", priority: "normal", payload: { step: 1 } });
    bus.send({ from: "tester", to: "orchestrator", kind: "task_result", priority: "normal", payload: { step: 2 } });

    const results = channel.getResults();
    expect(results).toHaveLength(2);
  });

  it("handoff convenience method sets kind=handoff", () => {
    const bus = new AgentMessageBus();
    const received: unknown[] = [];
    bus.subscribe("reviewer", (msg) => {
      received.push(msg);
    });

    const channel = new AgentChannel(bus, "coder");
    channel.handoff("reviewer", { diff: "added tests" });

    expect(received).toHaveLength(1);
    expect((received[0] as { kind: string }).kind).toBe("handoff");
  });

  it("clearResults empties accumulated results", () => {
    const bus = new AgentMessageBus();
    const channel = new AgentChannel(bus, "orchestrator");
    bus.send({ from: "coder", to: "orchestrator", kind: "task_result", priority: "normal", payload: {} });
    expect(channel.getResults()).toHaveLength(1);

    channel.clearResults();
    expect(channel.getResults()).toHaveLength(0);
  });
});

// ─── globalAgentBus and createAgentChannel ────────────────────────────────────

describe("globalAgentBus and createAgentChannel", () => {
  it("createAgentChannel uses the global bus", () => {
    // Reset global bus state between tests
    globalAgentBus.reset();
    const ch = createAgentChannel("test-lane");
    expect(ch).toBeInstanceOf(AgentChannel);
    expect(ch.lane).toBe("test-lane");
  });
});
