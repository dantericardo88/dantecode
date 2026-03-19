import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlaybookMemory } from "./playbook-memory.js";
import type { PlaybookEntry } from "./playbook-memory.js";

// Mock fs operations
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { readFile, writeFile, mkdir } from "node:fs/promises";

const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockWriteFile = writeFile as ReturnType<typeof vi.fn>;
const mockMkdir = mkdir as ReturnType<typeof vi.fn>;

// Helper to build a complete PlaybookEntry
function makeEntry(overrides: Partial<PlaybookEntry> = {}): PlaybookEntry {
  return {
    id: overrides.id ?? "test-id",
    bullets: overrides.bullets ?? ["use AST parsing"],
    taskSignature: overrides.taskSignature ?? "fix authentication bug in login",
    outcome: overrides.outcome ?? "helpful",
    errorSignature: overrides.errorSignature,
    sessionId: overrides.sessionId ?? "session-1",
    timestamp: overrides.timestamp ?? "2026-03-18T12:00:00.000Z",
  };
}

describe("PlaybookMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Constructor (2 tests)
  // ---------------------------------------------------------------------------
  describe("constructor", () => {
    it("sets the correct file path under .dantecode", () => {
      const memory = new PlaybookMemory("/my/project");
      // Verify by triggering a load that reads from the right path
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      void memory.load();
      // On Windows, join normalizes slashes, so check the call arg ends correctly
      const calledPath = mockReadFile.mock.calls[0]![0] as string;
      expect(calledPath).toContain(".dantecode");
      expect(calledPath).toContain("playbook-memory.json");
    });

    it("uses the provided project root", () => {
      const memory = new PlaybookMemory("/other/root");
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      void memory.load();
      const calledPath = mockReadFile.mock.calls[0]![0] as string;
      expect(calledPath).toMatch(/other/);
      expect(calledPath).toMatch(/root/);
    });
  });

  // ---------------------------------------------------------------------------
  // load (3 tests)
  // ---------------------------------------------------------------------------
  describe("load", () => {
    it("loads entries from a JSON file on disk", async () => {
      const stored = [makeEntry({ id: "a1", bullets: ["try AST"] })];
      mockReadFile.mockResolvedValue(JSON.stringify(stored));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      expect(memory.size).toBe(1);
      expect(memory.getAll()[0]!.id).toBe("a1");
    });

    it("handles missing file gracefully (starts fresh)", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      expect(memory.size).toBe(0);
    });

    it("is idempotent — only reads from disk once", async () => {
      mockReadFile.mockResolvedValue("[]");

      const memory = new PlaybookMemory("/project");
      await memory.load();
      await memory.load();
      await memory.load();

      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // save (2 tests)
  // ---------------------------------------------------------------------------
  describe("save", () => {
    it("writes entries as JSON to disk", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const memory = new PlaybookMemory("/project");
      await memory.addEntry({
        bullets: ["use typed parser"],
        taskSignature: "parse config file",
        outcome: "helpful",
        sessionId: "s1",
      });

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const savedJson = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
      expect(savedJson).toHaveLength(1);
      expect(savedJson[0].bullets[0]).toBe("use typed parser");
    });

    it("creates the directory recursively before writing", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const memory = new PlaybookMemory("/project");
      await memory.addEntry({
        bullets: ["test"],
        taskSignature: "test task",
        outcome: "helpful",
        sessionId: "s1",
      });

      expect(mockMkdir).toHaveBeenCalledTimes(1);
      const mkdirCall = mockMkdir.mock.calls[0]!;
      expect(mkdirCall[1]).toEqual({ recursive: true });
    });
  });

  // ---------------------------------------------------------------------------
  // addEntry (4 tests)
  // ---------------------------------------------------------------------------
  describe("addEntry", () => {
    it("generates id and timestamp automatically", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const memory = new PlaybookMemory("/project");
      await memory.addEntry({
        bullets: ["use retry logic"],
        taskSignature: "handle flaky API",
        outcome: "helpful",
        sessionId: "s1",
      });

      const all = memory.getAll();
      expect(all).toHaveLength(1);
      // id should be a UUID
      expect(all[0]!.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      // timestamp should be an ISO string
      expect(all[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("auto-loads before adding if not yet loaded", async () => {
      const stored = [makeEntry({ id: "existing" })];
      mockReadFile.mockResolvedValue(JSON.stringify(stored));

      const memory = new PlaybookMemory("/project");
      await memory.addEntry({
        bullets: ["new bullet"],
        taskSignature: "new task",
        outcome: "harmful",
        sessionId: "s2",
      });

      // Should have both the loaded entry and the new one
      expect(memory.size).toBe(2);
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    it("auto-saves after adding an entry", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const memory = new PlaybookMemory("/project");
      await memory.addEntry({
        bullets: ["bullet"],
        taskSignature: "task",
        outcome: "helpful",
        sessionId: "s1",
      });

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
    });

    it("enforces LRU eviction at 500 records", async () => {
      const existing = Array.from({ length: 499 }, (_, i) =>
        makeEntry({
          id: `id-${i}`,
          bullets: [`bullet-${i}`],
          taskSignature: `task-${i}`,
          timestamp: `2026-03-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
        }),
      );
      mockReadFile.mockResolvedValue(JSON.stringify(existing));

      const memory = new PlaybookMemory("/project");
      // Add 2 more to push over 500
      await memory.addEntry({
        bullets: ["new-500"],
        taskSignature: "task-500",
        outcome: "helpful",
        sessionId: "s1",
      });
      await memory.addEntry({
        bullets: ["new-501"],
        taskSignature: "task-501",
        outcome: "helpful",
        sessionId: "s1",
      });

      expect(memory.size).toBe(500);
      const all = memory.getAll();
      // Oldest (id-0) should have been evicted
      expect(all[0]!.id).toBe("id-1");
      expect(all[all.length - 1]!.bullets[0]).toBe("new-501");
    });
  });

  // ---------------------------------------------------------------------------
  // query (4 tests)
  // ---------------------------------------------------------------------------
  describe("query", () => {
    it("finds entries similar to the task description", async () => {
      const entries = [
        makeEntry({
          id: "auth-1",
          taskSignature: "fix authentication bug in login page",
          bullets: ["check session tokens"],
        }),
        makeEntry({
          id: "deploy-1",
          taskSignature: "deploy application to production server",
          bullets: ["use blue-green deploy"],
        }),
        makeEntry({
          id: "auth-2",
          taskSignature: "fix login page authentication error handling",
          bullets: ["add error boundaries"],
        }),
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      const results = memory.query("fix the authentication bug on login");
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(
        results.some((r) => r.entry.id === "auth-1"),
      ).toBe(true);
      expect(
        results.some((r) => r.entry.id === "auth-2"),
      ).toBe(true);
    });

    it("filters out entries below 0.3 similarity threshold", async () => {
      const entries = [
        makeEntry({
          id: "unrelated",
          taskSignature: "deploy kubernetes cluster configuration",
          bullets: ["use helm charts"],
        }),
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      const results = memory.query("fix authentication bug in login form");
      expect(results).toHaveLength(0);
    });

    it("sorts results by similarity descending", async () => {
      const entries = [
        makeEntry({
          id: "low",
          taskSignature: "fix bug crash error",
          bullets: ["low match"],
        }),
        makeEntry({
          id: "high",
          taskSignature: "fix authentication bug in login page form",
          bullets: ["high match"],
        }),
        makeEntry({
          id: "mid",
          taskSignature: "fix authentication error handling",
          bullets: ["mid match"],
        }),
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      const results = memory.query(
        "fix authentication bug in login page form validation",
      );
      // Results should be ordered by decreasing similarity
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.similarity).toBeGreaterThanOrEqual(
          results[i]!.similarity,
        );
      }
    });

    it("respects the limit parameter", async () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        makeEntry({
          id: `entry-${i}`,
          taskSignature: `fix authentication bug variant ${i} in login page`,
          bullets: [`bullet ${i}`],
        }),
      );
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      const results = memory.query(
        "fix authentication bug in login page",
        3,
      );
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  // ---------------------------------------------------------------------------
  // formatForPrompt (3 tests)
  // ---------------------------------------------------------------------------
  describe("formatForPrompt", () => {
    it("formats helpful entries with [+] prefix", async () => {
      const entries = [
        makeEntry({
          taskSignature: "fix authentication bug in login page",
          outcome: "helpful",
          bullets: ["check session tokens", "validate JWT expiry"],
        }),
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      const output = memory.formatForPrompt(
        "fix the authentication bug on login page",
      );
      expect(output).toContain("## Playbook (from past sessions)");
      expect(output).toContain("[+] check session tokens");
      expect(output).toContain("[+] validate JWT expiry");
    });

    it("formats harmful entries with [-] AVOID: prefix", async () => {
      const entries = [
        makeEntry({
          taskSignature: "fix authentication bug in login page",
          outcome: "harmful",
          bullets: ["disable CORS checks", "skip token validation"],
        }),
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      const output = memory.formatForPrompt(
        "fix the authentication bug on login page",
      );
      expect(output).toContain("[-] AVOID: disable CORS checks");
      expect(output).toContain("[-] AVOID: skip token validation");
    });

    it("returns empty string when no entries match", async () => {
      const entries = [
        makeEntry({
          taskSignature: "deploy kubernetes cluster configuration",
          bullets: ["use helm charts"],
        }),
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(entries));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      const output = memory.formatForPrompt("fix authentication bug in login");
      expect(output).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // getAll & size (2 tests)
  // ---------------------------------------------------------------------------
  describe("getAll & size", () => {
    it("returns a copy of entries (not the internal array)", async () => {
      const stored = [makeEntry({ id: "orig" })];
      mockReadFile.mockResolvedValue(JSON.stringify(stored));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      const all = memory.getAll();
      all.push(makeEntry({ id: "injected" }));

      // Internal state should not be affected
      expect(memory.size).toBe(1);
      expect(memory.getAll()).toHaveLength(1);
    });

    it("reports the correct size", async () => {
      const stored = [
        makeEntry({ id: "a" }),
        makeEntry({ id: "b" }),
        makeEntry({ id: "c" }),
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(stored));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      expect(memory.size).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // clear (2 tests)
  // ---------------------------------------------------------------------------
  describe("clear", () => {
    it("empties all entries and saves to disk", async () => {
      const stored = [makeEntry(), makeEntry({ id: "b" })];
      mockReadFile.mockResolvedValue(JSON.stringify(stored));

      const memory = new PlaybookMemory("/project");
      await memory.load();
      expect(memory.size).toBe(2);

      await memory.clear();

      expect(memory.size).toBe(0);
      // Should have saved the empty state
      const lastSaveCall = mockWriteFile.mock.calls[mockWriteFile.mock.calls.length - 1]!;
      const savedJson = JSON.parse(lastSaveCall[1] as string);
      expect(savedJson).toEqual([]);
    });

    it("marks the instance as loaded so subsequent load() is a no-op", async () => {
      mockReadFile.mockResolvedValue("[]");

      const memory = new PlaybookMemory("/project");
      await memory.clear();

      // Even though we never explicitly loaded, clear sets loaded = true
      // A subsequent load should NOT read from disk again
      await memory.load();
      // readFile should not have been called at all (clear sets loaded = true
      // without reading, and load() is now a no-op)
      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // prune (3 tests)
  // ---------------------------------------------------------------------------
  describe("prune", () => {
    it("removes entries older than 30 days", async () => {
      const now = Date.now();
      const oldDate = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();
      const recentDate = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();

      const stored = [
        makeEntry({ id: "old-1", timestamp: oldDate }),
        makeEntry({ id: "old-2", timestamp: oldDate }),
        makeEntry({ id: "recent", timestamp: recentDate }),
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(stored));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      const removed = memory.prune();

      expect(removed).toBe(2);
      expect(memory.size).toBe(1);
      expect(memory.getAll()[0]!.id).toBe("recent");
    });

    it("keeps entries within the 30-day window", async () => {
      const now = Date.now();
      const recent1 = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
      const recent2 = new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString();
      const recent3 = new Date(now - 29 * 24 * 60 * 60 * 1000).toISOString();

      const stored = [
        makeEntry({ id: "r1", timestamp: recent1 }),
        makeEntry({ id: "r2", timestamp: recent2 }),
        makeEntry({ id: "r3", timestamp: recent3 }),
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(stored));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      const removed = memory.prune();

      expect(removed).toBe(0);
      expect(memory.size).toBe(3);
    });

    it("returns the count of removed entries", async () => {
      const now = Date.now();
      const oldDate = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();

      const stored = Array.from({ length: 7 }, (_, i) =>
        makeEntry({ id: `old-${i}`, timestamp: oldDate }),
      );
      mockReadFile.mockResolvedValue(JSON.stringify(stored));

      const memory = new PlaybookMemory("/project");
      await memory.load();

      const removed = memory.prune();

      expect(removed).toBe(7);
      expect(memory.size).toBe(0);
    });
  });
});
