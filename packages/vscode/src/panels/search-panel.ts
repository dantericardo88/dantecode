import * as vscode from "vscode";
import { WebSearchOrchestrator } from "@dantecode/core";

export class SearchPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.searchView";

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

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; query?: string; file?: string; line?: number }) => {
      if (message.type === "search_query" && message.query) {
        await this.search(message.query);
      } else if (message.type === "open_file" && message.file) {
        await this.openFile(message.file, message.line);
      }
    });
  }

  async search(query: string): Promise<void> {
    if (!this.view) return;

    try {
      const orchestrator = new WebSearchOrchestrator();
      const result = await orchestrator.search(query, { maxResults: 10, searchDepth: "basic" });

      const results = result.results.map((r, i) => ({
        file: r.url,
        line: 0,
        score: 1 - i * 0.05,
        snippet: r.snippet || r.title,
        title: r.title,
        url: r.url,
      }));

      void this.view.webview.postMessage({
        type: "search_results",
        payload: { query, results },
      });
    } catch {
      void this.view.webview.postMessage({
        type: "search_results",
        payload: { query, results: [] },
      });
    }
  }

  async openFile(file: string, line?: number): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const filePath = vscode.Uri.file(`${workspaceRoot}/${file}`);

    const document = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(document);

    if (line !== undefined && line > 0) {
      const position = new vscode.Position(line - 1, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
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
  <title>Code Search</title>
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
    .results {
      margin-top: 16px;
    }
    .result-item {
      padding: 10px;
      margin-bottom: 8px;
      background: var(--vscode-editorWidget-background);
      border-radius: 4px;
      cursor: pointer;
    }
    .result-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .result-file {
      font-weight: 600;
      font-size: 12px;
      margin-bottom: 4px;
      color: var(--vscode-textLink-foreground);
    }
    .result-snippet {
      font-size: 11px;
      font-family: var(--vscode-editor-font-family);
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
      white-space: pre-wrap;
    }
    .result-meta {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }
    .score-badge {
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .empty {
      padding: 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .query-info {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <div class="header">Code Search</div>

  <input type="text" class="search-box" id="searchInput" placeholder="Search for code...">

  <div class="results" id="results">
    <div class="empty">Enter a search query to find relevant code</div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const searchInput = document.getElementById('searchInput');
      const results = document.getElementById('results');

      searchInput.addEventListener('keyup', function(e) {
        if (e.key === 'Enter') {
          const query = searchInput.value.trim();
          if (query) {
            results.innerHTML = '<div class="empty">Searching...</div>';
            vscode.postMessage({ type: 'search_query', query: query });
          }
        }
      });

      window.addEventListener('message', function(event) {
        const message = event.data;

        if (message.type === 'search_results') {
          const payload = message.payload || {};
          const searchResults = payload.results || [];

          if (searchResults.length === 0) {
            results.innerHTML = '<div class="empty">No results found</div>';
          } else {
            results.innerHTML = '<div class="query-info">Found ' + searchResults.length + ' results for "' + escapeHtml(payload.query) + '"</div>' +
              searchResults.map(function(result) {
                const scorePercent = Math.round((result.score || 0) * 100);
                return '<div class="result-item" onclick="openFile(\'' + escapeHtml(result.file) + '\', ' + (result.line || 0) + ')">' +
                  '<div class="result-file">' + escapeHtml(result.file) + ':' + (result.line || 0) + '</div>' +
                  '<div class="result-snippet">' + escapeHtml(result.snippet || '') + '</div>' +
                  '<div class="result-meta">' +
                  '<span>Relevance</span>' +
                  '<span class="score-badge">' + scorePercent + '%</span>' +
                  '</div></div>';
              }).join('');
          }
        }
      });

      window.openFile = function(file, line) {
        vscode.postMessage({ type: 'open_file', file: file, line: line });
      };

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }
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
