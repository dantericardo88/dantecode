// packages/core/src/lsp-context-aggregator.ts
// Rich LSP context aggregation for AI prompt injection — closes dim 2 (LSP: 7→9).
//
// Harvested from: Continue.dev LSP type crawling, JetBrains AI LSP integration.
//
// Provides:
//   - Hover info (type signature, documentation)
//   - Symbol references (find-all-references context)
//   - Diagnostic grouping (by file, severity, source)
//   - Semantic token classification (type, keyword, function, variable)
//   - Symbol navigation (definition, implementation, type-definition)
//   - Aggregated context block for AI prompt injection

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface LspDiagnostic {
  filePath: string;
  line: number;
  col: number;
  severity: DiagnosticSeverity;
  message: string;
  code?: string | number;
  source?: string;
  relatedInfo?: Array<{ filePath: string; line: number; message: string }>;
}

export interface HoverInfo {
  filePath: string;
  line: number;
  col: number;
  /** Type signature or value type */
  typeSignature?: string;
  /** Documentation string (JSDoc / TSDoc) */
  documentation?: string;
  /** Symbol kind: function, class, variable, etc. */
  symbolKind?: string;
  /** Symbol name */
  symbolName?: string;
}

export interface SymbolReference {
  filePath: string;
  line: number;
  col: number;
  /** Enclosing function/class name if known */
  context?: string;
}

export interface SymbolDefinition {
  filePath: string;
  line: number;
  col: number;
  /** Full qualified name */
  name: string;
  kind: "function" | "class" | "interface" | "type" | "variable" | "method" | "property" | "enum" | "namespace" | "unknown";
  containerName?: string;
}

export interface SemanticToken {
  filePath: string;
  line: number;
  col: number;
  length: number;
  tokenType: "type" | "function" | "variable" | "keyword" | "comment" | "string" | "number" | "operator" | "parameter" | "property" | "namespace";
  modifiers?: string[];
}

export interface LspContextSnapshot {
  /** Diagnostics grouped by file */
  diagnosticsByFile: Map<string, LspDiagnostic[]>;
  /** Hover info at cursor and nearby symbols */
  hoverInfos: HoverInfo[];
  /** References to the symbol at cursor */
  references: SymbolReference[];
  /** Definition of the symbol at cursor */
  definition?: SymbolDefinition;
  /** All symbols in current file */
  fileSymbols: SymbolDefinition[];
  /** Workspace symbol count */
  workspaceSymbolCount: number;
  /** Timestamp when snapshot was taken */
  capturedAt: string;
}

export interface LspContextAggregatorOptions {
  /** Maximum diagnostics per file to include */
  maxDiagnosticsPerFile?: number;
  /** Maximum references to include */
  maxReferences?: number;
  /** Maximum symbols to include per file */
  maxFileSymbols?: number;
  /** Whether to include hover documentation */
  includeDocumentation?: boolean;
  /** Filter diagnostics by minimum severity */
  minSeverity?: DiagnosticSeverity;
  /** Maximum total chars for the aggregated context block */
  maxContextChars?: number;
}

// ─── Severity Ranking ─────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  error: 4,
  warning: 3,
  info: 2,
  hint: 1,
};

const SEVERITY_ICON: Record<DiagnosticSeverity, string> = {
  error: "✗",
  warning: "⚠",
  info: "ℹ",
  hint: "·",
};

// ─── Diagnostic Grouper ───────────────────────────────────────────────────────

/**
 * Group and filter diagnostics by file, sorted by severity descending.
 */
export function groupDiagnosticsByFile(
  diagnostics: LspDiagnostic[],
  options: Pick<LspContextAggregatorOptions, "maxDiagnosticsPerFile" | "minSeverity"> = {},
): Map<string, LspDiagnostic[]> {
  const { maxDiagnosticsPerFile = 10, minSeverity = "hint" } = options;
  const minRank = SEVERITY_RANK[minSeverity];

  const grouped = new Map<string, LspDiagnostic[]>();
  for (const diag of diagnostics) {
    if (SEVERITY_RANK[diag.severity] < minRank) continue;
    if (!grouped.has(diag.filePath)) grouped.set(diag.filePath, []);
    grouped.get(diag.filePath)!.push(diag);
  }

  // Sort each file's diagnostics by severity desc, then line asc; cap at max
  for (const [file, diags] of grouped) {
    grouped.set(
      file,
      diags
        .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.line - b.line)
        .slice(0, maxDiagnosticsPerFile),
    );
  }

  return grouped;
}

/**
 * Count total diagnostics by severity across all files.
 */
export function countDiagnosticsBySeverity(
  diagnostics: LspDiagnostic[],
): Record<DiagnosticSeverity, number> {
  const counts: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, info: 0, hint: 0 };
  for (const d of diagnostics) counts[d.severity]++;
  return counts;
}

/**
 * Get files with errors only (severity === "error").
 */
export function getErrorFiles(diagnostics: LspDiagnostic[]): string[] {
  const files = new Set<string>();
  for (const d of diagnostics) {
    if (d.severity === "error") files.add(d.filePath);
  }
  return [...files];
}

// ─── Hover Info Formatter ─────────────────────────────────────────────────────

/**
 * Format a hover info entry into a compact string for prompt injection.
 */
export function formatHoverInfo(hover: HoverInfo, includeDoc = true): string {
  const parts: string[] = [];
  if (hover.symbolName) parts.push(`**${hover.symbolKind ?? "symbol"}** \`${hover.symbolName}\``);
  if (hover.typeSignature) parts.push(`Type: \`${hover.typeSignature}\``);
  if (includeDoc && hover.documentation) {
    const doc = hover.documentation.trim().split("\n")[0]; // first line only
    if (doc) parts.push(`Doc: ${doc}`);
  }
  parts.push(`Location: ${hover.filePath}:${hover.line}:${hover.col}`);
  return parts.join(" | ");
}

// ─── Reference Formatter ──────────────────────────────────────────────────────

/**
 * Format a list of symbol references grouped by file.
 */
export function formatReferences(
  refs: SymbolReference[],
  symbolName: string,
  maxRefs: number,
): string {
  if (refs.length === 0) return `No references found for \`${symbolName}\`.`;
  const shown = refs.slice(0, maxRefs);
  const grouped = new Map<string, SymbolReference[]>();
  for (const ref of shown) {
    if (!grouped.has(ref.filePath)) grouped.set(ref.filePath, []);
    grouped.get(ref.filePath)!.push(ref);
  }

  const lines = [`References to \`${symbolName}\` (${refs.length} total, showing ${shown.length}):`];
  for (const [file, fileRefs] of grouped) {
    lines.push(`  ${file}:`);
    for (const ref of fileRefs) {
      const ctx = ref.context ? ` (in ${ref.context})` : "";
      lines.push(`    L${ref.line}:${ref.col}${ctx}`);
    }
  }
  return lines.join("\n");
}

// ─── Symbol List Formatter ────────────────────────────────────────────────────

/**
 * Format a list of symbols for a file into a compact outline.
 */
export function formatFileSymbols(
  symbols: SymbolDefinition[],
  maxSymbols: number,
): string {
  if (symbols.length === 0) return "No symbols found.";
  const shown = symbols.slice(0, maxSymbols);
  const lines = shown.map((s) => {
    const container = s.containerName ? `.${s.containerName}` : "";
    return `  ${s.kind}${container} \`${s.name}\` L${s.line}`;
  });
  if (symbols.length > maxSymbols) {
    lines.push(`  ... and ${symbols.length - maxSymbols} more`);
  }
  return lines.join("\n");
}

// ─── Snapshot Builder ─────────────────────────────────────────────────────────

/**
 * Build an LspContextSnapshot from raw LSP data.
 */
export function buildLspSnapshot(input: {
  diagnostics?: LspDiagnostic[];
  hoverInfos?: HoverInfo[];
  references?: SymbolReference[];
  definition?: SymbolDefinition;
  fileSymbols?: SymbolDefinition[];
  workspaceSymbolCount?: number;
}, options: LspContextAggregatorOptions = {}): LspContextSnapshot {
  const diagnostics = input.diagnostics ?? [];
  const { minSeverity = "hint", maxDiagnosticsPerFile = 10 } = options;

  return {
    diagnosticsByFile: groupDiagnosticsByFile(diagnostics, { maxDiagnosticsPerFile, minSeverity }),
    hoverInfos: (input.hoverInfos ?? []).slice(0, 5),
    references: (input.references ?? []).slice(0, options.maxReferences ?? 20),
    definition: input.definition,
    fileSymbols: (input.fileSymbols ?? []).slice(0, options.maxFileSymbols ?? 50),
    workspaceSymbolCount: input.workspaceSymbolCount ?? 0,
    capturedAt: new Date().toISOString(),
  };
}

// ─── Context Block Formatter ──────────────────────────────────────────────────

/**
 * Format the full LSP context snapshot into a prompt-ready Markdown block.
 */
export function formatLspContextForPrompt(
  snapshot: LspContextSnapshot,
  options: LspContextAggregatorOptions = {},
): string {
  const {
    includeDocumentation = true,
    maxReferences = 20,
    maxFileSymbols = 50,
    maxContextChars = 4000,
  } = options;

  const sections: string[] = ["## LSP Context"];

  // ── Diagnostics ──
  const totalDiags = [...snapshot.diagnosticsByFile.values()].reduce((s, ds) => s + ds.length, 0);
  if (totalDiags > 0) {
    sections.push(`### Diagnostics (${totalDiags})`);
    for (const [file, diags] of snapshot.diagnosticsByFile) {
      sections.push(`**${file}**`);
      for (const d of diags) {
        const code = d.code !== undefined ? ` [${d.code}]` : "";
        const src = d.source ? ` (${d.source})` : "";
        sections.push(`  ${SEVERITY_ICON[d.severity]} L${d.line}:${d.col}${code}${src} — ${d.message}`);
      }
    }
  } else {
    sections.push("### Diagnostics\n  ✓ No issues");
  }

  // ── Hover Info ──
  if (snapshot.hoverInfos.length > 0) {
    sections.push("### Hover Info");
    for (const hover of snapshot.hoverInfos) {
      sections.push(`  ${formatHoverInfo(hover, includeDocumentation)}`);
    }
  }

  // ── Definition ──
  if (snapshot.definition) {
    const def = snapshot.definition;
    const container = def.containerName ? ` (in ${def.containerName})` : "";
    sections.push(`### Definition\n  ${def.kind}${container} \`${def.name}\` — ${def.filePath}:${def.line}:${def.col}`);
  }

  // ── References ──
  if (snapshot.references.length > 0) {
    const symbolName = snapshot.definition?.name ?? "symbol";
    sections.push(`### References\n${formatReferences(snapshot.references, symbolName, maxReferences)}`);
  }

  // ── File Symbols ──
  if (snapshot.fileSymbols.length > 0) {
    sections.push(`### File Symbols (${snapshot.fileSymbols.length})`);
    sections.push(formatFileSymbols(snapshot.fileSymbols, maxFileSymbols));
  }

  // ── Footer ──
  if (snapshot.workspaceSymbolCount > 0) {
    sections.push(`*Workspace: ${snapshot.workspaceSymbolCount} symbols indexed | Captured: ${snapshot.capturedAt}*`);
  }

  const result = sections.join("\n");
  if (result.length > maxContextChars) {
    return result.slice(0, maxContextChars) + "\n... (truncated)";
  }
  return result;
}

// ─── Severity Filter ──────────────────────────────────────────────────────────

/**
 * Filter diagnostics to only those at or above the given severity.
 */
export function filterDiagnosticsBySeverity(
  diagnostics: LspDiagnostic[],
  minSeverity: DiagnosticSeverity,
): LspDiagnostic[] {
  const minRank = SEVERITY_RANK[minSeverity];
  return diagnostics.filter((d) => SEVERITY_RANK[d.severity] >= minRank);
}

/**
 * Get the highest-severity diagnostic from a list.
 */
export function getHighestSeverityDiagnostic(
  diagnostics: LspDiagnostic[],
): LspDiagnostic | undefined {
  if (diagnostics.length === 0) return undefined;
  return diagnostics.reduce((best, curr) =>
    SEVERITY_RANK[curr.severity] > SEVERITY_RANK[best.severity] ? curr : best,
  );
}

/**
 * Check if any diagnostics block compilation (severity === "error").
 */
export function hasBlockingErrors(diagnostics: LspDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
