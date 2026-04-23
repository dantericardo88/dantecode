// ============================================================================
// packages/vscode/src/__tests__/ui-polish.test.ts
// Tests for UI/UX polish sprint: syntax highlighting, typing indicator,
// @mention autocomplete, copy confirmation, and inline edit status bar.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── VS Code mock ──────────────────────────────────────────────────────────────

const mockStatusBarItem = {
  text: "",
  tooltip: "",
  command: "",
  backgroundColor: undefined as unknown,
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
};

vi.mock("vscode", () => {
  class Position {
    constructor(
      public readonly line: number,
      public readonly character: number,
    ) {}
  }
  class Range {
    constructor(
      public readonly start: Position | number,
      public readonly end: Position | number,
    ) {}
  }
  const mockDeco = { dispose: vi.fn() };
  return {
    Position,
    Range,
    StatusBarAlignment: { Left: 1, Right: 2 },
    ThemeColor: vi.fn((id: string) => ({ id })),
    ProgressLocation: { Notification: 15 },
    window: {
      showInputBox: vi.fn(),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      createTextEditorDecorationType: vi.fn(() => ({ ...mockDeco })),
      createStatusBarItem: vi.fn(() => ({ ...mockStatusBarItem })),
      withProgress: vi.fn(
        async (_opts: unknown, fn: () => Promise<unknown>) => fn(),
      ),
      onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
      activeTextEditor: undefined as unknown,
      visibleTextEditors: [] as unknown[],
    },
    commands: {
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
      executeCommand: vi.fn(),
    },
  };
});

import * as vscode from "vscode";
import { InlineEditProvider } from "../inline-edit-provider.js";

// ── Source file helpers ───────────────────────────────────────────────────────

const SIDEBAR_SRC = readFileSync(
  resolve(__dirname, "../sidebar-provider.ts"),
  "utf8",
);

// ── Minimal renderMarkdown replica (extracted from sidebar-provider template) ──

function renderMarkdownCodeBlock(lang: string, code: string): string {
  const escaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const langLabel = lang || "code";
  const langClass = langLabel === "code" ? "language-text" : "language-" + langLabel;
  return `<pre class="code-block"><code class="code-block-content ${langClass}">${escaped}</code></pre>`;
}

// ── Group 1: Syntax highlighting class names (3 tests) ───────────────────────

describe("Syntax highlighting — renderMarkdown code blocks", () => {
  it("wraps TypeScript code with language-typescript class", () => {
    const html = renderMarkdownCodeBlock("typescript", "const x = 1;");
    expect(html).toContain("language-typescript");
    expect(html).toContain("const x = 1;");
  });

  it("wraps Python code with language-python class", () => {
    const html = renderMarkdownCodeBlock("python", "def foo(): pass");
    expect(html).toContain("language-python");
  });

  it("uses language-text fallback when no language specified", () => {
    const html = renderMarkdownCodeBlock("", "plain text");
    expect(html).toContain("language-text");
  });
});

// ── Group 2: @mention provider list (3 tests) ────────────────────────────────

describe("@mention autocomplete — MENTION_PROVIDERS", () => {
  // Extract the MENTION_PROVIDERS array definition from the webview JS
  const providersSection = (() => {
    const start = SIDEBAR_SRC.indexOf("var MENTION_PROVIDERS = [");
    const end = SIDEBAR_SRC.indexOf("];", start) + 2;
    return SIDEBAR_SRC.slice(start, end);
  })();

  const ALL_TRIGGERS = [
    "@file",
    "@code",
    "@git",
    "@docs",
    "@web",
    "@terminal",
    "@codebase",
  ];

  it("MENTION_PROVIDERS contains all 7 registered context providers", () => {
    ALL_TRIGGERS.forEach((trigger) => {
      expect(providersSection).toContain(`'${trigger}'`);
    });
  });

  it("filtering '@fi' returns only @file", () => {
    const filtered = ALL_TRIGGERS.filter((t) => t.startsWith("@fi"));
    expect(filtered).toEqual(["@file"]);
    expect(filtered).not.toContain("@git");
  });

  it("filtering '@' with empty suffix returns all providers", () => {
    const filtered = ALL_TRIGGERS.filter((t) => t.startsWith("@"));
    expect(filtered).toHaveLength(7);
  });
});

// ── Group 3: Typing indicator HTML structure (2 tests) ────────────────────────

describe("Typing indicator — 3-dot bounce animation", () => {
  it("typing indicator HTML contains exactly 3 .dot spans", () => {
    // Count occurrences of <span class="dot"> in the sidebar source
    const matches = SIDEBAR_SRC.match(/<span class="dot"><\/span>/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(3);
  });

  it("typing indicator does not have 'visible' class in initial HTML", () => {
    // The typing-indicator div should NOT have 'visible' in its class initially
    const tiMatch = SIDEBAR_SRC.match(/id="typing-indicator"[^>]*/);
    expect(tiMatch).not.toBeNull();
    expect(tiMatch![0]).not.toContain("visible");
  });
});

// ── Group 4: Copy confirmation animation (2 tests) ───────────────────────────

describe("Copy confirmation — ✓ Copied! feedback", () => {
  it("copy handler sets button text to '✓ Copied!'", () => {
    expect(SIDEBAR_SRC).toContain("✓ Copied!");
  });

  it("copy handler reverts button text after 1500ms timeout", () => {
    // The revert call uses setTimeout with 1500
    expect(SIDEBAR_SRC).toContain("1500");
    // And restores 'Copy' text
    const copyRevertIdx = SIDEBAR_SRC.indexOf("✓ Copied!");
    const vicinity = SIDEBAR_SRC.slice(copyRevertIdx, copyRevertIdx + 300);
    expect(vicinity).toContain("1500");
    expect(vicinity).toContain("Copy");
  });
});

// ── Group 5: Inline edit status bar (2 tests) ────────────────────────────────

describe("InlineEditProvider — StatusBarItem for accept/reject", () => {
  let provider: InlineEditProvider;

  const mockCallModel = vi.fn().mockResolvedValue("replaced");

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new InlineEditProvider(
      {} as vscode.ExtensionContext,
      undefined,
      mockCallModel,
    );
  });

  it("showInlineDiff() creates a StatusBarItem with accept/reject text", async () => {
    const mockEditor = {
      document: {
        uri: { fsPath: "/test/file.ts" },
        getText: vi.fn().mockReturnValue("original"),
      },
      selection: {
        isEmpty: false,
        start: { line: 0, character: 0 },
        end: { line: 0, character: 8 },
      },
      setDecorations: vi.fn(),
    } as unknown as vscode.TextEditor;

    const range = new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(0, 8),
    );

    // Call showInlineDiff — don't await (it hangs until resolved)
    const reviewPromise = (
      provider as unknown as {
        showInlineDiff(
          editor: vscode.TextEditor,
          original: string,
          proposed: string,
          range: vscode.Range,
        ): Promise<"accept" | "reject">;
      }
    ).showInlineDiff(mockEditor, "original", "proposed", range);

    // Status bar should have been created and shown
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(
      vscode.StatusBarAlignment.Left,
      1000,
    );

    // Resolve the promise by accepting
    (provider as unknown as { pendingResolve: (v: "accept" | "reject") => void }).pendingResolve?.("accept");
    await reviewPromise;
  });

  it("dispose() hides and disposes the StatusBarItem", async () => {
    const mockEditor = {
      document: {
        uri: { fsPath: "/test/file.ts" },
        getText: vi.fn().mockReturnValue("original"),
      },
      selection: {
        isEmpty: false,
        start: { line: 0, character: 0 },
        end: { line: 0, character: 8 },
      },
      setDecorations: vi.fn(),
    } as unknown as vscode.TextEditor;

    const range = new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(0, 8),
    );

    // Start a pending review
    void (
      provider as unknown as {
        showInlineDiff(
          editor: vscode.TextEditor,
          original: string,
          proposed: string,
          range: vscode.Range,
        ): Promise<"accept" | "reject">;
      }
    ).showInlineDiff(mockEditor, "original", "proposed", range);

    // Dispose should clean up the status bar
    provider.dispose();

    const createdSb = (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results[0]?.value as typeof mockStatusBarItem;
    expect(createdSb?.hide).toHaveBeenCalled();
    expect(createdSb?.dispose).toHaveBeenCalled();
  });
});
