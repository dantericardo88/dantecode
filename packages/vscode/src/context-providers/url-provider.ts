import type { IContextProvider, ContextProviderExtras, ContextItem } from "@dantecode/core";
import { searchHtmlToText } from "@dantecode/core";

export class UrlProvider implements IContextProvider {
  readonly name = "url";
  readonly description = "Fetch and extract content from a URL";

  async getContextItems(extras: ContextProviderExtras): Promise<ContextItem[]> {
    const url = extras.query;
    if (!url.startsWith("https://")) {
      return [{
        name: "url",
        description: "URL content",
        content: "(only https:// URLs are supported)",
      }];
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      const html = await resp.text();
      const text = searchHtmlToText(html).slice(0, 4000);
      return [{
        name: `url:${url}`,
        description: `URL: ${url}`,
        content: text,
        uri: { type: "url", value: url },
      }];
    } catch {
      return [{
        name: `url:${url}`,
        description: "URL content",
        content: `(fetch failed: ${url})`,
      }];
    }
  }
}
