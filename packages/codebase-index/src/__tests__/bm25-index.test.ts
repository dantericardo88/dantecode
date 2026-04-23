// ============================================================================
// packages/codebase-index/src/__tests__/bm25-index.test.ts
// 6 tests for BM25Index
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { BM25Index } from "../bm25-index.js";
import { rrfFusion } from "../rrf-fusion.js";
import type { IndexChunk, RankedChunk } from "../types.js";

function makeChunk(filePath: string, content: string, symbols: string[] = [], startLine = 1): IndexChunk {
  return { filePath, content, startLine, endLine: startLine + content.split("\n").length - 1, symbols };
}

describe("BM25Index", () => {
  let idx: BM25Index;

  beforeEach(() => {
    idx = new BM25Index();
  });

  it("add() + search() returns a matching chunk", () => {
    const chunk = makeChunk("src/auth.ts", "export class UserAuthMiddleware { ... }", ["UserAuthMiddleware"]);
    idx.add(chunk);

    const results = idx.search("UserAuthMiddleware", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.chunk.filePath).toBe("src/auth.ts");
  });

  it("exact symbol name ranks #1 among multiple documents", () => {
    idx.add(makeChunk("src/auth.ts", "export class UserAuthMiddleware extends Base { ... }", ["UserAuthMiddleware"]));
    idx.add(makeChunk("src/util.ts", "// A comment mentioning UserAuthMiddleware briefly", []));
    idx.add(makeChunk("src/other.ts", "export function unrelated() { return 42; }", ["unrelated"]));

    const results = idx.search("UserAuthMiddleware", 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.chunk.filePath).toBe("src/auth.ts");
  });

  it("removeFile() removes all chunks for that file", () => {
    idx.add(makeChunk("src/auth.ts", "class AuthHandler { login() {} }", ["AuthHandler"], 1));
    idx.add(makeChunk("src/auth.ts", "class AuthRefresh { refresh() {} }", ["AuthRefresh"], 10));
    idx.add(makeChunk("src/other.ts", "class Other { run() {} }", ["Other"], 1));

    idx.removeFile("src/auth.ts");

    const results = idx.search("Auth", 10);
    const authResults = results.filter((r) => r.chunk.filePath === "src/auth.ts");
    expect(authResults).toHaveLength(0);
  });

  it("empty query returns []", () => {
    idx.add(makeChunk("src/a.ts", "const x = 1;", []));
    expect(idx.search("", 5)).toHaveLength(0);
    expect(idx.search("   ", 5)).toHaveLength(0);
  });

  it("clear() empties the index", () => {
    idx.add(makeChunk("src/a.ts", "const x = 1;", []));
    idx.add(makeChunk("src/b.ts", "const y = 2;", []));
    expect(idx.size).toBe(2);

    idx.clear();
    expect(idx.size).toBe(0);
    expect(idx.search("const", 5)).toHaveLength(0);
  });

  it("RRF fusion of BM25 + TF-IDF-style lists produces non-empty merged result", () => {
    idx.add(makeChunk("src/auth.ts", "export class AuthService { login(user) { return token; } }", ["AuthService", "login"]));
    idx.add(makeChunk("src/user.ts", "export class UserService { getUser(id) { return user; } }", ["UserService", "getUser"]));

    const bm25Results = idx.search("AuthService login", 10);

    // Simulate a TF-IDF ranked list (independent source)
    const tfidfResults: RankedChunk[] = [
      { key: "src/auth.ts:1", chunk: makeChunk("src/auth.ts", "export class AuthService { ... }", ["AuthService"]) },
      { key: "src/user.ts:1", chunk: makeChunk("src/user.ts", "export class UserService { ... }", ["UserService"]) },
    ];

    const fused = rrfFusion([tfidfResults, bm25Results]);
    expect(fused.length).toBeGreaterThanOrEqual(1);
    // auth.ts should rank highly since it appears in both lists
    const authRank = fused.findIndex((r) => r.chunk.filePath === "src/auth.ts");
    expect(authRank).toBeGreaterThanOrEqual(0);
    expect(authRank).toBeLessThan(3);
  });
});
