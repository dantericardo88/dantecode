// ============================================================================
// packages/cli/src/__tests__/cost-tracker.test.ts
//
// Unit tests for the cost tracking, persistence, and formatting module.
//
// Design rules:
//   - Zero mocks — all tests call the real functions from cost-tracker.ts
//   - Persistence tests use a real temp directory (tmpdir())
//   - Every "blocked" formatting test checks for expected substrings
// ============================================================================

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CostEstimate } from "@dantecode/config-types";
import {
  PROVIDER_RATES,
  formatInlineCost,
  formatRateTable,
  formatCostDashboard,
  appendSessionCost,
  loadCostHistory,
  type SessionCostRecord,
} from "../cost-tracker.js";

// ---------------------------------------------------------------------------
// 1. formatInlineCost
// ---------------------------------------------------------------------------

describe("formatInlineCost", () => {
  it("formats non-zero last request and session total", () => {
    const result = formatInlineCost(0.0034, 0.12);
    expect(result).toContain("$0.0034");
    expect(result).toContain("session:");
    expect(result).toContain("$0.12");
  });

  it("returns empty string when lastRequestUsd is 0 (Ollama / local)", () => {
    expect(formatInlineCost(0, 0)).toBe("");
    expect(formatInlineCost(0, 5.0)).toBe(""); // zero request even if session somehow non-zero
  });

  it("formats very small fractional costs with 6 decimal places", () => {
    const result = formatInlineCost(0.000012, 0.000012);
    expect(result).toContain("$0.000012");
  });
});

// ---------------------------------------------------------------------------
// 2. PROVIDER_RATES
// ---------------------------------------------------------------------------

describe("PROVIDER_RATES", () => {
  it("contains entries for all 6 provider keys", () => {
    const keys = Object.keys(PROVIDER_RATES);
    expect(keys).toContain("grok");
    expect(keys).toContain("grok_capable");
    expect(keys).toContain("anthropic");
    expect(keys).toContain("openai");
    expect(keys).toContain("google");
    expect(keys).toContain("groq");
    expect(keys).toContain("ollama");
  });

  it("Ollama has zero input and output rates", () => {
    expect(PROVIDER_RATES["ollama"]!.inputPerMTok).toBe(0);
    expect(PROVIDER_RATES["ollama"]!.outputPerMTok).toBe(0);
  });

  it("Anthropic output rate is 5x input rate", () => {
    const a = PROVIDER_RATES["anthropic"]!;
    expect(a.outputPerMTok / a.inputPerMTok).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 3. formatRateTable
// ---------------------------------------------------------------------------

describe("formatRateTable", () => {
  it("returns a non-empty string", () => {
    const result = formatRateTable();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes all provider names", () => {
    const result = formatRateTable();
    expect(result).toContain("Groq");
    expect(result).toContain("Anthropic");
    expect(result).toContain("OpenAI");
    expect(result).toContain("Google");
    expect(result).toContain("Ollama");
  });

  it("shows zero cost for Ollama (free)", () => {
    const result = formatRateTable();
    expect(result).toContain("free");
  });
});

// ---------------------------------------------------------------------------
// 4. formatCostDashboard
// ---------------------------------------------------------------------------

function makeCostEstimate(overrides: Partial<CostEstimate> = {}): CostEstimate {
  return {
    sessionTotalUsd: 0,
    lastRequestUsd: 0,
    modelTier: "fast",
    tokensUsedSession: 0,
    budgetExceeded: false,
    ...overrides,
  };
}

describe("formatCostDashboard", () => {
  it("shows session total and last request cost", () => {
    const estimate = makeCostEstimate({ sessionTotalUsd: 0.12, lastRequestUsd: 0.0034 });
    const result = formatCostDashboard(estimate, "anthropic", [], undefined);
    expect(result).toContain("$0.12");
    expect(result).toContain("$0.0034");
    expect(result).toContain("anthropic");
  });

  it("shows no-budget message when budgetSessionUsd is undefined", () => {
    const estimate = makeCostEstimate();
    const result = formatCostDashboard(estimate, "grok", [], undefined);
    expect(result.toLowerCase()).toMatch(/no session budget/);
  });

  it("shows budget bar and percentage when budget is configured", () => {
    const estimate = makeCostEstimate({ sessionTotalUsd: 0.12 });
    const result = formatCostDashboard(estimate, "anthropic", [], 0.15);
    // 0.12 / 0.15 = 80%
    expect(result).toContain("80%");
    expect(result).toContain("$0.15");
  });

  it("shows warning text when budget is at 80% or more", () => {
    const estimate = makeCostEstimate({ sessionTotalUsd: 0.12 });
    const result = formatCostDashboard(estimate, "anthropic", [], 0.15);
    expect(result).toContain("Warning");
  });

  it("shows recent sessions when history is non-empty", () => {
    const history: SessionCostRecord[] = [
      {
        sessionId: "abc",
        timestamp: "2026-04-10T12:00:00.000Z",
        provider: "anthropic",
        totalCostUsd: 0.34,
        totalTokens: 112000,
        requestCount: 8,
        projectRoot: "/tmp/test",
      },
    ];
    const estimate = makeCostEstimate();
    const result = formatCostDashboard(estimate, "anthropic", history, undefined);
    expect(result).toContain("2026-04-10");
    expect(result).toContain("$0.34");
  });

  it("shows graceful empty-history message when history is empty", () => {
    const estimate = makeCostEstimate();
    const result = formatCostDashboard(estimate, "groq", [], undefined);
    expect(result.toLowerCase()).toMatch(/no session history/);
  });
});

// ---------------------------------------------------------------------------
// 5. appendSessionCost / loadCostHistory
// ---------------------------------------------------------------------------

describe("appendSessionCost / loadCostHistory", () => {
  it("persists a record and reads it back correctly", async () => {
    const dir = join(tmpdir(), `cost-test-${Date.now()}`);
    const record: SessionCostRecord = {
      sessionId: "test-session-1",
      timestamp: "2026-04-11T01:00:00.000Z",
      provider: "anthropic",
      totalCostUsd: 0.12,
      totalTokens: 38400,
      requestCount: 12,
      projectRoot: dir,
    };
    await appendSessionCost(record);
    const loaded = await loadCostHistory(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.sessionId).toBe("test-session-1");
    expect(loaded[0]!.totalCostUsd).toBe(0.12);
    expect(loaded[0]!.provider).toBe("anthropic");
  });

  it("appends multiple records without overwriting (JSONL format)", async () => {
    const dir = join(tmpdir(), `cost-test-${Date.now()}`);
    for (let i = 0; i < 3; i++) {
      await appendSessionCost({
        sessionId: `session-${i}`,
        timestamp: new Date().toISOString(),
        provider: "grok",
        totalCostUsd: 0.01 * (i + 1),
        totalTokens: 1000 * (i + 1),
        requestCount: i + 1,
        projectRoot: dir,
      });
    }
    const loaded = await loadCostHistory(dir);
    expect(loaded).toHaveLength(3);
    expect(loaded[0]!.sessionId).toBe("session-0");
    expect(loaded[2]!.sessionId).toBe("session-2");
  });

  it("returns empty array when history file does not exist", async () => {
    const dir = join(tmpdir(), `cost-test-nonexistent-${Date.now()}`);
    const loaded = await loadCostHistory(dir);
    expect(loaded).toEqual([]);
  });
});
