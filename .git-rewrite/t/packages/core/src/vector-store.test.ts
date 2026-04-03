import { describe, expect, it } from "vitest";
import {
  InMemoryVectorStore,
  LanceDBVectorStore,
  createVectorStore,
  type VectorStore,
} from "./vector-store.js";

describe("InMemoryVectorStore", () => {
  function createStore(): InMemoryVectorStore {
    return new InMemoryVectorStore();
  }

  it("starts empty", () => {
    const store = createStore();
    expect(store.count()).toBe(0);
  });

  it("adds and counts entries", async () => {
    const store = createStore();
    await store.add("a", [1, 0, 0], { filePath: "a.ts" });
    await store.add("b", [0, 1, 0], { filePath: "b.ts" });
    expect(store.count()).toBe(2);
  });

  it("adds entries in batch", async () => {
    const store = createStore();
    await store.addBatch([
      { id: "x", vector: [1, 0], metadata: { filePath: "x.ts" } },
      { id: "y", vector: [0, 1], metadata: { filePath: "y.ts" } },
      { id: "z", vector: [1, 1], metadata: { filePath: "z.ts" } },
    ]);
    expect(store.count()).toBe(3);
  });

  it("overwrites entries with the same id", async () => {
    const store = createStore();
    await store.add("a", [1, 0], { filePath: "old.ts" });
    await store.add("a", [0, 1], { filePath: "new.ts" });
    expect(store.count()).toBe(1);

    const results = await store.search([0, 1], 1);
    expect(results[0]!.metadata.filePath).toBe("new.ts");
  });

  it("searches by cosine similarity", async () => {
    const store = createStore();
    await store.add("auth", [1, 0, 0], { filePath: "auth.ts" });
    await store.add("db", [0, 1, 0], { filePath: "db.ts" });
    await store.add("api", [0.9, 0.1, 0], { filePath: "api.ts" });

    const results = await store.search([1, 0, 0], 3);
    // db [0,1,0] is orthogonal to query [1,0,0], so filtered (score=0)
    expect(results.length).toBe(2);
    // auth.ts should be closest to [1,0,0]
    expect(results[0]!.id).toBe("auth");
    // api.ts should be second (0.9 in first dimension)
    expect(results[1]!.id).toBe("api");
  });

  it("respects the limit parameter", async () => {
    const store = createStore();
    await store.add("a", [1, 0], {});
    await store.add("b", [0.9, 0.1], {});
    await store.add("c", [0.8, 0.2], {});
    await store.add("d", [0.7, 0.3], {});

    const results = await store.search([1, 0], 2);
    expect(results).toHaveLength(2);
  });

  it("returns empty for empty store", async () => {
    const store = createStore();
    const results = await store.search([1, 0, 0]);
    expect(results).toEqual([]);
  });

  it("returns empty for empty query vector", async () => {
    const store = createStore();
    await store.add("a", [1, 0], {});
    const results = await store.search([]);
    expect(results).toEqual([]);
  });

  it("filters out zero-score results", async () => {
    const store = createStore();
    await store.add("a", [1, 0], {});
    await store.add("b", [0, 1], {});

    // Query orthogonal to 'b'
    const results = await store.search([1, 0], 10);
    // 'b' has cosine similarity 0 with [1,0], should be filtered
    expect(results.every((r) => r.score > 0)).toBe(true);
    expect(results.some((r) => r.id === "a")).toBe(true);
  });

  it("deletes entries", async () => {
    const store = createStore();
    await store.add("a", [1, 0], {});
    await store.add("b", [0, 1], {});
    expect(store.count()).toBe(2);

    const deleted = await store.delete("a");
    expect(deleted).toBe(true);
    expect(store.count()).toBe(1);

    const notDeleted = await store.delete("nonexistent");
    expect(notDeleted).toBe(false);
  });

  it("clears all entries", async () => {
    const store = createStore();
    await store.add("a", [1, 0], {});
    await store.add("b", [0, 1], {});
    store.clear();
    expect(store.count()).toBe(0);
  });

  it("returns metadata in search results", async () => {
    const store = createStore();
    await store.add("chunk-1", [1, 0], { filePath: "src/auth.ts", startLine: 10, endLine: 25 });

    const results = await store.search([1, 0], 1);
    expect(results[0]!.metadata).toEqual({
      filePath: "src/auth.ts",
      startLine: 10,
      endLine: 25,
    });
  });

  it("scores are between 0 and 1 for normalized vectors", async () => {
    const store = createStore();
    await store.add("a", [0.6, 0.8], {});
    await store.add("b", [0.8, 0.6], {});

    const results = await store.search([1, 0], 2);
    for (const result of results) {
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });
});

describe("LanceDBVectorStore", () => {
  it("falls back to InMemoryVectorStore when vectordb is not installed", async () => {
    const store = new LanceDBVectorStore("/tmp/test-lance-db");
    await store.add("a", [1, 0, 0], { filePath: "a.ts" });
    expect(store.count()).toBe(1);

    const results = await store.search([1, 0, 0], 5);
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe("a");
  });

  it("supports batch add in fallback mode", async () => {
    const store = new LanceDBVectorStore("/tmp/test-lance-db-batch");
    await store.addBatch([
      { id: "x", vector: [1, 0], metadata: { filePath: "x.ts" } },
      { id: "y", vector: [0, 1], metadata: { filePath: "y.ts" } },
    ]);
    expect(store.count()).toBe(2);
  });

  it("supports delete in fallback mode", async () => {
    const store = new LanceDBVectorStore("/tmp/test-lance-db-del");
    await store.add("a", [1, 0], {});
    const deleted = await store.delete("a");
    expect(deleted).toBe(true);
    expect(store.count()).toBe(0);
  });

  it("clears entries", async () => {
    const store = new LanceDBVectorStore("/tmp/test-lance-db-clear");
    await store.add("a", [1, 0], {});
    store.clear();
    expect(store.count()).toBe(0);
  });
});

describe("createVectorStore", () => {
  it("creates InMemoryVectorStore when no dbPath given", () => {
    const store = createVectorStore();
    expect(store).toBeInstanceOf(InMemoryVectorStore);
  });

  it("creates LanceDBVectorStore when dbPath is given", () => {
    const store = createVectorStore("/tmp/test-db");
    expect(store).toBeInstanceOf(LanceDBVectorStore);
  });

  it("returned store satisfies VectorStore interface", async () => {
    const store: VectorStore = createVectorStore();
    await store.add("test", [1, 0, 0], {});
    expect(store.count()).toBe(1);
    const results = await store.search([1, 0, 0], 1);
    expect(results).toHaveLength(1);
  });
});
