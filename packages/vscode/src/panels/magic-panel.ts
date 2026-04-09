import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { join } from "node:path";

export class MagicPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.magicView";

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

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; goal?: string }) => {
      if (message.type === "start_magic" && message.goal) {
        void this.startMagic(message.goal);
      }
    });
  }

  async startMagic(goal: string): Promise<void> {
    if (!this.view) return;

    const view = this.view;

    void view.webview.postMessage({ type: "magic_started", payload: { goal } });

    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    // Resolve CLI entry point relative to the extension's package root
    const extensionRoot = join(this.extensionUri.fsPath, "..", "..");
    const cliPath = join(extensionRoot, "packages", "cli", "dist", "index.js");

    const child = spawn("node", [cliPath, "/magic", goal], {
      cwd: projectRoot || extensionRoot,
      env: { ...process.env },
    });

    let progress = 5;
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      progress = Math.min(95, progress + 3);
      const phase = progress < 30 ? "Planning" : progress < 70 ? "Building" : "Verifying";
      void view.webview.postMessage({
        type: "magic_progress",
        payload: { progress, phase, status: "running", details: text },
      });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      void view.webview.postMessage({
        type: "magic_progress",
        payload: { progress, phase: "Running", status: "running", details: chunk.toString() },
      });
    });

    child.on("close", (code) => {
      void view.webview.postMessage({
        type: "magic_progress",
        payload: {
          progress: 100,
          phase: code === 0 ? "Complete" : "Failed",
          status: "complete",
          details: code === 0 ? "Magic complete." : `Exited with code ${code}`,
        },
      });
    });

    child.on("error", (err) => {
      void view.webview.postMessage({
        type: "magic_progress",
        payload: { progress: 0, phase: "Error", status: "complete", details: err.message },
      });
    });
  }

  updateProgress(progress: number, phase: string, status: string, details?: string): void {
    if (!this.view) {
      return;
    }

    void this.view.webview.postMessage({
      type: "magic_progress",
      payload: { progress, phase, status, details },
    });
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
  <title>Magic Mode</title>
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
    .input-group {
      margin-bottom: 16px;
    }
    textarea {
      width: 100%;
      min-height: 80px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 8px;
      font-family: var(--vscode-font-family);
      font-size: 13px;
      resize: vertical;
    }
    button {
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-size: 13px;
      width: 100%;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .progress-container {
      margin-top: 20px;
      display: none;
    }
    .progress-container.active {
      display: block;
    }
    .progress-bar {
      width: 100%;
      height: 8px;
      background: var(--vscode-progressBar-background);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 8px;
    }
    .progress-fill {
      height: 100%;
      background: var(--vscode-button-background);
      transition: width 0.3s ease;
      width: 0%;
    }
    .phase {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .details {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 8px;
      padding: 8px;
      background: var(--vscode-editorWidget-background);
      border-radius: 4px;
      max-height: 200px;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <div class="header">Magic Mode</div>

  <div class="input-group">
    <textarea id="goalInput" placeholder="Describe what you want to build..."></textarea>
  </div>

  <button id="startButton">Start Magic</button>

  <div class="progress-container" id="progressContainer">
    <div class="phase" id="phaseText">Initializing...</div>
    <div class="progress-bar">
      <div class="progress-fill" id="progressFill"></div>
    </div>
    <div class="details" id="detailsText"></div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const goalInput = document.getElementById('goalInput');
      const startButton = document.getElementById('startButton');
      const progressContainer = document.getElementById('progressContainer');
      const progressFill = document.getElementById('progressFill');
      const phaseText = document.getElementById('phaseText');
      const detailsText = document.getElementById('detailsText');

      startButton.addEventListener('click', function() {
        const goal = goalInput.value.trim();
        if (!goal) {
          return;
        }

        startButton.disabled = true;
        progressContainer.classList.add('active');
        vscode.postMessage({ type: 'start_magic', goal: goal });
      });

      window.addEventListener('message', function(event) {
        const message = event.data;

        if (message.type === 'magic_started') {
          phaseText.textContent = 'Starting...';
          progressFill.style.width = '0%';
          detailsText.textContent = '';
        } else if (message.type === 'magic_progress') {
          const payload = message.payload || {};
          progressFill.style.width = (payload.progress || 0) + '%';
          phaseText.textContent = payload.phase || 'Running...';
          if (payload.details) {
            detailsText.textContent += payload.details + '\\n';
            detailsText.scrollTop = detailsText.scrollHeight;
          }
          if (payload.status === 'complete') {
            startButton.disabled = false;
          }
        }
      });
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
