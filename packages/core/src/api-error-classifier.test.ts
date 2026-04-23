import { describe, expect, it } from "vitest";
import { classifyApiError, parseRetryAfterMs } from "./api-error-classifier.js";

describe("parseRetryAfterMs", () => {
  it("parses Retry-After seconds values", () => {
    expect(parseRetryAfterMs("7", 1_000)).toBe(7_000);
  });

  it("parses Retry-After HTTP dates", () => {
    expect(parseRetryAfterMs("Thu, 01 Jan 1970 00:00:05 GMT", 1_000)).toBe(4_000);
  });

  it("returns undefined for invalid header values", () => {
    expect(parseRetryAfterMs("not-a-date", 1_000)).toBeUndefined();
  });
});

describe("classifyApiError", () => {
  it("classifies rate limits and extracts retry-after headers", () => {
    const error = Object.assign(new Error("Rate limit exceeded"), {
      status: 429,
      headers: {
        "retry-after": "7",
      },
    });

    const parsed = classifyApiError(error, "grok");

    expect(parsed.category).toBe("rate_limit");
    expect(parsed.isRetryable).toBe(true);
    expect(parsed.retryAfterMs).toBe(7_000);
    expect(parsed.statusCode).toBe(429);
  });

  it("classifies context overflow errors as non-retryable", () => {
    const parsed = classifyApiError(
      new Error("This model's maximum context length is 128000 tokens."),
      "anthropic",
    );

    expect(parsed.category).toBe("context_overflow");
    expect(parsed.isRetryable).toBe(false);
  });

  it("classifies authentication failures as non-retryable", () => {
    const parsed = classifyApiError(
      Object.assign(new Error("Unauthorized"), {
        statusCode: 401,
      }),
      "openai",
    );

    expect(parsed.category).toBe("auth");
    expect(parsed.isRetryable).toBe(false);
  });

  it("classifies transient server errors as retryable", () => {
    const parsed = classifyApiError(
      Object.assign(new Error("Service Unavailable"), {
        statusCode: 503,
      }),
      "google",
    );

    expect(parsed.category).toBe("server");
    expect(parsed.isRetryable).toBe(true);
  });
});
