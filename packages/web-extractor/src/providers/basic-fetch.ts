import { FetchProvider, WebFetchOptions, WebFetchResult } from "../types.js";

export class BasicFetchProvider implements FetchProvider {
  readonly name = "basic-fetch";

  async fetch(url: string, options: WebFetchOptions): Promise<Partial<WebFetchResult>> {
    const controller = new AbortController();
    const timeout = options.maxWaitMs ?? 15000;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "DanteCode-WebExtractor/1.0 (compatible; Mozilla/5.0)",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const text = await response.text();

      return {
        url,
        markdown: text, // Raw text for now, will be cleaned by MarkdownCleaner
        metadata: {
          provider: this.name,
          finalUrl: response.url,
          status: response.status,
          renderMode: "http",
          cacheHit: false,
          preActionsApplied: false,
          extractedAt: new Date().toISOString(),
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
