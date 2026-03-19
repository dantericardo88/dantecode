import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PersistentMemory,
  type MemoryEntry,
  type PersistentMemoryOptions,
} from "./persistent-memory.js";

// Mock node:fs/promises at module level
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { readFile, writeFile, mkdir } from "node:fs/promises";

const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockWriteFile = writeFile as ReturnType<typeof vi.fn>;
const mockMkdir = mkdir as ReturnType<typeof vi.fn>;

/** Helper to create a PersistentMemory with injectable fs mocks. */
function createMemory(opts: Partial<PersistentMemoryOptions> = {}): PersistentMemory {
  return new PersistentMemory("/test/project", {
    fsFn: { readFile, writeFile, mkdir },
    ...opts,
  });
}

/** Build a fake MemoryEntry for test fixtures. */
function fakeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: overrides.id ?? "entry-1",
    content: overrides.content ?? "test content",
    category: overrides.category ?? "fact",
    sessionId: overrides.sessionId,
    timestamp: overrides.timestamp ?? "2026-03-18T10:00:00.000Z",
    relevanceScore: overrides.relevanceScore ?? 1.0,
    accessCount: overrides.accessCount ?? 1,
    lastAccessed: overrides.lastAccessed ?? "2026-03-18T10:00:00.000Z",
    tags: overrides.tags ?? [],
  };
}

describe("PersistentMemory", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: no existing file (fresh state)
    mockReadFile.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  // --------------------------------------------------------------------------
  // 1. Constructor defaults
  // --------------------------------------------------------------------------
  describe("constructor", () => {
    it("uses default storage dir and max entries", () => {
      const mem = createMemory();
      // Verify it can be loaded without errors (defaults work)
      expect(mem.size()).toBe(0);
    });

    it("accepts custom storageDir", async () => {
      const mem = createMemory({ storageDir: ".custom" });
      await mem.load();
      await mem.store("hello", "fact");

      // The writeFile call should reference the custom dir
      const writePath = mockWriteFile.mock.calls[0][0] as string;
      expect(writePath).toContain(".custom");
    });
  });

  // --------------------------------------------------------------------------
  // 2-4. store() basics
  // --------------------------------------------------------------------------
  describe("store()", () => {
    it("creates an entry with correct fields", async () => {
      const mem = createMemory();
      await mem.load();

      const entry = await mem.store("TypeScript strict mode is enabled", "decision", ["config"], "session-1");

      expect(entry.content).toBe("TypeScript strict mode is enabled");
      expect(entry.category).toBe("decision");
      expect(entry.tags).toEqual(["config"]);
      expect(entry.sessionId).toBe("session-1");
      expect(entry.relevanceScore).toBe(1.0);
      expect(entry.accessCount).toBe(1);
      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.lastAccessed).toBeDefined();
    });

    it("deduplicates similar content by updating existing entry", async () => {
      const mem = createMemory();
      await mem.load();

      const first = await mem.store("Fix the authentication bug in login module", "error");
      const second = await mem.store("Fix the authentication bug in login module", "error");

      // Should return the same entry with bumped access count
      expect(second.id).toBe(first.id);
      expect(second.accessCount).toBe(2);
      expect(mem.size()).toBe(1);
    });

    it("evicts oldest entries when at capacity", async () => {
      const mem = createMemory({ maxEntries: 3 });
      await mem.load();

      // Store 4 entries — first should be evicted
      await mem.store("alpha entry content here", "fact");
      await mem.store("beta entry content here also", "fact");
      await mem.store("gamma entry content here too", "fact");
      await mem.store("delta entry content completely new", "fact");

      expect(mem.size()).toBe(3);

      // The oldest ("alpha") should have been evicted
      const all = mem.getAll();
      const contents = all.map((e) => e.content);
      expect(contents).not.toContain("alpha entry content here");
      expect(contents).toContain("delta entry content completely new");
    });

    it("stores entries with no tags when tags omitted", async () => {
      const mem = createMemory();
      await mem.load();

      const entry = await mem.store("some fact", "fact");
      expect(entry.tags).toEqual([]);
    });

    it("stores entries with no sessionId when omitted", async () => {
      const mem = createMemory();
      await mem.load();

      const entry = await mem.store("some fact", "fact");
      expect(entry.sessionId).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // 5-8. search()
  // --------------------------------------------------------------------------
  describe("search()", () => {
    it("returns scored results matching the query", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("Fix authentication bug in login handler", "error");
      await mem.store("Deploy production environment setup", "strategy");

      const results = mem.search("authentication login bug");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.content).toContain("authentication");
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("filters by category", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("Use ESM imports throughout", "decision");
      await mem.store("ESM import failed with error", "error");

      const results = mem.search("ESM imports", { category: "decision" });

      expect(results.length).toBe(1);
      expect(results[0].entry.category).toBe("decision");
    });

    it("respects minRelevance threshold", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("Fix authentication bug in login handler", "error");
      await mem.store("Deploy production server to cloud infrastructure", "strategy");

      // Very high threshold should return fewer results
      const results = mem.search("authentication login", { minRelevance: 0.5 });
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0.5);
      }
    });

    it("respects limit", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("alpha testing strategy plan", "strategy");
      await mem.store("alpha testing error report", "error");
      await mem.store("alpha testing decision log", "decision");

      const results = mem.search("alpha testing", { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("returns empty for empty query", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("some content here", "fact");
      const results = mem.search("");
      expect(results).toEqual([]);
    });

    it("returns empty when store is empty", () => {
      const mem = createMemory();
      const results = mem.search("anything");
      expect(results).toEqual([]);
    });

    it("filters by sessionId", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("session alpha memory entry", "fact", [], "session-a");
      await mem.store("session beta memory entry", "fact", [], "session-b");

      const results = mem.search("session memory entry", { sessionId: "session-a" });
      expect(results.length).toBe(1);
      expect(results[0].entry.sessionId).toBe("session-a");
    });
  });

  // --------------------------------------------------------------------------
  // 9-11. distill()
  // --------------------------------------------------------------------------
  describe("distill()", () => {
    it("merges near-duplicate entries within a category", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("Fix authentication bug in login module handler", "error", ["auth"]);
      await mem.store("Fix authentication bug in login module system", "error", ["login"]);

      const before = mem.size();
      const result = await mem.distill();

      expect(mem.size()).toBeLessThan(before);
      expect(result.distilled).toBeGreaterThan(0);

      // Tags should be merged
      const remaining = mem.getAll();
      const errorEntry = remaining.find((e) => e.category === "error");
      expect(errorEntry).toBeDefined();
      expect(errorEntry!.tags).toContain("auth");
      expect(errorEntry!.tags).toContain("login");
    });

    it("evicts lowest-scored entries when over target count", async () => {
      const mem = createMemory();
      await mem.load();

      // Store 5 distinct entries
      await mem.store("first unique entry content alpha", "fact");
      await mem.store("second unique entry content beta", "decision");
      await mem.store("third unique entry content gamma", "error");
      await mem.store("fourth unique entry content delta", "strategy");
      await mem.store("fifth unique entry content epsilon", "context");

      const result = await mem.distill(3);

      expect(mem.size()).toBeLessThanOrEqual(3);
      expect(result.removed).toBeGreaterThan(0);
    });

    it("returns correct counts", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("unique standalone entry here", "fact");
      await mem.store("another unique different entry here", "decision");

      const result = await mem.distill();

      expect(result.kept).toBe(mem.size());
      expect(result.removed).toBeGreaterThanOrEqual(0);
      expect(result.distilled).toBeGreaterThanOrEqual(0);
      // Total accounting: original = kept + removed + distilled
    });

    it("does not merge entries across different categories", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("Fix authentication bug in login module handler", "error");
      await mem.store("Fix authentication bug in login module handler", "strategy");

      // These are duplicated content but first store() deduplicates, so force via load
      // They should be 1 entry due to dedup, but let's test with pre-loaded data
      const entries = [
        fakeEntry({ id: "e1", content: "Fix authentication bug in login module handler", category: "error" }),
        fakeEntry({ id: "e2", content: "Fix authentication bug in login module system", category: "strategy" }),
      ];
      mockReadFile.mockResolvedValueOnce(JSON.stringify(entries));
      const mem2 = createMemory();
      await mem2.load();

      const result = await mem2.distill();
      // Should NOT merge because categories differ
      expect(result.distilled).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 12-13. load()/save() persistence
  // --------------------------------------------------------------------------
  describe("load() and save()", () => {
    it("persistence roundtrip: save then load recovers entries", async () => {
      const entries = [
        fakeEntry({ id: "e1", content: "persisted fact", category: "fact" }),
        fakeEntry({ id: "e2", content: "persisted decision", category: "decision" }),
      ];

      mockReadFile.mockResolvedValueOnce(JSON.stringify(entries));

      const mem = createMemory();
      await mem.load();

      expect(mem.size()).toBe(2);
      const all = mem.getAll();
      expect(all[0].content).toBe("persisted fact");
      expect(all[1].content).toBe("persisted decision");
    });

    it("handles missing file gracefully on load", async () => {
      mockReadFile.mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      const mem = createMemory();
      await mem.load();

      expect(mem.size()).toBe(0);
      expect(mem.getAll()).toEqual([]);
    });

    it("only loads once (idempotent)", async () => {
      const mem = createMemory();
      await mem.load();
      await mem.load();

      // readFile should only be called once
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    it("save() calls mkdir and writeFile", async () => {
      const mem = createMemory();
      await mem.load();
      await mem.store("data to persist", "fact");

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();

      // Verify JSON content
      const writtenJson = mockWriteFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenJson);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].content).toBe("data to persist");
    });
  });

  // --------------------------------------------------------------------------
  // 14. getSessionEntries()
  // --------------------------------------------------------------------------
  describe("getSessionEntries()", () => {
    it("filters entries by sessionId", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("database migration strategy rollback plan", "fact", [], "session-a");
      await mem.store("entry for session beta", "fact", [], "session-b");
      await mem.store("webpack bundler configuration hot reload setup", "decision", [], "session-a");

      const sessionEntries = mem.getSessionEntries("session-a");
      expect(sessionEntries.length).toBe(2);
      expect(sessionEntries.every((e) => e.sessionId === "session-a")).toBe(true);
    });

    it("returns empty array when no entries match", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("some entry", "fact", [], "session-x");
      const results = mem.getSessionEntries("nonexistent-session");
      expect(results).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // 15. resumeSession()
  // --------------------------------------------------------------------------
  describe("resumeSession()", () => {
    it("returns formatted output combining session and global entries", async () => {
      const entries = [
        fakeEntry({
          id: "e1",
          content: "session-specific fact",
          category: "fact",
          sessionId: "sess-1",
          relevanceScore: 0.5,
        }),
        fakeEntry({
          id: "e2",
          content: "high-relevance global strategy",
          category: "strategy",
          relevanceScore: 1.0,
        }),
      ];

      mockReadFile.mockResolvedValueOnce(JSON.stringify(entries));
      const mem = createMemory();
      await mem.load();

      const output = mem.resumeSession("sess-1");

      expect(output).toContain("Session memory");
      expect(output).toContain("session-specific fact");
      expect(output).toContain("high-relevance global strategy");
      expect(output).toContain("[FACT]");
      expect(output).toContain("[STRATEGY]");
    });

    it("returns a no-entries message when session has no data", async () => {
      const mem = createMemory();
      await mem.load();

      const output = mem.resumeSession("empty-session");
      expect(output).toContain("No memory entries found");
    });
  });

  // --------------------------------------------------------------------------
  // 16. formatForPrompt()
  // --------------------------------------------------------------------------
  describe("formatForPrompt()", () => {
    it("formats top entries as bullet points", async () => {
      const entries = [
        fakeEntry({ id: "e1", content: "fact about TypeScript", category: "fact", relevanceScore: 0.9 }),
        fakeEntry({ id: "e2", content: "strategy for testing", category: "strategy", relevanceScore: 1.0 }),
      ];

      mockReadFile.mockResolvedValueOnce(JSON.stringify(entries));
      const mem = createMemory();
      await mem.load();

      const output = mem.formatForPrompt(5);

      // Highest relevance first
      expect(output).toContain("- [STRATEGY] strategy for testing");
      expect(output).toContain("- [FACT] fact about TypeScript");
      expect(output.indexOf("[STRATEGY]")).toBeLessThan(output.indexOf("[FACT]"));
    });

    it("returns empty string when no entries exist", () => {
      const mem = createMemory();
      const output = mem.formatForPrompt();
      expect(output).toBe("");
    });

    it("limits output to topK entries", async () => {
      const entries = Array.from({ length: 20 }, (_, i) =>
        fakeEntry({ id: `e${i}`, content: `entry number ${i}`, relevanceScore: i / 20 }),
      );

      mockReadFile.mockResolvedValueOnce(JSON.stringify(entries));
      const mem = createMemory();
      await mem.load();

      const output = mem.formatForPrompt(3);
      const lines = output.split("\n").filter((l) => l.startsWith("- "));
      expect(lines.length).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // 17. clear()
  // --------------------------------------------------------------------------
  describe("clear()", () => {
    it("empties all entries and persists", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("something to clear", "fact");
      expect(mem.size()).toBe(1);

      await mem.clear();
      expect(mem.size()).toBe(0);
      expect(mem.getAll()).toEqual([]);

      // Verify save was called with empty array
      const lastWriteCall = mockWriteFile.mock.calls[mockWriteFile.mock.calls.length - 1];
      const parsed = JSON.parse(lastWriteCall[1] as string);
      expect(parsed).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // 18. size()
  // --------------------------------------------------------------------------
  describe("size()", () => {
    it("returns the correct count", async () => {
      const mem = createMemory();
      expect(mem.size()).toBe(0);

      await mem.load();
      await mem.store("entry one content here", "fact");
      expect(mem.size()).toBe(1);

      await mem.store("entry two content here", "decision");
      expect(mem.size()).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // 19. Multiple categories
  // --------------------------------------------------------------------------
  describe("multiple categories", () => {
    it("stores entries across different categories correctly", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("a factual statement here", "fact");
      await mem.store("a decision was made here", "decision");
      await mem.store("an error occurred here", "error");
      await mem.store("a strategy was applied here", "strategy");
      await mem.store("context information here", "context");

      expect(mem.size()).toBe(5);

      const all = mem.getAll();
      const categories = new Set(all.map((e) => e.category));
      expect(categories.size).toBe(5);
      expect(categories.has("fact")).toBe(true);
      expect(categories.has("decision")).toBe(true);
      expect(categories.has("error")).toBe(true);
      expect(categories.has("strategy")).toBe(true);
      expect(categories.has("context")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 20. Tags
  // --------------------------------------------------------------------------
  describe("tags", () => {
    it("preserves tags on stored entries", async () => {
      const mem = createMemory();
      await mem.load();

      const entry = await mem.store("tagged entry", "fact", ["alpha", "beta", "gamma"]);
      expect(entry.tags).toEqual(["alpha", "beta", "gamma"]);

      const all = mem.getAll();
      expect(all[0].tags).toEqual(["alpha", "beta", "gamma"]);
    });
  });

  // --------------------------------------------------------------------------
  // 21-35. Edge cases
  // --------------------------------------------------------------------------
  describe("edge cases", () => {
    it("search on empty store returns empty array", () => {
      const mem = createMemory();
      const results = mem.search("anything at all");
      expect(results).toEqual([]);
    });

    it("distill on empty store returns zero counts", async () => {
      const mem = createMemory();
      await mem.load();

      const result = await mem.distill();
      expect(result.kept).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.distilled).toBe(0);
    });

    it("store and search single entry", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("the only entry about database migration", "fact");
      const results = mem.search("database migration");
      expect(results.length).toBe(1);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("identical content is fully deduplicated", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("exact same content repeated", "fact");
      await mem.store("exact same content repeated", "fact");
      await mem.store("exact same content repeated", "fact");

      expect(mem.size()).toBe(1);
      const entry = mem.getAll()[0];
      expect(entry.accessCount).toBe(3);
    });

    it("all entries from same session are returned by getSessionEntries", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("entry alpha in session", "fact", [], "shared-session");
      await mem.store("entry beta in session", "decision", [], "shared-session");
      await mem.store("entry gamma in session", "error", [], "shared-session");

      const entries = mem.getSessionEntries("shared-session");
      expect(entries.length).toBe(3);
    });

    it("search with no matching category returns empty", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("some fact entry content here", "fact");
      const results = mem.search("fact entry content", { category: "error" });
      expect(results).toEqual([]);
    });

    it("getAll returns a copy, not a reference", async () => {
      const mem = createMemory();
      await mem.load();

      await mem.store("entry to copy test", "fact");
      const copy = mem.getAll();
      copy.pop();

      // Original should be unaffected
      expect(mem.size()).toBe(1);
    });

    it("deduplication uses configurable threshold", async () => {
      // Very low threshold: almost everything is a "duplicate"
      const mem = createMemory({ deduplicationThreshold: 0.1 });
      await mem.load();

      await mem.store("login authentication handler module", "fact");
      // Shares some tokens, above 0.1 threshold
      await mem.store("login authentication service module", "fact");

      // With low threshold, second should be deduped
      expect(mem.size()).toBe(1);
    });

    it("handles corrupt JSON on load gracefully", async () => {
      mockReadFile.mockResolvedValueOnce("{ invalid json !!!");

      const mem = createMemory();
      await mem.load();

      expect(mem.size()).toBe(0);
    });

    it("handles non-array JSON on load gracefully", async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ not: "an array" }));

      const mem = createMemory();
      await mem.load();

      expect(mem.size()).toBe(0);
    });

    it("resumeSession respects topK limit", async () => {
      const entries = Array.from({ length: 30 }, (_, i) =>
        fakeEntry({
          id: `e${i}`,
          content: `entry content number ${i}`,
          sessionId: "sess-big",
          relevanceScore: i / 30,
        }),
      );

      mockReadFile.mockResolvedValueOnce(JSON.stringify(entries));
      const mem = createMemory();
      await mem.load();

      const output = mem.resumeSession("sess-big", 5);
      const lines = output.split("\n").filter((l) => l.startsWith("- "));
      expect(lines.length).toBeLessThanOrEqual(5);
    });

    it("distill merges tags from near-duplicate entries", async () => {
      const entries = [
        fakeEntry({
          id: "e1",
          content: "Fix authentication bug in login module handler",
          category: "error",
          tags: ["auth"],
          relevanceScore: 1.0,
        }),
        fakeEntry({
          id: "e2",
          content: "Fix authentication bug in login module system",
          category: "error",
          tags: ["login"],
          relevanceScore: 0.8,
        }),
      ];

      mockReadFile.mockResolvedValueOnce(JSON.stringify(entries));
      const mem = createMemory();
      await mem.load();

      await mem.distill();

      const all = mem.getAll();
      expect(all.length).toBe(1);
      expect(all[0].tags).toContain("auth");
      expect(all[0].tags).toContain("login");
    });

    it("distill keeps higher relevanceScore when merging", async () => {
      const entries = [
        fakeEntry({
          id: "e1",
          content: "Fix authentication bug in login module handler",
          category: "error",
          relevanceScore: 0.3,
        }),
        fakeEntry({
          id: "e2",
          content: "Fix authentication bug in login module system",
          category: "error",
          relevanceScore: 0.9,
        }),
      ];

      mockReadFile.mockResolvedValueOnce(JSON.stringify(entries));
      const mem = createMemory();
      await mem.load();

      await mem.distill();

      const all = mem.getAll();
      expect(all.length).toBe(1);
      expect(all[0].relevanceScore).toBe(0.9);
    });

    it("save handles write errors silently", async () => {
      mockWriteFile.mockRejectedValueOnce(new Error("EPERM"));

      const mem = createMemory();
      await mem.load();

      // Should not throw
      await expect(mem.store("entry despite write failure", "fact")).resolves.toBeDefined();
    });

    it("store with very long content works correctly", async () => {
      const mem = createMemory();
      await mem.load();

      const longContent = "word ".repeat(1000).trim();
      const entry = await mem.store(longContent, "context");

      expect(entry.content).toBe(longContent);
      expect(mem.size()).toBe(1);
    });
  });
});
