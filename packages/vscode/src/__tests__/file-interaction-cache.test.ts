// packages/vscode/src/__tests__/file-interaction-cache.test.ts
// Tests for Twinny-harvested file interaction relevance scoring

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { FileInteractionCache, globalInteractionCache } from "../file-interaction-cache.js";

describe("FileInteractionCache", () => {
  let cache: FileInteractionCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new FileInteractionCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records an interaction and returns it as a relevant document", () => {
    cache.recordInteraction("file:///a.ts", "/project/a.ts", 10);
    const docs = cache.getRelevantDocuments("file:///other.ts");
    expect(docs).toHaveLength(1);
    expect(docs[0]!.filePath).toContain("a.ts");
  });

  it("excludes the current file from results", () => {
    cache.recordInteraction("file:///a.ts", "/project/a.ts", 10);
    const docs = cache.getRelevantDocuments("file:///a.ts");
    expect(docs).toHaveLength(0);
  });

  it("sorts results by relevance score descending", () => {
    cache.recordInteraction("file:///low.ts", "/project/low.ts", 1);
    cache.recordInteraction("file:///high.ts", "/project/high.ts", 1);
    cache.recordInteraction("file:///high.ts", "/project/high.ts", 2);
    cache.recordInteraction("file:///high.ts", "/project/high.ts", 3);

    const docs = cache.getRelevantDocuments("file:///other.ts");
    expect(docs[0]!.filePath).toContain("high.ts");
  });

  it("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      cache.recordInteraction(`file:///f${i}.ts`, `/project/f${i}.ts`, i);
    }
    const docs = cache.getRelevantDocuments("file:///other.ts", 2);
    expect(docs).toHaveLength(2);
  });

  it("tracks active lines per file", () => {
    cache.recordInteraction("file:///a.ts", "/project/a.ts", 5);
    cache.recordInteraction("file:///a.ts", "/project/a.ts", 20);
    const docs = cache.getRelevantDocuments("file:///other.ts");
    expect(docs[0]!.activeLines).toContain(5);
    expect(docs[0]!.activeLines).toContain(20);
  });

  it("does not duplicate active lines", () => {
    cache.recordInteraction("file:///a.ts", "/project/a.ts", 5);
    cache.recordInteraction("file:///a.ts", "/project/a.ts", 5);
    cache.recordInteraction("file:///a.ts", "/project/a.ts", 5);
    const docs = cache.getRelevantDocuments("file:///other.ts");
    const lineCount = docs[0]!.activeLines.filter((l) => l === 5).length;
    expect(lineCount).toBe(1);
  });

  it("excludes git and node_modules paths", () => {
    cache.recordInteraction("file:///.git/config", "/.git/config", 1);
    cache.recordInteraction("file:///node_modules/pkg/index.ts", "/node_modules/pkg/index.ts", 1);
    const docs = cache.getRelevantDocuments("file:///other.ts");
    expect(docs).toHaveLength(0);
  });

  it("remove() deletes a file from the cache", () => {
    cache.recordInteraction("file:///a.ts", "/project/a.ts", 1);
    cache.remove("file:///a.ts");
    expect(cache.getRelevantDocuments("file:///other.ts")).toHaveLength(0);
  });

  it("clear() removes all entries", () => {
    cache.recordInteraction("file:///a.ts", "/project/a.ts", 1);
    cache.recordInteraction("file:///b.ts", "/project/b.ts", 1);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("evicts lowest-scoring entry when maxFiles exceeded", () => {
    const small = new FileInteractionCache({ maxFiles: 3 });
    small.recordInteraction("file:///low.ts", "/project/low.ts", 1);
    small.recordInteraction("file:///mid.ts", "/project/mid.ts", 1);
    small.recordInteraction("file:///mid.ts", "/project/mid.ts", 2); // score = 2
    small.recordInteraction("file:///high.ts", "/project/high.ts", 1);
    small.recordInteraction("file:///high.ts", "/project/high.ts", 2);
    small.recordInteraction("file:///high.ts", "/project/high.ts", 3); // score = 3
    // Adding 4th file should evict "low" (score=1)
    small.recordInteraction("file:///new.ts", "/project/new.ts", 1);
    expect(small.size).toBe(3);
    const uris = small.getRelevantDocuments("file:///other.ts").map((d) => d.filePath);
    expect(uris.some((p) => p.includes("low.ts"))).toBe(false);
  });

  it("applies time decay to relevance scores", () => {
    cache.recordInteraction("file:///a.ts", "/project/a.ts", 1);
    // Advance time by 60 minutes to trigger decay
    vi.advanceTimersByTime(60 * 60 * 1000);
    cache.recordInteraction("file:///b.ts", "/project/b.ts", 1); // fresh score = 1
    const docs = cache.getRelevantDocuments("file:///other.ts");
    // b.ts (fresh) should score higher than a.ts (decayed)
    expect(docs[0]!.filePath).toContain("b.ts");
  });

  it("globalInteractionCache is a singleton FileInteractionCache instance", () => {
    expect(globalInteractionCache).toBeInstanceOf(FileInteractionCache);
  });
});

describe("BracketBalanceDetector", () => {
  it("is importable from completion-stop-sequences", async () => {
    const mod = await import("../completion-stop-sequences.js");
    expect(mod.BracketBalanceDetector).toBeDefined();
  });

  it("returns balanced=false before any brackets", async () => {
    const { BracketBalanceDetector } = await import("../completion-stop-sequences.js");
    const det = new BracketBalanceDetector();
    const result = det.check("const x = 1;");
    expect(result.balanced).toBe(false);
    expect(result.depth).toBe(0);
  });

  it("returns balanced=true after opening and closing a brace", async () => {
    const { BracketBalanceDetector } = await import("../completion-stop-sequences.js");
    const det = new BracketBalanceDetector();
    det.check("function foo() {");
    const result = det.check("  return 1;\n}");
    expect(result.balanced).toBe(true);
  });

  it("tracks depth correctly for nested brackets", async () => {
    const { BracketBalanceDetector } = await import("../completion-stop-sequences.js");
    const det = new BracketBalanceDetector();
    det.check("function foo() { if (x) {");
    expect(det.check("").depth).toBe(2);
    det.check("} }");
    expect(det.check("").balanced).toBe(true);
  });

  it("reset() clears state", async () => {
    const { BracketBalanceDetector } = await import("../completion-stop-sequences.js");
    const det = new BracketBalanceDetector();
    det.check("function foo() {}");
    det.reset();
    const result = det.check("no brackets here");
    expect(result.balanced).toBe(false);
    expect(result.depth).toBe(0);
  });

  it("handles parens and square brackets", async () => {
    const { BracketBalanceDetector } = await import("../completion-stop-sequences.js");
    const det = new BracketBalanceDetector();
    det.check("[1, 2, (");
    det.check("3 + 4)");
    det.check("]");
    expect(det.check("").balanced).toBe(true);
  });
});
