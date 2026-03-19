/**
 * unified-llm-client.test.ts
 *
 * 25 Vitest unit tests for UnifiedLLMClient.
 * All LLM I/O is intercepted via the `executorFn` injection — no real
 * network calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMCallOptions, LLMCallResult, LLMExecutorFn } from "./unified-llm-client.js";
import { UnifiedLLMClient } from "./unified-llm-client.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<LLMCallResult> = {}): LLMCallResult {
  return {
    model: "claude-sonnet-4-6",
    content: "Hello, world!",
    inputTokens: 100,
    outputTokens: 50,
    latencyMs: 300,
    provider: "anthropic",
    cached: false,
    ...overrides,
  };
}

function makeOptions(overrides: Partial<LLMCallOptions> = {}): LLMCallOptions {
  return {
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "Say hi" }],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("UnifiedLLMClient", () => {
  let mockExecutor: ReturnType<typeof vi.fn<LLMExecutorFn>>;
  let client: UnifiedLLMClient;

  beforeEach(() => {
    vi.useFakeTimers();
    mockExecutor = vi.fn<LLMExecutorFn>();
    client = new UnifiedLLMClient({ executorFn: mockExecutor, maxRetries: 2 });
  });

  // Helper: advance all timers for retry delays.
  async function runWithTimers<T>(fn: () => Promise<T>): Promise<T> {
    const promise = fn();
    await vi.runAllTimersAsync();
    return promise;
  }

  // 1. call() invokes executorFn
  it("1. call() invokes the executorFn with supplied options", async () => {
    mockExecutor.mockResolvedValueOnce(makeResult());
    const opts = makeOptions();
    await client.call(opts);
    expect(mockExecutor).toHaveBeenCalledWith(opts);
  });

  // 2. call() returns result from executor
  it("2. call() returns the result produced by executorFn", async () => {
    const expected = makeResult({ content: "specific content" });
    mockExecutor.mockResolvedValueOnce(expected);
    const result = await client.call(makeOptions());
    expect(result.content).toBe("specific content");
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  // 3. call() retries on failure
  it("3. call() retries after a transient failure", async () => {
    const ok = makeResult();
    mockExecutor
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(ok);
    const result = await runWithTimers(() => client.call(makeOptions()));
    expect(result).toEqual(ok);
    expect(mockExecutor).toHaveBeenCalledTimes(2);
  });

  // 4. call() exhausts retries, throws
  it("4. call() throws after exhausting all retries", async () => {
    mockExecutor.mockRejectedValue(new Error("always fails"));
    await expect(
      runWithTimers(() => client.call(makeOptions())),
    ).rejects.toThrow("always fails");
    // 1 initial + 2 retries = 3 total calls
    expect(mockExecutor).toHaveBeenCalledTimes(3);
  });

  // 5. call() updates telemetry on success
  it("5. call() increments totalCalls and token counts on success", async () => {
    mockExecutor.mockResolvedValueOnce(makeResult({ inputTokens: 200, outputTokens: 80 }));
    await client.call(makeOptions());
    const t = client.getTelemetry();
    expect(t.totalCalls).toBe(1);
    expect(t.totalTokensIn).toBe(200);
    expect(t.totalTokensOut).toBe(80);
  });

  // 6. call() updates telemetry on error
  it("6. call() increments errorCount when all retries fail", async () => {
    mockExecutor.mockRejectedValue(new Error("boom"));
    await expect(runWithTimers(() => client.call(makeOptions()))).rejects.toThrow();
    expect(client.getTelemetry().errorCount).toBe(1);
  });

  // 7. callWithFallback() tries first model
  it("7. callWithFallback() calls the first model in the chain", async () => {
    mockExecutor.mockResolvedValueOnce(makeResult({ model: "gpt-4o" }));
    const result = await client.callWithFallback(makeOptions(), {
      models: ["gpt-4o", "claude-haiku-4-5"],
      strategy: "first-success",
    });
    expect(mockExecutor).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o" }),
    );
    expect(result.model).toBe("gpt-4o");
  });

  // 8. callWithFallback() falls back on failure
  it("8. callWithFallback() tries next model when first fails", async () => {
    const fallbackResult = makeResult({ model: "claude-haiku-4-5" });
    mockExecutor
      .mockRejectedValueOnce(new Error("gpt-4o down"))
      .mockResolvedValueOnce(fallbackResult);
    const result = await client.callWithFallback(makeOptions(), {
      models: ["gpt-4o", "claude-haiku-4-5"],
      strategy: "first-success",
    });
    expect(result.model).toBe("claude-haiku-4-5");
  });

  // 9. callWithFallback() first-success strategy stops at first success
  it("9. first-success strategy stops after the first successful model", async () => {
    mockExecutor.mockResolvedValue(makeResult());
    await client.callWithFallback(makeOptions(), {
      models: ["gpt-4o", "claude-haiku-4-5", "gemini-1.5-pro"],
      strategy: "first-success",
    });
    // Only the first model should be called
    expect(mockExecutor).toHaveBeenCalledTimes(1);
  });

  // 10. callWithFallback() throws if all fail
  it("10. callWithFallback() throws when every candidate fails", async () => {
    mockExecutor.mockRejectedValue(new Error("all down"));
    await expect(
      client.callWithFallback(makeOptions(), {
        models: ["gpt-4o", "claude-haiku-4-5"],
        strategy: "first-success",
      }),
    ).rejects.toThrow("All fallback models failed");
  });

  // 11. callWithFallback() increments fallback count
  it("11. callWithFallback() increments fallbackCount when falling to second model", async () => {
    mockExecutor
      .mockRejectedValueOnce(new Error("first fails"))
      .mockResolvedValueOnce(makeResult());
    await client.callWithFallback(makeOptions(), {
      models: ["gpt-4o", "claude-haiku-4-5"],
      strategy: "first-success",
    });
    expect(client.getTelemetry().fallbackCount).toBe(1);
  });

  // 12. stream() calls executor with stream:true
  it("12. stream() passes stream=true to the executor", async () => {
    mockExecutor.mockResolvedValueOnce(makeResult({ content: "streamed" }));
    await client.stream(makeOptions(), () => {});
    expect(mockExecutor).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
    );
  });

  // 13. stream() invokes onChunk with content
  it("13. stream() invokes onChunk callback with the result content", async () => {
    mockExecutor.mockResolvedValueOnce(makeResult({ content: "chunk data" }));
    const chunks: string[] = [];
    await client.stream(makeOptions(), (c) => chunks.push(c));
    expect(chunks).toEqual(["chunk data"]);
  });

  // 14. stream() returns result
  it("14. stream() returns the full LLMCallResult", async () => {
    const expected = makeResult({ content: "full result" });
    mockExecutor.mockResolvedValueOnce(expected);
    const result = await client.stream(makeOptions(), () => {});
    expect(result).toEqual(expected);
  });

  // 15. getTelemetry() returns accumulated stats
  it("15. getTelemetry() reflects calls across multiple invocations", async () => {
    mockExecutor.mockResolvedValue(makeResult({ inputTokens: 10, outputTokens: 5, latencyMs: 100 }));
    await client.call(makeOptions());
    await client.call(makeOptions());
    const t = client.getTelemetry();
    expect(t.totalCalls).toBe(2);
    expect(t.totalTokensIn).toBe(20);
    expect(t.totalTokensOut).toBe(10);
  });

  // 16. resetTelemetry() resets to zero
  it("16. resetTelemetry() zeros all counters", async () => {
    mockExecutor.mockResolvedValue(makeResult());
    await client.call(makeOptions());
    client.resetTelemetry();
    const t = client.getTelemetry();
    expect(t.totalCalls).toBe(0);
    expect(t.totalTokensIn).toBe(0);
    expect(t.errorCount).toBe(0);
  });

  // 17. setFallbackChain() updates chain
  it("17. setFallbackChain() replaces the default fallback chain", async () => {
    const newChain = { models: ["gpt-4o-mini"], strategy: "first-success" as const };
    client.setFallbackChain(newChain);
    // Chain now set; if primary fails, gpt-4o-mini should be tried
    mockExecutor
      .mockRejectedValueOnce(new Error("primary fails"))
      .mockRejectedValueOnce(new Error("primary retry 1"))
      .mockRejectedValueOnce(new Error("primary retry 2"))
      .mockResolvedValueOnce(makeResult({ model: "gpt-4o-mini" }));
    const result = await runWithTimers(() => client.call(makeOptions()));
    expect(result.model).toBe("gpt-4o-mini");
  });

  // 18. Telemetry tracks latency
  it("18. telemetry accumulates latencyMs across successful calls", async () => {
    mockExecutor
      .mockResolvedValueOnce(makeResult({ latencyMs: 200 }))
      .mockResolvedValueOnce(makeResult({ latencyMs: 400 }));
    await client.call(makeOptions());
    await client.call(makeOptions());
    expect(client.getTelemetry().totalLatencyMs).toBe(600);
  });

  // 19. Telemetry tracks token counts
  it("19. telemetry correctly sums inputTokens and outputTokens", async () => {
    mockExecutor
      .mockResolvedValueOnce(makeResult({ inputTokens: 300, outputTokens: 150 }))
      .mockResolvedValueOnce(makeResult({ inputTokens: 700, outputTokens: 350 }));
    await client.call(makeOptions());
    await client.call(makeOptions());
    const t = client.getTelemetry();
    expect(t.totalTokensIn).toBe(1000);
    expect(t.totalTokensOut).toBe(500);
  });

  // 20. Multiple calls accumulate telemetry
  it("20. three sequential calls each add to the running totals", async () => {
    mockExecutor.mockResolvedValue(makeResult({ inputTokens: 50, outputTokens: 25 }));
    await client.call(makeOptions());
    await client.call(makeOptions());
    await client.call(makeOptions());
    expect(client.getTelemetry().totalCalls).toBe(3);
    expect(client.getTelemetry().totalTokensIn).toBe(150);
  });

  // 21. callWithFallback() lowest-cost strategy picks cheapest
  it("21. lowest-cost strategy reorders models by cost and calls cheapest first", async () => {
    // gpt-4o-mini is cheaper than claude-opus-4-6
    mockExecutor.mockResolvedValue(makeResult({ model: "called" }));
    await client.callWithFallback(makeOptions(), {
      models: ["claude-opus-4-6", "gpt-4o-mini"],
      strategy: "lowest-cost",
    });
    // gpt-4o-mini has lower known cost → should be first
    const firstCall = mockExecutor.mock.calls[0]![0] as LLMCallOptions;
    expect(firstCall.model).toBe("gpt-4o-mini");
  });

  // 22. callWithFallback() fastest strategy picks fastest
  it("22. fastest strategy reorders models by latency and calls fastest first", async () => {
    // claude-haiku-4-5 (700ms) < gpt-4o (2500ms)
    mockExecutor.mockResolvedValue(makeResult({ model: "called" }));
    await client.callWithFallback(makeOptions(), {
      models: ["gpt-4o", "claude-haiku-4-5"],
      strategy: "fastest",
    });
    const firstCall = mockExecutor.mock.calls[0]![0] as LLMCallOptions;
    expect(firstCall.model).toBe("claude-haiku-4-5");
  });

  // 23. Default fallback chain used when configured
  it("23. default fallback chain is used automatically when primary retries exhaust", async () => {
    const fallbackResult = makeResult({ model: "claude-haiku-4-5" });
    const clientWithDefault = new UnifiedLLMClient({
      executorFn: mockExecutor,
      maxRetries: 0,
      defaultFallbackChain: {
        models: ["claude-haiku-4-5"],
        strategy: "first-success",
      },
    });
    mockExecutor
      .mockRejectedValueOnce(new Error("primary fails"))
      .mockResolvedValueOnce(fallbackResult);
    const result = await clientWithDefault.call(makeOptions());
    expect(result.model).toBe("claude-haiku-4-5");
  });

  // 24. call() with no executor throws
  it("24. client without executorFn throws a descriptive error on call()", async () => {
    // maxRetries:0 prevents retry loop delays
    const bare = new UnifiedLLMClient({ maxRetries: 0 });
    await expect(bare.call(makeOptions())).rejects.toThrow("no executorFn provided");
  });

  // 25. Retry delay between attempts
  it("25. retries are delayed with exponential back-off", async () => {
    const delays: number[] = [];

    mockExecutor
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce(makeResult());

    // Spy on setTimeout to capture delay values without blocking
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: (...args: unknown[]) => unknown, ms?: number) => {
      delays.push(ms ?? 0);
      // Execute immediately so we don't block
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    await client.call(makeOptions());

    // Expect two delays: 50ms (attempt 1) and 100ms (attempt 2)
    expect(delays.length).toBeGreaterThanOrEqual(2);
    expect(delays[0]).toBe(50);
    expect(delays[1]).toBe(100);

    vi.restoreAllMocks();
  });
});
