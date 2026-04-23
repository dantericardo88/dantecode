// ============================================================================
// packages/vscode/src/quick-fix-provider.ts
//
// Quick Fix code actions for DanteCode.
// Surfaces "Fix with DanteCode" in the VS Code lightbulb menu for:
//   1. PDSE hard violations (source: "DanteCode PDSE", severity: Error)
//   2. TypeScript errors (TS2345, TS2339, TS6133, TS2305, etc.)
//   3. Any error — "Explain this error" opens the chat sidebar
// ============================================================================

import * as vscode from "vscode";

// ── Constants ────────────────────────────────────────────────────────────────

/** TypeScript error codes we offer to fix automatically. */
const TS_FIXABLE_CODES = new Set(["2345", "2339", "6133", "2305", "2304", "2322", "2551"]);

const PDSE_SOURCE = "DanteCode PDSE";

// ── Provider ─────────────────────────────────────────────────────────────────

/**
 * DanteCodeQuickFixProvider — CodeActionProvider for PDSE + TS errors.
 *
 * Usage (in extension.ts):
 *   context.subscriptions.push(
 *     vscode.languages.registerCodeActionsProvider(
 *       ["typescript", "javascript", "typescriptreact", "javascriptreact"],
 *       new DanteCodeQuickFixProvider(),
 *       { providedCodeActionKinds: DanteCodeQuickFixProvider.providedCodeActionKinds }
 *     )
 *   );
 */
export class DanteCodeQuickFixProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds: vscode.CodeActionKind[] = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.RefactorRewrite,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.source === PDSE_SOURCE && diag.severity === vscode.DiagnosticSeverity.Error) {
        actions.push(...this.buildPdseActions(diag, document, range));
      } else if (this.isTsError(diag)) {
        actions.push(...this.buildTsActions(diag, document, range));
      } else if (diag.severity === vscode.DiagnosticSeverity.Error) {
        actions.push(this.buildExplainAction(diag));
      }
    }

    return actions;
  }

  // ── PDSE actions ────────────────────────────────────────────────────────────

  private buildPdseActions(
    diag: vscode.Diagnostic,
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const fix = new vscode.CodeAction(
      `🔧 Fix with DanteCode: ${diag.message.slice(0, 60)}`,
      vscode.CodeActionKind.QuickFix,
    );
    fix.diagnostics = [diag];
    fix.isPreferred = true;
    fix.command = {
      command: "dantecode.fixDiagnostic",
      title: "Fix with DanteCode",
      arguments: [document.uri, range, diag.message],
    };

    const explain = this.buildExplainAction(diag);
    return [fix, explain];
  }

  // ── TypeScript actions ───────────────────────────────────────────────────────

  private buildTsActions(
    diag: vscode.Diagnostic,
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const fix = new vscode.CodeAction(
      `🤖 Ask DanteCode to fix: ${diag.message.slice(0, 60)}`,
      vscode.CodeActionKind.QuickFix,
    );
    fix.diagnostics = [diag];
    fix.command = {
      command: "dantecode.inlineEdit",
      title: "Fix with DanteCode",
      arguments: [document.uri, range, diag.message],
    };

    const explain = this.buildExplainAction(diag);
    return [fix, explain];
  }

  // ── Explain action ──────────────────────────────────────────────────────────

  private buildExplainAction(diag: vscode.Diagnostic): vscode.CodeAction {
    const explain = new vscode.CodeAction(
      `💬 Explain this error`,
      vscode.CodeActionKind.QuickFix,
    );
    explain.diagnostics = [diag];
    explain.command = {
      command: "dantecode.explainDiagnostic",
      title: "Explain with DanteCode",
      arguments: [diag.message],
    };
    return explain;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private isTsError(diag: vscode.Diagnostic): boolean {
    if (diag.source !== "ts") return false;
    if (diag.severity !== vscode.DiagnosticSeverity.Error) return false;
    const code =
      typeof diag.code === "object" ? String(diag.code.value) : String(diag.code ?? "");
    return TS_FIXABLE_CODES.has(code);
  }
}
