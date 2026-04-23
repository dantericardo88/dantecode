import { describe, expect, it, vi } from "vitest";

// Minimal vscode mock — only what the status-bar module imports at the top level
vi.mock("vscode", () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: vi.fn((id: string) => ({ id })),
  window: {
    createStatusBarItem: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
    })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

vi.mock("@dantecode/core", () => ({
  DEFAULT_MODEL_ID: "grok/grok-3",
}));

import { formatStatusBarText, getStatusBarColor, type StatusBarState } from "./status-bar.js";

/**
 * Creates a minimal StatusBarState for testing the pure utility functions.
 * The `item` field is stubbed since formatStatusBarText and getStatusBarColor
 * never access it.
 */
function makeState(overrides: Partial<Omit<StatusBarState, "item">> = {}): StatusBarState {
  return {
    item: {} as StatusBarState["item"],
    currentModel: "grok/grok-3",
    gateStatus: "none",
    sandboxEnabled: false,
    modelTier: "fast",
    sessionCostUsd: 0,
    contextPercent: 0,
    activeTasks: 0,
    hasError: false,
    indexState: "none" as const,
    indexChunkCount: 0,
    ...overrides,
  };
}

// ─── formatStatusBarText ─────────────────────────────────────────────────────

describe("formatStatusBarText", () => {
  it("shows model name with provider prefix stripped", () => {
    const text = formatStatusBarText(makeState({ currentModel: "grok/grok-3" }));
    expect(text).toBe("DanteCode | grok-3");
  });

  it("handles model names without a provider prefix", () => {
    const text = formatStatusBarText(makeState({ currentModel: "llama3" }));
    expect(text).toBe("DanteCode | llama3");
  });

  it("includes context percent when > 0", () => {
    const text = formatStatusBarText(makeState({ contextPercent: 23 }));
    expect(text).toBe("DanteCode | grok-3 | 23% ctx");
  });

  it("includes active tasks when > 0", () => {
    const text = formatStatusBarText(makeState({ activeTasks: 2 }));
    expect(text).toBe("DanteCode | grok-3 | 2 tasks");
  });

  it("uses singular 'task' when there is exactly 1 active task", () => {
    const text = formatStatusBarText(makeState({ activeTasks: 1 }));
    expect(text).toBe("DanteCode | grok-3 | 1 task");
  });

  it("shows all segments when context and tasks are both active", () => {
    const text = formatStatusBarText(
      makeState({
        currentModel: "anthropic/claude-sonnet-4-20250514",
        contextPercent: 55,
        activeTasks: 3,
      }),
    );
    expect(text).toBe("DanteCode | claude-sonnet-4-20250514 | 55% ctx | 3 tasks");
  });

  it("omits context and task segments when both are zero", () => {
    const text = formatStatusBarText(makeState({ contextPercent: 0, activeTasks: 0 }));
    expect(text).toBe("DanteCode | grok-3");
  });
});

// ─── getStatusBarColor ───────────────────────────────────────────────────────

describe("getStatusBarColor", () => {
  it("returns green when healthy (no errors, low context, gate none)", () => {
    expect(getStatusBarColor(makeState())).toBe("green");
  });

  it("returns green when gate has passed and context is low", () => {
    expect(getStatusBarColor(makeState({ gateStatus: "passed", contextPercent: 50 }))).toBe(
      "green",
    );
  });

  it("returns yellow when context exceeds 75%", () => {
    expect(getStatusBarColor(makeState({ contextPercent: 76 }))).toBe("yellow");
  });

  it("returns yellow at exactly 76% (boundary just above 75%)", () => {
    expect(getStatusBarColor(makeState({ contextPercent: 76 }))).toBe("yellow");
  });

  it("returns green at exactly 75% (boundary)", () => {
    expect(getStatusBarColor(makeState({ contextPercent: 75 }))).toBe("green");
  });

  it("returns yellow when gate is pending", () => {
    expect(getStatusBarColor(makeState({ gateStatus: "pending" }))).toBe("yellow");
  });

  it("returns red when hasError is true", () => {
    expect(getStatusBarColor(makeState({ hasError: true }))).toBe("red");
  });

  it("returns red when gate has failed", () => {
    expect(getStatusBarColor(makeState({ gateStatus: "failed" }))).toBe("red");
  });

  it("returns red when error takes priority over yellow context", () => {
    expect(getStatusBarColor(makeState({ hasError: true, contextPercent: 80 }))).toBe("red");
  });

  it("returns red when gate failed takes priority over high context", () => {
    expect(getStatusBarColor(makeState({ gateStatus: "failed", contextPercent: 90 }))).toBe("red");
  });
});
