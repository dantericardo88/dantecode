import * as vscode from "vscode";
import type { IContextProvider, ContextProviderExtras, ContextItem } from "@dantecode/core";

export class ProblemsProvider implements IContextProvider {
  readonly name = "problems";
  readonly description = "Workspace diagnostics from the Problems panel";

  async getContextItems(_extras: ContextProviderExtras): Promise<ContextItem[]> {
    const allDiags = vscode.languages.getDiagnostics();
    const lines: string[] = [];
    for (const [uri, diags] of allDiags) {
      for (const d of diags) {
        if (
          d.severity === vscode.DiagnosticSeverity.Error ||
          d.severity === vscode.DiagnosticSeverity.Warning
        ) {
          const severity = d.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning";
          const relPath = vscode.workspace.asRelativePath(uri);
          lines.push(
            `${severity}: ${relPath}:${d.range.start.line + 1} — ${d.message}`,
          );
        }
      }
    }
    const content = lines.length > 0 ? lines.join("\n") : "(no problems)";
    return [{ name: "problems", description: "Workspace problems", content }];
  }
}
