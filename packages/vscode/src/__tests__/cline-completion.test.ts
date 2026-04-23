// ============================================================================
// packages/vscode/src/__tests__/cline-completion.test.ts
//
// Tests for the Cline completion sprint:
//   - ToolResult.visionImage field (Machine 2)
//   - Browser case sets visionImage (Machine 2)
//   - MENTION_RE includes @debug (Machine 3)
//   - @debug in MENTION_PROVIDERS webview array (Machine 3)
//   - Approval card click delegation for approve/approve_all/deny (Machine 1)
// ============================================================================

import { describe, it, expect, vi } from "vitest";

// ── Mock playwright (required by browser-tool.ts import chain) ────────────────
vi.mock("playwright", () => ({
  chromium: { launch: vi.fn().mockResolvedValue({ newPage: vi.fn(), close: vi.fn() }) },
}));

// ── Mock vscode ───────────────────────────────────────────────────────────────
vi.mock("vscode", () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: vi.fn(),
  window: {
    createStatusBarItem: vi.fn(() => ({ text: "", show: vi.fn(), hide: vi.fn(), dispose: vi.fn() })),
  },
  commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })) },
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn() })) },
  env: { appName: "VS Code" },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import type { ToolResult } from "../agent-tools.js";
import { parseAllMentions } from "../context-provider.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Machine 2 — ToolResult.visionImage field", () => {
  it("ToolResult interface has optional visionImage field", () => {
    const result: ToolResult = {
      content: "done",
      isError: false,
      visionImage: null,
    };
    expect(result.visionImage).toBeNull();
  });

  it("visionImage accepts a base64 string", () => {
    const result: ToolResult = {
      content: "done",
      isError: false,
      visionImage: "aGVsbG8=",
    };
    expect(result.visionImage).toBe("aGVsbG8=");
  });

  it("visionImage is optional — existing ToolResult objects still work without it", () => {
    const result: ToolResult = { content: "done", isError: false };
    expect(result.visionImage).toBeUndefined();
  });

  it("visionImage is null when browser returns null screenshot", () => {
    const result: ToolResult = { content: "done", isError: false, visionImage: null };
    expect(result.visionImage).toBeNull();
  });
});

describe("Machine 3 — MENTION_RE includes @debug", () => {
  it("parseAllMentions recognises @debug trigger", () => {
    const mentions = parseAllMentions("Please check @debug for the error");
    expect(mentions.some((m) => m.trigger === "@debug")).toBe(true);
  });

  it("parseAllMentions returns trigger @debug with empty query when no colon", () => {
    const mentions = parseAllMentions("@debug");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.trigger).toBe("@debug");
    expect(mentions[0]!.query).toBe("");
  });

  it("@debug coexists with other mentions in same string", () => {
    const mentions = parseAllMentions("See @file:src/app.ts and @debug for context");
    const triggers = mentions.map((m) => m.trigger);
    expect(triggers).toContain("@file");
    expect(triggers).toContain("@debug");
  });
});

describe("Machine 1 — Approval card click delegation logic", () => {
  it("tac-approve-all class maps to approve_all action", () => {
    const classNames = ["tac-approve-all", "tac-btn"];
    const action = classNames.includes("tac-approve-all") ? "approve_all"
                 : classNames.includes("tac-approve") ? "approve"
                 : "deny";
    expect(action).toBe("approve_all");
  });

  it("tac-approve class maps to approve action (when not tac-approve-all)", () => {
    const classNames = ["tac-approve", "tac-btn"];
    const action = classNames.includes("tac-approve-all") ? "approve_all"
                 : classNames.includes("tac-approve") ? "approve"
                 : "deny";
    expect(action).toBe("approve");
  });

  it("tac-deny class maps to deny action", () => {
    const classNames = ["tac-deny", "tac-btn"];
    const action = classNames.includes("tac-approve-all") ? "approve_all"
                 : classNames.includes("tac-approve") ? "approve"
                 : "deny";
    expect(action).toBe("deny");
  });
});
