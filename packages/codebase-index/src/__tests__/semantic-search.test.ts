// packages/codebase-index/src/__tests__/semantic-search.test.ts
// 8 tests for TFIDFVectorStore — pure logic, no mocks

import { describe, it, expect, beforeEach } from "vitest";
import { TFIDFVectorStore } from "../tfidf-vector-store.js";
import type { IndexChunk } from "../types.js";

function makeChunk(
  filePath: string,
  content: string,
  symbols: string[] = [],
  startLine = 1,
): IndexChunk {
  return {
    filePath,
    content,
    startLine,
    endLine: startLine + content.split("\n").length - 1,
    symbols,
  };
}

describe("TFIDFVectorStore", () => {
  let store: TFIDFVectorStore;

  beforeEach(() => {
    store = new TFIDFVectorStore();
  });

  it("add + search returns matching chunk by cosine similarity", () => {
    store.add(makeChunk("src/auth.ts", "export class UserAuthService handles login sessions", ["UserAuthService"]));

    const results = store.search("UserAuthService", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.chunk.filePath).toBe("src/auth.ts");
  });

  it("more-relevant chunk (more matching terms) ranks above less-relevant", () => {
    store.add(makeChunk("src/auth.ts", "UserAuthService authentication login logout session token", ["UserAuthService"]));
    store.add(makeChunk("src/util.ts", "utility helpers formatting unrelated stuff", []));

    const results = store.search("UserAuthService authentication login", 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.chunk.filePath).toBe("src/auth.ts");
  });

  it("search returns [] for empty query string", () => {
    store.add(makeChunk("src/auth.ts", "some content here", []));
    expect(store.search("", 5)).toHaveLength(0);
    expect(store.search("   ", 5)).toHaveLength(0);
  });

  it("search returns [] when store is empty", () => {
    expect(store.search("anything", 5)).toHaveLength(0);
  });

  it("removeFile removes all chunks for that file from results", () => {
    store.add(makeChunk("src/auth.ts", "authentication login service class", ["AuthService"], 1));
    store.add(makeChunk("src/auth.ts", "authentication token refresh handler", ["TokenRefresh"], 20));
    store.add(makeChunk("src/util.ts", "utility helper unrelated function", [], 1));

    store.removeFile("src/auth.ts");

    const results = store.search("authentication login token", 10);
    const authResults = results.filter((r) => r.chunk.filePath === "src/auth.ts");
    expect(authResults).toHaveLength(0);
  });

  it("add is idempotent — re-adding same filePath+startLine replaces entry, size stays same", () => {
    const chunk = makeChunk("src/auth.ts", "original content authentication", [], 1);
    store.add(chunk);
    expect(store.size).toBe(1);

    // Re-add the same key (same filePath + startLine)
    store.add(makeChunk("src/auth.ts", "updated content different terms", [], 1));
    expect(store.size).toBe(1);

    // Should search with new content
    const results = store.search("updated different", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.chunk.content).toContain("updated");
  });

  it("clear empties store; subsequent search returns []", () => {
    store.add(makeChunk("src/a.ts", "important function authentication service", ["AuthService"]));
    store.add(makeChunk("src/b.ts", "another module database connection", []));
    expect(store.size).toBe(2);

    store.clear();
    expect(store.size).toBe(0);
    expect(store.search("authentication", 5)).toHaveLength(0);
  });

  it("chunk with exact query term match scores higher than chunk with no match", () => {
    store.add(makeChunk("src/match.ts", "executeTypeDefinitionProvider crawlTypes lsp integration", ["executeTypeDefinitionProvider"]));
    store.add(makeChunk("src/nomatch.ts", "database connection pool configuration settings", []));

    const results = store.search("executeTypeDefinitionProvider", 10);
    const matchIdx = results.findIndex((r) => r.chunk.filePath === "src/match.ts");
    const noMatchIdx = results.findIndex((r) => r.chunk.filePath === "src/nomatch.ts");

    expect(matchIdx).toBeGreaterThanOrEqual(0);
    // If both appear, the match must rank above the non-match
    if (noMatchIdx !== -1) {
      expect(matchIdx).toBeLessThan(noMatchIdx);
    }
  });
});
