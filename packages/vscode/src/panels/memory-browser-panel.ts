// ============================================================================
// Memory Browser Panel — Semantic search, visualization, pruning
// ============================================================================

import * as vscode from "vscode";
import { memoryRecall, getMemoryStats, memoryPrune, memoryVisualize } from "../core-integrations/memory-integration.js";

export class MemoryBrowserPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.memoryBrowserView";

  private view: vscode.WebviewView | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    _context: vscode.ExtensionContext,
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

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message: { type: string; data?: any }) => {
      switch (message.type) {
        case "search":
          await this.handleSearch(message.data.query, message.data.limit);
          break;
        case "visualize":
          await this.handleVisualize();
          break;
        case "prune":
          await this.handlePrune(message.data.days);
          break;
        case "stats":
          await this.handleStats();
          break;
        case "ready":
          await this.handleStats(); // Load stats on initial load
          break;
      }
    });
  }

  private async handleSearch(query: string, limit: number = 20): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!projectRoot) {
      await this.sendMessage({ type: "error", message: "No workspace open" });
      return;
    }

    try {
      const results = await memoryRecall(query, projectRoot, limit);
      await this.sendMessage({
        type: "search_results",
        items: results.items.map((item: any) => ({
          content: item.content,
          relevanceScore: item.relevanceScore || 0,
          timestamp: item.timestamp,
          scope: item.scope,
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sendMessage({ type: "error", message });
    }
  }

  private async handleVisualize(): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!projectRoot) {
      await this.sendMessage({ type: "error", message: "No workspace open" });
      return;
    }

    try {
      const graph = await memoryVisualize(projectRoot);
      await this.sendMessage({
        type: "visualization",
        graph,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sendMessage({ type: "error", message });
    }
  }

  private async handlePrune(days: number = 30): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!projectRoot) {
      await this.sendMessage({ type: "error", message: "No workspace open" });
      return;
    }

    try {
      const removed = await memoryPrune(projectRoot, days);
      await this.sendMessage({
        type: "prune_result",
        removed,
      });
      void vscode.window.showInformationMessage(`Memory pruned: ${removed} items removed`);
      // Refresh stats after pruning
      await this.handleStats();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sendMessage({ type: "error", message });
    }
  }

  private async handleStats(): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!projectRoot) {
      await this.sendMessage({ type: "error", message: "No workspace open" });
      return;
    }

    try {
      const stats = await getMemoryStats(projectRoot);
      await this.sendMessage({
        type: "stats_result",
        totalItems: stats.totalItems,
        utilizationPercent: stats.utilizationPercent,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sendMessage({ type: "error", message });
    }
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
  <title>Memory Browser</title>
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
    .input-group {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
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
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 12px;
    }
    .stat-item {
      padding: 8px;
      background: var(--vscode-editor-background);
      border-radius: 4px;
      font-size: 12px;
    }
    .stat-label {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .stat-value {
      font-size: 16px;
      font-weight: 600;
      margin-top: 4px;
    }
    .memory-item {
      margin-bottom: 8px;
      padding: 8px;
      background: var(--vscode-editor-background);
      border-radius: 4px;
      border-left: 3px solid var(--vscode-terminal-ansiGreen);
      font-size: 12px;
    }
    .memory-content {
      margin-bottom: 4px;
      line-height: 1.4;
    }
    .memory-meta {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--vscode-descriptionForeground);
    }
    #results {
      max-height: 400px;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <h2>Memory Browser</h2>

  <div class="section">
    <div class="section-title">Memory Statistics</div>
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-label">Total Items</div>
        <div class="stat-value" id="stat-total">0</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Utilization</div>
        <div class="stat-value" id="stat-util">0%</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Search Memory</div>
    <div class="input-group">
      <input type="text" id="search-input" placeholder="Search semantic memory..." />
      <button onclick="search()">Search</button>
    </div>
  </div>

  <div id="results">
    <div class="empty-state">
      Enter a search query to explore memory.
    </div>
  </div>

  <div class="section">
    <div class="section-title">Memory Management</div>
    <button class="btn-secondary" onclick="visualize()">Visualize Graph</button>
    <button class="btn-secondary" onclick="prune()">Prune Old (30d)</button>
    <button class="btn-secondary" onclick="refreshStats()">Refresh Stats</button>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const resultsContainer = document.getElementById('results');

      window.addEventListener('message', (event) => {
        const message = event.data;

        switch (message.type) {
          case 'stats_result':
            updateStats(message);
            break;
          case 'search_results':
            displayResults(message.items);
            break;
          case 'prune_result':
            showMessage('Pruned ' + message.removed + ' items');
            break;
          case 'visualization':
            displayVisualization(message.graph);
            break;
          case 'error':
            showMessage('Error: ' + message.message);
            break;
        }
      });

      function updateStats(stats) {
        document.getElementById('stat-total').textContent = stats.totalItems || 0;
        document.getElementById('stat-util').textContent = (stats.utilizationPercent || 0).toFixed(0) + '%';
      }

      function displayResults(items) {
        if (!items || items.length === 0) {
          resultsContainer.innerHTML = '<div class="empty-state">No results found.</div>';
          return;
        }

        resultsContainer.innerHTML = items.map(item => \`
          <div class="memory-item">
            <div class="memory-content">\${escapeHtml(item.content)}</div>
            <div class="memory-meta">
              <span>Score: \${item.relevanceScore.toFixed(2)}</span>
              <span>\${item.scope || 'session'}</span>
            </div>
          </div>
        \`).join('');
      }

      function displayVisualization(graph) {
        // Simple text representation for now
        resultsContainer.innerHTML = '<div class="empty-state">Memory graph generated. See console.</div>';
        console.log('Memory Graph:', graph);
      }

      function showMessage(msg) {
        const temp = document.createElement('div');
        temp.className = 'empty-state';
        temp.textContent = msg;
        resultsContainer.innerHTML = '';
        resultsContainer.appendChild(temp);
      }

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      window.search = function() {
        const query = document.getElementById('search-input').value;
        if (query.trim()) {
          vscode.postMessage({ type: 'search', data: { query, limit: 20 } });
        }
      };

      window.visualize = function() {
        vscode.postMessage({ type: 'visualize' });
      };

      window.prune = function() {
        if (confirm('Remove memory items older than 30 days?')) {
          vscode.postMessage({ type: 'prune', data: { days: 30 } });
        }
      };

      window.refreshStats = function() {
        vscode.postMessage({ type: 'stats' });
      };

      // Load initial stats
      vscode.postMessage({ type: 'ready' });
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
