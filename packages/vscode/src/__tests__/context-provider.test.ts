import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs and node:child_process before importing the module
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import * as fs from "node:fs";
import * as cp from "node:child_process";

import {
  parseAllMentions,
  formatForPrompt,
  ContextProviderRegistry,
  FILE_PROVIDER,
  GIT_PROVIDER,
  type ContextItem,
  type ContextProvider,
} from "../context-provider.js";

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockExecSync = vi.mocked(cp.execSync);

// ── parseAllMentions ──────────────────────────────────────────────────────

describe("parseAllMentions", () => {
  it("returns empty array for plain text", () => {
    expect(parseAllMentions("hello world")).toEqual([]);
  });

  it("parses @file mention", () => {
    const result = parseAllMentions("look at @file:src/app.ts");
    expect(result).toHaveLength(1);
    expect(result[0]?.trigger).toBe("@file");
    expect(result[0]?.query).toBe("src/app.ts");
  });

  it("parses @git without query", () => {
    const result = parseAllMentions("show me @git changes");
    expect(result).toHaveLength(1);
    expect(result[0]?.trigger).toBe("@git");
    expect(result[0]?.query).toBe("");
  });

  it("parses @git with sub-command", () => {
    const result = parseAllMentions("@git:log");
    expect(result[0]?.trigger).toBe("@git");
    expect(result[0]?.query).toBe("log");
  });

  it("parses multiple mentions", () => {
    const result = parseAllMentions("see @file:foo.ts and @git diff");
    expect(result).toHaveLength(2);
    expect(result[0]?.trigger).toBe("@file");
    expect(result[1]?.trigger).toBe("@git");
  });

  it("parses @code mention", () => {
    const result = parseAllMentions("explain @code:MyClass");
    expect(result[0]?.trigger).toBe("@code");
    expect(result[0]?.query).toBe("MyClass");
  });

  it("parses @problems mention", () => {
    const result = parseAllMentions("@problems");
    expect(result[0]?.trigger).toBe("@problems");
  });

  it("parses @selection mention", () => {
    const result = parseAllMentions("@selection");
    expect(result[0]?.trigger).toBe("@selection");
  });

  it("parses @terminal mention", () => {
    const result = parseAllMentions("check @terminal output");
    expect(result[0]?.trigger).toBe("@terminal");
  });

  it("does not parse unknown @ mentions", () => {
    expect(parseAllMentions("@unknown:foo")).toEqual([]);
  });
});

// ── formatForPrompt ───────────────────────────────────────────────────────

describe("formatForPrompt", () => {
  it("returns empty string for empty array", () => {
    expect(formatForPrompt([])).toBe("");
  });

  it("formats single item with Context header", () => {
    const items: ContextItem[] = [
      { type: "file", label: "@file:app.ts", content: "```\nconst x = 1;\n```" },
    ];
    const output = formatForPrompt(items);
    expect(output).toContain("## Context");
    expect(output).toContain("@file:app.ts");
    expect(output).toContain("const x = 1;");
  });

  it("formats multiple items as separate sections", () => {
    const items: ContextItem[] = [
      { type: "file", label: "@file:a.ts", content: "content-a" },
      { type: "git", label: "@git", content: "diff output" },
    ];
    const output = formatForPrompt(items);
    expect(output).toContain("@file:a.ts");
    expect(output).toContain("@git");
    expect(output).toContain("content-a");
    expect(output).toContain("diff output");
  });
});

// ── FILE_PROVIDER ─────────────────────────────────────────────────────────

describe("FILE_PROVIDER", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves file content", async () => {
    mockReadFileSync.mockReturnValue("const x = 42;");
    const items = await FILE_PROVIDER.resolve("src/app.ts", "/project");
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe("file");
    expect(items[0]?.content).toContain("const x = 42;");
    expect(items[0]?.label).toBe("@file:src/app.ts");
  });

  it("returns not-found item when file missing", async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const items = await FILE_PROVIDER.resolve("missing.ts", "/project");
    expect(items[0]?.content).toContain("not found");
  });

  it("returns empty array for empty query", async () => {
    const items = await FILE_PROVIDER.resolve("", "/project");
    expect(items).toHaveLength(0);
  });
});

// ── GIT_PROVIDER ──────────────────────────────────────────────────────────

describe("GIT_PROVIDER", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns git diff by default", async () => {
    mockExecSync.mockReturnValue("diff --git a/foo.ts b/foo.ts\n+const x = 1;");
    const items = await GIT_PROVIDER.resolve("", "/project");
    expect(items[0]?.type).toBe("git");
    expect(items[0]?.content).toContain("+const x = 1;");
  });

  it("returns git log when query is 'log'", async () => {
    mockExecSync.mockReturnValue("abc1234 Initial commit");
    const items = await GIT_PROVIDER.resolve("log", "/project");
    expect(items[0]?.content).toContain("abc1234");
  });

  it("returns fallback when git fails", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    const items = await GIT_PROVIDER.resolve("", "/project");
    expect(items[0]?.content).toContain("not available");
  });
});

// ── ContextProviderRegistry ───────────────────────────────────────────────

describe("ContextProviderRegistry", () => {
  it("pre-registers 3 built-in providers", () => {
    const registry = new ContextProviderRegistry();
    const providers = registry.listProviders();
    expect(providers.length).toBeGreaterThanOrEqual(3);
    const triggers = providers.map((p) => p.trigger);
    expect(triggers).toContain("@file");
    expect(triggers).toContain("@code");
    expect(triggers).toContain("@git");
  });

  it("allows registering additional providers", () => {
    const registry = new ContextProviderRegistry();
    const custom: ContextProvider = {
      name: "custom",
      trigger: "@custom",
      description: "custom",
      async resolve() {
        return [{ type: "selection", label: "@custom", content: "hello" }];
      },
    };
    registry.register(custom);
    const triggers = registry.listProviders().map((p) => p.trigger);
    expect(triggers).toContain("@custom");
  });

  it("resolve returns null for unknown trigger", async () => {
    const registry = new ContextProviderRegistry();
    const result = await registry.resolve("@unknown:foo", "/project");
    expect(result).toBeNull();
  });

  it("resolveAllMentions handles empty text", async () => {
    const registry = new ContextProviderRegistry();
    const items = await registry.resolveAllMentions("", "/project");
    expect(items).toEqual([]);
  });

  it("resolveAllMentions resolves @file mention", async () => {
    mockReadFileSync.mockReturnValue("hello");
    const registry = new ContextProviderRegistry();
    const items = await registry.resolveAllMentions("see @file:test.ts please", "/project");
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("@file:test.ts");
  });

  it("resolveAllMentions resolves multiple mentions", async () => {
    mockReadFileSync.mockReturnValue("file content");
    mockExecSync.mockReturnValue("diff output");
    const registry = new ContextProviderRegistry();
    const items = await registry.resolveAllMentions("@file:a.ts and @git", "/project");
    expect(items).toHaveLength(2);
  });
});
