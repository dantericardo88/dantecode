// ============================================================================
// @dantecode/core — Context Selector Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getGitFrequencyScores,
  computeFrequencyMultiplier,
  findAdjacentTestFile,
  findReferencedTypeFiles,
  detectPrimaryLanguage,
  selectContextFiles,
  type ContextCandidate,
} from "./context-selector.js";

// Mock child_process and fs
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.resetAllMocks();
});

// ----------------------------------------------------------------------------
// getGitFrequencyScores
// ----------------------------------------------------------------------------

describe("getGitFrequencyScores", () => {
  it("parses git log output and counts file appearances", () => {
    mockExecFileSync.mockReturnValue(
      [
        "src/index.ts",
        "src/utils.ts",
        "",
        "src/index.ts",
        "src/config.ts",
        "",
        "src/index.ts",
        "src/utils.ts",
        "",
      ].join("\n"),
    );

    const scores = getGitFrequencyScores("/project");
    expect(scores.get("src/index.ts")).toBe(3);
    expect(scores.get("src/utils.ts")).toBe(2);
    expect(scores.get("src/config.ts")).toBe(1);
  });

  it("returns empty map when git command fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    const scores = getGitFrequencyScores("/not-a-repo");
    expect(scores.size).toBe(0);
  });

  it("passes limit parameter to git log", () => {
    mockExecFileSync.mockReturnValue("");
    getGitFrequencyScores("/project", 100);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["log", "--pretty=format:", "--name-only", "-n", "100"],
      expect.objectContaining({ cwd: "/project" }),
    );
  });

  it("skips empty lines in git output", () => {
    mockExecFileSync.mockReturnValue("\n\n\nsrc/a.ts\n\n\n");
    const scores = getGitFrequencyScores("/project");
    expect(scores.size).toBe(1);
    expect(scores.get("src/a.ts")).toBe(1);
  });
});

// ----------------------------------------------------------------------------
// computeFrequencyMultiplier
// ----------------------------------------------------------------------------

describe("computeFrequencyMultiplier", () => {
  it("returns 1.0 for files not in frequency map", () => {
    const scores = new Map<string, number>();
    expect(computeFrequencyMultiplier("unknown.ts", scores)).toBe(1.0);
  });

  it("returns 1.1 for files with 1 appearance", () => {
    const scores = new Map([["file.ts", 1]]);
    expect(computeFrequencyMultiplier("file.ts", scores)).toBeCloseTo(1.1);
  });

  it("caps at 1.5 for files with 5+ appearances", () => {
    const scores = new Map([["hot.ts", 10]]);
    expect(computeFrequencyMultiplier("hot.ts", scores)).toBeCloseTo(1.5);
  });

  it("returns 1.3 for files with 3 appearances", () => {
    const scores = new Map([["mid.ts", 3]]);
    expect(computeFrequencyMultiplier("mid.ts", scores)).toBeCloseTo(1.3);
  });
});

// ----------------------------------------------------------------------------
// findAdjacentTestFile
// ----------------------------------------------------------------------------

describe("findAdjacentTestFile", () => {
  it("finds foo.test.ts adjacent to foo.ts", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes("foo.test.ts");
    });

    const result = findAdjacentTestFile("/src/foo.ts");
    expect(result).toContain("foo.test.ts");
  });

  it("finds foo.spec.ts when foo.test.ts does not exist", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes("foo.spec.ts");
    });

    const result = findAdjacentTestFile("/src/foo.ts");
    expect(result).toContain("foo.spec.ts");
  });

  it("returns null when no test file exists", () => {
    mockExistsSync.mockReturnValue(false);
    const result = findAdjacentTestFile("/src/bar.ts");
    expect(result).toBeNull();
  });

  it("returns null when the file is already a test file", () => {
    const result = findAdjacentTestFile("/src/bar.test.ts");
    expect(result).toBeNull();
  });

  it("returns null for spec files", () => {
    const result = findAdjacentTestFile("/src/bar.spec.ts");
    expect(result).toBeNull();
  });

  it("checks __tests__ directory as fallback", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes("__tests__");
    });

    const result = findAdjacentTestFile("/src/utils.ts");
    expect(result).toContain("__tests__");
  });
});

// ----------------------------------------------------------------------------
// detectPrimaryLanguage
// ----------------------------------------------------------------------------

describe("detectPrimaryLanguage", () => {
  it("detects TypeScript as primary language", () => {
    const files = [
      "src/index.ts",
      "src/utils.ts",
      "src/config.ts",
      "package.json",
      "README.md",
    ];
    expect(detectPrimaryLanguage(files)).toBe("typescript");
  });

  it("detects Python as primary language", () => {
    const files = [
      "main.py",
      "utils.py",
      "tests/test_main.py",
      "setup.cfg",
    ];
    expect(detectPrimaryLanguage(files)).toBe("python");
  });

  it("detects Go as primary language", () => {
    const files = ["main.go", "handler.go", "handler_test.go"];
    expect(detectPrimaryLanguage(files)).toBe("go");
  });

  it("returns unknown for unrecognized extensions", () => {
    const files = ["data.csv", "config.yaml", "README.md"];
    expect(detectPrimaryLanguage(files)).toBe("unknown");
  });

  it("picks the language with the most files", () => {
    const files = [
      "main.py",
      "src/index.ts",
      "src/utils.ts",
      "src/config.ts",
    ];
    expect(detectPrimaryLanguage(files)).toBe("typescript");
  });

  it("handles empty file list", () => {
    expect(detectPrimaryLanguage([])).toBe("unknown");
  });
});

// ----------------------------------------------------------------------------
// findReferencedTypeFiles
// ----------------------------------------------------------------------------

describe("findReferencedTypeFiles", () => {
  it("finds .d.ts files from import type statements", () => {
    const code = `import type { Foo } from "./types";`;
    mockExistsSync.mockImplementation((p) => String(p).endsWith("types.d.ts"));

    const result = findReferencedTypeFiles(code, "/src");
    expect(result.length).toBe(1);
    expect(result[0]).toContain("types.d.ts");
  });

  it("finds .ts files when .d.ts does not exist", () => {
    const code = `import type { Bar } from "./models";`;
    mockExistsSync.mockImplementation((p) => String(p).endsWith("models.ts"));

    const result = findReferencedTypeFiles(code, "/src");
    expect(result.length).toBe(1);
    expect(result[0]).toContain("models.ts");
  });

  it("returns empty array when no type imports found", () => {
    const code = `import { something } from "lodash";`;
    mockExistsSync.mockReturnValue(false);

    const result = findReferencedTypeFiles(code, "/src");
    expect(result).toEqual([]);
  });

  it("deduplicates type file references", () => {
    const code = [
      `import type { A } from "./types";`,
      `import type { B } from "./types";`,
    ].join("\n");
    mockExistsSync.mockImplementation((p) => String(p).endsWith("types.d.ts"));

    const result = findReferencedTypeFiles(code, "/src");
    expect(result.length).toBe(1);
  });
});

// ----------------------------------------------------------------------------
// selectContextFiles
// ----------------------------------------------------------------------------

describe("selectContextFiles", () => {
  it("sorts files by relevance score descending", () => {
    mockExecFileSync.mockReturnValue("");
    mockExistsSync.mockReturnValue(false);

    const files: ContextCandidate[] = [
      { path: "a.ts", relevanceScore: 0.5, reason: "match" },
      { path: "b.ts", relevanceScore: 0.9, reason: "match" },
      { path: "c.ts", relevanceScore: 0.7, reason: "match" },
    ];

    const result = selectContextFiles(files, "/project", {
      useGitFrequency: false,
      includeAdjacentTests: false,
      includeTypeDefinitions: false,
    });

    expect(result[0]!.path).toBe("b.ts");
    expect(result[1]!.path).toBe("c.ts");
    expect(result[2]!.path).toBe("a.ts");
  });

  it("respects maxFiles limit", () => {
    mockExecFileSync.mockReturnValue("");
    mockExistsSync.mockReturnValue(false);

    const files: ContextCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      path: `file${i}.ts`,
      relevanceScore: i / 10,
      reason: "match",
    }));

    const result = selectContextFiles(files, "/project", {
      maxFiles: 3,
      useGitFrequency: false,
      includeAdjacentTests: false,
      includeTypeDefinitions: false,
    });

    expect(result.length).toBe(3);
  });

  it("applies git frequency multiplier to scores", () => {
    mockExecFileSync.mockReturnValue(
      ["a.ts", "a.ts", "a.ts", "a.ts", "a.ts"].join("\n"),
    );
    mockExistsSync.mockReturnValue(false);

    const files: ContextCandidate[] = [
      { path: "a.ts", relevanceScore: 0.5, reason: "match" },
      { path: "b.ts", relevanceScore: 0.6, reason: "match" },
    ];

    const result = selectContextFiles(files, "/project", {
      includeAdjacentTests: false,
      includeTypeDefinitions: false,
    });

    // a.ts: 0.5 * 1.5 = 0.75, b.ts: 0.6 * 1.0 = 0.6
    expect(result[0]!.path).toBe("a.ts");
    expect(result[0]!.relevanceScore).toBeCloseTo(0.75);
  });

  it("includes adjacent test files when enabled", () => {
    mockExecFileSync.mockReturnValue("");
    mockExistsSync.mockImplementation((p) => String(p).includes(".test."));

    const files: ContextCandidate[] = [
      { path: "src/utils.ts", relevanceScore: 1.0, reason: "match" },
    ];

    const result = selectContextFiles(files, "/project", {
      useGitFrequency: false,
      includeAdjacentTests: true,
      includeTypeDefinitions: false,
    });

    expect(result.length).toBe(2);
    expect(result.some((f) => f.path.includes(".test."))).toBe(true);
  });
});
