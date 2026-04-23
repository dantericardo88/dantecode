// packages/vscode/src/__tests__/lsp-type-crawl.test.ts
// 8 tests for executeTypeDefinitionProvider, executeSignatureHelpProvider, crawlTypes

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── VSCode mock ───────────────────────────────────────────────────────────────
// vi.mock factory is hoisted — use vi.fn() directly; expose via _test.

vi.mock("vscode", () => {
  const executeCommand = vi.fn();
  const openTextDocument = vi.fn();
  const asRelativePath = vi.fn((uri: unknown) =>
    typeof uri === "string" ? uri : (uri as { fsPath: string }).fsPath,
  );

  // Position class: supports `new vscode.Position(line, char)`
  class Position {
    constructor(
      public readonly line: number,
      public readonly character: number,
    ) {}
  }

  return {
    window: {
      get activeTextEditor() {
        return null;
      },
    },
    commands: { executeCommand },
    workspace: {
      openTextDocument,
      asRelativePath,
    },
    Position,
    SymbolKind: { Function: 5, Class: 4, Interface: 10, Method: 5, Variable: 12 },
    _test: { executeCommand, openTextDocument, asRelativePath },
  };
});

// Grab mock references after hoisting
import * as vscodeMod from "vscode";
const vscodeTest = (
  vscodeMod as unknown as {
    _test: {
      executeCommand: ReturnType<typeof vi.fn>;
      openTextDocument: ReturnType<typeof vi.fn>;
      asRelativePath: ReturnType<typeof vi.fn>;
    };
  }
)._test;

import {
  executeTypeDefinitionProvider,
  executeSignatureHelpProvider,
  crawlTypes,
  clearCrawlCache,
} from "../lsp-context-provider.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDoc(fsPath: string, lineTexts: string[] = []) {
  return {
    uri: { fsPath },
    lineCount: lineTexts.length,
    lineAt: (i: number) => ({ text: lineTexts[i] ?? "" }),
    getText: () => lineTexts.join("\n"),
    getWordRangeAtPosition: vi.fn(),
  };
}

function makeLocation(fsPath: string, line: number) {
  return {
    uri: { fsPath },
    range: { start: { line }, end: { line } },
  };
}

function makePosition(line: number, character: number) {
  return { line, character };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  clearCrawlCache();
});

describe("executeTypeDefinitionProvider", () => {
  it("returns locations array from executeCommand", async () => {
    const loc = makeLocation("/project/src/types.ts", 10);
    vscodeTest.executeCommand.mockResolvedValueOnce([loc]);

    const doc = makeDoc("/project/src/app.ts");
    const pos = makePosition(5, 3);
    const result = await executeTypeDefinitionProvider(
      doc as unknown as import("vscode").TextDocument,
      pos as unknown as import("vscode").Position,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(loc);
    expect(vscodeTest.executeCommand).toHaveBeenCalledWith(
      "vscode.executeTypeDefinitionProvider",
      doc.uri,
      pos,
    );
  });

  it("returns [] when command throws", async () => {
    vscodeTest.executeCommand.mockRejectedValueOnce(new Error("LSP error"));

    const doc = makeDoc("/project/src/app.ts");
    const pos = makePosition(5, 3);
    const result = await executeTypeDefinitionProvider(
      doc as unknown as import("vscode").TextDocument,
      pos as unknown as import("vscode").Position,
    );
    expect(result).toEqual([]);
  });

  it("returns [] when command returns null", async () => {
    vscodeTest.executeCommand.mockResolvedValueOnce(null);

    const doc = makeDoc("/project/src/app.ts");
    const pos = makePosition(0, 0);
    const result = await executeTypeDefinitionProvider(
      doc as unknown as import("vscode").TextDocument,
      pos as unknown as import("vscode").Position,
    );
    expect(result).toEqual([]);
  });
});

describe("executeSignatureHelpProvider", () => {
  it("returns SignatureHelp object from command", async () => {
    const sigHelp = {
      signatures: [{ label: "fn(a: string): void" }],
      activeSignature: 0,
      activeParameter: 0,
    };
    vscodeTest.executeCommand.mockResolvedValueOnce(sigHelp);

    const doc = makeDoc("/project/src/app.ts");
    const pos = makePosition(3, 10);
    const result = await executeSignatureHelpProvider(
      doc as unknown as import("vscode").TextDocument,
      pos as unknown as import("vscode").Position,
    );
    expect(result).toBe(sigHelp);
  });

  it("passes triggerChar as third arg to executeCommand", async () => {
    vscodeTest.executeCommand.mockResolvedValueOnce(null);

    const doc = makeDoc("/project/src/app.ts");
    const pos = makePosition(2, 5);
    await executeSignatureHelpProvider(
      doc as unknown as import("vscode").TextDocument,
      pos as unknown as import("vscode").Position,
      ",",
    );
    expect(vscodeTest.executeCommand).toHaveBeenCalledWith(
      "vscode.executeSignatureHelpProvider",
      doc.uri,
      pos,
      ",",
    );
  });

  it("returns null when command throws", async () => {
    vscodeTest.executeCommand.mockRejectedValueOnce(new Error("LSP not ready"));

    const doc = makeDoc("/project/src/app.ts");
    const pos = makePosition(0, 0);
    const result = await executeSignatureHelpProvider(
      doc as unknown as import("vscode").TextDocument,
      pos as unknown as import("vscode").Position,
    );
    expect(result).toBeNull();
  });
});

describe("crawlTypes", () => {
  it("depth=1: calls executeCommand, opens document, returns snippet", async () => {
    const typeLoc = makeLocation("/project/src/types.ts", 5);
    vscodeTest.executeCommand.mockResolvedValueOnce([typeLoc]);

    const typeDocLines = Array.from({ length: 20 }, (_, i) => `type line ${i}`);
    const typeDoc = makeDoc("/project/src/types.ts", typeDocLines);
    vscodeTest.openTextDocument.mockResolvedValueOnce(typeDoc);
    vscodeTest.asRelativePath.mockReturnValue("src/types.ts");

    // Recursive call for depth-1 crawl inside the type doc — returns empty
    vscodeTest.executeCommand.mockResolvedValueOnce([]);

    const doc = makeDoc("/project/src/app.ts");
    const pos = makePosition(3, 5);
    const result = await crawlTypes(
      doc as unknown as import("vscode").TextDocument,
      pos as unknown as import("vscode").Position,
      1,
    );
    expect(result).toContain("src/types.ts");
    expect(result).toContain("type line");
    expect(vscodeTest.openTextDocument).toHaveBeenCalledWith(typeLoc.uri);
  });

  it("LRU cache hit: second call with same args skips executeCommand", async () => {
    const typeLoc = makeLocation("/project/src/types.ts", 5);
    // First call — executeCommand returns a location
    vscodeTest.executeCommand.mockResolvedValueOnce([typeLoc]);
    const typeDocLines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const typeDoc = makeDoc("/project/src/types.ts", typeDocLines);
    vscodeTest.openTextDocument.mockResolvedValueOnce(typeDoc);
    vscodeTest.asRelativePath.mockReturnValue("src/types.ts");
    // Recursive depth-0 call inside crawl returns empty
    vscodeTest.executeCommand.mockResolvedValueOnce([]);

    const doc = makeDoc("/project/src/app.ts");
    const pos = makePosition(3, 5);

    await crawlTypes(
      doc as unknown as import("vscode").TextDocument,
      pos as unknown as import("vscode").Position,
      1,
    );
    const callCountAfterFirst = vscodeTest.executeCommand.mock.calls.length;

    // Second call — same doc/pos/depth — should hit LRU cache, no new executeCommand calls
    await crawlTypes(
      doc as unknown as import("vscode").TextDocument,
      pos as unknown as import("vscode").Position,
      1,
    );
    expect(vscodeTest.executeCommand.mock.calls.length).toBe(callCountAfterFirst);
  });
});
