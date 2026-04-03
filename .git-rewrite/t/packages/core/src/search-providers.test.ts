import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TavilyProvider,
  ExaProvider,
  SerperProvider,
  GoogleCSEProvider,
  BraveProvider,
  DuckDuckGoProvider,
  createSearchProviders,
  loadSearchConfig,
  DEFAULT_PROVIDER_ORDER,
} from "./search-providers.js";

// ============================================================================
// TavilyProvider
// ============================================================================

describe("TavilyProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["TAVILY_API_KEY"];
  });

  it("is not available without API key", () => {
    const provider = new TavilyProvider();
    expect(provider.available()).toBe(false);
  });

  it("is available with API key", () => {
    const provider = new TavilyProvider("test-key");
    expect(provider.available()).toBe(true);
  });

  it("is available via env var", () => {
    process.env["TAVILY_API_KEY"] = "env-key";
    const provider = new TavilyProvider();
    expect(provider.available()).toBe(true);
  });

  it("returns empty array when no API key", async () => {
    const provider = new TavilyProvider();
    const results = await provider.search("test", { maxResults: 5 });
    expect(results).toEqual([]);
  });

  it("parses Tavily API response", async () => {
    const mockResponse = {
      results: [
        { title: "Result 1", url: "https://example.com/1", content: "Snippet 1", score: 0.95 },
        {
          title: "Result 2",
          url: "https://example.com/2",
          content: "Snippet 2",
          raw_content: "Full text",
          score: 0.8,
        },
      ],
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const provider = new TavilyProvider("test-key");
    const results = await provider.search("typescript best practices", { maxResults: 10 });

    expect(results).toHaveLength(2);
    expect(results[0]!.title).toBe("Result 1");
    expect(results[0]!.source).toBe("tavily");
    expect(results[0]!.relevanceScore).toBe(0.95);
    expect(results[1]!.rawContent).toBe("Full text");
  });

  it("throws on HTTP error", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    });

    const provider = new TavilyProvider("test-key");
    await expect(provider.search("test", { maxResults: 5 })).rejects.toThrow("Tavily HTTP 429");
  });

  it("has correct cost per query", () => {
    const provider = new TavilyProvider("key");
    expect(provider.costPerQuery).toBe(0.01);
    expect(provider.name).toBe("tavily");
  });
});

// ============================================================================
// ExaProvider
// ============================================================================

describe("ExaProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["EXA_API_KEY"];
  });

  it("is not available without API key", () => {
    const provider = new ExaProvider();
    expect(provider.available()).toBe(false);
  });

  it("parses Exa API response", async () => {
    const mockResponse = {
      results: [
        {
          title: "Neural Search Result",
          url: "https://exa.ai/result",
          text: "Full content",
          score: 0.9,
          publishedDate: "2025-01-15",
        },
      ],
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const provider = new ExaProvider("test-key");
    const results = await provider.search("semantic search", { maxResults: 5 });

    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe("exa");
    expect(results[0]!.rawContent).toBe("Full content");
    expect(results[0]!.publishedDate).toBe("2025-01-15");
  });
});

// ============================================================================
// SerperProvider
// ============================================================================

describe("SerperProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["SERPER_API_KEY"];
  });

  it("parses Serper response (Google results)", async () => {
    const mockResponse = {
      organic: [
        {
          title: "Google Result",
          link: "https://google-result.com",
          snippet: "Snippet from Google",
          date: "2025-03-01",
        },
      ],
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const provider = new SerperProvider("test-key");
    const results = await provider.search("test", { maxResults: 10 });

    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe("serper");
    expect(results[0]!.url).toBe("https://google-result.com");
    expect(results[0]!.publishedDate).toBe("2025-03-01");
  });

  it("has correct cost", () => {
    expect(new SerperProvider("k").costPerQuery).toBe(0.002);
  });
});

// ============================================================================
// GoogleCSEProvider
// ============================================================================

describe("GoogleCSEProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["GOOGLE_API_KEY"];
    delete process.env["GOOGLE_CSE_ID"];
  });

  it("requires both API key and CSE ID", () => {
    expect(new GoogleCSEProvider("key", undefined).available()).toBe(false);
    expect(new GoogleCSEProvider(undefined, "cse-id").available()).toBe(false);
    expect(new GoogleCSEProvider("key", "cse-id").available()).toBe(true);
  });

  it("parses Google CSE response", async () => {
    const mockResponse = {
      items: [{ title: "CSE Result", link: "https://cse.com/page", snippet: "CSE snippet" }],
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const provider = new GoogleCSEProvider("key", "cse-id");
    const results = await provider.search("test", { maxResults: 5 });

    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe("google");
  });
});

// ============================================================================
// BraveProvider
// ============================================================================

describe("BraveProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["BRAVE_API_KEY"];
  });

  it("parses Brave response", async () => {
    const mockResponse = {
      web: {
        results: [
          { title: "Brave Result", url: "https://brave.com/page", description: "Brave snippet" },
        ],
      },
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const provider = new BraveProvider("test-key");
    const results = await provider.search("test", { maxResults: 10 });

    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe("brave");
  });
});

// ============================================================================
// DuckDuckGoProvider
// ============================================================================

describe("DuckDuckGoProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is always available", () => {
    expect(new DuckDuckGoProvider().available()).toBe(true);
  });

  it("has zero cost", () => {
    expect(new DuckDuckGoProvider().costPerQuery).toBe(0);
  });

  it("parses DuckDuckGo HTML results", async () => {
    const mockHtml = `
      <div class="result results_links web-result">
        <a class="result__a" href="https://example.com/page">Example Title</a>
        <a class="result__snippet">This is a snippet.</a>
      </div></div>
    `;

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => mockHtml,
    });

    const provider = new DuckDuckGoProvider();
    const results = await provider.search("test", { maxResults: 10 });

    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Example Title");
    expect(results[0]!.source).toBe("duckduckgo");
  });
});

// ============================================================================
// createSearchProviders & loadSearchConfig
// ============================================================================

describe("createSearchProviders", () => {
  afterEach(() => {
    delete process.env["TAVILY_API_KEY"];
    delete process.env["BRAVE_API_KEY"];
  });

  it("creates providers in default order", () => {
    const providers = createSearchProviders();
    expect(providers).toHaveLength(6);
    expect(providers[0]!.name).toBe("tavily");
    expect(providers[5]!.name).toBe("duckduckgo");
  });

  it("respects custom provider order", () => {
    const providers = createSearchProviders({ providers: ["duckduckgo", "brave"] });
    expect(providers).toHaveLength(2);
    expect(providers[0]!.name).toBe("duckduckgo");
    expect(providers[1]!.name).toBe("brave");
  });

  it("passes API keys to providers", () => {
    const providers = createSearchProviders({
      apiKeys: { tavily: "my-key" },
    });
    const tavily = providers.find((p) => p.name === "tavily")!;
    expect(tavily.available()).toBe(true);
  });
});

describe("loadSearchConfig", () => {
  afterEach(() => {
    delete process.env["TAVILY_API_KEY"];
    delete process.env["BRAVE_API_KEY"];
    delete process.env["GOOGLE_CSE_ID"];
  });

  it("loads config from env vars", () => {
    process.env["TAVILY_API_KEY"] = "tav-key";
    process.env["BRAVE_API_KEY"] = "brave-key";

    const config = loadSearchConfig();
    expect(config.apiKeys["tavily"]).toBe("tav-key");
    expect(config.apiKeys["brave"]).toBe("brave-key");
    expect(config.providers).toEqual([...DEFAULT_PROVIDER_ORDER]);
    expect(config.maxResults).toBe(15);
    expect(config.costCapPerCall).toBe(0.05);
  });

  it("includes Google CSE ID from env", () => {
    process.env["GOOGLE_CSE_ID"] = "my-cse-id";
    const config = loadSearchConfig();
    expect(config.googleCseId).toBe("my-cse-id");
  });
});
