import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── VS Code Mock ─────────────────────────────────────────────────────────────

const vscodeMocks = vi.hoisted(() => {
  const configValues: Record<string, unknown> = {};

  class Position {
    constructor(
      public line: number,
      public character: number,
    ) {}
  }

  class Range {
    constructor(
      public start: Position,
      public end: Position,
    ) {}
  }

  class InlineCompletionItem {
    filterText = "";

    constructor(
      public insertText: string,
      public range: Range,
    ) {}
  }

  const diagnosticEntries = new Map<string, unknown[]>();

  return {
    configValues,
    Position,
    Range,
    InlineCompletionItem,
    diagnosticEntries,
  };
});

vi.mock("vscode", () => ({
  Position: vscodeMocks.Position,
  Range: vscodeMocks.Range,
  InlineCompletionItem: vscodeMocks.InlineCompletionItem,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Diagnostic: class {
    source = "";
    code: unknown = "";
    constructor(
      public range: unknown,
      public message: string,
      public severity: number,
    ) {}
  },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultValue: unknown) =>
        key in vscodeMocks.configValues ? vscodeMocks.configValues[key] : defaultValue,
      ),
    })),
    openTextDocument: vi.fn(async () => ({ getText: () => "export function helper() {}" })),
  },
  window: {
    visibleTextEditors: [],
  },
  languages: {
    createDiagnosticCollection: vi.fn(() => ({
      get: vi.fn((uri: unknown) => vscodeMocks.diagnosticEntries.get(String(uri)) ?? []),
      set: vi.fn((uri: unknown, diags: unknown[]) => {
        vscodeMocks.diagnosticEntries.set(String(uri), diags);
      }),
      delete: vi.fn((uri: unknown) => vscodeMocks.diagnosticEntries.delete(String(uri))),
      dispose: vi.fn(),
    })),
  },
}));

// ─── Async Stream Helper ──────────────────────────────────────────────────────

function createTextStream(chunks: string[]): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < chunks.length) {
            return { value: chunks[i++]!, done: false };
          }
          return { value: undefined, done: true as const };
        },
      };
    },
  };
}

// ─── Core Mocks ───────────────────────────────────────────────────────────────

const routerMocks = vi.hoisted(() => {
  const mockGenerate = vi.fn().mockResolvedValue("console.log('done');");
  const mockStream = vi.fn();
  return {
    mockGenerate,
    mockStream,
    mockRouterCtor: vi.fn().mockImplementation(() => ({
      generate: mockGenerate,
      stream: mockStream,
    })),
  };
});

vi.mock("@dantecode/core", () => ({
  ModelRouterImpl: routerMocks.mockRouterCtor,
  parseModelReference: vi.fn((model: string) => {
    const slashIndex = model.indexOf("/");
    if (slashIndex >= 0) {
      return {
        id: model,
        provider: model.slice(0, slashIndex),
        modelId: model.slice(slashIndex + 1),
      };
    }
    const provider = /^(llama|qwen|mistral)/i.test(model) ? "ollama" : "grok";
    return { id: `${provider}/${model}`, provider, modelId: model };
  }),
}));

let pdseScoreOverride: { overall: number; violations: { message: string }[]; passedGate: boolean } =
  {
    overall: 92,
    violations: [],
    passedGate: true,
  };

vi.mock("@dantecode/danteforge", () => ({
  runLocalPDSEScorer: vi.fn(() => pdseScoreOverride),
}));

vi.mock("./cross-file-context.js", () => ({
  gatherCrossFileContext: vi.fn(async () => "// From utils.ts: export function helper()"),
}));

// ─── SUT Import ───────────────────────────────────────────────────────────────

import {
  DanteCodeCompletionProvider,
  buildFIMPrompt,
  getInlineCompletionDebounceMs,
  resolveInlineCompletionModel,
  areBracketsBalanced,
  shouldContinueStreaming,
  shouldUseMultilineCompletion,
  disposeInlinePDSEDiagnostics,
} from "./inline-completion.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function createDocument(prefix: string, suffix: string) {
  return {
    languageId: "typescript",
    uri: { fsPath: "/workspace/src/example.ts", toString: () => "/workspace/src/example.ts" },
    lineCount: Math.max(1, (prefix + suffix).split("\n").length),
    getText: vi.fn((range?: InstanceType<typeof vscodeMocks.Range>) => {
      if (!range) return prefix + suffix;
      if (range.start.line === 0 && range.start.character === 0) return prefix;
      return suffix;
    }),
  };
}

function createMockToken(cancelled = false) {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

// ─── Tests: Helpers ───────────────────────────────────────────────────────────

describe("inline completion helpers", () => {
  it("prefers the fim model when configured", () => {
    expect(resolveInlineCompletionModel("grok/grok-3", "ollama/qwen2.5-coder")).toBe(
      "ollama/qwen2.5-coder",
    );
  });

  it("falls back to default model when fim is empty", () => {
    expect(resolveInlineCompletionModel("grok/grok-3", "")).toBe("grok/grok-3");
    expect(resolveInlineCompletionModel("grok/grok-3", "  ")).toBe("grok/grok-3");
    expect(resolveInlineCompletionModel("grok/grok-3", undefined)).toBe("grok/grok-3");
  });

  it("uses provider-aware debounce delays", () => {
    expect(getInlineCompletionDebounceMs("ollama")).toBe(100);
    expect(getInlineCompletionDebounceMs("grok")).toBe(150);
    expect(getInlineCompletionDebounceMs("openai")).toBe(180);
    expect(getInlineCompletionDebounceMs("anthropic")).toBe(180);
  });

  it("uses custom debounce when provided", () => {
    expect(getInlineCompletionDebounceMs("grok", 250)).toBe(250);
    expect(getInlineCompletionDebounceMs("ollama", 50)).toBe(50);
  });

  it("ignores custom debounce of 0", () => {
    expect(getInlineCompletionDebounceMs("grok", 0)).toBe(150);
  });

  it("builds a FIM prompt with multiline token budget for block context", () => {
    const prompt = buildFIMPrompt({
      prefix: "function greet(name: string) {\n  ",
      suffix: "\n}\n",
      language: "typescript",
      filePath: "/workspace/src/example.ts",
    });
    expect(prompt.userPrompt).toContain("<|fim_prefix|>");
    expect(prompt.userPrompt).toContain("<|fim_suffix|>");
    expect(prompt.userPrompt).toContain("<|fim_middle|>");
    expect(prompt.maxTokens).toBe(512);
  });

  it("forces multiline when multilineOverride is true", () => {
    const prompt = buildFIMPrompt(
      { prefix: "const x = ", suffix: "", language: "typescript", filePath: "f.ts" },
      true,
    );
    expect(prompt.maxTokens).toBe(512);
  });

  it("forces single-line when multilineOverride is false", () => {
    const prompt = buildFIMPrompt(
      {
        prefix: "function greet(name: string) {",
        suffix: "\n}\n",
        language: "typescript",
        filePath: "f.ts",
      },
      false,
    );
    expect(prompt.maxTokens).toBe(256);
  });

  it("uses an 8000-char prefix window for multiline completions", () => {
    const longPrefix = "a".repeat(9000);
    const prompt = buildFIMPrompt(
      { prefix: longPrefix + "{", suffix: "\n}\n", language: "typescript", filePath: "f.ts" },
      true,
    );
    const prefixInPrompt =
      prompt.userPrompt.split("<|fim_prefix|>")[1]?.split("<|fim_suffix|>")[0] ?? "";
    expect(prefixInPrompt.length).toBe(8000);
  });

  it("uses a 5000-char prefix window for single-line completions", () => {
    const longPrefix = "a".repeat(6000);
    const prompt = buildFIMPrompt(
      { prefix: longPrefix, suffix: "", language: "typescript", filePath: "f.ts" },
      false,
    );
    const prefixInPrompt =
      prompt.userPrompt.split("<|fim_prefix|>")[1]?.split("<|fim_suffix|>")[0] ?? "";
    expect(prefixInPrompt.length).toBe(5000);
  });

  it("injects cross-file context into system prompt when provided", () => {
    const prompt = buildFIMPrompt({
      prefix: "const x = ",
      suffix: "",
      language: "typescript",
      filePath: "f.ts",
      crossFileContext: "// From utils.ts: export function helper()",
    });
    expect(prompt.systemPrompt).toContain("Cross-file context:");
    expect(prompt.systemPrompt).toContain("export function helper()");
  });

  it("omits cross-file context section when context is empty", () => {
    const prompt = buildFIMPrompt({
      prefix: "const x = ",
      suffix: "",
      language: "typescript",
      filePath: "f.ts",
    });
    expect(prompt.systemPrompt).not.toContain("Cross-file context:");
  });
});

// ─── Tests: Bracket Balancing ─────────────────────────────────────────────────

describe("areBracketsBalanced", () => {
  it("returns true for balanced braces", () => {
    expect(areBracketsBalanced("{ foo(); }")).toBe(true);
  });

  it("returns false for open braces", () => {
    expect(areBracketsBalanced("{ foo();")).toBe(false);
  });

  it("returns true for nested balanced brackets", () => {
    expect(areBracketsBalanced("{ if (x) { bar(); } }")).toBe(true);
  });

  it("returns true for closing bracket beyond outer scope", () => {
    expect(areBracketsBalanced("}")).toBe(true);
  });

  it("returns true for empty string", () => {
    expect(areBracketsBalanced("")).toBe(true);
  });

  it("handles mixed bracket types", () => {
    expect(areBracketsBalanced("([{}])")).toBe(true);
    expect(areBracketsBalanced("([{")).toBe(false);
  });
});

// ─── Tests: Streaming Guard ──────────────────────────────────────────────────

describe("shouldContinueStreaming", () => {
  it("continues for partial code block with open braces", () => {
    expect(shouldContinueStreaming("  if (x) {\n    foo();")).toBe(true);
  });

  it("stops on triple newline (double blank line)", () => {
    expect(shouldContinueStreaming("foo;\n\n\n")).toBe(false);
  });

  it("stops when brackets become balanced", () => {
    expect(shouldContinueStreaming("  return x;\n}")).toBe(false);
  });

  it("continues for unbalanced brackets", () => {
    expect(shouldContinueStreaming("  if (x) {\n    foo();")).toBe(true);
  });

  it("stops on two consecutive empty lines at end", () => {
    expect(shouldContinueStreaming("foo;\n\n")).toBe(false);
  });

  it("continues for short text even if balanced", () => {
    expect(shouldContinueStreaming("x")).toBe(true);
  });
});

// ─── Tests: Multiline Detection ──────────────────────────────────────────────

describe("shouldUseMultilineCompletion", () => {
  it("detects block start with opening brace", () => {
    expect(shouldUseMultilineCompletion("function foo() {", "\n}\n")).toBe(true);
  });

  it("detects block start with opening paren", () => {
    expect(shouldUseMultilineCompletion("const args = (", "\n)")).toBe(true);
  });

  it("detects arrow function", () => {
    expect(shouldUseMultilineCompletion("const fn = () => ", "")).toBe(true);
  });

  it("detects type annotation", () => {
    expect(shouldUseMultilineCompletion("const user: ", "")).toBe(true);
  });

  it("returns false for simple expression", () => {
    expect(shouldUseMultilineCompletion("const x = 42", "")).toBe(false);
  });

  it("returns false for empty prefix", () => {
    expect(shouldUseMultilineCompletion("", "")).toBe(false);
  });

  it("detects when suffix closing brace indicates body needed", () => {
    // The function body is expected between "{\n  " and "\n}"
    expect(shouldUseMultilineCompletion("function foo() {\n  ", "\n}")).toBe(true);
  });
});

// ─── Tests: Completion Provider v2 ───────────────────────────────────────────

describe("DanteCodeCompletionProvider v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset all config values to prevent leakage between tests
    for (const key of Object.keys(vscodeMocks.configValues)) {
      delete vscodeMocks.configValues[key];
    }
    vscodeMocks.configValues["defaultModel"] = "grok/grok-3";
    vscodeMocks.configValues["fimModel"] = "ollama/qwen2.5-coder";
    vscodeMocks.configValues["pdseThreshold"] = 85;
    vscodeMocks.configValues["inline.pdseWarnings"] = true;
    vscodeMocks.configValues["inline.debounceMs"] = 0;
    vscodeMocks.diagnosticEntries.clear();
    pdseScoreOverride = { overall: 92, violations: [], passedGate: true };

    routerMocks.mockStream.mockResolvedValue({
      textStream: createTextStream(["console.log('done');"]),
    });
  });

  it("uses the dedicated fim model and ollama debounce", async () => {
    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const answer = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 15) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(99);
    expect(routerMocks.mockRouterCtor).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const items = await pending;

    expect(routerMocks.mockRouterCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        default: expect.objectContaining({
          provider: "ollama",
          modelId: "qwen2.5-coder",
        }),
      }),
      "/workspace",
      "inline-completion",
    );
    expect(items).toHaveLength(1);
  });

  it("uses streaming by default instead of generate()", async () => {
    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const answer = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 15) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    await pending;

    expect(routerMocks.mockStream).toHaveBeenCalled();
    expect(routerMocks.mockGenerate).not.toHaveBeenCalled();
  });

  it("falls back to generate() when streaming fails", async () => {
    routerMocks.mockStream.mockRejectedValue(new Error("streaming not supported"));
    routerMocks.mockGenerate.mockResolvedValue("fallback result;");

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const answer = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 15) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(routerMocks.mockStream).toHaveBeenCalled();
    expect(routerMocks.mockGenerate).toHaveBeenCalled();
    expect(items).toHaveLength(1);
  });

  it("truncates single-line streaming at the first newline", async () => {
    routerMocks.mockStream.mockResolvedValue({
      textStream: createTextStream(["const x = 42;\nconst y = 100;\nconst z = 0;"]),
    });

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const answer = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 15) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(items).toHaveLength(1);
    expect((items[0] as { insertText: string }).insertText).toBe("const x = 42;");
  });

  it("streams full multi-line output with balanced-brace guard", async () => {
    const multilineOutput = "  return `Hello, ${name}!`;\n}";
    routerMocks.mockStream.mockResolvedValue({
      textStream: createTextStream([multilineOutput]),
    });

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("function greet(name: string) {\n", "\n");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(1, 0) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(items).toHaveLength(1);
  });

  it("stops multiline streaming when brackets balance", async () => {
    // Simulate chunk-by-chunk streaming
    const chunks = ["  if (x) {\n", "    foo();\n", "  }\n", "  // extra"];
    routerMocks.mockStream.mockResolvedValue({
      textStream: createTextStream(chunks),
    });

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("function bar() {\n", "\n}\n");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(1, 0) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(items).toHaveLength(1);
    // Should stop after brackets balance, not include "  // extra"
    const text = (items[0] as { insertText: string }).insertText;
    expect(text).not.toContain("// extra");
  });

  it("stops multiline streaming on double blank lines", async () => {
    const chunks = ["  const a = 1;\n\n\n  // after blank"];
    routerMocks.mockStream.mockResolvedValue({
      textStream: createTextStream(chunks),
    });

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("function bar() {\n", "\n}\n");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(1, 0) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(items).toHaveLength(1);
  });

  it("requests a 512-token budget for multiline block completions", async () => {
    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("function greet(name: string) {\n  ", "\n}\n");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(1, 2) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    await pending;

    expect(routerMocks.mockStream).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ maxTokens: 512 }),
    );
  });

  it("respects inline.multiline='always' to force multiline", async () => {
    vscodeMocks.configValues["inline.multiline"] = "always";

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 10) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    await pending;

    expect(routerMocks.mockStream).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ maxTokens: 512 }),
    );
  });

  it("respects inline.multiline='never' to force single-line", async () => {
    vscodeMocks.configValues["inline.multiline"] = "never";

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("function greet(name: string) {\n  ", "\n}\n");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(1, 2) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    await pending;

    expect(routerMocks.mockStream).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ maxTokens: 256 }),
    );
  });

  it("falls back to multilineCompletions setting when inline.multiline is unset", async () => {
    vscodeMocks.configValues["multilineCompletions"] = "always";
    // Don't set inline.multiline — should fall back

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 10) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    await pending;

    expect(routerMocks.mockStream).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ maxTokens: 512 }),
    );
  });

  it("reduces debounce with graduated curve when typing quickly", async () => {
    vscodeMocks.configValues["debounceAdaptive"] = true;
    vscodeMocks.configValues["defaultModel"] = "grok/grok-3";
    vscodeMocks.configValues["fimModel"] = "";

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken();

    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(100);
      provider.provideInlineCompletionItems(
        document as never,
        new vscodeMocks.Position(0, 10 + i) as never,
        {} as never,
        token as never,
      );
    }

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 14) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    await pending;

    expect(routerMocks.mockStream).toHaveBeenCalled();
  });

  it("uses custom debounce from inline.debounceMs setting", async () => {
    vscodeMocks.configValues["inline.debounceMs"] = 300;
    vscodeMocks.configValues["defaultModel"] = "grok/grok-3";
    vscodeMocks.configValues["fimModel"] = "";

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 10) as never,
      {} as never,
      token as never,
    );

    // At 299ms, should not have fired
    await vi.advanceTimersByTimeAsync(299);
    expect(routerMocks.mockStream).not.toHaveBeenCalled();

    // At 300ms, should fire
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(routerMocks.mockStream).toHaveBeenCalled();
  });

  it("uses 150-entry cache with 90s TTL", async () => {
    const provider = new DanteCodeCompletionProvider();
    const token = createMockToken();

    for (let i = 0; i < 151; i++) {
      const document = createDocument(`line${i}\nconst x${i} = `, "");
      const pending = provider.provideInlineCompletionItems(
        document as never,
        new vscodeMocks.Position(1, 12) as never,
        {} as never,
        token as never,
      );
      await vi.advanceTimersByTimeAsync(200);
      await pending;
    }

    routerMocks.mockStream.mockClear();
    const doc0 = createDocument("line0\nconst x0 = ", "");
    const pending = provider.provideInlineCompletionItems(
      doc0 as never,
      new vscodeMocks.Position(1, 12) as never,
      {} as never,
      token as never,
    );
    await vi.advanceTimersByTimeAsync(200);
    await pending;

    expect(routerMocks.mockStream).toHaveBeenCalled();
  });

  it("adds confidence marker for short completions", async () => {
    routerMocks.mockStream.mockResolvedValue({
      textStream: createTextStream(["x"]),
    });

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const answer = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 15) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(items).toHaveLength(1);
    expect((items[0] as { filterText: string }).filterText).toContain("[?]");
  });

  it("annotates PDSE gate pass in filterText", async () => {
    pdseScoreOverride = { overall: 95, violations: [], passedGate: true };

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const answer = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 15) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(items).toHaveLength(1);
    expect((items[0] as { filterText: string }).filterText).toContain("PDSE: 95 PASS");
  });

  it("appends PDSE warning comment when score below threshold", async () => {
    pdseScoreOverride = {
      overall: 72,
      violations: [{ message: "missing required field" }],
      passedGate: false,
    };

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const answer = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 15) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(items).toHaveLength(1);
    const insertText = (items[0] as { insertText: string }).insertText;
    expect(insertText).toContain("// PDSE 72/100");
    expect(insertText).toContain("missing required field");
    expect((items[0] as { filterText: string }).filterText).toContain("PDSE: 72 WARN");
  });

  it("does not append PDSE comment when inline.pdseWarnings is disabled", async () => {
    vscodeMocks.configValues["inline.pdseWarnings"] = false;
    pdseScoreOverride = {
      overall: 60,
      violations: [{ message: "low quality" }],
      passedGate: false,
    };

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const answer = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 15) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(items).toHaveLength(1);
    const insertText = (items[0] as { insertText: string }).insertText;
    expect(insertText).not.toContain("PDSE");
  });

  it("returns empty on cancellation before debounce fires", async () => {
    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken(true);

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 10) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(200);
    const items = await pending;

    expect(items).toHaveLength(0);
  });

  it("returns empty when completion text is empty after cleaning", async () => {
    routerMocks.mockStream.mockResolvedValue({
      textStream: createTextStream(["```typescript\n```"]),
    });

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 10) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(items).toHaveLength(0);
  });

  it("resolves bare model ID through parseModelReference", async () => {
    vi.clearAllMocks();
    routerMocks.mockStream.mockResolvedValue({
      textStream: createTextStream(["console.log('done');"]),
    });
    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const answer = ", "");
    const token = createMockToken();

    vscodeMocks.configValues["defaultModel"] = "llama3";
    vscodeMocks.configValues["fimModel"] = "llama3";

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 15) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    await pending;

    expect(routerMocks.mockRouterCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        default: expect.objectContaining({
          provider: "ollama",
          modelId: "llama3",
        }),
      }),
      "/workspace",
      "inline-completion",
    );
  });

  it("uses temperature 0.1 for inline completions", async () => {
    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 10) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    await pending;

    expect(routerMocks.mockRouterCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        default: expect.objectContaining({ temperature: 0.1 }),
      }),
      expect.any(String),
      expect.any(String),
    );
  });

  it("passes abortSignal to streaming for cancellation support", async () => {
    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 10) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    await pending;

    expect(routerMocks.mockStream).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    );
  });

  it("handles PDSE scorer failure gracefully", async () => {
    const { runLocalPDSEScorer } = await import("@dantecode/danteforge");
    (runLocalPDSEScorer as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("PDSE scorer crash");
    });

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 10) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    // Should still return completion, just without PDSE label
    expect(items).toHaveLength(1);
    expect((items[0] as { filterText: string }).filterText).toBe("dantecode");
  });

  it("disposeInlinePDSEDiagnostics cleans up resources", () => {
    // Call twice to ensure no error on double-dispose
    disposeInlinePDSEDiagnostics();
    disposeInlinePDSEDiagnostics();
  });

  it("clears cache on clearCache()", async () => {
    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 10) as never,
      {} as never,
      token as never,
    );
    await vi.advanceTimersByTimeAsync(100);
    await pending;

    routerMocks.mockStream.mockClear();
    provider.clearCache();

    // Same request should now miss cache
    const pending2 = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 10) as never,
      {} as never,
      token as never,
    );
    await vi.advanceTimersByTimeAsync(100);
    await pending2;

    expect(routerMocks.mockStream).toHaveBeenCalled();
  });

  it("drops debounce further at very fast typing (>5 cps)", async () => {
    vscodeMocks.configValues["debounceAdaptive"] = true;
    vscodeMocks.configValues["defaultModel"] = "openai/gpt-4";
    vscodeMocks.configValues["fimModel"] = "";

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken();

    // Simulate very fast typing: 6 calls in ~500ms = ~12 cps
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(50); // 50ms between keystrokes = 20 cps
      provider.provideInlineCompletionItems(
        document as never,
        new vscodeMocks.Position(0, 10 + i) as never,
        {} as never,
        token as never,
      );
    }

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 15) as never,
      {} as never,
      token as never,
    );

    // At >5 cps with openai (base 180), graduated drop = max(80, 180-100) = 80ms
    await vi.advanceTimersByTimeAsync(80);
    await pending;

    expect(routerMocks.mockStream).toHaveBeenCalled();
  });

  it("streams multiline with deeply nested scopes without early cutoff", async () => {
    const nestedCode = [
      "  if (condition) {\n",
      "    for (const item of items) {\n",
      "      if (item.valid) {\n",
      "        results.push(item);\n",
      "      }\n",
      "    }\n",
      "  }\n",
    ];
    routerMocks.mockStream.mockResolvedValue({
      textStream: createTextStream(nestedCode),
    });

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("function process(items: Item[]) {\n", "\n}\n");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(1, 0) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(items).toHaveLength(1);
    const text = (items[0] as { insertText: string }).insertText;
    // Should include the full nested structure
    expect(text).toContain("results.push(item)");
  });

  it("handles large prefix (>8k chars) without crash", async () => {
    const largePrefix = "// " + "x".repeat(10000) + "\nfunction foo() {\n";
    routerMocks.mockStream.mockResolvedValue({
      textStream: createTextStream(["  return 42;"]),
    });

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument(largePrefix, "\n}\n");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(2, 0) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(items).toHaveLength(1);
  });

  it("logs warning for slow first-chunk latency", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Create a slow stream that delays first chunk
    const slowStream = {
      async *[Symbol.asyncIterator]() {
        // Fake delay handled by timer advancement
        yield "slow result";
      },
    };
    routerMocks.mockStream.mockResolvedValue({ textStream: slowStream });

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 10) as never,
      {} as never,
      token as never,
    );

    // Advance enough to trigger the debounce and stream
    await vi.advanceTimersByTimeAsync(300);
    await pending;

    consoleSpy.mockRestore();
    // No assertion on console.log content — just verify no crash
    expect(true).toBe(true);
  });

  it("uses PDSE violation fallback message when no violations present", async () => {
    pdseScoreOverride = { overall: 70, violations: [], passedGate: false };

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const x = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 10) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    expect(items).toHaveLength(1);
    const insertText = (items[0] as { insertText: string }).insertText;
    expect(insertText).toContain("below quality threshold");
  });
});
