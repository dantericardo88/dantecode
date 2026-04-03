import * as vscode from "vscode";
import { VerificationBenchmarkStore, VerificationHistoryStore } from "@dantecode/core";

const MAX_HISTORY_ENTRIES = 100;

export class VerificationPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.verificationView";

  private view: vscode.WebviewView | undefined;
  private fileWatcher: vscode.FileSystemWatcher | undefined;

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

    webviewView.webview.onDidReceiveMessage(async (message: { type: string }) => {
      if (message.type === "refresh" || message.type === "ready") {
        await this.refreshEntries();
      }
    });

    this.startFileWatcher();
    void this.refreshEntries();

    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.disposeFileWatcher();
      this.startFileWatcher();
      void this.refreshEntries();
    });

    webviewView.onDidDispose(() => {
      workspaceWatcher.dispose();
      this.disposeFileWatcher();
    });
  }

  async refreshEntries(): Promise<void> {
    if (!this.view) {
      return;
    }

    const projectRoot = this.getProjectRoot();
    if (projectRoot.length === 0) {
      void this.view.webview.postMessage({
        type: "verificationData",
        payload: { entries: [], summaries: [], error: null },
      });
      return;
    }

    try {
      const historyStore = new VerificationHistoryStore(projectRoot);
      const benchmarkStore = new VerificationBenchmarkStore(projectRoot);
      const [entries, summaries] = await Promise.all([
        historyStore.list({ limit: MAX_HISTORY_ENTRIES }),
        benchmarkStore.summarizeAll(10),
      ]);

      void this.view.webview.postMessage({
        type: "verificationData",
        payload: {
          entries: entries.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            label: entry.label,
            summary: entry.summary,
            passed: entry.passed,
            pdseScore: entry.pdseScore,
            averageConfidence: entry.averageConfidence,
            formattedTime: formatTimestamp(entry.recordedAt),
          })),
          summaries,
          error: null,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      void this.view.webview.postMessage({
        type: "verificationData",
        payload: { entries: [], summaries: [], error: message },
      });
    }
  }

  private startFileWatcher(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return;
    }

    const pattern = new vscode.RelativePattern(folders[0]!, ".danteforge/reports/*.jsonl");
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.fileWatcher.onDidChange(() => void this.refreshEntries());
    this.fileWatcher.onDidCreate(() => void this.refreshEntries());
    this.fileWatcher.onDidDelete(() => void this.refreshEntries());
  }

  private disposeFileWatcher(): void {
    this.fileWatcher?.dispose();
    this.fileWatcher = undefined;
  }

  private getProjectRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
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
  <title>DanteCode Verification</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBarSectionHeader-background);
    }
    .section {
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .section h3 {
      margin: 0 0 8px;
      font-size: 12px;
    }
    .summary-item,
    .entry-item {
      padding: 8px;
      margin-bottom: 8px;
      border-radius: 6px;
      background: var(--vscode-editorWidget-background);
    }
    .muted {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    button {
      border: none;
      border-radius: 4px;
      padding: 4px 8px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-foreground);
      cursor: pointer;
    }
    .empty, .error {
      padding: 12px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .error {
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <div class="header">
    <strong>Verification</strong>
    <button id="refresh">Refresh</button>
  </div>
  <div class="section">
    <h3>Benchmarks</h3>
    <div id="summaries" class="empty">No benchmark runs yet.</div>
  </div>
  <div class="section">
    <h3>Recent Runs</h3>
    <div id="entries" class="empty">No verification history yet.</div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const refresh = document.getElementById('refresh');
      const summaries = document.getElementById('summaries');
      const entries = document.getElementById('entries');

      refresh.addEventListener('click', function() {
        vscode.postMessage({ type: 'refresh' });
      });

      window.addEventListener('message', function(event) {
        const message = event.data;
        if (message.type !== 'verificationData') {
          return;
        }

        const payload = message.payload || {};
        if (payload.error) {
          summaries.innerHTML = '<div class="error">' + escapeHtml(String(payload.error)) + '</div>';
          entries.innerHTML = '';
          return;
        }

        const summaryItems = Array.isArray(payload.summaries) ? payload.summaries : [];
        if (summaryItems.length === 0) {
          summaries.innerHTML = '<div class="empty">No benchmark runs yet.</div>';
        } else {
          summaries.innerHTML = summaryItems.map(function(summary) {
            return '<div class="summary-item">' +
              '<div><strong>' + escapeHtml(summary.benchmarkId) + '</strong></div>' +
              '<div class="muted">runs=' + escapeHtml(String(summary.totalRuns)) +
              ' passRate=' + escapeHtml(Number(summary.passRate || 0).toFixed(2)) +
              ' avgPdse=' + escapeHtml(Number(summary.averagePdseScore || 0).toFixed(2)) +
              '</div>' +
              '</div>';
          }).join('');
        }

        const entryItems = Array.isArray(payload.entries) ? payload.entries : [];
        if (entryItems.length === 0) {
          entries.innerHTML = '<div class="empty">No verification history yet.</div>';
        } else {
          entries.innerHTML = entryItems.map(function(entry) {
            const status = entry.passed === undefined
              ? entry.kind
              : (entry.passed ? 'pass' : 'fail');
            return '<div class="entry-item">' +
              '<div><strong>' + escapeHtml(entry.label) + '</strong></div>' +
              '<div class="muted">' + escapeHtml(entry.formattedTime) + ' | ' + escapeHtml(status) + '</div>' +
              '<div>' + escapeHtml(entry.summary) + '</div>' +
              '</div>';
          }).join('');
        }
      });

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }
}

function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
