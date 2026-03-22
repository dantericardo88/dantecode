import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { WebFetchResult } from "../types.js";

export class PersistentCache {
  private cacheDir: string;

  constructor(projectRoot: string) {
    this.cacheDir = join(projectRoot, ".danteforge", "web-cache");
  }

  async get(key: string): Promise<WebFetchResult | null> {
    const filePath = join(this.cacheDir, `${key}.json`);
    try {
      const data = await readFile(filePath, "utf-8");
      return JSON.parse(data) as WebFetchResult;
    } catch {
      return null;
    }
  }

  async set(key: string, result: WebFetchResult): Promise<void> {
    const filePath = join(this.cacheDir, `${key}.json`);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(result, null, 2), "utf-8");
  }
}
