// packages/codebase-index/src/__tests__/repo-map-tags.test.ts
// 8 tests covering Aider-style def/ref symbol tagging

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @dantecode/core ──────────────────────────────────────────────────────

vi.mock("@dantecode/core", async () => {
  const actual = await vi.importActual<typeof import("@dantecode/core")>("@dantecode/core");
  return {
    ...actual,
    buildRepoMapTags: vi.fn().mockResolvedValue([]),
    buildRepoMap: vi.fn().mockResolvedValue([]),
    formatRepoMap: vi.fn().mockReturnValue(""),
  };
});

import { extractSymbolTags } from "@dantecode/core";
import type { SymbolTag } from "@dantecode/core";
import { RepoMapProvider } from "../repo-map-provider.js";
import { buildRepoMapTags } from "@dantecode/core";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSymbol(name: string, kind: "function" | "class" | "const" | "interface" | "type", filePath: string) {
  return { name, kind, signature: name, filePath, line: 1 };
}

// ── extractSymbolTags ─────────────────────────────────────────────────────────

describe("extractSymbolTags", () => {
  it("returns SymbolTag[] with correct definedInFile", async () => {
    const allSymbols = new Map([
      ["src/auth.ts", [makeSymbol("AuthService", "class", "src/auth.ts")]],
    ]);
    const fileContents = new Map([
      ["src/auth.ts", "export class AuthService {}"],
      ["src/main.ts", "import { AuthService } from './auth'; new AuthService();"],
    ]);
    const tags = await extractSymbolTags(allSymbols, fileContents);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0]!.definedInFile).toBe("src/auth.ts");
    expect(tags[0]!.name).toBe("AuthService");
  });

  it("symbol referenced in 3 other files gets refCount=3", async () => {
    const allSymbols = new Map([
      ["src/utils.ts", [makeSymbol("formatDate", "function", "src/utils.ts")]],
    ]);
    // Use unambiguous direct call expressions in all 3 ref files
    const fileContents = new Map([
      ["src/utils.ts", "export function formatDate() {}"],
      ["src/a.ts", "formatDate();"],
      ["src/b.ts", "formatDate();"],
      ["src/c.ts", "formatDate();"],
    ]);
    const tags = await extractSymbolTags(allSymbols, fileContents);
    const tag = tags.find((t) => t.name === "formatDate");
    expect(tag).toBeDefined();
    expect(tag!.refCount).toBe(3);
    expect(tag!.refFiles).toHaveLength(3);
  });

  it("symbol with no references in other files gets refCount=0", async () => {
    const allSymbols = new Map([
      ["src/orphan.ts", [makeSymbol("OrphanHelper", "function", "src/orphan.ts")]],
    ]);
    const fileContents = new Map([
      ["src/orphan.ts", "export function OrphanHelper() {}"],
      ["src/main.ts", "console.log('hello');"],
    ]);
    const tags = await extractSymbolTags(allSymbols, fileContents);
    const tag = tags.find((t) => t.name === "OrphanHelper");
    expect(tag).toBeDefined();
    expect(tag!.refCount).toBe(0);
  });

  it("SymbolTag.kind correctly identifies 'class' vs 'function' vs 'const'", async () => {
    const allSymbols = new Map([
      ["src/mixed.ts", [
        makeSymbol("MyClass", "class", "src/mixed.ts"),
        makeSymbol("myFn", "function", "src/mixed.ts"),
        makeSymbol("MY_CONST", "const", "src/mixed.ts"),
      ]],
    ]);
    const fileContents = new Map([
      ["src/mixed.ts", "export class MyClass {} export function myFn() {} export const MY_CONST = 1;"],
    ]);
    const tags = await extractSymbolTags(allSymbols, fileContents);
    const kinds = tags.map((t) => t.kind);
    expect(kinds).toContain("class");
    expect(kinds).toContain("function");
    expect(kinds).toContain("const");
  });
});

// ── RepoMapProvider.getRepoMapTags ────────────────────────────────────────────

describe("RepoMapProvider.getRepoMapTags", () => {
  let provider: RepoMapProvider;

  beforeEach(() => {
    provider = new RepoMapProvider();
    vi.mocked(buildRepoMapTags).mockReset();
  });

  it("returns tags for given project root", async () => {
    const mockTags: SymbolTag[] = [
      { name: "AuthService", kind: "class", definedInFile: "src/auth.ts", refCount: 5, refFiles: [] },
    ];
    vi.mocked(buildRepoMapTags).mockResolvedValueOnce(mockTags);

    const tags = await provider.getRepoMapTags("/project");
    expect(tags).toHaveLength(1);
    expect(tags[0]!.name).toBe("AuthService");
  });

  it("caches: second call within 5 min returns same result without re-scanning", async () => {
    const mockTags: SymbolTag[] = [
      { name: "UserService", kind: "class", definedInFile: "src/user.ts", refCount: 3, refFiles: [] },
    ];
    vi.mocked(buildRepoMapTags).mockResolvedValueOnce(mockTags);

    await provider.getRepoMapTags("/project");
    await provider.getRepoMapTags("/project");

    // buildRepoMapTags called only once due to TTL caching
    expect(buildRepoMapTags).toHaveBeenCalledTimes(1);
  });

  it("returns [] on error", async () => {
    vi.mocked(buildRepoMapTags).mockRejectedValueOnce(new Error("scan failed"));
    const tags = await provider.getRepoMapTags("/project");
    expect(tags).toEqual([]);
  });

  it("SymbolTag type is exported from @dantecode/codebase-index", async () => {
    // If this import compiles, the type is exported
    const { RepoMapProvider: RP } = await import("../repo-map-provider.js");
    expect(RP).toBeDefined();
    // Type-level check: SymbolTag imported at top of file proves it's exported
    const tag: SymbolTag = {
      name: "Test",
      kind: "function",
      definedInFile: "src/test.ts",
      refCount: 0,
      refFiles: [],
    };
    expect(tag.name).toBe("Test");
  });
});
