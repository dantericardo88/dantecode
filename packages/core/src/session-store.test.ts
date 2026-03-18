// ============================================================================
// @dantecode/core — Session Store Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionStore } from "./session-store.js";
import type { ChatSessionFile } from "@dantecode/config-types";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
}));

import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockReaddir = vi.mocked(readdir);
const mockMkdir = vi.mocked(mkdir);
const mockUnlink = vi.mocked(unlink);

describe("SessionStore", () => {
  let store: SessionStore;
  const projectRoot = "/test/project";

  const sampleSession: ChatSessionFile = {
    id: "session-123",
    title: "Test Session",
    createdAt: "2026-03-16T10:00:00Z",
    updatedAt: "2026-03-16T11:00:00Z",
    model: "grok/grok-3",
    messages: [
      { role: "user", content: "Hello", timestamp: "2026-03-16T10:00:00Z" },
      { role: "assistant", content: "Hi!", timestamp: "2026-03-16T10:00:01Z" },
    ],
    contextFiles: ["src/main.ts"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store = new SessionStore(projectRoot);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  describe("save", () => {
    it("creates sessions directory and writes JSON", async () => {
      await store.save(sampleSession);
      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining("sessions"), {
        recursive: true,
      });
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("session-123.json"),
        expect.any(String),
        "utf-8",
      );
      const written = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
      expect(written.id).toBe("session-123");
    });
  });

  describe("load", () => {
    it("loads and parses a session file", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(sampleSession));
      const loaded = await store.load("session-123");
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe("session-123");
      expect(loaded!.messages).toHaveLength(2);
    });

    it("returns null for non-existent session", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const loaded = await store.load("missing");
      expect(loaded).toBeNull();
    });
  });

  describe("list", () => {
    it("lists sessions sorted by updatedAt descending", async () => {
      const session1: ChatSessionFile = {
        ...sampleSession,
        id: "old",
        title: "Old Session",
        updatedAt: "2026-03-15T10:00:00Z",
      };
      const session2: ChatSessionFile = {
        ...sampleSession,
        id: "new",
        title: "New Session",
        updatedAt: "2026-03-17T10:00:00Z",
      };

      mockReaddir.mockResolvedValue(["old.json", "new.json"] as unknown as Awaited<
        ReturnType<typeof readdir>
      >);
      mockReadFile.mockImplementation((path) => {
        const p = path as string;
        if (p.includes("old.json")) return Promise.resolve(JSON.stringify(session1));
        if (p.includes("new.json")) return Promise.resolve(JSON.stringify(session2));
        return Promise.reject(new Error("ENOENT"));
      });

      const list = await store.list();
      expect(list).toHaveLength(2);
      expect(list[0]!.id).toBe("new");
      expect(list[1]!.id).toBe("old");
    });

    it("returns empty for non-existent directory", async () => {
      mockReaddir.mockRejectedValue(new Error("ENOENT"));
      const list = await store.list();
      expect(list).toEqual([]);
    });

    it("skips corrupt files", async () => {
      mockReaddir.mockResolvedValue(["good.json", "bad.json"] as unknown as Awaited<
        ReturnType<typeof readdir>
      >);
      mockReadFile.mockImplementation((path) => {
        const p = path as string;
        if (p.includes("good.json")) return Promise.resolve(JSON.stringify(sampleSession));
        return Promise.resolve("not json{{{");
      });

      const list = await store.list();
      expect(list).toHaveLength(1);
    });

    it("only reads .json files", async () => {
      mockReaddir.mockResolvedValue(["session.json", "readme.md", ".gitkeep"] as unknown as Awaited<
        ReturnType<typeof readdir>
      >);
      mockReadFile.mockResolvedValue(JSON.stringify(sampleSession));
      const list = await store.list();
      expect(list).toHaveLength(1);
    });
  });

  describe("delete", () => {
    it("deletes the session file", async () => {
      mockUnlink.mockResolvedValue(undefined);
      const result = await store.delete("session-123");
      expect(result).toBe(true);
      expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining("session-123.json"));
    });

    it("returns false for non-existent session", async () => {
      mockUnlink.mockRejectedValue(new Error("ENOENT"));
      const result = await store.delete("missing");
      expect(result).toBe(false);
    });
  });

  describe("exists", () => {
    it("returns true for existing session", async () => {
      mockReadFile.mockResolvedValue("{}");
      expect(await store.exists("session-123")).toBe(true);
    });

    it("returns false for non-existent session", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      expect(await store.exists("missing")).toBe(false);
    });
  });

  describe("getSessionsDir", () => {
    it("returns the correct path", () => {
      expect(store.getSessionsDir()).toContain(".dantecode");
      expect(store.getSessionsDir()).toContain("sessions");
    });
  });

  describe("deleteAll", () => {
    it("deletes all session JSON files", async () => {
      mockReaddir.mockResolvedValue(["a.json", "b.json", "c.json"] as unknown as Awaited<
        ReturnType<typeof readdir>
      >);
      mockUnlink.mockResolvedValue(undefined);

      const count = await store.deleteAll();
      expect(count).toBe(3);
      expect(mockUnlink).toHaveBeenCalledTimes(3);
    });

    it("returns 0 for empty directory", async () => {
      mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
      const count = await store.deleteAll();
      expect(count).toBe(0);
    });

    it("returns 0 when directory does not exist", async () => {
      mockReaddir.mockRejectedValue(new Error("ENOENT"));
      const count = await store.deleteAll();
      expect(count).toBe(0);
    });

    it("skips non-json files", async () => {
      mockReaddir.mockResolvedValue(["a.json", "readme.md"] as unknown as Awaited<
        ReturnType<typeof readdir>
      >);
      mockUnlink.mockResolvedValue(undefined);

      const count = await store.deleteAll();
      expect(count).toBe(1);
    });
  });

  describe("summarize", () => {
    it("generates a summary from session content", async () => {
      const session: ChatSessionFile = {
        ...sampleSession,
        messages: [
          {
            role: "user",
            content: "Fix the login bug in auth.ts",
            timestamp: "2026-03-16T10:00:00Z",
          },
          {
            role: "assistant",
            content: "I fixed the login bug.",
            timestamp: "2026-03-16T10:01:00Z",
          },
        ],
        contextFiles: ["src/auth.ts"],
      };

      mockReadFile.mockResolvedValue(JSON.stringify(session));

      const summary = await store.summarize(session);
      expect(summary).toContain("Fix the login bug");
      expect(summary).toContain("src/auth.ts");
      expect(summary).toContain("successfully");
    });

    it("persists the summary to the session file", async () => {
      const session: ChatSessionFile = {
        ...sampleSession,
        messages: [
          { role: "user", content: "Hello", timestamp: "2026-03-16T10:00:00Z" },
          { role: "assistant", content: "Hi there!", timestamp: "2026-03-16T10:00:01Z" },
        ],
      };

      await store.summarize(session);

      // Should have called save (which calls writeFile)
      expect(mockWriteFile).toHaveBeenCalled();
      const writtenData = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
      expect(writtenData.summary).toBeDefined();
      expect(typeof writtenData.summary).toBe("string");
    });

    it("detects errors in session", async () => {
      const session: ChatSessionFile = {
        ...sampleSession,
        messages: [
          { role: "user", content: "Deploy the app", timestamp: "2026-03-16T10:00:00Z" },
          {
            role: "assistant",
            content: "Error: build failed with exit code 1",
            timestamp: "2026-03-16T10:01:00Z",
          },
        ],
      };

      const summary = await store.summarize(session);
      expect(summary).toContain("error");
    });

    it("handles session with no user messages", async () => {
      const session: ChatSessionFile = {
        ...sampleSession,
        messages: [
          { role: "assistant", content: "Ready to help!", timestamp: "2026-03-16T10:00:00Z" },
        ],
      };

      const summary = await store.summarize(session);
      expect(summary).toContain("Unknown task");
    });

    it("truncates long user messages", async () => {
      const longMessage = "A".repeat(200);
      const session: ChatSessionFile = {
        ...sampleSession,
        messages: [
          { role: "user", content: longMessage, timestamp: "2026-03-16T10:00:00Z" },
          { role: "assistant", content: "Done!", timestamp: "2026-03-16T10:00:01Z" },
        ],
      };

      const summary = await store.summarize(session);
      expect(summary).toContain("...");
      // The task portion should be truncated at 120 chars
      expect(summary.indexOf("...")).toBeLessThan(200);
    });
  });

  describe("getRecentSummaries", () => {
    it("returns summaries for recent sessions", async () => {
      const session1: ChatSessionFile = {
        ...sampleSession,
        id: "s1",
        updatedAt: "2026-03-17T10:00:00Z",
        summary: "Existing summary for s1.",
      };
      const session2: ChatSessionFile = {
        ...sampleSession,
        id: "s2",
        updatedAt: "2026-03-16T10:00:00Z",
        summary: "Existing summary for s2.",
      };

      mockReaddir.mockResolvedValue(["s1.json", "s2.json"] as unknown as Awaited<
        ReturnType<typeof readdir>
      >);
      mockReadFile.mockImplementation((path) => {
        const p = path as string;
        if (p.includes("s1.json")) return Promise.resolve(JSON.stringify(session1));
        if (p.includes("s2.json")) return Promise.resolve(JSON.stringify(session2));
        return Promise.reject(new Error("ENOENT"));
      });

      const summaries = await store.getRecentSummaries(2);
      expect(summaries).toHaveLength(2);
      expect(summaries[0]!.id).toBe("s1");
      expect(summaries[0]!.summary).toBe("Existing summary for s1.");
      expect(summaries[1]!.id).toBe("s2");
    });

    it("generates summary for sessions without cached summary", async () => {
      const session: ChatSessionFile = {
        ...sampleSession,
        id: "no-summary",
        updatedAt: "2026-03-17T10:00:00Z",
        // No summary field
      };

      mockReaddir.mockResolvedValue(["no-summary.json"] as unknown as Awaited<
        ReturnType<typeof readdir>
      >);
      mockReadFile.mockResolvedValue(JSON.stringify(session));

      const summaries = await store.getRecentSummaries(1);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]!.summary).toBeDefined();
      expect(summaries[0]!.summary.length).toBeGreaterThan(0);
    });

    it("respects the limit parameter", async () => {
      const sessions = Array.from({ length: 5 }, (_, i) => ({
        ...sampleSession,
        id: `s${i}`,
        updatedAt: `2026-03-${15 + i}T10:00:00Z`,
        summary: `Summary ${i}`,
      }));

      mockReaddir.mockResolvedValue(
        sessions.map((s) => `${s.id}.json`) as unknown as Awaited<ReturnType<typeof readdir>>,
      );
      mockReadFile.mockImplementation((path) => {
        const p = path as string;
        const match = sessions.find((s) => p.includes(`${s.id}.json`));
        if (match) return Promise.resolve(JSON.stringify(match));
        return Promise.reject(new Error("ENOENT"));
      });

      const summaries = await store.getRecentSummaries(2);
      expect(summaries).toHaveLength(2);
    });
  });

  describe("list includes summary", () => {
    it("includes summary field when present in session", async () => {
      const sessionWithSummary: ChatSessionFile = {
        ...sampleSession,
        summary: "This is a cached summary.",
      };

      mockReaddir.mockResolvedValue(["session-123.json"] as unknown as Awaited<
        ReturnType<typeof readdir>
      >);
      mockReadFile.mockResolvedValue(JSON.stringify(sessionWithSummary));

      const list = await store.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.summary).toBe("This is a cached summary.");
    });

    it("summary is undefined when not present", async () => {
      mockReaddir.mockResolvedValue(["session-123.json"] as unknown as Awaited<
        ReturnType<typeof readdir>
      >);
      mockReadFile.mockResolvedValue(JSON.stringify(sampleSession));

      const list = await store.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.summary).toBeUndefined();
    });
  });
});
