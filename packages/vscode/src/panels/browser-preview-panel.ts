// ============================================================================
// BrowserPreviewPanel — Embedded browser for local dev servers (Bolt.DIY pattern)
// Shows a running local dev server inside the VS Code extension via WebviewPanel.
// ============================================================================

import * as vscode from "vscode";

export class BrowserPreviewPanel {
  public static currentPanel: BrowserPreviewPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private currentUrl: string;
  private disposables: vscode.Disposable[] = [];

  // ── Factory ────────────────────────────────────────────────────────────────

  static createOrShow(extensionUri: vscode.Uri, url?: string): BrowserPreviewPanel {
    const targetUrl = url ?? "http://localhost:3000";
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, reveal it.
    if (BrowserPreviewPanel.currentPanel) {
      BrowserPreviewPanel.currentPanel.panel.reveal(column);
      if (url) {
        BrowserPreviewPanel.currentPanel.navigate(url);
      }
      return BrowserPreviewPanel.currentPanel;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      "dantecode.browserPreview",
      "DanteCode Preview",
      column ?? vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );

    BrowserPreviewPanel.currentPanel = new BrowserPreviewPanel(panel, extensionUri, targetUrl);
    return BrowserPreviewPanel.currentPanel;
  }

  // ── Constructor ────────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    _extensionUri: vscode.Uri,
    url: string,
  ) {
    this.panel = panel;
    this.currentUrl = url;

    // Set initial HTML content.
    this.panel.webview.html = this.getWebviewContent(this.currentUrl);

    // Handle panel disposal.
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview.
    this.panel.webview.onDidReceiveMessage(
      (message: { command: string; url?: string }) => {
        switch (message.command) {
          case "openInBrowser":
            void vscode.env.openExternal(vscode.Uri.parse(this.currentUrl));
            break;
          case "navigate":
            if (message.url) {
              this.currentUrl = message.url;
              // Refresh the iframe by re-posting — handled in webview JS
            }
            break;
        }
      },
      null,
      this.disposables,
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  navigate(url: string): void {
    this.currentUrl = url;
    void this.panel.webview.postMessage({ command: "navigate", url });
  }

  // ── HTML Content ───────────────────────────────────────────────────────────

  getWebviewContent(url: string): string {
    // Escape the URL for safe embedding in HTML attributes.
    const safeUrl = url
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src *; script-src 'unsafe-inline'; style-src 'unsafe-inline';" />
  <title>DanteCode Preview</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: 12px;
    }

    /* ── Toolbar ── */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: var(--vscode-sideBar-background, #252526);
      border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
      flex-shrink: 0;
    }

    .url-input {
      flex: 1;
      height: 26px;
      padding: 0 8px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #cccccc);
      border-radius: 3px;
      font-size: 12px;
      outline: none;
    }

    .url-input:focus {
      border-color: var(--vscode-focusBorder, #007acc);
    }

    .btn {
      height: 26px;
      padding: 0 10px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
      transition: background 0.15s;
      white-space: nowrap;
    }

    .btn-primary {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }

    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #cccccc);
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }

    .btn-icon {
      width: 26px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }

    /* ── Device Mode Bar ── */
    .device-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--vscode-sideBar-background, #252526);
      border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
      flex-shrink: 0;
    }

    .device-label {
      color: var(--vscode-descriptionForeground, #8c8c8c);
      margin-right: 4px;
    }

    .btn-device {
      height: 22px;
      padding: 0 8px;
      font-size: 11px;
    }

    .btn-device.active {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
    }

    /* ── Frame Container ── */
    .frame-container {
      flex: 1;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      background: var(--vscode-editor-background, #1e1e1e);
      transition: all 0.3s ease;
    }

    iframe {
      border: none;
      height: 100%;
      transition: width 0.3s ease;
    }

    iframe.desktop { width: 100%; }
    iframe.tablet  { width: 768px;  border: 1px solid var(--vscode-panel-border, #3c3c3c); }
    iframe.mobile  { width: 375px;  border: 1px solid var(--vscode-panel-border, #3c3c3c); }

    /* ── Devtools overlay ── */
    #devtools-overlay {
      display: none;
      position: fixed;
      bottom: 0; left: 0; right: 0;
      height: 200px;
      background: var(--vscode-sideBar-background, #252526);
      border-top: 2px solid var(--vscode-focusBorder, #007acc);
      z-index: 10;
      padding: 8px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 11px;
    }

    #devtools-overlay.visible { display: block; }
  </style>
</head>
<body>

  <!-- ── Toolbar ── -->
  <div class="toolbar">
    <button class="btn btn-secondary btn-icon" id="btn-back" title="Go Back">&#8592;</button>
    <button class="btn btn-secondary btn-icon" id="btn-refresh" title="Refresh">&#8635;</button>
    <input
      class="url-input"
      id="url-input"
      type="text"
      value="${safeUrl}"
      placeholder="http://localhost:3000"
      spellcheck="false"
    />
    <button class="btn btn-primary" id="btn-go">Go</button>
    <button class="btn btn-secondary" id="btn-open-browser">&#x1F310; Open</button>
    <button class="btn btn-secondary btn-icon" id="btn-devtools" title="Toggle DevTools">&#128736;</button>
  </div>

  <!-- ── Device Mode ── -->
  <div class="device-bar">
    <span class="device-label">Device:</span>
    <button class="btn btn-secondary btn-device active" id="btn-desktop">Desktop</button>
    <button class="btn btn-secondary btn-device" id="btn-tablet">Tablet (768px)</button>
    <button class="btn btn-secondary btn-device" id="btn-mobile">Mobile (375px)</button>
  </div>

  <!-- ── Preview Frame ── -->
  <div class="frame-container" id="frame-container">
    <iframe
      id="preview-frame"
      class="desktop"
      src="${safeUrl}"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      title="DanteCode Preview"
    ></iframe>
  </div>

  <!-- ── DevTools Overlay ── -->
  <div id="devtools-overlay">
    <strong>Console (captures postMessage logs from iframe)</strong>
    <div id="devtools-log"></div>
  </div>

  <script>
    // ── Globals ──
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('preview-frame');
    const urlInput = document.getElementById('url-input');
    const devtoolsLog = document.getElementById('devtools-log');
    const devtoolsOverlay = document.getElementById('devtools-overlay');

    let devtoolsOpen = false;

    // ── Navigate ──
    function navigateTo(url) {
      if (!url) return;
      // Normalise: add http:// if missing scheme
      if (!/^https?:\/\//i.test(url)) {
        url = 'http://' + url;
      }
      frame.src = url;
      urlInput.value = url;
      vscode.postMessage({ command: 'navigate', url });
    }

    // ── Toolbar buttons ──
    document.getElementById('btn-go').addEventListener('click', () => {
      navigateTo(urlInput.value.trim());
    });

    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigateTo(urlInput.value.trim());
    });

    document.getElementById('btn-refresh').addEventListener('click', () => {
      frame.src = frame.src; // force reload
    });

    document.getElementById('btn-back').addEventListener('click', () => {
      frame.contentWindow?.history.back();
    });

    document.getElementById('btn-open-browser').addEventListener('click', () => {
      vscode.postMessage({ command: 'openInBrowser' });
    });

    document.getElementById('btn-devtools').addEventListener('click', () => {
      devtoolsOpen = !devtoolsOpen;
      devtoolsOverlay.classList.toggle('visible', devtoolsOpen);
    });

    // ── Device mode ──
    const deviceButtons = {
      desktop: document.getElementById('btn-desktop'),
      tablet: document.getElementById('btn-tablet'),
      mobile: document.getElementById('btn-mobile'),
    };

    Object.entries(deviceButtons).forEach(([mode, btn]) => {
      btn.addEventListener('click', () => {
        // Update active button
        Object.values(deviceButtons).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Swap iframe class
        frame.className = mode;
      });
    });

    // ── Handle messages from extension ──
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.command === 'navigate' && msg.url) {
        navigateTo(msg.url);
      }

      // Log everything to devtools overlay
      const entry = document.createElement('div');
      entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + JSON.stringify(msg);
      devtoolsLog.prepend(entry);
    });
  </script>
</body>
</html>`;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  dispose(): void {
    BrowserPreviewPanel.currentPanel = undefined;

    this.panel.dispose();

    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
