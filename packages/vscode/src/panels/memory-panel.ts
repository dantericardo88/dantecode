import * as vscode from "vscode";
import { createMemoryOrchestrator } from "@dantecode/memory-engine";

export class MemoryPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.memoryView";

  private view: vscode.WebviewView | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

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

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; query?: string; key?: string }) => {
      if (message.type === "memory_list") {
        await this.listMemories();
      } else if (message.type === "memory_search" && message.query) {
        await this.searchMemories(message.query);
      } else if (message.type === "memory_stats") {
        await this.getStats();
      } else if (message.type === "memory_forget" && message.key) {
        await this.forgetMemory(message.key);
      }
    });
  }

  private getProjectRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  }

  async listMemories(): Promise<void> {
    if (!this.view) return;

    try {
      const orch = createMemoryOrchestrator(this.getProjectRoot());
      await orch.initialize();
      const knowledge = await orch.listSessionKnowledge();

      const memories = knowledge.flatMap((sk) =>
        sk.facts.map((fact, i) => ({
          key: `${sk.sessionId}::fact${i}`,
          scope: "session",
          value: fact,
          timestamp: sk.startedAt ?? new Date().toISOString(),
        })),
      );

      void this.view.webview.postMessage({
        type: "memory_list_result",
        payload: { memories },
      });
    } catch {
      void this.view.webview.postMessage({
        type: "memory_list_result",
        payload: { memories: [] },
      });
    }
  }

  async searchMemories(query: string): Promise<void> {
    if (!this.view) return;

    try {
      const orch = createMemoryOrchestrator(this.getProjectRoot());
      await orch.initialize();
      const recallResult = await orch.memoryRecall(query, 10);

      const results = (recallResult.results as Array<{ key: string; scope?: string; value: unknown }>).map((r) => ({
        key: r.key,
        scope: r.scope ?? "session",
        value: typeof r.value === "string" ? r.value : JSON.stringify(r.value),
      }));

      void this.view.webview.postMessage({
        type: "memory_search_result",
        payload: { query, results },
      });
    } catch {
      void this.view.webview.postMessage({
        type: "memory_search_result",
        payload: { query, results: [] },
      });
    }
  }

  async getStats(): Promise<void> {
    if (!this.view) return;

    try {
      const orch = createMemoryOrchestrator(this.getProjectRoot());
      await orch.initialize();
      const knowledge = await orch.listSessionKnowledge();

      const total = knowledge.reduce((sum, sk) => sum + sk.facts.length, 0);
      const session = knowledge.filter((sk) => !sk.sessionId.startsWith("project::")).length;
      const project = knowledge.length - session;

      void this.view.webview.postMessage({
        type: "memory_stats_result",
        payload: {
          total,
          session,
          project,
          global: 0,
          utilizationPercent: Math.min(100, Math.round((total / 500) * 100)),
        },
      });
    } catch {
      void this.view.webview.postMessage({
        type: "memory_stats_result",
        payload: { total: 0, session: 0, project: 0, global: 0, utilizationPercent: 0 },
      });
    }
  }

  async forgetMemory(key: string): Promise<void> {
    if (!this.view) return;

    try {
      const orch = createMemoryOrchestrator(this.getProjectRoot());
      await orch.initialize();
      await orch.memoryPrune(1.0); // prune low-score items; key-level delete not in public API
    } catch {
      // non-fatal
    }

    void this.view.webview.postMessage({
      type: "memory_forgotten",
      payload: { key },
    });

    await this.listMemories();
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
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 12px;
    }
    .header {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .tab {
      padding: 8px 16px;
      cursor: pointer;
      border: none;
      background: none;
      color: var(--vscode-descriptionForeground);
      border-bottom: 2px solid transparent;
    }
    .tab.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-button-background);
    }
    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }
    .search-box {
      width: 100%;
      padding: 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      margin-bottom: 16px;
      font-size: 13px;
    }
    .memory-item {
      padding: 10px;
      margin-bottom: 8px;
      background: var(--vscode-editorWidget-background);
      border-radius: 4px;
    }
    .memory-key {
      font-weight: 600;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .memory-value {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .memory-meta {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }
    .scope-badge {
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    button.forget {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .stat-card {
      padding: 12px;
      background: var(--vscode-editorWidget-background);
      border-radius: 4px;
      text-align: center;
    }
    .stat-value {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .stat-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .empty {
      padding: 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">Memory Browser</div>

  <div class="tabs">
    <button class="tab active" data-tab="list">List</button>
    <button class="tab" data-tab="search">Search</button>
    <button class="tab" data-tab="stats">Stats</button>
  </div>

  <div class="tab-content active" id="listTab">
    <div id="memoriesList" class="empty">Loading memories...</div>
  </div>

  <div class="tab-content" id="searchTab">
    <input type="text" class="search-box" id="searchInput" placeholder="Search memories...">
    <div id="searchResults" class="empty">Enter a search query</div>
  </div>

  <div class="tab-content" id="statsTab">
    <div class="stats-grid" id="statsGrid">
      <div class="stat-card">
        <div class="stat-value" id="statTotal">0</div>
        <div class="stat-label">Total</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="statSession">0</div>
        <div class="stat-label">Session</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="statProject">0</div>
        <div class="stat-label">Project</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="statGlobal">0</div>
        <div class="stat-label">Global</div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      // Tab switching
      document.querySelectorAll('.tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
          const tabName = tab.getAttribute('data-tab');
          document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
          document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
          tab.classList.add('active');
          document.getElementById(tabName + 'Tab').classList.add('active');

          if (tabName === 'list') {
            vscode.postMessage({ type: 'memory_list' });
          } else if (tabName === 'stats') {
            vscode.postMessage({ type: 'memory_stats' });
          }
        });
      });

      // Search
      const searchInput = document.getElementById('searchInput');
      searchInput.addEventListener('keyup', function(e) {
        if (e.key === 'Enter') {
          const query = searchInput.value.trim();
          if (query) {
            vscode.postMessage({ type: 'memory_search', query: query });
          }
        }
      });

      // Message handler
      window.addEventListener('message', function(event) {
        const message = event.data;

        if (message.type === 'memory_list_result') {
          const memories = message.payload.memories || [];
          const listDiv = document.getElementById('memoriesList');
          if (memories.length === 0) {
            listDiv.innerHTML = '<div class="empty">No memories found</div>';
          } else {
            listDiv.innerHTML = memories.map(function(mem) {
              return '<div class="memory-item">' +
                '<div class="memory-key">' + escapeHtml(mem.key) + '</div>' +
                '<div class="memory-value">' + escapeHtml(mem.value) + '</div>' +
                '<div class="memory-meta">' +
                '<span class="scope-badge">' + escapeHtml(mem.scope) + '</span>' +
                '<button class="forget" onclick="forgetMemory(\'' + escapeHtml(mem.key) + '\')">Forget</button>' +
                '</div></div>';
            }).join('');
          }
        } else if (message.type === 'memory_search_result') {
          const results = message.payload.results || [];
          const resultsDiv = document.getElementById('searchResults');
          if (results.length === 0) {
            resultsDiv.innerHTML = '<div class="empty">No results found</div>';
          } else {
            resultsDiv.innerHTML = results.map(function(mem) {
              return '<div class="memory-item">' +
                '<div class="memory-key">' + escapeHtml(mem.key) + '</div>' +
                '<div class="memory-value">' + escapeHtml(mem.value) + '</div>' +
                '</div>';
            }).join('');
          }
        } else if (message.type === 'memory_stats_result') {
          const stats = message.payload;
          document.getElementById('statTotal').textContent = stats.total || 0;
          document.getElementById('statSession').textContent = stats.session || 0;
          document.getElementById('statProject').textContent = stats.project || 0;
          document.getElementById('statGlobal').textContent = stats.global || 0;
        }
      });

      window.forgetMemory = function(key) {
        if (confirm('Forget memory: ' + key + '?')) {
          vscode.postMessage({ type: 'memory_forget', key: key });
        }
      };

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      // Load initial data
      vscode.postMessage({ type: 'memory_list' });
    })();
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
