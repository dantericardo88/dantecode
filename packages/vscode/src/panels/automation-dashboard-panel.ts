// ============================================================================
// Automation Dashboard Panel — Background tasks, workflow monitoring
// ============================================================================

import * as vscode from "vscode";

interface BackgroundTask {
  id: string;
  name: string;
  status: "idle" | "running" | "completed" | "failed";
  progress: number;
  startTime?: string;
  endTime?: string;
  error?: string;
}

export class AutomationDashboardPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.automationDashboardView";

  private view: vscode.WebviewView | undefined;
  private disposables: vscode.Disposable[] = [];
  private tasks: Map<string, BackgroundTask> = new Map();

  constructor(
    private readonly extensionUri: vscode.Uri,
    _context: vscode.ExtensionContext,
  ) {
    // Listen for automation events
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Register command listeners for automation events
    this.disposables.push(
      vscode.commands.registerCommand("dantecode.automationTaskStarted", (event: any) => {
        void this.handleTaskStarted(event);
      })
    );

    this.disposables.push(
      vscode.commands.registerCommand("dantecode.automationTaskProgress", (event: any) => {
        void this.handleTaskProgress(event);
      })
    );

    this.disposables.push(
      vscode.commands.registerCommand("dantecode.automationTaskCompleted", (event: any) => {
        void this.handleTaskCompleted(event);
      })
    );

    this.disposables.push(
      vscode.commands.registerCommand("dantecode.automationTaskFailed", (event: any) => {
        void this.handleTaskFailed(event);
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

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message: { type: string; data?: any }) => {
      switch (message.type) {
        case "list_tasks":
          await this.handleListTasks();
          break;
        case "trigger_task":
          await this.handleTriggerTask(message.data);
          break;
        case "stop_task":
          await this.handleStopTask(message.data.taskId);
          break;
        case "ready":
          await this.handleListTasks(); // Load tasks on initial load
          break;
      }
    });

    // Send current tasks on load
    void this.handleListTasks();
  }

  private async handleTaskStarted(event: { id: string; name: string }): Promise<void> {
    const task: BackgroundTask = {
      id: event.id,
      name: event.name,
      status: "running",
      progress: 0,
      startTime: new Date().toISOString(),
    };

    this.tasks.set(event.id, task);

    await this.sendMessage({
      type: "task_started",
      task,
    });
  }

  private async handleTaskProgress(event: { id: string; progress: number }): Promise<void> {
    const task = this.tasks.get(event.id);
    if (task) {
      task.progress = event.progress;
      await this.sendMessage({
        type: "task_progress",
        id: event.id,
        progress: event.progress,
      });
    }
  }

  private async handleTaskCompleted(event: { id: string }): Promise<void> {
    const task = this.tasks.get(event.id);
    if (task) {
      task.status = "completed";
      task.progress = 100;
      task.endTime = new Date().toISOString();
      await this.sendMessage({
        type: "task_completed",
        id: event.id,
      });
    }
  }

  private async handleTaskFailed(event: { id: string; error: string }): Promise<void> {
    const task = this.tasks.get(event.id);
    if (task) {
      task.status = "failed";
      task.error = event.error;
      task.endTime = new Date().toISOString();
      await this.sendMessage({
        type: "task_failed",
        id: event.id,
        error: event.error,
      });
    }
  }

  private async handleListTasks(): Promise<void> {
    await this.sendMessage({
      type: "tasks_list",
      tasks: Array.from(this.tasks.values()),
    });
  }

  private async handleTriggerTask(data: { name: string }): Promise<void> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Fire automation started event
    await vscode.commands.executeCommand("dantecode.automationTaskStarted", {
      id: taskId,
      name: data.name,
    });

    void vscode.window.showInformationMessage(`Background task started: ${data.name}`);
  }

  private async handleStopTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task && task.status === "running") {
      task.status = "failed";
      task.error = "Stopped by user";
      task.endTime = new Date().toISOString();

      await this.sendMessage({
        type: "task_failed",
        id: taskId,
        error: "Stopped by user",
      });

      void vscode.window.showInformationMessage(`Task stopped: ${task.name}`);
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
  <title>Automation Dashboard</title>
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
    .task-card {
      margin-bottom: 12px;
      padding: 12px;
      background: var(--vscode-editor-background);
      border-radius: 6px;
      border-left: 3px solid var(--vscode-terminal-ansiGreen);
    }
    .task-card.running {
      border-left-color: var(--vscode-terminal-ansiGreen);
    }
    .task-card.completed {
      border-left-color: var(--vscode-terminal-ansiBlue);
      opacity: 0.8;
    }
    .task-card.failed {
      border-left-color: var(--vscode-terminal-ansiRed);
    }
    .task-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .task-name {
      font-weight: 600;
      font-size: 13px;
    }
    .task-status {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .task-progress {
      margin-top: 8px;
      height: 4px;
      background: var(--vscode-progressBar-background);
      border-radius: 2px;
      overflow: hidden;
    }
    .task-progress-bar {
      height: 100%;
      background: var(--vscode-terminal-ansiGreen);
      transition: width 0.3s ease;
    }
    .task-meta {
      margin-top: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .task-error {
      margin-top: 6px;
      font-size: 11px;
      color: var(--vscode-terminal-ansiRed);
    }
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--vscode-descriptionForeground);
    }
    #tasks-container {
      max-height: 400px;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <h2>Automation Dashboard</h2>

  <div class="section">
    <div class="section-title">Trigger Task</div>
    <div class="input-group">
      <input type="text" id="task-name-input" placeholder="Task name..." />
      <button onclick="triggerTask()">Start</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Active & Recent Tasks</div>
    <div id="tasks-container">
      <div class="empty-state">
        No tasks running.<br>
        Trigger a background task to see progress here.
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const tasksContainer = document.getElementById('tasks-container');
      const tasks = new Map();

      window.addEventListener('message', (event) => {
        const message = event.data;

        switch (message.type) {
          case 'tasks_list':
            renderTasks(message.tasks);
            break;
          case 'task_started':
            addTask(message.task);
            break;
          case 'task_progress':
            updateProgress(message.id, message.progress);
            break;
          case 'task_completed':
            updateTaskStatus(message.id, 'completed');
            break;
          case 'task_failed':
            updateTaskStatus(message.id, 'failed', message.error);
            break;
        }
      });

      function renderTasks(tasksList) {
        if (!tasksList || tasksList.length === 0) {
          tasksContainer.innerHTML = \`
            <div class="empty-state">
              No tasks running.<br>
              Trigger a background task to see progress here.
            </div>
          \`;
          return;
        }

        tasksContainer.innerHTML = '';
        tasksList.forEach(task => {
          addTask(task);
        });
      }

      function addTask(task) {
        tasks.set(task.id, task);

        const card = document.createElement('div');
        card.className = 'task-card ' + task.status;
        card.id = 'task-' + task.id;
        card.innerHTML = \`
          <div class="task-header">
            <div class="task-name">\${escapeHtml(task.name)}</div>
            <div class="task-status">\${task.status}</div>
          </div>
          <div class="task-progress">
            <div class="task-progress-bar" style="width: \${task.progress || 0}%"></div>
          </div>
          <div class="task-meta">Started: \${formatTime(task.startTime)}</div>
          \${task.error ? '<div class="task-error">Error: ' + escapeHtml(task.error) + '</div>' : ''}
        \`;

        // Remove empty state if present
        const emptyState = tasksContainer.querySelector('.empty-state');
        if (emptyState) {
          emptyState.remove();
        }

        tasksContainer.insertBefore(card, tasksContainer.firstChild);
      }

      function updateProgress(taskId, progress) {
        const card = document.getElementById('task-' + taskId);
        if (card) {
          const progressBar = card.querySelector('.task-progress-bar');
          if (progressBar) {
            progressBar.style.width = progress + '%';
          }
        }
      }

      function updateTaskStatus(taskId, status, error) {
        const card = document.getElementById('task-' + taskId);
        if (card) {
          card.className = 'task-card ' + status;

          const statusEl = card.querySelector('.task-status');
          if (statusEl) {
            statusEl.textContent = status;
          }

          if (status === 'completed') {
            const progressBar = card.querySelector('.task-progress-bar');
            if (progressBar) {
              progressBar.style.width = '100%';
            }
          }

          if (error) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'task-error';
            errorDiv.textContent = 'Error: ' + error;
            card.appendChild(errorDiv);
          }
        }
      }

      function formatTime(isoString) {
        if (!isoString) return 'N/A';
        const date = new Date(isoString);
        return date.toLocaleTimeString();
      }

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      window.triggerTask = function() {
        const name = document.getElementById('task-name-input').value;
        if (name.trim()) {
          vscode.postMessage({ type: 'trigger_task', data: { name } });
          document.getElementById('task-name-input').value = '';
        }
      };

      // Load initial tasks
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
