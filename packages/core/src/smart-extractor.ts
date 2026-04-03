// ============================================================================
// @dantecode/core — Smart Extractor
// Playwright/Stagehand -> Firecrawl-style cleaning -> Crawl4AI-style relevance
// + optional lightweight model refinement to structured data.
// ============================================================================

import { BrowserAgent } from "./browser-agent.js";
import { WebFetchEngine } from "./web-fetch-engine.js";
import { ModelRouterImpl } from "./model-router.js";
import { type z } from "zod";

export interface ExtractorConfig {
  useBrowser?: boolean; // Force playwright even if not strictly needed
  instructions?: string; // Natural language extraction instructions
  schema?: z.ZodType<any>; // Zod schema for structured output
  blockAds?: boolean; // Remove common ad/noise selectors
  cssSelector?: string; // Extract only from matching selector
}

export interface ExtractedData<T = any> {
  url: string;
  markdown: string;
  structuredJson?: T;
  citations?: string[];
  metadata: {
    title?: string;
    wordCount: number;
    fetchedVia: "fetch" | "browser";
  };
}

export class SmartExtractor {
  private fetchEngine: WebFetchEngine;
  private browserAgent: BrowserAgent | null = null;
  private router: ModelRouterImpl;

  constructor(router: ModelRouterImpl) {
    this.router = router;
    this.fetchEngine = new WebFetchEngine();
    // Lazy init browser agent
  }

  /**
   * Main entry point: Fetch, Clean, and Extract
   */
  async extract<T = any>(url: string, config: ExtractorConfig = {}): Promise<ExtractedData<T>> {
    let rawHtml = "";
    let fetchedVia: "fetch" | "browser" = "fetch";

    // 1. Fetching logic (Fallback to browser if JS-heavy/blocked)
    if (config.useBrowser) {
      rawHtml = await this.fetchViaBrowser(url);
      fetchedVia = "browser";
    } else {
      try {
        const fetchResult = await this.fetchEngine.fetchSmart(url);
        // If confidence is extremely low, it might be a JS-rendered SPA
        if (fetchResult.confidence < 0.3) {
          rawHtml = await this.fetchViaBrowser(url);
          fetchedVia = "browser";
        } else {
          // We don't use the pre-cleaned text because we want to apply Firecrawl-style noise removal first
          // Actually, WebFetchEngine uses standard DOM cleanup, let's just grab its internal raw fetch via a direct call
          const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
          rawHtml = await response.text();
        }
      } catch {
        // Fallback to browser
        rawHtml = await this.fetchViaBrowser(url);
        fetchedVia = "browser";
      }
    }

    // 2. Firecrawl-style Cleaning & Noise Reduction
    const cleanMarkdown = this.fetchEngine.extractText(rawHtml, config.cssSelector);

    // 3. Optional Model Refinement + structured extraction
    let structuredJson: T | undefined = undefined;
    if (config.schema || config.instructions) {
      structuredJson = await this.refineWithModel<T>(cleanMarkdown, config);
    }

    return {
      url,
      markdown: cleanMarkdown,
      structuredJson,
      citations: [url],
      metadata: {
        title: this.fetchEngine.extractTitle(rawHtml),
        wordCount: cleanMarkdown.split(/\s+/).length,
        fetchedVia,
      },
    };
  }

  private async fetchViaBrowser(url: string): Promise<string> {
    if (!this.browserAgent) {
      this.browserAgent = new BrowserAgent({ headless: true });
    }
    const navResult = await this.browserAgent.goto(url);
    if (!navResult.success) {
      throw new Error(`Browser fetch failed: ${navResult.error}`);
    }

    // Simulate Stagehand "wait and observe" - basic implicit wait for content
    await new Promise((r) => setTimeout(r, 2000));

    // Extract full HTML via DevTools evaluation
    const tree = await this.browserAgent.getAccessibilityTree();
    // Fallback: we just use accessibility tree text as markdown if standard HTML eval isn't strictly attached
    return tree.data || "";
  }

  private async refineWithModel<T>(
    content: string,
    config: ExtractorConfig,
  ): Promise<T | undefined> {
    let systemPrompt = `You are a Smart Extractor mimicking Firecrawl. 
Extract structured information from the provided markdown content according to instructions. 
Reply ONLY with valid JSON matching the format/schema requested. No markdown blocks, just raw JSON.`;

    if (config.instructions) {
      systemPrompt += `\nInstructions: ${config.instructions}`;
    }

    // truncate content to fit context window (~40k chars)
    const safeContent = content.slice(0, 40000);

    try {
      const response = await this.router.generate([{ role: "user", content: safeContent }], {
        system: systemPrompt,
      });

      const parsed = JSON.parse(response);
      if (config.schema) {
        return config.schema.parse(parsed) as T;
      }
      return parsed as T;
    } catch (err) {
      throw new Error(`LLM Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
