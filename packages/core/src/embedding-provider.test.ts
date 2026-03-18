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
