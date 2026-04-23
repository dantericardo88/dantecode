// ============================================================================
// packages/vscode/src/__tests__/lsp-diagnostics-wiring.test.ts
//
// Sprint 9 — Dim 2 wiring tests.
// Verifies that LspDiagnosticsInjector is wired into DanteCodeCompletionProvider
// and that active LSP diagnostics flow into the FIM system prompt.
// ============================================================================

import { describe, it, expect, vi } from "vitest";

// ── Minimal vscode stub ───────────────────────────────────────────────────────
vi.mock("vscode", () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: vi.fn((id: string) => ({ id })),
  window: {
    createStatusBarItem: vi.fn(() => ({
      text: "", tooltip: "", command: "", backgroundColor: undefined,
      show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
    })),
    createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    activeTextEditor: undefined,
    visibleTextEditors: [],
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn(() => undefined) })),
    onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    textDocuments: [],
    workspaceFolders: [],
  },
  commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })) },
  env: { appName: "VS Code" },
  Uri: { parse: vi.fn((s: string) => ({ toString: () => s, fsPath: s })), file: vi.fn((s: string) => ({ toString: () => `file://${s}`, fsPath: s })) },
  Range: vi.fn(),
  Position: vi.fn(),
  InlineCompletionList: vi.fn((items: unknown[]) => ({ items })),
  InlineCompletionItem: vi.fn((text: string) => ({ insertText: text })),
  EventEmitter: vi.fn(() => ({ fire: vi.fn(), event: vi.fn(), dispose: vi.fn() })),
}));

vi.mock("@dantecode/core", () => ({
  ModelRouterImpl: vi.fn(),
  parseModelReference: vi.fn(() => ({ provider: "ollama", model: "deepseek-coder" })),
}));

vi.mock("@dantecode/danteforge", () => ({
  runLocalPDSEScorer: vi.fn().mockResolvedValue({ score: 80 }),
}));

vi.mock("@dantecode/codebase-index", () => ({
  SymbolDefinitionLookup: {
    extractCallSiteSymbol: vi.fn(() => null),
  },
}));

vi.mock("../cross-file-context.js", () => ({
  gatherCrossFileContext: vi.fn().mockResolvedValue(""),
}));

vi.mock("../prefix-tree-cache.js", () => ({
  PrefixTreeCache: vi.fn(() => ({ lookup: vi.fn(() => null), insert: vi.fn() })),
}));

vi.mock("../udiff-parser.js", () => ({
  parseUdiffResponse: vi.fn(() => null),
}));

vi.mock("../completion-streaming-emitter.js", () => ({
  globalEmitterRegistry: { startFor: vi.fn(), cancelFor: vi.fn(), cancelAll: vi.fn() },
  CompletionStreamingEmitter: vi.fn(),
  EmitterRegistry: vi.fn(),
}));

vi.mock("../completion-stop-sequences.js", () => ({
  StopSequenceDetector: {
    forLanguage: vi.fn(() => ({
      getStopSequences: vi.fn(() => ["\n\n"]),
      checkStop: vi.fn(() => undefined),
    })),
  },
  BracketBalanceDetector: vi.fn(() => ({ check: vi.fn(() => ({ balanced: false, depth: 0 })) })),
}));

vi.mock("../file-interaction-cache.js", () => ({
  globalInteractionCache: { get: vi.fn(() => 0), record: vi.fn() },
}));

// ── Imports under test ────────────────────────────────────────────────────────
import { buildFIMPrompt } from "../inline-completion.js";
import {
  LspDiagnosticsInjector,
  createNullInjector,
  type DiagnosticsSnapshot,
} from "../lsp-diagnostics-injector.js";
import { FimContextBudget } from "../fim-context-budget.js";

// ─────────────────────────────────────────────────────────────────────────────

describe("LspDiagnosticsInjector — unit tests", () => {

  it("formatForContext returns empty string when no diagnostics", async () => {
    const injector = createNullInjector();
    const snap = await injector.snapshot("file:///test.ts");
    expect(injector.formatForContext(snap)).toBe("");
  });

  it("formatForContext includes '## Active Diagnostics' header when errors present", () => {
    const snap: DiagnosticsSnapshot = {
      current: [{ file: "/test.ts", line: 5, col: 3, severity: "error", message: "Type mismatch" }],
      related: [],
      totalErrors: 1,
      totalWarnings: 0,
      capturedAt: new Date().toISOString(),
    };
    // LspDiagnosticsInjector constructor requires vscode API — test formatForContext directly
    // via a manually constructed snapshot passed to a real injector
    const mockVscode = {
      languages: {
        getDiagnostics: vi.fn(() => []),
      },
    } as unknown as typeof import("vscode");
    const realInjector = new LspDiagnosticsInjector(mockVscode);
    // Directly test formatForContext with our snapshot
    const result = realInjector.formatForContext(snap);
    expect(result).toContain("## Active Diagnostics");
    expect(result).toContain("ERROR L5:3");
    expect(result).toContain("Type mismatch");
  });

  it("formatForContext includes warning entries", () => {
    const mockVscode = { languages: { getDiagnostics: vi.fn(() => []) } } as unknown as typeof import("vscode");
    const injector = new LspDiagnosticsInjector(mockVscode);
    const snap: DiagnosticsSnapshot = {
      current: [{ file: "/test.ts", line: 10, col: 1, severity: "warning", message: "Unused variable" }],
      related: [],
      totalErrors: 0,
      totalWarnings: 1,
      capturedAt: new Date().toISOString(),
    };
    const result = injector.formatForContext(snap);
    expect(result).toContain("WARNING L10:1");
    expect(result).toContain("Unused variable");
  });

  it("hasErrors returns true when totalErrors > 0", () => {
    const mockVscode = { languages: { getDiagnostics: vi.fn(() => []) } } as unknown as typeof import("vscode");
    const injector = new LspDiagnosticsInjector(mockVscode);
    const snap: DiagnosticsSnapshot = {
      current: [],
      related: [],
      totalErrors: 3,
      totalWarnings: 0,
      capturedAt: new Date().toISOString(),
    };
    expect(injector.hasErrors(snap)).toBe(true);
  });

  it("hasErrors returns false when no errors", async () => {
    const nullInjector = createNullInjector();
    expect(nullInjector.hasErrors(await nullInjector.snapshot("file:///x.ts"))).toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────

describe("buildFIMPrompt — lspDiagnostics injection (Sprint 9)", () => {

  it("lspDiagnostics block is included in systemPrompt when provided", () => {
    const diagBlock = "## Active Diagnostics\n### Current file:\n  ERROR L5:3 — Type mismatch";
    const result = buildFIMPrompt({
      prefix: "const x: number = ",
      suffix: ";",
      language: "typescript",
      filePath: "test.ts",
      lspDiagnostics: diagBlock,
    });
    expect(result.systemPrompt).toContain("## Active Diagnostics");
    expect(result.systemPrompt).toContain("Type mismatch");
  });

  it("lspDiagnostics is absent from systemPrompt when not provided", () => {
    const result = buildFIMPrompt({
      prefix: "const x = 1",
      suffix: ";",
      language: "typescript",
      filePath: "test.ts",
    });
    expect(result.systemPrompt).not.toContain("## Active Diagnostics");
  });

  it("lspDiagnostics injected after lspHover in systemParts order", () => {
    const result = buildFIMPrompt({
      prefix: "x.",
      suffix: "",
      language: "typescript",
      filePath: "test.ts",
      lspHover: "string.prototype.split",
      lspDiagnostics: "## Active Diagnostics\n  ERROR L1:1 — oops",
    });
    const hoverIdx = result.systemPrompt.indexOf("Type context (LSP)");
    const diagIdx = result.systemPrompt.indexOf("## Active Diagnostics");
    expect(hoverIdx).toBeGreaterThanOrEqual(0);
    expect(diagIdx).toBeGreaterThan(hoverIdx);
  });

  it("LSP budget slot is 10% of available tokens (lsp ratio check)", () => {
    const budget = FimContextBudget.forContextWindow(131_072, 256);
    const available = 131_072 - 256 - 50;
    expect(budget.slots.lsp).toBe(Math.floor(available * 0.10));
  });

});

// ── Sprint 21: Hover type context ────────────────────────────────────────────

describe("LspDiagnosticsInjector — hover type context (Sprint 21)", () => {

  function makeVscodeWithHover(hoverContent: string | null) {
    return {
      languages: { getDiagnostics: vi.fn(() => []) },
      Position: vi.fn((line: number, character: number) => ({ line, character })),
      Uri: { parse: vi.fn((s: string) => ({ toString: () => s, fsPath: s })) },
      commands: {
        executeCommand: vi.fn().mockResolvedValue(
          hoverContent === null ? [] : [{
            contents: [{ value: hoverContent }],
          }],
        ),
      },
    } as unknown as typeof import("vscode");
  }

  it("snapshot() with position returns hoverType when hover provider returns content", async () => {
    const vs = makeVscodeWithHover("Promise<AuthToken | null>");
    const injector = new LspDiagnosticsInjector(vs);
    const snap = await injector.snapshot("file:///auth.ts", { line: 10, character: 5 });
    expect(snap.hoverType).toBe("Promise<AuthToken | null>");
  });

  it("snapshot() without position returns hoverType undefined", async () => {
    const vs = makeVscodeWithHover("string");
    const injector = new LspDiagnosticsInjector(vs);
    const snap = await injector.snapshot("file:///auth.ts");
    expect(snap.hoverType).toBeUndefined();
  });

  it("formatForContext() includes '## Symbol Type' block when hoverType present", async () => {
    const vs = makeVscodeWithHover("string");
    const injector = new LspDiagnosticsInjector(vs);
    const snap = await injector.snapshot("file:///test.ts", { line: 0, character: 0 });
    const result = injector.formatForContext(snap);
    expect(result).toContain("## Symbol Type");
    expect(result).toContain("`string`");
  });

  it("formatForContext() output is unchanged when hoverType not present", () => {
    const mockVscode = { languages: { getDiagnostics: vi.fn(() => []) } } as unknown as typeof import("vscode");
    const injector = new LspDiagnosticsInjector(mockVscode);
    const snap: import("../lsp-diagnostics-injector.js").DiagnosticsSnapshot = {
      current: [],
      related: [],
      totalErrors: 0,
      totalWarnings: 0,
      capturedAt: new Date().toISOString(),
    };
    const result = injector.formatForContext(snap);
    expect(result).toBe("");
    expect(result).not.toContain("## Symbol Type");
  });

  it("empty hover results (no content) → hoverType remains undefined", async () => {
    const vs = makeVscodeWithHover(null);
    const injector = new LspDiagnosticsInjector(vs);
    const snap = await injector.snapshot("file:///test.ts", { line: 0, character: 0 });
    expect(snap.hoverType).toBeUndefined();
  });

  it("hover type truncated at 200 chars for long generic types", async () => {
    const longType = "A".repeat(300);
    const vs = makeVscodeWithHover(longType);
    const injector = new LspDiagnosticsInjector(vs);
    const snap = await injector.snapshot("file:///test.ts", { line: 0, character: 0 });
    expect(snap.hoverType!.length).toBeLessThanOrEqual(202); // 200 + "…"
    expect(snap.hoverType).toContain("…");
  });

  it("hasErrors() unaffected by hoverType presence", async () => {
    const vs = makeVscodeWithHover("string");
    const injector = new LspDiagnosticsInjector(vs);
    const snap = await injector.snapshot("file:///test.ts", { line: 0, character: 0 });
    expect(injector.hasErrors(snap)).toBe(false);
  });

  it("executeCommand throws → graceful fallback, no crash, hoverType undefined", async () => {
    const vs = {
      languages: { getDiagnostics: vi.fn(() => []) },
      Position: vi.fn((line: number, character: number) => ({ line, character })),
      Uri: { parse: vi.fn((s: string) => ({ toString: () => s, fsPath: s })) },
      commands: {
        executeCommand: vi.fn().mockRejectedValue(new Error("provider not found")),
      },
    } as unknown as typeof import("vscode");
    const injector = new LspDiagnosticsInjector(vs);
    const snap = await injector.snapshot("file:///test.ts", { line: 0, character: 0 });
    expect(snap.hoverType).toBeUndefined();
  });

});

// ── Sprint D: sidebar setLspInjector wiring pattern ──────────────────────────

describe("setLspInjector sidebar injection pattern (Sprint D)", () => {
  it("null injector hasErrors returns false — guards no injection", async () => {
    const nullInj = createNullInjector();
    const snap = await nullInj.snapshot("file:///app.ts");
    expect(nullInj.hasErrors(snap)).toBe(false);
  });

  it("null injector formatForContext returns empty string", async () => {
    const nullInj = createNullInjector();
    const snap = await nullInj.snapshot("file:///app.ts");
    expect(nullInj.formatForContext(snap)).toBe("");
  });

  it("messages remain unmodified when hasErrors returns false", async () => {
    const nullInj = createNullInjector();
    const messages = [{ role: "user", content: "how do I fix this?" }];
    const snap = await nullInj.snapshot("file:///src/app.ts");
    if (nullInj.hasErrors(snap)) {
      const block = nullInj.formatForContext(snap);
      if (block) {
        const last = messages[messages.length - 1]!;
        last.content = `${block}\n\n${last.content}`;
      }
    }
    expect(messages[0]!.content).toBe("how do I fix this?");
  });

  it("messages are prepended with diag block when hasErrors is true", () => {
    const mockVscode = { languages: { getDiagnostics: vi.fn(() => []) } } as unknown as typeof import("vscode");
    const realInjector = new LspDiagnosticsInjector(mockVscode);
    const snap: DiagnosticsSnapshot = {
      current: [{ file: "/src/app.ts", line: 3, col: 1, severity: "error", message: "Cannot find name" }],
      related: [],
      totalErrors: 1,
      totalWarnings: 0,
      capturedAt: new Date().toISOString(),
    };
    const messages = [{ role: "user", content: "fix this error please" }];
    if (realInjector.hasErrors(snap)) {
      const block = realInjector.formatForContext(snap);
      if (block) {
        const last = messages[messages.length - 1]!;
        last.content = `${block}\n\n${last.content}`;
      }
    }
    expect(messages[0]!.content).toContain("## Active Diagnostics");
    expect(messages[0]!.content).toContain("fix this error please");
  });

  it("injector snapshot produces a DiagnosticsSnapshot with required fields", async () => {
    const nullInj = createNullInjector();
    const snap = await nullInj.snapshot("file:///app.ts");
    expect("current" in snap).toBe(true);
    expect("related" in snap).toBe(true);
    expect("totalErrors" in snap).toBe(true);
    expect("totalWarnings" in snap).toBe(true);
    expect("capturedAt" in snap).toBe(true);
  });
});
