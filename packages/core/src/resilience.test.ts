// Tests for resilience primitives. Verifies retry-with-backoff, timeout
// wrapping, abort-respect on DanteCodeError.recovery="abort", parallel-with-
// limit ordering and error capture, and isRetryable predicate.

import { describe, it, expect, vi } from "vitest";
import { retry, withTimeout, retryWithTimeout, isRetryable, parallelWithLimit } from "./resilience.js";
import { DanteCodeError, ProviderRateLimitError, ProtectedFileWriteError, TimeoutError } from "./errors.js";

describe("retry", () => {
  it("returns the result on first success", async () => {
    const op = vi.fn().mockResolvedValue("ok");
    const result = await retry(op);
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxAttempts on failure", async () => {
    let attempt = 0;
    const op = vi.fn(async () => {
      attempt++;
      if (attempt < 3) throw new Error("transient");
      return "ok";
    });
    const result = await retry(op, { maxAttempts: 3, baseDelayMs: 1, jitterRatio: 0 });
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("throws the last error when all attempts fail", async () => {
    const op = vi.fn().mockRejectedValue(new Error("permanent"));
    await expect(retry(op, { maxAttempts: 2, baseDelayMs: 1 })).rejects.toThrow("permanent");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("fails fast on DanteCodeError with recovery=\"abort\"", async () => {
    const op = vi.fn().mockRejectedValue(new ProtectedFileWriteError("src/protected.ts"));
    await expect(retry(op, { maxAttempts: 5, baseDelayMs: 1 })).rejects.toThrow(/Self-modification blocked/);
    expect(op).toHaveBeenCalledTimes(1); // never retries
  });

  it("retries on retry-marked errors", async () => {
    let attempt = 0;
    const op = vi.fn(async () => {
      attempt++;
      if (attempt < 2) throw new ProviderRateLimitError("anthropic", 100);
      return "ok";
    });
    const result = await retry(op, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("calls onRetry callback before each retry", async () => {
    const onRetry = vi.fn();
    let attempt = 0;
    const op = async () => {
      attempt++;
      if (attempt < 2) throw new Error("retry me");
      return "ok";
    };
    await retry(op, { maxAttempts: 3, baseDelayMs: 1, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[1]).toBe(1); // attempt number
  });
});

describe("withTimeout", () => {
  it("returns the result if operation completes in time", async () => {
    const result = await withTimeout(async () => "ok", 100, "test-op");
    expect(result).toBe("ok");
  });

  it("throws TimeoutError when operation exceeds timeout", async () => {
    const slow = (signal: AbortSignal) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve("late"), 200);
        signal.addEventListener("abort", () => clearTimeout(timer));
      });
    await expect(withTimeout(slow, 50, "slow-op")).rejects.toBeInstanceOf(TimeoutError);
  });

  it("aborts the operation's signal when timing out", async () => {
    let aborted = false;
    const op = (signal: AbortSignal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
        setTimeout(() => reject(new Error("never")), 1000);
      });
    await expect(withTimeout(op, 30, "abort-op")).rejects.toBeDefined();
    expect(aborted).toBe(true);
  });

  it("clears the timeout on success (no leaked timer)", async () => {
    // Just verifying no unhandled promise rejection or hang.
    for (let i = 0; i < 5; i++) {
      await withTimeout(async () => i, 1000);
    }
    expect(true).toBe(true);
  });
});

describe("retryWithTimeout", () => {
  it("wraps each retry attempt with the full timeout", async () => {
    let attempt = 0;
    const op = (signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        attempt++;
        if (attempt < 2) {
          // First attempt times out
          setTimeout(() => resolve("late"), 100);
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        } else {
          resolve("ok");
        }
      });
    const result = await retryWithTimeout(op, 30, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(attempt).toBe(2);
  });
});

describe("isRetryable", () => {
  it("returns true for retry-marked DanteCodeErrors", () => {
    expect(isRetryable(new ProviderRateLimitError("anthropic"))).toBe(true);
  });

  it("returns false for abort-marked DanteCodeErrors", () => {
    expect(isRetryable(new ProtectedFileWriteError("x.ts"))).toBe(false);
  });

  it("returns true for plain Error instances", () => {
    expect(isRetryable(new Error("plain"))).toBe(true);
  });

  it("returns false for non-error values", () => {
    expect(isRetryable("string")).toBe(false);
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });

  it("returns true for model-correction recovery hint", () => {
    expect(isRetryable(new DanteCodeError("PARSE_FAILED", "x", { recovery: "model-correction" }))).toBe(true);
  });
});

describe("parallelWithLimit", () => {
  it("runs all items respecting the concurrency limit", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const items = Array.from({ length: 10 }, (_, i) => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return i;
    });
    const results = await parallelWithLimit(items, 3);
    expect(results).toHaveLength(10);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
    for (let i = 0; i < 10; i++) {
      const r = results[i]!;
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(i);
    }
  });

  it("captures errors per-item without aborting the whole batch", async () => {
    const items = [
      async () => "a",
      async () => { throw new Error("b failed"); },
      async () => "c",
    ];
    const results = await parallelWithLimit(items, 2);
    expect(results[0]).toEqual({ ok: true, value: "a" });
    expect(results[1]?.ok).toBe(false);
    if (results[1] && !results[1].ok) {
      expect((results[1].error as Error).message).toBe("b failed");
    }
    expect(results[2]).toEqual({ ok: true, value: "c" });
  });

  it("validates concurrency >= 1", async () => {
    await expect(parallelWithLimit([], 0)).rejects.toThrow(/concurrency/);
  });

  it("handles concurrency larger than items list", async () => {
    const items = [async () => "x", async () => "y"];
    const results = await parallelWithLimit(items, 100);
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual(["x", "y"]);
  });
});
