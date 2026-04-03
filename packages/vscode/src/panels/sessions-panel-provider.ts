// ============================================================================
// Sessions Panel — History, export, import, branching (DIRECT INTEGRATION)
// ============================================================================

import * as vscode from "vscode";

import { SessionStore, type SessionListEntry } from "@dantecode/core";

export class SessionsPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.sessionsView";

  private view: vscode.WebviewView | undefined;
  private sessionStore: SessionStore | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
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

  private getSessionStore(projectRoot: string): SessionStore {
    if (!this.sessionStore) {
      this.sessionStore = new SessionStore(projectRoot);
    }
    return this.sessionStore;
  }

  private async handleCommand(data: { command: string; args?: string }): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!projectRoot) {
      await this.sendMessage({ type: "error", message: "No workspace open" });
      return;
    }

    try {
      switch (data.command) {
        case "list":
          await this.listSessions(projectRoot);
          break;
        case "resume":
          if (data.args) {
            await this.resumeSession(data.args, projectRoot);
          }
          break;
        case "export":
          if (data.args) {
            await this.exportSession(data.args, projectRoot);
          }
          break;
        default:
          await this.sendMessage({ type: "error", message: `Unknown command: ${data.command}` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sendMessage({ type: "error", message });
    }
  }

  private async listSessions(projectRoot: string): Promise<void> {
    const store = this.getSessionStore(projectRoot);
    const sessions: SessionListEntry[] = await store.list();

    await this.sendMessage({
      type: "sessions_list",
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messageCount,
        summary: s.summary || "No summary available",
      })),
    });
  }

  private async resumeSession(sessionId: string, projectRoot: string): Promise<void> {
    const store = this.getSessionStore(projectRoot);
    const session = await store.load(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Fire VS Code command to resume session in chat
    await vscode.commands.executeCommand("dantecode.resumeSession", session);
    void vscode.window.showInformationMessage(`Resumed session: ${session.title}`);
  }

  private async exportSession(sessionId: string, projectRoot: string): Promise<void> {
    const store = this.getSessionStore(projectRoot);
    const session = await store.load(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const exportPath = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${sessionId}.json`),
      filters: { JSON: ["json"] },
    });

    if (exportPath) {
      await vscode.workspace.fs.writeFile(exportPath, Buffer.from(JSON.stringify(session, null, 2)));
      void vscode.window.showInformationMessage(`Exported to ${exportPath.fsPath}`);
    }
  }

  private async sendMessage(message: unknown): Promise<void> {
    if (this.view) {
      await this.view.webview.postMessage(message);
    }
  }

  private async refreshView(): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (projectRoot) {
      await this.listSessions(projectRoot);
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
  <title>Session Management</title>
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
    .input-group {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    input {
      flex: 1;
      padding: 6px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      font-size: 12px;
    }
    .output {
      margin-top: 12px;
      padding: 8px;
      background: var(--vscode-editor-background);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      max-height: 400px;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <div class="section">
    <div class="section-title">Current Session</div>
    <div class="input-group">
      <input type="text" id="sessionName" placeholder="Session name..." />
      <button onclick="nameSession()">Rename</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Session Actions</div>
    <button onclick="runCommand('history')">History</button>
    <button onclick="runCommand('branch')">Branch</button>
    <button onclick="runCommand('export', 'json')">Export JSON</button>
    <button onclick="runCommand('export', 'md')">Export Markdown</button>
  </div>

  <div class="section">
    <div class="section-title">Resume &amp; Replay</div>
    <button class="btn-secondary" onclick="runCommand('resume-checkpoint')">List Checkpoints</button>
    <button class="btn-secondary" onclick="runCommand('runs')">List Runs</button>
    <button class="btn-secondary" onclick="runCommand('replay')">Replay</button>
  </div>

  <div class="section">
    <div class="section-title">Import</div>
    <div class="input-group">
      <input type="text" id="importPath" placeholder="Path to session.json..." />
      <button onclick="importSession()">Import</button>
    </div>
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

    function nameSession() {
      const name = document.getElementById('sessionName').value;
      if (name) {
        runCommand('name', name);
      } else {
        outputEl.style.display = 'block';
        outputEl.innerHTML = '<span style="color: var(--vscode-errorForeground)">Please enter a session name</span>';
      }
    }

    function importSession() {
      const path = document.getElementById('importPath').value;
      if (path) {
        runCommand('import', path);
      } else {
        outputEl.style.display = 'block';
        outputEl.innerHTML = '<span style="color: var(--vscode-errorForeground)">Please enter a path</span>';
      }
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
