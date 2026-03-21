import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ApproachMemory,
  tokenize,
  jaccardSimilarity,
  formatApproachesForPrompt,
} from "./approach-memory.js";

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

describe("tokenize", () => {
  it("splits text into lowercase tokens", () => {
    const tokens = tokenize("Fix the authentication BUG in login");
    expect(tokens.has("fix")).toBe(true);
    expect(tokens.has("authentication")).toBe(true);
    expect(tokens.has("bug")).toBe(true);
    expect(tokens.has("login")).toBe(true);
  });

  it("filters out short tokens (<=2 chars)", () => {
    const tokens = tokenize("a is the way to go");
    expect(tokens.has("a")).toBe(false);
    expect(tokens.has("is")).toBe(false);
    expect(tokens.has("the")).toBe(true);
    expect(tokens.has("way")).toBe(true);
  });

  it("strips punctuation", () => {
    const tokens = tokenize("fix: bug! (crash) in [module]");
    expect(tokens.has("fix")).toBe(true);
    expect(tokens.has("bug")).toBe(true);
    expect(tokens.has("crash")).toBe(true);
    expect(tokens.has("module")).toBe(true);
  });

  it("returns empty set for empty string", () => {
    expect(tokenize("").size).toBe(0);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    const a = new Set(["fix", "bug", "login"]);
    expect(jaccardSimilarity(a, a)).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    const a = new Set(["fix", "bug"]);
    const b = new Set(["deploy", "production"]);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("returns correct value for partial overlap", () => {
    const a = new Set(["fix", "bug", "login"]);
    const b = new Set(["fix", "bug", "signup"]);
    // intersection=2, union=4, similarity=0.5
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });

  it("handles empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
    expect(jaccardSimilarity(new Set(["a"]), new Set())).toBe(0);
  });
});

describe("formatApproachesForPrompt", () => {
  it("formats success/failure/partial records", () => {
    const output = formatApproachesForPrompt([
      {
        description: "regex parser",
        outcome: "failed",
        errorSignature: "EPARSE",
        toolCalls: 5,
        timestamp: "",
      },
      { description: "AST parser", outcome: "success", toolCalls: 3, timestamp: "" },
      { description: "manual parse", outcome: "partial", toolCalls: 7, timestamp: "" },
    ]);
    expect(output).toContain("[-] regex parser (error: EPARSE)");
    expect(output).toContain("[+] AST parser");
    expect(output).toContain("[~] manual parse");
  });

  it("returns empty string for empty records", () => {
    expect(formatApproachesForPrompt([])).toBe("");
  });
});

describe("ApproachMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads from disk on first access", async () => {
    const stored = [
      {
        description: "tried regex",
        outcome: "failed",
        toolCalls: 3,
        timestamp: "2026-03-18T00:00:00Z",
      },
    ];
    mockReadFile.mockResolvedValue(JSON.stringify(stored));

    const memory = new ApproachMemory("/project");
    const all = await memory.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.description).toBe("tried regex");
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it("starts fresh when file does not exist", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const memory = new ApproachMemory("/project");
    const all = await memory.getAll();
    expect(all).toHaveLength(0);
  });

  it("records new entries and saves to disk", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const memory = new ApproachMemory("/project");
    await memory.record({
      description: "tried AST parsing",
      outcome: "success",
      toolCalls: 5,
    });

    expect(memory.size).toBe(1);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const savedJson = JSON.parse(mockWriteFile.mock.calls[0]![1] as string);
    expect(savedJson).toHaveLength(1);
    expect(savedJson[0].description).toBe("tried AST parsing");
    expect(savedJson[0].timestamp).toBeTruthy();
  });

  it("finds similar approaches by Jaccard similarity", async () => {
    const stored = [
      {
        description: "fix authentication bug in login page",
        outcome: "failed",
        toolCalls: 3,
        timestamp: "",
      },
      {
        description: "deploy to production server",
        outcome: "success",
        toolCalls: 2,
        timestamp: "",
      },
      {
        description: "fix login page authentication error",
        outcome: "success",
        toolCalls: 4,
        timestamp: "",
      },
    ];
    mockReadFile.mockResolvedValue(JSON.stringify(stored));

    const memory = new ApproachMemory("/project");
    const similar = await memory.findSimilar("fix the authentication bug on login");

    // Both auth-related entries should be found; deploy should not
    expect(similar.length).toBeGreaterThanOrEqual(2);
    expect(similar.some((r) => r.description.includes("authentication"))).toBe(true);
    expect(similar.some((r) => r.description.includes("deploy"))).toBe(false);
  });

  it("returns only failed approaches via getFailedApproaches", async () => {
    const stored = [
      { description: "fix auth with regex", outcome: "failed", toolCalls: 3, timestamp: "" },
      { description: "fix auth with parser", outcome: "success", toolCalls: 4, timestamp: "" },
      {
        description: "fix auth with manual approach",
        outcome: "failed",
        toolCalls: 5,
        timestamp: "",
      },
    ];
    mockReadFile.mockResolvedValue(JSON.stringify(stored));

    const memory = new ApproachMemory("/project");
    const failed = await memory.getFailedApproaches("fix auth");
    expect(failed.every((r) => r.outcome === "failed")).toBe(true);
  });

  it("enforces LRU eviction at 500 records", async () => {
    const existing = Array.from({ length: 499 }, (_, i) => ({
      description: `approach-${i}`,
      outcome: "failed" as const,
      toolCalls: 1,
      timestamp: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    mockReadFile.mockResolvedValue(JSON.stringify(existing));

    const memory = new ApproachMemory("/project");
    // Add 2 more to push over 500
    await memory.record({ description: "new-500", outcome: "success", toolCalls: 1 });
    await memory.record({ description: "new-501", outcome: "success", toolCalls: 1 });

    expect(memory.size).toBe(500);
    const all = await memory.getAll();
    // Oldest should have been evicted
    expect(all[0]!.description).toBe("approach-1");
    expect(all[all.length - 1]!.description).toBe("new-501");
  });

  it("clears all records", async () => {
    const stored = [{ description: "something", outcome: "success", toolCalls: 1, timestamp: "" }];
    mockReadFile.mockResolvedValue(JSON.stringify(stored));

    const memory = new ApproachMemory("/project");
    await memory.getAll(); // trigger load
    await memory.clear();

    expect(memory.size).toBe(0);
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it("filters by outcome in getAll", async () => {
    const stored = [
      { description: "a", outcome: "success", toolCalls: 1, timestamp: "" },
      { description: "b", outcome: "failed", toolCalls: 1, timestamp: "" },
      { description: "c", outcome: "success", toolCalls: 1, timestamp: "" },
    ];
    mockReadFile.mockResolvedValue(JSON.stringify(stored));

    const memory = new ApproachMemory("/project");
    const successes = await memory.getAll({ outcome: "success" });
    expect(successes).toHaveLength(2);
    expect(successes.every((r) => r.outcome === "success")).toBe(true);
  });

  it("only loads from disk once (idempotent)", async () => {
    mockReadFile.mockResolvedValue("[]");

    const memory = new ApproachMemory("/project");
    await memory.getAll();
    await memory.getAll();
    await memory.findSimilar("test");

    // readFile should only be called once
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });
});
