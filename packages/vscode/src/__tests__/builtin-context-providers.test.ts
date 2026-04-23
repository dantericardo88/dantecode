// packages/vscode/src/__tests__/builtin-context-providers.test.ts
// 12 tests for CurrentFileProvider, OpenFilesProvider, ProblemsProvider, UrlProvider

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── VSCode mock ───────────────────────────────────────────────────────────────
// vi.mock factory is hoisted — cannot reference outer variables.
// Use vi.fn() inside factory; expose via _test property.

vi.mock("vscode", () => {
  const getDiagnostics = vi.fn(() => [] as Array<[unknown, unknown[]]>);
  const asRelativePath = vi.fn((uri: unknown) =>
    typeof uri === "string" ? uri : (uri as { fsPath: string }).fsPath,
  );

  return {
    window: {
      get activeTextEditor() {
        // Return the value stored on the _state singleton
        return (vscodeState as { activeTextEditor: unknown }).activeTextEditor;
      },
      get visibleTextEditors() {
        return (vscodeState as { visibleTextEditors: unknown[] }).visibleTextEditors;
      },
    },
    languages: { getDiagnostics },
    workspace: { asRelativePath },
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    },
    _test: { getDiagnostics, asRelativePath },
  };
});

// Mutable state object that the mock's getters read from.
// This object is defined OUTSIDE the factory so tests can mutate it.
const vscodeState: { activeTextEditor: unknown; visibleTextEditors: unknown[] } = {
  activeTextEditor: null,
  visibleTextEditors: [],
};

// Grab mock references after hoisting
import * as vscodeMod from "vscode";
const vscodeTest = (
  vscodeMod as unknown as {
    _test: {
      getDiagnostics: ReturnType<typeof vi.fn>;
      asRelativePath: ReturnType<typeof vi.fn>;
    };
  }
)._test;

// Mock @dantecode/core to stub searchHtmlToText
vi.mock("@dantecode/core", async () => {
  const actual = await vi.importActual<typeof import("@dantecode/core")>("@dantecode/core");
  return { ...actual, searchHtmlToText: vi.fn().mockReturnValue("extracted text") };
});

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  CurrentFileProvider,
  OpenFilesProvider,
  ProblemsProvider,
  UrlProvider,
} from "../context-providers/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEditor(fsPath: string, text: string, languageId = "typescript") {
  return {
    document: {
      uri: { fsPath },
      getText: () => text,
      languageId,
    },
    selection: { active: { line: 0, character: 0 } },
  };
}

function makeDiag(message: string, severity: number, line: number) {
  return {
    message,
    severity,
    range: { start: { line } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vscodeState.activeTextEditor = null;
  vscodeState.visibleTextEditors = [];
  vscodeTest.getDiagnostics.mockReturnValue([]);
  vscodeTest.asRelativePath.mockImplementation((uri: unknown) =>
    typeof uri === "string" ? uri : (uri as { fsPath: string }).fsPath,
  );
});

// ── CurrentFileProvider ───────────────────────────────────────────────────────

describe("CurrentFileProvider", () => {
  const provider = new CurrentFileProvider();

  it("returns content with language fence", async () => {
    vscodeState.activeTextEditor = makeEditor("/project/src/app.ts", "const x = 1;");
    vscodeTest.asRelativePath.mockReturnValue("src/app.ts");

    const items = await provider.getContextItems({ query: "", workspaceRoot: "/project" });
    expect(items).toHaveLength(1);
    expect(items[0]!.content).toContain("```typescript");
    expect(items[0]!.content).toContain("src/app.ts");
    expect(items[0]!.content).toContain("const x = 1;");
  });

  it("returns '(no active editor)' when no active editor", async () => {
    vscodeState.activeTextEditor = null;

    const items = await provider.getContextItems({ query: "", workspaceRoot: "/project" });
    expect(items).toHaveLength(1);
    expect(items[0]!.content).toBe("(no active editor)");
  });

  it("caps content at 8000 chars", async () => {
    const longText = "a".repeat(10000);
    vscodeState.activeTextEditor = makeEditor("/project/src/big.ts", longText);
    vscodeTest.asRelativePath.mockReturnValue("src/big.ts");

    const items = await provider.getContextItems({ query: "", workspaceRoot: "/project" });
    // The sliced portion is exactly 8000 "a" chars inside the fence
    const raw = items[0]!.content;
    expect(raw).toContain("a".repeat(8000));
    expect(raw).not.toContain("a".repeat(8001));
  });
});

// ── OpenFilesProvider ─────────────────────────────────────────────────────────

describe("OpenFilesProvider", () => {
  const provider = new OpenFilesProvider();

  it("returns all visible editor contents", async () => {
    vscodeState.visibleTextEditors = [
      makeEditor("/project/src/a.ts", "const a = 1;"),
      makeEditor("/project/src/b.ts", "const b = 2;"),
    ];

    const items = await provider.getContextItems({ query: "", workspaceRoot: "/project" });
    expect(items).toHaveLength(1);
    expect(items[0]!.content).toContain("const a = 1;");
    expect(items[0]!.content).toContain("const b = 2;");
  });

  it("returns '(no open editors)' when editors list is empty", async () => {
    vscodeState.visibleTextEditors = [];

    const items = await provider.getContextItems({ query: "", workspaceRoot: "/project" });
    expect(items).toHaveLength(1);
    expect(items[0]!.content).toBe("(no open editors)");
  });

  it("caps at 10 editors when given 15", async () => {
    vscodeState.visibleTextEditors = Array.from({ length: 15 }, (_, i) =>
      makeEditor(`/project/src/file${i}.ts`, `const v${i} = ${i};`),
    );

    const items = await provider.getContextItems({ query: "", workspaceRoot: "/project" });
    const content = items[0]!.content;
    // file9 should be included; file10 should not
    expect(content).toContain("file9");
    expect(content).not.toContain("file10");
  });
});

// ── ProblemsProvider ──────────────────────────────────────────────────────────

describe("ProblemsProvider", () => {
  const provider = new ProblemsProvider();

  it("includes errors with 'file:line' format", async () => {
    const uri = { fsPath: "/project/src/auth.ts" };
    vscodeTest.getDiagnostics.mockReturnValue([[uri, [makeDiag("Type error here", 0, 4)]]]);
    vscodeTest.asRelativePath.mockReturnValue("src/auth.ts");

    const items = await provider.getContextItems({ query: "", workspaceRoot: "/project" });
    expect(items[0]!.content).toContain("error:");
    expect(items[0]!.content).toContain("src/auth.ts:5");
    expect(items[0]!.content).toContain("Type error here");
  });

  it("returns '(no problems)' when getDiagnostics is empty", async () => {
    vscodeTest.getDiagnostics.mockReturnValue([]);

    const items = await provider.getContextItems({ query: "", workspaceRoot: "/project" });
    expect(items[0]!.content).toBe("(no problems)");
  });

  it("excludes Hint severity diagnostics", async () => {
    const uri = { fsPath: "/project/src/utils.ts" };
    // DiagnosticSeverity.Hint = 3 in our mock
    vscodeTest.getDiagnostics.mockReturnValue([[uri, [makeDiag("Just a hint", 3, 0)]]]);
    vscodeTest.asRelativePath.mockReturnValue("src/utils.ts");

    const items = await provider.getContextItems({ query: "", workspaceRoot: "/project" });
    expect(items[0]!.content).toBe("(no problems)");
  });
});

// ── UrlProvider ───────────────────────────────────────────────────────────────

describe("UrlProvider", () => {
  const provider = new UrlProvider();

  it("returns extracted text for a valid https:// URL", async () => {
    mockFetch.mockResolvedValueOnce({
      text: async () => "<html><body>Hello world</body></html>",
    });

    const items = await provider.getContextItems({
      query: "https://example.com",
      workspaceRoot: "/project",
    });
    expect(items).toHaveLength(1);
    // searchHtmlToText is mocked to return "extracted text"
    expect(items[0]!.content).toBe("extracted text");
    expect(items[0]!.name).toContain("https://example.com");
  });

  it("returns error message for non-https URL without calling fetch", async () => {
    const items = await provider.getContextItems({
      query: "http://insecure.example.com",
      workspaceRoot: "/project",
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.content).toContain("only https://");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── Shape check ───────────────────────────────────────────────────────────────

describe("All providers shape check", () => {
  it("all 4 providers have name and description string properties", () => {
    const providers = [
      new CurrentFileProvider(),
      new OpenFilesProvider(),
      new ProblemsProvider(),
      new UrlProvider(),
    ];
    for (const p of providers) {
      expect(typeof p.name).toBe("string");
      expect(p.name.length).toBeGreaterThan(0);
      expect(typeof p.description).toBe("string");
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});
