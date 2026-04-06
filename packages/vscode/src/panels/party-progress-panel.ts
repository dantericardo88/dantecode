// ============================================================================
// Party Mode Progress Panel — Live event-driven updates from CouncilOrchestrator
// ============================================================================

import * as vscode from "vscode";
import {
  getPartyModeStatus,
  getActiveRunId,
  getPartyRunState,
} from "../core-integrations/party-integration.js";

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

    this.disposables.push(
      vscode.commands.registerCommand("dantecode.partyAgentMetrics", (event: any) => {
        void this.handleAgentMetrics(event);
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

    // Send current status + any existing run state on load
    const status = getPartyModeStatus();
    const runId = getActiveRunId();
    const runState = getPartyRunState();

    if (status && runId) {
      void this.sendMessage({
        type: "status_update",
        status,
        runId,
      });
    }

    if (runState) {
      for (const lane of runState.lanes.values()) {
        void this.sendMessage({
          type: "agent_added",
          laneId: lane.laneId,
          agentKind: lane.agentKind,
          objective: lane.objective,
        });
        if (lane.status === "completed" || lane.status === "failed") {
          void this.sendMessage({
            type: "agent_completed",
            laneId: lane.laneId,
            status: lane.status,
          });
        }
        if (lane.pdseScore !== undefined) {
          void this.sendMessage({
            type: "agent_verified",
            laneId: lane.laneId,
            score: lane.pdseScore,
          });
        }
        if (lane.tokensUsed > 0 || lane.filesModified > 0) {
          void this.sendMessage({
            type: "agent_metrics",
            laneId: lane.laneId,
            tokensUsed: lane.tokensUsed,
            filesModified: lane.filesModified,
            durationMs: lane.durationMs,
          });
        }
      }
      void this.sendMessage({
        type: "summary_update",
        totalTokens: runState.totalTokens,
        totalFiles: runState.totalFiles,
      });
    }
  }

  /** Called by the integration whenever a lane's metrics change. */
  public postMetricsUpdate(laneId: string, tokensUsed: number, filesModified: number, durationMs?: number): void {
    void this.sendMessage({
      type: "agent_metrics",
      laneId,
      tokensUsed,
      filesModified,
      durationMs,
    });
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

  private async handleAgentCompleted(event: { laneId: string; status?: string }): Promise<void> {
    await this.sendMessage({
      type: "agent_completed",
      laneId: event.laneId,
      status: event.status ?? "completed",
    });
  }

  private async handleAgentMetrics(event: {
    laneId: string;
    tokensUsed?: number;
    filesModified?: number;
    durationMs?: number;
  }): Promise<void> {
    await this.sendMessage({
      type: "agent_metrics",
      laneId: event.laneId,
      tokensUsed: event.tokensUsed ?? 0,
      filesModified: event.filesModified ?? 0,
      durationMs: event.durationMs,
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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      padding: 12px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }

    /* ── Header ───────────────────────────────────────────────── */
    .party-dashboard h2 {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 12px;
      letter-spacing: 0.02em;
    }

    /* ── Status bar ───────────────────────────────────────────── */
    .status-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 7px 10px;
      margin-bottom: 14px;
      background: var(--vscode-editorWidget-background);
      border-radius: 6px;
      font-size: 12px;
    }
    .dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
      vertical-align: middle;
    }
    .dot-idle     { background: var(--vscode-descriptionForeground); }
    .dot-planning { background: var(--vscode-terminal-ansiYellow); animation: pulse 1s infinite; }
    .dot-running  { background: var(--vscode-terminal-ansiGreen);  animation: pulse 0.8s infinite; }
    .dot-completed{ background: var(--vscode-terminal-ansiBlue); }
    .dot-failed   { background: var(--vscode-terminal-ansiRed); }
    @keyframes pulse {
      0%,100% { opacity: 1; }
      50%      { opacity: 0.35; }
    }
    .run-id-label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family, monospace);
    }

    /* ── Lanes grid ───────────────────────────────────────────── */
    .lanes-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 14px;
    }
    .lane-card {
      padding: 10px 12px;
      background: var(--vscode-editorWidget-background);
      border-radius: 6px;
      border-left: 3px solid var(--vscode-terminal-ansiGreen);
      transition: border-left-color 0.25s;
    }
    .lane-card.pending  { border-left-color: var(--vscode-descriptionForeground); opacity: 0.7; }
    .lane-card.running  { border-left-color: var(--vscode-terminal-ansiGreen); }
    .lane-card.completed{ border-left-color: var(--vscode-terminal-ansiBlue); }
    .lane-card.failed   { border-left-color: var(--vscode-terminal-ansiRed); }
    .lane-card.frozen   { border-left-color: var(--vscode-terminal-ansiYellow); }

    .lane-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 5px;
    }
    .lane-name {
      font-weight: 600;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .lane-status-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .lane-objective {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 7px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lane-metrics {
      display: flex;
      gap: 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .metric {
      display: flex;
      align-items: center;
      gap: 3px;
    }
    .metric-val {
      color: var(--vscode-foreground);
      font-weight: 600;
    }
    .pdse-score {
      margin-top: 5px;
      font-size: 11px;
    }
    .pdse-good    { color: var(--vscode-terminal-ansiGreen); }
    .pdse-warning { color: var(--vscode-terminal-ansiYellow); }
    .pdse-bad     { color: var(--vscode-terminal-ansiRed); }

    /* ── Summary bar ──────────────────────────────────────────── */
    .summary {
      padding: 8px 10px;
      background: var(--vscode-editorWidget-background);
      border-radius: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      gap: 16px;
    }
    .summary .metric-val { color: var(--vscode-foreground); }

    /* ── Empty state ──────────────────────────────────────────── */
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="party-dashboard">
    <h2>Party Mode</h2>

    <div class="status-bar">
      <div>
        <span class="dot dot-idle" id="status-dot"></span>
        <span id="run-status">Idle</span>
      </div>
      <div class="run-id-label" id="run-id"></div>
    </div>

    <div class="lanes-grid" id="lanes-grid">
      <div class="empty-state" id="empty-state">
        No active party mode session.<br>
        Launch party mode to see live agent progress here.
      </div>
    </div>

    <div class="summary" id="summary" style="display:none;">
      <span class="metric">Files: <span class="metric-val" id="total-files">0</span></span>
      <span class="metric">Tokens: <span class="metric-val" id="total-tokens">0</span></span>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const lanesGrid   = document.getElementById('lanes-grid');
      const runStatusEl = document.getElementById('run-status');
      const statusDot   = document.getElementById('status-dot');
      const runIdEl     = document.getElementById('run-id');
      const summaryEl   = document.getElementById('summary');
      const totalFilesEl  = document.getElementById('total-files');
      const totalTokensEl = document.getElementById('total-tokens');

      /** @type {Map<string, HTMLElement>} */
      const laneCards = new Map();
      let totalFiles  = 0;
      let totalTokens = 0;

      // ── Helpers ───────────────────────────────────────────────

      function esc(s) {
        return String(s)
          .replace(/&/g,'&amp;').replace(/</g,'&lt;')
          .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

      function fmtTokens(n) {
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return String(n);
      }

      function fmtDuration(ms) {
        if (ms === undefined || ms === null) return '—';
        if (ms < 1000) return ms + 'ms';
        if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
        return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's';
      }

      function statusColor(status) {
        switch (status) {
          case 'running':   return 'dot-running';
          case 'completed': return 'dot-completed';
          case 'failed':    return 'dot-bad';
          case 'frozen':    return 'dot-warning';
          case 'pending':   return 'dot-idle';
          default:          return 'dot-idle';
        }
      }

      function pdseClass(score) {
        if (score >= 80) return 'pdse-good';
        if (score >= 60) return 'pdse-warning';
        return 'pdse-bad';
      }

      function removeEmptyState() {
        const e = document.getElementById('empty-state');
        if (e) e.remove();
      }

      // ── Message handlers ──────────────────────────────────────

      function onStatusUpdate(msg) {
        const s = (msg.status || 'idle').toLowerCase();
        runStatusEl.textContent = s.charAt(0).toUpperCase() + s.slice(1);
        statusDot.className = 'dot ' + statusColor(s);
        if (msg.runId) {
          runIdEl.textContent = 'Run ' + msg.runId.substring(0, 8) + '…';
        }
        if (s !== 'idle') removeEmptyState();
        if (s === 'completed' || s === 'failed') {
          summaryEl.style.display = 'flex';
        }
      }

      function onAgentAdded(msg) {
        removeEmptyState();
        if (laneCards.has(msg.laneId)) return;

        const card = document.createElement('div');
        card.className = 'lane-card pending';
        card.id = 'lane-' + msg.laneId;
        card.innerHTML =
          '<div class="lane-header">' +
            '<div class="lane-name">' +
              '<span class="dot dot-idle" id="dot-' + esc(msg.laneId) + '"></span>' +
              esc(msg.agentKind) +
            '</div>' +
            '<span class="lane-status-badge" id="badge-' + esc(msg.laneId) + '">Pending</span>' +
          '</div>' +
          (msg.objective
            ? '<div class="lane-objective" id="obj-' + esc(msg.laneId) + '">' + esc(msg.objective) + '</div>'
            : '<div class="lane-objective" id="obj-' + esc(msg.laneId) + '"></div>') +
          '<div class="lane-metrics">' +
            '<span class="metric">Files:&nbsp;<span class="metric-val" id="files-' + esc(msg.laneId) + '">—</span></span>' +
            '<span class="metric">Tokens:&nbsp;<span class="metric-val" id="tokens-' + esc(msg.laneId) + '">—</span></span>' +
            '<span class="metric">Duration:&nbsp;<span class="metric-val" id="dur-' + esc(msg.laneId) + '">—</span></span>' +
          '</div>' +
          '<div class="pdse-score" id="pdse-' + esc(msg.laneId) + '"></div>';

        laneCards.set(msg.laneId, card);
        lanesGrid.appendChild(card);

        // Transition to running after a tick (new lanes start running)
        setTimeout(() => setLaneStatus(msg.laneId, 'running'), 50);
      }

      function setLaneStatus(laneId, status) {
        const card = laneCards.get(laneId);
        if (!card) return;
        card.className = 'lane-card ' + status;
        const badge = document.getElementById('badge-' + laneId);
        if (badge) badge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        const dot = document.getElementById('dot-' + laneId);
        if (dot) dot.className = 'dot ' + statusColor(status);
      }

      function onAgentCompleted(msg) {
        setLaneStatus(msg.laneId, msg.status || 'completed');
      }

      function onAgentVerified(msg) {
        const pdseEl = document.getElementById('pdse-' + msg.laneId);
        if (pdseEl) {
          const cls = pdseClass(msg.score || 0);
          pdseEl.innerHTML =
            'PDSE Score: <span class="' + cls + '">' + (msg.score || 0).toFixed(1) + '</span>';
        }
      }

      function onAgentMetrics(msg) {
        const filesEl  = document.getElementById('files-'  + msg.laneId);
        const tokensEl = document.getElementById('tokens-' + msg.laneId);
        const durEl    = document.getElementById('dur-'    + msg.laneId);
        if (filesEl)  filesEl.textContent  = String(msg.filesModified  || 0);
        if (tokensEl) tokensEl.textContent = fmtTokens(msg.tokensUsed || 0);
        if (durEl)    durEl.textContent    = fmtDuration(msg.durationMs);
      }

      function onSummaryUpdate(msg) {
        totalFiles  = msg.totalFiles  || 0;
        totalTokens = msg.totalTokens || 0;
        totalFilesEl.textContent  = String(totalFiles);
        totalTokensEl.textContent = fmtTokens(totalTokens);
        summaryEl.style.display = 'flex';
      }

      // ── Message router ────────────────────────────────────────

      window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.type) {
          case 'status_update':   onStatusUpdate(msg);   break;
          case 'agent_added':     onAgentAdded(msg);     break;
          case 'agent_completed': onAgentCompleted(msg); break;
          case 'agent_verified':  onAgentVerified(msg);  break;
          case 'agent_metrics':   onAgentMetrics(msg);   break;
          case 'summary_update':  onSummaryUpdate(msg);  break;
        }
      });
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
