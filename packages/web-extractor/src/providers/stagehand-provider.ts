import { FetchProvider, WebFetchOptions, WebFetchResult } from "../types.js";
import { BrowserAgent } from "@dantecode/core";

export class StagehandProvider implements FetchProvider {
  readonly name = "stagehand";
  private browserAgent: BrowserAgent;

  constructor(browserAgent: BrowserAgent) {
    this.browserAgent = browserAgent;
  }

  async fetch(url: string, options: WebFetchOptions): Promise<Partial<WebFetchResult>> {
    const navResult = await this.browserAgent.goto(url);
    if (!navResult.success) {
      throw new Error(`Stagehand navigation failed: ${navResult.error}`);
    }

    // Wait for content (mimicking Stagehand observe)
    await new Promise((r) => setTimeout(r, options.maxWaitMs || 2000));

    // Get accessibility tree or evaluate page text
    // For now we use the BrowserAgent's evaluate to get text/html
    const evalResult = await this.browserAgent.evaluate("document.documentElement.outerHTML");
    const html = typeof evalResult.data === "string" ? evalResult.data : "";

    return {
      url,
      markdown: html,
      metadata: {
        finalUrl: url,
        status: 200,
        renderMode: "browser",
        cacheHit: false,
        extractedAt: new Date().toISOString(),
      },
    };
  }
}
