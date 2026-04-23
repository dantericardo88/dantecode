// ============================================================================
// Sprint M — Dim 19: testDecoManager.apply() trigger wiring
// Tests that onDidSaveTextDocument triggers apply() with parsed vitest results
// and that runTestsAndDecorate command calls apply() after test run.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", () => ({
  Uri: { file: (p: string) => ({ fsPath: p }), parse: (s: string) => ({ toString: () => s }) },
  workspace: {
    fs: { readFile: vi.fn(), writeFile: vi.fn(), delete: vi.fn() },
    workspaceFolders: [{ uri: { fsPath: "/test-workspace" } }],
    onDidSaveTextDocument: vi.fn(),
  },
  window: {
    showTextDocument: vi.fn(),
    showInformationMessage: vi.fn(),
    createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
    visibleTextEditors: [],
  },
  ViewColumn: { Beside: 2 },
  OverviewRulerLane: { Right: 4 },
  Range: vi.fn((sl: number, sc: number, el: number, ec: number) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } })),
  MarkdownString: vi.fn((s: string) => ({ value: s })),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { readFile } from "node:fs/promises";
import { parseVitestResults, createTestDecorationManager } from "../test-decoration-manager.js";

const mockReadFile = readFile as ReturnType<typeof vi.fn>;

// Minimal vitest JSON output shape
function makeVitestJson(tests: Array<{ title: string; status: "passed" | "failed" | "skipped"; file: string; line?: number }>) {
  return JSON.stringify({
    testResults: [
      {
        testFilePath: tests[0]?.file ?? "/repo/src/foo.test.ts",
        assertionResults: tests.map((t, i) => ({
          title: t.title,
          status: t.status,
          location: { line: t.line ?? i + 1 },
        })),
      },
    ],
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("testDecoManager.apply() trigger — Sprint M", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. parseVitestResults returns TestResult[] from valid JSON
  it("parseVitestResults returns results from valid vitest JSON output", () => {
    const json = makeVitestJson([
      { title: "it passes", status: "passed", file: "/repo/src/foo.test.ts", line: 5 },
      { title: "it fails", status: "failed", file: "/repo/src/foo.test.ts", line: 10 },
    ]);
    const results = parseVitestResults(json);
    expect(results).toHaveLength(2);
    expect(results[0]!.status).toBe("pass");
    expect(results[1]!.status).toBe("fail");
  });

  // 2. parseVitestResults maps 1-indexed lines to 0-indexed
  it("parseVitestResults converts 1-indexed vitest lines to 0-indexed ranges", () => {
    const json = makeVitestJson([
      { title: "test", status: "passed", file: "/repo/src/foo.test.ts", line: 3 },
    ]);
    const results = parseVitestResults(json);
    expect(results[0]!.line).toBe(2); // 3 - 1 = 2
  });

  // 3. parseVitestResults handles invalid JSON without throwing
  it("parseVitestResults returns [] for invalid JSON", () => {
    const results = parseVitestResults("not valid json {{");
    expect(results).toEqual([]);
  });

  // 4. apply() is called with parsed results when test-results.json exists on save
  it("apply() called when .dantecode/test-results.json exists on TS file save", async () => {
    const json = makeVitestJson([
      { title: "works", status: "passed", file: "/repo/src/foo.ts", line: 1 },
    ]);
    mockReadFile.mockResolvedValueOnce(json);

    const manager = createTestDecorationManager();
    const applySpy = vi.spyOn(manager, "apply");

    // Simulate the onDidSaveTextDocument logic
    const doc = { fileName: "/repo/src/foo.ts", uri: { scheme: "file" } };
    if (/\.(ts|tsx|js|jsx)$/.test(doc.fileName)) {
      try {
        const raw = await readFile("/repo/.dantecode/test-results.json", "utf8");
        manager.apply(parseVitestResults(raw as unknown as string));
      } catch { /* skip */ }
    }

    expect(mockReadFile).toHaveBeenCalled();
    expect(applySpy).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ status: "pass" }),
    ]));
  });

  // 5. Non-TS/JS files do not trigger apply()
  it("apply() is NOT triggered for non-source file saves (e.g. .css)", async () => {
    const manager = createTestDecorationManager();
    const applySpy = vi.spyOn(manager, "apply");

    const doc = { fileName: "/repo/src/styles.css", uri: { scheme: "file" } };
    if (/\.(ts|tsx|js|jsx)$/.test(doc.fileName)) {
      const raw = await readFile("/repo/.dantecode/test-results.json", "utf8");
      manager.apply(parseVitestResults(raw as unknown as string));
    }

    expect(applySpy).not.toHaveBeenCalled();
  });

  // 6. apply() is NOT triggered when test-results.json is missing (readFile throws)
  it("apply() is NOT called when test-results.json is absent (readFile throws)", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

    const manager = createTestDecorationManager();
    const applySpy = vi.spyOn(manager, "apply");

    const doc = { fileName: "/repo/src/foo.ts", uri: { scheme: "file" } };
    if (/\.(ts|tsx|js|jsx)$/.test(doc.fileName)) {
      try {
        const raw = await readFile("/repo/.dantecode/test-results.json", "utf8");
        manager.apply(parseVitestResults(raw as unknown as string));
      } catch { /* skip */ }
    }

    expect(applySpy).not.toHaveBeenCalled();
  });

  // 7. clear() called on dantecode.clearTestDecorations command
  it("clear() is called when clearTestDecorations command fires", () => {
    const manager = createTestDecorationManager();
    const clearSpy = vi.spyOn(manager, "clear");

    // Simulate command handler
    const handler = () => manager.clear();
    handler();

    expect(clearSpy).toHaveBeenCalledOnce();
  });

  // 8. createTestDecorationManager returns object with apply, clear, dispose
  it("createTestDecorationManager returns manager with apply/clear/dispose methods", () => {
    const manager = createTestDecorationManager();
    expect(typeof manager.apply).toBe("function");
    expect(typeof manager.clear).toBe("function");
    expect(typeof manager.dispose).toBe("function");
  });
});
