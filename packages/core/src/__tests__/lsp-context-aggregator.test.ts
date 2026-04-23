// packages/core/src/__tests__/lsp-context-aggregator.test.ts
import { describe, it, expect } from "vitest";
import {
  groupDiagnosticsByFile,
  countDiagnosticsBySeverity,
  getErrorFiles,
  formatHoverInfo,
  formatReferences,
  formatFileSymbols,
  buildLspSnapshot,
  formatLspContextForPrompt,
  filterDiagnosticsBySeverity,
  getHighestSeverityDiagnostic,
  hasBlockingErrors,
  type LspDiagnostic,
  type HoverInfo,
  type SymbolReference,
  type SymbolDefinition,
} from "../lsp-context-aggregator.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDiag(overrides: Partial<LspDiagnostic> = {}): LspDiagnostic {
  return {
    filePath: "src/index.ts",
    line: 10,
    col: 5,
    severity: "error",
    message: "Type mismatch",
    source: "tsc",
    ...overrides,
  };
}

function makeHover(overrides: Partial<HoverInfo> = {}): HoverInfo {
  return {
    filePath: "src/index.ts",
    line: 10,
    col: 5,
    symbolName: "parseGitLog",
    symbolKind: "function",
    typeSignature: "(raw: string) => Change[]",
    documentation: "Parse git log output into change entries.",
    ...overrides,
  };
}

function makeRef(overrides: Partial<SymbolReference> = {}): SymbolReference {
  return {
    filePath: "src/index.ts",
    line: 42,
    col: 3,
    context: "captureGitContext",
    ...overrides,
  };
}

function makeDef(overrides: Partial<SymbolDefinition> = {}): SymbolDefinition {
  return {
    filePath: "src/git.ts",
    line: 10,
    col: 0,
    name: "parseGitLog",
    kind: "function",
    containerName: "GitModule",
    ...overrides,
  };
}

// ─── groupDiagnosticsByFile ───────────────────────────────────────────────────

describe("groupDiagnosticsByFile", () => {
  it("groups diagnostics by filePath", () => {
    const diags = [
      makeDiag({ filePath: "a.ts", severity: "error" }),
      makeDiag({ filePath: "b.ts", severity: "warning" }),
      makeDiag({ filePath: "a.ts", severity: "warning" }),
    ];
    const result = groupDiagnosticsByFile(diags);
    expect(result.has("a.ts")).toBe(true);
    expect(result.get("a.ts")!.length).toBe(2);
    expect(result.has("b.ts")).toBe(true);
  });

  it("sorts each file's diags by severity descending", () => {
    const diags = [
      makeDiag({ filePath: "a.ts", severity: "hint", line: 1 }),
      makeDiag({ filePath: "a.ts", severity: "error", line: 2 }),
    ];
    const result = groupDiagnosticsByFile(diags);
    expect(result.get("a.ts")![0]!.severity).toBe("error");
  });

  it("caps per file at maxDiagnosticsPerFile", () => {
    const diags = Array.from({ length: 20 }, (_, i) => makeDiag({ line: i + 1 }));
    const result = groupDiagnosticsByFile(diags, { maxDiagnosticsPerFile: 5 });
    expect(result.get("src/index.ts")!.length).toBe(5);
  });

  it("filters below minSeverity", () => {
    const diags = [
      makeDiag({ severity: "hint" }),
      makeDiag({ severity: "error" }),
    ];
    const result = groupDiagnosticsByFile(diags, { minSeverity: "warning" });
    expect(result.get("src/index.ts")!.length).toBe(1);
    expect(result.get("src/index.ts")![0]!.severity).toBe("error");
  });

  it("returns empty map for empty input", () => {
    expect(groupDiagnosticsByFile([]).size).toBe(0);
  });
});

// ─── countDiagnosticsBySeverity ───────────────────────────────────────────────

describe("countDiagnosticsBySeverity", () => {
  it("counts each severity correctly", () => {
    const diags = [
      makeDiag({ severity: "error" }),
      makeDiag({ severity: "error" }),
      makeDiag({ severity: "warning" }),
      makeDiag({ severity: "info" }),
    ];
    const counts = countDiagnosticsBySeverity(diags);
    expect(counts.error).toBe(2);
    expect(counts.warning).toBe(1);
    expect(counts.info).toBe(1);
    expect(counts.hint).toBe(0);
  });

  it("returns all zeros for empty input", () => {
    const counts = countDiagnosticsBySeverity([]);
    expect(counts.error).toBe(0);
    expect(counts.warning).toBe(0);
  });
});

// ─── getErrorFiles ────────────────────────────────────────────────────────────

describe("getErrorFiles", () => {
  it("returns files with error diagnostics", () => {
    const diags = [
      makeDiag({ filePath: "a.ts", severity: "error" }),
      makeDiag({ filePath: "b.ts", severity: "warning" }),
    ];
    expect(getErrorFiles(diags)).toContain("a.ts");
    expect(getErrorFiles(diags)).not.toContain("b.ts");
  });

  it("deduplicates files with multiple errors", () => {
    const diags = [
      makeDiag({ filePath: "a.ts", severity: "error" }),
      makeDiag({ filePath: "a.ts", severity: "error" }),
    ];
    expect(getErrorFiles(diags).filter((f) => f === "a.ts").length).toBe(1);
  });
});

// ─── formatHoverInfo ──────────────────────────────────────────────────────────

describe("formatHoverInfo", () => {
  it("includes symbol name and kind", () => {
    const result = formatHoverInfo(makeHover());
    expect(result).toContain("parseGitLog");
    expect(result).toContain("function");
  });

  it("includes type signature", () => {
    const result = formatHoverInfo(makeHover());
    expect(result).toContain("(raw: string) => Change[]");
  });

  it("includes first line of documentation when includeDoc=true", () => {
    const result = formatHoverInfo(makeHover(), true);
    expect(result).toContain("Parse git log output");
  });

  it("excludes documentation when includeDoc=false", () => {
    const result = formatHoverInfo(makeHover(), false);
    expect(result).not.toContain("Parse git log output");
  });

  it("includes file location", () => {
    const result = formatHoverInfo(makeHover({ filePath: "src/git.ts", line: 42, col: 8 }));
    expect(result).toContain("src/git.ts:42:8");
  });
});

// ─── formatReferences ────────────────────────────────────────────────────────

describe("formatReferences", () => {
  it("returns no-references message for empty array", () => {
    expect(formatReferences([], "parseGitLog", 5)).toContain("No references");
  });

  it("includes reference file paths", () => {
    const refs = [makeRef({ filePath: "src/a.ts" }), makeRef({ filePath: "src/b.ts" })];
    const result = formatReferences(refs, "parseGitLog", 10);
    expect(result).toContain("src/a.ts");
    expect(result).toContain("src/b.ts");
  });

  it("shows total count in header", () => {
    const refs = Array.from({ length: 5 }, (_, i) => makeRef({ line: i + 1 }));
    const result = formatReferences(refs, "fn", 3);
    expect(result).toContain("5 total");
    expect(result).toContain("showing 3");
  });

  it("includes context when present", () => {
    const result = formatReferences([makeRef({ context: "myFunction" })], "sym", 5);
    expect(result).toContain("myFunction");
  });
});

// ─── formatFileSymbols ────────────────────────────────────────────────────────

describe("formatFileSymbols", () => {
  it("returns no-symbols message for empty array", () => {
    expect(formatFileSymbols([], 10)).toContain("No symbols");
  });

  it("includes symbol names", () => {
    const syms = [makeDef({ name: "MyClass", kind: "class" })];
    const result = formatFileSymbols(syms, 10);
    expect(result).toContain("MyClass");
    expect(result).toContain("class");
  });

  it("shows '... and N more' when capped", () => {
    const syms = Array.from({ length: 5 }, (_, i) => makeDef({ name: `fn${i}` }));
    const result = formatFileSymbols(syms, 3);
    expect(result).toContain("2 more");
  });
});

// ─── buildLspSnapshot ────────────────────────────────────────────────────────

describe("buildLspSnapshot", () => {
  it("builds snapshot with all fields", () => {
    const snapshot = buildLspSnapshot({
      diagnostics: [makeDiag()],
      hoverInfos: [makeHover()],
      references: [makeRef()],
      definition: makeDef(),
      fileSymbols: [makeDef()],
      workspaceSymbolCount: 1000,
    });
    expect(snapshot.diagnosticsByFile.size).toBeGreaterThan(0);
    expect(snapshot.hoverInfos.length).toBe(1);
    expect(snapshot.references.length).toBe(1);
    expect(snapshot.definition).toBeDefined();
    expect(snapshot.fileSymbols.length).toBe(1);
    expect(snapshot.workspaceSymbolCount).toBe(1000);
    expect(snapshot.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("handles empty input gracefully", () => {
    const snapshot = buildLspSnapshot({});
    expect(snapshot.diagnosticsByFile.size).toBe(0);
    expect(snapshot.hoverInfos).toEqual([]);
    expect(snapshot.references).toEqual([]);
  });
});

// ─── formatLspContextForPrompt ────────────────────────────────────────────────

describe("formatLspContextForPrompt", () => {
  it("includes '## LSP Context' header", () => {
    const snapshot = buildLspSnapshot({});
    expect(formatLspContextForPrompt(snapshot)).toContain("## LSP Context");
  });

  it("shows 'No issues' when no diagnostics", () => {
    const snapshot = buildLspSnapshot({});
    expect(formatLspContextForPrompt(snapshot)).toContain("No issues");
  });

  it("shows diagnostic severity icons", () => {
    const snapshot = buildLspSnapshot({ diagnostics: [makeDiag({ severity: "error" })] });
    expect(formatLspContextForPrompt(snapshot)).toContain("✗");
  });

  it("shows warning icon for warning diagnostics", () => {
    const snapshot = buildLspSnapshot({ diagnostics: [makeDiag({ severity: "warning" })] });
    expect(formatLspContextForPrompt(snapshot)).toContain("⚠");
  });

  it("includes hover symbol name", () => {
    const snapshot = buildLspSnapshot({ hoverInfos: [makeHover()] });
    expect(formatLspContextForPrompt(snapshot)).toContain("parseGitLog");
  });

  it("includes definition info", () => {
    const snapshot = buildLspSnapshot({ definition: makeDef() });
    const result = formatLspContextForPrompt(snapshot);
    expect(result).toContain("parseGitLog");
    expect(result).toContain("src/git.ts");
  });

  it("truncates at maxContextChars", () => {
    const manyDiags = Array.from({ length: 100 }, (_, i) => makeDiag({ message: "x".repeat(100), line: i + 1 }));
    const snapshot = buildLspSnapshot({ diagnostics: manyDiags });
    const result = formatLspContextForPrompt(snapshot, { maxContextChars: 200 });
    expect(result.length).toBeLessThanOrEqual(220);
    expect(result).toContain("truncated");
  });
});

// ─── filterDiagnosticsBySeverity ─────────────────────────────────────────────

describe("filterDiagnosticsBySeverity", () => {
  it("keeps diagnostics at or above minSeverity", () => {
    const diags = [
      makeDiag({ severity: "error" }),
      makeDiag({ severity: "warning" }),
      makeDiag({ severity: "hint" }),
    ];
    const result = filterDiagnosticsBySeverity(diags, "warning");
    expect(result.some((d) => d.severity === "error")).toBe(true);
    expect(result.some((d) => d.severity === "warning")).toBe(true);
    expect(result.some((d) => d.severity === "hint")).toBe(false);
  });

  it("returns empty array when none meet threshold", () => {
    const diags = [makeDiag({ severity: "hint" })];
    expect(filterDiagnosticsBySeverity(diags, "error")).toHaveLength(0);
  });
});

// ─── getHighestSeverityDiagnostic ────────────────────────────────────────────

describe("getHighestSeverityDiagnostic", () => {
  it("returns the error when mixed severities", () => {
    const diags = [makeDiag({ severity: "hint" }), makeDiag({ severity: "error" }), makeDiag({ severity: "warning" })];
    expect(getHighestSeverityDiagnostic(diags)!.severity).toBe("error");
  });

  it("returns undefined for empty input", () => {
    expect(getHighestSeverityDiagnostic([])).toBeUndefined();
  });
});

// ─── hasBlockingErrors ────────────────────────────────────────────────────────

describe("hasBlockingErrors", () => {
  it("returns true when any error exists", () => {
    expect(hasBlockingErrors([makeDiag({ severity: "error" })])).toBe(true);
  });

  it("returns false for warnings only", () => {
    expect(hasBlockingErrors([makeDiag({ severity: "warning" })])).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(hasBlockingErrors([])).toBe(false);
  });
});
