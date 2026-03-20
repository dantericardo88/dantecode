import { SearchResult } from "../types.js";

/**
 * In-memory cache for the current research session.
 */
export class SessionResearchCache {
  private cache = new Map<string, { results: SearchResult[]; timestamp: number }>();
  private readonly TTL = 15 * 60 * 1000; // 15 minutes

  get(query: string): SearchResult[] | null {
    const entry = this.cache.get(query);
    if (entry && Date.now() - entry.timestamp < this.TTL) {
      return entry.results;
    }
    this.cache.delete(query);
    return null;
  }

  put(query: string, results: SearchResult[]): void {
    this.cache.set(query, { results, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}
