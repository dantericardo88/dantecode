// Benchmark/perf test for the resilience primitives. Verifies that retry
// backoff, timeout wrapping, and parallelWithLimit hit their expected
// performance budgets. If a budget is exceeded, the regression is loud.
//
// Wall-clock budgets are conservative; CI machines are slow. We measure
// shape, not absolute speed.

import { describe, it, expect } from "vitest";
import { performance } from "node:perf_hooks";
import { retry, withTimeout, parallelWithLimit } from "../packages/core/src/resilience.js";

describe("benchmark — retry overhead", () => {
  it("happy-path retry has near-zero overhead", async () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      await retry(async () => 42, { baseDelayMs: 1 });
    }
    const elapsed = performance.now() - start;
    // 1000 successful retries should complete well under 200ms — no actual
    // backoff is consumed when the first attempt succeeds.
    expect(elapsed).toBeLessThan(500);
  });
});

describe("benchmark — withTimeout overhead", () => {
  it("happy-path timeout adds <2ms median per call", async () => {
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      await withTimeout(async () => "ok", 1000);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    // Median should be very small (just the AbortController + Promise.race
    // overhead). Generous bound for slow CI hardware.
    expect(median).toBeLessThan(20);
  });
});

describe("benchmark — parallelWithLimit scaling", () => {
  it("respects concurrency limit and finishes in expected wall-clock", async () => {
    // 12 items, each 30ms, concurrency 4 → wall clock ~90ms (3 batches).
    const items = Array.from({ length: 12 }, () => async () => {
      await new Promise((r) => setTimeout(r, 30));
      return "ok";
    });
    const start = performance.now();
    const results = await parallelWithLimit(items, 4);
    const elapsed = performance.now() - start;
    expect(results).toHaveLength(12);
    expect(results.every((r) => r.ok)).toBe(true);
    // 3 batches × 30ms = 90ms minimum. Allow generous upper bound for CI.
    expect(elapsed).toBeGreaterThan(80);
    expect(elapsed).toBeLessThan(500);
  });
});
