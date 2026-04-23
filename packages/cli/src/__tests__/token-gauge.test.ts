// packages/cli/src/__tests__/token-gauge.test.ts
import { describe, it, expect } from "vitest";
import {
  renderTokenGauge,
  renderTokenSummary,
  TokenGauge,
  type TokenUsageSnapshot,
} from "../token-gauge.js";

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\[[0-9]*[A-Z]/g, "");
}

const baseUsage: TokenUsageSnapshot = {
  sessionTokens: 5_000,
  contextWindowTokens: 128_000,
  contextUsedTokens: 12_400,
};

describe("renderTokenGauge", () => {
  it("includes a progress bar", () => {
    const out = renderTokenGauge(baseUsage);
    expect(stripAnsi(out)).toMatch(/\[█+░*\]/);
  });

  it("shows context used/total in K format", () => {
    const out = stripAnsi(renderTokenGauge(baseUsage));
    expect(out).toContain("12.4K/128.0K");
  });

  it("shows input/output tokens when provided", () => {
    const usage = { ...baseUsage, lastInputTokens: 2100, lastOutputTokens: 800 };
    const out = stripAnsi(renderTokenGauge(usage));
    expect(out).toContain("↑2.1K");
    expect(out).toContain("↓800"); // sub-1000 rendered without K suffix
  });

  it("shows request cost when lastRequestCostUsd > 0", () => {
    const usage = { ...baseUsage, lastRequestCostUsd: 0.0023 };
    const out = stripAnsi(renderTokenGauge(usage));
    expect(out).toContain("$0.0023");
  });

  it("shows session total cost when no request cost", () => {
    const usage = { ...baseUsage, sessionCostUsd: 0.12 };
    const out = stripAnsi(renderTokenGauge(usage));
    expect(out).toContain("$0.1200");
  });

  it("omits cost section when cost is zero", () => {
    const usage = { ...baseUsage, lastRequestCostUsd: 0 };
    const out = stripAnsi(renderTokenGauge(usage));
    expect(out).not.toContain("$");
  });

  it("uses green bar when context < 60%", () => {
    const usage = { ...baseUsage, contextUsedTokens: 10_000, contextWindowTokens: 128_000 };
    const out = renderTokenGauge(usage);
    expect(out).toContain("\x1b[32m"); // GREEN
  });

  it("uses red bar when context > 85%", () => {
    const usage = { ...baseUsage, contextUsedTokens: 115_000, contextWindowTokens: 128_000 };
    const out = renderTokenGauge(usage);
    expect(out).toContain("\x1b[31m"); // RED
  });

  it("handles zero context window without division by zero", () => {
    const usage = { ...baseUsage, contextWindowTokens: 0, contextUsedTokens: 0 };
    expect(() => renderTokenGauge(usage)).not.toThrow();
  });
});

describe("renderTokenSummary", () => {
  it("contains Token Usage header", () => {
    const out = stripAnsi(renderTokenSummary(baseUsage));
    expect(out).toContain("Token Usage");
  });

  it("shows session token count", () => {
    const out = stripAnsi(renderTokenSummary(baseUsage));
    expect(out).toContain("5.0K");
  });

  it("shows percentage in context line", () => {
    const usage = { ...baseUsage, contextUsedTokens: 64_000, contextWindowTokens: 128_000 };
    const out = stripAnsi(renderTokenSummary(usage));
    expect(out).toContain("50%");
  });

  it("shows last request breakdown when provided", () => {
    const usage = { ...baseUsage, lastInputTokens: 3000, lastOutputTokens: 500 };
    const out = stripAnsi(renderTokenSummary(usage));
    expect(out).toContain("↑3.0K");
    expect(out).toContain("↓500"); // sub-1000 rendered without K suffix
  });

  it("shows session cost when provided", () => {
    const usage = { ...baseUsage, sessionCostUsd: 0.45 };
    const out = stripAnsi(renderTokenSummary(usage));
    expect(out).toContain("$0.45");
  });
});

describe("TokenGauge", () => {
  it("update() merges partial snapshot", () => {
    const gauge = new TokenGauge();
    gauge.update({ contextUsedTokens: 5000, contextWindowTokens: 128_000 }, false);
    expect(gauge.snapshot.contextUsedTokens).toBe(5000);
  });

  it("updateRound() accumulates session tokens", () => {
    const gauge = new TokenGauge();
    gauge.updateRound({ inputTokens: 1000, outputTokens: 500 });
    expect(gauge.snapshot.sessionTokens).toBe(1500);
    gauge.updateRound({ inputTokens: 500, outputTokens: 200 });
    expect(gauge.snapshot.sessionTokens).toBe(2200);
  });

  it("updateRound() sets lastInputTokens and lastOutputTokens", () => {
    const gauge = new TokenGauge();
    gauge.updateRound({ inputTokens: 2000, outputTokens: 800 });
    expect(gauge.snapshot.lastInputTokens).toBe(2000);
    expect(gauge.snapshot.lastOutputTokens).toBe(800);
  });

  it("updateContext() sets context window fields", () => {
    const gauge = new TokenGauge();
    gauge.updateContext(15_000, 32_000);
    expect(gauge.snapshot.contextUsedTokens).toBe(15_000);
    expect(gauge.snapshot.contextWindowTokens).toBe(32_000);
  });

  it("snapshot returns independent copy", () => {
    const gauge = new TokenGauge();
    const snap1 = gauge.snapshot;
    gauge.updateContext(5000, 128_000);
    expect(snap1.contextUsedTokens).toBe(0); // original unchanged
  });
});
