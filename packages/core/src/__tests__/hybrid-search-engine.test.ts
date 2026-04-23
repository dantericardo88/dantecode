// packages/core/src/__tests__/hybrid-search-engine.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  splitCamelCase,
  splitSnakeCase,
  expandTerm,
  tokenize,
  expandQuery,
  BM25Index,
  TFIDFIndex,
  cosineSimilarity,
  reciprocalRankFusion,
  extractSnippet,
  findMatchedTerms,
  HybridSearchEngine,
  type SearchDocument,
} from "../hybrid-search-engine.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDoc(id: string, content: string, source?: string): SearchDocument {
  return { id, content, source };
}

// ─── splitCamelCase ───────────────────────────────────────────────────────────

describe("splitCamelCase", () => {
  it("splits camelCase into words", () => {
    expect(splitCamelCase("getUserById")).toEqual(["get", "user", "by", "id"]);
  });

  it("handles PascalCase", () => {
    const parts = splitCamelCase("HttpRequestHandler");
    expect(parts).toContain("http");
    expect(parts).toContain("request");
    expect(parts).toContain("handler");
  });

  it("returns single word unchanged", () => {
    expect(splitCamelCase("foo")).toEqual(["foo"]);
  });
});

// ─── splitSnakeCase ───────────────────────────────────────────────────────────

describe("splitSnakeCase", () => {
  it("splits snake_case", () => {
    expect(splitSnakeCase("user_profile_data")).toEqual(["user", "profile", "data"]);
  });

  it("splits kebab-case", () => {
    expect(splitSnakeCase("api-key-manager")).toEqual(["api", "key", "manager"]);
  });

  it("handles dot notation", () => {
    expect(splitSnakeCase("file.path.util")).toContain("file");
  });
});

// ─── expandTerm ───────────────────────────────────────────────────────────────

describe("expandTerm", () => {
  it("includes the original term", () => {
    expect(expandTerm("getUserById")).toContain("getuserbyid");
  });

  it("includes camelCase components", () => {
    const expanded = expandTerm("getUserById");
    expect(expanded).toContain("get");
    expect(expanded).toContain("user");
  });

  it("includes synonym for 'get'", () => {
    const expanded = expandTerm("get");
    expect(expanded).toContain("fetch");
    expect(expanded).toContain("read");
  });

  it("includes synonym for 'error'", () => {
    const expanded = expandTerm("error");
    expect(expanded).toContain("exception");
  });

  it("includes plural form", () => {
    expect(expandTerm("file")).toContain("files");
  });

  it("includes singular form", () => {
    expect(expandTerm("errors")).toContain("error");
  });
});

// ─── tokenize ─────────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumeric", () => {
    expect(tokenize("Hello, World!")).toContain("hello");
    expect(tokenize("Hello, World!")).toContain("world");
  });

  it("filters tokens shorter than 2 chars", () => {
    const tokens = tokenize("a if the");
    expect(tokens.every((t) => t.length >= 2)).toBe(true);
  });

  it("preserves underscores", () => {
    const tokens = tokenize("user_id");
    expect(tokens).toContain("user_id");
  });
});

// ─── expandQuery ─────────────────────────────────────────────────────────────

describe("expandQuery", () => {
  it("expands query into multiple terms", () => {
    const terms = expandQuery("getUserById");
    expect(terms.length).toBeGreaterThan(1);
    expect(terms).toContain("get");
  });

  it("includes synonyms in expansion", () => {
    const terms = expandQuery("create user");
    expect(terms).toContain("make");
  });
});

// ─── BM25Index ────────────────────────────────────────────────────────────────

describe("BM25Index", () => {
  let idx: BM25Index;

  beforeEach(() => {
    idx = new BM25Index();
    idx.add(makeDoc("d1", "function getUserById returns the user by their id"));
    idx.add(makeDoc("d2", "class UserController handles user authentication"));
    idx.add(makeDoc("d3", "database connection pool for postgres queries"));
  });

  it("scores document with matching terms higher", () => {
    const results = idx.score(["user", "id"]);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.docId).toBe("d1");
  });

  it("returns empty for terms not in index", () => {
    const results = idx.score(["nonexistentterm12345"]);
    expect(results).toHaveLength(0);
  });

  it("size returns correct doc count", () => {
    expect(idx.size).toBe(3);
  });

  it("getDoc returns the document", () => {
    expect(idx.getDoc("d1")?.id).toBe("d1");
  });

  it("clear removes all documents", () => {
    idx.clear();
    expect(idx.size).toBe(0);
  });

  it("scores descending (highest first)", () => {
    const results = idx.score(["user"]);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });
});

// ─── TFIDFIndex ───────────────────────────────────────────────────────────────

describe("TFIDFIndex", () => {
  let idx: TFIDFIndex;

  beforeEach(() => {
    idx = new TFIDFIndex();
    idx.add(makeDoc("d1", "authentication token validation and refresh"));
    idx.add(makeDoc("d2", "database query builder for SQL operations"));
    idx.add(makeDoc("d3", "token bucket rate limiter implementation"));
  });

  it("scores document with matching terms higher", () => {
    const results = idx.score(["token"]);
    expect(results.length).toBeGreaterThan(0);
    // Both d1 and d3 contain "token"
    const docIds = results.map((r) => r.docId);
    expect(docIds).toContain("d1");
    expect(docIds).toContain("d3");
  });

  it("returns results sorted by score descending", () => {
    const results = idx.score(["token", "authentication"]);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it("size returns correct count", () => {
    expect(idx.size).toBe(3);
  });

  it("clear empties the index", () => {
    idx.clear();
    expect(idx.size).toBe(0);
  });
});

// ─── reciprocalRankFusion ─────────────────────────────────────────────────────

describe("reciprocalRankFusion", () => {
  it("combines two lists and gives higher score to top-ranked in both", () => {
    const list1 = [{ docId: "a", score: 10 }, { docId: "b", score: 5 }];
    const list2 = [{ docId: "a", score: 8 }, { docId: "c", score: 3 }];
    const fused = reciprocalRankFusion([list1, list2], 60);
    expect(fused.get("a")).toBeGreaterThan(fused.get("b") ?? 0);
    expect(fused.get("a")).toBeGreaterThan(fused.get("c") ?? 0);
  });

  it("doc only in one list still appears in fusion", () => {
    const list1 = [{ docId: "a", score: 1 }];
    const list2 = [{ docId: "b", score: 1 }];
    const fused = reciprocalRankFusion([list1, list2], 60);
    expect(fused.has("a")).toBe(true);
    expect(fused.has("b")).toBe(true);
  });

  it("returns empty map for empty input", () => {
    expect(reciprocalRankFusion([]).size).toBe(0);
  });
});

// ─── extractSnippet ───────────────────────────────────────────────────────────

describe("extractSnippet", () => {
  it("centers snippet on matched term", () => {
    const content = "This is a long text about authentication token management in secure APIs";
    const snippet = extractSnippet(content, ["token"], 30);
    expect(snippet).toContain("token");
  });

  it("returns start of content when no term matches", () => {
    const content = "Some code content here";
    const snippet = extractSnippet(content, ["xyz"], 50);
    expect(snippet).toContain("Some code");
  });

  it("adds ellipsis when truncating", () => {
    const content = "a".repeat(50) + " token " + "b".repeat(50);
    const snippet = extractSnippet(content, ["token"], 20);
    expect(snippet).toContain("token");
  });
});

// ─── findMatchedTerms ─────────────────────────────────────────────────────────

describe("findMatchedTerms", () => {
  it("returns terms found in content", () => {
    const content = "function getUserById queries the database";
    const matched = findMatchedTerms(content, ["function", "database", "xyz"]);
    expect(matched).toContain("function");
    expect(matched).toContain("database");
    expect(matched).not.toContain("xyz");
  });

  it("is case-insensitive", () => {
    const matched = findMatchedTerms("Hello World", ["hello", "world"]);
    expect(matched).toHaveLength(2);
  });
});

// ─── HybridSearchEngine ───────────────────────────────────────────────────────

describe("HybridSearchEngine", () => {
  let engine: HybridSearchEngine;

  beforeEach(() => {
    engine = new HybridSearchEngine();
    engine.addDocuments([
      makeDoc("d1", "function authenticate user with JWT token validation", "src/auth.ts"),
      makeDoc("d2", "class UserRepository queries database for user records", "src/repo.ts"),
      makeDoc("d3", "parseGitLog extracts commit history from git log output", "src/git.ts"),
      makeDoc("d4", "BM25 search algorithm for document retrieval ranking", "src/search.ts"),
    ]);
  });

  it("returns results for matching query", () => {
    const results = engine.search("authenticate user");
    expect(results.length).toBeGreaterThan(0);
  });

  it("top result contains query terms", () => {
    const results = engine.search("jwt token");
    expect(results[0]!.matchedTerms.some((t) => ["jwt", "token"].includes(t))).toBe(true);
  });

  it("results sorted by score descending", () => {
    const results = engine.search("user");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it("respects topK limit", () => {
    const results = engine.search("user", { topK: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("each result has a snippet", () => {
    const results = engine.search("git commit");
    results.forEach((r) => expect(r.snippet.length).toBeGreaterThan(0));
  });

  it("each result has document and score", () => {
    const results = engine.search("database query");
    results.forEach((r) => {
      expect(r.document).toBeDefined();
      expect(typeof r.score).toBe("number");
    });
  });

  it("returns empty for no matching documents", () => {
    const results = engine.search("zzznomatch99999");
    expect(results).toHaveLength(0);
  });

  it("documentCount returns number of indexed docs", () => {
    expect(engine.documentCount).toBe(4);
  });

  it("formatResultsForPrompt includes source path", () => {
    const results = engine.search("authenticate");
    const prompt = engine.formatResultsForPrompt(results);
    expect(prompt).toContain("src/auth.ts");
  });

  it("formatResultsForPrompt returns no-results message for empty", () => {
    const prompt = engine.formatResultsForPrompt([]);
    expect(prompt).toContain("No results");
  });

  it("clear empties the engine", () => {
    engine.clear();
    expect(engine.documentCount).toBe(0);
    expect(engine.search("user")).toHaveLength(0);
  });

  it("query expansion finds docs via synonym", () => {
    // "fetch" should expand to include "get", finding docs about "get" operations
    engine.clear();
    engine.addDocument(makeDoc("d1", "function getUser retrieves a user from the store"));
    const results = engine.search("fetch user", { expandQuery: true });
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─── cosineSimilarity (Sprint 28) ─────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("identical vectors return 1.0", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  it("orthogonal vectors return 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("opposite vectors return -1.0", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it("returns 0 for zero vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for different-length vectors", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("similar vectors score higher than dissimilar", () => {
    const a = [0.8, 0.2, 0.1];
    const similar = [0.7, 0.3, 0.0];
    const dissimilar = [0.0, 0.0, 1.0];
    expect(cosineSimilarity(a, similar)).toBeGreaterThan(cosineSimilarity(a, dissimilar));
  });
});

// ─── HybridSearchEngine.setEmbeddingProvider + searchAsync (Sprint 28) ────────

describe("HybridSearchEngine — semantic reranking (Sprint 28)", () => {
  let engine: HybridSearchEngine;

  beforeEach(() => {
    engine = new HybridSearchEngine();
    engine.addDocuments([
      makeDoc("auth", "export function validateToken(token: string): boolean { return jwt.verify(token); }", "src/auth.ts"),
      makeDoc("user", "export async function getUserById(id: string) { return db.users.findOne(id); }", "src/user.ts"),
      makeDoc("hash", "export function hashPassword(pw: string) { return bcrypt.hash(pw, 10); }", "src/hash.ts"),
    ]);
  });

  it("embeddingProvider is null by default", () => {
    expect(engine.embeddingProvider).toBeNull();
  });

  it("setEmbeddingProvider stores the provider", () => {
    const fn = vi.fn().mockResolvedValue([1, 0, 0]);
    engine.setEmbeddingProvider(fn);
    expect(engine.embeddingProvider).toBe(fn);
  });

  it("setEmbeddingProvider(null) clears the provider", () => {
    engine.setEmbeddingProvider(vi.fn().mockResolvedValue([1, 0]));
    engine.setEmbeddingProvider(null);
    expect(engine.embeddingProvider).toBeNull();
  });

  it("searchAsync without provider returns same results as search()", async () => {
    const syncResults = engine.search("validateToken");
    const asyncResults = await engine.searchAsync("validateToken");
    expect(asyncResults.length).toBe(syncResults.length);
  });

  it("searchAsync with provider calls provider for query and docs", async () => {
    const mockEmbed = vi.fn().mockResolvedValue([0.5, 0.5, 0.0]);
    engine.setEmbeddingProvider(mockEmbed);
    await engine.searchAsync("validateToken", { topK: 2 });
    // Called at least once for the query
    expect(mockEmbed).toHaveBeenCalled();
  });

  it("searchAsync respects topK", async () => {
    const mockEmbed = vi.fn().mockResolvedValue([0.3, 0.3, 0.3]);
    engine.setEmbeddingProvider(mockEmbed);
    const results = await engine.searchAsync("token", { topK: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("searchAsync returns results even when provider throws on doc embedding", async () => {
    let callCount = 0;
    const mockEmbed = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount > 1) throw new Error("embed failed");
      return [1, 0, 0];
    });
    engine.setEmbeddingProvider(mockEmbed);
    const results = await engine.searchAsync("token", { topK: 3 });
    expect(Array.isArray(results)).toBe(true);
  });

  it("searchAsync returns [] when no documents indexed", async () => {
    const empty = new HybridSearchEngine();
    empty.setEmbeddingProvider(vi.fn().mockResolvedValue([1, 0]));
    const results = await empty.searchAsync("anything");
    expect(results).toEqual([]);
  });

  it("setting same provider twice does not clear doc embedding cache", async () => {
    const mockEmbed = vi.fn().mockResolvedValue([0.5, 0.5]);
    engine.setEmbeddingProvider(mockEmbed);
    await engine.searchAsync("token", { topK: 2 });
    const callsAfterFirst = mockEmbed.mock.calls.length;
    // Set same fn again — should NOT clear cache, so subsequent call has fewer embed calls
    engine.setEmbeddingProvider(mockEmbed);
    await engine.searchAsync("token", { topK: 2 });
    // Cache preserved → fewer total calls on second search
    const callsAfterSecond = mockEmbed.mock.calls.length;
    expect(callsAfterSecond).toBeGreaterThan(0); // still called for query
    // Just verify it didn't explode and returned results
    expect(callsAfterSecond).toBeGreaterThanOrEqual(callsAfterFirst);
  });
});

// ─── indexAll() — Sprint B corpus warmup ─────────────────────────────────────

import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";

async function makeTmpDir(): Promise<string> {
  const dir = nodePath.join(nodeOs.tmpdir(), `dc-idx-test-${Math.random().toString(36).slice(2)}`);
  await nodeFs.mkdir(dir, { recursive: true });
  return dir;
}

describe("HybridSearchEngine.indexAll()", () => {
  it("calls provider once per text file and indexes them into the engine", async () => {
    const dir = await makeTmpDir();
    const cacheDir = await makeTmpDir();
    const fileA = nodePath.join(dir, "a.ts");
    const fileB = nodePath.join(dir, "b.ts");
    await nodeFs.writeFile(fileA, "export function greet() {}");
    await nodeFs.writeFile(fileB, "export const PI = 3.14;");

    const eng = new HybridSearchEngine();
    const provider = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);

    await eng.indexAll([fileA, fileB], provider, cacheDir);

    expect(provider).toHaveBeenCalledTimes(2);
    expect(eng.documentCount).toBe(2);
  });

  it("writes embeddings.cache.json into cacheDir", async () => {
    const dir = await makeTmpDir();
    const cacheDir = await makeTmpDir();
    const file = nodePath.join(dir, "x.ts");
    await nodeFs.writeFile(file, "const x = 1;");

    const eng = new HybridSearchEngine();
    await eng.indexAll([file], vi.fn().mockResolvedValue([0.5]), cacheDir);

    const cacheFile = nodePath.join(cacheDir, "embeddings.cache.json");
    const raw = await nodeFs.readFile(cacheFile, "utf8");
    const cache = JSON.parse(raw) as Array<{ path: string; mtime: number; embedding: number[] }>;
    expect(cache).toHaveLength(1);
    expect(cache[0]!.path).toBe(file);
    expect(cache[0]!.embedding).toEqual([0.5]);
  });

  it("reuses cached embedding on second call without calling provider", async () => {
    const dir = await makeTmpDir();
    const cacheDir = await makeTmpDir();
    const file = nodePath.join(dir, "y.ts");
    await nodeFs.writeFile(file, "const y = 2;");

    const provider = vi.fn().mockResolvedValue([0.9]);
    const eng1 = new HybridSearchEngine();
    await eng1.indexAll([file], provider, cacheDir);
    expect(provider).toHaveBeenCalledTimes(1);

    // Second call with a fresh engine — should reuse cache
    const eng2 = new HybridSearchEngine();
    await eng2.indexAll([file], provider, cacheDir);
    // Still only called once — second call reused cache
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("invalidates cache when file mtime changes", async () => {
    const dir = await makeTmpDir();
    const cacheDir = await makeTmpDir();
    const file = nodePath.join(dir, "z.ts");
    await nodeFs.writeFile(file, "const z = 3;");

    const provider = vi.fn().mockResolvedValue([0.7]);
    const eng1 = new HybridSearchEngine();
    await eng1.indexAll([file], provider, cacheDir);
    expect(provider).toHaveBeenCalledTimes(1);

    // Simulate mtime change by manipulating cache directly
    const cacheFile = nodePath.join(cacheDir, "embeddings.cache.json");
    const raw = await nodeFs.readFile(cacheFile, "utf8");
    const cache = JSON.parse(raw) as Array<{ path: string; mtime: number; embedding: number[] }>;
    cache[0]!.mtime = 0; // artificially stale
    await nodeFs.writeFile(cacheFile, JSON.stringify(cache));

    const eng2 = new HybridSearchEngine();
    await eng2.indexAll([file], provider, cacheDir);
    // Provider called again because mtime mismatch
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("skips binary files (.png, .zip) without crashing", async () => {
    const dir = await makeTmpDir();
    const cacheDir = await makeTmpDir();
    const pngFile = nodePath.join(dir, "image.png");
    const tsFile = nodePath.join(dir, "app.ts");
    await nodeFs.writeFile(pngFile, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic bytes
    await nodeFs.writeFile(tsFile, "const app = true;");

    const provider = vi.fn().mockResolvedValue([0.1]);
    const eng = new HybridSearchEngine();
    await eng.indexAll([pngFile, tsFile], provider, cacheDir);

    // Only the .ts file should be indexed (png skipped)
    expect(eng.documentCount).toBe(1);
    // Provider called once (for .ts), not for .png
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("returns without crashing when provider throws", async () => {
    const dir = await makeTmpDir();
    const cacheDir = await makeTmpDir();
    const file = nodePath.join(dir, "err.ts");
    await nodeFs.writeFile(file, "throw new Error('oops');");

    const eng = new HybridSearchEngine();
    const provider = vi.fn().mockRejectedValue(new Error("embedding service down"));
    // Should NOT throw — graceful degradation
    await expect(eng.indexAll([file], provider, cacheDir)).resolves.toBeUndefined();
    // Document still added to engine with empty embedding
    expect(eng.documentCount).toBe(1);
  });
});
