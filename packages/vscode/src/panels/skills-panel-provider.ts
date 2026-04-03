// ============================================================================
// Skills Library Panel — Browse, install, verify skills (DIRECT INTEGRATION)
// ============================================================================

import * as vscode from "vscode";
import type { VSCodeCommandBridge } from "../command-bridge.js";
import { listSkills, importSkillsFromPath, evaluateSkill, getSkillbookStats } from "../core-integrations/skillbook-integration-new.js";

export class SkillsPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.skillsLibraryView";

  private view: vscode.WebviewView | undefined;
  private outputChannel: vscode.OutputChannel;

  constructor(
    private readonly extensionUri: vscode.Uri,
    _commandBridge: VSCodeCommandBridge,
  ) {
    this.outputChannel = vscode.window.createOutputChannel("DanteCode Skills");
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

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; data?: unknown }) => {
      switch (message.type) {
        case "run_command":
          await this.handleCommand(message.data as { command: string; args?: string });
          break;
        case "ready":
          await this.refreshView();
          break;
      }
    });
  }

  private async handleCommand(data: { command: string; args?: string }): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!projectRoot) {
      await this.sendMessage({ type: "error", message: "No workspace open" });
      return;
    }

    try {
      switch (data.command) {
        case "list":
          await this.listAllSkills(projectRoot);
          break;
        case "install":
          await this.installSkillDialog(projectRoot);
          break;
        case "verify":
          await this.verifySkillDialog(projectRoot);
          break;
        case "stats":
          await this.showStats(projectRoot);
          break;
        default:
          await this.sendMessage({ type: "error", message: `Unknown command: ${data.command}` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sendMessage({ type: "error", message });
    }
  }

  private async listAllSkills(projectRoot: string): Promise<void> {
    const skills = await listSkills(projectRoot);
    await this.sendMessage({
      type: "skills_list",
      skills: skills.map(s => ({
        id: s.id,
        name: s.title,
        description: s.content.substring(0, 100),
      })),
    });
  }

  private async installSkillDialog(projectRoot: string): Promise<void> {
    const skillPath = await vscode.window.showInputBox({
      prompt: "Enter skill path or URL",
      placeHolder: "https://example.com/skill.json or ./local/skill.json",
    });

    if (!skillPath) {
      return;
    }

    const count = await importSkillsFromPath(skillPath, projectRoot, this.outputChannel);
    await this.sendMessage({
      type: "install_result",
      count,
    });
    // Refresh the list
    await this.listAllSkills(projectRoot);
  }

  private async verifySkillDialog(projectRoot: string): Promise<void> {
    const skills = await listSkills(projectRoot);
    const skillNames = skills.map(s => s.title);

    const selected = await vscode.window.showQuickPick(skillNames, {
      placeHolder: "Select skill to verify",
    });

    if (!selected) {
      return;
    }

    const skill = skills.find(s => s.title === selected);
    if (!skill) {
      return;
    }

    const quality = await evaluateSkill(skill.id, projectRoot);
    await this.sendMessage({
      type: "verify_result",
      skillId: skill.id,
      quality,
    });

    if (quality) {
      void vscode.window.showInformationMessage(
        `Skill "${selected}" quality score: ${quality.score?.toFixed(2) || "N/A"}`
      );
    }
  }

  private async showStats(projectRoot: string): Promise<void> {
    const stats = await getSkillbookStats(projectRoot);
    await this.sendMessage({
      type: "stats_result",
      totalSkills: stats.totalSkills,
      avgQuality: stats.avgQuality,
    });
  }

  private async sendMessage(message: unknown): Promise<void> {
    if (this.view) {
      await this.view.webview.postMessage(message);
    }
  }

  private async refreshView(): Promise<void> {
    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (projectRoot) {
      await this.listAllSkills(projectRoot);
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
  <title>Skills Library</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
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
    .input-group {
      display: flex;
      gap: 8px;
      margin-top: 8px;
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
    .output {
      margin-top: 12px;
      padding: 8px;
      background: var(--vscode-editor-background);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      max-height: 400px;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <div class="section">
    <div class="section-title">Browse Skills</div>
    <button onclick="runCommand('skills', 'list')">List All Skills</button>
    <button onclick="runCommand('skill')">Show Active Skill</button>
  </div>

  <div class="section">
    <div class="section-title">Install Skill</div>
    <div class="input-group">
      <input type="text" id="skillSource" placeholder="URL or path..." />
      <button onclick="installSkill()">Install</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Manage Skills</div>
    <button class="btn-secondary" onclick="runCommand('skills', 'import')">Import</button>
    <button class="btn-secondary" onclick="runCommand('skills', 'export')">Export</button>
    <button class="btn-secondary" onclick="runCommand('skill-verify')">Verify</button>
  </div>

  <div id="output" class="output" style="display: none;"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const outputEl = document.getElementById('output');

    function runCommand(command, args) {
      outputEl.style.display = 'block';
      outputEl.innerHTML = 'Running /' + command + '...';
      vscode.postMessage({ type: 'run_command', data: { command, args } });
    }

    function installSkill() {
      const source = document.getElementById('skillSource').value;
      if (source) {
        runCommand('skill-install', source);
      } else {
        outputEl.style.display = 'block';
        outputEl.innerHTML = '<span style="color: var(--vscode-errorForeground)">Please enter a skill source</span>';
      }
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'slash_command_result') {
        outputEl.innerHTML = message.result || message.error || 'Command completed';
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
