// ============================================================================
// @dantecode/cli — Serve: SessionEventEmitter Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { SessionEventEmitter } from "./session-emitter.js";
import type { SSEEvent } from "./session-emitter.js";

describe("SessionEventEmitter", () => {
  it("subscriber receives emitted event", () => {
    const emitter = new SessionEventEmitter();
    const received: SSEEvent[] = [];
    emitter.subscribe("sess1", (e) => received.push(e));
    emitter.emitEvent("sess1", {
      type: "token",
      data: { content: "hello" },
      timestamp: new Date().toISOString(),
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe("token");
    expect(received[0]!.data["content"]).toBe("hello");
  });

  it("multiple subscribers all receive the event", () => {
    const emitter = new SessionEventEmitter();
    const a: SSEEvent[] = [];
    const b: SSEEvent[] = [];
    emitter.subscribe("sess1", (e) => a.push(e));
    emitter.subscribe("sess1", (e) => b.push(e));
    emitter.emitToken("sess1", "world");
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("unsubscribe stops receiving events", () => {
    const emitter = new SessionEventEmitter();
    const received: SSEEvent[] = [];
    const unsub = emitter.subscribe("sess1", (e) => received.push(e));
    emitter.emitToken("sess1", "before");
    unsub();
    emitter.emitToken("sess1", "after");
    expect(received).toHaveLength(1);
    expect(received[0]!.data["content"]).toBe("before");
  });

  it("emitToken sends a token event with correct content", () => {
    const emitter = new SessionEventEmitter();
    const received: SSEEvent[] = [];
    emitter.subscribe("sess1", (e) => received.push(e));
    emitter.emitToken("sess1", "stream-chunk");
    expect(received[0]!.type).toBe("token");
    expect(received[0]!.data["content"]).toBe("stream-chunk");
  });

  it("subscriberCount returns the correct number of active subscribers", () => {
    const emitter = new SessionEventEmitter();
    expect(emitter.subscriberCount("sess1")).toBe(0);
    const unsub1 = emitter.subscribe("sess1", () => {});
    expect(emitter.subscriberCount("sess1")).toBe(1);
    const unsub2 = emitter.subscribe("sess1", () => {});
    expect(emitter.subscriberCount("sess1")).toBe(2);
    unsub1();
    expect(emitter.subscriberCount("sess1")).toBe(1);
    unsub2();
    expect(emitter.subscriberCount("sess1")).toBe(0);
  });

  it("events for different sessions are isolated", () => {
    const emitter = new SessionEventEmitter();
    const s1Events: SSEEvent[] = [];
    const s2Events: SSEEvent[] = [];
    emitter.subscribe("sess1", (e) => s1Events.push(e));
    emitter.subscribe("sess2", (e) => s2Events.push(e));
    emitter.emitToken("sess1", "for-s1");
    emitter.emitToken("sess2", "for-s2");
    expect(s1Events).toHaveLength(1);
    expect(s1Events[0]!.data["content"]).toBe("for-s1");
    expect(s2Events).toHaveLength(1);
    expect(s2Events[0]!.data["content"]).toBe("for-s2");
  });

  it("emitToolStart sends tool_start event", () => {
    const emitter = new SessionEventEmitter();
    const received: SSEEvent[] = [];
    emitter.subscribe("sess1", (e) => received.push(e));
    emitter.emitToolStart("sess1", "Bash", { command: "ls" });
    expect(received[0]!.type).toBe("tool_start");
    expect(received[0]!.data["toolName"]).toBe("Bash");
  });

  it("emitDone sends done event with tokensUsed and durationMs", () => {
    const emitter = new SessionEventEmitter();
    const received: SSEEvent[] = [];
    emitter.subscribe("sess1", (e) => received.push(e));
    emitter.emitDone("sess1", 1234, 5678);
    expect(received[0]!.type).toBe("done");
    expect(received[0]!.data["tokensUsed"]).toBe(1234);
    expect(received[0]!.data["durationMs"]).toBe(5678);
  });

  it("emitting to session with no subscribers is a no-op", () => {
    const emitter = new SessionEventEmitter();
    expect(() => emitter.emitToken("nonexistent", "hi")).not.toThrow();
  });
});
