import { 
  SearchResult, 
  SearchOptions, 
  SearchProvider 
} from "../types.js";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

/**
 * Native DuckDuckGo search provider.
 * Uses the HTML endpoint to avoid requiring an API key.
 */
export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "duckduckgo";

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit ?? 10;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
      });

      if (!response.ok) {
        throw new Error(`DDG search failed: ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const results: SearchResult[] = [];

      $(".result").each((i, element) => {
        if (results.length >= limit) return;

        const title = $(element).find(".result__title a").text().trim();
        const url = $(element).find(".result__url").text().trim();
        const snippet = $(element).find(".result__snippet").text().trim();

        if (title && url) {
          results.push({
            title,
            url: url.startsWith("http") ? url : `https://${url}`,
            snippet,
            position: i + 1
          });
        }
      });

      return results;
    } catch (error) {
      console.error("[DuckDuckGoProvider] Error:", error);
      return [];
    }
  }
}
