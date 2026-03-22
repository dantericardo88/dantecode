import * as vscode from "vscode";
import { BackgroundTaskStore } from "@dantecode/core";
import { GitAutomationStore } from "@dantecode/git-engine";

const MAX_EXECUTIONS = 60;

export class AutomationPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.automationView";

  private view: vscode.WebviewView | undefined;
  private fileWatchers: vscode.FileSystemWatcher[] = [];

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

    this.startFileWatchers();
    void this.refreshEntries();

    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.disposeFileWatchers();
      this.startFileWatchers();
      void this.refreshEntries();
    });

    webviewView.onDidDispose(() => {
      workspaceWatcher.dispose();
      this.disposeFileWatchers();
    });
  }

  async refreshEntries(): Promise<void> {
    if (!this.view) {
      return;
    }

    const projectRoot = this.getProjectRoot();
    if (projectRoot.length === 0) {
      void this.view.webview.postMessage({
        type: "automationData",
        payload: { executions: [], counts: null, error: null },
      });
      return;
    }

    try {
      const automationStore = new GitAutomationStore(projectRoot);
      const backgroundStore = new BackgroundTaskStore(projectRoot);
      const [executions, backgroundTasks] = await Promise.all([
        automationStore.listAutomationExecutions(),
        backgroundStore.listTasks(),
      ]);
      const taskById = new Map(backgroundTasks.map((task) => [task.id, task]));
      const sorted = [...executions]
        .sort(
          (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
        )
        .slice(0, MAX_EXECUTIONS);

      const counts = {
        total: executions.length,
        queued: executions.filter((entry) => entry.status === "queued").length,
        running: executions.filter((entry) => entry.status === "running").length,
        completed: executions.filter((entry) => entry.status === "completed").length,
        failed: executions.filter((entry) => entry.status === "failed").length,
        blocked: executions.filter((entry) => entry.status === "blocked").length,
      };

      void this.view.webview.postMessage({
        type: "automationData",
        payload: {
          executions: sorted.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            status: entry.status,
            gateStatus: entry.gateStatus,
            label: entry.workflowName ?? entry.workflowPath ?? entry.title ?? entry.kind,
            trigger: entry.trigger?.label ?? entry.trigger?.kind ?? "manual",
            modifiedFiles: entry.modifiedFiles,
            pdseScore: entry.pdseScore,
            summary: entry.summary ?? "",
            backgroundStatus: entry.backgroundTaskId
              ? (taskById.get(entry.backgroundTaskId)?.status ?? null)
              : null,
            formattedTime: formatTimestamp(entry.updatedAt),
          })),
          counts,
          error: null,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      void this.view.webview.postMessage({
        type: "automationData",
        payload: { executions: [], counts: null, error: message },
      });
    }
  }

  private startFileWatchers(): void {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }

    const patterns = [
      new vscode.RelativePattern(folder, ".dantecode/git-engine/automation-state.json"),
      new vscode.RelativePattern(folder, ".dantecode/bg-tasks/*.json"),
    ];

    this.fileWatchers = patterns.map((pattern) => {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(() => void this.refreshEntries());
      watcher.onDidCreate(() => void this.refreshEntries());
      watcher.onDidDelete(() => void this.refreshEntries());
      return watcher;
    });
  }

  private disposeFileWatchers(): void {
    for (const watcher of this.fileWatchers) {
      watcher.dispose();
    }
    this.fileWatchers = [];
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
  <title>DanteCode Automation</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .header, .counts {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .counts {
      flex-wrap: wrap;
      background: var(--vscode-sideBarSectionHeader-background);
    }
    .pill {
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .list {
      padding: 10px 12px;
    }
    .item {
      margin-bottom: 10px;
      padding: 10px;
      border-radius: 8px;
      background: var(--vscode-editorWidget-background);
    }
    .title {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
    }
    .meta, .summary {
      margin-top: 6px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .summary {
      color: var(--vscode-foreground);
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
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .error {
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <div class="header">
    <strong>Automation</strong>
    <button id="refresh">Refresh</button>
  </div>
  <div class="counts" id="counts">
    <span class="pill">No automation runs yet</span>
  </div>
  <div class="list" id="list">
    <div class="empty">No durable automation executions yet.</div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const refresh = document.getElementById('refresh');
      const counts = document.getElementById('counts');
      const list = document.getElementById('list');

      refresh.addEventListener('click', function() {
        vscode.postMessage({ type: 'refresh' });
      });

      window.addEventListener('message', function(event) {
        const message = event.data;
        if (message.type !== 'automationData') {
          return;
        }

        const payload = message.payload || {};
        if (payload.error) {
          counts.innerHTML = '<span class="pill">error</span>';
          list.innerHTML = '<div class="error">' + escapeHtml(String(payload.error)) + '</div>';
          return;
        }

        if (payload.counts) {
          counts.innerHTML = [
            ['total', payload.counts.total],
            ['queued', payload.counts.queued],
            ['running', payload.counts.running],
            ['completed', payload.counts.completed],
            ['failed', payload.counts.failed],
            ['blocked', payload.counts.blocked]
          ].map(function(entry) {
            return '<span class="pill">' + escapeHtml(String(entry[0])) + ': ' + escapeHtml(String(entry[1])) + '</span>';
          }).join('');
        } else {
          counts.innerHTML = '<span class="pill">No automation runs yet</span>';
        }

        const executions = Array.isArray(payload.executions) ? payload.executions : [];
        if (executions.length === 0) {
          list.innerHTML = '<div class="empty">No durable automation executions yet.</div>';
          return;
        }

        list.innerHTML = executions.map(function(entry) {
          const files = Array.isArray(entry.modifiedFiles) && entry.modifiedFiles.length > 0
            ? entry.modifiedFiles.join(', ')
            : 'none';
          const pdse = typeof entry.pdseScore === 'number'
            ? ' PDSE=' + entry.pdseScore.toFixed(2)
            : '';
          return '<div class="item">' +
            '<div class="title"><span>' + escapeHtml(entry.label) + '</span><span>' + escapeHtml(entry.status) + '</span></div>' +
            '<div class="meta">' + escapeHtml(entry.formattedTime) +
            ' | trigger=' + escapeHtml(entry.trigger) +
            ' | gate=' + escapeHtml(entry.gateStatus) +
            (entry.backgroundStatus ? ' | task=' + escapeHtml(entry.backgroundStatus) : '') +
            pdse +
            '</div>' +
            '<div class="summary">' + escapeHtml(entry.summary || '') + '</div>' +
            '<div class="meta">files=' + escapeHtml(files) + '</div>' +
            '</div>';
        }).join('');
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
  for (let index = 0; index < 32; index++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
