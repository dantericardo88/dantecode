import { describe, expect, it } from "vitest";
import { GitEventRateLimiter } from "./rate-limiter.js";

describe("GitEventRateLimiter", () => {
  it("allows events up to the burst capacity", () => {
    const limiter = new GitEventRateLimiter({ maxPerSecond: 5, maxBurst: 5 });
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume("/repo")).toBe("allowed");
    }
  });

  it("blocks events when tokens are exhausted", () => {
    const limiter = new GitEventRateLimiter({ maxPerSecond: 2, maxBurst: 2 });
    limiter.consume("/repo");
    limiter.consume("/repo");
    expect(limiter.consume("/repo")).toBe("blocked");
  });

  it("returns warned instead of blocked in warnOnly mode", () => {
    const limiter = new GitEventRateLimiter({ maxPerSecond: 1, maxBurst: 1, warnOnly: true });
    limiter.consume("/repo");
    expect(limiter.consume("/repo")).toBe("warned");
  });

  it("isAllowed is non-destructive (does not consume tokens)", () => {
    const limiter = new GitEventRateLimiter({ maxPerSecond: 1, maxBurst: 1 });
    expect(limiter.isAllowed("/repo")).toBe(true);
    expect(limiter.isAllowed("/repo")).toBe(true); // Still true — no token consumed
    limiter.consume("/repo");
    expect(limiter.isAllowed("/repo")).toBe(false);
  });

  it("tracks per-repo stats independently", () => {
    const limiter = new GitEventRateLimiter({ maxPerSecond: 10, maxBurst: 10 });
    limiter.consume("/repo1");
    limiter.consume("/repo1");
    limiter.consume("/repo2");

    const stats1 = limiter.getRepoStats("/repo1");
    const stats2 = limiter.getRepoStats("/repo2");
    expect(stats1.allowed).toBe(2);
    expect(stats2.allowed).toBe(1);
  });

  it("global stats aggregates across repos", () => {
    const limiter = new GitEventRateLimiter({ maxPerSecond: 10, maxBurst: 10 });
    limiter.consume("/a");
    limiter.consume("/b");
    limiter.consume("/b");

    const global = limiter.getGlobalStats();
    expect(global.totalAllowed).toBe(3);
    expect(global.repos).toHaveLength(2);
  });

  it("reset clears one repo without affecting others", () => {
    const limiter = new GitEventRateLimiter({ maxPerSecond: 1, maxBurst: 1 });
    limiter.consume("/repo1");
    limiter.consume("/repo2");

    limiter.reset("/repo1");
    expect(limiter.getRepoStats("/repo1").allowed).toBe(0); // Reset
    expect(limiter.getRepoStats("/repo2").allowed).toBe(1); // Untouched
  });

  it("reset() with no argument clears all repos", () => {
    const limiter = new GitEventRateLimiter({ maxPerSecond: 5, maxBurst: 5 });
    limiter.consume("/repo1");
    limiter.consume("/repo2");
    limiter.reset();
    expect(limiter.getGlobalStats().repos).toHaveLength(0);
  });

  it("refills tokens over time", async () => {
    const limiter = new GitEventRateLimiter({ maxPerSecond: 100, maxBurst: 2 });
    limiter.consume("/repo");
    limiter.consume("/repo");
    // Exhausted
    expect(limiter.consume("/repo")).toBe("blocked");

    // Wait 50ms — at 100/s, should gain ~5 tokens
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(limiter.isAllowed("/repo")).toBe(true);
    expect(limiter.consume("/repo")).toBe("allowed");
  });
});
