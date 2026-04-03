// ============================================================================
// Git Operations Panel — Diff viewer, commit history, worktrees
// ============================================================================

import * as vscode from "vscode";
import type { VSCodeCommandBridge } from "../command-bridge.js";

export class GitPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.gitView";

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly commandBridge: VSCodeCommandBridge,
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
    // Forward to command bridge
    if (this.view) {
      await this.view.webview.postMessage({
        type: "slash_command",
        command: data.command,
        args: data.args,
      });
    }
  }

  private async refreshView(): Promise<void> {
    // Initial load - could fetch git status here
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
