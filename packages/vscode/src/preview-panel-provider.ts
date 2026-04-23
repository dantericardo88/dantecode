// ============================================================================
// packages/vscode/src/preview-panel-provider.ts
//
// Dim 14 — Browser live preview: VSCode WebviewPanel that renders a local
// dev server in an iframe alongside the editor.
//
// Inspired by E2B's port-based URL pattern and the existing
// multi-file-diff-panel.ts webview pattern in this repo.
// Decision-changing: agents can see the running output of generated web
// apps without leaving the editor.
// ============================================================================

import * as vscode from "vscode";

// ── PreviewPanelProvider ──────────────────────────────────────────────────────

export class PreviewPanelProvider {
  private static panel: vscode.WebviewPanel | undefined;
  private static currentPort = 0;

  /** Create or reveal the preview panel pointing at localhost:{port}. */
  static createOrShow(port: number, context: vscode.ExtensionContext): void {
    PreviewPanelProvider.currentPort = port;

    if (PreviewPanelProvider.panel) {
      PreviewPanelProvider.panel.reveal(vscode.ViewColumn.Beside);
      PreviewPanelProvider.panel.webview.html = PreviewPanelProvider.buildHtml(port);
      return;
    }

    PreviewPanelProvider.panel = vscode.window.createWebviewPanel(
      "dantecode.preview",
      "DanteCode Preview",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    PreviewPanelProvider.panel.webview.html = PreviewPanelProvider.buildHtml(port);

    PreviewPanelProvider.panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "reload") {
        PreviewPanelProvider.refresh(PreviewPanelProvider.currentPort);
      }
    }, undefined, context.subscriptions);

    PreviewPanelProvider.panel.onDidDispose(() => {
      PreviewPanelProvider.panel = undefined;
    });
  }

  /** Refresh the preview (e.g., after a file save). */
  static refresh(port: number): void {
    PreviewPanelProvider.currentPort = port;
    if (PreviewPanelProvider.panel) {
      PreviewPanelProvider.panel.webview.html = PreviewPanelProvider.buildHtml(port);
    }
  }

  /** Dispose the panel. */
  static dispose(): void {
    PreviewPanelProvider.panel?.dispose();
    PreviewPanelProvider.panel = undefined;
  }

  /**
   * Post a structured error count to the webview, which renders an overlay
   * badge ("N errors — Fix with AI") when count > 0.
   * Dim 14 Gap 3 — error overlay badge.
   */
  static showErrors(errorCount: number): void {
    PreviewPanelProvider.panel?.webview.postMessage({ type: "errors", count: errorCount });
  }

  /** Returns the current preview URL (empty string if panel not open). */
  static getPreviewUrl(): string {
    return PreviewPanelProvider.currentPort > 0
      ? `http://localhost:${PreviewPanelProvider.currentPort}`
      : "";
  }

  // ── HTML ───────────────────────────────────────────────────────────────────

  private static buildHtml(port: number): string {
    const url = `http://localhost:${port}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:*; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { display: flex; flex-direction: column; height: 100vh; background: #1e1e1e; font-family: var(--vscode-font-family, sans-serif); }
    .toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #252526; border-bottom: 1px solid #3c3c3c; flex-shrink: 0; }
    .toolbar a { color: #cccccc; font-size: 12px; text-decoration: none; opacity: 0.7; }
    .toolbar a:hover { opacity: 1; }
    .url-badge { color: #9cdcfe; font-size: 11px; font-family: monospace; flex: 1; }
    button { background: #0e639c; color: #fff; border: none; border-radius: 3px; padding: 3px 10px; font-size: 11px; cursor: pointer; }
    button:hover { background: #1177bb; }
    iframe { flex: 1; border: none; width: 100%; }
    #error-badge {
      display: none; position: absolute; bottom: 16px; right: 16px;
      background: #f44336; color: #fff; border-radius: 4px;
      padding: 6px 12px; font-size: 12px; font-weight: 600;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5); cursor: pointer; z-index: 999;
    }
    #error-badge.visible { display: block; }
  </style>
</head>
<body style="position:relative">
  <div class="toolbar">
    <span class="url-badge">${url}</span>
    <button onclick="reloadPreview()">↺ Reload</button>
  </div>
  <iframe id="preview" src="${url}" sandbox="allow-scripts allow-same-origin allow-forms allow-modals"></iframe>
  <div id="error-badge" onclick="vscode.postMessage({type:'fix-with-ai'})"></div>
  <script>
    const vscode = acquireVsCodeApi();
    function reloadPreview() {
      const iframe = document.getElementById('preview');
      iframe.src = iframe.src;
    }
    window.addEventListener('message', (e) => {
      if (!e.data) return;
      if (e.data.type === 'reload') { reloadPreview(); return; }
      if (e.data.type === 'errors') {
        const badge = document.getElementById('error-badge');
        if (e.data.count > 0) {
          badge.textContent = e.data.count + ' error' + (e.data.count === 1 ? '' : 's') + ' — Fix with AI';
          badge.classList.add('visible');
        } else {
          badge.classList.remove('visible');
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
