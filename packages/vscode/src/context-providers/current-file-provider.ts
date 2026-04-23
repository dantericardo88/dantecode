import * as vscode from "vscode";
import type { IContextProvider, ContextProviderExtras, ContextItem } from "@dantecode/core";

export class CurrentFileProvider implements IContextProvider {
  readonly name = "currentfile";
  readonly description = "Active editor file content";

  async getContextItems(_extras: ContextProviderExtras): Promise<ContextItem[]> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return [{ name: "currentfile", description: "Active file", content: "(no active editor)" }];
    }
    const doc = editor.document;
    const relPath = vscode.workspace.asRelativePath(doc.uri);
    const content = doc.getText().slice(0, 8000);
    const lang = doc.languageId;
    return [{
      name: `currentfile:${relPath}`,
      description: `Current file: ${relPath}`,
      content: `\`\`\`${lang}\n// ${relPath}\n${content}\n\`\`\``,
      uri: { type: "file", value: doc.uri.fsPath },
    }];
  }
}
