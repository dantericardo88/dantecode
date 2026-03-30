/**
 * retry-with-backoff.test.ts
 *
 * Tests for retry with exponential backoff
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retryWithBackoff, RetryableErrors } from "./retry-with-backoff.js";

describe("retryWithBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const promise = retryWithBackoff(fn);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue(42);

    const promise = retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 100 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws last error after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent failure"));

    const promise = retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 100 });
    const expectPromise = expect(promise).rejects.toThrow("persistent failure");
    await vi.runAllTimersAsync();

    await expectPromise;
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it("uses exponential backoff delays", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const delays: number[] = [];

    const onRetry = vi.fn((attempt: number, error: unknown, delayMs: number) => {
      delays.push(delayMs);
    });

    const promise = retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 100000,
      onRetry,
    });

    const expectPromise = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await expectPromise;

    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(delays.length).toBe(3);

    // Delays should grow exponentially: ~1000, ~2000, ~4000 (plus jitter)
    expect(delays[0]!).toBeGreaterThanOrEqual(1000);
    expect(delays[0]!).toBeLessThan(2000); // base * 2^0 + jitter

    expect(delays[1]!).toBeGreaterThanOrEqual(2000);
    expect(delays[1]!).toBeLessThan(3000); // base * 2^1 + jitter

    expect(delays[2]!).toBeGreaterThanOrEqual(4000);
    expect(delays[2]!).toBeLessThan(5000); // base * 2^2 + jitter
  });

  it("respects max delay cap", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const delays: number[] = [];

    const promise = retryWithBackoff(fn, {
      maxRetries: 5,
      baseDelayMs: 1000,
      maxDelayMs: 3000, // Cap at 3 seconds
      onRetry: (_attempt, _error, delayMs) => delays.push(delayMs),
    });

    const expectPromise = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await expectPromise;

    // All delays should be capped at maxDelayMs
    delays.forEach((delay) => {
      expect(delay).toBeLessThanOrEqual(3000);
    });
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("auth failed"));
    const retryableErrors = vi.fn().mockReturnValue(false);

    const promise = retryWithBackoff(fn, {
      maxRetries: 3,
      retryableErrors,
    });

    const timerPromise = vi.runAllTimersAsync();
    const resultPromise = expect(promise).rejects.toThrow("auth failed");

    await timerPromise;
    await resultPromise;

    expect(fn).toHaveBeenCalledTimes(1); // No retries
    expect(retryableErrors).toHaveBeenCalledTimes(1);
  });

  it("only retries retryable errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("auth error"));

    const retryableErrors = (error: unknown) => {
      return (error as Error).message.includes("network");
    };

    const promise = retryWithBackoff(fn, {
      maxRetries: 3,
      retryableErrors,
    });

    // Run timers and catch the rejection in the same async context
    const timerPromise = vi.runAllTimersAsync();
    const resultPromise = expect(promise).rejects.toThrow("auth error");

    await timerPromise;
    await resultPromise;

    expect(fn).toHaveBeenCalledTimes(2); // Initial + 1 retry, then non-retryable
  });

  it("invokes onRetry callback with correct arguments", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue(42);

    const onRetry = vi.fn();

    const promise = retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 1000,
      onRetry,
    });

    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(
      1,
      1, // attempt
      expect.objectContaining({ message: "fail 1" }),
      expect.any(Number), // delay
    );
    expect(onRetry).toHaveBeenNthCalledWith(
      2,
      2,
      expect.objectContaining({ message: "fail 2" }),
      expect.any(Number),
    );
  });

  it("respects retry-after-ms header", async () => {
    const errorWithHeader = Object.assign(new Error("rate limit"), {
      retryAfterMs: 5000,
    });

    const fn = vi.fn().mockRejectedValueOnce(errorWithHeader).mockResolvedValue(42);

    const delays: number[] = [];
    const promise = retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 1000,
      onRetry: (_attempt, _error, delayMs) => delays.push(delayMs),
    });

    await vi.runAllTimersAsync();
    await promise;

    expect(delays[0]).toBe(5000); // Should use retry-after header
  });

  it("respects retry-after header in error.headers", async () => {
    const errorWithHeader = Object.assign(new Error("rate limit"), {
      headers: { "retry-after": "10" }, // 10 seconds
    });

    const fn = vi.fn().mockRejectedValueOnce(errorWithHeader).mockResolvedValue(42);

    const delays: number[] = [];
    const promise = retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 1000,
      onRetry: (_attempt, _error, delayMs) => delays.push(delayMs),
    });

    await vi.runAllTimersAsync();
    await promise;

    expect(delays[0]).toBe(10000); // Should convert seconds to ms
  });
});

describe("RetryableErrors", () => {
  describe("networkOnly", () => {
    it("returns true for network errors", () => {
      expect(RetryableErrors.networkOnly({ code: "ECONNRESET" })).toBe(true);
      expect(RetryableErrors.networkOnly({ code: "ETIMEDOUT" })).toBe(true);
      expect(RetryableErrors.networkOnly({ code: "ECONNREFUSED" })).toBe(true);
      expect(
        RetryableErrors.networkOnly({ message: "fetch failed: network error" }),
      ).toBe(true);
    });

    it("returns false for non-network errors", () => {
      expect(RetryableErrors.networkOnly(new Error("auth failed"))).toBe(false);
      expect(RetryableErrors.networkOnly({ status: 500 })).toBe(false);
    });
  });

  describe("serverErrors", () => {
    it("returns true for 5xx errors", () => {
      expect(RetryableErrors.serverErrors({ status: 500 })).toBe(true);
      expect(RetryableErrors.serverErrors({ statusCode: 503 })).toBe(true);
    });

    it("returns true for network errors", () => {
      expect(RetryableErrors.serverErrors({ code: "ECONNRESET" })).toBe(true);
    });

    it("returns false for 4xx errors", () => {
      expect(RetryableErrors.serverErrors({ status: 400 })).toBe(false);
      expect(RetryableErrors.serverErrors({ status: 404 })).toBe(false);
    });
  });

  describe("rateLimitOnly", () => {
    it("returns true for 429 errors", () => {
      expect(RetryableErrors.rateLimitOnly({ status: 429 })).toBe(true);
      expect(RetryableErrors.rateLimitOnly({ statusCode: 429 })).toBe(true);
    });

    it("returns false for other errors", () => {
      expect(RetryableErrors.rateLimitOnly({ status: 500 })).toBe(false);
      expect(RetryableErrors.rateLimitOnly({ code: "ETIMEDOUT" })).toBe(false);
    });
  });

  describe("serverAndRateLimit", () => {
    it("returns true for 429 and 5xx errors", () => {
      expect(RetryableErrors.serverAndRateLimit({ status: 429 })).toBe(true);
      expect(RetryableErrors.serverAndRateLimit({ status: 500 })).toBe(true);
      expect(RetryableErrors.serverAndRateLimit({ statusCode: 503 })).toBe(true);
    });

    it("returns false for 4xx errors (except 429)", () => {
      expect(RetryableErrors.serverAndRateLimit({ status: 400 })).toBe(false);
      expect(RetryableErrors.serverAndRateLimit({ status: 404 })).toBe(false);
    });
  });
});
