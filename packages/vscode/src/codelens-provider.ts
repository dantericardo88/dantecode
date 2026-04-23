// ============================================================================
// packages/vscode/src/codelens-provider.ts
//
// Function-level CodeLens annotations for DanteCode.
// Appears above every function/class/export const declaration in TypeScript,
// JavaScript, Python, and Go files.
//
// Lenses:
//   ⚡ Ask DanteCode       — always, triggers inline edit on this function
//   🔴 PDSE violation      — when the function has hard violations
//   📝 Write test          — on exported functions
// ============================================================================

import * as vscode from "vscode";

// ── Symbol extraction ────────────────────────────────────────────────────────

/**
 * Simple regex-based function/class/export detection.
 * Returns the 0-indexed line number of each declaration.
 * Covers TypeScript/JavaScript and Python.
 */
const DECLARATION_RE =
  /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class)\s+\w|^(?:export\s+)?const\s+\w+\s*=\s*(?:async\s+)?\(|^def\s+\w+\(|^class\s+\w+[:(]/gm;

interface SymbolRange {
  line: number;   // 0-indexed
  name: string;
  isExported: boolean;
}

function extractSymbolRanges(text: string): SymbolRange[] {
  const results: SymbolRange[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    DECLARATION_RE.lastIndex = 0;
    if (DECLARATION_RE.test(line)) {
      const isExported = line.trimStart().startsWith("export");
      // Extract the symbol name (best-effort)
      const nameMatch = line.match(/(?:function|class|const|def)\s+(\w+)/);
      const name = nameMatch?.[1] ?? "(anonymous)";
      results.push({ line: i, name, isExported });
    }
  }
  return results;
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  version: number;
  lenses: vscode.CodeLens[];
}

// ── Provider ─────────────────────────────────────────────────────────────────

/**
 * DanteCodeLensProvider — registers CodeLens annotations above each function.
 *
 * Usage (in extension.ts):
 *   context.subscriptions.push(
 *     vscode.languages.registerCodeLensProvider(
 *       ["typescript", "javascript", "python", "go"],
 *       new DanteCodeLensProvider(diagnosticProvider)
 *     )
 *   );
 */
export class DanteCodeLensProvider implements vscode.CodeLensProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor() {}

  /**
   * Called by VS Code to provide lenses for a document.
   * Skips files larger than 5000 lines to avoid performance issues.
   */
  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (document.lineCount > 5000) return [];

    const key = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached && cached.version === document.version) {
      return cached.lenses;
    }

    const text = document.getText();
    const symbols = extractSymbolRanges(text);
    const lenses: vscode.CodeLens[] = [];

    // Get current diagnostics for this document to detect violations
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    const hardViolationLines = new Set(
      diagnostics
        .filter(
          (d) =>
            d.source === "DanteCode PDSE" &&
            d.severity === vscode.DiagnosticSeverity.Error,
        )
        .map((d) => d.range.start.line),
    );
    const tsErrorLines = new Set(
      diagnostics
        .filter(
          (d) => d.source === "ts" && d.severity === vscode.DiagnosticSeverity.Error,
        )
        .map((d) => d.range.start.line),
    );

    for (const sym of symbols) {
      const range = new vscode.Range(sym.line, 0, sym.line, 0);

      // ⚡ Ask DanteCode — always present
      lenses.push(
        new vscode.CodeLens(range, {
          title: "⚡ Ask DanteCode",
          command: "dantecode.inlineEdit",
          arguments: [],
        }),
      );

      // 🔴 PDSE violation — when this line has a hard violation nearby
      const hasViolation = [...hardViolationLines].some((l) => Math.abs(l - sym.line) <= 5);
      if (hasViolation) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: "🔴 PDSE violation — Fix with AI",
            command: "dantecode.fixDiagnostic",
            arguments: [document.uri, range],
          }),
        );
      }

      // ✓ Fix with AI — when there are TS errors near this function
      const hasTsError = [...tsErrorLines].some((l) => Math.abs(l - sym.line) <= 5);
      if (hasTsError) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: "✓ Fix TypeScript error",
            command: "dantecode.inlineEdit",
            arguments: [],
          }),
        );
      }

      // 📝 Write test — always on exported functions
      if (sym.isExported) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `📝 Write test for ${sym.name}`,
            command: "dantecode.slashCommandTest",
            arguments: [sym.name],
          }),
        );
      }
    }

    this.cache.set(key, { version: document.version, lenses });
    return lenses;
  }

  resolveCodeLens(lens: vscode.CodeLens, _token: vscode.CancellationToken): vscode.CodeLens {
    return lens;
  }

  /**
   * Schedules a refresh after a document change (debounced 500ms).
   */
  scheduleRefresh(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this._onDidChangeCodeLenses.fire();
    }, 500);
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
  }
}
