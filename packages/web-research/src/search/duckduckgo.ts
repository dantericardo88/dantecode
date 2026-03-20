import {
  SearchResult,
  SearchOptions,
  SearchProvider
} from "../types.js";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

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
        const response = await fetch(url, {
          headers: {
            "User-Agent": randomUserAgent(),
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (response.status === 429) {
          continue; // Rate limited — backoff and retry
        }

        if (!response.ok) {
          throw new Error(`DDG search failed: ${response.statusText}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);
        const results: SearchResult[] = [];

        $(".result").each((i, element) => {
          if (results.length >= limit) return;

          const titleEl = $(element).find(".result__title a");
          const title = titleEl.text().trim();
          const rawUrl = $(element).find(".result__url").text().trim();
          const snippet = $(element).find(".result__snippet").text().trim();

          if (title && rawUrl) {
            results.push({
              title,
              url: rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`,
              snippet,
              position: i + 1,
            });
          }
        });

        return results;
      } catch {
        // Retry on transient errors
      }
    }

    // All retries exhausted — return empty rather than throwing to match resilience contract
    return [];
  }
}
