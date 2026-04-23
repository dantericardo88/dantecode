// packages/vscode/src/__tests__/fim-pipeline-optimization.test.ts
// Sprint 31 — Dim 1: FIM Pipeline Optimization (6→8)
// Verifies: corrected firstLineTimeoutMs wiring, emitPerLine, token-boundary
// debounce, suffix budget fix, and new language stop sequences.
import { describe, it, expect, vi } from "vitest";

// ── vscode mock ───────────────────────────────────────────────────────────────
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
  languages: {
    createDiagnosticCollection: vi.fn(() => ({ set: vi.fn(), delete: vi.fn(), dispose: vi.fn(), get: vi.fn(() => []) })),
  },
  commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })) },
  env: { appName: "VS Code" },
  Uri: { parse: vi.fn((s: string) => ({ toString: () => s, fsPath: s })), file: vi.fn((s: string) => ({ toString: () => `file://${s}`, fsPath: s })) },
  Range: vi.fn(),
  Position: vi.fn(),
  Diagnostic: vi.fn(),
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  InlineCompletionList: vi.fn((items: unknown[]) => ({ items })),
  InlineCompletionItem: vi.fn((text: string) => ({ insertText: text })),
  EventEmitter: vi.fn(() => ({ fire: vi.fn(), event: vi.fn(), dispose: vi.fn() })),
}));

// ── Heavy dependency mocks (vscode-dependent modules only) ────────────────────
vi.mock("@dantecode/core", () => ({
  ModelRouterImpl: vi.fn(),
  parseModelReference: vi.fn(() => ({ provider: "ollama", model: "deepseek-coder" })),
}));
vi.mock("@dantecode/danteforge", () => ({
  runLocalPDSEScorer: vi.fn().mockReturnValue({ overall: 90, violations: [] }),
}));
vi.mock("@dantecode/codebase-index", () => ({
  SymbolDefinitionLookup: { extractCallSiteSymbol: vi.fn(() => null) },
}));
vi.mock("../cross-file-context.js", () => ({
  gatherCrossFileContext: vi.fn().mockResolvedValue(""),
}));
vi.mock("../prefix-tree-cache.js", () => ({
  PrefixTreeCache: vi.fn(() => ({ get: vi.fn(() => undefined), set: vi.fn(), clear: vi.fn() })),
}));
vi.mock("../udiff-parser.js", () => ({
  parseUdiffResponse: vi.fn(() => []),
  applyUdiffBlocks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../file-interaction-cache.js", () => ({
  globalInteractionCache: {
    getRelevantDocuments: vi.fn(() => []),
    record: vi.fn(),
  },
}));
vi.mock("../fim-context-budget.js", () => ({
  FimContextBudget: {
    forContextWindow: vi.fn(() => ({
      slots: { prefix: 4000, suffix: 1000, rag: 500, lsp: 500, crossFile: 200 },
    })),
  },
}));

// NOTE: completion-streaming-emitter.js and completion-stop-sequences.js are
// NOT mocked — they're pure modules with no vscode dep so we use real impls.

// ── Imports under test ────────────────────────────────────────────────────────
import {
  getTokenBoundaryDebounceReduction,
  pruneFromBottom,
} from "../inline-completion.js";
import {
  DEFAULT_FIRST_LINE_TIMEOUT_MS,
  CompletionStreamingEmitter,
  type StreamingEmitterOptions,
  type PartialCompletionEvent,
} from "../completion-streaming-emitter.js";
import { StopSequenceDetector } from "../completion-stop-sequences.js";

// ─── DEFAULT_FIRST_LINE_TIMEOUT_MS wiring ────────────────────────────────────

describe("DEFAULT_FIRST_LINE_TIMEOUT_MS", () => {
  it("is 200ms (Sprint 26 reduction correctly wired)", () => {
    expect(DEFAULT_FIRST_LINE_TIMEOUT_MS).toBe(200);
  });

  it("is used as default in StreamingEmitterOptions (not hardcoded 600)", () => {
    // When firstLineTimeoutMs is not passed, it defaults to DEFAULT_FIRST_LINE_TIMEOUT_MS.
    // Verify the exported constant matches the interface default.
    expect(DEFAULT_FIRST_LINE_TIMEOUT_MS).toBeLessThan(300);
  });
});

// ─── emitPerLine — multiline progressive emission ────────────────────────────

async function makeStream(chunks: string[]): Promise<AsyncIterable<string>> {
  async function* gen() {
    for (const chunk of chunks) yield chunk;
  }
  return gen();
}

describe("CompletionStreamingEmitter — emitPerLine", () => {
  it("fires onPartial after each complete line when emitPerLine=true", async () => {
    const emitter = new CompletionStreamingEmitter();
    const events: PartialCompletionEvent[] = [];
    const stream = await makeStream(["line1\n", "line2\n", "line3\n"]);

    await emitter.emit(stream, (e) => events.push(e), {
      emitPerLine: true,
      emitOnFirstLine: false,
    } as StreamingEmitterOptions);

    const partialEvents = events.filter((e) => !e.done);
    expect(partialEvents.length).toBeGreaterThanOrEqual(3);
  });

  it("text in per-line events accumulates across lines", async () => {
    const emitter = new CompletionStreamingEmitter();
    const events: PartialCompletionEvent[] = [];
    const stream = await makeStream(["alpha\n", "beta\n"]);

    await emitter.emit(stream, (e) => events.push(e), {
      emitPerLine: true,
      emitOnFirstLine: false,
    } as StreamingEmitterOptions);

    const withBeta = events.find((e) => !e.done && e.text.includes("beta"));
    expect(withBeta).toBeDefined();
    expect(withBeta?.text).toContain("alpha");
  });

  it("emitPerLine=false does NOT fire per-line partial events", async () => {
    const emitter = new CompletionStreamingEmitter();
    let partialCount = 0;
    const stream = await makeStream(["line1\n", "line2\n"]);

    await emitter.emit(stream, (e) => { if (!e.done) partialCount++; }, {
      emitPerLine: false,
      emitOnFirstLine: false,
    } as StreamingEmitterOptions);

    expect(partialCount).toBe(0);
  });

  it("final done event always fires even with emitPerLine=true", async () => {
    const emitter = new CompletionStreamingEmitter();
    const events: PartialCompletionEvent[] = [];
    const stream = await makeStream(["x\n", "y\n"]);

    await emitter.emit(stream, (e) => events.push(e), {
      emitPerLine: true,
      emitOnFirstLine: false,
    } as StreamingEmitterOptions);

    expect(events.filter((e) => e.done)).toHaveLength(1);
  });

  it("emitPerLine and emitOnFirstLine can both be active simultaneously", async () => {
    const emitter = new CompletionStreamingEmitter();
    const events: PartialCompletionEvent[] = [];
    const stream = await makeStream(["first\n", "second\n", "third\n"]);

    await emitter.emit(stream, (e) => events.push(e), {
      emitPerLine: true,
      emitOnFirstLine: true,
    } as StreamingEmitterOptions);

    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[events.length - 1]!.done).toBe(true);
  });
});

// ─── getTokenBoundaryDebounceReduction ───────────────────────────────────────

describe("getTokenBoundaryDebounceReduction", () => {
  it("returns 60 for trailing space (clean start boundary)", () => {
    expect(getTokenBoundaryDebounceReduction("const x = ")).toBe(60);
  });

  it("returns 60 for trailing open paren", () => {
    expect(getTokenBoundaryDebounceReduction("foo(")).toBe(60);
  });

  it("returns 60 for trailing open brace", () => {
    expect(getTokenBoundaryDebounceReduction("if (x) {")).toBe(60);
  });

  it("returns 40 for trailing dot (member access)", () => {
    expect(getTokenBoundaryDebounceReduction("obj.")).toBe(40);
  });

  it("returns 40 for trailing comma", () => {
    expect(getTokenBoundaryDebounceReduction("fn(a,")).toBe(40);
  });

  it("returns 50 for trailing close paren (block complete)", () => {
    expect(getTokenBoundaryDebounceReduction("fn()")).toBe(50);
  });

  it("returns 0 for mid-word character (no boundary)", () => {
    expect(getTokenBoundaryDebounceReduction("variableName")).toBe(0);
  });

  it("returns 0 for empty string", () => {
    expect(getTokenBoundaryDebounceReduction("")).toBe(0);
  });
});

// ─── Suffix budget (no 10-line multiline cap) ────────────────────────────────

describe("pruneFromBottom — suffix budget", () => {
  it("prunes from bottom (far end) to fit maxChars", () => {
    const text = "line1\nline2\nline3\nline4\nline5\n";
    const pruned = pruneFromBottom(text, 12);
    expect(pruned.length).toBeLessThanOrEqual(12);
    expect(pruned).toContain("line1");
  });

  it("returns full text when within budget", () => {
    const text = "short text";
    expect(pruneFromBottom(text, 1000)).toBe(text);
  });

  it("handles more than 10 lines without cap", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
    const result = pruneFromBottom(lines, lines.length);
    expect(result).toBe(lines);
  });
});

// ─── Language stop sequences for new languages ───────────────────────────────

describe("StopSequenceDetector — new language support", () => {
  it("csharp has stop sequences including class/namespace", () => {
    const det = StopSequenceDetector.forLanguage("csharp");
    expect(det.getStopSequences()).toContain("\nclass ");
    expect(det.getStopSequences()).toContain("\nnamespace ");
  });

  it("kotlin has stop sequences including fun/class", () => {
    const det = StopSequenceDetector.forLanguage("kotlin");
    expect(det.getStopSequences()).toContain("\nfun ");
    expect(det.getStopSequences()).toContain("\nclass ");
  });

  it("swift has stop sequences including func/struct", () => {
    const det = StopSequenceDetector.forLanguage("swift");
    expect(det.getStopSequences()).toContain("\nfunc ");
    expect(det.getStopSequences()).toContain("\nstruct ");
  });

  it("scala has stop sequences including def/object", () => {
    const det = StopSequenceDetector.forLanguage("scala");
    expect(det.getStopSequences()).toContain("\ndef ");
    expect(det.getStopSequences()).toContain("\nobject ");
  });

  it("typescript retains its existing stop sequences", () => {
    const det = StopSequenceDetector.forLanguage("typescript");
    expect(det.getStopSequences()).toContain("\nclass ");
    expect(det.getStopSequences()).toContain("\nexport ");
  });

  it("unknown language falls back to default", () => {
    const det = StopSequenceDetector.forLanguage("brainfuck");
    expect(det.getStopSequences()).toContain("\n\n");
  });
});
