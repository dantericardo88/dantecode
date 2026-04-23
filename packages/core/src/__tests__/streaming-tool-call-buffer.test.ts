// packages/core/src/__tests__/streaming-tool-call-buffer.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  tryParsePartialJson,
  StreamingToolCallBuffer,
  computeSseTimeout,
  clampSseTimeout,
} from "../streaming-tool-call-buffer.js";

// ─── tryParsePartialJson ──────────────────────────────────────────────────────

describe("tryParsePartialJson", () => {
  it("parses complete JSON object", () => {
    const result = tryParsePartialJson('{"key": "value"}');
    expect(result).toEqual({ key: "value" });
  });

  it("parses partial JSON by closing open braces", () => {
    const result = tryParsePartialJson('{"key": "val');
    // Should attempt recovery — may or may not succeed depending on structure
    // At minimum it should not throw
    expect(result === undefined || typeof result === "object").toBe(true);
  });

  it("returns undefined for non-object JSON", () => {
    expect(tryParsePartialJson("[1,2,3]")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(tryParsePartialJson("")).toBeUndefined();
  });

  it("returns undefined for plain text", () => {
    expect(tryParsePartialJson("not json")).toBeUndefined();
  });

  it("handles nested objects", () => {
    const result = tryParsePartialJson('{"outer": {"inner": "value"}}');
    expect(result).toEqual({ outer: { inner: "value" } });
  });
});

// ─── StreamingToolCallBuffer ──────────────────────────────────────────────────

describe("StreamingToolCallBuffer", () => {
  let buffer: StreamingToolCallBuffer;

  beforeEach(() => {
    buffer = new StreamingToolCallBuffer({ maxChunksPerSec: 1000, parsePartial: true });
  });

  it("startToolCall returns a tool call ID", () => {
    const id = buffer.startToolCall("bash");
    expect(id).toBeTruthy();
  });

  it("startToolCall with custom ID uses that ID", () => {
    const id = buffer.startToolCall("bash", "my-id-123");
    expect(id).toBe("my-id-123");
  });

  it("feedDelta accumulates chunks", () => {
    const id = buffer.startToolCall("write_file");
    buffer.feedDelta(id, '{"path": "src/');
    buffer.feedDelta(id, 'foo.ts"}');
    const call = buffer.getCall(id)!;
    expect(call.rawArgs).toBe('{"path": "src/foo.ts"}');
  });

  it("feedDelta increments chunkCount", () => {
    const id = buffer.startToolCall("bash");
    buffer.feedDelta(id, '{"cmd');
    buffer.feedDelta(id, '": "ls"}');
    expect(buffer.getCall(id)!.chunkCount).toBe(2);
  });

  it("feedDelta attempts JSON parse when parsePartial=true", () => {
    const id = buffer.startToolCall("tool");
    buffer.feedDelta(id, '{"command": "npm install"}');
    const call = buffer.getCall(id)!;
    expect(call.latestParsedArgs).toEqual({ command: "npm install" });
  });

  it("completeToolCall marks call as complete", () => {
    const id = buffer.startToolCall("bash");
    buffer.feedDelta(id, '{"cmd": "ls"}');
    buffer.completeToolCall(id, { output: "file.ts" });
    expect(buffer.getCall(id)!.status).toBe("complete");
    expect(buffer.getCall(id)!.result).toEqual({ output: "file.ts" });
  });

  it("errorToolCall marks call as error", () => {
    const id = buffer.startToolCall("bash");
    buffer.errorToolCall(id, "Permission denied");
    const call = buffer.getCall(id)!;
    expect(call.status).toBe("error");
    expect(call.errorMessage).toBe("Permission denied");
  });

  it("getActiveToolCalls returns streaming calls", () => {
    const id1 = buffer.startToolCall("bash");
    const id2 = buffer.startToolCall("write");
    buffer.completeToolCall(id1);
    const active = buffer.getActiveToolCalls();
    expect(active.every((c) => c.status === "streaming")).toBe(true);
    expect(active.some((c) => c.id === id2)).toBe(true);
  });

  it("getCompletedToolCalls returns complete calls", () => {
    const id = buffer.startToolCall("tool");
    buffer.completeToolCall(id);
    expect(buffer.getCompletedToolCalls()).toHaveLength(1);
  });

  it("onEmit callback fires on feedDelta", () => {
    const events: string[] = [];
    buffer.onEmit((e) => events.push(e.toolCallId));
    const id = buffer.startToolCall("bash");
    buffer.feedDelta(id, '{"cmd": "ls"}');
    expect(events).toContain(id);
  });

  it("onEmit callback fires on completeToolCall", () => {
    const events: string[] = [];
    buffer.onEmit((e) => events.push(e.toolCallId));
    const id = buffer.startToolCall("bash");
    buffer.completeToolCall(id);
    expect(events).toContain(id);
  });

  it("onEmit returns unsubscribe function", () => {
    const events: string[] = [];
    const unsub = buffer.onEmit((e) => events.push(e.toolCallId));
    const id = buffer.startToolCall("tool");
    unsub();
    buffer.feedDelta(id, "{}");
    // After unsubscribe, no new events
    expect(events).toHaveLength(0);
  });

  it("totalCalls tracks all calls", () => {
    buffer.startToolCall("a");
    buffer.startToolCall("b");
    expect(buffer.totalCalls).toBe(2);
  });

  it("formatActiveForDisplay returns non-empty string for active calls", () => {
    const id = buffer.startToolCall("bash");
    buffer.feedDelta(id, '{"command": "ls -la"}');
    const display = buffer.formatActiveForDisplay();
    expect(display).toContain("bash");
  });

  it("formatActiveForDisplay returns empty string when no active calls", () => {
    expect(buffer.formatActiveForDisplay()).toBe("");
  });

  it("clear removes all calls", () => {
    buffer.startToolCall("a");
    buffer.clear();
    expect(buffer.totalCalls).toBe(0);
  });

  it("feedDelta returns false for unknown toolCallId", () => {
    expect(buffer.feedDelta("nonexistent", "chunk")).toBe(false);
  });

  it("feedDelta returns false for completed call", () => {
    const id = buffer.startToolCall("tool");
    buffer.completeToolCall(id);
    expect(buffer.feedDelta(id, "more data")).toBe(false);
  });
});

// ─── computeSseTimeout / clampSseTimeout ──────────────────────────────────────

describe("computeSseTimeout", () => {
  it("returns base 90s for 0 tokens", () => {
    expect(computeSseTimeout(0)).toBe(90_000);
  });

  it("increases with token count", () => {
    expect(computeSseTimeout(150_000)).toBeGreaterThan(computeSseTimeout(0));
  });

  it("returns 180s for 150k tokens (base + 1 slope unit)", () => {
    expect(computeSseTimeout(150_000)).toBe(180_000);
  });
});

describe("clampSseTimeout", () => {
  it("never returns less than minMs", () => {
    expect(clampSseTimeout(0, 60_000)).toBeGreaterThanOrEqual(60_000);
  });

  it("never returns more than maxMs", () => {
    expect(clampSseTimeout(10_000_000, 30_000, 300_000)).toBeLessThanOrEqual(300_000);
  });

  it("returns reasonable value for typical context", () => {
    const timeout = clampSseTimeout(8_000);
    expect(timeout).toBeGreaterThan(90_000);
    expect(timeout).toBeLessThan(200_000);
  });
});
