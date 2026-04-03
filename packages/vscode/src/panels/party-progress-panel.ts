// ============================================================================
// Party Mode Progress Panel — Live event-driven updates from CouncilOrchestrator
// ============================================================================

import * as vscode from "vscode";
import { getPartyModeStatus, getActiveRunId } from "../core-integrations/party-integration.js";

export class PartyProgressPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.partyProgressView";

  private view: vscode.WebviewView | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    _context: vscode.ExtensionContext,
  ) {
    // Listen for party mode events
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Register command listeners for party mode events
    this.disposables.push(
      vscode.commands.registerCommand("dantecode.partyStatus", (event: any) => {
        void this.handleStatusUpdate(event);
      })
    );

    this.disposables.push(
      vscode.commands.registerCommand("dantecode.partyAgentAdded", (event: any) => {
        void this.handleAgentAdded(event);
      })
    );

    this.disposables.push(
      vscode.commands.registerCommand("dantecode.partyAgentCompleted", (event: any) => {
        void this.handleAgentCompleted(event);
      })
    );

    this.disposables.push(
      vscode.commands.registerCommand("dantecode.partyAgentVerified", (event: any) => {
        void this.handleAgentVerified(event);
      })
    );
  }

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

    // Send current status on load
    const status = getPartyModeStatus();
    const runId = getActiveRunId();

    if (status && runId) {
      void this.sendMessage({
        type: "status_update",
        status,
        runId,
      });
    }
  }

  private async handleStatusUpdate(event: { status: string; runId: string }): Promise<void> {
    await this.sendMessage({
      type: "status_update",
      status: event.status,
      runId: event.runId,
    });
  }

  private async handleAgentAdded(event: { laneId: string; agentKind: string; objective?: string }): Promise<void> {
    await this.sendMessage({
      type: "agent_added",
      laneId: event.laneId,
      agentKind: event.agentKind,
      objective: event.objective || "",
    });
  }

  private async handleAgentCompleted(event: { laneId: string }): Promise<void> {
    await this.sendMessage({
      type: "agent_completed",
      laneId: event.laneId,
    });
  }

  private async handleAgentVerified(event: { laneId: string; score?: number }): Promise<void> {
    await this.sendMessage({
      type: "agent_verified",
      laneId: event.laneId,
      score: event.score || 0,
    });
  }

  private async sendMessage(message: unknown): Promise<void> {
    if (this.view) {
      await this.view.webview.postMessage(message);
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
  <title>Party Mode Progress</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    h2 {
      font-size: 14px;
      margin: 0 0 12px 0;
      font-weight: 600;
    }
    .status-bar {
      padding: 8px 12px;
      margin-bottom: 16px;
      background: var(--vscode-editorWidget-background);
      border-radius: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .status-idle { color: var(--vscode-descriptionForeground); }
    .status-running { color: var(--vscode-terminal-ansiGreen); }
    .status-completed { color: var(--vscode-terminal-ansiBlue); }
    .status-failed { color: var(--vscode-terminal-ansiRed); }
    .status-blocked { color: var(--vscode-terminal-ansiYellow); }
    .agent-card {
      margin-bottom: 12px;
      padding: 12px;
      background: var(--vscode-editorWidget-background);
      border-radius: 6px;
      border-left: 3px solid var(--vscode-terminal-ansiGreen);
    }
    .agent-card.completed {
      border-left-color: var(--vscode-terminal-ansiBlue);
      opacity: 0.8;
    }
    .agent-card.failed {
      border-left-color: var(--vscode-terminal-ansiRed);
    }
    .agent-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .agent-name {
      font-weight: 600;
      font-size: 13px;
    }
    .agent-status {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .agent-objective {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
    .agent-score {
      font-size: 12px;
      margin-top: 6px;
      color: var(--vscode-terminal-ansiGreen);
    }
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <h2>Party Mode Progress</h2>

  <div class="status-bar">
    <div>
      <span class="status-label">Status:</span>
      <span id="run-status" class="status-idle">Idle</span>
    </div>
    <div id="run-id" style="font-size: 11px; color: var(--vscode-descriptionForeground);"></div>
  </div>

  <div id="agents-container">
    <div class="empty-state">
      No active party mode session.<br>
      Launch party mode to see live agent progress here.
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const agentsContainer = document.getElementById('agents-container');
      const runStatusEl = document.getElementById('run-status');
      const runIdEl = document.getElementById('run-id');

      const agents = new Map();

      window.addEventListener('message', (event) => {
        const message = event.data;

        switch (message.type) {
          case 'status_update':
            updateStatus(message.status, message.runId);
            break;
          case 'agent_added':
            addAgent(message.laneId, message.agentKind, message.objective);
            break;
          case 'agent_completed':
            updateAgentStatus(message.laneId, 'completed');
            break;
          case 'agent_verified':
            updateAgentScore(message.laneId, message.score);
            break;
        }
      });

      function updateStatus(status, runId) {
        runStatusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        runStatusEl.className = 'status-' + status.toLowerCase();

        if (runId) {
          runIdEl.textContent = 'Run: ' + runId.substring(0, 8) + '...';
        }

        // Remove empty state
        if (status !== 'idle') {
          const emptyState = agentsContainer.querySelector('.empty-state');
          if (emptyState) {
            emptyState.remove();
          }
        }
      }

      function addAgent(laneId, agentKind, objective) {
        const card = document.createElement('div');
        card.className = 'agent-card';
        card.id = 'agent-' + laneId;
        card.innerHTML = \`
          <div class="agent-header">
            <div class="agent-name">\${agentKind}</div>
            <div class="agent-status">Running</div>
          </div>
          <div class="agent-objective">\${objective}</div>
          <div class="agent-score"></div>
        \`;

        agents.set(laneId, card);
        agentsContainer.appendChild(card);
      }

      function updateAgentStatus(laneId, status) {
        const card = agents.get(laneId);
        if (card) {
          card.className = 'agent-card ' + status;
          const statusEl = card.querySelector('.agent-status');
          if (statusEl) {
            statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
          }
        }
      }

      function updateAgentScore(laneId, score) {
        const card = agents.get(laneId);
        if (card) {
          const scoreEl = card.querySelector('.agent-score');
          if (scoreEl) {
            scoreEl.textContent = 'PDSE Score: ' + score.toFixed(2);
          }
        }
      }
    })();
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
