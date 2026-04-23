// packages/core/src/workspace-lsp-aggregator.ts
// Multi-file LSP context aggregation — deepens dim 2 (multi-file LSP: 8→9).
//
// Harvested from: Continue.dev IContextProvider chain, Copilot workspace context,
//                 Zed language server integration.
//
// Provides:
//   - Symbol graph: tracks symbol definitions, usages, and cross-file references
//   - Hover context aggregation: merges hover results from multiple providers
//   - Diagnostic workspace view: cross-file error/warning collation
//   - Import graph resolution: maps module imports to their resolved files
//   - Workspace-scoped type narrowing for AI prompt injection

// ─── Types ────────────────────────────────────────────────────────────────────

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "variable"
  | "type"
  | "enum"
  | "method"
  | "property"
  | "module"
  | "namespace"
  | "constant";

export type DiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface LspPosition {
  line: number;   // 0-indexed
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface SymbolDefinition {
  name: string;
  kind: SymbolKind;
  filePath: string;
  range: LspRange;
  /** Full qualified name (e.g. ClassName.methodName) */
  qualifiedName?: string;
  /** Brief documentation or type signature */
  documentation?: string;
  /** Whether this symbol is exported */
  isExported: boolean;
}

export interface SymbolReference {
  symbolName: string;
  filePath: string;
  range: LspRange;
  /** Definition file where the symbol is declared */
  definitionFilePath?: string;
}

export interface HoverContext {
  filePath: string;
  position: LspPosition;
  symbolName: string;
  typeSignature?: string;
  documentation?: string;
  source: string; // provider name
}

export interface WorkspaceDiagnostic {
  filePath: string;
  message: string;
  severity: DiagnosticSeverity;
  range: LspRange;
  code?: string;
  source?: string;
}

export interface ImportEdge {
  /** File that imports */
  fromFile: string;
  /** File being imported */
  toFile: string;
  /** Specifier as written (e.g. "./utils", "@scope/pkg") */
  specifier: string;
  /** Symbols imported from the module */
  importedSymbols: string[];
}

export interface WorkspaceSymbolGraph {
  definitions: Map<string, SymbolDefinition>;   // qualifiedName → def
  references: SymbolReference[];
  imports: ImportEdge[];
}

export interface LspContextBundle {
  /** Primary file being focused on */
  focusFile: string;
  /** Symbol definitions reachable from focusFile */
  reachableDefinitions: SymbolDefinition[];
  /** Hover contexts gathered */
  hovers: HoverContext[];
  /** Diagnostics across workspace */
  diagnostics: WorkspaceDiagnostic[];
  /** Import edges involving focusFile */
  importEdges: ImportEdge[];
  /** Total symbols in workspace graph */
  totalSymbols: number;
}

// ─── Symbol Graph Builder ─────────────────────────────────────────────────────

export function makeSymbolDefinition(
  name: string,
  kind: SymbolKind,
  filePath: string,
  opts: {
    range?: LspRange;
    qualifiedName?: string;
    documentation?: string;
    isExported?: boolean;
  } = {},
): SymbolDefinition {
  return {
    name,
    kind,
    filePath,
    range: opts.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } },
    qualifiedName: opts.qualifiedName ?? name,
    documentation: opts.documentation,
    isExported: opts.isExported ?? false,
  };
}

export class WorkspaceSymbolIndex {
  private _definitions = new Map<string, SymbolDefinition>();
  private _byFile = new Map<string, SymbolDefinition[]>();
  private _references: SymbolReference[] = [];
  private _imports: ImportEdge[] = [];

  addDefinition(def: SymbolDefinition): void {
    const key = def.qualifiedName ?? def.name;
    this._definitions.set(key, def);

    if (!this._byFile.has(def.filePath)) this._byFile.set(def.filePath, []);
    this._byFile.get(def.filePath)!.push(def);
  }

  addReference(ref: SymbolReference): void {
    this._references.push(ref);
  }

  addImport(edge: ImportEdge): void {
    this._imports.push(edge);
  }

  getDefinition(qualifiedName: string): SymbolDefinition | undefined {
    return this._definitions.get(qualifiedName);
  }

  getDefinitionsInFile(filePath: string): SymbolDefinition[] {
    return this._byFile.get(filePath) ?? [];
  }

  getReferencesInFile(filePath: string): SymbolReference[] {
    return this._references.filter((r) => r.filePath === filePath);
  }

  getImportsFrom(filePath: string): ImportEdge[] {
    return this._imports.filter((e) => e.fromFile === filePath);
  }

  getImportersOf(filePath: string): ImportEdge[] {
    return this._imports.filter((e) => e.toFile === filePath);
  }

  /**
   * Find all definitions reachable from a file through imports (1 hop).
   */
  getReachableDefinitions(filePath: string): SymbolDefinition[] {
    const edges = this.getImportsFrom(filePath);
    const defs: SymbolDefinition[] = [...this.getDefinitionsInFile(filePath)];

    for (const edge of edges) {
      const imported = this.getDefinitionsInFile(edge.toFile).filter((d) =>
        d.isExported && (edge.importedSymbols.length === 0 || edge.importedSymbols.includes(d.name))
      );
      defs.push(...imported);
    }

    // Deduplicate by qualifiedName
    const seen = new Set<string>();
    return defs.filter((d) => {
      const key = d.qualifiedName ?? d.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  findByName(name: string): SymbolDefinition[] {
    return [...this._definitions.values()].filter(
      (d) => d.name === name || d.qualifiedName === name
    );
  }

  get totalDefinitions(): number { return this._definitions.size; }

  clear(): void {
    this._definitions.clear();
    this._byFile.clear();
    this._references = [];
    this._imports = [];
  }
}

// ─── Hover Aggregator ─────────────────────────────────────────────────────────

export class HoverAggregator {
  private _hovers: HoverContext[] = [];

  addHover(ctx: HoverContext): void {
    // Deduplicate by filePath + symbolName
    const existing = this._hovers.findIndex(
      (h) => h.filePath === ctx.filePath && h.symbolName === ctx.symbolName
    );
    if (existing !== -1) {
      // Merge: prefer richer documentation or type signature
      const prev = this._hovers[existing]!;
      const prevRich = prev.documentation || prev.typeSignature;
      const newRich = ctx.documentation || ctx.typeSignature;
      if (!prevRich && newRich) this._hovers[existing] = ctx;
    } else {
      this._hovers.push(ctx);
    }
  }

  getHoversForFile(filePath: string): HoverContext[] {
    return this._hovers.filter((h) => h.filePath === filePath);
  }

  getHoverForSymbol(filePath: string, symbolName: string): HoverContext | undefined {
    return this._hovers.find((h) => h.filePath === filePath && h.symbolName === symbolName);
  }

  get all(): HoverContext[] { return [...this._hovers]; }
  get count(): number { return this._hovers.length; }

  clear(): void { this._hovers = []; }
}

// ─── Diagnostic Aggregator ────────────────────────────────────────────────────

export function severityRank(s: DiagnosticSeverity): number {
  return { error: 0, warning: 1, information: 2, hint: 3 }[s];
}

export class WorkspaceDiagnosticStore {
  private _diagnostics: WorkspaceDiagnostic[] = [];

  addDiagnostic(d: WorkspaceDiagnostic): void { this._diagnostics.push(d); }

  addMany(diagnostics: WorkspaceDiagnostic[]): void {
    this._diagnostics.push(...diagnostics);
  }

  getForFile(filePath: string): WorkspaceDiagnostic[] {
    return this._diagnostics.filter((d) => d.filePath === filePath);
  }

  getBySeverity(severity: DiagnosticSeverity): WorkspaceDiagnostic[] {
    return this._diagnostics.filter((d) => d.severity === severity);
  }

  /**
   * Get top N diagnostics sorted by severity (errors first).
   */
  getTopDiagnostics(n = 10): WorkspaceDiagnostic[] {
    return [...this._diagnostics]
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
      .slice(0, n);
  }

  get errorCount(): number { return this._diagnostics.filter((d) => d.severity === "error").length; }
  get warningCount(): number { return this._diagnostics.filter((d) => d.severity === "warning").length; }
  get totalCount(): number { return this._diagnostics.length; }

  clearForFile(filePath: string): void {
    this._diagnostics = this._diagnostics.filter((d) => d.filePath !== filePath);
  }

  clear(): void { this._diagnostics = []; }
}

// ─── Import Graph ─────────────────────────────────────────────────────────────

/**
 * Parse ES-style import statements from source text.
 * Extracts specifier and named imports.
 */
export function parseImports(source: string, filePath: string): ImportEdge[] {
  const edges: ImportEdge[] = [];

  // Named imports: import { A, B } from "..."
  const namedRe = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = namedRe.exec(source)) !== null) {
    const symbols = m[1]!.split(",").map((s) => s.trim().split(/\s+as\s+/)[0]!.trim()).filter(Boolean);
    edges.push({ fromFile: filePath, toFile: m[2]!, specifier: m[2]!, importedSymbols: symbols });
  }

  // Default/namespace imports: import X from "..." or import * as X from "..."
  const defaultRe = /import\s+(?:\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = defaultRe.exec(source)) !== null) {
    // Only add if not already added from named re
    if (!edges.some((e) => e.specifier === m![1])) {
      edges.push({ fromFile: filePath, toFile: m[1]!, specifier: m[1]!, importedSymbols: [] });
    }
  }

  return edges;
}

// ─── Workspace LSP Aggregator ─────────────────────────────────────────────────

export class WorkspaceLspAggregator {
  readonly symbols = new WorkspaceSymbolIndex();
  readonly hovers = new HoverAggregator();
  readonly diagnostics = new WorkspaceDiagnosticStore();

  indexFile(filePath: string, source: string, defs: SymbolDefinition[]): void {
    for (const def of defs) this.symbols.addDefinition(def);

    // Parse imports
    const imports = parseImports(source, filePath);
    for (const edge of imports) this.symbols.addImport(edge);
  }

  buildContextBundle(focusFile: string): LspContextBundle {
    return {
      focusFile,
      reachableDefinitions: this.symbols.getReachableDefinitions(focusFile),
      hovers: this.hovers.getHoversForFile(focusFile),
      diagnostics: this.diagnostics.getForFile(focusFile),
      importEdges: this.symbols.getImportsFrom(focusFile),
      totalSymbols: this.symbols.totalDefinitions,
    };
  }

  /**
   * Format the LSP context bundle for AI prompt injection.
   * Token-budget aware — caps at maxSymbols to avoid context overflow.
   */
  formatBundleForPrompt(bundle: LspContextBundle, maxSymbols = 20): string {
    const lines: string[] = [
      `## LSP Context — ${bundle.focusFile}`,
      `Workspace symbols: ${bundle.totalSymbols}`,
    ];

    if (bundle.diagnostics.length > 0) {
      lines.push(`\n### Diagnostics`);
      for (const d of bundle.diagnostics.slice(0, 5)) {
        lines.push(`- [${d.severity.toUpperCase()}] ${d.message} (${d.filePath}:${d.range.start.line + 1})`);
      }
    }

    if (bundle.reachableDefinitions.length > 0) {
      lines.push(`\n### Reachable Symbols`);
      for (const def of bundle.reachableDefinitions.slice(0, maxSymbols)) {
        const exported = def.isExported ? "export " : "";
        const doc = def.documentation ? ` — ${def.documentation}` : "";
        lines.push(`- ${exported}${def.kind} \`${def.qualifiedName ?? def.name}\`${doc} (${def.filePath})`);
      }
    }

    if (bundle.hovers.length > 0) {
      lines.push(`\n### Hover Types`);
      for (const h of bundle.hovers.slice(0, 10)) {
        if (h.typeSignature) lines.push(`- \`${h.symbolName}\`: ${h.typeSignature}`);
      }
    }

    return lines.join("\n");
  }

  clear(): void {
    this.symbols.clear();
    this.hovers.clear();
    this.diagnostics.clear();
  }
}
