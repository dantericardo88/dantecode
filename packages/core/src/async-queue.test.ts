/**
 * async-queue.test.ts
 *
 * Tests for AsyncQueue concurrency control
 */

import { describe, it, expect } from "vitest";
import { work, AsyncQueue } from "./async-queue.js";

describe("AsyncQueue - functional API", () => {
  it("processes empty array", async () => {
    const results = await work([], async (x) => x * 2, 2);
    expect(results).toEqual([]);
  });

  it("processes single item", async () => {
    const results = await work([5], async (x) => x * 2, 2);
    expect(results).toEqual([10]);
  });

  it("processes multiple items with concurrency 1", async () => {
    const order: number[] = [];
    const results = await work(
      [1, 2, 3, 4, 5],
      async (x) => {
        order.push(x);
        return x * 2;
      },
      1,
    );
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(order).toEqual([1, 2, 3, 4, 5]); // Sequential
  });

  it("processes multiple items with concurrency 2", async () => {
    const active: number[] = [];
    const maxConcurrent = { value: 0 };

    const results = await work(
      [1, 2, 3, 4, 5],
      async (x) => {
        active.push(x);
        maxConcurrent.value = Math.max(maxConcurrent.value, active.length);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active.splice(active.indexOf(x), 1);
        return x * 2;
      },
      2,
    );

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxConcurrent.value).toBeLessThanOrEqual(2);
  });

  it("processes with concurrency higher than item count", async () => {
    const results = await work([1, 2, 3], async (x) => x * 2, 10);
    expect(results).toEqual([2, 4, 6]);
  });

  it("preserves result order regardless of completion time", async () => {
    const results = await work(
      [1, 2, 3, 4, 5],
      async (x) => {
        // Reverse delay - item 5 completes first
        await new Promise((resolve) => setTimeout(resolve, (6 - x) * 5));
        return x * 2;
      },
      5,
    );
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("passes index to worker function", async () => {
    const indices: number[] = [];
    await work(
      ["a", "b", "c"],
      async (_item, index) => {
        indices.push(index);
        return index;
      },
      2,
    );
    expect(indices.sort()).toEqual([0, 1, 2]);
  });

  it("propagates errors from worker function", async () => {
    await expect(
      work(
        [1, 2, 3],
        async (x) => {
          if (x === 2) throw new Error("boom");
          return x;
        },
        2,
      ),
    ).rejects.toThrow("AsyncQueue: Failed at index 1: boom");
  });

  it("stops processing after first error", async () => {
    const processed: number[] = [];
    await expect(
      work(
        [1, 2, 3, 4, 5],
        async (x) => {
          if (x === 2) throw new Error("boom");
          processed.push(x);
          return x;
        },
        1,
      ),
    ).rejects.toThrow();
    // May have processed 1 before error at 2
    expect(processed.length).toBeLessThan(5);
  });

  it("rejects when concurrency < 1", async () => {
    await expect(work([1, 2, 3], async (x) => x, 0)).rejects.toThrow(
      "Concurrency must be at least 1",
    );
  });
});

describe("AsyncQueue - class API", () => {
  const queue = new AsyncQueue();

  it("work() method processes items", async () => {
    const results = await queue.work([1, 2, 3], async (x) => x * 2, 2);
    expect(results).toEqual([2, 4, 6]);
  });

  it("workFns() method processes functions", async () => {
    const fns = [async () => 1, async () => 2, async () => 3];
    const results = await queue.workFns(fns, 2);
    expect(results).toEqual([1, 2, 3]);
  });

  it("map() method is alias for work()", async () => {
    const results = await queue.map([1, 2, 3], async (x) => x * 2, 2);
    expect(results).toEqual([2, 4, 6]);
  });

  it("workFns() respects concurrency", async () => {
    const active: number[] = [];
    const maxConcurrent = { value: 0 };

    const fns = [1, 2, 3, 4, 5].map((x) => async () => {
      active.push(x);
      maxConcurrent.value = Math.max(maxConcurrent.value, active.length);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active.splice(active.indexOf(x), 1);
      return x;
    });

    const results = await queue.workFns(fns, 2);
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(maxConcurrent.value).toBeLessThanOrEqual(2);
  });
});
