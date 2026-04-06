import { describe, it, expect } from "vitest";
import {
  classifyError,
  isRetryable,
  isTerminal,
  getRetryDelayMs,
  DanteErrorType,
} from "./error-classifier.js";

describe("classifyError", () => {
  describe("Balance detection (most specific — checked first)", () => {
    it("classifies insufficient_credits as Balance", () => {
      expect(classifyError({ message: "Error: insufficient_credits — your account is out of credits", status: 400 })).toBe(DanteErrorType.Balance);
    });
    it("classifies 'billing' message as Balance", () => {
      expect(classifyError({ message: "Billing error: payment required" })).toBe(DanteErrorType.Balance);
    });
    it("classifies 'no credits' as Balance, not Auth, even on 400", () => {
      expect(classifyError({ message: "No credits remaining", status: 400 })).toBe(DanteErrorType.Balance);
    });
  });

  describe("Auth detection", () => {
    it("classifies 401 as Auth", () => {
      expect(classifyError({ message: "Unauthorized", status: 401 })).toBe(DanteErrorType.Auth);
    });
    it("classifies 403 as Auth", () => {
      expect(classifyError({ message: "Forbidden", status: 403 })).toBe(DanteErrorType.Auth);
    });
    it("classifies invalid API key message as Auth", () => {
      expect(classifyError({ message: "Invalid API key provided" })).toBe(DanteErrorType.Auth);
    });
    it("classifies authentication failure as Auth", () => {
      expect(classifyError({ message: "Authentication failed for this request" })).toBe(DanteErrorType.Auth);
    });
  });

  describe("RateLimit detection", () => {
    it("classifies 429 as RateLimit", () => {
      expect(classifyError({ message: "Too many requests", status: 429 })).toBe(DanteErrorType.RateLimit);
    });
    it("classifies 'status code 429' message as RateLimit", () => {
      expect(classifyError({ message: "Request failed with status code 429" })).toBe(DanteErrorType.RateLimit);
    });
    it("classifies 'quota exceeded' as RateLimit", () => {
      expect(classifyError({ message: "Quota exceeded for this project" })).toBe(DanteErrorType.RateLimit);
    });
    it("classifies 'resource exhausted' as RateLimit", () => {
      expect(classifyError({ message: "resource exhausted: quota limit reached" })).toBe(DanteErrorType.RateLimit);
    });
  });

  describe("ContextWindow detection", () => {
    it("classifies context_length_exceeded as ContextWindow", () => {
      expect(classifyError({ message: "context_length_exceeded: maximum of 200000 tokens" })).toBe(DanteErrorType.ContextWindow);
    });
    it("classifies Anthropic invalid_request with token message as ContextWindow", () => {
      expect(classifyError({ message: "prompt is too long: 201000 tokens", type: "invalid_request_error", status: 400 })).toBe(DanteErrorType.ContextWindow);
    });
    it("classifies 'prompt is too long' as ContextWindow", () => {
      expect(classifyError({ message: "prompt is too long" })).toBe(DanteErrorType.ContextWindow);
    });
  });

  describe("Network detection", () => {
    it("classifies ECONNREFUSED as Network", () => {
      expect(classifyError({ message: "connect ECONNREFUSED 127.0.0.1:443" })).toBe(DanteErrorType.Network);
    });
    it("classifies ETIMEDOUT as Network", () => {
      expect(classifyError({ message: "request to api.openai.com failed: ETIMEDOUT" })).toBe(DanteErrorType.Network);
    });
    it("classifies fetch failed as Network", () => {
      expect(classifyError({ message: "fetch failed: network error" })).toBe(DanteErrorType.Network);
    });
  });

  describe("Unknown fallback", () => {
    it("returns Unknown for unrecognized errors", () => {
      expect(classifyError({ message: "Something went wrong internally" })).toBe(DanteErrorType.Unknown);
    });
    it("handles string errors", () => {
      expect(classifyError("some error string")).toBe(DanteErrorType.Unknown);
    });
    it("handles null", () => {
      expect(classifyError(null)).toBe(DanteErrorType.Unknown);
    });
    it("handles nested response status for 429", () => {
      expect(classifyError({ message: "API error", response: { status: 429 } })).toBe(DanteErrorType.RateLimit);
    });
  });
});

describe("isRetryable", () => {
  it("RateLimit is retryable", () => {
    expect(isRetryable(DanteErrorType.RateLimit)).toBe(true);
  });
  it("Network is retryable", () => {
    expect(isRetryable(DanteErrorType.Network)).toBe(true);
  });
  it("Unknown is retryable (cautious)", () => {
    expect(isRetryable(DanteErrorType.Unknown)).toBe(true);
  });
  it("Auth is NOT retryable", () => {
    expect(isRetryable(DanteErrorType.Auth)).toBe(false);
  });
  it("Balance is NOT retryable", () => {
    expect(isRetryable(DanteErrorType.Balance)).toBe(false);
  });
  it("ContextWindow is NOT retryable", () => {
    expect(isRetryable(DanteErrorType.ContextWindow)).toBe(false);
  });
});

describe("isTerminal", () => {
  it("Auth is terminal", () => {
    expect(isTerminal(DanteErrorType.Auth)).toBe(true);
  });
  it("Balance is terminal", () => {
    expect(isTerminal(DanteErrorType.Balance)).toBe(true);
  });
  it("RateLimit is not terminal", () => {
    expect(isTerminal(DanteErrorType.RateLimit)).toBe(false);
  });
});

describe("getRetryDelayMs", () => {
  it("returns 0 for non-retryable errors", () => {
    expect(getRetryDelayMs(DanteErrorType.Auth, 1)).toBe(0);
    expect(getRetryDelayMs(DanteErrorType.Balance, 1)).toBe(0);
  });
  it("returns longer delay for RateLimit than Network", () => {
    expect(getRetryDelayMs(DanteErrorType.RateLimit, 1)).toBeGreaterThan(
      getRetryDelayMs(DanteErrorType.Network, 1)
    );
  });
  it("doubles delay on each attempt for Network", () => {
    const d1 = getRetryDelayMs(DanteErrorType.Network, 1);
    const d2 = getRetryDelayMs(DanteErrorType.Network, 2);
    expect(d2).toBe(d1 * 2);
  });
  it("caps at 30 seconds", () => {
    expect(getRetryDelayMs(DanteErrorType.RateLimit, 10)).toBe(30_000);
  });
});
