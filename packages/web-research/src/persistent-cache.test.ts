import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PersistentResearchCache } from "./cache/persistent-cache.js";
import type { SearchResult } from "./types.js";

function makeResults(count: number): SearchResult[] {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://example.com/${i}`,
    snippet: `Snippet for result ${i}`,
    position: i,
    title: `Result ${i}`,
  }));
}

async function makeCache(): Promise<{ cache: PersistentResearchCache; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "research-cache-test-"));
  const cache = new PersistentResearchCache(dir);
  return { cache, dir };
}

// ---------------------------------------------------------------------------
// PersistentResearchCache — get / put round-trip
// ---------------------------------------------------------------------------

describe("PersistentResearchCache — get / put", () => {
  it("returns null for an unset key", async () => {
    const { cache, dir } = await makeCache();
    try {
      expect(await cache.get("nonexistent query")).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("put then get returns the stored results", async () => {
    const { cache, dir } = await makeCache();
    try {
      const results = makeResults(3);
      await cache.put("TypeScript best practices", results);
      const retrieved = await cache.get("TypeScript best practices");
      expect(retrieved).not.toBeNull();
      expect(retrieved!).toHaveLength(3);
      expect(retrieved![0]!.title).toBe("Result 0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null for a different query key", async () => {
    const { cache, dir } = await makeCache();
    try {
      await cache.put("query A", makeResults(2));
      expect(await cache.get("query B")).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("overwrites existing entry on re-put", async () => {
    const { cache, dir } = await makeCache();
    try {
      await cache.put("query", makeResults(2));
      await cache.put("query", makeResults(5));
      const result = await cache.get("query");
      expect(result).toHaveLength(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// PersistentResearchCache — cross-instance persistence
// ---------------------------------------------------------------------------

describe("PersistentResearchCache — cross-instance persistence", () => {
  it("item stored by first instance is retrievable by second instance on same dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-persist-test-"));
    try {
      const cache1 = new PersistentResearchCache(dir);
      await cache1.put("search query persist test", makeResults(3));

      const cache2 = new PersistentResearchCache(dir);
      const retrieved = await cache2.get("search query persist test");
      expect(retrieved).not.toBeNull();
      expect(retrieved!).toHaveLength(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// PersistentResearchCache — concurrent writes
// ---------------------------------------------------------------------------

describe("PersistentResearchCache — concurrent writes", () => {
  it("20 concurrent puts all result in retrievable entries", async () => {
    const { cache, dir } = await makeCache();
    try {
      const queries = Array.from({ length: 20 }, (_, i) => `query-${i}`);
      await Promise.all(queries.map((q) => cache.put(q, makeResults(2))));

      // Verify all are retrievable
      const results = await Promise.all(queries.map((q) => cache.get(q)));
      for (const r of results) {
        expect(r).not.toBeNull();
        expect(r!).toHaveLength(2);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// PersistentResearchCache — directory auto-creation
// ---------------------------------------------------------------------------

describe("PersistentResearchCache — directory setup", () => {
  it("put creates the cache directory if it does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-dir-test-"));
    const nestedDir = join(dir, "deeply", "nested");
    try {
      const cache = new PersistentResearchCache(nestedDir);
      // Should not throw even though the directory doesn't exist yet
      await expect(cache.put("test query", makeResults(1))).resolves.toBeUndefined();
      const retrieved = await cache.get("test query");
      expect(retrieved).not.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
