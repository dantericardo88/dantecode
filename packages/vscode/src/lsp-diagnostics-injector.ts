// packages/vscode/src/lsp-diagnostics-injector.ts
// Injects real-time LSP diagnostics (type errors, lint warnings) into the
// AI context window before FIM completions and chat responses.
//
// Closes dim 2 (LSP/diagnostics in context) gap vs Augment/JetBrains AI
// which surface real-time type errors to the model. This makes completions
// aware of existing errors in the file, dramatically improving acceptance rate.
//
// Pattern: Tabby + Continue.dev harvest — both inject diagnostic context
// from the language server into their FIM prefix/suffix assembly.

import type * as vscode from "vscode";

export interface DiagnosticEntry {
  file: string;
  line: number;
  col: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string;
  code?: string | number;
}

export interface DiagnosticsSnapshot {
  /** Diagnostics from the current file (highest priority) */
  current: DiagnosticEntry[];
  /** Diagnostics from related files (same workspace) */
  related: DiagnosticEntry[];
  /** Total error count across the workspace */
  totalErrors: number;
  /** Total warning count across the workspace */
  totalWarnings: number;
  /** ISO timestamp of snapshot */
  capturedAt: string;
  /** Type of the symbol under cursor, resolved via vscode.executeHoverProvider */
  hoverType?: string;
}

const SEVERITY_MAP: Record<number, DiagnosticEntry["severity"]> = {
  0: "error",
  1: "warning",
  2: "info",
  3: "hint",
};

const SEVERITY_PRIORITY: Record<DiagnosticEntry["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

// ─── Diagnostic Collector ─────────────────────────────────────────────────────

function convertDiagnostic(
  diag: vscode.Diagnostic,
  filePath: string,
): DiagnosticEntry {
  return {
    file: filePath,
    line: diag.range.start.line + 1, // 1-indexed
    col: diag.range.start.character + 1,
    severity: SEVERITY_MAP[diag.severity] ?? "error",
    message: diag.message,
    source: diag.source,
    code: typeof diag.code === "object" ? String(diag.code.value) : diag.code,
  };
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

/**
 * Collects LSP diagnostics from the VSCode API and formats them for
 * injection into the model's context window.
 */
export class LspDiagnosticsInjector {
  private readonly _vscode: typeof vscode;
  /** Max number of diagnostics to inject (prevents context overflow) */
  private readonly _maxDiagnostics: number;
  /** Only inject errors+warnings (skip info/hints) */
  private readonly _minSeverity: DiagnosticEntry["severity"];

  constructor(
    vsCodeApi: typeof vscode,
    options: { maxDiagnostics?: number; minSeverity?: DiagnosticEntry["severity"] } = {},
  ) {
    this._vscode = vsCodeApi;
    this._maxDiagnostics = options.maxDiagnostics ?? 20;
    this._minSeverity = options.minSeverity ?? "warning";
  }

  /**
   * Capture a snapshot of diagnostics relevant to the given file URI.
   * Current file diagnostics are prioritized over workspace-wide ones.
   *
   * @param currentUri  URI string of the active file
   * @param position    Optional cursor position; when provided, resolves hover type
   *                    via vscode.executeHoverProvider and adds it to the snapshot.
   */
  async snapshot(
    currentUri: string,
    position?: { line: number; character: number },
  ): Promise<DiagnosticsSnapshot> {
    const allDiags = this._vscode.languages.getDiagnostics();
    let totalErrors = 0;
    let totalWarnings = 0;
    const current: DiagnosticEntry[] = [];
    const related: DiagnosticEntry[] = [];

    const minPriority = SEVERITY_PRIORITY[this._minSeverity];

    for (const [uri, diagnostics] of allDiags) {
      const filePath = uri.fsPath;
      const isCurrentFile = uri.toString() === currentUri;

      for (const diag of diagnostics) {
        if (diag.severity === 0) totalErrors++;
        else if (diag.severity === 1) totalWarnings++;

        const entry = convertDiagnostic(diag, filePath);
        if (SEVERITY_PRIORITY[entry.severity] > minPriority) continue;

        if (isCurrentFile) {
          current.push(entry);
        } else {
          related.push(entry);
        }
      }
    }

    // Sort current file: errors first, then by line number
    current.sort((a, b) =>
      SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity] ||
      a.line - b.line
    );

    // Related: only errors, sorted by file then line
    const relatedErrors = related
      .filter((d) => d.severity === "error")
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
      .slice(0, Math.floor(this._maxDiagnostics / 2));

    const currentCapped = current.slice(0, this._maxDiagnostics - relatedErrors.length);

    // Resolve hover type via executeHoverProvider when cursor position is provided
    let hoverType: string | undefined;
    if (position) {
      try {
        const vsPos = new this._vscode.Position(position.line, position.character);
        const vsUri = this._vscode.Uri.parse(currentUri);
        const hovers = await this._vscode.commands.executeCommand<vscode.Hover[]>(
          "vscode.executeHoverProvider",
          vsUri,
          vsPos,
        );
        if (hovers && hovers.length > 0) {
          const firstHover = hovers[0];
          const contents = firstHover?.contents;
          if (Array.isArray(contents) && contents.length > 0) {
            const first = contents[0];
            const raw = typeof first === "string" ? first :
              (first && typeof (first as { value?: string }).value === "string"
                ? (first as { value: string }).value : "");
            if (raw.length > 0) {
              // Truncate at 200 chars to guard against long generic types
              hoverType = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
            }
          }
        }
      } catch {
        // Hover resolution is non-fatal — proceed without type info
      }
    }

    return {
      current: currentCapped,
      related: relatedErrors,
      totalErrors,
      totalWarnings,
      capturedAt: new Date().toISOString(),
      hoverType,
    };
  }

  /**
   * Format the snapshot as a compact context block for injection into
   * the model prompt. Returns empty string if no relevant diagnostics.
   * Prepends a `## Symbol Type` block when hoverType is present.
   */
  formatForContext(snapshot: DiagnosticsSnapshot): string {
    const all = [...snapshot.current, ...snapshot.related];
    if (all.length === 0 && !snapshot.hoverType) return "";

    const lines: string[] = [];

    // Prepend hover type if available
    if (snapshot.hoverType) {
      lines.push("## Symbol Type", `\`${snapshot.hoverType}\``, "");
    }

    if (all.length === 0) return lines.join("\n");

    lines.push("## Active Diagnostics");

    // Current file errors/warnings
    if (snapshot.current.length > 0) {
      lines.push("### Current file:");
      for (const d of snapshot.current) {
        const code = d.code ? ` [${d.code}]` : "";
        lines.push(`  ${d.severity.toUpperCase()} L${d.line}:${d.col}${code} — ${d.message}`);
      }
    }

    // Related file errors (brief)
    if (snapshot.related.length > 0) {
      lines.push("### Related files:");
      for (const d of snapshot.related) {
        lines.push(`  ${basename(d.file)} L${d.line} — ${d.message}`);
      }
    }

    // Summary hint
    if (snapshot.totalErrors > 0) {
      lines.push(`\n(${snapshot.totalErrors} error(s), ${snapshot.totalWarnings} warning(s) in workspace)`);
    }

    return lines.join("\n");
  }

  /**
   * Returns true if there are any errors in the workspace.
   * Used to decide whether to surface diagnostics.
   */
  hasErrors(snapshot: DiagnosticsSnapshot): boolean {
    return snapshot.totalErrors > 0 || snapshot.current.some((d) => d.severity === "error");
  }
}

// ─── Lightweight mock for non-VSCode environments ─────────────────────────────

/**
 * Creates a no-op injector for CLI/non-VSCode contexts.
 * Returns empty diagnostics so callers don't need to branch on environment.
 */
export function createNullInjector(): Pick<LspDiagnosticsInjector, "snapshot" | "formatForContext" | "hasErrors"> {
  return {
    snapshot: async () => ({
      current: [],
      related: [],
      totalErrors: 0,
      totalWarnings: 0,
      capturedAt: new Date().toISOString(),
    }),
    formatForContext: () => "",
    hasErrors: () => false,
  };
}
