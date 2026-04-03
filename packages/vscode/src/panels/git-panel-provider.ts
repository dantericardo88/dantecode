// ============================================================================
// Git Operations Panel — Diff viewer, commit history, worktrees (DIRECT INTEGRATION)
// ============================================================================

import * as vscode from "vscode";
import type { VSCodeCommandBridge } from "../command-bridge.js";
import { getDiff, getStatus, autoCommit, type GitStatusResult } from "@dantecode/git-engine";
import type { GitCommitSpec } from "@dantecode/config-types";

export class GitPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.gitView";

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    _commandBridge: VSCodeCommandBridge,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtmlForWebview();

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; data?: unknown }) => {
      switch (message.type) {
        case "run_command":
          await this.handleCommand(message.data as { command: string; args?: string });
          break;
        case "ready":
          await this.refreshView();
          break;
      }
    });
  }

  private async handleCommand(data: { command: string; args?: string }): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!projectRoot) {
      await this.sendMessage({ type: "error", message: "No workspace open" });
      return;
    }

    try {
      switch (data.command) {
        case "diff":
          await this.showDiff(projectRoot);
          break;
        case "commit":
          await this.commitChanges(projectRoot);
          break;
        case "status":
          await this.showStatus(projectRoot);
          break;
        case "worktree":
          await this.createWorktreeDialog(projectRoot);
          break;
        default:
          await this.sendMessage({ type: "error", message: `Unknown command: ${data.command}` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sendMessage({ type: "error", message });
    }
  }

  private async showDiff(projectRoot: string): Promise<void> {
    const diff = getDiff(projectRoot);
    if (!diff || diff.trim().length === 0) {
      await this.sendMessage({ type: "info", message: "No changes to show" });
      void vscode.window.showInformationMessage("Git: No uncommitted changes");
      return;
    }
    // Send diff to webview for display (truncate for safety)
    await this.sendMessage({
      type: "diff_result",
      diff: diff.substring(0, 5000)
    });
  }

  private async commitChanges(projectRoot: string): Promise<void> {
    const message = await vscode.window.showInputBox({
      prompt: "Commit message",
      placeHolder: "feat: add new feature",
      validateInput: (value) => {
        if (value.trim().length < 3) {
          return "Commit message must be at least 3 characters";
        }
        return null;
      },
    });
    if (!message) return;

    const status: GitStatusResult = getStatus(projectRoot);
    const allFiles = [
      ...status.staged.map(s => s.path),
      ...status.unstaged.map(s => s.path),
    ];

    if (allFiles.length === 0) {
      void vscode.window.showWarningMessage("No files to commit");
      return;
    }

    const spec: GitCommitSpec = {
      files: allFiles,
      message,
      allowEmpty: false,
      footer: "\u{1F916} Generated with DanteCode VSCode Extension",
    };

    const result = autoCommit(spec, projectRoot);
    await this.sendMessage({
      type: "commit_result",
      commitHash: result.commitHash,
      filesCommitted: result.filesCommitted.length,
    });
    void vscode.window.showInformationMessage(
      `Committed ${result.filesCommitted.length} files: ${result.commitHash.substring(0, 7)}`
    );
  }

  private async showStatus(projectRoot: string): Promise<void> {
    const status: GitStatusResult = getStatus(projectRoot);
    const summary = {
      staged: status.staged.length,
      unstaged: status.unstaged.length,
      untracked: status.untracked.length,
      conflicted: status.conflicted.length,
    };
    await this.sendMessage({ type: "status_result", summary });

    const totalChanges = summary.staged + summary.unstaged + summary.untracked;
    void vscode.window.showInformationMessage(
      `Git: ${totalChanges} file(s) with changes (${summary.staged} staged)`
    );
  }

  private async createWorktreeDialog(_projectRoot: string): Promise<void> {
    // Worktree creation is more complex - keep as stub for now
    await this.sendMessage({ type: "info", message: "Worktree: integration pending" });
    void vscode.window.showInformationMessage("Worktree: Full integration coming soon");
  }

  private async sendMessage(message: unknown): Promise<void> {
    if (this.view) {
      await this.view.webview.postMessage(message);
    }
  }

  private async refreshView(): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (projectRoot) {
      await this.showStatus(projectRoot);
    }
  }

  private getHtmlForWebview(): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>Git Operations</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .section {
      margin-bottom: 16px;
      padding: 12px;
      background: var(--vscode-editorWidget-background);
      border-radius: 6px;
    }
    .section-title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    button {
      padding: 6px 12px;
      margin: 4px 4px 4px 0;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .output {
      margin-top: 12px;
      padding: 8px;
      background: var(--vscode-editor-background);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      max-height: 300px;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <div class="section">
    <div class="section-title">Quick Actions</div>
    <button onclick="runCommand('diff')">Show Diff</button>
    <button onclick="runCommand('commit')">Commit</button>
    <button onclick="runCommand('revert')">Revert</button>
  </div>

  <div class="section">
    <div class="section-title">Recovery</div>
    <button class="btn-secondary" onclick="runCommand('undo')">Undo</button>
    <button class="btn-secondary" onclick="runCommand('restore')">Restore</button>
    <button class="btn-secondary" onclick="runCommand('recover', 'list')">List Sessions</button>
  </div>

  <div class="section">
    <div class="section-title">Worktrees</div>
    <button class="btn-secondary" onclick="runCommand('worktree')">Create Worktree</button>
  </div>

  <div class="section">
    <div class="section-title">Advanced</div>
    <button class="btn-secondary" onclick="runCommand('timeline')">Timeline</button>
    <button class="btn-secondary" onclick="runCommand('lfs', 'status')">LFS Status</button>
    <button class="btn-secondary" onclick="runCommand('fork')">Fork Session</button>
  </div>

  <div id="output" class="output" style="display: none;"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const outputEl = document.getElementById('output');

    function runCommand(command, args) {
      outputEl.style.display = 'block';
      outputEl.innerHTML = 'Running /' + command + '...';
      vscode.postMessage({ type: 'run_command', data: { command, args } });
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'slash_command_result') {
        outputEl.innerHTML = message.result || message.error || 'Command completed';
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
