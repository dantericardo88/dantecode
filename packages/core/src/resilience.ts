// ============================================================================
// packages/core/src/resilience.ts
//
// Resilience primitives — retry-with-backoff and timeout wrappers that
// integrate with the structured error hierarchy in errors.ts. Use these at
// boundary points (provider calls, tool spawns, network requests) where
// transient failures should be auto-recovered before bubbling to the user.
//
// Design choices:
//   - Pure functions, no module-level state. Each call is independent.
//   - Type-checked recovery hint: `retry` errors are auto-retried; `abort`
//     errors fail-fast even within a retry loop.
//   - Exponential backoff with jitter — prevents thundering herds on
//     downstream rate limits.
//   - Timeout uses AbortController so the underlying operation can cooperate
//     in cancellation rather than being orphaned.
// ============================================================================

import { DanteCodeError, TimeoutError, isDanteCodeError } from "./errors.js";

export interface RetryOptions {
  /** Maximum attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms. Default 250. */
  baseDelayMs?: number;
  /** Cap on the largest backoff (prevents runaway long waits). Default 30s. */
  maxDelayMs?: number;
  /** Multiplier per attempt. Default 2 (exponential). */
  backoffFactor?: number;
  /** Jitter ratio [0,1] — randomly reduces delay by up to this fraction. Default 0.2. */
  jitterRatio?: number;
  /** Optional callback fired before each retry attempt with the error and attempt number. */
  onRetry?: (err: unknown, attempt: number) => void;
}

const DEFAULT_RETRY: Required<Omit<RetryOptions, "onRetry">> = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 30_000,
  backoffFactor: 2,
  jitterRatio: 0.2,
};

/**
 * Run an operation with exponential-backoff retry. Respects DanteCodeError
 * recovery hints: errors marked `recovery: "abort"` skip retry and fail-fast.
 *
 * Common pattern at provider boundaries:
 *   const result = await retry(() => provider.complete(prompt), { maxAttempts: 3 });
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      // Honor the recovery hint: abort means fail-fast even inside retry.
      if (isDanteCodeError(err) && err.recovery === "abort") throw err;
      if (attempt >= opts.maxAttempts) break;
      options.onRetry?.(err, attempt);
      const baseDelay = Math.min(
        opts.baseDelayMs * Math.pow(opts.backoffFactor, attempt - 1),
        opts.maxDelayMs,
      );
      const jitter = baseDelay * opts.jitterRatio * Math.random();
      await sleep(Math.round(baseDelay - jitter));
    }
  }
  throw lastError;
}

/**
 * Wrap an operation with a timeout. Throws a TimeoutError if the operation
 * doesn't resolve within the limit. Passes an AbortSignal so the operation
 * can cooperate in cancellation (though not all callers will respect it).
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operationName = "operation",
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new TimeoutError(operationName, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Combine retry + timeout — the common pattern for any external call.
 * Each retry attempt gets the full timeout; total wall-clock can be up to
 * `maxAttempts × timeoutMs` plus backoff between attempts.
 */
export async function retryWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  retryOpts: RetryOptions = {},
  operationName = "operation",
): Promise<T> {
  return retry(() => withTimeout(operation, timeoutMs, operationName), retryOpts);
}

/**
 * Predicate: should this error trigger a retry? Honors DanteCodeError
 * recovery hints when present, falls back to "yes" for plain errors.
 */
export function isRetryable(err: unknown): boolean {
  if (isDanteCodeError(err)) {
    return err.recovery === "retry" || err.recovery === "model-correction";
  }
  return err instanceof Error;
}

/**
 * Pause execution for the given milliseconds. Wraps setTimeout in a Promise
 * so it composes cleanly with async/await.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run multiple operations in parallel with bounded concurrency. Useful for
 * fanning out tool calls or provider requests without overwhelming downstream
 * rate limits. Failures are returned in the result array — caller decides
 * whether to abort or continue.
 */
export async function parallelWithLimit<T>(
  items: Array<() => Promise<T>>,
  concurrency: number,
): Promise<Array<{ ok: true; value: T } | { ok: false; error: unknown }>> {
  if (concurrency < 1) {
    throw new DanteCodeError("VALIDATION_FAILED", "concurrency must be >= 1");
  }
  const results: Array<{ ok: true; value: T } | { ok: false; error: unknown }> = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try {
        const value = await items[idx]!();
        results[idx] = { ok: true, value };
      } catch (error) {
        results[idx] = { ok: false, error };
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
