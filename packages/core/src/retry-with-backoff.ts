/**
 * retry-with-backoff.ts
 *
 * Exponential backoff retry with jitter
 * Pattern source: Kilocode retry-with-backoff
 *
 * Implements industry-standard exponential backoff with:
 * - Configurable max retries
 * - Exponential delay growth (baseDelay * 2^attempt)
 * - Max delay cap
 * - Header-aware retry (reads retry-after-ms from errors)
 * - Retryable error classification
 * - Retry callback for logging
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Function to determine if error is retryable (default: all errors retryable) */
  retryableErrors?: (error: unknown) => boolean;
  /** Callback invoked on each retry attempt */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Execute async function with exponential backoff retry.
 *
 * Delay formula: min(baseDelayMs * 2^attempt + jitter, maxDelayMs)
 * Jitter: random value between 0 and baseDelayMs to avoid thundering herd
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns Promise resolving to function result
 * @throws Last error if all retries exhausted or error is non-retryable
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   async () => fetch('/api/data'),
 *   {
 *     maxRetries: 3,
 *     baseDelayMs: 1000,
 *     retryableErrors: (err) => err instanceof NetworkError,
 *     onRetry: (attempt, err, delay) => console.log(`Retry ${attempt} after ${delay}ms`)
 *   }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (opts.retryableErrors && !opts.retryableErrors(error)) {
        throw error;
      }

      // Last attempt - don't retry
      if (attempt === opts.maxRetries) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const exponentialDelay = opts.baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * opts.baseDelayMs;
      const delay = Math.min(exponentialDelay + jitter, opts.maxDelayMs);

      // Check for retry-after header in error
      const retryAfter = extractRetryAfter(error);
      const finalDelay = retryAfter !== null ? retryAfter : delay;

      // Invoke retry callback
      if (opts.onRetry) {
        opts.onRetry(attempt + 1, error, finalDelay);
      }

      // Wait before retry
      await sleep(finalDelay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Extract retry-after delay from error object.
 * Checks for:
 * - error.retryAfterMs (number)
 * - error.headers['retry-after-ms'] (string or number)
 * - error.headers['retry-after'] (seconds)
 *
 * @param error - Error object to inspect
 * @returns Delay in milliseconds, or null if not found
 */
function extractRetryAfter(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const err = error as any;

  // Check for retryAfterMs property
  if (typeof err.retryAfterMs === "number" && err.retryAfterMs > 0) {
    return err.retryAfterMs;
  }

  // Check headers object
  if (typeof err.headers === "object" && err.headers !== null) {
    const headers = err.headers;

    // retry-after-ms (milliseconds)
    if (headers["retry-after-ms"]) {
      const ms = Number(headers["retry-after-ms"]);
      if (!isNaN(ms) && ms > 0) return ms;
    }

    // retry-after (seconds)
    if (headers["retry-after"]) {
      const seconds = Number(headers["retry-after"]);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
    }
  }

  return null;
}

/**
 * Sleep for specified milliseconds.
 * @param ms - Duration in milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Common retryable error classifiers
 */
export const RetryableErrors = {
  /** Retry on network errors only */
  networkOnly: (error: unknown): boolean => {
    if (typeof error !== "object" || error === null) return false;
    const err = error as any;
    return !!(
      err.code === "ECONNRESET" ||
      err.code === "ENOTFOUND" ||
      err.code === "ETIMEDOUT" ||
      err.code === "ECONNREFUSED" ||
      err.message?.includes("fetch failed") ||
      err.message?.includes("network")
    );
  },

  /** Retry on 5xx server errors and network errors */
  serverErrors: (error: unknown): boolean => {
    if (RetryableErrors.networkOnly(error)) return true;
    if (typeof error !== "object" || error === null) return false;
    const err = error as any;
    return (
      (typeof err.status === "number" && err.status >= 500) ||
      err.statusCode >= 500
    );
  },

  /** Retry on rate limit errors (429) */
  rateLimitOnly: (error: unknown): boolean => {
    if (typeof error !== "object" || error === null) return false;
    const err = error as any;
    return err.status === 429 || err.statusCode === 429;
  },

  /** Retry on rate limits and server errors */
  serverAndRateLimit: (error: unknown): boolean => {
    return RetryableErrors.serverErrors(error) || RetryableErrors.rateLimitOnly(error);
  },
};
