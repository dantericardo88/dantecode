import {
  SearchResult,
  SearchOptions,
  SearchProvider
} from "../types.js";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] ?? USER_AGENTS[0]!;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Lightweight HTML parser for DDG search results.
 * Uses regex to avoid cheerio ESM/type dependency issues.
 */
function parseResults(html: string, limit: number): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // Match DDG result blocks
  const blockRe = /<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let blockMatch: RegExpExecArray | null;
  let position = 0;

  while ((blockMatch = blockRe.exec(html)) !== null && results.length < limit) {
    const block = blockMatch[0] ?? "";

    // Extract title
    const titleMatch = /class="result__title"[^>]*>.*?<a[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const title = titleMatch ? titleMatch[1]!.replace(/<[^>]+>/g, "").trim() : "";

    // Extract URL
    const urlMatch = /class="result__url"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const rawUrl = urlMatch ? urlMatch[1]!.replace(/<[^>]+>/g, "").trim() : "";

    // Extract snippet
    const snippetMatch = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const snippet = snippetMatch ? snippetMatch[1]!.replace(/<[^>]+>/g, "").trim() : "";

    if (title && rawUrl) {
      results.push({
        title,
        url: rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`,
        snippet,
      });
      position++;
    }
  }

  return results;
}

/**
 * Native DuckDuckGo search provider.
 * Uses the HTML endpoint (no API key required).
 * Includes retry logic with exponential backoff (Crawl4AI / ddgs pattern).
 */
export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "duckduckgo";

  private readonly maxRetries: number;
  private readonly initialDelayMs: number;

  constructor({ maxRetries = 3, initialDelayMs = 500 } = {}) {
    this.maxRetries = maxRetries;
    this.initialDelayMs = initialDelayMs;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit ?? 10;
    const region = options.region ?? "wt-wt";
    const safe = options.safeSearch ? "1" : "-1";

    const params = new URLSearchParams({
      q: query,
      kl: region,
      kp: safe,
      ia: "web",
    });
    const url = `https://html.duckduckgo.com/html/?${params}`;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 500ms → 1000ms → 2000ms
        await sleep(this.initialDelayMs * Math.pow(2, attempt - 1));
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);

        let response: Response;
        try {
          response = await fetch(url, {
            headers: {
              "User-Agent": randomUserAgent(),
              "Accept": "text/html,application/xhtml+xml",
              "Accept-Language": "en-US,en;q=0.9",
            },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        if (response.status === 429) {
          continue; // Rate limited — backoff and retry
        }

        if (!response.ok) {
          throw new Error(`DDG search failed: ${response.statusText}`);
        }

        const html = await response.text();
        const parsed = parseResults(html, limit);

        return parsed.map((r, i) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          position: i + 1,
        }));
      } catch {
        // Retry on transient errors
      }
    }

    // All retries exhausted — return empty rather than throwing
    return [];
  }
}
