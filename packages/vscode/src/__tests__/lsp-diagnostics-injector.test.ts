// packages/vscode/src/__tests__/lsp-diagnostics-injector.test.ts
import { describe, it, expect } from "vitest";
import { LspDiagnosticsInjector, createNullInjector } from "../lsp-diagnostics-injector.js";

// Mock vscode API
function makeRange(startLine: number, startChar: number) {
  return {
    start: { line: startLine, character: startChar },
    end: { line: startLine, character: startChar + 10 },
  };
}

function makeDiag(message: string, severity: number, source?: string, code?: string) {
  return { message, severity, source, code, range: makeRange(5, 0) };
}

function makeVscodeMock(entries: Array<[string, ReturnType<typeof makeDiag>[]]>) {
  return {
    languages: {
      getDiagnostics: () =>
        entries.map(([uriStr, diags]) => [
          { toString: () => uriStr, fsPath: uriStr.replace("file://", "") },
          diags,
        ]),
    },
  };
}

describe("LspDiagnosticsInjector.snapshot", () => {
  it("returns empty snapshot when no diagnostics", async () => {
    const vscode = makeVscodeMock([]);
    const injector = new LspDiagnosticsInjector(vscode as never);
    const snap = await injector.snapshot("file:///src/app.ts");
    expect(snap.current).toHaveLength(0);
    expect(snap.related).toHaveLength(0);
    expect(snap.totalErrors).toBe(0);
  });

  it("puts current file diagnostics in current array", async () => {
    const currentUri = "file:///src/app.ts";
    const vscode = makeVscodeMock([
      [currentUri, [makeDiag("Type error", 0, "ts")]],
    ]);
    const injector = new LspDiagnosticsInjector(vscode as never);
    const snap = await injector.snapshot(currentUri);
    expect(snap.current).toHaveLength(1);
    expect(snap.current[0]!.message).toBe("Type error");
  });

  it("puts other file errors in related array", async () => {
    const currentUri = "file:///src/app.ts";
    const otherUri = "file:///src/utils.ts";
    const vscode = makeVscodeMock([
      [otherUri, [makeDiag("Missing export", 0, "ts")]],
    ]);
    const injector = new LspDiagnosticsInjector(vscode as never);
    const snap = await injector.snapshot(currentUri);
    expect(snap.related).toHaveLength(1);
    expect(snap.current).toHaveLength(0);
  });

  it("counts total errors and warnings correctly", async () => {
    const vscode = makeVscodeMock([
      ["file:///a.ts", [makeDiag("err", 0), makeDiag("warn", 1), makeDiag("err2", 0)]],
    ]);
    const injector = new LspDiagnosticsInjector(vscode as never);
    const snap = await injector.snapshot("file:///other.ts");
    expect(snap.totalErrors).toBe(2);
    expect(snap.totalWarnings).toBe(1);
  });

  it("respects maxDiagnostics cap", async () => {
    const diags = Array.from({ length: 30 }, (_, i) => makeDiag(`Error ${i}`, 0));
    const currentUri = "file:///src/app.ts";
    const vscode = makeVscodeMock([[currentUri, diags]]);
    const injector = new LspDiagnosticsInjector(vscode as never, { maxDiagnostics: 10 });
    const snap = await injector.snapshot(currentUri);
    expect(snap.current.length).toBeLessThanOrEqual(10);
  });

  it("filters out info/hints when minSeverity=warning", async () => {
    const currentUri = "file:///src/app.ts";
    const vscode = makeVscodeMock([
      [currentUri, [
        makeDiag("Info message", 2),  // info
        makeDiag("Hint message", 3),  // hint
        makeDiag("Warning", 1),        // warning — should pass
      ]],
    ]);
    const injector = new LspDiagnosticsInjector(vscode as never, { minSeverity: "warning" });
    const snap = await injector.snapshot(currentUri);
    expect(snap.current).toHaveLength(1);
    expect(snap.current[0]!.message).toBe("Warning");
  });

  it("converts line numbers to 1-indexed", async () => {
    const currentUri = "file:///src/app.ts";
    const vscode = makeVscodeMock([
      [currentUri, [makeDiag("err", 0)]],
    ]);
    const injector = new LspDiagnosticsInjector(vscode as never);
    const snap = await injector.snapshot(currentUri);
    expect(snap.current[0]!.line).toBe(6); // makeRange(5, 0) → line 5 → 1-indexed = 6
  });
});

describe("LspDiagnosticsInjector.formatForContext", () => {
  it("returns empty string for empty snapshot", async () => {
    const vscode = makeVscodeMock([]);
    const injector = new LspDiagnosticsInjector(vscode as never);
    const snap = await injector.snapshot("file:///app.ts");
    expect(injector.formatForContext(snap)).toBe("");
  });

  it("includes Active Diagnostics header", async () => {
    const currentUri = "file:///src/app.ts";
    const vscode = makeVscodeMock([
      [currentUri, [makeDiag("Type mismatch", 0, "ts")]],
    ]);
    const injector = new LspDiagnosticsInjector(vscode as never);
    const snap = await injector.snapshot(currentUri);
    const formatted = injector.formatForContext(snap);
    expect(formatted).toContain("Active Diagnostics");
    expect(formatted).toContain("Type mismatch");
  });

  it("includes line numbers", async () => {
    const currentUri = "file:///src/app.ts";
    const vscode = makeVscodeMock([
      [currentUri, [makeDiag("err", 0, "ts")]],
    ]);
    const injector = new LspDiagnosticsInjector(vscode as never);
    const snap = await injector.snapshot(currentUri);
    const formatted = injector.formatForContext(snap);
    expect(formatted).toContain("L6"); // makeRange(5, 0) → line 6 (1-indexed)
  });
});

describe("LspDiagnosticsInjector.hasErrors", () => {
  it("returns true when totalErrors > 0", () => {
    const vscode = makeVscodeMock([]);
    const injector = new LspDiagnosticsInjector(vscode as never);
    const snap = { current: [], related: [], totalErrors: 3, totalWarnings: 0, capturedAt: "" };
    expect(injector.hasErrors(snap)).toBe(true);
  });

  it("returns false when no errors", () => {
    const vscode = makeVscodeMock([]);
    const injector = new LspDiagnosticsInjector(vscode as never);
    const snap = { current: [], related: [], totalErrors: 0, totalWarnings: 2, capturedAt: "" };
    expect(injector.hasErrors(snap)).toBe(false);
  });
});

describe("createNullInjector", () => {
  it("returns empty snapshot", async () => {
    const injector = createNullInjector();
    const snap = await injector.snapshot("any:///uri");
    expect(snap.current).toHaveLength(0);
    expect(snap.totalErrors).toBe(0);
  });

  it("returns empty string from formatForContext", async () => {
    const injector = createNullInjector();
    const snap = await injector.snapshot("any:///uri");
    expect(injector.formatForContext(snap)).toBe("");
  });

  it("returns false from hasErrors", async () => {
    const injector = createNullInjector();
    const snap = await injector.snapshot("any:///uri");
    expect(injector.hasErrors(snap)).toBe(false);
  });
});
