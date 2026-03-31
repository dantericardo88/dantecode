/**
 * async-queue.ts
 *
 * AsyncQueue - Concurrency-controlled Promise execution
 * Pattern source: Kilocode async work queue
 *
 * Zero-dep implementation for parallel task execution with configurable
 * concurrency limits. Used in council orchestrator for lane execution and
 * background agent runner for queue processing.
 */

/**
 * Execute array of items with concurrency control.
 * Processes items in parallel up to the specified concurrency limit.
 *
 * @param items - Array of items to process
 * @param fn - Async function to execute for each item
 * @param concurrency - Maximum number of concurrent executions
 * @returns Promise resolving to array of results in original order
 *
 * @example
 * ```typescript
 * const results = await work(
 *   [1, 2, 3, 4, 5],
 *   async (n) => n * 2,
 *   2  // max 2 concurrent
 * );
 * // results: [2, 4, 6, 8, 10]
 * ```
 */
export async function work<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  if (concurrency < 1) {
    throw new Error("Concurrency must be at least 1");
  }

  if (items.length === 0) {
    return [];
  }

  const results: R[] = new Array(items.length);
  const errors: { index: number; error: unknown }[] = [];
  let currentIndex = 0;

  const executeNext = async (): Promise<void> => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (error) {
        errors.push({ index, error });
      }
    }
  };

  // Start workers up to concurrency limit
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => executeNext());

  await Promise.all(workers);

  // If any errors occurred, throw the first one
  // (alternative: collect all errors and throw AggregateError)
  if (errors.length > 0) {
    const firstError = errors[0]!;
    throw new Error(
      `AsyncQueue: Failed at index ${firstError.index}: ${firstError.error instanceof Error ? firstError.error.message : String(firstError.error)}`,
    );
  }

  return results;
}

/**
 * AsyncQueue class for OOP-style usage.
 * Wraps the functional `work` API with a class interface.
 */
export class AsyncQueue {
  /**
   * Execute array of items with concurrency control.
   * @see work
   */
  async work<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    concurrency: number,
  ): Promise<R[]> {
    return work(items, fn, concurrency);
  }

  /**
   * Execute array of async functions with concurrency control.
   * Useful when you have pre-bound functions to execute.
   *
   * @param fns - Array of async functions to execute
   * @param concurrency - Maximum number of concurrent executions
   * @returns Promise resolving to array of results in original order
   */
  async workFns<R>(fns: Array<() => Promise<R>>, concurrency: number): Promise<R[]> {
    return work(fns, (fn) => fn(), concurrency);
  }

  /**
   * Map over array with concurrency control (alias for work).
   * @see work
   */
  async map<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    concurrency: number,
  ): Promise<R[]> {
    return work(items, fn, concurrency);
  }
}
