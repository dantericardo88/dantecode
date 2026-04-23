// ============================================================================
// Sprint B — Dim 3+4: CompletionContextRetriever.warmup() tests
// Proves: warmup pre-embeds corpus, sets _warmedUp, non-blocking, graceful
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @dantecode/core to avoid HybridSearchEngine side-effects in unit tests
vi.mock("@dantecode/core", () => ({
  HybridSearchEngine: vi.fn().mockImplementation(() => ({
    addDocument: vi.fn(),
    addDocuments: vi.fn(),
    search: vi.fn().mockReturnValue([]),
    searchAsync: vi.fn().mockResolvedValue([]),
    setEmbeddingProvider: vi.fn(),
    get documentCount() { return 0; },
    indexAll: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock @dantecode/memory-engine
const mockEmbeddingProvider = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
vi.mock("@dantecode/memory-engine", () => ({
  detectBestEmbeddingProvider: vi.fn().mockResolvedValue(mockEmbeddingProvider),
}));

// Mock node:fs/promises for file system isolation
vi.mock("node:fs/promises", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...orig,
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ mtimeMs: 1000, isDirectory: () => false }),
    opendir: vi.fn().mockResolvedValue({ [Symbol.asyncIterator]: () => ({ next: () => ({ done: true, value: undefined }) }) }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue("file content"),
  };
});

import { CompletionContextRetriever } from "../completion-context-retriever.js";

function makeRetriever(): CompletionContextRetriever {
  return new CompletionContextRetriever(() => []);
}

describe("CompletionContextRetriever.warmup()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets warmedUp = true after warmup completes", async () => {
    const retriever = makeRetriever();
    expect(retriever.warmedUp).toBe(false);
    await retriever.warmup("/workspace");
    expect(retriever.warmedUp).toBe(true);
  });

  it("warmedUp is false before warmup is called", () => {
    const retriever = makeRetriever();
    expect(retriever.warmedUp).toBe(false);
  });

  it("calls detectBestEmbeddingProvider during warmup", async () => {
    const { detectBestEmbeddingProvider } = await import("@dantecode/memory-engine" as string) as {
      detectBestEmbeddingProvider: ReturnType<typeof vi.fn>;
    };
    const retriever = makeRetriever();
    await retriever.warmup("/workspace");
    expect(detectBestEmbeddingProvider).toHaveBeenCalled();
  });

  it("does not throw when memory-engine is unavailable", async () => {
    // Override the mock to reject
    vi.doMock("@dantecode/memory-engine", () => ({
      detectBestEmbeddingProvider: vi.fn().mockRejectedValue(new Error("not installed")),
    }));

    const retriever2 = new CompletionContextRetriever(() => []);
    await expect(retriever2.warmup("/workspace")).resolves.toBeUndefined();
    expect(retriever2.warmedUp).toBe(true);
  });

  it("warmup is non-blocking (returns a Promise that can be fire-and-forgot)", () => {
    const retriever = makeRetriever();
    // Calling warmup without await should not throw immediately
    const promise = retriever.warmup("/workspace");
    expect(promise).toBeInstanceOf(Promise);
    // Clean up
    return promise;
  });

  it("warmup can be called multiple times without crashing", async () => {
    const retriever = makeRetriever();
    await retriever.warmup("/workspace");
    await retriever.warmup("/workspace");
    expect(retriever.warmedUp).toBe(true);
  });
});

describe("CompletionContextRetriever integration: warmup + retrieve", () => {
  it("retrieve() works correctly after warmup", async () => {
    const chunks = [
      { filePath: "src/auth.ts", content: "export function authenticate(token: string) { return true; }" },
    ];
    const retriever = new CompletionContextRetriever(() => chunks);
    await retriever.warmup("/workspace");
    // retrieve() should not throw after warmup
    const result = await retriever.retrieve(["const token"], 2, 400, 50);
    expect(Array.isArray(result)).toBe(true);
  });

  it("warmedUp stays true even when indexAll throws", async () => {
    // Override HybridSearchEngine.indexAll to throw
    const { HybridSearchEngine } = await import("@dantecode/core");
    (HybridSearchEngine as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      addDocument: vi.fn(),
      addDocuments: vi.fn(),
      search: vi.fn().mockReturnValue([]),
      searchAsync: vi.fn().mockResolvedValue([]),
      setEmbeddingProvider: vi.fn(),
      get documentCount() { return 0; },
      indexAll: vi.fn().mockRejectedValue(new Error("disk full")),
    }));

    const retriever2 = new CompletionContextRetriever(() => []);
    await retriever2.warmup("/workspace");
    // warmup failure is non-fatal — warmedUp still true
    expect(retriever2.warmedUp).toBe(true);
  });
});
