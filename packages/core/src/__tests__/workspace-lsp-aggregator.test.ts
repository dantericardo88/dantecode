// packages/core/src/__tests__/workspace-lsp-aggregator.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  makeSymbolDefinition,
  WorkspaceSymbolIndex,
  HoverAggregator,
  WorkspaceDiagnosticStore,
  severityRank,
  parseImports,
  WorkspaceLspAggregator,
  type SymbolDefinition,
  type HoverContext,
  type WorkspaceDiagnostic,
} from "../workspace-lsp-aggregator.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDef(name: string, filePath = "src/a.ts", isExported = false): SymbolDefinition {
  return makeSymbolDefinition(name, "function", filePath, { isExported });
}

function makeHover(filePath: string, symbolName: string, typeSignature?: string): HoverContext {
  return {
    filePath,
    position: { line: 0, character: 0 },
    symbolName,
    typeSignature,
    source: "test-provider",
  };
}

function makeDiag(filePath: string, severity: WorkspaceDiagnostic["severity"], message: string): WorkspaceDiagnostic {
  return {
    filePath,
    message,
    severity,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
  };
}

// ─── makeSymbolDefinition ─────────────────────────────────────────────────────

describe("makeSymbolDefinition", () => {
  it("creates definition with correct fields", () => {
    const def = makeSymbolDefinition("myFn", "function", "src/a.ts");
    expect(def.name).toBe("myFn");
    expect(def.kind).toBe("function");
    expect(def.filePath).toBe("src/a.ts");
    expect(def.isExported).toBe(false);
  });

  it("defaults qualifiedName to name", () => {
    const def = makeSymbolDefinition("foo", "class", "src/b.ts");
    expect(def.qualifiedName).toBe("foo");
  });

  it("accepts custom qualifiedName", () => {
    const def = makeSymbolDefinition("bar", "method", "src/c.ts", { qualifiedName: "MyClass.bar" });
    expect(def.qualifiedName).toBe("MyClass.bar");
  });
});

// ─── WorkspaceSymbolIndex ─────────────────────────────────────────────────────

describe("WorkspaceSymbolIndex", () => {
  let idx: WorkspaceSymbolIndex;

  beforeEach(() => { idx = new WorkspaceSymbolIndex(); });

  it("addDefinition and getDefinition by qualifiedName", () => {
    const def = makeDef("fetchUser");
    idx.addDefinition(def);
    expect(idx.getDefinition("fetchUser")).toBeDefined();
  });

  it("getDefinitionsInFile returns all defs for that file", () => {
    idx.addDefinition(makeDef("a", "src/x.ts"));
    idx.addDefinition(makeDef("b", "src/x.ts"));
    idx.addDefinition(makeDef("c", "src/y.ts"));
    expect(idx.getDefinitionsInFile("src/x.ts")).toHaveLength(2);
  });

  it("getReferencesInFile returns only refs for that file", () => {
    idx.addReference({ symbolName: "foo", filePath: "src/a.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } });
    idx.addReference({ symbolName: "bar", filePath: "src/b.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } });
    expect(idx.getReferencesInFile("src/a.ts")).toHaveLength(1);
  });

  it("getImportsFrom returns edges from that file", () => {
    idx.addImport({ fromFile: "src/a.ts", toFile: "src/b.ts", specifier: "./b", importedSymbols: ["foo"] });
    expect(idx.getImportsFrom("src/a.ts")).toHaveLength(1);
    expect(idx.getImportsFrom("src/b.ts")).toHaveLength(0);
  });

  it("getImportersOf returns files that import target", () => {
    idx.addImport({ fromFile: "src/a.ts", toFile: "src/utils.ts", specifier: "./utils", importedSymbols: [] });
    idx.addImport({ fromFile: "src/b.ts", toFile: "src/utils.ts", specifier: "./utils", importedSymbols: [] });
    expect(idx.getImportersOf("src/utils.ts")).toHaveLength(2);
  });

  it("getReachableDefinitions includes own + imported exported defs", () => {
    const ownDef = makeDef("ownFn", "src/a.ts");
    const exportedDef = makeSymbolDefinition("utilFn", "function", "src/utils.ts", { isExported: true });
    const unexportedDef = makeDef("hidden", "src/utils.ts", false);

    idx.addDefinition(ownDef);
    idx.addDefinition(exportedDef);
    idx.addDefinition(unexportedDef);
    idx.addImport({ fromFile: "src/a.ts", toFile: "src/utils.ts", specifier: "./utils", importedSymbols: [] });

    const reachable = idx.getReachableDefinitions("src/a.ts");
    expect(reachable.some((d) => d.name === "ownFn")).toBe(true);
    expect(reachable.some((d) => d.name === "utilFn")).toBe(true);
    expect(reachable.some((d) => d.name === "hidden")).toBe(false);
  });

  it("getReachableDefinitions deduplicates", () => {
    const def = makeSymbolDefinition("sharedFn", "function", "src/a.ts", { isExported: true });
    idx.addDefinition(def);
    idx.addImport({ fromFile: "src/a.ts", toFile: "src/a.ts", specifier: "./self", importedSymbols: [] });
    const reachable = idx.getReachableDefinitions("src/a.ts");
    const count = reachable.filter((d) => d.name === "sharedFn").length;
    expect(count).toBe(1);
  });

  it("findByName returns matching definitions", () => {
    // Use distinct qualifiedNames so both coexist in the Map
    const d1 = makeSymbolDefinition("parseUrl", "function", "src/a.ts", { qualifiedName: "a.parseUrl" });
    const d2 = makeSymbolDefinition("parseUrl", "function", "src/b.ts", { qualifiedName: "b.parseUrl" });
    idx.addDefinition(d1);
    idx.addDefinition(d2);
    expect(idx.findByName("parseUrl")).toHaveLength(2);
  });

  it("totalDefinitions returns correct count", () => {
    idx.addDefinition(makeDef("a"));
    idx.addDefinition(makeDef("b"));
    expect(idx.totalDefinitions).toBe(2);
  });

  it("clear empties the index", () => {
    idx.addDefinition(makeDef("a"));
    idx.clear();
    expect(idx.totalDefinitions).toBe(0);
  });
});

// ─── HoverAggregator ──────────────────────────────────────────────────────────

describe("HoverAggregator", () => {
  let agg: HoverAggregator;

  beforeEach(() => { agg = new HoverAggregator(); });

  it("addHover stores context", () => {
    agg.addHover(makeHover("src/a.ts", "myFn", "() => void"));
    expect(agg.count).toBe(1);
  });

  it("deduplicates by filePath + symbolName", () => {
    agg.addHover(makeHover("src/a.ts", "myFn"));
    agg.addHover(makeHover("src/a.ts", "myFn", "() => void"));
    expect(agg.count).toBe(1);
  });

  it("prefers hover with documentation when deduplicating", () => {
    agg.addHover(makeHover("src/a.ts", "myFn"));  // no doc
    agg.addHover(makeHover("src/a.ts", "myFn", "() => void"));  // has typeSignature
    const found = agg.getHoverForSymbol("src/a.ts", "myFn");
    expect(found?.typeSignature).toBe("() => void");
  });

  it("getHoversForFile returns only that file's hovers", () => {
    agg.addHover(makeHover("src/a.ts", "fn1"));
    agg.addHover(makeHover("src/b.ts", "fn2"));
    expect(agg.getHoversForFile("src/a.ts")).toHaveLength(1);
  });

  it("getHoverForSymbol returns undefined for unknown", () => {
    expect(agg.getHoverForSymbol("src/a.ts", "nonexistent")).toBeUndefined();
  });

  it("clear empties all hovers", () => {
    agg.addHover(makeHover("src/a.ts", "fn"));
    agg.clear();
    expect(agg.count).toBe(0);
  });
});

// ─── WorkspaceDiagnosticStore ─────────────────────────────────────────────────

describe("WorkspaceDiagnosticStore", () => {
  let store: WorkspaceDiagnosticStore;

  beforeEach(() => { store = new WorkspaceDiagnosticStore(); });

  it("addDiagnostic and totalCount", () => {
    store.addDiagnostic(makeDiag("src/a.ts", "error", "Type error"));
    expect(store.totalCount).toBe(1);
  });

  it("getForFile returns only that file's diagnostics", () => {
    store.addDiagnostic(makeDiag("src/a.ts", "error", "err"));
    store.addDiagnostic(makeDiag("src/b.ts", "warning", "warn"));
    expect(store.getForFile("src/a.ts")).toHaveLength(1);
  });

  it("getBySeverity filters correctly", () => {
    store.addDiagnostic(makeDiag("src/a.ts", "error", "e1"));
    store.addDiagnostic(makeDiag("src/a.ts", "warning", "w1"));
    store.addDiagnostic(makeDiag("src/b.ts", "error", "e2"));
    expect(store.getBySeverity("error")).toHaveLength(2);
    expect(store.getBySeverity("warning")).toHaveLength(1);
  });

  it("getTopDiagnostics returns errors before warnings", () => {
    store.addDiagnostic(makeDiag("src/a.ts", "warning", "w"));
    store.addDiagnostic(makeDiag("src/b.ts", "error", "e"));
    const top = store.getTopDiagnostics(2);
    expect(top[0]!.severity).toBe("error");
  });

  it("errorCount and warningCount are correct", () => {
    store.addMany([
      makeDiag("src/a.ts", "error", "e1"),
      makeDiag("src/a.ts", "error", "e2"),
      makeDiag("src/b.ts", "warning", "w1"),
    ]);
    expect(store.errorCount).toBe(2);
    expect(store.warningCount).toBe(1);
  });

  it("clearForFile removes only that file's diagnostics", () => {
    store.addDiagnostic(makeDiag("src/a.ts", "error", "e"));
    store.addDiagnostic(makeDiag("src/b.ts", "warning", "w"));
    store.clearForFile("src/a.ts");
    expect(store.totalCount).toBe(1);
    expect(store.getForFile("src/b.ts")).toHaveLength(1);
  });
});

// ─── severityRank ─────────────────────────────────────────────────────────────

describe("severityRank", () => {
  it("ranks error < warning < information < hint", () => {
    expect(severityRank("error")).toBeLessThan(severityRank("warning"));
    expect(severityRank("warning")).toBeLessThan(severityRank("information"));
    expect(severityRank("information")).toBeLessThan(severityRank("hint"));
  });
});

// ─── parseImports ─────────────────────────────────────────────────────────────

describe("parseImports", () => {
  it("parses named imports", () => {
    const src = `import { foo, bar } from "./utils";`;
    const edges = parseImports(src, "src/a.ts");
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0]!.importedSymbols).toContain("foo");
    expect(edges[0]!.importedSymbols).toContain("bar");
  });

  it("parses default import", () => {
    const src = `import MyLib from "@scope/mylib";`;
    const edges = parseImports(src, "src/a.ts");
    expect(edges.some((e) => e.specifier === "@scope/mylib")).toBe(true);
  });

  it("sets fromFile correctly", () => {
    const src = `import { x } from "./x";`;
    const edges = parseImports(src, "src/main.ts");
    expect(edges[0]!.fromFile).toBe("src/main.ts");
  });

  it("returns empty for source with no imports", () => {
    const src = `const x = 1;`;
    expect(parseImports(src, "src/a.ts")).toHaveLength(0);
  });

  it("handles aliased named imports", () => {
    const src = `import { foo as bar } from "./foo";`;
    const edges = parseImports(src, "src/a.ts");
    // Should import "foo" (original name), not "bar" (alias)
    expect(edges[0]!.importedSymbols).toContain("foo");
  });
});

// ─── WorkspaceLspAggregator ───────────────────────────────────────────────────

describe("WorkspaceLspAggregator", () => {
  let agg: WorkspaceLspAggregator;

  beforeEach(() => { agg = new WorkspaceLspAggregator(); });

  it("indexFile adds definitions to symbol index", () => {
    const def = makeSymbolDefinition("myFn", "function", "src/a.ts", { isExported: true });
    agg.indexFile("src/a.ts", "", [def]);
    expect(agg.symbols.totalDefinitions).toBe(1);
  });

  it("indexFile parses imports from source", () => {
    const src = `import { foo } from "./foo";`;
    agg.indexFile("src/a.ts", src, []);
    expect(agg.symbols.getImportsFrom("src/a.ts")).toHaveLength(1);
  });

  it("buildContextBundle includes reachable definitions", () => {
    const def = makeSymbolDefinition("fn", "function", "src/a.ts", { isExported: false });
    agg.indexFile("src/a.ts", "", [def]);
    const bundle = agg.buildContextBundle("src/a.ts");
    expect(bundle.reachableDefinitions.some((d) => d.name === "fn")).toBe(true);
  });

  it("buildContextBundle includes hovers for focus file", () => {
    agg.hovers.addHover(makeHover("src/a.ts", "fn", "() => void"));
    const bundle = agg.buildContextBundle("src/a.ts");
    expect(bundle.hovers).toHaveLength(1);
  });

  it("buildContextBundle includes diagnostics for focus file", () => {
    agg.diagnostics.addDiagnostic(makeDiag("src/a.ts", "error", "fail"));
    const bundle = agg.buildContextBundle("src/a.ts");
    expect(bundle.diagnostics).toHaveLength(1);
  });

  it("formatBundleForPrompt includes file path", () => {
    agg.indexFile("src/main.ts", "", []);
    const bundle = agg.buildContextBundle("src/main.ts");
    const output = agg.formatBundleForPrompt(bundle);
    expect(output).toContain("src/main.ts");
  });

  it("formatBundleForPrompt includes severity label for diagnostics", () => {
    agg.diagnostics.addDiagnostic(makeDiag("src/a.ts", "error", "Type mismatch"));
    const bundle = agg.buildContextBundle("src/a.ts");
    const output = agg.formatBundleForPrompt(bundle);
    expect(output).toContain("ERROR");
  });

  it("clear empties all sub-indexes", () => {
    agg.indexFile("src/a.ts", "", [makeDef("fn")]);
    agg.hovers.addHover(makeHover("src/a.ts", "fn"));
    agg.diagnostics.addDiagnostic(makeDiag("src/a.ts", "error", "e"));
    agg.clear();
    expect(agg.symbols.totalDefinitions).toBe(0);
    expect(agg.hovers.count).toBe(0);
    expect(agg.diagnostics.totalCount).toBe(0);
  });
});
