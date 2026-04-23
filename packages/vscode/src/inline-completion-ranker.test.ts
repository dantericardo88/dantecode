// ============================================================================
// Sprint BI — dim 1: FimCandidateRanker wiring into inline completion provider
// Tests verify that rankCompletionCandidates ranks candidates by quality
// and that the best candidate is returned first.
// ============================================================================

import { describe, it, expect, vi } from "vitest";

// ─── VS Code Mock ─────────────────────────────────────────────────────────────

vi.mock("vscode", () => ({
  Position: class {
    constructor(public line: number, public character: number) {}
  },
  Range: class {
    constructor(public start: unknown, public end: unknown) {}
  },
  InlineCompletionItem: class {
    filterText = "";
    constructor(public insertText: string, public range: unknown) {}
  },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Diagnostic: class {
    source = "";
    code: unknown = "";
    constructor(public range: unknown, public message: string, public severity: number) {}
  },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
    })),
    openTextDocument: vi.fn(async () => ({ getText: () => "" })),
  },
  window: { visibleTextEditors: [] },
  languages: {
    createDiagnosticCollection: vi.fn(() => ({
      get: vi.fn(() => []),
      set: vi.fn(),
      delete: vi.fn(),
      dispose: vi.fn(),
    })),
  },
}));

// Mock heavy VS Code-only modules that aren't testable in Node
vi.mock("./cross-file-context.js", () => ({
  gatherCrossFileContext: vi.fn(async () => ""),
}));
vi.mock("./prefix-tree-cache.js", () => ({
  PrefixTreeCache: class {
    get() { return undefined; }
    set() { return undefined; }
    clear() { return undefined; }
  },
}));
vi.mock("./completion-streaming-emitter.js", () => ({
  globalEmitterRegistry: { startFor: vi.fn(() => ({ emit: vi.fn(), abort: vi.fn() })) },
  DEFAULT_FIRST_LINE_TIMEOUT_MS: 300,
}));
vi.mock("./completion-stop-sequences.js", () => ({
  StopSequenceDetector: { forLanguage: vi.fn(() => ({ getStopSequences: () => [] })) },
  BracketBalanceDetector: class { check() { return { balanced: false }; } },
}));
vi.mock("./fim-context-budget.js", () => ({
  FimContextBudget: {
    forContextWindow: vi.fn(() => ({
      slots: { prefix: 8192, suffix: 2048, lsp: 1000, rag: 1000, crossFile: 500 },
    })),
  },
}));
vi.mock("./file-interaction-cache.js", () => ({
  globalInteractionCache: { getRelevantDocuments: vi.fn(() => []) },
}));
vi.mock("./lsp-diagnostics-injector.js", () => ({}));
vi.mock("./fim-templates.js", () => ({
  getFIMTemplate: vi.fn(() => ({ prefix: "<fim_prefix>", suffix: "<fim_suffix>", middle: "<fim_middle>" })),
  buildFIMPromptForModel: vi.fn(() => ({ prompt: "prompt", stop: [] })),
}));
vi.mock("./udiff-parser.js", () => ({ parseUdiffResponse: vi.fn(() => []) }));
vi.mock("@dantecode/codebase-index", () => ({
  SymbolDefinitionLookup: { extractCallSiteSymbol: vi.fn(() => null) },
}));
vi.mock("@dantecode/danteforge", () => ({
  runLocalPDSEScorer: vi.fn(() => ({ overall: 90, violations: [] })),
}));

// Import the module under test AFTER mocks
import { rankCompletionCandidates } from "./inline-completion.js";

// ---------------------------------------------------------------------------
// Tests for rankCompletionCandidates
// ---------------------------------------------------------------------------

describe("rankCompletionCandidates", () => {
  const prefix = "function add(a: number, b: number): number {\n  ";
  const suffix = "\n}\n";
  const language = "typescript";

  it("returns empty array for empty input", async () => {
    const result = await rankCompletionCandidates([], prefix, suffix, language);
    expect(result).toEqual([]);
  });

  it("filters out empty-string candidates", async () => {
    const result = await rankCompletionCandidates(["", "  ", "\n"], prefix, suffix, language);
    expect(result).toEqual([]);
  });

  it("returns single candidate unchanged (degenerate case)", async () => {
    const candidate = "return a + b;";
    const result = await rankCompletionCandidates([candidate], prefix, suffix, language);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(candidate);
  });

  it("ranks better candidate first: complete line beats partial word", async () => {
    // A complete line with newline is scored higher than a mid-word fragment
    const completeLine = "return a + b;\n";  // ends with \n → completeness bonus
    const partialWord = "ret";               // very short, no newline
    const result = await rankCompletionCandidates([partialWord, completeLine], prefix, suffix, language);
    // completeLine should rank first
    expect(result[0]).toBe(completeLine);
  });

  it("ranks 20-200 char candidate higher than very short (<5 chars) candidate", async () => {
    const goodLength = "return a + b; // sum of two numbers";  // ~36 chars, ideal range
    const tooShort = "x";  // 1 char, near-zero length quality
    const result = await rankCompletionCandidates([tooShort, goodLength], prefix, suffix, language);
    expect(result[0]).toBe(goodLength);
  });

  it("deduplicates identical candidates", async () => {
    const candidate = "return a + b;";
    const result = await rankCompletionCandidates([candidate, candidate, candidate], prefix, suffix, language);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(candidate);
  });

  it("returns all non-empty candidates when none are duplicates", async () => {
    const candidates = [
      "return a + b;\n",
      "return a - b;\n",
      "return a * b;\n",
    ];
    const result = await rankCompletionCandidates(candidates, prefix, suffix, language);
    expect(result).toHaveLength(3);
    // All should appear (order may vary by score, but set should match)
    expect(new Set(result)).toEqual(new Set(candidates));
  });

  it("puts syntactically balanced candidate ahead of imbalanced one", async () => {
    // Balanced: no unmatched braces
    const balanced = "return {\n  value: a + b,\n};\n";
    // Imbalanced: extra opening brace
    const imbalanced = "return {\n  value: a + b,\n\n";  // missing closing brace
    const result = await rankCompletionCandidates([imbalanced, balanced], prefix, suffix, language);
    expect(result[0]).toBe(balanced);
  });

  it("does not repeat the last line of prefix in the top candidate", async () => {
    // The last line of prefix is "  " (indent), but if we have candidates that
    // start with the exact last non-empty line they should score lower.
    const prefixWithCode = "function greet(name: string): string {\n  const greeting = 'Hello';\n  ";
    // Candidate that repeats last line vs one that doesn't
    const repetitive = "const greeting = 'Hello';  // repeated from prefix";
    const novel = "return `${greeting}, ${name}!`;\n";
    const result = await rankCompletionCandidates([repetitive, novel], prefixWithCode, suffix, language);
    // Novel candidate should score higher (no repetition bonus)
    expect(result[0]).toBe(novel);
  });
});
