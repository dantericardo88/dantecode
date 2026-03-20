import { normalizeUrl } from "../cache/cache-key.js";

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface FetchResult {
  url: string;
  normalizedUrl: string;
  title: string;
  content: string;
  rawHtml?: string;
  timestamp: string;
}

/**
 * Strips all HTML tags from a string using regex.
 */
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (m) return m[1]!.trim();
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) return h1[1]!.replace(/<[^>]+>/g, "").trim();
  return "Untitled";
}

/**
 * Basic web fetcher with lightweight HTML cleaning.
 * Uses native Node.js fetch (18+) — no external dependencies.
 */
export class WebFetcher {
  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const timeout = options.timeoutMs ?? 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await globalThis.fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          ...options.headers
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.statusText}`);
      }

      const html = await response.text();
      const title = extractTitle(html);
      const content = this.cleanText(stripTags(html));

      return {
        url,
        normalizedUrl: normalizeUrl(url),
        title,
        content,
        timestamp: new Date().toISOString()
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private cleanText(text: string): string {
    return text
      .replace(/&[a-z0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}
