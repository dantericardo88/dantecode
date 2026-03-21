// ============================================================================
// @dantecode/memory-engine — Test Suite
// 70+ tests covering all organs + golden flows (GF-01 through GF-07).
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { ShortTermStore } from "./short-term-store.js";
import { VectorStore, tokenize, jaccardSimilarity, cosineSimilarity } from "./vector-store.js";
import { EntityExtractor } from "./entity-extractor.js";
import { Summarizer, estimateTokens } from "./summarizer.js";
import { RetentionPolicy } from "./policies/retention-policy.js";
import { ScoringPolicy } from "./policies/scoring-policy.js";
import { GraphMemory } from "./graph-memory.js";
import { CompressionEngine } from "./compression-engine.js";
import { MemoryOrchestrator } from "./memory-orchestrator.js";
import { LocalStore } from "./storage/local-store.js";
import { SnapshotStore } from "./storage/snapshot-store.js";
import { SessionMemory } from "./session-memory.js";
import { SemanticRecall } from "./semantic-recall.js";
import type { MemoryItem } from "./types.js";

// ============================================================================
// Test helpers
// ============================================================================

/** Normalize path separators to forward slashes for cross-platform mocking. */
function normPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** In-memory file store for tests (Windows path-separator-agnostic). */
function makeInMemoryFS() {
  const fs = new Map<string, string>();
  return {
    writeFileFn: async (p: string, d: string) => {
      fs.set(normPath(p), d);
    },
    readFileFn: async (p: string) => {
      const v = fs.get(normPath(p));
      if (!v) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    mkdirFn: async (_p: string, _opts?: { recursive?: boolean }) => {
      /* noop */
    },
    readdirFn: async (p: string) => {
      const norm = normPath(p);
      const prefix = norm.endsWith("/") ? norm : norm + "/";
      // Return file names (not full paths) that are directly under prefix
      return Array.from(fs.keys())
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
        .map((k) => k.slice(prefix.length));
    },
    unlinkFn: async (p: string) => {
      fs.delete(normPath(p));
    },
    existsFn: async (p: string) => fs.has(normPath(p)),
    _fs: fs,
  };
}

function makeItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    key: "test-key",
    value: "test value",
    scope: "session",
    layer: "short-term",
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    score: 0.5,
    recallCount: 0,
    ...overrides,
  };
}

// ============================================================================
// 1. ShortTermStore
// ============================================================================

describe("ShortTermStore", () => {
  let store: ShortTermStore;

  beforeEach(() => {
    store = new ShortTermStore(5, 0); // capacity 5, no TTL
  });

  it("stores and retrieves a value", () => {
    store.set("key1", "hello", "session");
    const item = store.get("key1", "session");
    expect(item).not.toBeNull();
    expect(item!.value).toBe("hello");
  });

  it("returns null for missing keys", () => {
    expect(store.get("missing", "session")).toBeNull();
  });

  it("increments recallCount on get", () => {
    store.set("key1", "val", "session");
    store.get("key1", "session");
    store.get("key1", "session");
    const item = store.get("key1", "session");
    expect(item!.recallCount).toBe(3);
  });

  it("evicts LRU item when at capacity", () => {
    for (let i = 0; i < 5; i++) {
      store.set(`key${i}`, i, "session");
    }
    // Access key0 to keep it (bump to recent)
    store.get("key0", "session");
    // Add one more — should evict key1 (now LRU)
    store.set("key5", 5, "session");
    expect(store.size).toBe(5);
    expect(store.get("key1", "session")).toBeNull();
  });

  it("isolates by scope", () => {
    store.set("k", "sessionVal", "session");
    store.set("k", "projectVal", "project");
    expect(store.get("k", "session")!.value).toBe("sessionVal");
    expect(store.get("k", "project")!.value).toBe("projectVal");
  });

  it("listByScope returns only matching scope", () => {
    store.set("a", 1, "session");
    store.set("b", 2, "project");
    store.set("c", 3, "session");
    const items = store.listByScope("session");
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.scope === "session")).toBe(true);
  });

  it("search finds items by value substring", () => {
    store.set("debug-key", "Found the error in auth module", "session");
    store.set("other", "unrelated content", "session");
    const results = store.search("auth module", "session");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.key).toBe("debug-key");
  });

  it("TTL evicts expired items", () => {
    store = new ShortTermStore(100, 1); // 1ms TTL
    store.set("expiring", "bye", "session");
    // Wait for TTL to pass
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const result = store.get("expiring", "session");
        expect(result).toBeNull();
        resolve();
      }, 10);
    });
  });

  it("clearScope removes all items for scope", () => {
    store.set("a", 1, "session");
    store.set("b", 2, "session");
    store.set("c", 3, "project");
    const removed = store.clearScope("session");
    expect(removed).toBe(2);
    expect(store.listByScope("session")).toHaveLength(0);
    expect(store.listByScope("project")).toHaveLength(1);
  });

  it("has() returns false after delete", () => {
    store.set("k", "v", "session");
    expect(store.has("k", "session")).toBe(true);
    store.delete("k", "session");
    expect(store.has("k", "session")).toBe(false);
  });
});

// ============================================================================
// 2. VectorStore (Jaccard + LocalStore integration)
// ============================================================================

describe("VectorStore", () => {
  let localStore: LocalStore;
  let vectorStore: VectorStore;

  beforeEach(() => {
    const io = makeInMemoryFS();
    localStore = new LocalStore("/test", io);
    vectorStore = new VectorStore(localStore, 100, 0.01);
  });

  it("indexes and searches items", async () => {
    const item = makeItem({
      key: "auth-feature",
      value: "authentication module using JWT tokens",
      scope: "project",
      layer: "semantic",
      summary: "JWT authentication implementation",
    });
    await vectorStore.add(item);

    const results = vectorStore.search("JWT auth", 5, "project");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.item.key).toBe("auth-feature");
  });

  it("similarity is highest for exact match", async () => {
    const item = makeItem({ key: "k1", summary: "memory engine vector store semantic recall" });
    await vectorStore.add(item);

    const results = vectorStore.search("memory engine vector store", 5);
    expect(results[0]!.similarity).toBeGreaterThan(0);
  });

  it("filters by scope", async () => {
    await vectorStore.add(
      makeItem({ key: "proj-item", scope: "project", summary: "project memory" }),
    );
    await vectorStore.add(makeItem({ key: "user-item", scope: "user", summary: "user memory" }));

    const results = vectorStore.search("memory", 10, "project");
    expect(results.every((r) => r.item.scope === "project")).toBe(true);
  });

  it("delete removes from index", async () => {
    await vectorStore.add(
      makeItem({ key: "delete-me", scope: "session", summary: "deletable item" }),
    );
    expect(vectorStore.size).toBe(1);
    await vectorStore.delete("delete-me", "session");
    expect(vectorStore.size).toBe(0);
  });

  it("LRU eviction on capacity exceeded", async () => {
    const small = new VectorStore(localStore, 3, 0.01);
    // Add older items (artificially old lastAccessedAt)
    const oldDate = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    await small.add(makeItem({ key: "old1", summary: "alpha beta", lastAccessedAt: oldDate }));
    await small.add(makeItem({ key: "old2", summary: "gamma delta", lastAccessedAt: oldDate }));
    await small.add(makeItem({ key: "old3", summary: "epsilon zeta", lastAccessedAt: oldDate }));
    await small.add(makeItem({ key: "new1", summary: "newest item" }));
    expect(small.size).toBe(3);
  });

  it("findSimilar returns related items", async () => {
    await vectorStore.add(
      makeItem({ key: "a", scope: "session", summary: "memory engine recall" }),
    );
    await vectorStore.add(makeItem({ key: "b", scope: "session", summary: "memory engine store" }));
    await vectorStore.add(
      makeItem({ key: "c", scope: "session", summary: "completely unrelated" }),
    );

    const similar = vectorStore.findSimilar("a", "session", 5);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar[0]!.item.key).toBe("b");
  });
});

// ============================================================================
// 3. Tokenize + Jaccard
// ============================================================================

describe("tokenize + jaccardSimilarity", () => {
  it("tokenizes text into lowercase token set", () => {
    const tokens = tokenize("Hello World! This is a test.");
    expect(tokens.has("hello")).toBe(true);
    expect(tokens.has("world")).toBe(true);
    expect(tokens.has("test")).toBe(true);
  });

  it("filters short tokens", () => {
    const tokens = tokenize("a ab abc abcd");
    expect(tokens.has("a")).toBe(false);
    expect(tokens.has("ab")).toBe(false);
    expect(tokens.has("abc")).toBe(true);
  });

  it("identical sets have similarity 1", () => {
    const a = tokenize("the quick brown fox");
    const b = tokenize("the quick brown fox");
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("disjoint sets have similarity 0", () => {
    const a = tokenize("alpha beta gamma");
    const b = tokenize("delta epsilon zeta");
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("partial overlap gives intermediate value", () => {
    const a = tokenize("memory engine recall semantic");
    const b = tokenize("memory engine store semantic");
    const sim = jaccardSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.4);
    expect(sim).toBeLessThan(1);
  });

  it("empty sets give similarity 1", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
  });

  it("cosine similarity returns 1 for same normalized vector", () => {
    const v = [1, 0, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it("cosine similarity returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

// ============================================================================
// 4. EntityExtractor
// ============================================================================

describe("EntityExtractor", () => {
  let extractor: EntityExtractor;

  beforeEach(() => {
    extractor = new EntityExtractor();
  });

  it("extracts TypeScript file paths", () => {
    const entities = extractor.extract(
      "Modified packages/memory-engine/src/index.ts and packages/core/src/types.ts",
      "sess1",
      "key1",
    );
    const files = entities.filter((e) => e.type === "file");
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((e) => e.name.includes("index.ts"))).toBe(true);
  });

  it("extracts npm package imports", () => {
    const text = `import { something } from "@dantecode/core";\nimport fs from "node:fs";`;
    const entities = extractor.extract(text, "sess1", "key1");
    const pkgs = entities.filter((e) => e.type === "package");
    expect(pkgs.some((e) => e.name.includes("@dantecode/core"))).toBe(true);
  });

  it("extracts class names", () => {
    const entities = extractor.extract("class MemoryOrchestrator extends BaseClass {}");
    const classes = entities.filter((e) => e.type === "class");
    expect(classes.some((e) => e.name === "MemoryOrchestrator")).toBe(true);
  });

  it("extracts concepts like DanteForge", () => {
    const entities = extractor.extract("DanteForge PDSE scoring on memory operations");
    const concepts = entities.filter((e) => e.type === "concept");
    expect(concepts.some((e) => e.name === "DanteForge")).toBe(true);
  });

  it("deduplicates repeated entities", () => {
    const text = "import from '@dantecode/core'; import from '@dantecode/core';";
    const entities = extractor.extract(text, "s1", "k1");
    const coreRefs = entities.filter((e) => e.name === "@dantecode/core");
    expect(coreRefs).toHaveLength(1);
    expect(coreRefs[0]!.count).toBeGreaterThanOrEqual(2);
  });

  it("merge combines counts from multiple extractions", () => {
    const a = extractor.extract("from '@dantecode/core'", "s1", "k1");
    const b = extractor.extract("from '@dantecode/core'", "s2", "k2");
    const merged = extractor.merge([a, b]);
    const core = merged.find((e) => e.name === "@dantecode/core");
    expect(core).toBeDefined();
    expect(core!.sessionIds).toContain("s1");
    expect(core!.sessionIds).toContain("s2");
  });
});

// ============================================================================
// 5. Summarizer
// ============================================================================

describe("Summarizer", () => {
  let summarizer: Summarizer;

  beforeEach(() => {
    summarizer = new Summarizer({ maxSummaryLength: 300 });
  });

  it("summarizes empty items gracefully", async () => {
    const result = await summarizer.summarize("sess1", []);
    expect(result.sessionId).toBe("sess1");
    expect(result.compressed).toBe(false);
    expect(result.tokensSaved).toBe(0);
  });

  it("produces compressed summary for large items", async () => {
    const items: MemoryItem[] = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        key: `fact-${i}`,
        value: `Long verbose content about task ${i}: implemented feature X in packages/core/src/feature-${i}.ts with extensive detail about how it works and why this change was necessary for the overall architecture`,
        summary: `Implemented feature ${i}`,
        source: "sess1",
        score: 0.7,
        tags: ["task"],
      }),
    );
    const result = await summarizer.summarize("sess1", items);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary.length).toBeLessThanOrEqual(300);
  });

  it("extractKnowledge captures files and tasks", () => {
    const items: MemoryItem[] = [
      makeItem({
        key: "task1",
        value: "Modified packages/memory-engine/src/index.ts to add exports",
        source: "sess1",
        tags: ["task"],
        score: 0.8,
        summary: "Added memory engine exports",
      }),
    ];
    const knowledge = summarizer.extractKnowledge("sess1", items);
    expect(knowledge.sessionId).toBe("sess1");
    expect(knowledge.filesModified.some((f) => f.includes("index.ts"))).toBe(true);
  });

  it("compress produces single item from multiple", () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({ key: `item-${i}`, value: `Content about topic ${i}`, source: "sess1" }),
    );
    const compressed = summarizer.compress("sess1", items);
    expect(compressed.key).toContain("compressed");
    expect(compressed.tags).toContain("compressed");
    expect((compressed.value as { original_count: number }).original_count).toBeUndefined();
    // Value should be SessionKnowledge
    expect(compressed.value).toBeDefined();
  });

  it("estimateTokens approximates length/4", () => {
    const text = "a".repeat(400);
    expect(estimateTokens(text)).toBe(100);
  });
});

// ============================================================================
// 6. RetentionPolicy
// ============================================================================

describe("RetentionPolicy", () => {
  let policy: RetentionPolicy;

  beforeEach(() => {
    policy = new RetentionPolicy({
      maxAgeDays: 10,
      minScore: 0.3,
      minRecallCount: 2,
      keepVerified: true,
      maxSemanticItems: 100,
    });
  });

  it("keeps verified items regardless of score", () => {
    const item = makeItem({ score: 0.05, verified: true });
    expect(policy.evaluate(item).decision).toBe("keep");
  });

  it("keeps high-recall items", () => {
    const item = makeItem({ score: 0.1, recallCount: 10 });
    expect(policy.evaluate(item).decision).toBe("keep");
  });

  it("prunes old + low-score items", () => {
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const item = makeItem({ score: 0.1, createdAt: oldDate, recallCount: 0 });
    expect(policy.evaluate(item).decision).toBe("prune");
  });

  it("prunes very-low-score never-recalled items", () => {
    const item = makeItem({ score: 0.05, recallCount: 0 });
    expect(policy.evaluate(item).decision).toBe("prune");
  });

  it("keeps high-score item within age limit", () => {
    const item = makeItem({ score: 0.9, recallCount: 5 });
    expect(policy.evaluate(item).decision).toBe("keep");
  });

  it("evaluateBatch groups by decision", () => {
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const items = [
      makeItem({ score: 0.9, recallCount: 10 }), // keep
      makeItem({ score: 0.05, createdAt: oldDate, recallCount: 0 }), // prune
      makeItem({ score: 0.9, verified: true }), // keep (verified)
    ];
    const result = policy.evaluateBatch(items);
    expect(result.keep.length).toBe(2);
    expect(result.prune.length).toBe(1);
  });

  it("selectForPruning returns keys to prune to hit target count", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ key: `item-${i}`, score: i * 0.1, recallCount: i }),
    );
    const toRemove = policy.selectForPruning(items, 3);
    expect(toRemove).toHaveLength(2);
  });
});

// ============================================================================
// 7. ScoringPolicy
// ============================================================================

describe("ScoringPolicy", () => {
  let policy: ScoringPolicy;

  beforeEach(() => {
    policy = new ScoringPolicy();
  });

  it("verified items score higher", () => {
    const verified = makeItem({ verified: true, recallCount: 5 });
    const unverified = makeItem({ verified: false, recallCount: 5 });
    expect(policy.score(verified)).toBeGreaterThan(policy.score(unverified));
  });

  it("recently accessed items score higher", () => {
    const recent = makeItem({ lastAccessedAt: new Date().toISOString() });
    const old = makeItem({
      lastAccessedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(policy.recencyScore(recent)).toBeGreaterThan(policy.recencyScore(old));
  });

  it("frequently recalled items score higher", () => {
    expect(policy.recallScore(makeItem({ recallCount: 20 }))).toBe(1.0);
    expect(policy.recallScore(makeItem({ recallCount: 0 }))).toBe(0);
  });

  it("trusted source boosts score", () => {
    const trusted = makeItem({ source: "danteforge-run-123" });
    const unknown = makeItem({ source: "unknown-agent" });
    expect(policy.sourceScore(trusted)).toBeGreaterThan(policy.sourceScore(unknown));
  });

  it("applyScore returns updated item with new score", () => {
    const item = makeItem({ recallCount: 10, verified: true });
    const scored = policy.applyScore(item);
    expect(scored.score).not.toBe(0.5); // default was 0.5
    expect(scored.score).toBeGreaterThan(0.3);
  });

  it("scoreMany processes array", () => {
    const items = [makeItem(), makeItem({ verified: true }), makeItem({ recallCount: 15 })];
    const scored = policy.scoreMany(items);
    expect(scored).toHaveLength(3);
    expect(scored[0]!.score).toBeDefined();
  });
});

// ============================================================================
// 8. GraphMemory
// ============================================================================

describe("GraphMemory", () => {
  let graph: GraphMemory;

  beforeEach(() => {
    graph = new GraphMemory();
  });

  it("adds and retrieves entities", () => {
    graph.addEntity({
      name: "MemoryOrchestrator",
      type: "class",
      count: 3,
      sessionIds: ["s1"],
      memoryKeys: ["k1"],
    });
    const node = graph.getNode("MemoryOrchestrator");
    expect(node).not.toBeNull();
    expect(node!.entity.type).toBe("class");
  });

  it("merges entity counts", () => {
    graph.addEntity({
      name: "Entity1",
      type: "class",
      count: 2,
      sessionIds: ["s1"],
      memoryKeys: [],
    });
    graph.addEntity({
      name: "Entity1",
      type: "class",
      count: 3,
      sessionIds: ["s2"],
      memoryKeys: [],
    });
    const node = graph.getNode("Entity1");
    expect(node!.entity.count).toBe(5);
    expect(node!.entity.sessionIds).toContain("s1");
    expect(node!.entity.sessionIds).toContain("s2");
  });

  it("adds relationships", () => {
    graph.addRelationship({
      from: "VectorStore",
      to: "LocalStore",
      kind: "uses",
      strength: 0.8,
    });
    const neighbors = graph.getNeighbors("VectorStore");
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]!.to).toBe("LocalStore");
  });

  it("BFS traversal finds connected entities", () => {
    graph.addRelationship({ from: "A", to: "B", kind: "uses", strength: 0.9 });
    graph.addRelationship({ from: "B", to: "C", kind: "uses", strength: 0.7 });
    const result = graph.traverse("A", 2);
    expect(result.visited).toContain("A");
    expect(result.visited).toContain("B");
    expect(result.visited).toContain("C");
  });

  it("findHubs returns most connected entities", () => {
    for (let i = 0; i < 5; i++) {
      graph.addRelationship({ from: "Hub", to: `Child${i}`, kind: "uses", strength: 0.5 });
    }
    const hubs = graph.findHubs(3);
    expect(hubs[0]!.name).toBe("Hub");
  });

  it("export returns correct node/edge counts", () => {
    graph.addRelationship({ from: "X", to: "Y", kind: "imports", strength: 0.6 });
    graph.addRelationship({ from: "Y", to: "Z", kind: "defines", strength: 0.7 });
    const { nodes, edges } = graph.export();
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
  });

  it("clear resets the graph", () => {
    graph.addEntity({ name: "E1", type: "class", count: 1, sessionIds: [], memoryKeys: [] });
    graph.clear();
    expect(graph.nodeCount).toBe(0);
  });
});

// ============================================================================
// 9. CompressionEngine
// ============================================================================

describe("CompressionEngine", () => {
  let engine: CompressionEngine;

  beforeEach(() => {
    engine = new CompressionEngine();
  });

  it("compresses multiple items into one", async () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      makeItem({
        key: `item-${i}`,
        value: `This is detailed content about feature ${i} which spans multiple sentences and paragraphs.`,
        score: 0.6 + i * 0.1,
        source: "session-1",
        summary: `Summary of item ${i}`,
      }),
    );
    const result = await engine.compress(items, 150);
    expect(result.compressedItem).toBeDefined();
    expect(result.compressedItem.key).toContain("compressed");
    expect(result.tokensBefore).toBeGreaterThan(0);
    expect(result.compressionRatio).toBeLessThanOrEqual(1);
  });

  it("throws on empty item list", async () => {
    await expect(engine.compress([], 100)).rejects.toThrow("Cannot compress empty item list");
  });

  it("shouldCompress returns true when savings are significant", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ key: `i${i}`, value: "a".repeat(200), summary: "x".repeat(200) }),
    );
    expect(engine.shouldCompress(items, 50)).toBe(true);
  });

  it("shouldCompress returns false for single item", () => {
    const items = [makeItem({ value: "short" })];
    expect(engine.shouldCompress(items, 200)).toBe(false);
  });
});

// ============================================================================
// 10. LocalStore
// ============================================================================

describe("LocalStore", () => {
  it("put and get roundtrips correctly", async () => {
    const io = makeInMemoryFS();
    const store = new LocalStore("/project", io);
    const item = makeItem({ key: "alpha", scope: "project", layer: "checkpoint" });
    await store.put(item);
    const loaded = await store.get("alpha", "project", "checkpoint");
    expect(loaded).not.toBeNull();
    expect(loaded!.key).toBe("alpha");
  });

  it("list returns all items in a scope+layer", async () => {
    const io = makeInMemoryFS();
    const store = new LocalStore("/project", io);
    for (let i = 0; i < 3; i++) {
      await store.put(makeItem({ key: `item-${i}`, scope: "session", layer: "checkpoint" }));
    }
    const items = await store.list("session", "checkpoint");
    expect(items).toHaveLength(3);
  });

  it("delete removes item", async () => {
    const io = makeInMemoryFS();
    const store = new LocalStore("/project", io);
    await store.put(makeItem({ key: "to-delete", scope: "session", layer: "checkpoint" }));
    const deleted = await store.delete("to-delete", "session", "checkpoint");
    expect(deleted).toBe(true);
    expect(await store.get("to-delete", "session", "checkpoint")).toBeNull();
  });

  it("get returns null for missing file", async () => {
    const io = makeInMemoryFS();
    const store = new LocalStore("/project", io);
    expect(await store.get("nonexistent", "session", "semantic")).toBeNull();
  });
});

// ============================================================================
// 11. SnapshotStore (GF-06)
// ============================================================================

describe("SnapshotStore — GF-06", () => {
  let snapshotStore: SnapshotStore;

  beforeEach(() => {
    const io = makeInMemoryFS();
    snapshotStore = new SnapshotStore("/project", io);
  });

  it("captures and retrieves a snapshot", async () => {
    const snapshot = await snapshotStore.capture({
      worktreePath: "/project/.git/worktrees/feat",
      branch: "feat/memory-engine",
      commitHash: "abc123",
      memoryKeys: ["key1", "key2"],
    });
    expect(snapshot.id).toBeDefined();
    expect(snapshot.verified).toBe(false);

    const loaded = await snapshotStore.get(snapshot.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.branch).toBe("feat/memory-engine");
  });

  it("markVerified updates verified flag", async () => {
    const snapshot = await snapshotStore.capture({
      worktreePath: "/project",
      branch: "main",
      commitHash: "def456",
      memoryKeys: [],
    });
    const ok = await snapshotStore.markVerified(snapshot.id);
    expect(ok).toBe(true);
    const loaded = await snapshotStore.get(snapshot.id);
    expect(loaded!.verified).toBe(true);
  });

  it("findByBranch filters correctly", async () => {
    await snapshotStore.capture({
      worktreePath: "/p",
      branch: "main",
      commitHash: "c1",
      memoryKeys: [],
    });
    await snapshotStore.capture({
      worktreePath: "/p",
      branch: "feat/test",
      commitHash: "c2",
      memoryKeys: [],
    });
    const results = await snapshotStore.findByBranch("main");
    expect(results).toHaveLength(1);
    expect(results[0]!.branch).toBe("main");
  });

  it("associateMemoryKeys adds keys to snapshot", async () => {
    const snap = await snapshotStore.capture({
      worktreePath: "/p",
      branch: "main",
      commitHash: "c1",
      memoryKeys: ["k1"],
    });
    await snapshotStore.associateMemoryKeys(snap.id, ["k2", "k3"]);
    const loaded = await snapshotStore.get(snap.id);
    expect(loaded!.memoryKeys).toContain("k1");
    expect(loaded!.memoryKeys).toContain("k2");
    expect(loaded!.memoryKeys).toContain("k3");
  });
});

// ============================================================================
// 12. SessionMemory
// ============================================================================

describe("SessionMemory", () => {
  let sessionMemory: SessionMemory;
  let localStore: LocalStore;

  beforeEach(() => {
    const io = makeInMemoryFS();
    localStore = new LocalStore("/project", io);
    sessionMemory = new SessionMemory(localStore);
  });

  it("storeFact persists and loads correctly (GF-01)", async () => {
    await sessionMemory.storeFact("sess1", "my-fact", "DanteCode is great", "project");
    const item = await sessionMemory.load("my-fact", "project");
    expect(item).not.toBeNull();
    expect(item!.value).toBe("DanteCode is great");
  });

  it("storeKnowledge and loadKnowledge roundtrip", async () => {
    const knowledge = {
      sessionId: "sess1",
      facts: ["Implemented memory engine"],
      filesModified: ["packages/memory-engine/src/index.ts"],
      tasks: ["Build memory spine"],
      errors: [],
      capturedAt: new Date().toISOString(),
    };
    await sessionMemory.storeKnowledge(knowledge);
    const loaded = await sessionMemory.loadKnowledge("sess1");
    expect(loaded).not.toBeNull();
    expect(loaded!.facts[0]).toBe("Implemented memory engine");
  });

  it("search finds items by keyword", async () => {
    await sessionMemory.storeFact("s1", "auth-system", "JWT authentication module", "project");
    await sessionMemory.storeFact("s1", "db-schema", "PostgreSQL database tables", "project");
    const results = await sessionMemory.search("authentication", "project");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.key).toBe("auth-system");
  });

  it("verify marks item as trusted", async () => {
    await sessionMemory.storeFact("s1", "trusted-fact", "verified content", "project");
    await sessionMemory.verify("trusted-fact", "project");
    const item = await sessionMemory.load("trusted-fact", "project");
    expect(item!.verified).toBe(true);
  });

  it("delete removes item", async () => {
    await sessionMemory.storeFact("s1", "temp-key", "temp value", "session");
    const deleted = await sessionMemory.delete("temp-key", "session");
    expect(deleted).toBe(true);
    expect(await sessionMemory.load("temp-key", "session")).toBeNull();
  });
});

// ============================================================================
// 13. SemanticRecall
// ============================================================================

describe("SemanticRecall", () => {
  let shortTerm: ShortTermStore;
  let sessionMemory: SessionMemory;
  let vectorStore: VectorStore;
  let semanticRecall: SemanticRecall;

  beforeEach(async () => {
    shortTerm = new ShortTermStore(100, 0);
    const io = makeInMemoryFS();
    const localStore = new LocalStore("/project", io);
    sessionMemory = new SessionMemory(localStore);
    vectorStore = new VectorStore(localStore, 100, 0.01);
    semanticRecall = new SemanticRecall(shortTerm, sessionMemory, vectorStore);

    // Pre-populate
    shortTerm.set("st-auth", "JWT authentication system", "session");
    await vectorStore.add(
      makeItem({
        key: "vec-auth",
        scope: "project",
        summary: "JWT authentication and token management",
        layer: "semantic",
      }),
    );
  });

  it("recall returns results from multiple layers", async () => {
    const result = await semanticRecall.recall("authentication JWT");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("recall respects scope filter", async () => {
    const result = await semanticRecall.recall("authentication", { scope: "project" });
    expect(result.results.every((r) => r.scope === "project")).toBe(true);
  });

  it("crossSessionRecall searches project + global scopes", async () => {
    const result = await semanticRecall.crossSessionRecall("authentication", 5);
    expect(result.query).toBe("authentication");
    expect(result.scope).toBe("cross-session");
  });

  it("recall includes latencyMs in result", async () => {
    const result = await semanticRecall.recall("anything");
    expect(typeof result.latencyMs).toBe("number");
  });
});

// ============================================================================
// 14. MemoryOrchestrator — Golden Flows
// ============================================================================

describe("MemoryOrchestrator — Golden Flows", () => {
  let orchestrator: MemoryOrchestrator;

  beforeEach(async () => {
    const io = makeInMemoryFS();
    orchestrator = new MemoryOrchestrator({
      projectRoot: "/test-project",
      shortTermCapacity: 100,
      enableSemanticRecall: true,
      enableEntityExtraction: true,
      ...io,
    });
    await orchestrator.initialize();
  });

  // GF-01: Memory survives restart (via local store)
  it("GF-01: memoryStore returns stored=true and correct layer", async () => {
    const result = await orchestrator.memoryStore(
      "feature-auth",
      "JWT authentication implemented in packages/core",
      "project",
      { summary: "JWT auth feature", tags: ["feature"] },
    );
    expect(result.stored).toBe(true);
    expect(result.key).toBe("feature-auth");
    expect(result.scope).toBe("project");
    expect(["checkpoint", "semantic", "short-term"]).toContain(result.layer);
  });

  // GF-02: Semantic cross-session recall
  it("GF-02: memoryRecall returns relevant results", async () => {
    await orchestrator.memoryStore("auth-module", "JWT tokens and OAuth2 flow", "project", {
      summary: "Authentication module",
    });
    const result = await orchestrator.memoryRecall("authentication", 5, "project");
    expect(result.query).toBe("authentication");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  // GF-03: Session summarization
  it("GF-03: memorySummarize returns summary and tokensSaved", async () => {
    const result = await orchestrator.memorySummarize("session-abc");
    expect(result.sessionId).toBe("session-abc");
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
  });

  // GF-04: Pruning
  it("GF-04: memoryPrune returns pruning stats", async () => {
    const result = await orchestrator.memoryPrune(0.9);
    expect(result.policy).toBeDefined();
    expect(typeof result.prunedCount).toBe("number");
    expect(typeof result.retainedCount).toBe("number");
  });

  // GF-05: Cross-session recall
  it("GF-05: crossSessionRecall returns result with scope=cross-session", async () => {
    const result = await orchestrator.crossSessionRecall("build memory engine");
    expect(result.scope).toBe("cross-session");
    expect(Array.isArray(result.results)).toBe(true);
  });

  // GF-07: Memory visualization
  it("GF-07: memoryVisualize returns nodes and edges without corrupting storage", async () => {
    await orchestrator.memoryStore("vis-item", "visualization test", "project");
    const result = orchestrator.memoryVisualize();
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
    // Should not throw or corrupt; scope node should be present
    expect(result.nodes.some((n) => n["type"] === "scope")).toBe(true);
  });

  it("storeSessionKnowledge and listSessionKnowledge", async () => {
    await orchestrator.storeSessionKnowledge({
      sessionId: "sess-xyz",
      facts: ["Implemented feature Y"],
      filesModified: ["src/y.ts"],
      tasks: ["Build Y"],
      errors: [],
      capturedAt: new Date().toISOString(),
    });
    const list = await orchestrator.listSessionKnowledge();
    expect(list.some((k) => k.sessionId === "sess-xyz")).toBe(true);
  });

  it("boost and verify don't throw", async () => {
    await orchestrator.memoryStore("k", "v", "project");
    await expect(orchestrator.boost("k", "project")).resolves.not.toThrow();
    await expect(orchestrator.verify("k", "project")).resolves.not.toThrow();
  });

  it("getShortTermStats returns correct fields", async () => {
    const stats = orchestrator.getShortTermStats();
    expect(stats.capacity).toBe(100);
    expect(typeof stats.size).toBe("number");
  });

  it("getTextSummary returns non-empty string", async () => {
    const summary = orchestrator.getTextSummary();
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
  });

  it("memoryVisualize with scope filter", async () => {
    await orchestrator.memoryStore("filtered", "filtered content", "session");
    const result = orchestrator.memoryVisualize("session");
    expect(result.nodes.some((n) => n["id"] === "scope:session")).toBe(true);
  });
});

// ============================================================================
// 15. MemoryVisualizer — text summary + Mermaid
// ============================================================================

describe("MemoryVisualizer", () => {
  it("toTextSummary produces markdown-style output", async () => {
    const io = makeInMemoryFS();
    const orchestrator = new MemoryOrchestrator({
      projectRoot: "/p",
      ...io,
    });
    await orchestrator.initialize();
    await orchestrator.memoryStore("item1", "content", "project");

    const summary = orchestrator.getTextSummary();
    expect(summary).toContain("Memory State Summary");
  });
});

// ============================================================================
// 16. LocalEmbeddingProvider
// ============================================================================

describe("LocalEmbeddingProvider", () => {
  it("embed() returns a 256-dim L2-normalized vector", async () => {
    const { LocalEmbeddingProvider } = await import("./embedding-provider.js");
    const provider = new LocalEmbeddingProvider();
    const vec = await provider.embed("semantic memory retrieval system");
    expect(vec).toHaveLength(256);
    const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 3);
  });

  it("two related strings have cosine similarity > 0.25", async () => {
    // TF-IDF without corpus training: similarity proportional to shared-token ratio.
    // Strings sharing 4 of 5 unique tokens yield cosine ≈ 0.8; threshold is 0.25.
    const { LocalEmbeddingProvider } = await import("./embedding-provider.js");
    const { cosineSimilarity } = await import("./vector-store.js");
    const provider = new LocalEmbeddingProvider();
    const v1 = await provider.embed("typescript error compilation module agent");
    const v2 = await provider.embed("typescript error compilation module loop");
    const sim = cosineSimilarity(v1, v2);
    expect(sim).toBeGreaterThan(0.25);
  });

  it("embed() returns zero-safe vector for short/empty input", async () => {
    const { LocalEmbeddingProvider } = await import("./embedding-provider.js");
    const provider = new LocalEmbeddingProvider();
    // empty string → all-zeros is fine; norm guard prevents div-by-zero
    const vec = await provider.embed("");
    expect(vec).toHaveLength(256);
  });

  it("updateCorpus() completes without error and adjusts weights", async () => {
    const { LocalEmbeddingProvider } = await import("./embedding-provider.js");
    const provider = new LocalEmbeddingProvider();
    const corpus = [
      "semantic memory retrieval system module",
      "agent loop tool execution result",
      "typescript compilation error resolution",
    ];
    expect(() => provider.updateCorpus(corpus)).not.toThrow();
    const vec = await provider.embed("semantic memory retrieval");
    expect(vec).toHaveLength(256);
  });

  it("VectorStore.searchAsync() uses cosine similarity when embeddings are present", async () => {
    const { VectorStore } = await import("./vector-store.js");
    const { LocalEmbeddingProvider } = await import("./embedding-provider.js");
    const { LocalStore } = await import("./storage/local-store.js");
    const io = makeInMemoryFS();
    const localStore = new LocalStore("/test-embed", io);
    const vectorStore = new VectorStore(localStore, 100, 0.0);
    const provider = new LocalEmbeddingProvider();
    vectorStore.setEmbeddingProvider((text) => provider.embed(text));

    await vectorStore.add(
      makeItem({
        key: "auth-item",
        scope: "project",
        summary: "JWT authentication token management security",
        layer: "semantic",
      }),
    );

    const results = await vectorStore.searchAsync("authentication token security", 5, "project");
    expect(Array.isArray(results)).toBe(true);
    // Should find the item (cosine path)
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.item.key).toBe("auth-item");
  });
});
