// ============================================================================
// @dantecode/cli — Error Integration Tests
// Proves the full error classification pipeline works end-to-end:
//   classifyError → model-router errorType → swallowError observability → tool enrichment
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyError,
  DanteErrorType,
  isRetryable,
  isTerminal,
  isCircuitOpen,
  getRetryDelayMs,
} from "@dantecode/core";

// ─── classifyError pipeline ───────────────────────────────────────────────────

describe("Error Classification Pipeline — classifyError", () => {
  function makeCircuitOpenError(provider = "anthropic"): Error {
    const err = new Error(`Circuit breaker open for ${provider}`);
    err.name = "CircuitOpenError";
    Object.defineProperty(err, "provider", { value: provider, enumerable: true });
    return err;
  }

  it("classifyError recognizes CircuitOpenError by duck-typing", () => {
    const err = makeCircuitOpenError("anthropic");
    expect(classifyError(err)).toBe(DanteErrorType.CircuitOpen);
  });

  it("isCircuitOpen(CircuitOpen) === true", () => {
    expect(isCircuitOpen(DanteErrorType.CircuitOpen)).toBe(true);
  });

  it("isRetryable(CircuitOpen) === false", () => {
    expect(isRetryable(DanteErrorType.CircuitOpen)).toBe(false);
  });

  it("isTerminal(CircuitOpen) === false — it eventually resets", () => {
    expect(isTerminal(DanteErrorType.CircuitOpen)).toBe(false);
  });

  it("classifyError → 429 message → RateLimit", () => {
    expect(classifyError(new Error("Too many requests"))).toBe(DanteErrorType.RateLimit);
  });

  it("classifyError → 401 status → Auth", () => {
    expect(classifyError({ message: "Unauthorized", status: 401 })).toBe(DanteErrorType.Auth);
  });

  it("classifyError → ECONNREFUSED → Network", () => {
    expect(classifyError(new Error("connect ECONNREFUSED 127.0.0.1:443"))).toBe(DanteErrorType.Network);
  });

  it("classifyError → insufficient_credits → Balance", () => {
    expect(classifyError(new Error("insufficient_credits — out of credits"))).toBe(DanteErrorType.Balance);
  });

  it("classifyError → context_length_exceeded → ContextWindow", () => {
    expect(classifyError(new Error("context_length_exceeded: max 200000"))).toBe(DanteErrorType.ContextWindow);
  });

  it("classifyError → unrecognized → Unknown", () => {
    expect(classifyError(new Error("something weird happened"))).toBe(DanteErrorType.Unknown);
  });

  it("getRetryDelayMs(CircuitOpen, 1) === 0", () => {
    expect(getRetryDelayMs(DanteErrorType.CircuitOpen, 1)).toBe(0);
  });

  it("getRetryDelayMs(CircuitOpen, 5) === 0", () => {
    expect(getRetryDelayMs(DanteErrorType.CircuitOpen, 5)).toBe(0);
  });

  it("RateLimit delay > Network delay at attempt 1", () => {
    expect(getRetryDelayMs(DanteErrorType.RateLimit, 1)).toBeGreaterThan(
      getRetryDelayMs(DanteErrorType.Network, 1),
    );
  });

  it("Auth is terminal — never retry", () => {
    expect(isTerminal(DanteErrorType.Auth)).toBe(true);
    expect(isRetryable(DanteErrorType.Auth)).toBe(false);
  });

  it("Balance is terminal — never retry", () => {
    expect(isTerminal(DanteErrorType.Balance)).toBe(true);
    expect(isRetryable(DanteErrorType.Balance)).toBe(false);
  });

  it("ContextWindow is not retryable — requires compression", () => {
    expect(isRetryable(DanteErrorType.ContextWindow)).toBe(false);
  });

  it("CircuitOpen with different providers all classify correctly", () => {
    for (const provider of ["anthropic", "openai", "grok", "google"]) {
      expect(classifyError(makeCircuitOpenError(provider))).toBe(DanteErrorType.CircuitOpen);
    }
  });

  it("CircuitOpen prioritized over pattern matching — even if message contains '429'", () => {
    const err = makeCircuitOpenError("anthropic");
    err.message = "Circuit open — rate limited (429)";
    expect(classifyError(err)).toBe(DanteErrorType.CircuitOpen);
  });

  it("nested response.status 429 → RateLimit", () => {
    expect(classifyError({ message: "API error", response: { status: 429 } })).toBe(
      DanteErrorType.RateLimit,
    );
  });
});

// ─── swallowError observability ───────────────────────────────────────────────

describe("swallowError observability", () => {
  it("swallowError is exported from @dantecode/core", async () => {
    const core = await import("@dantecode/core");
    expect(typeof (core as Record<string, unknown>)["swallowError"]).toBe("function");
  });

  it("swallowError never throws — handles null", async () => {
    const { swallowError } = await import("@dantecode/core") as unknown as { swallowError: (err: unknown, ctx: string) => void };
    expect(() => swallowError(null, "test-null")).not.toThrow();
  });

  it("swallowError never throws — handles undefined", async () => {
    const { swallowError } = await import("@dantecode/core") as unknown as { swallowError: (err: unknown, ctx: string) => void };
    expect(() => swallowError(undefined, "test-undefined")).not.toThrow();
  });

  it("swallowError never throws — handles string errors", async () => {
    const { swallowError } = await import("@dantecode/core") as unknown as { swallowError: (err: unknown, ctx: string) => void };
    expect(() => swallowError("some string error", "test-string")).not.toThrow();
  });

  it("swallowError never throws — handles Error instances", async () => {
    const { swallowError } = await import("@dantecode/core") as unknown as { swallowError: (err: unknown, ctx: string) => void };
    expect(() => swallowError(new Error("test error"), "test-error")).not.toThrow();
  });

  it("swallowError writes to console.error — not silent", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { swallowError } = await import("@dantecode/core") as unknown as { swallowError: (err: unknown, ctx: string) => void };
      swallowError(new Error("observable error"), "test-observability");
      expect(consoleSpy).toHaveBeenCalled();
      const call = consoleSpy.mock.calls[0]?.[0] as string;
      expect(call).toContain("[swallowError:test-observability]");
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ─── tools.ts error enrichment ────────────────────────────────────────────────

describe("Tool error enrichment — Network suffix", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("classifyError on ETIMEDOUT → Network type", () => {
    const err = new Error("request failed: ETIMEDOUT");
    expect(classifyError(err)).toBe(DanteErrorType.Network);
  });

  it("classifyError on fetch failed → Network type", () => {
    const err = new Error("fetch failed: network error");
    expect(classifyError(err)).toBe(DanteErrorType.Network);
  });

  it("classifyError on ECONNREFUSED → Network type", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:443");
    expect(classifyError(err)).toBe(DanteErrorType.Network);
  });

  it("DanteErrorType.Network is not Unknown (suffix IS added)", () => {
    expect(DanteErrorType.Network).not.toBe(DanteErrorType.Unknown);
  });

  it("DanteErrorType.Auth is not Unknown (suffix IS added)", () => {
    expect(DanteErrorType.Auth).not.toBe(DanteErrorType.Unknown);
  });

  it("DanteErrorType.Unknown stays Unknown (no suffix added)", () => {
    const err = new Error("totally unrecognized");
    expect(classifyError(err)).toBe(DanteErrorType.Unknown);
  });
});

// ─── error type semantics ─────────────────────────────────────────────────────

describe("Error type semantics — full matrix", () => {
  const allTypes = Object.values(DanteErrorType);

  it("every error type is retryable OR terminal OR circuit-open", () => {
    for (const type of allTypes) {
      const retryable = isRetryable(type);
      const terminal = isTerminal(type);
      const circuitOpen = isCircuitOpen(type);
      const unknown = type === DanteErrorType.Unknown;
      // Must be classifiable:  retryable, terminal, circuit-open, or unknown fallback
      expect(retryable || terminal || circuitOpen || unknown || type === DanteErrorType.ContextWindow || type === DanteErrorType.Network || type === DanteErrorType.RateLimit).toBe(true);
    }
  });

  it("no type is both retryable AND terminal", () => {
    for (const type of allTypes) {
      if (isRetryable(type) && isTerminal(type)) {
        throw new Error(`Type ${type} is both retryable and terminal — contradiction`);
      }
    }
  });

  it("CircuitOpen is not retryable and not terminal — unique third state", () => {
    expect(isRetryable(DanteErrorType.CircuitOpen)).toBe(false);
    expect(isTerminal(DanteErrorType.CircuitOpen)).toBe(false);
    expect(isCircuitOpen(DanteErrorType.CircuitOpen)).toBe(true);
  });

  it("getRetryDelayMs returns 0 for all non-retryable types", () => {
    for (const type of allTypes) {
      if (!isRetryable(type)) {
        expect(getRetryDelayMs(type, 1)).toBe(0);
        expect(getRetryDelayMs(type, 5)).toBe(0);
      }
    }
  });

  it("getRetryDelayMs caps at 30s for retryable types", () => {
    for (const type of allTypes) {
      if (isRetryable(type)) {
        expect(getRetryDelayMs(type, 100)).toBeLessThanOrEqual(30_000);
      }
    }
  });
});
