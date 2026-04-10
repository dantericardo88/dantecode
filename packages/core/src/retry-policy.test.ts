import { describe, expect, it, vi } from "vitest";
import type { ParsedApiError } from "./api-error-classifier.js";
import {
  DEFAULT_RETRY_POLICY,
  computeRetryDelayMs,
  retryWithBackoff,
} from "./retry-policy.js";

function makeParsedError(overrides: Partial<ParsedApiError> = {}): ParsedApiError {
  return {
    category: "rate_limit",
    message: "rate limit",
    isRetryable: true,
    raw: new Error("rate limit"),
    ...overrides,
  };
}

describe("computeRetryDelayMs", () => {
  it("uses exponential backoff by default", () => {
    expect(computeRetryDelayMs(1, makeParsedError(), DEFAULT_RETRY_POLICY)).toBe(2_000);
    expect(computeRetryDelayMs(2, makeParsedError(), DEFAULT_RETRY_POLICY)).toBe(4_000);
    expect(computeRetryDelayMs(5, makeParsedError(), DEFAULT_RETRY_POLICY)).toBe(30_000);
  });

  it("honors retry-after hints over exponential backoff", () => {
    expect(
      computeRetryDelayMs(3, makeParsedError({ retryAfterMs: 12_345 }), DEFAULT_RETRY_POLICY),
    ).toBe(12_345);
  });
});

describe("retryWithBackoff", () => {
  it("retries retryable failures until success", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValueOnce("ok");
    const onRetry = vi.fn();

    const result = await retryWithBackoff(operation, {
      policy: { ...DEFAULT_RETRY_POLICY, initialDelayMs: 1, maxDelayMs: 1 },
      classifyError: () => makeParsedError(),
      onRetry,
    });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-retryable failures", async () => {
    const error = new Error("bad request");
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    await expect(
      retryWithBackoff(operation, {
        policy: { ...DEFAULT_RETRY_POLICY, initialDelayMs: 1, maxDelayMs: 1 },
        classifyError: () =>
          makeParsedError({
            category: "invalid_request",
            isRetryable: false,
            raw: error,
          }),
      }),
    ).rejects.toThrow("bad request");

    expect(operation).toHaveBeenCalledTimes(1);
  });
});
