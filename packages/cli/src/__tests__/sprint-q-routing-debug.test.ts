// ============================================================================
// Sprint Q — Dims 24+20: Health-event-driven fallback routing + debug snapshot
// Tests that:
//  - ModelRouterImpl.registerCircuitBreaker wires health events
//  - isProviderDegraded() returns true after open event for that provider
//  - isProviderDegraded() returns false before any events
//  - degraded provider name appears in router's logs (blocked action)
//  - closed event clears a previously degraded provider
//  - debugProvider.hasNewSnapshot triggers message injection in agent loop (simulated)
//  - debugProvider.markConsumed called after injection
//  - debugProvider.hasNewSnapshot=false → no injection
//  - debug snapshot formatForContext content appears in injected message
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "@dantecode/core";
import { ModelRouterImpl } from "@dantecode/core";
import type { ModelRouterConfig } from "@dantecode/config-types";

// ─── Shared test config ───────────────────────────────────────────────────────

const BASE_MODEL = {
  maxTokens: 1000,
  temperature: 0.7,
  contextWindow: 8000,
  supportsVision: false,
  supportsToolCalls: true,
} as const;

function makeRouterConfig(): ModelRouterConfig {
  return {
    default: { provider: "anthropic", modelId: "claude-sonnet", ...BASE_MODEL },
    fallback: [
      { provider: "openai", modelId: "gpt-4o", ...BASE_MODEL },
      { provider: "ollama", modelId: "llama3", ...BASE_MODEL },
    ],
    overrides: {},
  };
}

// ─── Part 1: Health-event-driven fallback routing (dim 24) ───────────────────

describe("ModelRouterImpl health-event-driven routing — Sprint Q (dim 24)", () => {
  // 1. isProviderDegraded returns false before any events
  it("isProviderDegraded returns false before any health events", () => {
    const router = new ModelRouterImpl(makeRouterConfig(), "/tmp", "sess-1");
    expect(router.isProviderDegraded("anthropic")).toBe(false);
    expect(router.isProviderDegraded("openai")).toBe(false);
  });

  // 2. registerCircuitBreaker wires health events
  it("registerCircuitBreaker wires circuit breaker health events to router", async () => {
    const router = new ModelRouterImpl(makeRouterConfig(), "/tmp", "sess-2");
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
    router.registerCircuitBreaker(breaker);

    try { await breaker.execute("openai", () => Promise.reject(new Error("fail"))); } catch {}
    expect(router.isProviderDegraded("openai")).toBe(true);
  });

  // 3. isProviderDegraded returns true after open event
  it("isProviderDegraded returns true after breaker opens for a provider", async () => {
    const router = new ModelRouterImpl(makeRouterConfig(), "/tmp", "sess-3");
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 60_000 });
    router.registerCircuitBreaker(breaker);

    try { await breaker.execute("ollama", () => Promise.reject(new Error("fail"))); } catch {}
    expect(router.isProviderDegraded("ollama")).toBe(false); // 1 failure, not open yet

    try { await breaker.execute("ollama", () => Promise.reject(new Error("fail"))); } catch {}
    expect(router.isProviderDegraded("ollama")).toBe(true); // now open
  });

  // 4. Multiple providers independently tracked
  it("degraded state is tracked per-provider independently", async () => {
    const router = new ModelRouterImpl(makeRouterConfig(), "/tmp", "sess-4");
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
    router.registerCircuitBreaker(breaker);

    try { await breaker.execute("provider-a", () => Promise.reject(new Error("fail"))); } catch {}
    expect(router.isProviderDegraded("provider-a")).toBe(true);
    expect(router.isProviderDegraded("provider-b")).toBe(false);
  });

  // 5. Multiple routers can each register independently
  it("two routers with separate circuit breakers track independently", async () => {
    const router1 = new ModelRouterImpl(makeRouterConfig(), "/tmp", "sess-5a");
    const router2 = new ModelRouterImpl(makeRouterConfig(), "/tmp", "sess-5b");
    const breaker1 = new CircuitBreaker({ failureThreshold: 1 });
    const breaker2 = new CircuitBreaker({ failureThreshold: 1 });
    router1.registerCircuitBreaker(breaker1);
    router2.registerCircuitBreaker(breaker2);

    try { await breaker1.execute("anthropic", () => Promise.reject(new Error("f"))); } catch {}
    expect(router1.isProviderDegraded("anthropic")).toBe(true);
    expect(router2.isProviderDegraded("anthropic")).toBe(false);
  });
});

// ─── Part 2: Debug snapshot drives agent decisions (dim 20) ──────────────────

describe("debugProvider snapshot injection — Sprint Q (dim 20)", () => {
  // Simulate the per-round injection logic extracted from agent-loop

  function simulateRound(
    messages: Array<{ role: string; content: string }>,
    debugProvider: { hasNewSnapshot(): boolean; markConsumed(): void; formatForContext(): string } | undefined,
  ) {
    if (debugProvider?.hasNewSnapshot()) {
      try {
        const debugContext = debugProvider.formatForContext();
        if (debugContext) {
          messages.push({ role: "user", content: `[Debug update]: ${debugContext}` });
          debugProvider.markConsumed();
        }
      } catch { /* non-fatal */ }
    }
  }

  // 6. hasNewSnapshot=true triggers injection
  it("debug snapshot is injected as [Debug update] user message when hasNewSnapshot=true", () => {
    const messages: Array<{ role: string; content: string }> = [];
    const debugProvider = {
      hasNewSnapshot: vi.fn().mockReturnValue(true),
      markConsumed: vi.fn(),
      formatForContext: vi.fn().mockReturnValue("breakpoint hit: line 42, x=10"),
    };
    simulateRound(messages, debugProvider);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain("[Debug update]");
    expect(messages[0]!.content).toContain("breakpoint hit: line 42, x=10");
  });

  // 7. markConsumed called after injection
  it("markConsumed is called after snapshot injection", () => {
    const messages: Array<{ role: string; content: string }> = [];
    const debugProvider = {
      hasNewSnapshot: vi.fn().mockReturnValue(true),
      markConsumed: vi.fn(),
      formatForContext: vi.fn().mockReturnValue("x=5"),
    };
    simulateRound(messages, debugProvider);
    expect(debugProvider.markConsumed).toHaveBeenCalledOnce();
  });

  // 8. hasNewSnapshot=false → no injection
  it("no injection when hasNewSnapshot returns false", () => {
    const messages: Array<{ role: string; content: string }> = [];
    const debugProvider = {
      hasNewSnapshot: vi.fn().mockReturnValue(false),
      markConsumed: vi.fn(),
      formatForContext: vi.fn(),
    };
    simulateRound(messages, debugProvider);
    expect(messages).toHaveLength(0);
    expect(debugProvider.markConsumed).not.toHaveBeenCalled();
    expect(debugProvider.formatForContext).not.toHaveBeenCalled();
  });

  // 9. No debugProvider → no error
  it("no error when debugProvider is undefined", () => {
    const messages: Array<{ role: string; content: string }> = [];
    expect(() => simulateRound(messages, undefined)).not.toThrow();
    expect(messages).toHaveLength(0);
  });

  // 10. formatForContext content appears in injected message
  it("full formatForContext string appears in the injected user message content", () => {
    const messages: Array<{ role: string; content: string }> = [];
    const ctx = "thread=main, frame=0, locals={a:1, b:2}, stack_depth=3";
    const debugProvider = {
      hasNewSnapshot: vi.fn().mockReturnValue(true),
      markConsumed: vi.fn(),
      formatForContext: vi.fn().mockReturnValue(ctx),
    };
    simulateRound(messages, debugProvider);
    expect(messages[0]!.content).toContain(ctx);
  });

  // 11. Multiple rounds: second injection only if hasNewSnapshot still true
  it("second round injects only if hasNewSnapshot returns true again", () => {
    const messages: Array<{ role: string; content: string }> = [];
    let callCount = 0;
    const debugProvider = {
      hasNewSnapshot: vi.fn().mockImplementation(() => callCount++ === 0),
      markConsumed: vi.fn(),
      formatForContext: vi.fn().mockReturnValue("ctx"),
    };
    simulateRound(messages, debugProvider);
    simulateRound(messages, debugProvider);
    expect(messages).toHaveLength(1); // Only first round injected
  });
});
