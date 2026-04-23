// ============================================================================
// packages/core/src/__tests__/tree-sitter-engine.test.ts
//
// Unit tests for the tree-sitter AST engine.
// web-tree-sitter is mocked (WASM not available in unit test environments).
// parser-pool is mocked at module level to bypass WASM resolution.
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock parser-pool to bypass WASM resolution entirely ─────────────────────
// The mock exposes a controlled parser whose captures() output we can steer.

const mockCaptures: Array<{ name: string; node: { text: string; startPosition: { row: number } } }> =
  [
    {
      name: "name.definition.function",
      node: { text: "myFunc", startPosition: { row: 5 } },
    },
    {
      name: "name.reference.call",
      node: { text: "helperFn", startPosition: { row: 10 } },
    },
  ];

const mockCapturesFn = vi.fn().mockReturnValue(mockCaptures);
const mockQuery = { captures: mockCapturesFn };
const mockLanguage = { query: vi.fn().mockReturnValue(mockQuery) };
const mockParseFn = vi.fn().mockReturnValue({ rootNode: {} });
const mockGetLanguageFn = vi.fn().mockReturnValue(mockLanguage);
const mockSetLanguageFn = vi.fn();

const mockParserInstance = {
  parse: mockParseFn,
  getLanguage: mockGetLanguageFn,
  setLanguage: mockSetLanguageFn,
};

const MockParserConstructor = vi.fn().mockImplementation(() => mockParserInstance);

vi.mock("../tree-sitter/parser-pool.js", () => {
  const _pool = new Map<string, typeof mockParserInstance>();
  let _callCount = 0;

  return {
    getParser: vi.fn(async (language: string) => {
      if (_pool.has(language)) {
        return _pool.get(language)!;
      }
      _callCount++;
      MockParserConstructor();
      const inst = mockParserInstance;
      _pool.set(language, inst);
      return inst;
    }),
    resetParserPool: vi.fn(() => {
      _pool.clear();
      _callCount = 0;
      MockParserConstructor.mockClear();
    }),
    __getCallCount: () => _callCount,
    __getPool: () => _pool,
  };
});

// ── Now import the modules under test ────────────────────────────────────────
import {
  extractTagsAST,
  detectTreeSitterLanguage,
} from "../tree-sitter/index.js";
import { resetParserPool } from "../tree-sitter/parser-pool.js";
import { extractSymbolDefinitions } from "../repo-map-ast.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContent(bytes: number): string {
  return "x".repeat(bytes);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("tree-sitter-engine", () => {
  beforeEach(() => {
    // Reset capture mock defaults and pool state
    mockCapturesFn.mockReturnValue(mockCaptures);
    mockParseFn.mockReturnValue({ rootNode: {} });
    MockParserConstructor.mockClear();
    resetParserPool();
    vi.clearAllMocks();
    // Re-apply defaults after clearAllMocks
    mockCapturesFn.mockReturnValue(mockCaptures);
    mockParseFn.mockReturnValue({ rootNode: {} });
    mockGetLanguageFn.mockReturnValue(mockLanguage);
    (mockLanguage.query as ReturnType<typeof vi.fn>).mockReturnValue(mockQuery);
  });

  // 1. extractTagsAST returns def tags for name.definition.* captures
  it("returns def tags for name.definition.* captures", async () => {
    const tags = await extractTagsAST("function myFunc() {}", "typescript", "a.ts");
    const defTag = tags.find((t) => t.kind === "def" && t.name === "myFunc");
    expect(defTag).toBeDefined();
    expect(defTag?.kind).toBe("def");
    expect(defTag?.name).toBe("myFunc");
  });

  // 2. Returns ref tags for name.reference.* captures
  it("returns ref tags for name.reference.* captures", async () => {
    const tags = await extractTagsAST("helperFn();", "typescript", "a.ts");
    const refTag = tags.find((t) => t.kind === "ref" && t.name === "helperFn");
    expect(refTag).toBeDefined();
    expect(refTag?.kind).toBe("ref");
  });

  // 3. Returns [] for unsupported language (no SCM query)
  it("returns [] for unsupported language", async () => {
    const tags = await extractTagsAST("some code", "cobol", "a.cob");
    expect(tags).toEqual([]);
  });

  // 4. Returns [] for empty content
  it("returns [] for empty content", async () => {
    const tags = await extractTagsAST("   ", "typescript", "a.ts");
    expect(tags).toEqual([]);
  });

  // 5. defKind correctly set from capture suffix — class
  it("sets defKind to 'class' for name.definition.class capture", async () => {
    mockCapturesFn.mockReturnValue([
      {
        name: "name.definition.class",
        node: { text: "MyClass", startPosition: { row: 3 } },
      },
    ]);

    const tags = await extractTagsAST("class MyClass {}", "typescript", "a.ts");
    const classTag = tags.find((t) => t.name === "MyClass");
    expect(classTag).toBeDefined();
    expect(classTag?.defKind).toBe("class");
  });

  // 6. defKind set to 'function' for name.definition.function
  it("sets defKind to 'function' for name.definition.function capture", async () => {
    mockCapturesFn.mockReturnValue([
      {
        name: "name.definition.function",
        node: { text: "doWork", startPosition: { row: 1 } },
      },
    ]);

    const tags = await extractTagsAST("function doWork() {}", "typescript", "a.ts");
    const fnTag = tags.find((t) => t.name === "doWork");
    expect(fnTag).toBeDefined();
    expect(fnTag?.defKind).toBe("function");
  });

  // 7. line is 0-indexed (from node.startPosition.row)
  it("sets line to 0-indexed row from startPosition", async () => {
    mockCapturesFn.mockReturnValue([
      {
        name: "name.definition.function",
        node: { text: "lineCheck", startPosition: { row: 7 } },
      },
    ]);

    const tags = await extractTagsAST("function lineCheck() {}", "typescript", "a.ts");
    const tag = tags.find((t) => t.name === "lineCheck");
    expect(tag?.line).toBe(7); // 0-indexed
  });

  // 8. Parser pool: second call for same language returns cached parser (constructor called only once)
  it("caches parser per language — constructor called only once for repeated calls", async () => {
    // First call
    await extractTagsAST("function a() {}", "typescript", "a.ts");
    // Second call — same language
    await extractTagsAST("function b() {}", "typescript", "b.ts");

    // MockParserConstructor was only called once (pool hit on second call)
    expect(MockParserConstructor).toHaveBeenCalledTimes(1);
  });

  // 9. Files > 500KB return [] without parsing
  it("returns [] for content exceeding 500KB without calling parse", async () => {
    const bigContent = makeContent(512_001);
    mockParseFn.mockClear();

    const tags = await extractTagsAST(bigContent, "typescript", "huge.ts");

    expect(tags).toEqual([]);
    expect(mockParseFn).not.toHaveBeenCalled();
  });

  // 10. detectTreeSitterLanguage(".ts") returns "typescript"
  it('detectTreeSitterLanguage(".ts") returns "typescript"', () => {
    expect(detectTreeSitterLanguage("foo.ts")).toBe("typescript");
  });

  // 11. detectTreeSitterLanguage(".py") returns "python"
  it('detectTreeSitterLanguage(".py") returns "python"', () => {
    expect(detectTreeSitterLanguage("bar.py")).toBe("python");
  });

  // 12. detectTreeSitterLanguage(".xyz") returns undefined
  it('detectTreeSitterLanguage(".xyz") returns undefined', () => {
    expect(detectTreeSitterLanguage("foo.xyz")).toBeUndefined();
  });
});

describe("extractSymbolDefinitions (async, via repo-map-ast)", () => {
  beforeEach(() => {
    mockCapturesFn.mockReturnValue(mockCaptures);
    mockParseFn.mockReturnValue({ rootNode: {} });
    mockGetLanguageFn.mockReturnValue(mockLanguage);
    (mockLanguage.query as ReturnType<typeof vi.fn>).mockReturnValue(mockQuery);
    resetParserPool();
  });

  it("returns SymbolDefinition[] with 1-indexed lines from AST def tags", async () => {
    mockCapturesFn.mockReturnValue([
      {
        name: "name.definition.function",
        node: { text: "myFunc", startPosition: { row: 5 } }, // 0-indexed row 5
      },
    ]);

    const content = Array.from({ length: 10 }, (_, i) => `// line ${i}`).join("\n");
    const symbols = await extractSymbolDefinitions(content, "service.ts");

    const sym = symbols.find((s) => s.name === "myFunc");
    expect(sym).toBeDefined();
    // repo-map-ast adds +1: row 5 → line 6
    expect(sym?.line).toBe(6);
    expect(sym?.kind).toBe("function");
  });
});
