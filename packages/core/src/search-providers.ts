// ============================================================================
// @dantecode/core — Search Providers
// Multi-provider search abstraction with Tavily, Exa, Serper, Google CSE,
// Brave, and DuckDuckGo. Harvested from Qwen Code CLI (Apache 2.0) +
// OpenHands (MIT) + OpenCode patterns.
// ============================================================================

import { htmlToReadableText } from "./search-html-utils.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A single search result from any provider. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  rank?: number;
  /** Raw content from providers that support it (Tavily, Exa). */
  rawContent?: string;
  /** Published date if available. */
  publishedDate?: string;
  /** Relevance score from the provider (0–1). */
  relevanceScore?: number;
}

/** Abstract search provider interface. */
export interface SearchProvider {
  /** Provider identifier. */
  readonly name: string;
  /** Estimated cost per query in USD (0 = free). */
  readonly costPerQuery: number;
  /** Check if this provider is configured and available. */
  available(): boolean;
  /** Execute a search query. */
  search(query: string, options: SearchProviderOptions): Promise<SearchResult[]>;
}

/** Options passed to individual search providers. */
export interface SearchProviderOptions {
  maxResults: number;
  /** Search depth: "basic" (fast) or "advanced" (thorough). */
  searchDepth?: "basic" | "advanced";
  /** Include raw content from page (Tavily/Exa feature). */
  includeRawContent?: boolean;
  /** Topic filter for Tavily. */
  topic?: "general" | "news";
  /** Time range filter. */
  timeRange?: "day" | "week" | "month" | "year";
}

/** Provider configuration loaded from env or config file. */
export interface SearchProviderConfig {
  /** Ordered list of provider names to try. */
  providers: string[];
  /** API keys by provider name. */
  apiKeys: Record<string, string>;
  /** Maximum results per query. */
  maxResults: number;
  /** Search depth preference. */
  searchDepth: "basic" | "advanced";
  /** Maximum cost per search call in USD. */
  costCapPerCall: number;
  /** Google Custom Search Engine ID. */
  googleCseId?: string;
}

// ----------------------------------------------------------------------------
// Tavily Provider (AI-optimized search, primary choice)
// ----------------------------------------------------------------------------

export class TavilyProvider implements SearchProvider {
  readonly name = "tavily";
  readonly costPerQuery = 0.01;

  private apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env["TAVILY_API_KEY"];
  }

  available(): boolean {
    return !!this.apiKey;
  }

  async search(query: string, options: SearchProviderOptions): Promise<SearchResult[]> {
    if (!this.apiKey) return [];

    const body = {
      api_key: this.apiKey,
      query,
      max_results: Math.min(options.maxResults, 20),
      search_depth: options.searchDepth ?? "basic",
      include_raw_content: options.includeRawContent ?? false,
      topic: options.topic ?? "general",
    };

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Tavily HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as TavilyResponse;
    return (data.results ?? []).map((r, i) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.content ?? "",
      source: this.name,
      rank: i + 1,
      rawContent: r.raw_content,
      relevanceScore: r.score,
    }));
  }
}

interface TavilyResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    raw_content?: string;
    score?: number;
  }>;
}

// ----------------------------------------------------------------------------
// Exa Provider (semantic/neural search)
// ----------------------------------------------------------------------------

export class ExaProvider implements SearchProvider {
  readonly name = "exa";
  readonly costPerQuery = 0.01;

  private apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env["EXA_API_KEY"];
  }

  available(): boolean {
    return !!this.apiKey;
  }

  async search(query: string, options: SearchProviderOptions): Promise<SearchResult[]> {
    if (!this.apiKey) return [];

    const body = {
      query,
      num_results: Math.min(options.maxResults, 20),
      use_autoprompt: true,
      type: "auto",
      contents: options.includeRawContent
        ? { text: { max_characters: 5000 } }
        : undefined,
    };

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Exa HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as ExaResponse;
    return (data.results ?? []).map((r, i) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.text ?? r.highlight ?? "",
      source: this.name,
      rank: i + 1,
      rawContent: r.text,
      publishedDate: r.publishedDate,
      relevanceScore: r.score,
    }));
  }
}

interface ExaResponse {
  results?: Array<{
    title?: string;
    url?: string;
    text?: string;
    highlight?: string;
    publishedDate?: string;
    score?: number;
  }>;
}

// ----------------------------------------------------------------------------
// Serper Provider (Google results via API)
// ----------------------------------------------------------------------------

export class SerperProvider implements SearchProvider {
  readonly name = "serper";
  readonly costPerQuery = 0.002;

  private apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env["SERPER_API_KEY"];
  }

  available(): boolean {
    return !!this.apiKey;
  }

  async search(query: string, options: SearchProviderOptions): Promise<SearchResult[]> {
    if (!this.apiKey) return [];

    const body = {
      q: query,
      num: Math.min(options.maxResults, 20),
    };

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Serper HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as SerperResponse;
    return (data.organic ?? []).map((r, i) => ({
      title: r.title ?? "",
      url: r.link ?? "",
      snippet: r.snippet ?? "",
      source: this.name,
      rank: i + 1,
      publishedDate: r.date,
    }));
  }
}

interface SerperResponse {
  organic?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    date?: string;
  }>;
}

// ----------------------------------------------------------------------------
// Google Custom Search Provider
// ----------------------------------------------------------------------------

export class GoogleCSEProvider implements SearchProvider {
  readonly name = "google";
  readonly costPerQuery = 0.005;

  private apiKey: string | undefined;
  private cseId: string | undefined;

  constructor(apiKey?: string, cseId?: string) {
    this.apiKey = apiKey ?? process.env["GOOGLE_API_KEY"];
    this.cseId = cseId ?? process.env["GOOGLE_CSE_ID"];
  }

  available(): boolean {
    return !!this.apiKey && !!this.cseId;
  }

  async search(query: string, options: SearchProviderOptions): Promise<SearchResult[]> {
    if (!this.apiKey || !this.cseId) return [];

    const params = new URLSearchParams({
      key: this.apiKey,
      cx: this.cseId,
      q: query,
      num: String(Math.min(options.maxResults, 10)),
    });

    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params}`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (!response.ok) {
      throw new Error(`Google CSE HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as GoogleCSEResponse;
    return (data.items ?? []).map((r, i) => ({
      title: r.title ?? "",
      url: r.link ?? "",
      snippet: r.snippet ?? "",
      source: this.name,
      rank: i + 1,
    }));
  }
}

interface GoogleCSEResponse {
  items?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
  }>;
}

// ----------------------------------------------------------------------------
// Brave Search Provider
// ----------------------------------------------------------------------------

export class BraveProvider implements SearchProvider {
  readonly name = "brave";
  readonly costPerQuery = 0.005;

  private apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env["BRAVE_API_KEY"];
  }

  available(): boolean {
    return !!this.apiKey;
  }

  async search(query: string, options: SearchProviderOptions): Promise<SearchResult[]> {
    if (!this.apiKey) return [];

    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(options.maxResults, 20)),
    });

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": this.apiKey,
        },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) {
      throw new Error(`Brave HTTP ${response.status}`);
    }

    const data = (await response.json()) as BraveResponse;
    return (data.web?.results ?? []).map((r, i) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
      source: this.name,
      rank: i + 1,
    }));
  }
}

interface BraveResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
}

// ----------------------------------------------------------------------------
// DuckDuckGo Provider (always available, no API key, last resort)
// ----------------------------------------------------------------------------

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "duckduckgo";
  readonly costPerQuery = 0;

  available(): boolean {
    return true;
  }

  async search(query: string, options: SearchProviderOptions): Promise<SearchResult[]> {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "DanteCode/1.0 (CLI agent tool)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo HTTP ${response.status}`);
    }

    const html = await response.text();
    return this.parseResults(html, options.maxResults);
  }

  private parseResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    const resultBlocks =
      html.match(
        /<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi,
      ) ?? [];

    for (const block of resultBlocks) {
      if (results.length >= maxResults) break;

      const linkMatch = block.match(
        /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!linkMatch) continue;

      const url = linkMatch[1]!;
      const title = htmlToReadableText(linkMatch[2]!);

      const snippetMatch = block.match(
        /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
      );
      const snippet = snippetMatch ? htmlToReadableText(snippetMatch[1]!) : "";

      if (title && url && !url.startsWith("//duckduckgo.com")) {
        results.push({ title, url, snippet, source: this.name });
      }
    }

    // Fallback: extract links if structured parsing fails
    if (results.length === 0) {
      const linkMatches = [
        ...html.matchAll(
          /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
        ),
      ];
      for (const match of linkMatches) {
        if (results.length >= maxResults) break;
        const url = match[1]!;
        const title = htmlToReadableText(match[2]!);
        if (url.includes("duckduckgo.com") || !title || title.length < 3) continue;
        results.push({ title, url, snippet: "", source: this.name });
      }
    }

    return results;
  }
}

// ----------------------------------------------------------------------------
// Provider Factory
// ----------------------------------------------------------------------------

/** Default provider ordering (Qwen-style cost-aware fallback). */
export const DEFAULT_PROVIDER_ORDER = [
  "tavily",
  "exa",
  "serper",
  "google",
  "brave",
  "duckduckgo",
] as const;

/** Create all available search providers in the configured order. */
export function createSearchProviders(config?: Partial<SearchProviderConfig>): SearchProvider[] {
  const apiKeys = config?.apiKeys ?? {};
  const order = config?.providers ?? [...DEFAULT_PROVIDER_ORDER];

  const providerMap: Record<string, SearchProvider> = {
    tavily: new TavilyProvider(apiKeys["tavily"]),
    exa: new ExaProvider(apiKeys["exa"]),
    serper: new SerperProvider(apiKeys["serper"]),
    google: new GoogleCSEProvider(apiKeys["google"], config?.googleCseId),
    brave: new BraveProvider(apiKeys["brave"]),
    duckduckgo: new DuckDuckGoProvider(),
  };

  return order
    .map((name) => providerMap[name])
    .filter((p): p is SearchProvider => p !== undefined);
}

/** Load search provider config from environment variables. */
export function loadSearchConfig(): SearchProviderConfig {
  const apiKeys: Record<string, string> = {};

  const envMap: Record<string, string> = {
    tavily: "TAVILY_API_KEY",
    exa: "EXA_API_KEY",
    serper: "SERPER_API_KEY",
    google: "GOOGLE_API_KEY",
    brave: "BRAVE_API_KEY",
  };

  for (const [provider, envKey] of Object.entries(envMap)) {
    const val = process.env[envKey];
    if (val) apiKeys[provider] = val;
  }

  return {
    providers: [...DEFAULT_PROVIDER_ORDER],
    apiKeys,
    maxResults: 15,
    searchDepth: "basic",
    costCapPerCall: 0.05,
    googleCseId: process.env["GOOGLE_CSE_ID"],
  };
}

// ----------------------------------------------------------------------------
// Minimal HTML helper (avoids circular dep with cli/html-parser)
// ----------------------------------------------------------------------------

// Re-exported from search-html-utils for provider-internal use
