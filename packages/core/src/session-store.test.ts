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
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining("sessions"),
        { recursive: true },
      );
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

      mockReaddir.mockResolvedValue(["old.json", "new.json"] as unknown as Awaited<ReturnType<typeof readdir>>);
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
      mockReaddir.mockResolvedValue(["good.json", "bad.json"] as unknown as Awaited<ReturnType<typeof readdir>>);
      mockReadFile.mockImplementation((path) => {
        const p = path as string;
        if (p.includes("good.json")) return Promise.resolve(JSON.stringify(sampleSession));
        return Promise.resolve("not json{{{");
      });

      const list = await store.list();
      expect(list).toHaveLength(1);
    });

    it("only reads .json files", async () => {
      mockReaddir.mockResolvedValue(["session.json", "readme.md", ".gitkeep"] as unknown as Awaited<ReturnType<typeof readdir>>);
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
});
