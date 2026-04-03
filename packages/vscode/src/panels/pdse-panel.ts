import * as vscode from "vscode";
import { runLocalPDSEScorer } from "@dantecode/danteforge";
import { readFile } from "node:fs/promises";

export class PDSEPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.pdseView";

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

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; file?: string }) => {
      if (message.type === "run_pdse" && message.file) {
        await this.runPDSE(message.file);
      } else if (message.type === "pick_file") {
        await this.pickFile();
      }
    });
  }

  async runPDSE(filePath: string): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      const content = await readFile(filePath, "utf-8");
      const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      const result = runLocalPDSEScorer(content, projectRoot);

      // Build metrics from the result object
      const metrics = [];
      if (typeof result === "object" && result !== null) {
        for (const [key, value] of Object.entries(result)) {
          if (key !== "overall" && typeof value === "number") {
            metrics.push({ name: key, score: value, weight: 1 });
          }
        }
      }

      void this.view.webview.postMessage({
        type: "pdse_result",
        payload: {
          file: filePath,
          overall: result.overall > 1 ? result.overall : result.overall * 100,
          metrics,
          issues: [],
          passed: result.overall >= 0.7,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      void this.view.webview.postMessage({
        type: "pdse_error",
        payload: { error: message },
      });
    }
  }

  async pickFile(): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "Code Files": ["ts", "js", "tsx", "jsx", "py", "java", "go", "rs"] },
    });

    if (files && files.length > 0 && this.view) {
      const filePath = files[0]!.fsPath;
      await this.runPDSE(filePath);
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
  <title>PDSE Scorer</title>
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
    button {
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-size: 13px;
      width: 100%;
      margin-bottom: 16px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .result-container {
      display: none;
    }
    .result-container.active {
      display: block;
    }
    .score-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 24px;
      margin-bottom: 16px;
    }
    .score-pass {
      background: var(--vscode-testing-iconPassed);
      color: var(--vscode-button-foreground);
    }
    .score-fail {
      background: var(--vscode-testing-iconFailed);
      color: var(--vscode-button-foreground);
    }
    .file-path {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
      word-break: break-all;
    }
    .metrics {
      margin-top: 16px;
    }
    .metric-item {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
    }
    .metric-score {
      font-weight: 600;
    }
    .issues {
      margin-top: 16px;
    }
    .issue-item {
      padding: 8px;
      margin-bottom: 8px;
      background: var(--vscode-inputValidation-errorBackground);
      border-left: 3px solid var(--vscode-inputValidation-errorBorder);
      border-radius: 4px;
      font-size: 12px;
    }
    .error {
      color: var(--vscode-errorForeground);
      padding: 12px;
      background: var(--vscode-inputValidation-errorBackground);
      border-radius: 4px;
      margin-top: 12px;
    }
  </style>
</head>
<body>
  <div class="header">PDSE Scorer</div>

  <button id="pickFileButton">Select File to Score</button>

  <div class="result-container" id="resultContainer">
    <div class="score-badge" id="scoreBadge">0</div>
    <div class="file-path" id="filePath"></div>

    <div class="metrics" id="metrics"></div>

    <div class="issues" id="issues" style="display: none;">
      <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">Issues Found:</div>
      <div id="issuesList"></div>
    </div>
  </div>

  <div class="error" id="errorContainer" style="display: none;"></div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const pickFileButton = document.getElementById('pickFileButton');
      const resultContainer = document.getElementById('resultContainer');
      const scoreBadge = document.getElementById('scoreBadge');
      const filePath = document.getElementById('filePath');
      const metrics = document.getElementById('metrics');
      const issues = document.getElementById('issues');
      const issuesList = document.getElementById('issuesList');
      const errorContainer = document.getElementById('errorContainer');

      pickFileButton.addEventListener('click', function() {
        vscode.postMessage({ type: 'pick_file' });
      });

      window.addEventListener('message', function(event) {
        const message = event.data;

        if (message.type === 'pdse_result') {
          const payload = message.payload || {};
          errorContainer.style.display = 'none';
          resultContainer.classList.add('active');

          const score = Math.round(payload.overall || 0);
          scoreBadge.textContent = score;
          scoreBadge.className = 'score-badge ' + (payload.passed ? 'score-pass' : 'score-fail');
          filePath.textContent = payload.file || 'Unknown file';

          if (payload.metrics && Array.isArray(payload.metrics)) {
            metrics.innerHTML = payload.metrics.map(function(metric) {
              return '<div class="metric-item"><span>' + escapeHtml(metric.name) +
                     '</span><span class="metric-score">' + Math.round(metric.score * 100) + '</span></div>';
            }).join('');
          }

          if (payload.issues && payload.issues.length > 0) {
            issues.style.display = 'block';
            issuesList.innerHTML = payload.issues.map(function(issue) {
              return '<div class="issue-item">' + escapeHtml(issue) + '</div>';
            }).join('');
          } else {
            issues.style.display = 'none';
          }
        } else if (message.type === 'pdse_error') {
          resultContainer.classList.remove('active');
          errorContainer.style.display = 'block';
          errorContainer.textContent = message.payload.error || 'Unknown error';
        }
      });

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
