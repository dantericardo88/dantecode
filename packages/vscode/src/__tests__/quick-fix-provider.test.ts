import { describe, it, expect, vi, beforeEach } from "vitest";

// ── VS Code mock ──────────────────────────────────────────────────────────
vi.mock("vscode", () => {
  const CodeActionKind = {
    QuickFix: { value: "quickfix" },
    RefactorRewrite: { value: "refactor.rewrite" },
  };
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
  class CodeAction {
    diagnostics?: unknown[];
    command?: { command: string; title: string; arguments?: unknown[] };
    isPreferred?: boolean;
    constructor(
      public title: string,
      public kind: { value: string },
    ) {}
  }
  return {
    CodeActionKind,
    Position,
    Range,
    CodeAction,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  };
});

import * as vscode from "vscode";
import { DanteCodeQuickFixProvider } from "../quick-fix-provider.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeDiag(
  source: string,
  severity: number,
  message: string,
  code?: string | number,
): vscode.Diagnostic {
  return {
    source,
    severity,
    message,
    code,
    range: {
      start: { line: 5, character: 0 },
      end: { line: 5, character: 50 },
    },
  } as unknown as vscode.Diagnostic;
}

function makeDocument(): vscode.TextDocument {
  return {
    uri: { toString: () => "file:///test.ts", fsPath: "/test.ts" } as vscode.Uri,
  } as vscode.TextDocument;
}

const range = {
  start: { line: 5, character: 0 },
  end: { line: 5, character: 50 },
} as vscode.Range;

const cancellationToken = { isCancellationRequested: false } as vscode.CancellationToken;

// ── Tests ─────────────────────────────────────────────────────────────────

describe("DanteCodeQuickFixProvider", () => {
  let provider: DanteCodeQuickFixProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new DanteCodeQuickFixProvider();
  });

  it("providedCodeActionKinds includes QuickFix and RefactorRewrite", () => {
    const kinds = DanteCodeQuickFixProvider.providedCodeActionKinds;
    const values = kinds.map((k) => (k as { value: string }).value);
    expect(values).toContain("quickfix");
    expect(values).toContain("refactor.rewrite");
  });

  it("returns empty array when no diagnostics", () => {
    const context = { diagnostics: [] } as unknown as vscode.CodeActionContext;
    const actions = provider.provideCodeActions(makeDocument(), range, context, cancellationToken);
    expect(actions).toHaveLength(0);
  });

  it("creates Fix + Explain actions for PDSE hard violation", () => {
    const diag = makeDiag("DanteCode PDSE", vscode.DiagnosticSeverity.Error, "[Stub Detected] placeholder");
    const context = { diagnostics: [diag] } as unknown as vscode.CodeActionContext;
    const actions = provider.provideCodeActions(makeDocument(), range, context, cancellationToken);
    expect(actions.length).toBeGreaterThanOrEqual(2);
    const fix = actions.find((a) => a.title.includes("Fix with DanteCode"));
    expect(fix).toBeDefined();
    const explain = actions.find((a) => a.title.includes("Explain"));
    expect(explain).toBeDefined();
  });

  it("marks PDSE fix as preferred", () => {
    const diag = makeDiag("DanteCode PDSE", vscode.DiagnosticSeverity.Error, "stub detected");
    const context = { diagnostics: [diag] } as unknown as vscode.CodeActionContext;
    const actions = provider.provideCodeActions(makeDocument(), range, context, cancellationToken);
    const fix = actions.find((a) => a.title.includes("Fix with DanteCode"));
    expect((fix as { isPreferred?: boolean } | undefined)?.isPreferred).toBe(true);
  });

  it("creates Fix action for TS2345 error", () => {
    const diag = makeDiag("ts", vscode.DiagnosticSeverity.Error, "Argument of type 'string' is not assignable", "2345");
    const context = { diagnostics: [diag] } as unknown as vscode.CodeActionContext;
    const actions = provider.provideCodeActions(makeDocument(), range, context, cancellationToken);
    const fix = actions.find((a) => a.title.includes("Ask DanteCode"));
    expect(fix).toBeDefined();
  });

  it("creates Fix action for TS2339 error", () => {
    const diag = makeDiag("ts", vscode.DiagnosticSeverity.Error, "Property 'x' does not exist", "2339");
    const context = { diagnostics: [diag] } as unknown as vscode.CodeActionContext;
    const actions = provider.provideCodeActions(makeDocument(), range, context, cancellationToken);
    expect(actions.find((a) => a.title.includes("Ask DanteCode"))).toBeDefined();
  });

  it("ignores TS warning (not error)", () => {
    const diag = makeDiag("ts", vscode.DiagnosticSeverity.Warning, "Unused variable", "6133");
    const context = { diagnostics: [diag] } as unknown as vscode.CodeActionContext;
    const actions = provider.provideCodeActions(makeDocument(), range, context, cancellationToken);
    // TS warnings don't get fix actions
    expect(actions.find((a) => a.title.includes("Ask DanteCode"))).toBeUndefined();
  });

  it("creates only Explain action for non-TS, non-PDSE error", () => {
    const diag = makeDiag("eslint", vscode.DiagnosticSeverity.Error, "Some lint error");
    const context = { diagnostics: [diag] } as unknown as vscode.CodeActionContext;
    const actions = provider.provideCodeActions(makeDocument(), range, context, cancellationToken);
    expect(actions.find((a) => a.title.includes("Explain"))).toBeDefined();
    expect(actions.find((a) => a.title.includes("Fix with DanteCode"))).toBeUndefined();
  });

  it("PDSE fix command uses dantecode.fixDiagnostic", () => {
    const diag = makeDiag("DanteCode PDSE", vscode.DiagnosticSeverity.Error, "stub");
    const context = { diagnostics: [diag] } as unknown as vscode.CodeActionContext;
    const actions = provider.provideCodeActions(makeDocument(), range, context, cancellationToken);
    const fix = actions.find((a) => a.title.includes("Fix with DanteCode"));
    expect((fix as { command?: { command: string } } | undefined)?.command?.command).toBe("dantecode.fixDiagnostic");
  });

  it("TS fix command uses dantecode.inlineEdit", () => {
    const diag = makeDiag("ts", vscode.DiagnosticSeverity.Error, "type error", "2304");
    const context = { diagnostics: [diag] } as unknown as vscode.CodeActionContext;
    const actions = provider.provideCodeActions(makeDocument(), range, context, cancellationToken);
    const fix = actions.find((a) => a.title.includes("Ask DanteCode"));
    expect((fix as { command?: { command: string } } | undefined)?.command?.command).toBe("dantecode.inlineEdit");
  });

  it("Explain command uses dantecode.explainDiagnostic", () => {
    const diag = makeDiag("DanteCode PDSE", vscode.DiagnosticSeverity.Error, "stub");
    const context = { diagnostics: [diag] } as unknown as vscode.CodeActionContext;
    const actions = provider.provideCodeActions(makeDocument(), range, context, cancellationToken);
    const explain = actions.find((a) => a.title.includes("Explain"));
    expect((explain as { command?: { command: string } } | undefined)?.command?.command).toBe("dantecode.explainDiagnostic");
  });

  it("handles multiple diagnostics in one call", () => {
    const diag1 = makeDiag("DanteCode PDSE", vscode.DiagnosticSeverity.Error, "stub 1");
    const diag2 = makeDiag("ts", vscode.DiagnosticSeverity.Error, "type error", "2345");
    const context = { diagnostics: [diag1, diag2] } as unknown as vscode.CodeActionContext;
    const actions = provider.provideCodeActions(makeDocument(), range, context, cancellationToken);
    expect(actions.length).toBeGreaterThanOrEqual(3);
  });

  it("ignores PDSE warnings (not errors)", () => {
    const diag = makeDiag("DanteCode PDSE", vscode.DiagnosticSeverity.Warning, "soft violation");
    const context = { diagnostics: [diag] } as unknown as vscode.CodeActionContext;
    const actions = provider.provideCodeActions(makeDocument(), range, context, cancellationToken);
    // PDSE warnings don't get the preferred fix (only errors do)
    expect(actions.find((a) => a.title.includes("Fix with DanteCode"))).toBeUndefined();
  });
});
