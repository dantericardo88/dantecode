import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Minimal vscode mock — only what test-decoration-manager imports
// ---------------------------------------------------------------------------

const mockPassDispose = vi.fn();
const mockFailDispose = vi.fn();
const mockSkipDispose = vi.fn();

let decorationTypeCallCount = 0;
const decorationTypeDisposeFns = [mockPassDispose, mockFailDispose, mockSkipDispose];

const mockSetDecorations = vi.fn();

vi.mock("vscode", () => ({
  window: {
    createTextEditorDecorationType: vi.fn().mockImplementation(() => {
      const dispose = decorationTypeDisposeFns[decorationTypeCallCount % 3];
      decorationTypeCallCount++;
      return { dispose };
    }),
    get visibleTextEditors() {
      return mockVisibleEditors;
    },
  },
  Uri: { parse: vi.fn((s: string) => ({ toString: () => s })) },
  Range: vi.fn().mockImplementation((sl: number, sc: number, el: number, ec: number) => ({
    sl,
    sc,
    el,
    ec,
  })),
  MarkdownString: vi.fn().mockImplementation((s: string) => ({ value: s })),
  OverviewRulerLane: { Right: 2 },
}));

// Mutable list of visible editors for tests
let mockVisibleEditors: Array<{
  document: { uri: { fsPath: string } };
  setDecorations: typeof mockSetDecorations;
}> = [];

import { createTestDecorationManager, parseVitestResults } from "../test-decoration-manager.js";

beforeEach(() => {
  vi.clearAllMocks();
  decorationTypeCallCount = 0;
  mockVisibleEditors = [];
});

// ─── createTestDecorationManager ─────────────────────────────────────────────

describe("createTestDecorationManager", () => {
  it("returns object with apply, clear, and dispose methods", () => {
    const mgr = createTestDecorationManager();
    expect(mgr).toHaveProperty("apply");
    expect(mgr).toHaveProperty("clear");
    expect(mgr).toHaveProperty("dispose");
    expect(typeof mgr.apply).toBe("function");
    expect(typeof mgr.clear).toBe("function");
    expect(typeof mgr.dispose).toBe("function");
    mgr.dispose();
  });

  it("dispose() calls dispose on all three decoration types", () => {
    const mgr = createTestDecorationManager();
    mgr.dispose();
    expect(mockPassDispose).toHaveBeenCalledTimes(1);
    expect(mockFailDispose).toHaveBeenCalledTimes(1);
    expect(mockSkipDispose).toHaveBeenCalledTimes(1);
  });

  it("clear() calls setDecorations with empty arrays on visible editors", () => {
    const editorSetDecorations = vi.fn();
    mockVisibleEditors = [
      {
        document: { uri: { fsPath: "/some/file.ts" } },
        setDecorations: editorSetDecorations,
      },
    ];

    const mgr = createTestDecorationManager();
    mgr.clear();

    // setDecorations called 3 times (pass, fail, skip) with empty arrays
    expect(editorSetDecorations).toHaveBeenCalledTimes(3);
    for (const call of editorSetDecorations.mock.calls) {
      expect(call[1]).toEqual([]);
    }
    mgr.dispose();
  });
});

// ─── parseVitestResults ───────────────────────────────────────────────────────

describe("parseVitestResults", () => {
  const validJson = JSON.stringify({
    testResults: [
      {
        testFilePath: "/project/src/foo.test.ts",
        assertionResults: [
          {
            title: "should work",
            status: "passed",
            location: { line: 5 },
            failureMessages: [],
          },
          {
            title: "should fail",
            status: "failed",
            location: { line: 10 },
            failureMessages: ["Expected 1 to be 2"],
          },
          {
            title: "should skip",
            status: "pending",
            location: { line: 15 },
            failureMessages: [],
          },
        ],
      },
    ],
  });

  it("returns correct TestResult array from valid JSON", () => {
    const results = parseVitestResults(validJson);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      filePath: "/project/src/foo.test.ts",
      name: "should work",
      status: "pass",
    });
    expect(results[1]).toMatchObject({
      filePath: "/project/src/foo.test.ts",
      name: "should fail",
      status: "fail",
      message: "Expected 1 to be 2",
    });
    expect(results[2]).toMatchObject({
      filePath: "/project/src/foo.test.ts",
      name: "should skip",
      status: "skip",
    });
  });

  it("converts 1-indexed line numbers to 0-indexed", () => {
    const results = parseVitestResults(validJson);
    const [r0, r1, r2] = results;
    // location.line=5 → result.line=4
    expect(r0!.line).toBe(4);
    // location.line=10 → result.line=9
    expect(r1!.line).toBe(9);
    // location.line=15 → result.line=14
    expect(r2!.line).toBe(14);
  });

  it('maps "passed"→"pass", "failed"→"fail", "pending"→"skip"', () => {
    const results = parseVitestResults(validJson);
    const [r0, r1, r2] = results;
    expect(r0!.status).toBe("pass");
    expect(r1!.status).toBe("fail");
    expect(r2!.status).toBe("skip");
  });

  it("returns empty array for empty string without throwing", () => {
    expect(() => parseVitestResults("")).not.toThrow();
    expect(parseVitestResults("")).toEqual([]);
  });

  it("returns empty array for non-JSON string without throwing", () => {
    expect(() => parseVitestResults("not json")).not.toThrow();
    expect(parseVitestResults("not json")).toEqual([]);
  });

  it("uses line 0 when location is missing (clamps to 0)", () => {
    const noLocation = JSON.stringify({
      testResults: [
        {
          testFilePath: "/project/src/bar.test.ts",
          assertionResults: [
            { title: "no location test", status: "passed", failureMessages: [] },
          ],
        },
      ],
    });
    const results = parseVitestResults(noLocation);
    expect(results[0]!.line).toBe(0); // (1 - 1) = 0, clamped by Math.max(0, ...)
  });
});
