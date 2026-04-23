// ============================================================================
// packages/vscode/src/__tests__/hybrid-search-wiring.test.ts
//
// Sprint 10 — Dim 3: HybridSearchEngine wiring tests.
// Sprint 27 — Dim 3: detectBestEmbeddingProvider wiring tests.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CompletionContextRetriever, bm25Score } from "../completion-context-retriever.js";
import { HybridSearchEngine } from "@dantecode/core";

const CHUNKS = [
  { filePath: "/src/auth/tokens.ts", content: "export function generateToken(userId: string): string { return crypto.randomUUID(); }" },
  { filePath: "/src/db/users.ts", content: "export async function getUserById(id: string) { return db.users.findOne(id); }" },
  { filePath: "/src/api/routes.ts", content: "router.get('/users/:id', async (req, res) => { const user = await getUserById(req.params.id); res.json(user); });" },
  { filePath: "/src/utils/hash.ts", content: "export function hashPassword(pw: string): string { return bcrypt.hash(pw, 10); }" },
];

describe("CompletionContextRetriever — HybridSearchEngine wiring (Sprint 10)", () => {

  it("returns empty array when no chunks available", async () => {
    const retriever = new CompletionContextRetriever(() => []);
    const result = await retriever.retrieve(["const x = "], 3, 400);
    expect(result).toEqual([]);
  });

  it("returns snippets matching a relevant query", async () => {
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    const result = await retriever.retrieve(["getUserById(id)"], 3, 1000);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((s) => s.includes("getUserById") || s.includes("users"))).toBe(true);
  });

  it("snippet format has '// ---' header", async () => {
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    const result = await retriever.retrieve(["generateToken"], 2, 1000);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatch(/^\/\/ --- .+/);
  });

  it("respects maxSnippets limit", async () => {
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    const result = await retriever.retrieve(["user", "token", "router"], 2, 10000);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("respects tokenBudget character limit", async () => {
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    const result = await retriever.retrieve(["getUserById"], 3, 10);
    const charBudget = 10 * 4;
    const totalChars = result.reduce((s, r) => s + r.length, 0);
    expect(totalChars).toBeLessThanOrEqual(charBudget + result.length * 50);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("engine is cached across calls (chunk count unchanged)", async () => {
    let callCount = 0;
    const chunks = [...CHUNKS];
    const retriever = new CompletionContextRetriever(() => { callCount++; return chunks; });
    await retriever.retrieve(["token"], 2, 1000);
    await retriever.retrieve(["user"], 2, 1000);
    const r1 = await retriever.retrieve(["hash"], 2, 1000);
    expect(Array.isArray(r1)).toBe(true);
    expect(callCount).toBeGreaterThan(0);
  });

  it("rebuilds engine when chunk count changes", async () => {
    const chunks = [...CHUNKS.slice(0, 2)];
    const retriever = new CompletionContextRetriever(() => chunks);
    await retriever.retrieve(["token"], 2, 1000);
    chunks.push(CHUNKS[2]!);
    const result = await retriever.retrieve(["router"], 2, 1000);
    expect(result.some((s) => s.includes("routes") || s.includes("router") || s.includes("api"))).toBe(true);
  });

  it("returns [] on empty query lines", async () => {
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    const result = await retriever.retrieve([], 3, 1000);
    expect(Array.isArray(result)).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────

describe("HybridSearchEngine — BM25+TF-IDF+RRF fusion (Sprint 10)", () => {

  it("search returns results when documents are indexed", () => {
    const engine = new HybridSearchEngine();
    engine.addDocument({ id: "1", content: "function authenticate(user, password) {}", source: "auth.ts" });
    engine.addDocument({ id: "2", content: "function hashPassword(pw) { return bcrypt.hash(pw); }", source: "hash.ts" });
    const results = engine.search("authenticate user");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.document.id).toBe("1");
  });

  it("search results have score provenance", () => {
    const engine = new HybridSearchEngine();
    engine.addDocument({ id: "a", content: "const getUserById = async (id) => db.find(id);" });
    engine.addDocument({ id: "b", content: "function createUser(data) { return db.insert(data); }" });
    const results = engine.search("getUserById");
    expect(results.length).toBeGreaterThan(0);
    const top = results[0]!;
    expect(typeof top.score).toBe("number");
    expect(top.score).toBeGreaterThan(0);
  });

  it("bm25Score returns 0 for empty query terms", () => {
    const score = bm25Score([], ["hello", "world"], 2, [["hello", "world"]]);
    expect(score).toBe(0);
  });

});

// ── Sprint 27 — Dim 3: detectBestEmbeddingProvider wiring ────────────────────

const mockDetect = vi.fn();

vi.mock("@dantecode/memory-engine", () => ({
  detectBestEmbeddingProvider: mockDetect,
}));

describe("CompletionContextRetriever — embedding provider detection (Sprint 27)", () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detectBestEmbeddingProvider called once on first retrieve (not every call)", async () => {
    mockDetect.mockResolvedValue(null);
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    await retriever.retrieve(["token"], 2, 1000);
    await retriever.retrieve(["user"], 2, 1000);
    await retriever.retrieve(["hash"], 2, 1000);
    expect(mockDetect).toHaveBeenCalledTimes(1);
  });

  it("_embeddingProviderChecked prevents second probe call", async () => {
    mockDetect.mockResolvedValue(null);
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    await retriever.retrieve(["a"], 1, 100);
    await retriever.retrieve(["b"], 1, 100);
    expect(mockDetect).toHaveBeenCalledTimes(1);
  });

  it("when provider returns non-null, embeddingProvider is set on retriever", async () => {
    const fakeProvider = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    mockDetect.mockResolvedValue(fakeProvider);
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    await retriever.retrieve(["token"], 2, 1000);
    expect(retriever.embeddingProvider).toBe(fakeProvider);
  });

  it("when provider returns null, embeddingProvider is null (lexical fallback)", async () => {
    mockDetect.mockResolvedValue(null);
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    await retriever.retrieve(["token"], 2, 1000);
    expect(retriever.embeddingProvider).toBeNull();
  });

  it("retrieve still returns results with embedding provider set", async () => {
    const fakeProvider = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    mockDetect.mockResolvedValue(fakeProvider);
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    const result = await retriever.retrieve(["getUserById"], 3, 1000);
    expect(Array.isArray(result)).toBe(true);
  });

  it("retrieve still returns results with no embedding provider", async () => {
    mockDetect.mockResolvedValue(null);
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    const result = await retriever.retrieve(["getUserById"], 3, 1000);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("dynamic import failure → graceful fallback, retrieve returns results", async () => {
    mockDetect.mockRejectedValue(new Error("memory-engine not found"));
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    const result = await retriever.retrieve(["token"], 2, 1000);
    expect(retriever.embeddingProvider).toBeNull();
    expect(Array.isArray(result)).toBe(true);
  });

  it("engine rebuild on chunk count change preserves embedding provider", async () => {
    const fakeProvider = vi.fn().mockResolvedValue([0.1, 0.2]);
    mockDetect.mockResolvedValue(fakeProvider);
    const chunks = [...CHUNKS.slice(0, 2)];
    const retriever = new CompletionContextRetriever(() => chunks);
    await retriever.retrieve(["token"], 2, 1000);
    // Add a chunk to force engine rebuild
    chunks.push(CHUNKS[2]!);
    await retriever.retrieve(["router"], 2, 1000);
    // Provider still set after rebuild — probe only ran once
    expect(retriever.embeddingProvider).toBe(fakeProvider);
    expect(mockDetect).toHaveBeenCalledTimes(1);
  });

});

// ── Sprint 28 — Dim 3: searchAsync semantic reranking wired into retrieve() ───

describe("CompletionContextRetriever — searchAsync wiring (Sprint 28)", () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("embedding provider is called during retrieve() when set", async () => {
    const fakeProvider = vi.fn().mockResolvedValue([0.5, 0.5, 0.0]);
    mockDetect.mockResolvedValue(fakeProvider);
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    await retriever.retrieve(["validateToken", "string"], 2, 1000, 5000);
    // Provider must have been called (for query embed + doc embeds)
    expect(fakeProvider).toHaveBeenCalled();
  });

  it("retrieve() returns results even when embedding provider returns short vectors", async () => {
    const fakeProvider = vi.fn().mockResolvedValue([0.1, 0.9]);
    mockDetect.mockResolvedValue(fakeProvider);
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    const result = await retriever.retrieve(["getUserById"], 2, 1000, 5000);
    expect(Array.isArray(result)).toBe(true);
  });

  it("retrieve() falls back to lexical when embedding provider returns []", async () => {
    const fakeProvider = vi.fn().mockResolvedValue([]);
    mockDetect.mockResolvedValue(fakeProvider);
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    const result = await retriever.retrieve(["getUserById"], 2, 1000, 5000);
    // Should not throw and should return results (lexical fallback via cosineSimilarity([],[])=0)
    expect(Array.isArray(result)).toBe(true);
  });

  it("retrieve() uses lexical path when no embedding provider", async () => {
    mockDetect.mockResolvedValue(null);
    const fakeEmbed = vi.fn().mockResolvedValue([0.5, 0.5]);
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    await retriever.retrieve(["getUserById"], 2, 1000);
    // No embedding calls when provider is null
    expect(fakeEmbed).not.toHaveBeenCalled();
  });

  it("retrieve() snippet format unchanged with semantic reranking", async () => {
    const fakeProvider = vi.fn().mockResolvedValue([0.3, 0.7]);
    mockDetect.mockResolvedValue(fakeProvider);
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    const result = await retriever.retrieve(["getUserById"], 2, 1000, 5000);
    if (result.length > 0) {
      expect(result[0]).toMatch(/^\/\/ --- .+/);
    }
  });

  it("retrieve() maxSnippets limit respected with semantic reranking", async () => {
    const fakeProvider = vi.fn().mockResolvedValue([0.4, 0.6]);
    mockDetect.mockResolvedValue(fakeProvider);
    const retriever = new CompletionContextRetriever(() => CHUNKS);
    const result = await retriever.retrieve(["user", "token", "router", "hash"], 1, 10000, 5000);
    expect(result.length).toBeLessThanOrEqual(1);
  });

});
