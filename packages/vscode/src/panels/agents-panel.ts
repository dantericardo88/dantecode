import * as vscode from "vscode";
import { BackgroundTaskStore } from "@dantecode/core";

export class AgentsPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.agentsView";

  private view: vscode.WebviewView | undefined;
  private refreshInterval: NodeJS.Timeout | undefined;

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

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; taskId?: string; task?: string }) => {
      if (message.type === "refresh") {
        await this.refreshTasks();
      } else if (message.type === "cancel_task" && message.taskId) {
        await this.cancelTask(message.taskId);
      } else if (message.type === "start_task" && message.task) {
        await this.startTask(message.task);
      } else if (message.type === "start_party" && message.task) {
        await this.startParty(message.task);
      }
    });

    // Auto-refresh every 5 seconds
    this.refreshInterval = setInterval(() => {
      void this.refreshTasks();
    }, 5000);

    void this.refreshTasks();

    webviewView.onDidDispose(() => {
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = undefined;
      }
    });
  }

  async refreshTasks(): Promise<void> {
    if (!this.view) {
      return;
    }

    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    if (!projectRoot) {
      return;
    }

    try {
      const store = new BackgroundTaskStore(projectRoot);
      const tasks = await store.listTasks();

      // For now, treat all tasks as background tasks (party distinction would be in metadata)
      const bgTasks = tasks;
      const partyTasks: typeof tasks = [];

      void this.view.webview.postMessage({
        type: "tasks_update",
        payload: {
          backgroundTasks: bgTasks.map(t => ({
            id: t.id,
            description: t.prompt || t.id,
            status: t.status,
            progress: parseInt(t.progress || "0", 10),
            startedAt: t.startedAt,
            completedAt: t.completedAt,
          })),
          partyAgents: partyTasks.map(t => ({
            id: t.id,
            name: t.prompt || t.id,
            status: t.status,
            task: t.prompt || t.id,
            progress: parseInt(t.progress || "0", 10),
          })),
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      void this.view.webview.postMessage({
        type: "error",
        payload: { error: message },
      });
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    if (!projectRoot) return;

    try {
      const store = new BackgroundTaskStore(projectRoot);
      const task = await store.loadTask(taskId);
      if (task) {
        task.status = "cancelled";
        task.completedAt = new Date().toISOString();
        await store.saveTask(task);
      }
    } catch {
      // non-fatal
    }
    await this.refreshTasks();
  }

  async startTask(task: string): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    if (!projectRoot) return;

    try {
      const store = new BackgroundTaskStore(projectRoot);
      const id = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await store.saveTask({
        id,
        prompt: task,
        status: "queued",
        createdAt: new Date().toISOString(),
        progress: "0",
        touchedFiles: [],
      });
      void vscode.window.showInformationMessage(`Background task queued: ${task.slice(0, 60)}`);
    } catch {
      void vscode.window.showErrorMessage("Failed to queue background task");
    }
    await this.refreshTasks();
  }

  async startParty(task: string): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    if (!projectRoot) return;

    try {
      const store = new BackgroundTaskStore(projectRoot);
      const id = `party-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await store.saveTask({
        id,
        prompt: `/party ${task}`,
        status: "queued",
        createdAt: new Date().toISOString(),
        progress: "0",
        touchedFiles: [],
      });
      void vscode.window.showInformationMessage(`Party mode queued: ${task.slice(0, 60)}`);
    } catch {
      void vscode.window.showErrorMessage("Failed to queue party task");
    }
    await this.refreshTasks();
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
  <title>Agents</title>
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
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
    .header button {
      padding: 4px 8px;
      font-size: 11px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
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
      font-size: 12px;
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
    .task-input {
      width: 100%;
      padding: 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .start-button {
      width: 100%;
      padding: 8px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      margin-bottom: 16px;
    }
    .task-item {
      padding: 10px;
      margin-bottom: 8px;
      background: var(--vscode-editorWidget-background);
      border-radius: 4px;
      position: relative;
    }
    .task-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .task-description {
      font-weight: 600;
      font-size: 12px;
      flex: 1;
    }
    .status-badge {
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
    }
    .status-running {
      background: var(--vscode-testing-iconQueued);
      color: white;
    }
    .status-completed {
      background: var(--vscode-testing-iconPassed);
      color: white;
    }
    .status-failed {
      background: var(--vscode-testing-iconFailed);
      color: white;
    }
    .status-queued {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .task-progress {
      height: 4px;
      background: var(--vscode-progressBar-background);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .task-progress-fill {
      height: 100%;
      background: var(--vscode-button-background);
      transition: width 0.3s ease;
    }
    .task-meta {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      justify-content: space-between;
    }
    .cancel-button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      margin-top: 6px;
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
  <div class="header">
    <h3>Agents</h3>
    <button id="refreshButton">Refresh</button>
  </div>

  <div class="tabs">
    <button class="tab active" data-tab="background">Background</button>
    <button class="tab" data-tab="party">Party</button>
  </div>

  <div class="tab-content active" id="backgroundTab">
    <input type="text" class="task-input" id="bgTaskInput" placeholder="Describe background task...">
    <button class="start-button" id="startBgButton">Start Background Task</button>
    <div id="bgTasksList" class="empty">No background tasks</div>
  </div>

  <div class="tab-content" id="partyTab">
    <input type="text" class="task-input" id="partyTaskInput" placeholder="Describe party task...">
    <button class="start-button" id="startPartyButton">Start Party Mode</button>
    <div id="partyAgentsList" class="empty">No party agents running</div>
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
        });
      });

      // Refresh button
      document.getElementById('refreshButton').addEventListener('click', function() {
        vscode.postMessage({ type: 'refresh' });
      });

      // Start background task
      document.getElementById('startBgButton').addEventListener('click', function() {
        const task = document.getElementById('bgTaskInput').value.trim();
        if (task) {
          vscode.postMessage({ type: 'start_task', task: task });
          document.getElementById('bgTaskInput').value = '';
        }
      });

      // Start party mode
      document.getElementById('startPartyButton').addEventListener('click', function() {
        const task = document.getElementById('partyTaskInput').value.trim();
        if (task) {
          vscode.postMessage({ type: 'start_party', task: task });
          document.getElementById('partyTaskInput').value = '';
        }
      });

      // Message handler
      window.addEventListener('message', function(event) {
        const message = event.data;

        if (message.type === 'tasks_update') {
          const payload = message.payload || {};
          updateBackgroundTasks(payload.backgroundTasks || []);
          updatePartyAgents(payload.partyAgents || []);
        }
      });

      function updateBackgroundTasks(tasks) {
        const listDiv = document.getElementById('bgTasksList');
        if (tasks.length === 0) {
          listDiv.innerHTML = '<div class="empty">No background tasks</div>';
        } else {
          listDiv.innerHTML = tasks.map(function(task) {
            const statusClass = 'status-' + (task.status || 'queued');
            return '<div class="task-item">' +
              '<div class="task-header">' +
              '<div class="task-description">' + escapeHtml(task.description || task.id) + '</div>' +
              '<span class="status-badge ' + statusClass + '">' + (task.status || 'queued') + '</span>' +
              '</div>' +
              (task.progress ? '<div class="task-progress"><div class="task-progress-fill" style="width: ' + task.progress + '%"></div></div>' : '') +
              '<div class="task-meta"><span>ID: ' + escapeHtml(task.id.substring(0, 8)) + '</span><span>' + (task.startedAt ? formatTime(task.startedAt) : '') + '</span></div>' +
              (task.status === 'running' || task.status === 'queued' ? '<button class="cancel-button" onclick="cancelTask(\'' + escapeHtml(task.id) + '\')">Cancel</button>' : '') +
              '</div>';
          }).join('');
        }
      }

      function updatePartyAgents(agents) {
        const listDiv = document.getElementById('partyAgentsList');
        if (agents.length === 0) {
          listDiv.innerHTML = '<div class="empty">No party agents running</div>';
        } else {
          listDiv.innerHTML = agents.map(function(agent) {
            const statusClass = 'status-' + (agent.status || 'queued');
            return '<div class="task-item">' +
              '<div class="task-header">' +
              '<div class="task-description">' + escapeHtml(agent.name || agent.id) + '</div>' +
              '<span class="status-badge ' + statusClass + '">' + (agent.status || 'queued') + '</span>' +
              '</div>' +
              (agent.progress ? '<div class="task-progress"><div class="task-progress-fill" style="width: ' + agent.progress + '%"></div></div>' : '') +
              '<div class="task-meta"><span>' + escapeHtml(agent.task || '') + '</span></div>' +
              '</div>';
          }).join('');
        }
      }

      window.cancelTask = function(taskId) {
        if (confirm('Cancel task ' + taskId + '?')) {
          vscode.postMessage({ type: 'cancel_task', taskId: taskId });
        }
      };

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      function formatTime(isoString) {
        const date = new Date(isoString);
        return date.toLocaleTimeString();
      }

      // Request initial data
      vscode.postMessage({ type: 'refresh' });
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
