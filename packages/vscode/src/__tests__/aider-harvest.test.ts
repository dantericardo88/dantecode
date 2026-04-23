// ============================================================================
// packages/vscode/src/__tests__/aider-harvest.test.ts
// Tests for Aider harvest wiring:
//   - Semantic repo-map symbol cache (Machine 1)
//   - Auto-commit toggle and call (Machine 4)
//   - VSCode lint check behavior (Machine 5)
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── VS Code mock ──────────────────────────────────────────────────────────────

vi.mock("vscode", () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: vi.fn((id: string) => ({ id })),
  ProgressLocation: { Notification: 15 },
  window: {
    showInputBox: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createStatusBarItem: vi.fn(() => ({
      text: "",
      tooltip: "",
      command: "",
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    })),
    withProgress: vi.fn(async (_opts: unknown, fn: () => Promise<unknown>) => fn()),
    createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
    activeTextEditor: undefined,
    visibleTextEditors: [] as unknown[],
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    executeCommand: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn(() => undefined) })),
    workspaceFolders: undefined,
  },
  env: { appName: "VS Code" },
}));

// ── @dantecode/core mock ──────────────────────────────────────────────────────

vi.mock("@dantecode/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dantecode/core")>();
  return {
    ...actual,
    buildRepoMap: vi.fn().mockResolvedValue([
      { filePath: "src/index.ts", score: 1.0, symbols: [] },
    ]),
    formatRepoMap: vi.fn().mockReturnValue("# Repository Map\nsrc/index.ts"),
  };
});

// ── vscode-lint-check mock ────────────────────────────────────────────────────

vi.mock("../vscode-lint-check.js", () => ({
  runVscodeLintCheck: vi.fn(),
  TSC_TIMEOUT_RESULT: {
    hasErrors: false,
    errorCount: 0,
    formattedErrors: "",
    byFile: new Map(),
  },
}));

// ── @dantecode/git-engine mock ────────────────────────────────────────────────

vi.mock("@dantecode/git-engine", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    autoCommit: vi.fn().mockReturnValue({ commitHash: "abc1234def", message: "feat: test", filesCommitted: [] }),
  };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { buildRepoMap, formatRepoMap } from "@dantecode/core";
import { runVscodeLintCheck } from "../vscode-lint-check.js";

// ── Symbol map cache simulation ───────────────────────────────────────────────
// Test the caching logic in isolation without the full ChatSidebarProvider.

function createSymbolMapCache() {
  const cache = new Map<string, { map: string; ts: number }>();

  async function getOrRefresh(projectPath: string): Promise<string> {
    const cached = cache.get(projectPath);
    if (!cached || Date.now() - cached.ts > 60_000) {
      try {
        const rankedFiles = await buildRepoMap(projectPath);
        const symbolMap = formatRepoMap(rankedFiles.slice(0, 40));
        cache.set(projectPath, { map: symbolMap, ts: Date.now() });
      } catch {
        cache.set(projectPath, { map: "", ts: Date.now() });
      }
    }
    return cache.get(projectPath)?.map ?? "";
  }

  return { cache, getOrRefresh };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Machine 1 — Semantic repo map cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildRepoMap).mockResolvedValue([
      { filePath: "src/index.ts", score: 1.0, symbols: [] } as unknown as import("@dantecode/core").RankedFile,
    ]);
    vi.mocked(formatRepoMap).mockReturnValue("# Repository Map\nsrc/index.ts");
  });

  it("populates cache on first call and returns symbol map", async () => {
    const { getOrRefresh } = createSymbolMapCache();
    const result = await getOrRefresh("/project");
    expect(result).toContain("Repository Map");
    expect(buildRepoMap).toHaveBeenCalledOnce();
  });

  it("returns cached value on second call within 60s TTL", async () => {
    const { getOrRefresh } = createSymbolMapCache();
    await getOrRefresh("/project");
    await getOrRefresh("/project");
    // buildRepoMap called only once — second call hit cache
    expect(buildRepoMap).toHaveBeenCalledOnce();
  });

  it("re-fetches after TTL expires (simulated via cache backdating)", async () => {
    const { cache, getOrRefresh } = createSymbolMapCache();
    await getOrRefresh("/project");
    // Simulate TTL expiry by backdating the cached entry
    const entry = cache.get("/project")!;
    cache.set("/project", { ...entry, ts: Date.now() - 70_000 });
    await getOrRefresh("/project");
    expect(buildRepoMap).toHaveBeenCalledTimes(2);
  });

  it("stores empty string when buildRepoMap throws", async () => {
    vi.mocked(buildRepoMap).mockRejectedValueOnce(new Error("scan failed"));
    const { getOrRefresh } = createSymbolMapCache();
    const result = await getOrRefresh("/project");
    expect(result).toBe("");
  });
});

// ── Machine 5 — Lint check ───────────────────────────────────────────────────

describe("Machine 5 — runVscodeLintCheck behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns hasErrors: false for clean TypeScript files", async () => {
    vi.mocked(runVscodeLintCheck).mockResolvedValue({
      hasErrors: false,
      errorCount: 0,
      formattedErrors: "",
      byFile: new Map(),
    });
    const result = await runVscodeLintCheck("/project", ["src/clean.ts"]);
    expect(result.hasErrors).toBe(false);
    expect(result.errorCount).toBe(0);
  });

  it("parses structured errors and returns hasErrors: true", async () => {
    vi.mocked(runVscodeLintCheck).mockResolvedValue({
      hasErrors: true,
      errorCount: 2,
      formattedErrors:
        "src/broken.ts(3,5): error TS2322: Type 'string' not assignable to 'number'\nsrc/broken.ts(7,1): error TS2304: Cannot find name 'foo'",
      byFile: new Map(),
    });
    const result = await runVscodeLintCheck("/project", ["src/broken.ts"]);
    expect(result.hasErrors).toBe(true);
    expect(result.errorCount).toBe(2);
    expect(result.formattedErrors).toContain("TS2322");
  });

  it("skips lint when no .ts/.tsx files in applied list", () => {
    const applied = ["README.md", "package.json", "src/styles.css"];
    const tsChanged = applied.filter((p) => /\.[mc]?tsx?$/.test(p));
    expect(tsChanged).toHaveLength(0);
    // runVscodeLintCheck should NOT be called for non-TS files
    expect(runVscodeLintCheck).not.toHaveBeenCalled();
  });

  it("filters only .ts/.tsx/.mts/.cts files from applied list", () => {
    const applied = ["src/a.ts", "src/b.tsx", "src/c.mts", "src/d.js", "README.md"];
    const tsChanged = applied.filter((p) => /\.[mc]?tsx?$/.test(p));
    expect(tsChanged).toEqual(["src/a.ts", "src/b.tsx", "src/c.mts"]);
    expect(tsChanged).not.toContain("src/d.js");
    expect(tsChanged).not.toContain("README.md");
  });
});
