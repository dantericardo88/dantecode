import * as vscode from "vscode";
import * as path from "path";
import type { IContextProvider, ContextProviderExtras, ContextItem } from "@dantecode/core";

export class OpenFilesProvider implements IContextProvider {
  readonly name = "open";
  readonly description = "All open editor tabs";

  async getContextItems(_extras: ContextProviderExtras): Promise<ContextItem[]> {
    const editors = vscode.window.visibleTextEditors.slice(0, 10);
    if (editors.length === 0) {
      return [{ name: "open", description: "Open files", content: "(no open editors)" }];
    }
    const parts = editors.map((e) => {
      const name = path.basename(e.document.uri.fsPath);
      const lang = e.document.languageId;
      const text = e.document.getText().slice(0, 2000);
      return `### ${name}\n\`\`\`${lang}\n${text}\n\`\`\``;
    });
    return [{ name: "open", description: "Open files", content: parts.join("\n\n") }];
  }
}
