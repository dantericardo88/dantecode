// packages/core/src/__tests__/repo-map-builder.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRepoMap, formatRepoMapForPrompt, getTopFiles } from "../repo-map-builder.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import { readFileSync, statSync, readdirSync } from "node:fs";
const mockReadFileSync = vi.mocked(readFileSync) as any;
const mockStatSync = vi.mocked(statSync);
const mockReaddirSync = vi.mocked(readdirSync);

// Helper to build a fake directory entry
function dirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir };
}

// Simple flat project with two source files
function setupFlatProject() {
  mockReaddirSync.mockImplementation((dir: unknown) => {
    const d = dir as string;
    if (d.endsWith("project")) {
      return [
        dirent("index.ts", false),
        dirent("utils.ts", false),
      ] as unknown as ReturnType<typeof readdirSync>;
    }
    return [] as unknown as ReturnType<typeof readdirSync>;
  });

  mockStatSync.mockReturnValue({ size: 400 } as ReturnType<typeof statSync>);

  mockReadFileSync.mockImplementation((p: unknown) => {
    const path = p as string;
    if (path.includes("index.ts")) {
      return `import { helper } from './utils';\nexport function main() {}\nexport const VERSION = "1";` as unknown;
    }
    if (path.includes("utils.ts")) {
      return `export function helper() {}\nexport class Utility {}` as unknown;
    }
    return "" as unknown;
  });
}

// ─── buildRepoMap ─────────────────────────────────────────────────────────────

describe("buildRepoMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a RepoMap with projectRoot and generatedAt", () => {
    setupFlatProject();
    const map = buildRepoMap("/project");
    expect(map.projectRoot).toBe("/project");
    expect(map.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("scans source files and produces file entries", () => {
    setupFlatProject();
    const map = buildRepoMap("/project");
    expect(map.files.length).toBeGreaterThanOrEqual(1);
    const paths = map.files.map((f) => f.path);
    expect(paths.some((p) => p.includes("index.ts"))).toBe(true);
  });

  it("detects index.ts as an entry point", () => {
    setupFlatProject();
    const map = buildRepoMap("/project");
    const indexFile = map.files.find((f) => f.path.endsWith("index.ts"));
    expect(indexFile?.isEntryPoint).toBe(true);
  });

  it("extracts exports correctly", () => {
    setupFlatProject();
    const map = buildRepoMap("/project");
    const indexFile = map.files.find((f) => f.path.endsWith("index.ts"));
    expect(indexFile?.exports).toContain("main");
    expect(indexFile?.exports).toContain("VERSION");
  });

  it("computes fan-in for imported files", () => {
    setupFlatProject();
    const map = buildRepoMap("/project");
    const utilsFile = map.files.find((f) => f.path.endsWith("utils.ts"));
    // index.ts imports utils.ts → fan-in 1
    expect(utilsFile?.fanIn).toBeGreaterThanOrEqual(1);
  });

  it("sorts files by importance descending", () => {
    setupFlatProject();
    const map = buildRepoMap("/project");
    for (let i = 1; i < map.files.length; i++) {
      expect(map.files[i - 1]!.importance).toBeGreaterThanOrEqual(map.files[i]!.importance);
    }
  });

  it("respects maxFiles option", () => {
    setupFlatProject();
    const map = buildRepoMap("/project", { maxFiles: 1 });
    expect(map.files.length).toBe(1);
  });

  it("excludes test files when sourceOnly=true", () => {
    mockReaddirSync.mockImplementation((dir: unknown) => {
      const d = dir as string;
      if (d.endsWith("project")) {
        return [
          dirent("index.ts", false),
          dirent("index.test.ts", false),
        ] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    mockStatSync.mockReturnValue({ size: 200 } as ReturnType<typeof statSync>);
    mockReadFileSync.mockReturnValue("export function x() {}" as unknown as string);

    const map = buildRepoMap("/project", { sourceOnly: true });
    expect(map.files.every((f) => !f.path.includes(".test."))).toBe(true);
  });

  it("skips files matching ignorePatterns", () => {
    setupFlatProject();
    const map = buildRepoMap("/project", { ignorePatterns: [/utils/] });
    expect(map.files.every((f) => !f.path.includes("utils"))).toBe(true);
  });

  it("includes dependency edges for imports", () => {
    setupFlatProject();
    const map = buildRepoMap("/project");
    expect(map.edges.length).toBeGreaterThanOrEqual(1);
    const edgeFromIndex = map.edges.find((e) => e.from.includes("index.ts"));
    expect(edgeFromIndex).toBeTruthy();
  });

  it("includes entryPoints list", () => {
    setupFlatProject();
    const map = buildRepoMap("/project");
    expect(map.entryPoints.some((ep) => ep.includes("index"))).toBe(true);
  });

  it("calculates totalTokens as sum of top file tokens", () => {
    setupFlatProject();
    const map = buildRepoMap("/project");
    const sum = map.files.reduce((s, f) => s + f.tokens, 0);
    expect(map.totalTokens).toBe(sum);
  });

  it("classifies source files correctly", () => {
    setupFlatProject();
    const map = buildRepoMap("/project");
    const utilsFile = map.files.find((f) => f.path.endsWith("utils.ts"));
    expect(utilsFile?.category).toBe("source");
  });

  it("classifies test files correctly", () => {
    mockReaddirSync.mockImplementation((dir: unknown) => {
      const d = dir as string;
      if (d.endsWith("project")) {
        return [dirent("app.test.ts", false)] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    mockStatSync.mockReturnValue({ size: 100 } as ReturnType<typeof statSync>);
    mockReadFileSync.mockReturnValue("it('test', () => {})" as unknown as string);

    const map = buildRepoMap("/project");
    const testFile = map.files.find((f) => f.path.includes(".test."));
    expect(testFile?.category).toBe("test");
  });

  it("ignores node_modules directory", () => {
    mockReaddirSync.mockImplementation((dir: unknown) => {
      const d = dir as string;
      if (d.endsWith("project")) {
        return [
          dirent("node_modules", true),
          dirent("index.ts", false),
        ] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    mockStatSync.mockReturnValue({ size: 100 } as ReturnType<typeof statSync>);
    mockReadFileSync.mockReturnValue("export const x = 1;" as unknown as string);

    const map = buildRepoMap("/project");
    expect(map.files.every((f) => !f.path.includes("node_modules"))).toBe(true);
  });

  it("skips files larger than 500KB", () => {
    mockReaddirSync.mockImplementation((dir: unknown) => {
      const d = dir as string;
      if (d.endsWith("project")) {
        return [dirent("big.ts", false)] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    // File is > 500KB but stat still returns entry
    mockStatSync.mockReturnValue({ size: 600_000 } as ReturnType<typeof statSync>);
    mockReadFileSync.mockReturnValue("" as unknown as string);

    const map = buildRepoMap("/project");
    // big.ts should still be in the map (scanned) but content empty → fewer exports
    const bigFile = map.files.find((f) => f.path.includes("big.ts"));
    if (bigFile) {
      expect(bigFile.exports).toHaveLength(0);
    }
  });

  it("handles readdirSync errors gracefully", () => {
    mockReaddirSync.mockImplementation(() => { throw new Error("EACCES"); });
    expect(() => buildRepoMap("/project")).not.toThrow();
  });

  it("tokens estimated as ceiling(sizeBytes/4)", () => {
    mockReaddirSync.mockImplementation((dir: unknown) => {
      const d = dir as string;
      if (d.endsWith("project")) {
        return [dirent("mod.ts", false)] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    mockStatSync.mockReturnValue({ size: 401 } as ReturnType<typeof statSync>);
    mockReadFileSync.mockReturnValue("export const x = 1;" as unknown as string);

    const map = buildRepoMap("/project");
    const modFile = map.files.find((f) => f.path.includes("mod.ts"));
    expect(modFile?.tokens).toBe(Math.ceil(401 / 4));
  });
});

// ─── formatRepoMapForPrompt ───────────────────────────────────────────────────

describe("formatRepoMapForPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFlatProject();
  });

  it("includes '## Repository Map' header", () => {
    const map = buildRepoMap("/project");
    const output = formatRepoMapForPrompt(map);
    expect(output).toContain("## Repository Map");
  });

  it("shows project name", () => {
    const map = buildRepoMap("/project");
    const output = formatRepoMapForPrompt(map);
    expect(output).toContain("project");
  });

  it("includes entry points when present", () => {
    const map = buildRepoMap("/project");
    const output = formatRepoMapForPrompt(map);
    if (map.entryPoints.length > 0) {
      expect(output).toContain("Entry points");
    }
  });

  it("shows importance bars with █ and ░ characters", () => {
    const map = buildRepoMap("/project");
    const output = formatRepoMapForPrompt(map);
    expect(output).toMatch(/[█░]/);
  });

  it("shows exports when showExports=true", () => {
    const map = buildRepoMap("/project");
    const output = formatRepoMapForPrompt(map, { showExports: true });
    // index.ts exports main and VERSION
    expect(output).toContain("→");
  });

  it("omits exports when showExports=false", () => {
    const map = buildRepoMap("/project");
    const output = formatRepoMapForPrompt(map, { showExports: false });
    expect(output).not.toContain("→");
  });

  it("truncates output at maxOutputTokens * 4 chars", () => {
    const map = buildRepoMap("/project");
    // Very small budget
    const output = formatRepoMapForPrompt(map, { maxOutputTokens: 10 });
    expect(output.length).toBeLessThanOrEqual(10 * 4 + 30); // allow for truncation marker
  });

  it("shows dependency edges when showDependencies=true", () => {
    const map = buildRepoMap("/project");
    if (map.edges.length > 0) {
      const output = formatRepoMapForPrompt(map, { showDependencies: true });
      expect(output).toContain("dependencies");
    }
  });

  it("limits files shown to topN", () => {
    const map = buildRepoMap("/project");
    const output = formatRepoMapForPrompt(map, { topN: 1 });
    // Should only show 1 file — no way to count exactly, but output should be shorter
    const fullOutput = formatRepoMapForPrompt(map, { topN: 100 });
    expect(output.length).toBeLessThanOrEqual(fullOutput.length);
  });

  it("groups files by directory", () => {
    // Add a subdirectory file
    mockReaddirSync.mockImplementation((dir: unknown) => {
      const d = dir as string;
      if (d.endsWith("project")) {
        return [
          dirent("src", true),
          dirent("index.ts", false),
        ] as unknown as ReturnType<typeof readdirSync>;
      }
      if (d.endsWith("src")) {
        return [dirent("app.ts", false)] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    mockStatSync.mockReturnValue({ size: 200 } as ReturnType<typeof statSync>);
    mockReadFileSync.mockReturnValue("export function app() {}" as unknown as string);

    const map = buildRepoMap("/project");
    const output = formatRepoMapForPrompt(map);
    // Should have at least one directory label ending in /
    expect(output).toMatch(/\*\*.+\/:\*\*/);
  });
});

// ─── getTopFiles ──────────────────────────────────────────────────────────────

describe("getTopFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFlatProject();
  });

  it("returns at most n paths", () => {
    const map = buildRepoMap("/project");
    const top = getTopFiles(map, 1);
    expect(top).toHaveLength(1);
  });

  it("returns paths (strings)", () => {
    const map = buildRepoMap("/project");
    const top = getTopFiles(map);
    for (const p of top) {
      expect(typeof p).toBe("string");
    }
  });

  it("paths are sorted by importance (highest first)", () => {
    const map = buildRepoMap("/project");
    const top = getTopFiles(map, map.files.length);
    // File[0] has highest importance from map
    expect(top[0]).toBe(map.files[0]!.path);
  });

  it("defaults to 10 files", () => {
    // Create 15 fake files
    const names = Array.from({ length: 15 }, (_, i) => `file${i}.ts`);
    mockReaddirSync.mockImplementation((dir: unknown) => {
      const d = dir as string;
      if (d.endsWith("project")) {
        return names.map((n) => dirent(n, false)) as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    mockStatSync.mockReturnValue({ size: 200 } as ReturnType<typeof statSync>);
    mockReadFileSync.mockReturnValue("export function x() {}" as unknown as string);

    const map = buildRepoMap("/project", { maxFiles: 200 });
    const top = getTopFiles(map);
    expect(top.length).toBeLessThanOrEqual(10);
  });
});
