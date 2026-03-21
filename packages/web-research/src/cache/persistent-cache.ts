import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SearchResult } from "../types.js";
import { generateCacheKey } from "./cache-key.js";

/**
 * Persistent research cache for storing search results.
 * Integrates with the project root for persistence across sessions.
 */
export class PersistentResearchCache {
  private cacheDir: string;

  constructor(projectRoot: string) {
    this.cacheDir = join(projectRoot, ".dantecode", "cache", "research");
  }

  private async ensureDir() {
    await mkdir(this.cacheDir, { recursive: true });
  }

  async get(query: string): Promise<SearchResult[] | null> {
    const key = generateCacheKey(query);
    const filePath = join(this.cacheDir, `${key}.json`);

    try {
      const data = await readFile(filePath, "utf-8");
      const entry = JSON.parse(data);

      // TTL: 7 days (per PRD — persistent cache should survive multi-day sessions)
      const TTL = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - entry.timestamp > TTL) {
        return null;
      }

      return entry.results;
    } catch {
      return null;
    }
  }

  async put(query: string, results: SearchResult[]): Promise<void> {
    await this.ensureDir();
    const key = generateCacheKey(query);
    const filePath = join(this.cacheDir, `${key}.json`);

    const entry = {
      query,
      timestamp: Date.now(),
      results,
    };

    await writeFile(filePath, JSON.stringify(entry, null, 2));
  }
}
