// Agents Window for VS Code: Multi-agent parallel, worktree isolation
// Stolen from Cursor

import * as vscode from 'vscode';

export class AgentsWindow {
  constructor() {
    this.registerCommands();
  }

  registerCommands() {
    vscode.commands.registerCommand('dantecode.agents.open', this.openAgentsWindow);
  }

  async openAgentsWindow() {
    const panel = vscode.window.createWebviewPanel(
      'danteAgents',
      'DanteCode Agents',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    panel.webview.html = this.getHtml();
  }

  getHtml() {
    return `
      <html>
        <body>
          <h1>Agents Window</h1>
          <button onclick="launchParallel()">Launch Parallel Agents</button>
          <div id="results"></div>
        </body>
      </html>
    `;
  }
}