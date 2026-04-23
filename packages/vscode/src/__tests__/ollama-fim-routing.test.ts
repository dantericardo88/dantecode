// ============================================================================
// Sprint C — Dim 1: Ollama FIM routing tests
// Proves: isOllamaFimModel detection, ollamaFimGenerate native /api/generate call
// ============================================================================

import { describe, it, expect, vi } from "vitest";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({ get: (_k: string, d: unknown) => d })),
    workspaceFolders: [],
    fs: { readFile: vi.fn(), writeFile: vi.fn(), delete: vi.fn() },
  },
  window: { showTextDocument: vi.fn(), showInformationMessage: vi.fn() },
  ViewColumn: { Beside: 2 },
  Uri: { file: vi.fn((p: string) => ({ fsPath: p })) },
  Range: class { constructor(public a: unknown, public b: unknown) {} },
  Position: class { constructor(public line: number, public character: number) {} },
}));

vi.mock("@dantecode/core", () => ({
  ModelRouterImpl: class { stream = vi.fn().mockResolvedValue({ textStream: (async function* () { yield ""; })() }); },
  parseModelReference: vi.fn((s: string) => { const [p, ...r] = s.split("/"); return { provider: p, modelId: r.join("/") }; }),
  estimateTokens: vi.fn(() => 10),
  truncateToolOutput: vi.fn((s: string) => s),
}));
vi.mock("@dantecode/danteforge", () => ({ runLocalPDSEScorer: vi.fn(() => ({ overall: 90, passedGate: true })) }));
vi.mock("@dantecode/codebase-index", () => ({ SymbolDefinitionLookup: class { find = vi.fn().mockResolvedValue(null); } }));
vi.mock("../cross-file-context.js", () => ({ gatherCrossFileContext: vi.fn().mockResolvedValue("") }));
vi.mock("../prefix-tree-cache.js", () => ({ PrefixTreeCache: class { get = vi.fn().mockReturnValue(null); set = vi.fn(); } }));
vi.mock("../udiff-parser.js", () => ({ parseUdiffResponse: vi.fn(() => []) }));
vi.mock("../completion-streaming-emitter.js", () => ({
  globalEmitterRegistry: { startFor: vi.fn(() => ({ emit: vi.fn().mockResolvedValue(""), abort: vi.fn() })) },
  DEFAULT_FIRST_LINE_TIMEOUT_MS: 200,
}));
vi.mock("../completion-stop-sequences.js", () => ({
  StopSequenceDetector: { forLanguage: vi.fn(() => ({ check: vi.fn(() => ({ stop: false })) })) },
  BracketBalanceDetector: class { check = vi.fn(() => ({ balanced: false })); },
}));
vi.mock("../fim-context-budget.js", () => ({
  FimContextBudget: { forContextWindow: vi.fn(() => ({ slots: { prefix: 4096, suffix: 1024, lsp: 512, rag: 512, crossFile: 256 } })) },
}));
vi.mock("../file-interaction-cache.js", () => ({ globalInteractionCache: { get: vi.fn(() => null), set: vi.fn() } }));

import { isOllamaFimModel, ollamaFimGenerate } from "../inline-completion.js";

// ── isOllamaFimModel ──────────────────────────────────────────────────────────

describe("isOllamaFimModel", () => {
  it("returns true for deepseek-coder model", () => {
    expect(isOllamaFimModel("deepseek-coder:6.7b")).toBe(true);
  });

  it("returns true for starcoder2 model", () => {
    expect(isOllamaFimModel("starcoder2:3b")).toBe(true);
  });

  it("returns true for codellama model", () => {
    expect(isOllamaFimModel("codellama:7b-code")).toBe(true);
  });

  it("returns true for qwen2.5-coder model", () => {
    expect(isOllamaFimModel("qwen2.5-coder:0.5b")).toBe(true);
  });

  it("returns false for llama3 (not a FIM model)", () => {
    expect(isOllamaFimModel("llama3:8b")).toBe(false);
  });

  it("returns false for mistral (chat model)", () => {
    expect(isOllamaFimModel("mistral:7b")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isOllamaFimModel("DeepSeek-Coder:6.7B")).toBe(true);
    expect(isOllamaFimModel("CodeLLaMA")).toBe(true);
  });
});

// ── ollamaFimGenerate ─────────────────────────────────────────────────────────

function ndjsonChunk(...tokens: string[]): Uint8Array {
  const lines = tokens.map((t, i) =>
    JSON.stringify({ response: t, done: i === tokens.length - 1 })
  ).join("\n");
  return new TextEncoder().encode(lines + "\n");
}

function makeMockFetch(chunks: Uint8Array[]): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    body: {
      getReader: () => {
        let idx = 0;
        return {
          read: async () => {
            if (idx < chunks.length) {
              return { done: false, value: chunks[idx++] };
            }
            return { done: true, value: undefined };
          },
          releaseLock: vi.fn(),
        };
      },
    },
  } as unknown as Response);
}

describe("ollamaFimGenerate", () => {
  it("calls Ollama /api/generate with correct model and stream:true", async () => {
    const mockFetch = makeMockFetch([ndjsonChunk("result", "")]);
    await ollamaFimGenerate(
      "http://localhost:11434",
      "deepseek-coder:6.7b",
      "function greet() {\n  ",
      "\n}",
      256,
      undefined,
      mockFetch,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"stream":true'),
      }),
    );
  });

  it("assembles streamed tokens into a single string", async () => {
    const mockFetch = makeMockFetch([ndjsonChunk("return ", "42;", "")]);
    const result = await ollamaFimGenerate(
      "http://localhost:11434",
      "deepseek-coder:6.7b",
      "const x = ",
      ";",
      64,
      undefined,
      mockFetch,
    );
    expect(result).toBe("return 42;");
  });

  it("includes FIM-formatted prompt in request body", async () => {
    const mockFetch = makeMockFetch([ndjsonChunk("x = 1", "")]);
    await ollamaFimGenerate(
      "http://localhost:11434",
      "deepseek-coder:6.7b",
      "prefix_code",
      "suffix_code",
      128,
      undefined,
      mockFetch,
    );
    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(callArgs[1].body as string) as { prompt: string };
    // DeepSeek FIM format
    expect(body.prompt).toContain("<|fim_begin|>");
    expect(body.prompt).toContain("prefix_code");
    expect(body.prompt).toContain("<|fim_hole|>");
    expect(body.prompt).toContain("suffix_code");
  });

  it("throws when Ollama returns non-OK response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      body: null,
    } as unknown as Response);
    await expect(
      ollamaFimGenerate("http://localhost:11434", "codellama:7b", "a", "b", 64, undefined, mockFetch),
    ).rejects.toThrow("503");
  });

  it("strips trailing FIM tokens from model output", async () => {
    // Model sometimes echoes the stop token in the response
    const mockFetch = makeMockFetch([ndjsonChunk("const y = 2<|fim_end|>", "")]);
    const result = await ollamaFimGenerate(
      "http://localhost:11434",
      "deepseek-coder:6.7b",
      "let x = 1\n",
      "\nconsole.log(x)",
      64,
      undefined,
      mockFetch,
    );
    expect(result).not.toContain("<|fim_end|>");
    expect(result).toContain("const y = 2");
  });

  it("respects AbortSignal and forwards it to fetch", async () => {
    const controller = new AbortController();
    const mockFetch = makeMockFetch([ndjsonChunk("x", "")]);
    await ollamaFimGenerate(
      "http://localhost:11434",
      "starcoder2:3b",
      "a",
      "b",
      64,
      controller.signal,
      mockFetch,
    );
    const call = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1].signal).toBe(controller.signal);
  });
});
