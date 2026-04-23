import { describe, it, expect, vi, beforeEach } from "vitest";

// ── VS Code mock ──────────────────────────────────────────────────────────
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
    ProgressLocation: { Notification: 15 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    window: {
      showInputBox: vi.fn(),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      createTextEditorDecorationType: vi.fn(() => ({ ...mockDeco })),
      createStatusBarItem: vi.fn(() => ({ text: "", tooltip: "", show: vi.fn(), hide: vi.fn(), dispose: vi.fn() })),
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
import { InlineEditProvider, type InlineEdit } from "../inline-edit-provider.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeEditor(
  text = "function foo() {\n  return 1;\n}",
  selectionText = "function foo() {\n  return 1;\n}",
): vscode.TextEditor {
  const doc = {
    uri: { fsPath: "/project/foo.ts", toString: () => "file:///project/foo.ts" } as vscode.Uri,
    getText: vi.fn((range?: vscode.Range) => {
      if (range === undefined) return text;
      return selectionText;
    }),
    lineCount: text.split("\n").length,
    version: 1,
  } as unknown as vscode.TextDocument;

  return {
    document: doc,
    selection: {
      isEmpty: false,
      start: { line: 0, character: 0 },
      end: { line: 2, character: 1 },
    } as vscode.Selection,
    setDecorations: vi.fn(),
    edit: vi.fn(async (fn: (b: { replace: ReturnType<typeof vi.fn> }) => void) => {
      fn({ replace: vi.fn() });
      return true;
    }),
  } as unknown as vscode.TextEditor;
}

const mockCheckpointManager = {
  createCheckpoint: vi.fn().mockResolvedValue({ id: "cp1", label: "test" }),
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("InlineEditProvider", () => {
  let provider: InlineEditProvider;
  const mockCallModel = vi.fn().mockResolvedValue("function foo() {\n  return 2;\n}");

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new InlineEditProvider(
      {} as vscode.ExtensionContext,
      mockCheckpointManager as unknown as import("../checkpoint-manager.js").CheckpointManager,
      mockCallModel,
    );
  });

  // ── activate ──────────────────────────────────────────────────────────

  it("activate returns array of disposables", () => {
    const disposables = provider.activate();
    expect(Array.isArray(disposables)).toBe(true);
    expect(disposables.length).toBeGreaterThanOrEqual(2);
  });

  it("activate registers dantecode.inlineEdit command", () => {
    provider.activate();
    const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
    const commandNames = calls.map((c) => c[0]);
    expect(commandNames).toContain("dantecode.inlineEdit");
  });

  it("activate registers accept/reject commands", () => {
    provider.activate();
    const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
    const commandNames = calls.map((c) => c[0]);
    expect(commandNames).toContain("dantecode.acceptInlineEdit");
    expect(commandNames).toContain("dantecode.rejectInlineEdit");
  });

  // ── triggerInlineEdit ─────────────────────────────────────────────────

  it("triggerInlineEdit aborts when user cancels input box", async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    const editor = makeEditor();
    await provider.triggerInlineEdit(editor);
    expect(mockCallModel).not.toHaveBeenCalled();
  });

  it("triggerInlineEdit calls model with instruction", async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue("Add error handling");
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("✗ Reject" as never);
    const editor = makeEditor();
    await provider.triggerInlineEdit(editor);
    expect(mockCallModel).toHaveBeenCalledOnce();
    const [system, user] = mockCallModel.mock.calls[0]!;
    expect(system).toContain("Return ONLY the replacement code");
    expect(user).toContain("Add error handling");
  });

  it("triggerInlineEdit calls showInformationMessage for accept/reject", async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue("Fix this");
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("✗ Reject" as never);
    const editor = makeEditor();
    await provider.triggerInlineEdit(editor);
    expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalledWith(
      expect.stringContaining("accept or reject"),
      expect.any(String),
      expect.any(String),
    );
  });

  it("triggerInlineEdit applies edit when accepted", async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue("Optimize");
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("✓ Accept" as never);
    const editor = makeEditor();
    await provider.triggerInlineEdit(editor);
    expect(editor.edit).toHaveBeenCalledOnce();
  });

  it("triggerInlineEdit creates checkpoint when accepted", async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue("Optimize");
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("✓ Accept" as never);
    const editor = makeEditor();
    await provider.triggerInlineEdit(editor);
    expect(mockCheckpointManager.createCheckpoint).toHaveBeenCalledOnce();
  });

  it("triggerInlineEdit handles model error gracefully", async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue("Fix");
    mockCallModel.mockRejectedValueOnce(new Error("API error"));
    const editor = makeEditor();
    await provider.triggerInlineEdit(editor);
    expect(vi.mocked(vscode.window.showErrorMessage)).toHaveBeenCalledWith(
      expect.stringContaining("API error"),
    );
  });

  // ── applyInlineEdit ───────────────────────────────────────────────────

  it("applyInlineEdit replaces text in the editor", async () => {
    const editor = makeEditor();
    const edit: InlineEdit = {
      filePath: "/project/foo.ts",
      originalText: "function foo() {}",
      proposedText: "function foo(): number { return 42; }",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } } as vscode.Range,
      instruction: "Add return type",
    };
    // Make visibleTextEditors include our editor
    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [editor];
    await provider.applyInlineEdit(edit);
    expect(editor.edit).toHaveBeenCalled();
  });

  it("applyInlineEdit shows error when editor not found", async () => {
    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [];
    const edit: InlineEdit = {
      filePath: "/nonexistent.ts",
      originalText: "",
      proposedText: "",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } as vscode.Range,
      instruction: "test",
    };
    await provider.applyInlineEdit(edit);
    expect(vi.mocked(vscode.window.showErrorMessage)).toHaveBeenCalledWith(
      expect.stringContaining("editor not found"),
    );
  });

  // ── dispose ──────────────────────────────────────────────────────────

  it("dispose does not throw", () => {
    expect(() => provider.dispose()).not.toThrow();
  });
});
