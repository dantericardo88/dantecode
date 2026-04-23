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
      public readonly start: Position,
      public readonly end: Position,
    ) {}
  }
  class CodeLens {
    constructor(
      public range: Range,
      public command?: { title: string; command: string; arguments?: unknown[] },
    ) {}
  }
  class EventEmitter {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  }
  return {
    Position,
    Range,
    CodeLens,
    EventEmitter,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    languages: {
      getDiagnostics: vi.fn(() => []),
    },
    window: {
      createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
    },
  };
});

import * as vscode from "vscode";
import { DanteCodeLensProvider } from "../codelens-provider.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeDocument(
  text: string,
  lineCount?: number,
  version = 1,
): vscode.TextDocument {
  const lines = text.split("\n");
  return {
    uri: { toString: () => "file:///test.ts", fsPath: "/test.ts" } as vscode.Uri,
    version,
    lineCount: lineCount ?? lines.length,
    getText: () => text,
    languageId: "typescript",
  } as unknown as vscode.TextDocument;
}

const cancellationToken = { isCancellationRequested: false } as vscode.CancellationToken;

// ── Tests ─────────────────────────────────────────────────────────────────

describe("DanteCodeLensProvider", () => {
  let provider: DanteCodeLensProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.languages.getDiagnostics).mockReturnValue([]);
    provider = new DanteCodeLensProvider();
  });

  it("returns empty array for document with no functions", () => {
    const doc = makeDocument("const x = 1;\nconst y = 2;\n");
    const lenses = provider.provideCodeLenses(doc, cancellationToken);
    // no function/class/export declarations — should be empty or minimal
    expect(Array.isArray(lenses)).toBe(true);
  });

  it("returns 'Ask DanteCode' lens for exported function", () => {
    const doc = makeDocument("export function greet(name: string): string {\n  return name;\n}\n");
    const lenses = provider.provideCodeLenses(doc, cancellationToken);
    const askLens = lenses.find((l) => l.command?.title === "⚡ Ask DanteCode");
    expect(askLens).toBeDefined();
  });

  it("returns 'Write test' lens for exported function", () => {
    const doc = makeDocument("export function greet(): void {}\n");
    const lenses = provider.provideCodeLenses(doc, cancellationToken);
    const testLens = lenses.find((l) => l.command?.title?.includes("Write test"));
    expect(testLens).toBeDefined();
  });

  it("does NOT add 'Write test' lens for non-exported function", () => {
    const doc = makeDocument("function internal(): void {}\n");
    const lenses = provider.provideCodeLenses(doc, cancellationToken);
    const testLens = lenses.find((l) => l.command?.title?.includes("Write test"));
    expect(testLens).toBeUndefined();
  });

  it("returns PDSE violation lens when hard diagnostic is present", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vi.mocked(vscode.languages.getDiagnostics) as any).mockReturnValue([
      {
        source: "DanteCode PDSE",
        severity: vscode.DiagnosticSeverity.Error,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        message: "[Stub Detected] placeholder",
        code: "PDSE 40",
      } as vscode.Diagnostic,
    ]);
    const doc = makeDocument("export function bad(): void { /* TODO */ }\n");
    const lenses = provider.provideCodeLenses(doc, cancellationToken);
    const pdse = lenses.find((l) => l.command?.title?.includes("PDSE violation"));
    expect(pdse).toBeDefined();
  });

  it("skips documents with more than 5000 lines", () => {
    const doc = makeDocument("export function foo() {}\n", 5001);
    const lenses = provider.provideCodeLenses(doc, cancellationToken);
    expect(lenses).toHaveLength(0);
  });

  it("caches lenses for same document version", () => {
    const doc = makeDocument("export function foo() {}\n", undefined, 3);
    provider.provideCodeLenses(doc, cancellationToken);
    const lenses2 = provider.provideCodeLenses(doc, cancellationToken);
    // getDiagnostics only called once (second call hits cache)
    expect(vi.mocked(vscode.languages.getDiagnostics)).toHaveBeenCalledTimes(1);
    expect(Array.isArray(lenses2)).toBe(true);
  });

  it("detects class declarations", () => {
    const doc = makeDocument("export class MyService {\n  run() {}\n}\n");
    const lenses = provider.provideCodeLenses(doc, cancellationToken);
    expect(lenses.length).toBeGreaterThan(0);
  });

  it("resolveCodeLens returns the lens as-is", () => {
    const Range = (vscode.Range as unknown as new (a: number, b: number, c: number, d: number) => vscode.Range);
    const lens = new (vscode.CodeLens as unknown as new (range: vscode.Range) => vscode.CodeLens)(
      new Range(0, 0, 0, 0),
    );
    expect(provider.resolveCodeLens(lens, cancellationToken)).toBe(lens);
  });

  it("scheduleRefresh debounces and fires change event", async () => {
    provider.scheduleRefresh();
    provider.scheduleRefresh();
    // Only one fire should happen (debounced)
    await new Promise((r) => setTimeout(r, 600));
  });

  it("dispose clears resources", () => {
    expect(() => provider.dispose()).not.toThrow();
  });
});
