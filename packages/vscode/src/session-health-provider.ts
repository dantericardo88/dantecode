// ============================================================================
// DanteCode VS Code Extension — Session Health Provider
// OpenHands-inspired live session health dashboard WebView panel.
// Shows model, context %, round budget, PDSE score, active tasks,
// recent tool calls, and contextual next-step suggestions.
// ============================================================================

import * as vscode from "vscode";
import { ContextualSuggestions } from "@dantecode/core";
import type { SuggestionContext } from "@dantecode/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionHealthSnapshot {
  model: string;
  provider: string;
  contextPercent: number;
  roundsUsed: number;
  roundBudget: number;
  pdseScore?: number;
  activeTasks: number;
  hasErrors: boolean;
  pipelineState: "idle" | "running" | "complete" | "failed";
  recentTools: RecentToolEntry[];
  sessionCostUsd: number;
  updatedAt: number;
  uncommittedChanges?: boolean;
}

export interface RecentToolEntry {
  name: string;
  state: "success" | "blocked" | "error";
  detail?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// SessionHealthProvider
// ---------------------------------------------------------------------------

export class SessionHealthProvider implements vscode.WebviewViewProvider {
  static readonly VIEW_TYPE = "dantecode.sessionHealth";

  private _view?: vscode.WebviewView;
  private _snapshot: SessionHealthSnapshot = {
    model: "—",
    provider: "—",
    contextPercent: 0,
    roundsUsed: 0,
    roundBudget: 150,
    activeTasks: 0,
    hasErrors: false,
    pipelineState: "idle",
    recentTools: [],
    sessionCostUsd: 0,
    updatedAt: Date.now(),
  };
  private readonly _suggestions = new ContextualSuggestions({ maxSuggestions: 3 });
  private readonly _extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  // -------------------------------------------------------------------------
  // Public API — called by sidebar-provider.ts on state changes
  // -------------------------------------------------------------------------

  update(partial: Partial<SessionHealthSnapshot>): void {
    this._snapshot = { ...this._snapshot, ...partial, updatedAt: Date.now() };
    this._refresh();
  }

  pushToolEntry(entry: RecentToolEntry): void {
    this._snapshot.recentTools = [entry, ...this._snapshot.recentTools].slice(0, 8);
    this._snapshot.updatedAt = Date.now();
    this._refresh();
  }

  // -------------------------------------------------------------------------
  // WebviewViewProvider
  // -------------------------------------------------------------------------

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "runCommand" && typeof msg.command === "string") {
        vscode.commands.executeCommand("dantecode.openChat");
        // Post the command text to the chat sidebar
        vscode.commands.executeCommand("dantecode.sendMessage", msg.command);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _refresh(): void {
    if (!this._view) return;
    this._view.webview.html = this._buildHtml(this._view.webview);
  }

  private _buildSuggestions(): string {
    const ctx: SuggestionContext = {
      pdseScore: this._snapshot.pdseScore,
      pipelineState: this._snapshot.pipelineState,
      contextPercent: this._snapshot.contextPercent,
      hasUncommittedChanges: this._snapshot.uncommittedChanges,
      activeErrors: this._snapshot.hasErrors ? ["typecheck error detected"] : [],
    };
    return this._suggestions
      .suggest(ctx)
      .map(
        (s) =>
          `<div class="suggestion ${s.priority}" onclick="runCmd('${_escHtml(s.command)}')">
            <span class="cmd">${_escHtml(s.command)}</span>
            <span class="reason">${_escHtml(s.reason)}</span>
          </div>`,
      )
      .join("");
  }

  private _buildHtml(_webview: vscode.Webview): string {
    const nonce = _nonce();
    const snap = this._snapshot;

    const ctxColor = snap.contextPercent > 75 ? "#f97316" : snap.contextPercent > 50 ? "#eab308" : "#22c55e";
    const roundPct = snap.roundBudget > 0 ? Math.round((snap.roundsUsed / snap.roundBudget) * 100) : 0;
    const roundColor = roundPct > 80 ? "#f97316" : roundPct > 60 ? "#eab308" : "#22c55e";
    const pdseColor =
      snap.pdseScore === undefined
        ? "#6b7280"
        : snap.pdseScore >= 0.85
          ? "#22c55e"
          : snap.pdseScore >= 0.7
            ? "#eab308"
            : "#ef4444";
    const pdseDisplay = snap.pdseScore !== undefined ? (snap.pdseScore * 100).toFixed(0) + "%" : "—";

    const stateIcon: Record<string, string> = {
      idle: "⬤",
      running: "◉",
      complete: "✓",
      failed: "✗",
    };
    const stateColor: Record<string, string> = {
      idle: "#6b7280",
      running: "#3b82f6",
      complete: "#22c55e",
      failed: "#ef4444",
    };

    const toolRows = snap.recentTools
      .map((t) => {
        const icon = t.state === "success" ? "✓" : t.state === "blocked" ? "✗" : "!";
        const color = t.state === "success" ? "#22c55e" : t.state === "blocked" ? "#ef4444" : "#f97316";
        const detail = t.detail ? ` <span class="detail">${_escHtml(t.detail.slice(0, 40))}</span>` : "";
        return `<div class="tool-row"><span style="color:${color}">${icon}</span> ${_escHtml(t.name)}${detail}</div>`;
      })
      .join("");

    const suggestions = this._buildSuggestions();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); padding: 8px; }
    .section { margin-bottom: 12px; }
    .section-title { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
    .stat-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-bottom: 1px solid var(--vscode-sideBar-border, rgba(255,255,255,0.05)); }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: var(--vscode-descriptionForeground); }
    .stat-value { font-weight: 600; font-family: var(--vscode-editor-font-family); }
    .bar-wrap { width: 80px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; margin-left: 6px; }
    .bar-fill { height: 100%; border-radius: 3px; }
    .tool-row { padding: 2px 0; font-family: var(--vscode-editor-font-family); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .detail { color: var(--vscode-descriptionForeground); font-size: 10px; margin-left: 4px; }
    .suggestion { padding: 5px 6px; margin-bottom: 4px; border-radius: 4px; background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.05)); cursor: pointer; transition: background 0.15s; }
    .suggestion:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1)); }
    .suggestion.high .cmd { color: #f97316; }
    .suggestion.medium .cmd { color: #3b82f6; }
    .suggestion.low .cmd { color: #6b7280; }
    .cmd { font-weight: 700; font-family: var(--vscode-editor-font-family); font-size: 11px; display: block; }
    .reason { color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 1.4; }
    .state-dot { font-size: 8px; vertical-align: middle; margin-right: 4px; }
    .updated { font-size: 10px; color: var(--vscode-descriptionForeground); text-align: right; margin-top: 8px; }
    .no-tools { color: var(--vscode-descriptionForeground); font-style: italic; }
  </style>
</head>
<body>
  <div class="section">
    <div class="section-title">Session</div>
    <div class="stat-row">
      <span class="stat-label">Model</span>
      <span class="stat-value">${_escHtml(snap.model.split("/").pop() ?? snap.model)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Pipeline</span>
      <span class="stat-value" style="color:${stateColor[snap.pipelineState]}">
        <span class="state-dot">${stateIcon[snap.pipelineState]}</span>${snap.pipelineState}
      </span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Cost</span>
      <span class="stat-value">$${snap.sessionCostUsd.toFixed(4)}</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Resources</div>
    <div class="stat-row">
      <span class="stat-label">Context</span>
      <span class="stat-value" style="color:${ctxColor}">
        ${snap.contextPercent}%
        <span class="bar-wrap"><span class="bar-fill" style="width:${snap.contextPercent}%;background:${ctxColor}"></span></span>
      </span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Rounds</span>
      <span class="stat-value" style="color:${roundColor}">
        ${snap.roundsUsed}/${snap.roundBudget}
        <span class="bar-wrap"><span class="bar-fill" style="width:${roundPct}%;background:${roundColor}"></span></span>
      </span>
    </div>
    <div class="stat-row">
      <span class="stat-label">PDSE</span>
      <span class="stat-value" style="color:${pdseColor}">${pdseDisplay}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Tasks</span>
      <span class="stat-value">${snap.activeTasks}</span>
    </div>
  </div>

  ${
    toolRows
      ? `<div class="section">
    <div class="section-title">Recent Tools</div>
    ${toolRows}
  </div>`
      : `<div class="section"><div class="section-title">Recent Tools</div><div class="no-tools">No tools used yet</div></div>`
  }

  ${
    suggestions
      ? `<div class="section">
    <div class="section-title">Suggestions</div>
    ${suggestions}
  </div>`
      : ""
  }

  <div class="updated">Updated ${_timeAgo(snap.updatedAt)}</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function runCmd(cmd) {
      vscode.postMessage({ type: 'runCommand', command: cmd });
    }
  </script>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function _escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _timeAgo(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}
