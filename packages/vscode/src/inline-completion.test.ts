import { beforeEach, describe, expect, it, vi } from "vitest";

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

  return {
    configValues,
    Position,
    Range,
    InlineCompletionItem,
  };
});

vi.mock("vscode", () => ({
  Position: vscodeMocks.Position,
  Range: vscodeMocks.Range,
  InlineCompletionItem: vscodeMocks.InlineCompletionItem,
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultValue: unknown) =>
        key in vscodeMocks.configValues ? vscodeMocks.configValues[key] : defaultValue,
      ),
    })),
  },
}));

/**
 * Helper: creates an async iterable that yields the given chunks sequentially.
 */
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
    return {
      id: `${provider}/${model}`,
      provider,
      modelId: model,
    };
  }),
}));

vi.mock("@dantecode/danteforge", () => ({
  runLocalPDSEScorer: vi.fn(() => ({ overall: 92 })),
}));

import {
  DanteCodeCompletionProvider,
  buildFIMPrompt,
  getInlineCompletionDebounceMs,
  resolveInlineCompletionModel,
} from "./inline-completion.js";

function createDocument(prefix: string, suffix: string) {
  return {
    languageId: "typescript",
    uri: { fsPath: "/workspace/src/example.ts" },
    lineCount: Math.max(1, (prefix + suffix).split("\n").length),
    getText: vi.fn((range?: InstanceType<typeof vscodeMocks.Range>) => {
      if (!range) {
        return prefix + suffix;
      }
      if (range.start.line === 0 && range.start.character === 0) {
        return prefix;
      }
      return suffix;
    }),
  };
}

/**
 * Creates a mock cancellation token compatible with the provider's usage,
 * including the `onCancellationRequested` disposable pattern.
 */
function createMockToken(cancelled = false) {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

describe("inline completion helpers", () => {
  it("prefers the fim model when configured", () => {
    expect(resolveInlineCompletionModel("grok/grok-3", "ollama/qwen2.5-coder")).toBe(
      "ollama/qwen2.5-coder",
    );
  });

  it("parses bare local model IDs as ollama models", async () => {
    vi.useFakeTimers();
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

  it("uses provider-aware debounce delays", () => {
    expect(getInlineCompletionDebounceMs("ollama")).toBe(100);
    expect(getInlineCompletionDebounceMs("grok")).toBe(150);
    expect(getInlineCompletionDebounceMs("openai")).toBe(200);
  });

  it("builds a FIM prompt with multiline token budget when block context is detected", () => {
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
      {
        prefix: "const x = ",
        suffix: "",
        language: "typescript",
        filePath: "/workspace/src/example.ts",
      },
      true,
    );

    // Multiline mode uses 512 tokens
    expect(prompt.maxTokens).toBe(512);
  });

  it("forces single-line when multilineOverride is false", () => {
    // This prefix normally triggers multiline (ends with `{`)
    const prompt = buildFIMPrompt(
      {
        prefix: "function greet(name: string) {",
        suffix: "\n}\n",
        language: "typescript",
        filePath: "/workspace/src/example.ts",
      },
      false,
    );

    // Single-line mode uses 256 tokens
    expect(prompt.maxTokens).toBe(256);
  });

  it("uses a 6000-char prefix window for multiline completions", () => {
    const longPrefix = "a".repeat(7000);
    const prompt = buildFIMPrompt(
      {
        prefix: longPrefix + "{",
        suffix: "\n}\n",
        language: "typescript",
        filePath: "/workspace/src/example.ts",
      },
      true,
    );

    // The prompt should contain the last 6000 chars of the prefix
    const prefixInPrompt = prompt.userPrompt.split("<|fim_prefix|>")[1]?.split("<|fim_suffix|>")[0] ?? "";
    expect(prefixInPrompt.length).toBe(6000);
  });
});

describe("DanteCodeCompletionProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vscodeMocks.configValues["defaultModel"] = "grok/grok-3";
    vscodeMocks.configValues["fimModel"] = "ollama/qwen2.5-coder";
    vscodeMocks.configValues["pdseThreshold"] = 85;
    // Default streaming mock
    routerMocks.mockStream.mockResolvedValue({
      textStream: createTextStream(["console.log('done');"]),
    });
  });

  it("uses the dedicated fim model and ollama debounce for completion requests", async () => {
    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("const answer = ", "");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(0, 15) as never,
      {} as never,
      token as never,
    );

    // Ollama debounce is now 100ms
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

    // Stream should be called instead of generate
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
    // Should only include the first line (before the newline)
    expect((items[0] as { insertText: string }).insertText).toBe("const x = 42;");
  });

  it("keeps full multi-line streaming output when context is multiline", async () => {
    const multilineOutput = "  return `Hello, ${name}!`;\n";
    routerMocks.mockStream.mockResolvedValue({
      textStream: createTextStream([multilineOutput]),
    });

    const provider = new DanteCodeCompletionProvider();
    const document = createDocument("function greet(name: string) {\n", "\n}\n");
    const token = createMockToken();

    const pending = provider.provideInlineCompletionItems(
      document as never,
      new vscodeMocks.Position(1, 0) as never,
      {} as never,
      token as never,
    );

    await vi.advanceTimersByTimeAsync(100);
    const items = await pending;

    // Multiline context: should consume the full stream
    expect(items).toHaveLength(1);
  });

  it("requests a 512-token completion budget for multiline block completions", async () => {
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
      expect.objectContaining({
        maxTokens: 512,
      }),
    );
  });

  it("respects multilineCompletions='always' config to force multiline", async () => {
    vscodeMocks.configValues["multilineCompletions"] = "always";

    const provider = new DanteCodeCompletionProvider();
    // Simple single-line context that would normally be single-line
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

    // With "always" config, should request 512 tokens (multiline budget)
    expect(routerMocks.mockStream).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        maxTokens: 512,
      }),
    );
  });

  it("respects multilineCompletions='never' config to force single-line", async () => {
    vscodeMocks.configValues["multilineCompletions"] = "never";

    const provider = new DanteCodeCompletionProvider();
    // Block context that would normally trigger multiline
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

    // With "never" config, should request 256 tokens (single-line budget)
    expect(routerMocks.mockStream).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        maxTokens: 256,
      }),
    );
  });
});
