// ============================================================================
// @dantecode/memory-engine — Remote Embedding Provider Tests
// Verifies detectBestEmbeddingProvider() probes providers in priority order
// and returns null when none are available.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// We use dynamic import + vi.mock to control env vars and fetch per test.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchFail(): void {
  (global.fetch as Mock).mockRejectedValue(new Error("network error"));
}

function mockFetchNotOk(): void {
  (global.fetch as Mock).mockResolvedValue({
    ok: false,
    status: 500,
    json: async () => ({}),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// Core provider detection tests
// ---------------------------------------------------------------------------

describe("detectBestEmbeddingProvider — no env keys, no Ollama", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    delete process.env["OPENAI_API_KEY"];
    delete process.env["GOOGLE_API_KEY"];
    delete process.env["GEMINI_API_KEY"];
    mockFetchNotOk(); // Ollama /api/tags returns non-200
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns null when no keys set and Ollama not running", async () => {
    const { detectBestEmbeddingProvider } = await import("./remote-embedding-provider.js");
    const fn = await detectBestEmbeddingProvider();
    expect(fn).toBeNull();
  });
});

describe("detectBestEmbeddingProvider — Ollama running", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    delete process.env["OPENAI_API_KEY"];
    delete process.env["GOOGLE_API_KEY"];
    delete process.env["GEMINI_API_KEY"];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns an Ollama fn when /api/tags returns 200", async () => {
    // First call: Ollama health check → ok
    // Second call (from embedSingle via the returned fn): not needed in this test
    (global.fetch as Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) } as unknown as Response)
      // embedSingle will call fetch too
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: new Array(768).fill(0.1) }),
      } as unknown as Response);

    const { detectBestEmbeddingProvider } = await import("./remote-embedding-provider.js");
    const fn = await detectBestEmbeddingProvider();
    expect(fn).toBeTypeOf("function");
  });

  it("returned Ollama fn invokes embedSingle on the provider", async () => {
    const mockEmbedding = new Array(768).fill(0.5);
    (global.fetch as Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: mockEmbedding }),
      } as unknown as Response);

    const { detectBestEmbeddingProvider } = await import("./remote-embedding-provider.js");
    const fn = await detectBestEmbeddingProvider();
    expect(fn).not.toBeNull();
    if (fn) {
      const vec = await fn("hello world");
      expect(vec).toHaveLength(768);
    }
  });

  it("Ollama timeout falls through to null when fetch throws", async () => {
    mockFetchFail();
    const { detectBestEmbeddingProvider } = await import("./remote-embedding-provider.js");
    const fn = await detectBestEmbeddingProvider();
    expect(fn).toBeNull();
  });
});

describe("detectBestEmbeddingProvider — OpenAI key set", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    process.env["OPENAI_API_KEY"] = "sk-test-key";
    delete process.env["GOOGLE_API_KEY"];
    delete process.env["GEMINI_API_KEY"];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env["OPENAI_API_KEY"];
  });

  it("returns OpenAI fn when OPENAI_API_KEY is set and validation succeeds", async () => {
    // embedSingle("ping") validation call
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: new Array(1536).fill(0.01) }],
        usage: { total_tokens: 1 },
      }),
    } as unknown as Response);

    const { detectBestEmbeddingProvider } = await import("./remote-embedding-provider.js");
    const fn = await detectBestEmbeddingProvider();
    expect(fn).toBeTypeOf("function");
  });

  it("falls through to next provider if OpenAI validation throws", async () => {
    // First call (OpenAI embedSingle) fails
    (global.fetch as Mock)
      .mockRejectedValueOnce(new Error("invalid key"))
      // Ollama check also fails → null
      .mockRejectedValueOnce(new Error("connection refused"));

    const { detectBestEmbeddingProvider } = await import("./remote-embedding-provider.js");
    const fn = await detectBestEmbeddingProvider();
    expect(fn).toBeNull();
  });
});

describe("detectBestEmbeddingProvider — Google key set, no OpenAI", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    delete process.env["OPENAI_API_KEY"];
    process.env["GOOGLE_API_KEY"] = "google-test-key";
    delete process.env["GEMINI_API_KEY"];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env["GOOGLE_API_KEY"];
  });

  it("returns Google fn when GOOGLE_API_KEY is set and validation succeeds", async () => {
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        embedding: { values: new Array(768).fill(0.02) },
      }),
    } as unknown as Response);

    const { detectBestEmbeddingProvider } = await import("./remote-embedding-provider.js");
    const fn = await detectBestEmbeddingProvider();
    expect(fn).toBeTypeOf("function");
  });

  it("GEMINI_API_KEY is also accepted as Google key", async () => {
    delete process.env["GOOGLE_API_KEY"];
    process.env["GEMINI_API_KEY"] = "gemini-test-key";

    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        embedding: { values: new Array(768).fill(0.02) },
      }),
    } as unknown as Response);

    const { detectBestEmbeddingProvider } = await import("./remote-embedding-provider.js");
    const fn = await detectBestEmbeddingProvider();
    expect(fn).toBeTypeOf("function");
    delete process.env["GEMINI_API_KEY"];
  });
});

describe("detectBestEmbeddingProvider — priority order", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env["OPENAI_API_KEY"];
    delete process.env["GOOGLE_API_KEY"];
  });

  it("OpenAI takes precedence over Google when both keys present", async () => {
    vi.resetModules();
    process.env["OPENAI_API_KEY"] = "sk-test";
    process.env["GOOGLE_API_KEY"] = "google-test";

    vi.stubGlobal("fetch", vi.fn());
    // OpenAI validation call succeeds (1536 dims distinguishes OpenAI)
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: new Array(1536).fill(0.01) }],
        usage: { total_tokens: 1 },
      }),
    } as unknown as Response);

    const { detectBestEmbeddingProvider } = await import("./remote-embedding-provider.js");
    const fn = await detectBestEmbeddingProvider();
    expect(fn).toBeTypeOf("function");
    // OpenAI provider returns 1536-dim vectors
    const vec = await fn!("test");
    expect(vec).toHaveLength(1536);
  });
});
