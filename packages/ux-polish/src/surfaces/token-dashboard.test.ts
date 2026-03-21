/**
 * token-dashboard.test.ts — @dantecode/ux-polish
 */

import { describe, it, expect } from "vitest";
import { renderTokenDashboard } from "./token-dashboard.js";
import type { TokenUsageData } from "./token-dashboard.js";
import { ThemeEngine } from "../theme-engine.js";

const THEME = new ThemeEngine({ theme: "default", colors: false });

const BASE_DATA: TokenUsageData = {
  totalTokens: 12450,
  inputTokens: 8234,
  outputTokens: 4216,
  byTool: {
    Bash: { calls: 6, tokens: 3120 },
    Write: { calls: 4, tokens: 2890 },
    Read: { calls: 12, tokens: 4100 },
    Edit: { calls: 3, tokens: 2340 },
  },
  modelId: "grok/grok-3",
  contextWindow: 131072,
  contextUtilization: 0.48,
  sessionDurationMs: 754000,
};

describe("renderTokenDashboard", () => {
  it("renders box with all fields present", () => {
    const output = renderTokenDashboard(BASE_DATA, THEME);
    expect(output).toContain("Token Usage");
    expect(output).toContain("grok/grok-3");
    expect(output).toContain("12,450");
    expect(output).toContain("8,234");
    expect(output).toContain("4,216");
  });

  it("renders context utilization bar at correct percentage", () => {
    const output = renderTokenDashboard(BASE_DATA, THEME);
    expect(output).toContain("48%");
    expect(output).toContain("131,072");
  });

  it("sorts by-tool breakdown by token count descending", () => {
    const output = renderTokenDashboard(BASE_DATA, THEME);
    // Read (4100) should appear before Edit (2340)
    const readIdx = output.indexOf("Read");
    const editIdx = output.indexOf("Edit");
    expect(readIdx).toBeLessThan(editIdx);
  });

  it("returns no-data message for zero tokens", () => {
    const data: TokenUsageData = { ...BASE_DATA, totalTokens: 0 };
    const output = renderTokenDashboard(data, THEME);
    expect(output).toContain("No token data");
  });

  it("includes cost estimate when model pricing is known", () => {
    const output = renderTokenDashboard(BASE_DATA, THEME);
    expect(output).toContain("$");
    expect(output).toContain("Est. Cost");
  });

  it("theme colors affect output (no colors vs colors)", () => {
    const noColorOutput = renderTokenDashboard(BASE_DATA, new ThemeEngine({ colors: false }));
    const colorOutput = renderTokenDashboard(BASE_DATA, new ThemeEngine({ colors: true }));
    // Colored version should have ANSI escape codes
    expect(colorOutput).toContain("\x1b[");
    // No-color version should not have escape codes
    expect(noColorOutput).not.toContain("\x1b[");
  });
});
