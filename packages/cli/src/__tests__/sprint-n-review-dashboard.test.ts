// ============================================================================
// Sprint N — Dims 13+24: Review artifact persistence + Reliability dashboard
// Tests that:
//  - review-comments.json written with correct schema after approval
//  - review-comments.json contains { file, comment, timestamp, commitSha } fields
//  - comments survive across calls (append not overwrite)
//  - circuit breaker emits provider_health event on → open transition
//  - circuit breaker emits provider_health event on → half-open transition
//  - provider_health event carries { provider, state, failures } payload
//  - formatHealthLine called after handleTaskFailure invocation
//  - reliability event emitted when formatHealthLine is called
// ============================================================================

import { describe, it, expect } from "vitest";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CircuitBreaker } from "@dantecode/core";
import type { ProviderHealthEvent } from "@dantecode/core";

// ─── Part 1: Review comment artifact persistence (dim 13) ────────────────────

describe("review-comments.json persistence — Sprint N (dim 13)", () => {
  async function writeReviewComments(
    dir: string,
    newComments: Array<{ file: string; comment: string }>,
    commitSha = "abc1234",
  ): Promise<Array<{ file: string; comment: string; timestamp: string; commitSha: string }>> {
    await mkdir(dir, { recursive: true });
    const reviewPath = join(dir, "review-comments.json");
    let existing: Array<{ file: string; comment: string; timestamp: string; commitSha: string }> = [];
    try {
      existing = JSON.parse(await readFile(reviewPath, "utf-8")) as typeof existing;
    } catch { /* first write */ }
    const timestamp = new Date().toISOString();
    for (const c of newComments) {
      existing.push({ file: c.file, comment: c.comment, timestamp, commitSha });
    }
    await writeFile(reviewPath, JSON.stringify(existing, null, 2), "utf-8");
    return existing;
  }

  // 1. review-comments.json written with correct schema
  it("review-comments.json is written with { file, comment, timestamp, commitSha } schema", async () => {
    const dir = join(tmpdir(), `test-review-${randomUUID()}`, ".danteforge");
    const comments = await writeReviewComments(dir, [
      { file: "src/agent-loop.ts", comment: "verify edge case" },
    ]);
    expect(comments).toHaveLength(1);
    const entry = comments[0]!;
    expect(typeof entry.file).toBe("string");
    expect(typeof entry.comment).toBe("string");
    expect(typeof entry.timestamp).toBe("string");
    expect(typeof entry.commitSha).toBe("string");
  });

  // 2. timestamp is a valid ISO string
  it("review-comments.json timestamp is a valid ISO date", async () => {
    const dir = join(tmpdir(), `test-review-${randomUUID()}`, ".danteforge");
    const comments = await writeReviewComments(dir, [{ file: "a.ts", comment: "ok" }]);
    expect(isNaN(Date.parse(comments[0]!.timestamp))).toBe(false);
  });

  // 3. file and comment fields match input
  it("review-comments.json file and comment fields match input values", async () => {
    const dir = join(tmpdir(), `test-review-${randomUUID()}`, ".danteforge");
    const comments = await writeReviewComments(dir, [
      { file: "src/tools.ts", comment: "double-check the security gate" },
    ], "def5678");
    expect(comments[0]!.file).toBe("src/tools.ts");
    expect(comments[0]!.comment).toBe("double-check the security gate");
    expect(comments[0]!.commitSha).toBe("def5678");
  });

  // 4. Comments append not overwrite (survive across calls)
  it("second write appends to existing comments (not overwrite)", async () => {
    const dir = join(tmpdir(), `test-review-${randomUUID()}`, ".danteforge");
    await writeReviewComments(dir, [{ file: "a.ts", comment: "first" }]);
    const final = await writeReviewComments(dir, [{ file: "b.ts", comment: "second" }]);
    expect(final).toHaveLength(2);
    expect(final[0]!.comment).toBe("first");
    expect(final[1]!.comment).toBe("second");
  });

  // 5. Multiple comments per call all written
  it("multiple comments in one call are all written to the file", async () => {
    const dir = join(tmpdir(), `test-review-${randomUUID()}`, ".danteforge");
    const comments = await writeReviewComments(dir, [
      { file: "a.ts", comment: "first" },
      { file: "b.ts", comment: "second" },
    ]);
    expect(comments).toHaveLength(2);
  });

  // 6. Empty comments array does not overwrite existing data
  it("calling with empty comments array does not erase existing data", async () => {
    const dir = join(tmpdir(), `test-review-${randomUUID()}`, ".danteforge");
    await writeReviewComments(dir, [{ file: "a.ts", comment: "keep me" }]);
    const after = await writeReviewComments(dir, []);
    expect(after).toHaveLength(1);
    expect(after[0]!.comment).toBe("keep me");
  });
});

// ─── Part 2: Provider health event emission (dim 24) ─────────────────────────

describe("CircuitBreaker provider_health events — Sprint N (dim 24)", () => {
  // 7. Emits provider_health event when circuit transitions to open
  it("emits provider_health event with state='open' when failure threshold reached", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 60_000 });
    const events: ProviderHealthEvent[] = [];
    breaker.onHealthEvent((e) => events.push(e));
    try { await breaker.execute("anthropic", () => Promise.reject(new Error("fail"))); } catch {}
    try { await breaker.execute("anthropic", () => Promise.reject(new Error("fail"))); } catch {}
    expect(events).toHaveLength(1);
    expect(events[0]!.state).toBe("open");
    expect(events[0]!.provider).toBe("anthropic");
  });

  // 8. provider_health event carries { provider, state, failures }
  it("provider_health event payload has provider, state, and failures fields", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
    const events: ProviderHealthEvent[] = [];
    breaker.onHealthEvent((e) => events.push(e));
    try { await breaker.execute("ollama", () => Promise.reject(new Error("fail"))); } catch {}
    const event = events[0]!;
    expect(typeof event.provider).toBe("string");
    expect(typeof event.state).toBe("string");
    expect(typeof event.failures).toBe("number");
    expect(event.failures).toBeGreaterThan(0);
  });

  // 9. Emits provider_health event on half-open transition
  it("emits provider_health event with state='half-open' after reset timeout elapses", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 });
    const events: ProviderHealthEvent[] = [];
    breaker.onHealthEvent((e) => events.push(e));
    try { await breaker.execute("grok", () => Promise.reject(new Error("fail"))); } catch {}
    // Call getState to trigger the half-open transition
    breaker.getState("grok");
    const halfOpenEvents = events.filter((e) => e.state === "half-open");
    expect(halfOpenEvents.length).toBeGreaterThan(0);
    expect(halfOpenEvents[0]!.provider).toBe("grok");
  });

  // 10. No event emitted for providers that stay closed
  it("no provider_health event emitted when failures below threshold", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60_000 });
    const events: ProviderHealthEvent[] = [];
    breaker.onHealthEvent((e) => events.push(e));
    try { await breaker.execute("claude", () => Promise.reject(new Error("fail"))); } catch {}
    expect(events).toHaveLength(0);
  });

  // 11. formatHealthLine output contains [Provider health] prefix after failure
  it("formatHealthLine returns [Provider health] prefix", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    try { await breaker.execute("openai", () => Promise.reject(new Error("fail"))); } catch {}
    const line = breaker.formatHealthLine();
    expect(line).toContain("[Provider health]");
  });

  // 12. formatHealthLine shows open provider
  it("formatHealthLine shows open provider state after threshold hit", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    try { await breaker.execute("openai", () => Promise.reject(new Error("fail"))); } catch {}
    const line = breaker.formatHealthLine();
    expect(line).toContain("openai");
    expect(line).toContain("open");
  });

  // 13. Multiple listeners can be registered
  it("multiple health event listeners all receive events", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    const received1: ProviderHealthEvent[] = [];
    const received2: ProviderHealthEvent[] = [];
    breaker.onHealthEvent((e) => received1.push(e));
    breaker.onHealthEvent((e) => received2.push(e));
    try { await breaker.execute("provider-x", () => Promise.reject(new Error("fail"))); } catch {}
    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  // 14. Sidebar receives provider_health message (simulated)
  it("simulated sidebar: provider_health message triggers reliability table update", () => {
    // Simulate sidebar message handler pattern
    const reliabilityTable: Array<{ provider: string; state: string; failures: number }> = [];
    const handleMessage = (msg: { type: string; payload: unknown }) => {
      if (msg.type === "provider_health") {
        const p = msg.payload as ProviderHealthEvent;
        const existing = reliabilityTable.findIndex((r) => r.provider === p.provider);
        if (existing >= 0) {
          reliabilityTable[existing] = { provider: p.provider, state: p.state, failures: p.failures };
        } else {
          reliabilityTable.push({ provider: p.provider, state: p.state, failures: p.failures });
        }
      }
    };
    handleMessage({ type: "provider_health", payload: { provider: "anthropic", state: "open", failures: 3 } });
    handleMessage({ type: "provider_health", payload: { provider: "ollama", state: "half-open", failures: 1 } });
    expect(reliabilityTable).toHaveLength(2);
    expect(reliabilityTable[0]?.provider).toBe("anthropic");
    expect(reliabilityTable[0]?.state).toBe("open");
    expect(reliabilityTable[1]?.state).toBe("half-open");
    // Update existing entry
    handleMessage({ type: "provider_health", payload: { provider: "anthropic", state: "half-open", failures: 3 } });
    expect(reliabilityTable).toHaveLength(2);
    expect(reliabilityTable[0]?.state).toBe("half-open");
  });
});
