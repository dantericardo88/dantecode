// packages/vscode/src/__tests__/lsp-context-provider.test.ts
// 12 tests covering HOVER_PROVIDER, DEFINITION_PROVIDER, REFERENCES_PROVIDER, SYMBOL_PROVIDER

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── VSCode mock ───────────────────────────────────────────────────────────────
// NOTE: vi.mock factory is hoisted — cannot reference outer `const` here.
// Use vi.fn() directly; grab references via `(await import("vscode")).commands.executeCommand` pattern.

vi.mock("vscode", () => {
  const executeCommand = vi.fn();
  const openTextDocument = vi.fn();
  const getWordRangeAtPosition = vi.fn(() => ({
    start: { line: 10, character: 2 },
    end: { line: 10, character: 8 },
  }));
  const getText = vi.fn(() => "myFunc");
  const asRelativePath = vi.fn((uri: unknown) =>
    typeof uri === "string" ? uri : (uri as { fsPath: string }).fsPath,
  );

  return {
    window: {
      get activeTextEditor() {
        return {
          document: {
            uri: { fsPath: "/project/src/app.ts" },
            getText,
            getWordRangeAtPosition,
          },
          selection: { active: { line: 10, character: 5 } },
        };
      },
    },
    commands: { executeCommand },
    workspace: {
      openTextDocument,
      asRelativePath,
    },
    SymbolKind: { Function: 5, Class: 4, Interface: 10, Method: 5, Variable: 12 },
    // expose helpers for tests to grab
    _test: { executeCommand, openTextDocument, getWordRangeAtPosition, getText, asRelativePath },
  };
});

// Grab mocks after module is hoisted
import * as vscodeMod from "vscode";
const vscodeTest = (vscodeMod as unknown as { _test: {
  executeCommand: ReturnType<typeof vi.fn>;
  openTextDocument: ReturnType<typeof vi.fn>;
  getWordRangeAtPosition: ReturnType<typeof vi.fn>;
  getText: ReturnType<typeof vi.fn>;
  asRelativePath: ReturnType<typeof vi.fn>;
}})._test;

import {
  HOVER_PROVIDER,
  DEFINITION_PROVIDER,
  REFERENCES_PROVIDER,
  SYMBOL_PROVIDER,
} from "../lsp-context-provider.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHover(value: string) {
  return { contents: [{ value }] };
}

function makeLocation(fsPath: string, line: number) {
  return { uri: { fsPath }, range: { start: { line }, end: { line } } };
}

function makeDoc(lineTexts: string[]) {
  return {
    lineCount: lineTexts.length,
    lineAt: (i: number) => ({ text: lineTexts[i] ?? "" }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vscodeTest.getWordRangeAtPosition.mockReturnValue({
    start: { line: 10, character: 2 },
    end: { line: 10, character: 8 },
  });
  vscodeTest.getText.mockReturnValue("myFunc");
});

describe("HOVER_PROVIDER", () => {
  it("returns hover text from executeHoverProvider", async () => {
    vscodeTest.executeCommand.mockResolvedValueOnce([makeHover("string — the user id")]);
    const items = await HOVER_PROVIDER.resolve("", "/project");
    expect(items).toHaveLength(1);
    expect(items[0]!.content).toContain("string — the user id");
    expect(items[0]!.label).toBe("@hover");
  });

  it("returns graceful message when executeHoverProvider throws", async () => {
    vscodeTest.executeCommand.mockRejectedValueOnce(new Error("LSP not ready"));
    const items = await HOVER_PROVIDER.resolve("", "/project");
    expect(items[0]!.content).toMatch(/hover unavailable|no active editor|no hover/i);
  });

  it("returns graceful message when executeHoverProvider returns empty array", async () => {
    vscodeTest.executeCommand.mockResolvedValueOnce([]);
    const items = await HOVER_PROVIDER.resolve("", "/project");
    expect(items[0]!.content).toContain("no hover information at cursor");
  });

  it("truncates hover content at 2000 chars", async () => {
    const longText = "x".repeat(3000);
    vscodeTest.executeCommand.mockResolvedValueOnce([makeHover(longText)]);
    const items = await HOVER_PROVIDER.resolve("", "/project");
    expect(items[0]!.content.length).toBeLessThanOrEqual(2000);
  });
});

describe("DEFINITION_PROVIDER", () => {
  it("returns definition source chunk for Location", async () => {
    vscodeTest.executeCommand.mockResolvedValueOnce([
      makeLocation("/project/src/utils.ts", 20),
    ]);
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    vscodeTest.openTextDocument.mockResolvedValueOnce(makeDoc(lines));
    vscodeTest.asRelativePath.mockReturnValueOnce("src/utils.ts");

    const items = await DEFINITION_PROVIDER.resolve("", "/project");
    expect(items[0]!.content).toContain("src/utils.ts");
    expect(items[0]!.label).toMatch(/^@definition:src\/utils\.ts:/);
  });

  it("returns graceful message when no definition found", async () => {
    vscodeTest.executeCommand.mockResolvedValueOnce([]);
    const items = await DEFINITION_PROVIDER.resolve("", "/project");
    expect(items[0]!.content).toContain("no definition found");
  });

  it("handles LocationLink (targetUri/targetRange) union type", async () => {
    vscodeTest.executeCommand.mockResolvedValueOnce([
      {
        targetUri: { fsPath: "/project/src/auth.ts" },
        targetRange: { start: { line: 5 }, end: { line: 5 } },
      },
    ]);
    const lines = Array.from({ length: 30 }, (_, i) => `auth line ${i}`);
    vscodeTest.openTextDocument.mockResolvedValueOnce(makeDoc(lines));
    vscodeTest.asRelativePath.mockReturnValueOnce("src/auth.ts");

    const items = await DEFINITION_PROVIDER.resolve("", "/project");
    expect(items[0]!.content).toContain("src/auth.ts");
  });
});

describe("REFERENCES_PROVIDER", () => {
  it("lists reference locations capped at 20", async () => {
    const refs = Array.from({ length: 25 }, (_, i) =>
      makeLocation(`/project/src/file${i}.ts`, i),
    );
    vscodeTest.executeCommand.mockResolvedValueOnce(refs);
    vscodeTest.asRelativePath.mockImplementation(
      (uri: { fsPath: string }) => `src/${uri.fsPath.split("/").pop()}`,
    );
    const items = await REFERENCES_PROVIDER.resolve("", "/project");
    expect(items[0]!.content).toContain("25 references");
    expect(items[0]!.content).toContain("showing first 20");
  });

  it("returns graceful message when no references found", async () => {
    vscodeTest.executeCommand.mockResolvedValueOnce([]);
    const items = await REFERENCES_PROVIDER.resolve("", "/project");
    expect(items[0]!.content).toContain("no references found");
  });

  it("guards against short tokens (< 3 chars)", async () => {
    vscodeTest.getText.mockReturnValue("if");
    vscodeTest.getWordRangeAtPosition.mockReturnValue({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 2 },
    });
    const items = await REFERENCES_PROVIDER.resolve("", "/project");
    expect(items[0]!.content).toMatch(/move onto a meaningful symbol/i);
    expect(vscodeTest.executeCommand).not.toHaveBeenCalled();
  });
});

describe("SYMBOL_PROVIDER", () => {
  it("queries executeWorkspaceSymbolProvider with the given query", async () => {
    vscodeTest.executeCommand.mockResolvedValueOnce([
      {
        name: "UserAuthService",
        kind: 4,
        location: {
          uri: { fsPath: "/project/src/auth.ts" },
          range: { start: { line: 10 } },
        },
      },
    ]);
    vscodeTest.asRelativePath.mockReturnValueOnce("src/auth.ts");

    const items = await SYMBOL_PROVIDER.resolve("UserAuthService", "/project");
    expect(vscodeTest.executeCommand).toHaveBeenCalledWith(
      "vscode.executeWorkspaceSymbolProvider",
      "UserAuthService",
    );
    expect(items[0]!.content).toContain("UserAuthService");
    expect(items[0]!.label).toBe("@symbol:UserAuthService");
  });

  it("returns graceful message for empty query", async () => {
    const items = await SYMBOL_PROVIDER.resolve("", "/project");
    expect(items[0]!.content).toContain("provide a symbol name");
    expect(vscodeTest.executeCommand).not.toHaveBeenCalled();
  });

  it("returns graceful message when no symbols found", async () => {
    vscodeTest.executeCommand.mockResolvedValueOnce([]);
    const items = await SYMBOL_PROVIDER.resolve("NoSuchThing", "/project");
    expect(items[0]!.content).toContain("no symbols found");
  });
});
