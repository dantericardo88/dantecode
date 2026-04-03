// ============================================================================
// DanteCode VS Code Extension — Visual Diff Viewer
// Provides split-pane diff view with syntax highlighting, better than CLI
// ============================================================================

import * as vscode from "vscode";
import { basename } from "node:path";

/**
 * Open a visual diff comparison between two versions of a file.
 * Uses VSCode's native diff editor for syntax-highlighted split pane.
 */
export async function showDiffViewer(options: {
  oldContent: string;
  newContent: string;
  filePath: string;
  title?: string;
}): Promise<void> {
  const { oldContent, newContent, filePath, title } = options;

  // Create temporary URIs for diff comparison
  const fileName = basename(filePath);
  const leftUri = vscode.Uri.parse(
    `dantecode-diff:/${fileName}?side=left&path=${encodeURIComponent(filePath)}`
  );
  const rightUri = vscode.Uri.parse(
    `dantecode-diff:/${fileName}?side=right&path=${encodeURIComponent(filePath)}`
  );

  // Store content in cache for retrieval
  DiffContentCache.set(leftUri.toString(), oldContent);
  DiffContentCache.set(rightUri.toString(), newContent);

  // Open diff editor
  const diffTitle = title || `${fileName} (Before ↔ After)`;
  await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, diffTitle);
}

/**
 * Show diff for a file change with automatic cleanup.
 */
export async function showFileDiff(options: {
  filePath: string;
  oldContent: string;
  newContent: string;
  label?: string;
}): Promise<void> {
  const { filePath, oldContent, newContent, label } = options;
  const fileName = basename(filePath);
  const title = label || `Changes: ${fileName}`;

  await showDiffViewer({
    oldContent,
    newContent,
    filePath,
    title,
  });
}

/**
 * Show diff between current file state and a modified version.
 */
export async function showCurrentFileDiff(
  filePath: string,
  modifiedContent: string,
  label?: string
): Promise<void> {
  const currentUri = vscode.Uri.file(filePath);
  let currentContent = "";

  try {
    const doc = await vscode.workspace.openTextDocument(currentUri);
    currentContent = doc.getText();
  } catch {
    // File might not exist yet
    currentContent = "";
  }

  await showFileDiff({
    filePath,
    oldContent: currentContent,
    newContent: modifiedContent,
    label: label || `Current vs Modified: ${basename(filePath)}`,
  });
}

/**
 * In-memory cache for diff content (temporary URIs).
 * Cleared when diff editor is closed.
 */
class DiffContentCacheImpl {
  private cache = new Map<string, string>();

  set(uri: string, content: string): void {
    this.cache.set(uri, content);
  }

  get(uri: string): string | undefined {
    return this.cache.get(uri);
  }

  clear(uri: string): void {
    this.cache.delete(uri);
  }

  clearAll(): void {
    this.cache.clear();
  }
}

export const DiffContentCache = new DiffContentCacheImpl();

/**
 * TextDocumentContentProvider for virtual diff URIs.
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return DiffContentCache.get(uri.toString()) || "";
  }
}

/**
 * Register the diff viewer with VSCode.
 */
export function registerDiffViewer(context: vscode.ExtensionContext): void {
  // Register content provider for virtual diff URIs
  const provider = new DiffContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("dantecode-diff", provider)
  );

  // Command to show diff from any source
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dantecode.showDiff",
      async (oldContent: string, newContent: string, filePath: string, title?: string) => {
        await showDiffViewer({ oldContent, newContent, filePath, title });
      }
    )
  );

  // Command to show diff for current file
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dantecode.showCurrentFileDiff",
      async (filePath?: string, modifiedContent?: string) => {
        if (!filePath || !modifiedContent) {
          void vscode.window.showErrorMessage("Missing file path or content for diff");
          return;
        }
        await showCurrentFileDiff(filePath, modifiedContent);
      }
    )
  );

  // Clean up cache on editor close
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === "dantecode-diff") {
        DiffContentCache.clear(doc.uri.toString());
      }
    })
  );
}

/**
 * Parse git diff output and show in visual diff viewer.
 */
export async function showGitDiff(diffOutput: string, filePath: string): Promise<void> {
  const { before, after } = parseGitDiff(diffOutput);
  await showFileDiff({
    filePath,
    oldContent: before,
    newContent: after,
    label: `Git Diff: ${basename(filePath)}`,
  });
}

/**
 * Parse simple unified diff format to extract before/after content.
 */
function parseGitDiff(diff: string): { before: string; after: string } {
  const lines = diff.split("\n");
  const beforeLines: string[] = [];
  const afterLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("-")) {
      beforeLines.push(line.slice(1));
    } else if (line.startsWith("+")) {
      afterLines.push(line.slice(1));
    } else {
      // Context line
      beforeLines.push(line.startsWith(" ") ? line.slice(1) : line);
      afterLines.push(line.startsWith(" ") ? line.slice(1) : line);
    }
  }

  return {
    before: beforeLines.join("\n"),
    after: afterLines.join("\n"),
  };
}
