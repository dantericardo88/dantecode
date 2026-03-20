import fetch from "node-fetch";
import * as cheerio from "cheerio";
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
 * Basic web fetcher with HTML cleaning.
 */
export class WebFetcher {
  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const timeout = options.timeoutMs ?? 10000;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          ...options.headers
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Basic cleaning: remove scripts, styles, etc.
      $("script, style, nav, footer, header, noscript").remove();
      
      const title = $("title").text().trim() || $("h1").first().text().trim() || "Untitled";
      const content = this.cleanText($("body").text());

      return {
        url,
        normalizedUrl: normalizeUrl(url),
        title,
        content,
        timestamp: new Date().toISOString()
      };
    } finally {
      clearTimeout(id);
    }
  }

  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n\n")
      .trim();
  }
}
