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

  it("row visible width is the same with and without colors (ANSI-aware padding)", () => {
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    // Get data-row lines (contain │ but not ╭ or ╰)
    const rowFilter = (l: string) => l.includes("│") && !l.includes("╭") && !l.includes("╰");
    const noColorRows = renderTokenDashboard(BASE_DATA, new ThemeEngine({ colors: false }))
      .split("\n")
      .filter(rowFilter);
    const colorRows = renderTokenDashboard(BASE_DATA, new ThemeEngine({ colors: true }))
      .split("\n")
      .filter(rowFilter);
    for (let i = 0; i < Math.min(noColorRows.length, colorRows.length); i++) {
      const noColorWidth = noColorRows[i]!.length; // no ANSI, raw = visible
      const colorVisibleWidth = stripAnsi(colorRows[i]!).length;
      expect(colorVisibleWidth).toBe(noColorWidth);
    }
  });

  it("shows cost estimate for anthropic/claude-sonnet-4-6 model", () => {
    const data: TokenUsageData = { ...BASE_DATA, modelId: "anthropic/claude-sonnet-4-6" };
    const output = renderTokenDashboard(data, THEME);
    expect(output).toContain("Est. Cost");
    expect(output).toContain("$");
  });

  it("shows cost estimate for date-suffixed haiku model ID", () => {
    const data: TokenUsageData = { ...BASE_DATA, modelId: "anthropic/claude-haiku-4-5-20251001" };
    const output = renderTokenDashboard(data, THEME);
    expect(output).toContain("Est. Cost");
    expect(output).toContain("$");
  });

  it("all box lines have identical visible width", () => {
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    const data: TokenUsageData = {
      ...BASE_DATA,
      byTool: { Read: { calls: 2, tokens: 500 } },
    };
    const output = renderTokenDashboard(data, THEME);
    const rawLines = output.trimEnd().split("\n");
    const widths = rawLines.map((l) => stripAnsi(l).length);
    const unique = new Set(widths);
    expect(unique.size).toBe(1);
  });
});
