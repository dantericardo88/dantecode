// ============================================================================
// packages/vscode/src/__tests__/inline-completion-budget.test.ts
//
// Sprint 8 — Dim 1 wiring tests.
// Verifies that computeContextBudget() now delegates to FimContextBudget
// (principled 60/15 multi-slot allocation) rather than the old hardcoded
// 80%/20% prefix/suffix split.
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

// ── Stub heavy dependencies ───────────────────────────────────────────────────
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

// ── Imports under test (after mocks) ─────────────────────────────────────────
import { computeContextBudget, pruneFromTop, pruneFromBottom } from "../inline-completion.js";
import { FimContextBudget, BUDGET_8K } from "../fim-context-budget.js";

// ── Constants mirrored from inline-completion.ts ──────────────────────────────
const DEFAULT_CONTEXT_WINDOW = 131_072;
const MIN_PREFIX_CHARS = 500;

// ─────────────────────────────────────────────────────────────────────────────

describe("computeContextBudget — FimContextBudget wiring (Sprint 8)", () => {

  it("prefixTokens matches FimContextBudget.slots.prefix for 128K context", () => {
    const budget = FimContextBudget.forContextWindow(DEFAULT_CONTEXT_WINDOW, 256);
    const result = computeContextBudget(DEFAULT_CONTEXT_WINDOW, 256);
    expect(result.prefixTokens).toBe(budget.slots.prefix);
  });

  it("suffixTokens matches FimContextBudget.slots.suffix for 128K context", () => {
    const budget = FimContextBudget.forContextWindow(DEFAULT_CONTEXT_WINDOW, 256);
    const result = computeContextBudget(DEFAULT_CONTEXT_WINDOW, 256);
    expect(result.suffixTokens).toBe(budget.slots.suffix);
  });

  it("prefixChars equals budget.slots.prefix * 4 for normal context windows", () => {
    // 128K window gives large prefix slot — well above MIN_PREFIX_CHARS (500)
    const budget = FimContextBudget.forContextWindow(DEFAULT_CONTEXT_WINDOW, 256);
    const result = computeContextBudget(DEFAULT_CONTEXT_WINDOW, 256);
    expect(result.prefixChars).toBe(budget.slots.prefix * 4);
  });

  it("suffixChars equals budget.slots.suffix * 4", () => {
    const budget = FimContextBudget.forContextWindow(DEFAULT_CONTEXT_WINDOW, 512);
    const result = computeContextBudget(DEFAULT_CONTEXT_WINDOW, 512);
    expect(result.suffixChars).toBe(budget.slots.suffix * 4);
  });

  it("prefixChars is at least MIN_PREFIX_CHARS (500) for very small context windows", () => {
    // Tiny window — slots.prefix * 4 may be < 500; floor must apply
    const result = computeContextBudget(512, 256);
    expect(result.prefixChars).toBeGreaterThanOrEqual(MIN_PREFIX_CHARS);
  });

  it("prefix ratio is 60% not 80% — old hardcoded ratio no longer used", () => {
    const budget = FimContextBudget.forContextWindow(DEFAULT_CONTEXT_WINDOW, 256);
    const available = DEFAULT_CONTEXT_WINDOW - 256 - 50; // FIM_TOKEN_OVERHEAD = 50
    // New: prefix = 60% of available
    expect(budget.slots.prefix).toBe(Math.floor(available * 0.60));
    // Old 80% would give a larger number — verify we're NOT using 80%
    const oldPrefix80 = Math.floor((DEFAULT_CONTEXT_WINDOW - 256 - 200) * 0.80); // SAFETY_BUFFER_TOKENS=200
    expect(budget.slots.prefix).not.toBe(oldPrefix80);
  });

  it("8K context produces same prefix as BUDGET_8K", () => {
    const result = computeContextBudget(8_192, 256);
    expect(result.prefixTokens).toBe(BUDGET_8K.slots.prefix);
  });

  it("slots are non-negative when completionMaxTokens exceeds context window", () => {
    const result = computeContextBudget(100, 500);
    expect(result.prefixTokens).toBeGreaterThanOrEqual(0);
    expect(result.suffixTokens).toBeGreaterThanOrEqual(0);
    expect(result.prefixChars).toBeGreaterThanOrEqual(0);
    expect(result.suffixChars).toBeGreaterThanOrEqual(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────

describe("pruneFromTop / pruneFromBottom — character budget prune helpers", () => {

  it("pruneFromTop removes from front, keeps tail (cursor-near content)", () => {
    const text = "abcdefghij"; // 10 chars
    const pruned = pruneFromTop(text, 5);
    expect(pruned).toBe("fghij"); // last 5
  });

  it("pruneFromBottom removes from back, keeps head (cursor-near suffix)", () => {
    const text = "abcdefghij";
    const pruned = pruneFromBottom(text, 5);
    expect(pruned).toBe("abcde"); // first 5
  });

});
