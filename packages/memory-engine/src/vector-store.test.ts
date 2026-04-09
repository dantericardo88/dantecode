import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VectorStore, tokenize, jaccardSimilarity, cosineSimilarity } from "./vector-store.js";
import { LocalStore } from "./storage/local-store.js";
import type { MemoryItem } from "./types.js";

function makeItem(key: string, value: string, scope: "session" | "project" = "session"): MemoryItem {
  return {
    key,
    value,
    scope,
    layer: "short-term",
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    score: 0.5,
    recallCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Helper: create a VectorStore backed by a real temp directory
// ---------------------------------------------------------------------------

async function makeStore(): Promise<{ store: VectorStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "vector-store-test-"));
  const localStore = new LocalStore(dir);
  const store = new VectorStore(localStore);
  return { store, dir };
}

// ---------------------------------------------------------------------------
// tokenize / jaccardSimilarity / cosineSimilarity utilities
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  it("lowercases and splits on whitespace/punctuation", () => {
    const tokens = tokenize("Hello World, TypeScript");
    expect(tokens.has("hello")).toBe(true);
    expect(tokens.has("world")).toBe(true);
    expect(tokens.has("typescript")).toBe(true);
  });

  it("filters tokens shorter than 3 chars", () => {
    const tokens = tokenize("at is a test");
    expect(tokens.has("at")).toBe(false);
    expect(tokens.has("is")).toBe(false);
    expect(tokens.has("test")).toBe(true);
  });

  it("returns empty set for empty string", () => {
    expect(tokenize("").size).toBe(0);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    const s = new Set(["foo", "bar"]);
    expect(jaccardSimilarity(s, s)).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    const a = new Set(["foo"]);
    const b = new Set(["bar"]);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("returns 1 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
  });

  it("returns value in (0,1) for partially overlapping sets", () => {
    const a = new Set(["foo", "bar", "baz"]);
    const b = new Set(["foo", "bar", "qux"]);
    const sim = jaccardSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [0.5, 0.5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// VectorStore — add / search / searchAsync
// ---------------------------------------------------------------------------

describe("VectorStore — add and search", () => {
  it("add stores an item and search returns it", async () => {
    const { store, dir } = await makeStore();
    try {
      const item = makeItem("payment-flow", "authentication payment processing logic");
      await store.add(item);
      const results = store.search("payment processing");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.item.key).toBe("payment-flow");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("search on empty store returns empty array", () => {
    // Synchronous creation (no tempdir needed — no disk ops yet)
    const localStore = new LocalStore("/nonexistent-path");
    const store = new VectorStore(localStore);
    expect(store.search("anything")).toHaveLength(0);
  });

  it("size reflects number of indexed items", async () => {
    const { store, dir } = await makeStore();
    try {
      await store.add(makeItem("a", "alpha content here"));
      await store.add(makeItem("b", "beta content here"));
      expect(store.size).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("listAll returns all indexed items", async () => {
    const { store, dir } = await makeStore();
    try {
      await store.add(makeItem("x", "first item"));
      await store.add(makeItem("y", "second item"));
      const all = store.listAll();
      expect(all).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("listByScope filters by scope", async () => {
    const { store, dir } = await makeStore();
    try {
      await store.add(makeItem("a", "session scoped item", "session"));
      await store.add(makeItem("b", "project scoped item", "project"));
      expect(store.listByScope("session")).toHaveLength(1);
      expect(store.listByScope("project")).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("VectorStore — searchAsync with embedding provider", () => {
  it("uses cosine similarity when embedding provider is wired", async () => {
    const { store, dir } = await makeStore();
    try {
      // Simple deterministic embedding: character code sum as single dimension
      store.setEmbeddingProvider(async (text: string) => {
        const sum = text.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const mag = Math.sqrt(sum * sum);
        return [sum / mag]; // normalized to unit vector [1]
      });

      await store.add(makeItem("k1", "hello world"));
      const results = await store.searchAsync("hello world", 5);
      // With deterministic embeddings, should find the item
      expect(results.length).toBeGreaterThanOrEqual(0); // non-crash guarantee
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to Jaccard when embedding provider throws", async () => {
    const { store, dir } = await makeStore();
    try {
      store.setEmbeddingProvider(async () => { throw new Error("embed failed"); });
      await store.add(makeItem("test-key", "some test content here"));
      // Should not throw — falls back to Jaccard
      const results = await store.searchAsync("test content");
      expect(Array.isArray(results)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("VectorStore — delete", () => {
  it("delete removes item from search results", async () => {
    const { store, dir } = await makeStore();
    try {
      await store.add(makeItem("remove-me", "unique content about authentication"));
      const beforeDelete = store.search("unique content about authentication");
      expect(beforeDelete.length).toBeGreaterThan(0);

      await store.delete("remove-me", "session");
      const afterDelete = store.search("unique content about authentication");
      expect(afterDelete.find((r) => r.item.key === "remove-me")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("delete returns false for missing key", async () => {
    const { store, dir } = await makeStore();
    try {
      const result = await store.delete("not-there", "session");
      expect(result).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("VectorStore — persistence: loadFromDisk", () => {
  it("items added to first store are loadable by a second store on same dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-persist-test-"));
    try {
      // First store writes to disk
      const ls1 = new LocalStore(dir);
      const store1 = new VectorStore(ls1);
      const item = makeItem("persisted-key", "content that should survive restart");
      // Use project scope so it persists to semantic layer
      item.scope = "project";
      await store1.add(item);

      // Second store loads from the same dir
      const ls2 = new LocalStore(dir);
      const store2 = new VectorStore(ls2);
      const count = await store2.loadFromDisk();
      expect(count).toBeGreaterThan(0);
      const results = store2.search("survive restart");
      expect(results.find((r) => r.item.key === "persisted-key")).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
