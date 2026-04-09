import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEmbeddingProvider } from "./embedding-provider.js";

describe("embedding providers", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("edge cases", () => {
    it("empty string input → provider throws on empty embedding vector from API", async () => {
      // The provider validates embeddings — empty array from API triggers an error
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [] }] }),
      });
      global.fetch = fetchMock as typeof fetch;
      const provider = createEmbeddingProvider("openai", { apiKey: "test-key" });
      await expect(provider.embed([""])).rejects.toThrow(/empty embedding vector/i);
    });

    it("very long string input → no error, result returned", async () => {
      const longText = "word ".repeat(10000); // ~50 KB input
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      });
      global.fetch = fetchMock as typeof fetch;
      const provider = createEmbeddingProvider("openai", { apiKey: "test-key" });
      const embeddings = await provider.embed([longText]);
      expect(embeddings).toHaveLength(1);
      expect(embeddings[0]).toEqual([0.1, 0.2, 0.3]);
    });

    it("empty texts array → returns empty array without calling fetch", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as typeof fetch;
      const provider = createEmbeddingProvider("openai", { apiKey: "test-key" });
      const result = await provider.embed([]);
      expect(result).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("multiple calls → consistent output for same input", async () => {
      const embedding = [0.5, 0.3, 0.8, 0.1];
      const fetchMock = vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ embedding }] }),
        });
      global.fetch = fetchMock as typeof fetch;
      const provider = createEmbeddingProvider("openai", { apiKey: "test-key" });
      const result1 = await provider.embed(["hello"]);
      const result2 = await provider.embed(["hello"]);
      expect(result1[0]).toEqual(result2[0]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("calls the OpenAI embeddings endpoint with batched inputs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }],
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    const provider = createEmbeddingProvider("openai", {
      apiKey: "test-key",
      modelId: "text-embedding-3-small",
    });
    const embeddings = await provider.embed(["alpha", "beta"]);

    expect(embeddings).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );
  });

  it("calls Ollama once per prompt and returns each embedding", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: [1, 0] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: [0, 1] }),
      });
    global.fetch = fetchMock as typeof fetch;

    const provider = createEmbeddingProvider("ollama", {
      baseUrl: "http://localhost:11434",
      modelId: "nomic-embed-text",
    });
    const embeddings = await provider.embed(["first", "second"]);

    expect(embeddings).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:11434/api/embeddings",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
