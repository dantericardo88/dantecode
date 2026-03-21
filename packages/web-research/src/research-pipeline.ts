import type { EvidenceBundle, EvidenceSource } from "@dantecode/runtime-spine";
import { DuckDuckGoProvider } from "./search/duckduckgo.js";
import { RelevanceRanker } from "./extractor/ranker.js";
import { SemanticDeduper } from "./extractor/deduper.js";
import { EvidenceAggregator } from "./synthesis/aggregator.js";
import { SessionResearchCache } from "./cache/session-cache.js";
import { PersistentResearchCache } from "./cache/persistent-cache.js";
import { WebFetcher } from "./fetch/fetcher.js";

/** Duck-type interface — avoids a hard dep on @dantecode/web-extractor. */
interface WebExtractorLike {
  fetch(
    url: string,
    options?: { cleanLevel?: string },
  ): Promise<{ markdown: string; verificationWarnings?: string[] }>;
}

export interface ResearchPipelineOptions {
  projectRoot?: string;
  maxResults?: number;
  fetchTopN?: number;
  authorityOverrides?: Record<string, number>;
  /** Pass a WebExtractor instance for full markdown extraction (step 5). */
  webExtractor?: WebExtractorLike;
}

export interface ResearchResult {
  evidenceBundle: EvidenceBundle;
  cacheHit: boolean;
  resultCount: number;
  fetchedCount: number;
  /** Injection or content-safety warnings from fetched pages. */
  verificationWarnings?: string[];
}

/**
 * ResearchPipeline — the real end-to-end research machine.
 *
 * Implements the PRD's "native DDG + caching + relevance + dedup" vision:
 *   1. Session cache check (15-min LRU)
 *   2. Persistent cache check (7-day disk)
 *   3. Native DuckDuckGo search with retry/backoff
 *   4. BM25 relevance ranking
 *   5. Fetch + clean top-N results (WebExtractor when provided, else raw fetcher)
 *   6. Semantic deduplication
 *   7. Aggregate into EvidenceBundle
 *   8. Write-back to caches
 *
 * Authority overrides and WebExtractor are passed in via options — the pipeline
 * itself does no file I/O beyond its own cache layer.
 */
export class ResearchPipeline {
  private ddg: DuckDuckGoProvider;
  private ranker: RelevanceRanker;
  private deduper: SemanticDeduper;
  private aggregator: EvidenceAggregator;
  private fetcher: WebFetcher;
  private webExtractor: WebExtractorLike | undefined;
  private sessionCache: SessionResearchCache;
  private persistentCache: PersistentResearchCache | null;
  private maxResults: number;
  private fetchTopN: number;
  private authorityOverrides: Record<string, number> | undefined;

  constructor(options: ResearchPipelineOptions = {}) {
    this.ddg = new DuckDuckGoProvider();
    this.ranker = new RelevanceRanker();
    this.deduper = new SemanticDeduper();
    this.aggregator = new EvidenceAggregator();
    this.fetcher = new WebFetcher();
    this.sessionCache = new SessionResearchCache();
    this.persistentCache = options.projectRoot
      ? new PersistentResearchCache(options.projectRoot)
      : null;
    this.maxResults = options.maxResults ?? 10;
    this.fetchTopN = options.fetchTopN ?? 3;
    this.authorityOverrides = options.authorityOverrides;
    this.webExtractor = options.webExtractor;
  }

  async run(objective: string): Promise<ResearchResult> {
    // 1. Session cache check
    const sessionHit = this.sessionCache.get(objective);
    if (sessionHit) {
      const sources: EvidenceSource[] = sessionHit.map(r => ({
        url: r.url,
        title: r.title,
        snippet: r.snippet,
      }));
      const bundle = this.aggregator.aggregate(sources, sessionHit.map(r => r.snippet));
      return { evidenceBundle: bundle, cacheHit: true, resultCount: sessionHit.length, fetchedCount: 0 };
    }

    // 2. Persistent cache check
    if (this.persistentCache) {
      const persisted = await this.persistentCache.get(objective);
      if (persisted) {
        const sources: EvidenceSource[] = persisted.map(r => ({
          url: r.url,
          title: r.title,
          snippet: r.snippet,
        }));
        const bundle = this.aggregator.aggregate(sources, persisted.map(r => r.snippet));
        this.sessionCache.put(objective, persisted);
        return { evidenceBundle: bundle, cacheHit: true, resultCount: persisted.length, fetchedCount: 0 };
      }
    }

    // 3. Native DDG search
    const rawResults = await this.ddg.search(objective, { limit: this.maxResults });

    // 4. BM25 + authority ranking
    const ranked = this.ranker.rank(rawResults, objective, { authorityOverrides: this.authorityOverrides });

    // 5. Fetch + clean top-N
    const topN = ranked.slice(0, this.fetchTopN);
    const fetchedChunks: string[] = [];
    const allWarnings: string[] = [];

    for (const result of topN) {
      try {
        if (this.webExtractor) {
          const wxResult = await this.webExtractor.fetch(result.url, { cleanLevel: "standard" });
          if (wxResult.markdown.length > 50) {
            fetchedChunks.push(wxResult.markdown.slice(0, 3000));
          }
          if (wxResult.verificationWarnings?.length) {
            allWarnings.push(...wxResult.verificationWarnings);
          }
        } else {
          const fetched = await this.fetcher.fetch(result.url, { timeoutMs: 8000 });
          if (fetched.content.length > 50) {
            fetchedChunks.push(fetched.content.slice(0, 3000));
          }
        }
      } catch {
        // Non-fatal: use snippet as fallback
        if (result.snippet) fetchedChunks.push(result.snippet);
      }
    }

    // 6. Semantic dedup on all snippet-level content
    const allContent = [
      ...ranked.map(r => r.snippet).filter(Boolean),
      ...fetchedChunks,
    ];
    const dedupedChunks = this.deduper.dedupe(allContent, 0.75);

    // 7. Aggregate
    const sources: EvidenceSource[] = ranked.map(r => ({
      url: r.url,
      title: r.title,
      snippet: r.snippet,
    }));
    const bundle = this.aggregator.aggregate(sources, dedupedChunks);

    // 8. Write-back to caches
    this.sessionCache.put(objective, ranked);
    if (this.persistentCache) {
      await this.persistentCache.put(objective, ranked);
    }

    return {
      evidenceBundle: bundle,
      cacheHit: false,
      resultCount: ranked.length,
      fetchedCount: topN.length,
      verificationWarnings: allWarnings.length ? allWarnings : undefined,
    };
  }
}
