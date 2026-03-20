import { WebFetchOptions, WebFetchResult, FetchProvider } from "./types.js";
import { BasicFetchProvider } from "./providers/basic-fetch.js";
import { StagehandProvider } from "./providers/stagehand-provider.js";
import { MarkdownCleaner } from "./markdown-cleaner.js";
import { SchemaExtractor } from "./schema-extractor.js";
import { RelevanceScorer } from "./relevance-scorer.js";
import { Dedupe } from "./dedupe.js";
import { VerificationBridge } from "./verification-bridge.js";
import { RequestPlanner } from "./request-planner.js";
import { PersistentCache } from "./cache/persistent-cache.js";
import { generateCacheKey } from "./cache/cache-key.js";
import { BrowserAgent, ModelRouterImpl } from "@dantecode/core";

export interface WebExtractorOptions {
  projectRoot: string;
  browserAgent?: BrowserAgent;
  modelRouter?: ModelRouterImpl;
}

export class WebExtractor {
  private providers: Map<string, FetchProvider> = new Map();
  private cleaner: MarkdownCleaner;
  private planner: RequestPlanner;
  private cache: PersistentCache;
  private schemaExtractor?: SchemaExtractor;
  private relevanceScorer: RelevanceScorer;
  private dedupeEngine: Dedupe;
  private verificationBridge: VerificationBridge;

  constructor(options: WebExtractorOptions) {
    this.cleaner = new MarkdownCleaner();
    this.planner = new RequestPlanner();
    this.cache = new PersistentCache(options.projectRoot);
    this.relevanceScorer = new RelevanceScorer(options.modelRouter);
    this.dedupeEngine = new Dedupe();
    this.verificationBridge = new VerificationBridge();
    if (options.modelRouter) {
      this.schemaExtractor = new SchemaExtractor(options.modelRouter);
    }
    
    // Register default providers
    this.registerProvider(new BasicFetchProvider());
    if (options.browserAgent) {
      this.registerProvider(new StagehandProvider(options.browserAgent));
    }
  }

  registerProvider(provider: FetchProvider): void {
    this.providers.set(provider.name, provider);
  }

  async fetch(url: string, options: WebFetchOptions = {}): Promise<WebFetchResult> {
    const cacheKey = generateCacheKey(url, options);
    
    if (options.useCache !== false) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return { ...cached, metadata: { ...cached.metadata, cacheHit: true } };
      }
    }

    const { renderMode } = this.planner.plan(url, options);
    
    // Fallback logic for provider selection
    let providerName = renderMode === "http" ? "basic-fetch" : "stagehand";
    if (providerName === "stagehand" && !this.providers.has("stagehand")) {
      providerName = "basic-fetch"; // Fallback to basic if browser agent not provided
    }
    
    const provider = this.providers.get(providerName);
    
    if (!provider) {
      throw new Error(`No provider found for mode: ${renderMode}`);
    }

    const partialResult = await provider.fetch(url, options);
    
    const rawMarkdown = this.cleaner.clean(partialResult.markdown || "", options);
    const cleanedMarkdown = this.dedupeEngine.dedupe(rawMarkdown);
    const title = this.cleaner.extractTitle(partialResult.markdown || "") || partialResult.metadata?.title;

    let structuredData = partialResult.structuredData;
    if (!structuredData && this.schemaExtractor && (options.schema || options.instructions)) {
      structuredData = await this.schemaExtractor.extract(cleanedMarkdown, options);
    }

    const result: WebFetchResult = {
      url: partialResult.url || url,
      markdown: cleanedMarkdown,
      structuredData,
      metadata: {
        ...partialResult.metadata!,
        title,
        cacheHit: false,
        relevanceScore: options.instructions ? await this.relevanceScorer.score(cleanedMarkdown, options.instructions) : undefined
      },
      sources: partialResult.sources || [{ url: partialResult.url || url, title }]
    };

    // Verify output
    await this.verificationBridge.verify(result);

    if (options.useCache !== false) {
      await this.cache.set(cacheKey, result);
    }

    return result;
  }

  async batchFetch(urls: string[], options: WebFetchOptions = {}): Promise<WebFetchResult[]> {
    return Promise.all(urls.map(url => this.fetch(url, options)));
  }
}
