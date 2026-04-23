// ============================================================================
// packages/vscode/src/__tests__/completion-streaming-emitter.test.ts
// 10 tests for CompletionStreamingEmitter and EmitterRegistry.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CompletionStreamingEmitter,
  EmitterRegistry,
  globalEmitterRegistry,
} from "../completion-streaming-emitter.js";

/** Helper: create an AsyncIterable from an array of string chunks */
function makeStream(chunks: string[]): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < chunks.length) return { value: chunks[i++]!, done: false };
          return { value: "", done: true };
        },
      };
    },
  };
}

describe("CompletionStreamingEmitter", () => {
  it("calls onPartial with done:true when stream completes", async () => {
    const emitter = new CompletionStreamingEmitter();
    const events: boolean[] = [];
    await emitter.emit(makeStream(["hello"]), (e) => { events.push(e.done); });
    expect(events[events.length - 1]).toBe(true);
  });

  it("emits done:false partial when first \\n arrives before stream ends", async () => {
    const emitter = new CompletionStreamingEmitter();
    const events: Array<{ text: string; done: boolean }> = [];
    await emitter.emit(
      makeStream(["const x = 1\n", " const y = 2"]),
      (e) => events.push({ text: e.text, done: e.done }),
      { emitOnFirstLine: true },
    );
    // Should have at least one partial (done: false) then final (done: true)
    expect(events.some((e) => !e.done)).toBe(true);
    expect(events[events.length - 1]!.done).toBe(true);
  });

  it("abort() stops streaming — final done event still fires with accumulated text", async () => {
    const emitter = new CompletionStreamingEmitter();
    let streamCount = 0;
    const slowStream: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            streamCount++;
            if (streamCount === 2) emitter.abort();
            if (streamCount <= 5) return { value: `chunk${streamCount}`, done: false };
            return { value: "", done: true };
          },
        };
      },
    };
    const events: Array<{ done: boolean }> = [];
    await emitter.emit(slowStream, (e) => events.push({ done: e.done }));
    // Must have fired done: true
    expect(events[events.length - 1]!.done).toBe(true);
    // Must have stopped before processing all 5 chunks
    expect(streamCount).toBeLessThan(5);
  });

  it("firstLineTimeoutMs triggers partial even without \\n", async () => {
    vi.useFakeTimers();
    const emitter = new CompletionStreamingEmitter();
    const events: Array<{ done: boolean; text: string }> = [];
    // Stream with no newlines and won't complete within test
    let resolveStream!: () => void;
    const slowStream: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        let sent = false;
        return {
          async next() {
            if (!sent) { sent = true; return { value: "some code", done: false }; }
            // Wait indefinitely
            await new Promise<void>((r) => { resolveStream = r; });
            return { value: "", done: true };
          },
        };
      },
    };
    const emitPromise = emitter.emit(slowStream, (e) => events.push(e), {
      emitOnFirstLine: true,
      firstLineTimeoutMs: 300,
    });
    await vi.advanceTimersByTimeAsync(350);
    // Timeout should have fired a partial event
    expect(events.some((e) => !e.done)).toBe(true);
    resolveStream();
    await emitPromise;
    vi.useRealTimers();
  });

  it("stop sequence causes early termination and truncates text", async () => {
    const emitter = new CompletionStreamingEmitter();
    const finalText = await emitter.emit(
      makeStream(["const x", " = 1\n\n", "const y = 2"]),
      () => {},
      { stopSequences: ["\n\n"] },
    );
    expect(finalText).toBe("const x = 1");
  });

  it("firstChunkMs is populated in first onPartial call", async () => {
    const emitter = new CompletionStreamingEmitter();
    let firstMs: number | undefined;
    await emitter.emit(makeStream(["hello\n", " world"]), (e) => {
      if (firstMs === undefined && e.firstChunkMs !== undefined) {
        firstMs = e.firstChunkMs;
      }
    });
    expect(typeof firstMs).toBe("number");
    expect(firstMs).toBeGreaterThanOrEqual(0);
  });

  it("EmitterRegistry.startFor cancels existing emitter for same docUri", async () => {
    const registry = new EmitterRegistry();
    const first = registry.startFor("file:///test.ts");
    const abortSpy = vi.spyOn(first, "abort");
    registry.startFor("file:///test.ts"); // should cancel first
    expect(abortSpy).toHaveBeenCalledOnce();
  });

  it("EmitterRegistry.cancelAll aborts all active emitters", async () => {
    const registry = new EmitterRegistry();
    const a = registry.startFor("file:///a.ts");
    const b = registry.startFor("file:///b.ts");
    const spyA = vi.spyOn(a, "abort");
    const spyB = vi.spyOn(b, "abort");
    registry.cancelAll();
    expect(spyA).toHaveBeenCalledOnce();
    expect(spyB).toHaveBeenCalledOnce();
  });

  it("empty stream resolves with empty string via done:true", async () => {
    const emitter = new CompletionStreamingEmitter();
    const result = await emitter.emit(makeStream([]), () => {});
    expect(result).toBe("");
  });

  it("emitOnFirstLine:false suppresses partial events — only done fires", async () => {
    const emitter = new CompletionStreamingEmitter();
    const events: Array<{ done: boolean }> = [];
    await emitter.emit(
      makeStream(["hello\n", " world"]),
      (e) => events.push({ done: e.done }),
      { emitOnFirstLine: false },
    );
    // All events should be done:true (no partials)
    expect(events.every((e) => e.done)).toBe(true);
  });
});
