// ============================================================================
// @dantecode/cli — repl-tui.test.ts
// Tests for TUI utility functions exported from repl.ts.
// These are isolated from the REPL startup side-effects.
// ============================================================================

import { describe, expect, it, vi } from "vitest";

// Mock heavy dependencies before importing repl.ts
vi.mock("@dantecode/dante-sandbox", () => ({
  DanteSandbox: {
    setup: vi.fn(),
    teardown: vi.fn(),
    execute: vi.fn(),
  },
  globalApprovalEngine: {
    getPendingAction: vi.fn(() => null),
    approve: vi.fn(),
    deny: vi.fn(),
    addRule: vi.fn(),
  },
}));

vi.mock("@dantecode/ux-polish", async () => {
  const actual = await vi.importActual<object>("@dantecode/ux-polish");
  return {
    ...actual,
    RichRenderer: vi.fn().mockImplementation(() => ({
      render: vi.fn(() => ({ rendered: false, output: "" })),
    })),
    ProgressOrchestrator: vi.fn().mockImplementation(() => ({
      startProgress: vi.fn(),
      completeProgress: vi.fn(),
      renderOne: vi.fn(() => ""),
      remove: vi.fn(),
    })),
  };
});

vi.mock("./agent-loop.js", () => ({
  runAgentLoop: vi.fn(),
}));

vi.mock("./lazy-init.js", () => ({
  getOrInitGaslight: vi.fn(() => null),
  tryAutoInit: vi.fn(() => null),
}));

vi.mock("./session-report.js", () => ({
  generateSessionReport: vi.fn(() => null),
}));

import { buildPromptString } from "./repl.js";

describe("buildPromptString (C4)", () => {
  it("returns '> ' when utilPct is 0", () => {
    expect(buildPromptString(0)).toBe("> ");
  });

  it("returns '> ' when utilPct is 49", () => {
    expect(buildPromptString(49)).toBe("> ");
  });

  it("returns gauge string when utilPct is 50", () => {
    const result = buildPromptString(50);
    expect(result).toContain("50%");
    expect(result).toContain(">");
    expect(result).toMatch(/█/);
  });

  it("returns gauge string when utilPct is 72", () => {
    const result = buildPromptString(72);
    expect(result).toContain("72%");
    expect(result).toContain("█");
    expect(result).toContain("░");
  });

  it("returns fully filled gauge at 100%", () => {
    const result = buildPromptString(100);
    expect(result).toContain("100%");
    expect(result).toContain("█".repeat(5));
    expect(result).not.toContain("░");
  });
});
