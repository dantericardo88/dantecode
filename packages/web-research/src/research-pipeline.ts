import type { EvidenceBundle, EvidenceSource } from "@dantecode/runtime-spine";
import { DuckDuckGoProvider } from "./search/duckduckgo.js";
import { RelevanceRanker } from "./extractor/ranker.js";
import { SemanticDeduper } from "./extractor/deduper.js";
import { EvidenceAggregator } from "./synthesis/aggregator.js";
import { SessionResearchCache } from "./cache/session-cache.js";
import { PersistentResearchCache } from "./cache/persistent-cache.js";
import { WebFetcher } from "./fetch/fetcher.js";

export interface ResearchPipelineOptions {
  projectRoot?: string;
  maxResults?: number;
  fetchTopN?: number;
}

export interface ResearchResult {
  evidenceBundle: EvidenceBundle;
  cacheHit: boolean;
  resultCount: number;
  fetchedCount: number;
}

/**
 * ResearchPipeline — the real end-to-end research machine.
 *
 * Implements the PRD's "native DDG + caching + relevance + dedup" vision:
 *   1. Session cache check (15-min LRU)
 *   2. Persistent cache check (7-day disk)
 *   3. Native DuckDuckGo search with retry/backoff
 *   4. BM25 relevance ranking
 *   5. Fetch + clean top-N results
 *   6. Semantic deduplication
 *   7. Aggregate into EvidenceBundle
 *   8. Write-back to caches
 */
export class ResearchPipeline {
  private ddg: DuckDuckGoProvider;
  private ranker: RelevanceRanker;
  private deduper: SemanticDeduper;
  private aggregator: EvidenceAggregator;
  private fetcher: WebFetcher;
  private sessionCache: SessionResearchCache;
  private persistentCache: PersistentResearchCache | null;
  private maxResults: number;
  private fetchTopN: number;

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

    // 4. BM25 ranking
    const ranked = this.ranker.rank(rawResults, objective);

    // 5. Fetch + clean top-N
    const topN = ranked.slice(0, this.fetchTopN);
    const fetchedChunks: string[] = [];

    for (const result of topN) {
      try {
        const fetched = await this.fetcher.fetch(result.url, { timeoutMs: 8000 });
        if (fetched.content.length > 50) {
          fetchedChunks.push(fetched.content.slice(0, 3000));
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
    };
  }
}
