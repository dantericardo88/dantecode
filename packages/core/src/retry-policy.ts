import type { ParsedApiError } from "./api-error-classifier.js";

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
}

export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  parsedError: ParsedApiError;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 2_000,
  multiplier: 2,
  maxDelayMs: 30_000,
};

export function computeRetryDelayMs(
  attempt: number,
  parsedError: Pick<ParsedApiError, "retryAfterMs">,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number {
  if (parsedError.retryAfterMs !== undefined) {
    return parsedError.retryAfterMs;
  }

  const exponentialDelay =
    policy.initialDelayMs * Math.pow(policy.multiplier, Math.max(0, attempt - 1));
  return Math.min(policy.maxDelayMs, exponentialDelay);
}

export async function sleepWithAbort(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (!abortSignal) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return;
  }

  if (abortSignal.aborted) {
    throw new Error("Request aborted");
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeoutId);
      abortSignal.removeEventListener("abort", onAbort);
      reject(new Error("Request aborted"));
    };

    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    policy?: RetryPolicy;
    abortSignal?: AbortSignal;
    classifyError: (error: unknown) => ParsedApiError;
    onRetry?: (context: RetryContext) => void | Promise<void>;
  },
): Promise<T> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      const parsedError = options.classifyError(error);
      const hasAttemptsRemaining = attempt < policy.maxAttempts;

      if (!parsedError.isRetryable || !hasAttemptsRemaining) {
        throw error;
      }

      const delayMs = computeRetryDelayMs(attempt, parsedError, policy);
      await options.onRetry?.({
        attempt,
        maxAttempts: policy.maxAttempts,
        delayMs,
        parsedError,
      });
      await sleepWithAbort(delayMs, options.abortSignal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
