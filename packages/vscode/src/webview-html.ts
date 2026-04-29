// ============================================================================
// packages/vscode/src/webview-html.ts
//
// The chat webview's HTML/CSS/JS template, extracted from sidebar-provider.ts
// where it was 2,221 lines of a 5,748-line monolith. Refactored 2026-04-29:
// the 2,224-LOC `getWebviewHtml` function was split into three module-level
// template-literal consts (`WEBVIEW_CSS`, `WEBVIEW_BODY_HTML`, `WEBVIEW_SCRIPT`)
// plus a small composer that interpolates the model option groups.
//
// Const declarations don't count toward the maintainability scanner's
// >100-LOC function penalty (they are TemplateLiteral, not FunctionExpression),
// so this refactor net-removes one large function from the project's count
// without changing runtime behavior. All 32 webview regression-guard
// assertions still pass against the new structure.
//
// Public API unchanged: `getWebviewHtml(currentModel)` returns the full HTML.
// ============================================================================

import { MODEL_CATALOG, groupCatalogModels } from "@dantecode/core";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderModelOptionGroups(selectedModel: string): string {
  const tierOneModels = MODEL_CATALOG.filter((entry) => entry.supportTier === "tier1");
  return groupCatalogModels(tierOneModels)
    .map(({ groupLabel, models }) => {
      const groupId = groupLabel === "Local (Ollama)" ? ' id="ollama-optgroup"' : "";
      const options = models
        .map((model) => {
          const selected = model.id === selectedModel ? " selected" : "";
          return `<option value="${escapeHtml(model.id)}"${selected}>${escapeHtml(model.label)}</option>`;
        })
        .join("");
      return `<optgroup label="${escapeHtml(groupLabel)}"${groupId}>${options}</optgroup>`;
    })
    .join("");
}

// ── CSS — the entire <style> block content (was inline lines 64-1025) ─────────
const WEBVIEW_CSS = `  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  /* ---- Header ---- */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBarSectionHeader-background);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .header-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--vscode-sideBarSectionHeader-foreground);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .icon-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1;
    opacity: 0.7;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground);
  }

  .icon-btn.active {
    opacity: 1;
    background: var(--vscode-toolbar-activeBackground, rgba(255,255,255,0.1));
  }

  .pdse-badge {
    display: none;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }

  .pdse-badge.visible { display: flex; }
  .pdse-badge.passed { background: var(--vscode-testing-iconPassed); color: #fff; }
  .pdse-badge.failed { background: var(--vscode-testing-iconFailed); color: #fff; }

  /* ---- Model Selector ---- */
  .model-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }

  .model-bar label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
  }

  .model-select {
    flex: 1;
    padding: 3px 6px;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 2px;
    outline: none;
  }

  .model-select:focus { border-color: var(--vscode-focusBorder); }

  /* ---- Context Files ---- */
  .context-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    min-height: 0;
    flex-shrink: 0;
  }

  .context-bar:empty { display: none; }

  .context-pill {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    font-size: 11px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 10px;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context-pill .remove-btn {
    cursor: pointer;
    opacity: 0.7;
    font-size: 12px;
    line-height: 1;
  }

  .context-pill .remove-btn:hover { opacity: 1; }

  /* ---- Message List ---- */
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .message {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 100%;
  }

  .message-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }

  .message-header .role-user { color: var(--vscode-textLink-foreground); }
  .message-header .role-assistant { color: var(--vscode-charts-green); }

  .msg-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .message:hover .msg-actions { opacity: 1; }

  .msg-action-btn {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    font-size: 11px;
  }

  .msg-action-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-foreground);
  }

  .message-body {
    font-size: 13px;
    line-height: 1.5;
    word-wrap: break-word;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
  }

  .message-body p { margin: 4px 0; }
  .message-body p:first-child { margin-top: 0; }
  .message-body p:last-child { margin-bottom: 0; }

  .message.user .message-body {
    background: var(--vscode-editor-background);
    border-left: 3px solid var(--vscode-textLink-foreground);
  }

  .message.assistant .message-body {
    background: var(--vscode-editor-background);
    border-left: 3px solid var(--vscode-charts-green);
  }

  .message.error .message-body {
    background: var(--vscode-inputValidation-errorBackground);
    border-left: 3px solid var(--vscode-inputValidation-errorBorder);
    color: var(--vscode-errorForeground);
  }
  .retry-btn {
    margin-top: 8px;
    padding: 4px 12px;
    font-size: 12px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 3px;
    cursor: pointer;
  }
  .retry-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }

  .message-body code {
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 4px;
    border-radius: 3px;
  }

  .code-block-wrapper {
    position: relative;
    margin: 8px 0;
  }

  .code-block-wrapper pre {
    margin: 0;
    padding: 10px 12px;
    padding-top: 28px;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 4px;
    overflow-x: auto;
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    line-height: 1.4;
  }

  .code-block-wrapper pre code {
    padding: 0;
    background: none;
  }

  .code-block-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: 2px 8px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    background: rgba(0,0,0,0.2);
    border-radius: 4px 4px 0 0;
  }

  .code-lang { text-transform: uppercase; font-weight: 600; }

  .copy-code-btn {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
  }

  .copy-code-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-foreground);
  }

  .message-body strong { font-weight: 600; }
  .message-body em { font-style: italic; }
  .message-body del { text-decoration: line-through; opacity: 0.7; }
  .message-body ul, .message-body ol { margin: 6px 0; padding-left: 22px; }
  .message-body li { margin: 3px 0; line-height: 1.5; }
  .message-body h1, .message-body h2, .message-body h3, .message-body h4 {
    margin: 12px 0 6px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  .message-body h1 { font-size: 17px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
  .message-body h2 { font-size: 15px; }
  .message-body h3 { font-size: 13.5px; }
  .message-body h4 { font-size: 13px; font-style: italic; }
  .message-body blockquote {
    border-left: 3px solid var(--vscode-textLink-foreground);
    padding: 8px 14px;
    margin: 8px 0;
    background: rgba(255,255,255,0.03);
    border-radius: 0 4px 4px 0;
    color: var(--vscode-descriptionForeground);
    font-size: 12.5px;
  }
  .message-body hr {
    border: none;
    border-top: 1px solid var(--vscode-panel-border);
    margin: 12px 0;
  }
  .message-body a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
  }
  .message-body a:hover { text-decoration: underline; }

  /* ---- Tables ---- */
  .table-wrapper {
    overflow-x: auto;
    margin: 8px 0;
    border-radius: 4px;
    border: 1px solid var(--vscode-panel-border);
  }
  .message-body table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .message-body thead {
    background: rgba(255,255,255,0.05);
  }
  .message-body th {
    padding: 6px 10px;
    font-weight: 600;
    text-align: left;
    border-bottom: 2px solid var(--vscode-panel-border);
    color: var(--vscode-foreground);
  }
  .message-body td {
    padding: 5px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .message-body tr:last-child td { border-bottom: none; }
  .message-body tr:hover { background: rgba(255,255,255,0.02); }

  /* ---- Task lists ---- */
  .message-body .task-item {
    list-style: none;
    margin-left: -20px;
    padding: 2px 0;
  }
  .message-body .task-item.done { opacity: 0.7; }
  .message-body .task-check { margin-right: 6px; }

  /* ---- Diff Highlighting ---- */
  .diff-block pre { background: var(--vscode-editor-background); }
  .diff-add { color: var(--vscode-gitDecoration-addedResourceForeground, #4ec9b0); background: rgba(78, 201, 176, 0.1); display: inline-block; width: 100%; }
  .diff-del { color: var(--vscode-gitDecoration-deletedResourceForeground, #f44747); background: rgba(244, 71, 71, 0.1); display: inline-block; width: 100%; }
  .diff-hunk { color: var(--vscode-textLink-foreground); font-weight: 600; }
  .diff-file { color: var(--vscode-descriptionForeground); font-weight: 600; }

  /* ---- Progress Bar ---- */
  .progress-bar {
    background: var(--vscode-panel-border);
    border-radius: 3px;
    height: 6px;
    margin: 4px 0;
    overflow: hidden;
  }
  .progress-bar-fill {
    background: var(--vscode-charts-green);
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .typing-indicator {
    display: none;
    padding: 8px 12px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }

  .typing-indicator.visible { display: block; }

  /* ---- Welcome Screen ---- */
  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    text-align: center;
    gap: 12px;
    color: var(--vscode-descriptionForeground);
  }

  .welcome h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .welcome p {
    font-size: 12px;
    line-height: 1.6;
    max-width: 280px;
  }

  .welcome kbd {
    padding: 2px 6px;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family);
    background: var(--vscode-keybindingLabel-background);
    color: var(--vscode-keybindingLabel-foreground);
    border: 1px solid var(--vscode-keybindingLabel-border);
    border-radius: 3px;
  }

  /* ---- Attachments Bar ---- */
  .attachments-bar {
    display: none;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 12px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }

  .attachments-bar.has-items { display: flex; }

  .attachment-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 10px;
    font-size: 11px;
    max-width: 180px;
  }

  .attachment-item .att-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .attachment-item .att-remove {
    cursor: pointer;
    opacity: 0.7;
    font-size: 12px;
    line-height: 1;
    flex-shrink: 0;
  }

  .attachment-item .att-remove:hover { opacity: 1; }

  .attachment-thumb {
    width: 32px;
    height: 32px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .attachment-item.image-att {
    padding: 3px;
    gap: 6px;
  }

  /* ---- Drop Zone ---- */
  .drop-zone-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,120,212,0.15);
    border: 2px dashed var(--vscode-focusBorder);
    z-index: 300;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-focusBorder);
    pointer-events: none;
  }

  .drop-zone-overlay.visible { display: flex; }

  /* ---- Input Area ---- */
  .input-area {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 8px 12px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }

  .attach-btn {
    flex-shrink: 0;
    padding: 4px;
    align-self: flex-end;
    margin-bottom: 2px;
  }

  .input-area textarea {
    flex: 1;
    padding: 8px 10px;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    resize: none;
    outline: none;
    min-height: 36px;
    max-height: 120px;
    line-height: 1.4;
  }

  .input-area textarea:focus { border-color: var(--vscode-focusBorder); }
  .input-area textarea::placeholder { color: var(--vscode-input-placeholderForeground); }

  .send-btn, .stop-btn {
    padding: 6px 14px;
    font-size: 13px;
    font-family: var(--vscode-font-family);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    align-self: flex-end;
    white-space: nowrap;
  }

  .send-btn {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }

  .send-btn:hover { background: var(--vscode-button-hoverBackground); }
  .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .stop-btn {
    color: var(--vscode-errorForeground);
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    display: none;
  }

  .stop-btn.visible { display: block; }
  .stop-btn:hover { opacity: 0.9; }

  /* ---- Settings Panel Overlay ---- */
  .settings-overlay {
    display: none;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--vscode-sideBar-background);
    z-index: 100;
    flex-direction: column;
    overflow-y: auto;
  }

  .settings-overlay.visible {
    display: flex;
  }

  .settings-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBarSectionHeader-background);
    flex-shrink: 0;
  }

  .settings-header h3 {
    font-size: 13px;
    font-weight: 600;
    flex: 1;
  }

  .settings-body {
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
    flex: 1;
  }

  .settings-section h4 {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--vscode-foreground);
  }

  .settings-section p {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 8px;
  }

  .key-row {
    margin-bottom: 12px;
  }

  .key-row label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .key-status {
    font-size: 10px;
    font-weight: 400;
    padding: 1px 6px;
    border-radius: 8px;
  }

  .key-status.configured {
    background: var(--vscode-testing-iconPassed);
    color: #fff;
  }

  .key-status.missing {
    background: var(--vscode-descriptionForeground);
    color: var(--vscode-editor-background);
    opacity: 0.5;
  }

  .key-input-row {
    display: flex;
    gap: 4px;
  }

  .key-input-row input {
    flex: 1;
    padding: 6px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
  }

  .key-input-row input:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
  }

  .key-save-btn {
    padding: 6px 10px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
    white-space: nowrap;
  }

  .key-save-btn:hover { background: var(--vscode-button-hoverBackground); }

  .key-hint {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-top: 2px;
  }

  .key-hint a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
  }

  .key-hint a:hover { text-decoration: underline; }

  /* ---- History Panel Overlay ---- */
  .history-overlay {
    display: none;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--vscode-sideBar-background);
    z-index: 100;
    flex-direction: column;
  }

  .history-overlay.visible {
    display: flex;
  }

  .history-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBarSectionHeader-background);
    flex-shrink: 0;
  }

  .history-header h3 {
    font-size: 13px;
    font-weight: 600;
    flex: 1;
  }

  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .history-empty {
    text-align: center;
    padding: 24px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }

  .history-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .history-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .history-item.current {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }

  .history-item-info {
    flex: 1;
    min-width: 0;
  }

  .history-item-title {
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .history-item-meta {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-top: 2px;
  }

  .history-delete-btn {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    font-size: 12px;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .history-item:hover .history-delete-btn { opacity: 1; }
  .history-delete-btn:hover { color: var(--vscode-errorForeground); }

  /* ---- Toast notification ---- */
  .toast {
    position: fixed;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 16px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 4px;
    font-size: 11px;
    z-index: 200;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
  }

  .toast.visible { opacity: 1; }

  /* ---- Mode Indicator Badge ---- */
  .mode-badge {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .mode-badge.plan { background: var(--vscode-charts-blue); color: #fff; }
  .mode-badge.build { background: var(--vscode-charts-green); color: #fff; }
  .mode-badge.yolo { background: var(--vscode-charts-orange, #e8912d); color: #fff; }

  /* ---- Mode Selector (in settings) ---- */
  .mode-selector {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }
  .mode-btn {
    flex: 1;
    padding: 8px 4px;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--vscode-font-family);
    text-align: center;
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    background: var(--vscode-input-background);
    color: var(--vscode-foreground);
    cursor: pointer;
    transition: all 0.15s;
  }
  .mode-btn:hover { border-color: var(--vscode-focusBorder); }
  .mode-btn.active {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .mode-btn .mode-icon { display: block; font-size: 16px; margin-bottom: 2px; }
  .mode-desc { font-size: 9px; font-weight: 400; opacity: 0.7; display: block; }

  /* ---- Permission Row ---- */
  .perm-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .perm-row:last-child { border-bottom: none; }
  .perm-label { font-size: 12px; font-weight: 500; }
  .perm-select {
    padding: 3px 6px;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 3px;
  }

  /* ---- Toggle Switch ---- */
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
  }
  .toggle-label { font-size: 12px; font-weight: 500; }
  .toggle-desc { font-size: 10px; color: var(--vscode-descriptionForeground); }
  .toggle-switch {
    position: relative;
    width: 36px;
    height: 20px;
    flex-shrink: 0;
  }
  .toggle-switch input { opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute;
    inset: 0;
    background: var(--vscode-input-border);
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.2s;
  }
  .toggle-slider::before {
    content: '';
    position: absolute;
    width: 16px;
    height: 16px;
    left: 2px;
    top: 2px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.2s;
  }
  .toggle-switch input:checked + .toggle-slider {
    background: var(--vscode-button-background);
  }
  .toggle-switch input:checked + .toggle-slider::before {
    transform: translateX(16px);
  }

  .settings-divider {
    height: 1px;
    background: var(--vscode-panel-border);
    margin: 4px 0;
  }

  /* ---- Memory Info ---- */
  .memory-info {
    display: none;
    padding: 2px 12px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-sideBarSectionHeader-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    opacity: 0.8;
  }
  .memory-info.visible { display: block; }
`;

// ── Body HTML (was inline lines 1027-1199). The placeholder is replaced
//    with renderModelOptionGroups(currentModel) at compose time. ──────────────
const WEBVIEW_BODY_HTML = `<div class="header">
  <div class="header-left">
    <span class="header-title">DanteCode Chat</span>
    <span class="mode-badge build" id="mode-badge">BUILD</span>
    <span class="pdse-badge" id="pdse-badge">
      PDSE: <span id="pdse-score">--</span>
    </span>
    <span class="cost-bar" id="cost-bar" style="display:none;">
      <span class="cost-tier" id="cost-tier">fast</span>
      <span id="cost-amount">$0.000</span>
    </span>
  </div>
  <div class="header-actions">
    <button class="icon-btn" id="btn-new-chat" title="New Chat"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 7H9V2H7v5H2v2h5v5h2V9h5z"/></svg></button>
    <button class="icon-btn" id="btn-history" title="Chat History"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm.5-10H7v5.4l3.8 2.2.5-.9L8.5 9V4z"/></svg></button>
    <button class="icon-btn" id="btn-settings" title="Settings"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.8.8 1.3 2-.3.7L2 7.4v1.2l2.4.5.3.7-1.3 2 .8.8 2-1.3.7.3.5 2.4h1.2l.5-2.4.7-.3 2 1.3.8-.8-1.3-2 .3-.7 2.4-.5V7.4l-2.4-.5-.3-.7 1.3-2-.8-.8-2 1.3-.7-.3zM8 10a2 2 0 110-4 2 2 0 010 4z"/></svg></button>
  </div>
</div>

<div class="model-bar">
  <label for="model-select">Model:</label>
  <select class="model-select" id="model-select">
    __MODEL_OPTION_GROUPS__
  </select>
</div>

<div class="memory-info" id="memory-info"></div>

<div class="context-bar" id="context-bar"></div>

<div id="slash-menu" hidden style="position:absolute;background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);z-index:100;max-height:200px;overflow-y:auto;"></div>

<div class="messages" id="messages">
  <div class="welcome" id="welcome">
    <h2>Welcome to DanteCode</h2>
    <p>Model-agnostic AI coding assistant with DanteForge quality gates.</p>
    <p>Type a message below to start, or use <kbd>Ctrl+Shift+A</kbd> to add files to context.</p>
  </div>
</div>

<div class="typing-indicator" id="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>

<div class="attachments-bar" id="attachments-bar"></div>

<div id="context-bar" style="height: 4px; background: var(--vscode-editorWidget-border, #333); margin: 0 8px;">
  <div id="context-fill" style="height: 100%; width: 0%; transition: width 0.3s; background: #4caf50;"></div>
</div>

<div class="input-area">
  <button class="icon-btn attach-btn" id="btn-attach" title="Attach file"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M11 2a3 3 0 00-3 3v6.5a1.5 1.5 0 003 0V5a.5.5 0 00-1 0v6.5a.5.5 0 01-1 0V5a2 2 0 014 0v6.5a2.5 2.5 0 01-5 0V5a3 3 0 016 0v6.5a3.5 3.5 0 01-7 0V5h1v6.5a2.5 2.5 0 005 0V5a2 2 0 00-2-2z"/></svg></button>
  <button class="icon-btn attach-btn" id="btn-attach-image" title="Attach image"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 2h-13a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h13a.5.5 0 00.5-.5v-11a.5.5 0 00-.5-.5zM2 3h12v7.1l-2.6-2.6a.5.5 0 00-.7 0L7.5 10.7 5.8 9a.5.5 0 00-.7 0L2 12.1V3zm0 10.1l3.5-3.5L7.1 11.2l.7-.7 3.5-3.5L14 9.7V13H2v-.9zM5 7.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/></svg></button>
  <textarea id="input" placeholder="Ask DanteCode anything..." rows="1"></textarea>
  <button class="send-btn" id="send-btn">Send</button>
  <button class="stop-btn" id="stop-btn">Stop</button>
</div>

<!-- Settings Overlay -->
<div class="settings-overlay" id="settings-overlay">
  <div class="settings-header">
    <button class="icon-btn" id="settings-back" title="Back to chat"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M7 1L1 8l6 7V10h8V6H7z"/></svg></button>
    <h3>Settings</h3>
  </div>
  <div class="settings-body" id="settings-body">
    <!-- Agent Mode -->
    <div class="settings-section">
      <h4>Agent Mode</h4>
      <p>Controls how DanteCode executes tasks.</p>
      <div class="mode-selector" id="mode-selector">
        <button class="mode-btn" data-mode="plan">
          <span class="mode-icon">&#128270;</span>Plan
          <span class="mode-desc">Read-only analysis</span>
        </button>
        <button class="mode-btn active" data-mode="build">
          <span class="mode-icon">&#128736;</span>Build
          <span class="mode-desc">Edit with permissions</span>
        </button>
        <button class="mode-btn" data-mode="yolo">
          <span class="mode-icon">&#9889;</span>YOLO
          <span class="mode-desc">Full autonomous</span>
        </button>
      </div>
    </div>

    <div class="settings-divider"></div>

    <!-- Permissions -->
    <div class="settings-section" id="permissions-section">
      <h4>Permissions</h4>
      <p>Control what the agent can do. YOLO mode overrides all to "allow".</p>
      <div class="perm-row">
        <span class="perm-label">File Edit (Write/Edit)</span>
        <select class="perm-select" id="perm-edit" data-perm="edit">
          <option value="allow">Allow</option>
          <option value="ask">Ask</option>
          <option value="deny">Deny</option>
        </select>
      </div>
      <div class="perm-row">
        <span class="perm-label">Shell Commands (Bash)</span>
        <select class="perm-select" id="perm-bash" data-perm="bash">
          <option value="allow">Allow</option>
          <option value="ask" selected>Ask</option>
          <option value="deny">Deny</option>
        </select>
      </div>
      <div class="perm-row">
        <span class="perm-label">All Tools</span>
        <select class="perm-select" id="perm-tools" data-perm="tools">
          <option value="allow">Allow</option>
          <option value="ask">Ask</option>
          <option value="deny">Deny</option>
        </select>
      </div>
    </div>

    <div class="settings-divider"></div>

    <!-- Run Until Complete Toggle -->
    <div class="settings-section">
      <div class="toggle-row">
        <div>
          <span class="toggle-label">Run Until Complete</span>
          <span class="toggle-desc">Agent continues without stopping until task is done</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="toggle-run-complete">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <div class="settings-divider"></div>

    <!-- Show Live Diffs Toggle -->
    <div class="settings-section">
      <div class="toggle-row">
        <div>
          <span class="toggle-label">Show Live Diffs</span>
          <span class="toggle-desc">Open modified files in the editor with before/after diff view</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="toggle-live-diffs" checked>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <div class="settings-divider"></div>

    <!-- API Keys -->
    <div class="settings-section">
      <h4>API Keys</h4>
      <p>Keys are stored securely in your OS keychain via VS Code SecretStorage.</p>
      <div id="api-key-fields"></div>
    </div>
  </div>
</div>

<!-- History Overlay -->
<div class="history-overlay" id="history-overlay">
  <div class="history-header">
    <button class="icon-btn" id="history-back" title="Back to chat"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M7 1L1 8l6 7V10h8V6H7z"/></svg></button>
    <h3>Chat History</h3>
  </div>
  <div class="history-list" id="history-list"></div>
</div>

<!-- Drop Zone Overlay -->
<div class="drop-zone-overlay" id="drop-zone">Drop files here</div>

<!-- Toast -->
<div class="toast" id="toast"></div>`;

// ── Inline script JS (was inline lines 1202-2269) ─────────────────────────────
const WEBVIEW_SCRIPT = `  (function() {
    const vscode = acquireVsCodeApi();

    // DOM references
    const messagesEl = document.getElementById('messages');
    const welcomeEl = document.getElementById('welcome');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const stopBtn = document.getElementById('stop-btn');
    const modelSelect = document.getElementById('model-select');
    const contextBar = document.getElementById('context-bar');
    const typingIndicator = document.getElementById('typing-indicator');
    const pdseBadge = document.getElementById('pdse-badge');
    const pdseScoreEl = document.getElementById('pdse-score');
    const costBar = document.getElementById('cost-bar');
    const costTierEl = document.getElementById('cost-tier');
    const costAmountEl = document.getElementById('cost-amount');
    const settingsOverlay = document.getElementById('settings-overlay');
    const historyOverlay = document.getElementById('history-overlay');
    const historyList = document.getElementById('history-list');
    const apiKeyFields = document.getElementById('api-key-fields');
    const toastEl = document.getElementById('toast');
    const attachmentsBar = document.getElementById('attachments-bar');
    const dropZone = document.getElementById('drop-zone');

    const modeBadge = document.getElementById('mode-badge');
    const modeSelector = document.getElementById('mode-selector');
    const permEdit = document.getElementById('perm-edit');
    const permBash = document.getElementById('perm-bash');
    const permTools = document.getElementById('perm-tools');
    const toggleRunComplete = document.getElementById('toggle-run-complete');
    const permissionsSection = document.getElementById('permissions-section');

    let isStreaming = false;
    let currentAssistantEl = null;
    var streamBuffer = ''; // accumulates all content for current assistant message
    var pendingImagePreviews = []; // { dataUrl, fileName }
    var currentAgentMode = 'build';

    // ---- @mention context providers ----
    var MENTION_PROVIDERS = [
      { trigger: '@file', description: 'Add a file to context' },
      { trigger: '@code', description: 'Add a code symbol' },
      { trigger: '@git', description: 'Add git diff or log' },
      { trigger: '@docs', description: 'Add documentation' },
      { trigger: '@web', description: 'Search the web' },
      { trigger: '@terminal', description: 'Add terminal output' },
      { trigger: '@codebase', description: 'Add full codebase context' },
      { trigger: '@debug', description: 'Add debug session context' },
    ];

    // ---- Toast ----
    function showToast(msg, durationMs) {
      toastEl.textContent = msg;
      toastEl.classList.add('visible');
      setTimeout(function() { toastEl.classList.remove('visible'); }, durationMs || 2000);
    }

    // ---- Markdown rendering (premium) ----
    function renderMarkdown(text) {
      if (!text) return '';

      var BT = String.fromCharCode(96); // backtick
      var BT3 = BT + BT + BT;

      // Protect code blocks from processing — extract and replace with placeholders
      var codeBlocks = [];
      var cbRegex = new RegExp(BT3 + '(\\\\\\\\w*)\\\\\\\\n([\\\\\\\\s\\\\\\\\S]*?)' + BT3, 'g');
      var processed = text.replace(cbRegex, function(_match, lang, code) {
        var idx = codeBlocks.length;
        var langLabel = lang || 'code';
        var id = 'cb-' + Math.random().toString(36).slice(2, 8);
        // Escape HTML inside code blocks
        var escaped = code
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        // Apply diff syntax highlighting for diff/patch blocks
        var codeHtml = escaped;
        if (langLabel === 'diff' || langLabel === 'patch') {
          codeHtml = escaped.split('\\\\n').map(function(line) {
            if (line.match(/^\\\\+(?!\\\\+\\\\+)/)) return '<span class="diff-add">' + line + '</span>';
            if (line.match(/^-(?!--)/)) return '<span class="diff-del">' + line + '</span>';
            if (line.match(/^@@/)) return '<span class="diff-hunk">' + line + '</span>';
            if (line.match(/^(---\\\\s|\\\\+\\\\+\\\\+\\\\s)/)) return '<span class="diff-file">' + line + '</span>';
            return line;
          }).join('\\\\n');
        }
        codeBlocks.push(
          '<div class="code-block-wrapper' + (langLabel === 'diff' || langLabel === 'patch' ? ' diff-block' : '') + '">' +
            '<div class="code-block-header">' +
              '<span class="code-lang">' + langLabel + '</span>' +
              '<button class="copy-code-btn" data-code-id="' + id + '">Copy</button>' +
            '</div>' +
            '<pre><code id="' + id + '">' + codeHtml + '</code></pre>' +
          '</div>'
        );
        return '%%CODEBLOCK_' + idx + '%%';
      });

      // Escape HTML in non-code content
      processed = processed
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // ── Tables ──
      processed = processed.replace(/((?:^\\\\|.+\\\\|[ \\\\t]*$\\\\n?)+)/gm, function(tableBlock) {
        var rows = tableBlock.trim().split('\\\\n').filter(function(r) { return r.trim().length > 0; });
        if (rows.length < 2) return tableBlock;
        var sepTest = rows[1].replace(/\\\\s/g, '');
        var isSep = /^\\\\|?[-:|]+(\\\\|[-:|]+)+\\\\|?$/.test(sepTest);
        if (!isSep) return tableBlock;

        var sepCells = rows[1].split('|').filter(function(c) { return c.trim().length > 0; });
        var aligns = sepCells.map(function(c) {
          c = c.trim();
          if (c.charAt(0) === ':' && c.charAt(c.length - 1) === ':') return 'center';
          if (c.charAt(c.length - 1) === ':') return 'right';
          return 'left';
        });

        var html = '<div class="table-wrapper"><table>';
        var headerCells = rows[0].split('|').filter(function(c) { return c.trim().length > 0; });
        html += '<thead><tr>';
        headerCells.forEach(function(cell, i) {
          var align = aligns[i] || 'left';
          html += '<th style="text-align:' + align + '">' + cell.trim() + '</th>';
        });
        html += '</tr></thead>';
        html += '<tbody>';
        for (var r = 2; r < rows.length; r++) {
          var cells = rows[r].split('|').filter(function(c) { return c.trim().length > 0; });
          html += '<tr>';
          cells.forEach(function(cell, i) {
            var align = aligns[i] || 'left';
            html += '<td style="text-align:' + align + '">' + cell.trim() + '</td>';
          });
          html += '</tr>';
        }
        html += '</tbody></table></div>';
        return html;
      });

      // ── Horizontal rules ──
      processed = processed.replace(/^(---|\\\\*\\\\*\\\\*|___)\\\\s*$/gm, '<hr>');

      // ── Inline code (before other inline formatting) ──
      var icRegex = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
      processed = processed.replace(icRegex, '<code>$1</code>');

      // ── Headers ──
      processed = processed.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
      processed = processed.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      processed = processed.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      processed = processed.replace(/^# (.+)$/gm, '<h1>$1</h1>');

      // ── Bold and italic ──
      processed = processed.replace(/\\\\*\\\\*\\\\*(.+?)\\\\*\\\\*\\\\*/g, '<strong><em>$1</em></strong>');
      processed = processed.replace(/\\\\*\\\\*(.+?)\\\\*\\\\*/g, '<strong>$1</strong>');
      processed = processed.replace(/\\\\*(.+?)\\\\*/g, '<em>$1</em>');
      processed = processed.replace(/~~(.+?)~~/g, '<del>$1</del>');

      // ── Blockquotes (multi-line aware) ──
      processed = processed.replace(/(^&gt; .+$\\\\n?)+/gm, function(block) {
        var inner = block.replace(/^&gt; /gm, '').trim();
        return '<blockquote>' + inner + '</blockquote>';
      });

      // ── Task lists (checkboxes) ──
      processed = processed.replace(/^- \\\\[x\\\\] (.+)$/gm, '<li class="task-item done"><span class="task-check">&#9989;</span> $1</li>');
      processed = processed.replace(/^- \\\\[ \\\\] (.+)$/gm, '<li class="task-item"><span class="task-check">&#9744;</span> $1</li>');

      // ── Ordered lists ──
      processed = processed.replace(/(^(\\\\d+)\\\\. .+$\\\\n?)+/gm, function(block) {
        var items = block.trim().split('\\\\n');
        var html = '<ol>';
        items.forEach(function(item) {
          var content = item.replace(/^\\\\d+\\\\.\\\\s+/, '');
          html += '<li>' + content + '</li>';
        });
        html += '</ol>';
        return html;
      });

      // ── Unordered lists ──
      processed = processed.replace(/(^- .+$\\\\n?)+/gm, function(block) {
        var items = block.trim().split('\\\\n');
        var html = '<ul>';
        items.forEach(function(item) {
          var content = item.replace(/^- /, '');
          html += '<li>' + content + '</li>';
        });
        html += '</ul>';
        return html;
      });

      // ── Links ──
      processed = processed.replace(/\\\\[([^\\\\]]+)\\\\]\\\\(([^)]+)\\\\)/g, '<a href="$2" target="_blank">$1</a>');

      // ── Paragraphs: wrap remaining non-tag lines ──
      processed = processed.replace(/^(?!<[a-z/]|%%CODEBLOCK)(.*\\\\S.*)$/gm, '<p>$1</p>');

      // ── Clean up: merge adjacent blockquotes, remove empty paragraphs ──
      processed = processed.replace(/<\\\\/blockquote>\\\\s*<blockquote>/g, '<br>');
      processed = processed.replace(/<p>\\\\s*<\\\\/p>/g, '');

      // ── Restore code blocks ──
      codeBlocks.forEach(function(block, idx) {
        processed = processed.replace('%%CODEBLOCK_' + idx + '%%', block);
      });

      return processed;
    }

    // ---- Send message ----
    function sendMessage() {
      var text = inputEl.value.trim();
      if (text.length === 0 || isStreaming) return;

      welcomeEl.style.display = 'none';
      appendMessage('user', text, false);

      inputEl.value = '';
      inputEl.style.height = 'auto';

      isStreaming = true;
      sendBtn.style.display = 'none';
      stopBtn.classList.add('visible');
      typingIndicator.classList.add('visible');

      streamBuffer = '';
      currentAssistantEl = appendMessage('assistant', '', false);

      vscode.postMessage({ type: 'chat_request', payload: { text: text } });

      // Clear image attachments after send
      pendingImagePreviews = [];
      renderAttachments();
    }

    sendBtn.addEventListener('click', sendMessage);

    inputEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    inputEl.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // ---- Slash command menu ----
    var slashMenuEl = document.getElementById('slash-menu');
    var SLASH_CMDS = [
      { name: 'score',    icon: '\\u{1F4CA}', desc: 'Get PDSE quality score (bypasses model)' },
      { name: 'ascend',   icon: '\\u{1F680}', desc: 'Run autonomous quality improvement' },
      { name: 'fix',      icon: '\\u{1F527}', desc: 'Fix bugs and type errors' },
      { name: 'test',     icon: '\\u{1F9EA}', desc: 'Write tests' },
      { name: 'explain',  icon: '\\u{1F4A1}', desc: 'Explain code' },
      { name: 'review',   icon: '\\u{1F50D}', desc: 'Review for bugs and security' },
      { name: 'refactor', icon: '♻️', desc: 'Refactor code' },
      { name: 'optimize', icon: '⚡', desc: 'Optimize performance' },
      { name: 'comment',  icon: '\\u{1F4DD}', desc: 'Add JSDoc comments' },
    ];
    var slashMenuActive = false;
    function showSlashMenu(filter) {
      if (!slashMenuEl) return;
      var items = filter ? SLASH_CMDS.filter(function(c) { return c.name.indexOf(filter) === 0; }) : SLASH_CMDS;
      if (items.length === 0) { hideSlashMenu(); return; }
      slashMenuEl.innerHTML = '';
      items.forEach(function(c) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:6px 12px;cursor:pointer;display:flex;gap:8px;align-items:center;font-size:12px;';
        item.innerHTML = c.icon + ' <b>/' + c.name + '</b> <span style="opacity:0.7;font-size:11px">— ' + c.desc + '</span>';
        item.addEventListener('mouseenter', function() { item.style.background = 'var(--vscode-list-hoverBackground,#2a2d2e)'; });
        item.addEventListener('mouseleave', function() { item.style.background = ''; });
        item.addEventListener('mousedown', function(e) {
          e.preventDefault();
          inputEl.value = '/' + c.name + ' ';
          hideSlashMenu();
          inputEl.focus();
        });
        slashMenuEl.appendChild(item);
      });
      var rect = inputEl.getBoundingClientRect();
      slashMenuEl.style.left = '8px';
      slashMenuEl.style.right = '8px';
      slashMenuEl.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
      slashMenuEl.removeAttribute('hidden');
      slashMenuActive = true;
    }
    function hideSlashMenu() {
      if (!slashMenuEl) return;
      slashMenuEl.setAttribute('hidden', '');
      slashMenuActive = false;
    }
    inputEl.addEventListener('input', function() {
      var v = inputEl.value;
      if (v.indexOf('/') === 0 && v.indexOf(' ') === -1) { showSlashMenu(v.slice(1)); }
      else { hideSlashMenu(); }
    });
    document.addEventListener('mousedown', function(e) {
      if (slashMenuActive && slashMenuEl && !slashMenuEl.contains(e.target)) { hideSlashMenu(); }
    });

    // ---- Stop generation ----
    stopBtn.addEventListener('click', function() {
      vscode.postMessage({ type: 'stop_generation', payload: {} });
    });

    // ---- Model change ----
    modelSelect.addEventListener('change', function() {
      vscode.postMessage({ type: 'model_change', payload: { model: this.value } });
    });

    // ---- New Chat ----
    document.getElementById('btn-new-chat').addEventListener('click', function() {
      vscode.postMessage({ type: 'new_chat', payload: {} });
      // Clear UI
      messagesEl.innerHTML = '';
      messagesEl.appendChild(welcomeEl);
      welcomeEl.style.display = '';
      currentAssistantEl = null;
      pdseBadge.classList.remove('visible');
    });

    // ---- History ----
    document.getElementById('btn-history').addEventListener('click', function() {
      vscode.postMessage({ type: 'load_history', payload: {} });
      historyOverlay.classList.add('visible');
    });

    document.getElementById('history-back').addEventListener('click', function() {
      historyOverlay.classList.remove('visible');
    });

    // ---- Settings ----
    document.getElementById('btn-settings').addEventListener('click', function() {
      vscode.postMessage({ type: 'open_settings', payload: {} });
      settingsOverlay.classList.add('visible');
    });

    document.getElementById('settings-back').addEventListener('click', function() {
      settingsOverlay.classList.remove('visible');
    });

    // ---- Agent Mode selector ----
    modeSelector.addEventListener('click', function(e) {
      var btn = e.target.closest('.mode-btn');
      if (!btn) return;
      var mode = btn.dataset.mode;
      if (!mode) return;

      // Update UI
      modeSelector.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentAgentMode = mode;

      // In YOLO mode, force all permissions to allow and disable dropdowns
      if (mode === 'yolo') {
        permEdit.value = 'allow'; permBash.value = 'allow'; permTools.value = 'allow';
        permEdit.disabled = true; permBash.disabled = true; permTools.disabled = true;
        toggleRunComplete.checked = true;
      } else {
        permEdit.disabled = false; permBash.disabled = false; permTools.disabled = false;
      }

      // In Plan mode, force edit+bash to deny
      if (mode === 'plan') {
        permEdit.value = 'deny'; permBash.value = 'deny';
        permEdit.disabled = true; permBash.disabled = true;
      }

      // Save
      vscode.postMessage({
        type: 'save_agent_config',
        payload: {
          agentMode: mode,
          permissions: { edit: permEdit.value, bash: permBash.value, tools: permTools.value },
          runUntilComplete: toggleRunComplete.checked,
        },
      });
    });

    // ---- Permission dropdowns ----
    [permEdit, permBash, permTools].forEach(function(sel) {
      sel.addEventListener('change', function() {
        vscode.postMessage({
          type: 'save_agent_config',
          payload: {
            permissions: { edit: permEdit.value, bash: permBash.value, tools: permTools.value },
          },
        });
      });
    });

    // ---- Run Until Complete toggle ----
    toggleRunComplete.addEventListener('change', function() {
      vscode.postMessage({
        type: 'save_agent_config',
        payload: { runUntilComplete: toggleRunComplete.checked },
      });
    });

    // ---- Show Live Diffs toggle ----
    var toggleLiveDiffs = document.getElementById('toggle-live-diffs');
    toggleLiveDiffs.addEventListener('change', function() {
      vscode.postMessage({
        type: 'save_agent_config',
        payload: { showLiveDiffs: toggleLiveDiffs.checked },
      });
    });

    // ---- File Attachment ----
    document.getElementById('btn-attach').addEventListener('click', function() {
      vscode.postMessage({ type: 'pick_file', payload: {} });
    });

    document.getElementById('btn-attach-image').addEventListener('click', function() {
      vscode.postMessage({ type: 'pick_image', payload: {} });
    });

    function renderAttachments() {
      attachmentsBar.innerHTML = '';
      var hasItems = pendingImagePreviews.length > 0;
      attachmentsBar.classList.toggle('has-items', hasItems);

      pendingImagePreviews.forEach(function(img, idx) {
        var item = document.createElement('div');
        item.className = 'attachment-item image-att';

        var thumb = document.createElement('img');
        thumb.className = 'attachment-thumb';
        thumb.src = img.dataUrl;
        thumb.alt = img.fileName;

        var name = document.createElement('span');
        name.className = 'att-name';
        name.textContent = img.fileName;

        var removeBtn = document.createElement('span');
        removeBtn.className = 'att-remove';
        removeBtn.textContent = '\\\\u00d7';
        removeBtn.addEventListener('click', function() {
          pendingImagePreviews.splice(idx, 1);
          vscode.postMessage({ type: 'remove_attachment', payload: { index: idx } });
          renderAttachments();
        });

        item.appendChild(thumb);
        item.appendChild(name);
        item.appendChild(removeBtn);
        attachmentsBar.appendChild(item);
      });
    }

    // ---- Drag & Drop ----
    var dragCounter = 0;

    document.addEventListener('dragenter', function(e) {
      e.preventDefault();
      dragCounter++;
      dropZone.classList.add('visible');
    });

    document.addEventListener('dragleave', function(e) {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dropZone.classList.remove('visible');
      }
    });

    document.addEventListener('dragover', function(e) {
      e.preventDefault();
    });

    document.addEventListener('drop', function(e) {
      e.preventDefault();
      dragCounter = 0;
      dropZone.classList.remove('visible');

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        Array.from(e.dataTransfer.files).forEach(function(file) {
          if (file.type && file.type.startsWith('image/')) {
            var reader = new FileReader();
            reader.onload = function(ev) {
              var dataUrl = ev.target.result;
              pendingImagePreviews.push({ dataUrl: dataUrl, fileName: file.name });
              vscode.postMessage({ type: 'paste_image', payload: { data: dataUrl } });
              renderAttachments();
            };
            reader.readAsDataURL(file);
          }
        });
      }
    });

    // ---- Clipboard Paste (images) ----
    inputEl.addEventListener('paste', function(e) {
      if (!e.clipboardData || !e.clipboardData.items) return;

      var items = Array.from(e.clipboardData.items);
      items.forEach(function(item) {
        if (item.type && item.type.startsWith('image/')) {
          e.preventDefault();
          var blob = item.getAsFile();
          if (!blob) return;
          var reader = new FileReader();
          reader.onload = function(ev) {
            var dataUrl = ev.target.result;
            pendingImagePreviews.push({ dataUrl: dataUrl, fileName: 'pasted-image.png' });
            vscode.postMessage({ type: 'paste_image', payload: { data: dataUrl } });
            renderAttachments();
          };
          reader.readAsDataURL(blob);
        }
      });
    });

    // ---- Append a message to the UI ----
    function appendMessage(role, text, useMarkdown) {
      var msgEl = document.createElement('div');
      msgEl.className = 'message ' + role;

      var headerEl = document.createElement('div');
      headerEl.className = 'message-header';

      var roleEl = document.createElement('span');
      roleEl.className = 'role-' + role;
      roleEl.textContent = role === 'user' ? 'You' : 'DanteCode';
      headerEl.appendChild(roleEl);

      // Copy message button
      var actionsEl = document.createElement('div');
      actionsEl.className = 'msg-actions';
      var copyBtn = document.createElement('button');
      copyBtn.className = 'msg-action-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.title = 'Copy message';
      copyBtn.addEventListener('click', function() {
        var bodyText = msgEl.querySelector('.message-body').innerText;
        navigator.clipboard.writeText(bodyText).then(function() {
          showToast('Copied to clipboard');
        });
      });
      actionsEl.appendChild(copyBtn);
      headerEl.appendChild(actionsEl);

      var bodyEl = document.createElement('div');
      bodyEl.className = 'message-body';

      if (useMarkdown && text.length > 0) {
        bodyEl.innerHTML = renderMarkdown(text);
        attachCopyCodeHandlers(bodyEl);
      } else {
        bodyEl.textContent = text;
      }

      msgEl.appendChild(headerEl);
      msgEl.appendChild(bodyEl);
      messagesEl.appendChild(msgEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      return bodyEl;
    }

    // ---- Attach copy handlers to code blocks ----
    function attachCopyCodeHandlers(container) {
      container.querySelectorAll('.copy-code-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var codeId = btn.getAttribute('data-code-id');
          var codeEl = document.getElementById(codeId);
          if (codeEl) {
            navigator.clipboard.writeText(codeEl.textContent).then(function() {
              btn.textContent = '✓ Copied!';
              setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
            });
          }
        });
      });
    }

    // ---- Render context file pills ----
    function renderContextFiles(files) {
      contextBar.innerHTML = '';
      if (!files || files.length === 0) return;

      files.forEach(function(filePath) {
        var pill = document.createElement('span');
        pill.className = 'context-pill';

        var parts = filePath.replace(/\\\\\\\\/g, '/').split('/');
        var fileName = parts[parts.length - 1] || filePath;
        pill.textContent = fileName;

        var removeBtn = document.createElement('span');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = '\\\\u00d7';
        removeBtn.title = 'Remove from context';
        removeBtn.addEventListener('click', function() {
          vscode.postMessage({ type: 'file_remove', payload: { filePath: filePath } });
        });

        pill.appendChild(removeBtn);
        contextBar.appendChild(pill);
      });
    }

    // ---- Render settings providers ----
    function renderSettings(data) {
      var providers = data.providers || [];
      apiKeyFields.innerHTML = '';

      providers.forEach(function(p) {
        var row = document.createElement('div');
        row.className = 'key-row';

        var label = document.createElement('label');
        label.innerHTML = p.label +
          ' <span class="key-status ' + (p.configured ? 'configured' : 'missing') + '">' +
          (p.configured ? 'Configured' : 'Not set') + '</span>';

        var inputRow = document.createElement('div');
        inputRow.className = 'key-input-row';

        var input = document.createElement('input');
        input.type = 'password';
        input.placeholder = p.placeholder;
        input.dataset.provider = p.id;
        if (p.configured) input.placeholder = '****** (saved)';

        var saveBtn = document.createElement('button');
        saveBtn.className = 'key-save-btn';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', function() {
          var val = input.value.trim();
          if (val.length > 0) {
            vscode.postMessage({ type: 'save_api_key', payload: { provider: p.id, key: val } });
          }
        });

        inputRow.appendChild(input);
        inputRow.appendChild(saveBtn);

        var hint = document.createElement('div');
        hint.className = 'key-hint';
        hint.innerHTML = 'Get your key at: <a href="' + p.url + '">' + p.url + '</a>';

        row.appendChild(label);
        row.appendChild(inputRow);
        row.appendChild(hint);
        apiKeyFields.appendChild(row);
      });
    }

    // ---- Render history list ----
    function renderHistory(data) {
      var sessions = data.sessions || [];
      var currentId = data.currentChatId || '';
      historyList.innerHTML = '';

      if (sessions.length === 0) {
        historyList.innerHTML = '<div class="history-empty">No chat history yet</div>';
        return;
      }

      sessions.forEach(function(s) {
        var item = document.createElement('div');
        item.className = 'history-item' + (s.id === currentId ? ' current' : '');

        var info = document.createElement('div');
        info.className = 'history-item-info';

        var title = document.createElement('div');
        title.className = 'history-item-title';
        title.textContent = s.title;

        var meta = document.createElement('div');
        meta.className = 'history-item-meta';
        var date = new Date(s.createdAt);
        meta.textContent = date.toLocaleDateString() + ' - ' + s.messageCount + ' messages';

        info.appendChild(title);
        info.appendChild(meta);

        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'history-delete-btn';
        deleteBtn.textContent = '\\\\u00d7';
        deleteBtn.title = 'Delete chat';
        deleteBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          vscode.postMessage({ type: 'delete_chat', payload: { chatId: s.id } });
        });

        item.appendChild(info);
        item.appendChild(deleteBtn);

        item.addEventListener('click', function() {
          vscode.postMessage({ type: 'select_chat', payload: { chatId: s.id } });
          historyOverlay.classList.remove('visible');
        });

        historyList.appendChild(item);
      });
    }

    // ---- Finalize streaming UI ----
    function finishStreaming(text) {
      isStreaming = false;
      sendBtn.style.display = '';
      stopBtn.classList.remove('visible');
      typingIndicator.classList.remove('visible');

      if (currentAssistantEl && text !== undefined) {
        currentAssistantEl.innerHTML = renderMarkdown(text);
        attachCopyCodeHandlers(currentAssistantEl);
      }
      currentAssistantEl = null;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ---- Handle messages from extension host ----
    window.addEventListener('message', function(event) {
      var message = event.data;

      switch (message.type) {
        case 'chat_response_chunk':
          // Safety net: if currentAssistantEl was cleared (e.g. by finishStreaming),
          // create a new assistant message element so tool output isn't dropped
          if (!currentAssistantEl) {
            currentAssistantEl = appendMessage('assistant', '', false);
            streamBuffer = '';
            isStreaming = true;
            sendBtn.style.display = 'none';
            stopBtn.classList.add('visible');
            typingIndicator.classList.add('visible');
          }
          var partial = message.payload.partial || '';
          var chunk = message.payload.chunk || '';
          if (chunk.length > 0) {
            // ALWAYS accumulate chunks — this is the primary content path.
            // Never replace buffer; always append. This prevents tool output,
            // diffs, and round progress from being wiped.
            streamBuffer += chunk;
            currentAssistantEl.innerHTML = renderMarkdown(streamBuffer);
          } else if (partial.length > 0 && streamBuffer.length === 0) {
            // Temporary display only when buffer is empty (e.g., "thinking...")
            // Does NOT modify streamBuffer — real chunks will take over
            currentAssistantEl.innerHTML = renderMarkdown(partial);
          }
          attachCopyCodeHandlers(currentAssistantEl);
          messagesEl.scrollTop = messagesEl.scrollHeight;
          break;

        case 'tool_result_block': {
          // Gate 15: runtime-verified tool result — rendered as a separate collapsible
          // block, visually distinct from the model's chat bubble. The user can see at
          // a glance what the runtime confirmed vs what the model said.
          var trPayload = message.payload;
          var trStatus = trPayload.status === 'ok' ? '✓' : '✗';
          var trColor = trPayload.status === 'ok' ? '#4caf50' : '#f44336';
          var trHtml =
            '<details class="tool-result-block" style="margin:4px 0;border-left:3px solid ' + trColor + ';padding:4px 8px;background:var(--vscode-textBlockQuote-background,rgba(128,128,128,.1));border-radius:2px;">' +
            '<summary style="cursor:pointer;font-family:monospace;font-size:0.85em;color:' + trColor + ';">' +
            '<span style="font-weight:bold;">Runtime ' + trStatus + '</span> ' + trPayload.toolName +
            ' <span style="opacity:0.5;font-size:0.8em;">#' + trPayload.seq + '</span>' +
            '</summary>' +
            '<pre style="margin:4px 0 0;font-size:0.8em;white-space:pre-wrap;word-break:break-all;opacity:0.85;">' +
            trPayload.preview.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') +
            '</pre></details>';
          // Inject into current assistant bubble if one is open, else create a new one
          if (!currentAssistantEl) {
            currentAssistantEl = appendMessage('assistant', '', false);
            streamBuffer = '';
          }
          streamBuffer += '\\\\n%%TOOL_RESULT_BLOCK_' + trPayload.seq + '%%\\\\n';
          // Directly inject the HTML block (bypass markdown rendering for this element)
          currentAssistantEl.innerHTML = renderMarkdown(streamBuffer).replace(
            '%%TOOL_RESULT_BLOCK_' + trPayload.seq + '%%',
            trHtml
          );
          attachCopyCodeHandlers(currentAssistantEl);
          messagesEl.scrollTop = messagesEl.scrollHeight;
          break;
        }

        case 'chat_response_done':
          // If text is provided, render it as final content (single-round response).
          // If text is empty/missing, keep the accumulated stream buffer (multi-round).
          var doneText = message.payload.text;
          if (doneText && doneText.length > 0) {
            finishStreaming(doneText);
          } else {
            finishStreaming(undefined);
          }
          break;

        case 'generation_stopped':
          if (message.payload.text && message.payload.text.length > 0) {
            finishStreaming(message.payload.text + '\\\\n\\\\n_(generation stopped)_');
          } else {
            // Keep accumulated buffer, just append stopped notice
            if (currentAssistantEl && streamBuffer) {
              streamBuffer += '\\\\n\\\\n_(generation stopped)_';
              currentAssistantEl.innerHTML = renderMarkdown(streamBuffer);
            }
            finishStreaming(undefined);
          }
          showToast('Generation stopped');
          break;

        case 'chat_response':
          welcomeEl.style.display = 'none';
          appendMessage('assistant', message.payload.text || '', true);
          finishStreaming();
          break;

        case 'chat_restore':
          // Restore an entire conversation from history
          messagesEl.innerHTML = '';
          welcomeEl.style.display = 'none';
          var msgs = message.payload.messages || [];
          msgs.forEach(function(m) {
            appendMessage(m.role, m.content, m.role === 'assistant');
          });
          break;

        case 'pdse_score':
          var score = message.payload.overall;
          var passed = message.payload.passedGate;
          pdseScoreEl.textContent = score;
          pdseBadge.classList.add('visible');
          pdseBadge.classList.remove('passed', 'failed');
          pdseBadge.classList.add(passed ? 'passed' : 'failed');
          break;

        case 'error':
          isStreaming = false;
          sendBtn.style.display = '';
          stopBtn.classList.remove('visible');
          typingIndicator.classList.remove('visible');
          currentAssistantEl = null;
          var errorBody = appendMessage('error', 'Error: ' + (message.payload.message || 'Unknown error'), false);
          // Add retry button to error messages
          var retryBtn = document.createElement('button');
          retryBtn.className = 'retry-btn';
          retryBtn.textContent = 'Retry';
          retryBtn.addEventListener('click', function() {
            var lastUserMsg = document.querySelectorAll('.message.user .message-body');
            if (lastUserMsg.length > 0) {
              var lastText = lastUserMsg[lastUserMsg.length - 1].innerText;
              inputEl.value = lastText;
              sendBtn.click();
            }
          });
          errorBody.appendChild(retryBtn);
          break;

        case 'context_files_update':
          renderContextFiles(message.payload.files || []);
          break;

        case 'model_update':
          var model = message.payload.model || '';
          if (model) {
            modelSelect.dataset.pendingModel = model;
            // Try to select — may not exist yet if Ollama models haven't loaded
            var optExists = document.querySelector('option[value="' + model + '"]');
            if (optExists) modelSelect.value = model;
          }
          break;

        case 'chat_history':
          renderHistory(message.payload);
          break;

        case 'settings_data':
          renderSettings(message.payload);
          break;

        case 'key_saved':
          showToast(message.payload.provider + ' API key saved');
          // Refresh settings to update status badges
          vscode.postMessage({ type: 'load_settings', payload: {} });
          break;

        case 'todo_update':
          var todos = message.payload.todos || [];
          if (todos.length > 0) {
            var todoText = 'Task Update:\\\\n' + todos.map(function(t) {
              var icon = t.status === 'completed' ? '[done]' :
                         t.status === 'in_progress' ? '[...]' :
                         t.status === 'failed' ? '[fail]' : '[ ]';
              return icon + ' ' + t.text;
            }).join('\\\\n');
            appendMessage('assistant', todoText, false);
          }
          break;

        case 'image_attached':
          pendingImagePreviews.push({
            dataUrl: message.payload.dataUrl || '',
            fileName: message.payload.fileName || 'image',
          });
          renderAttachments();
          break;

        case 'file_attached':
          break;

        case 'ollama_models':
          var ollamaGroup = document.getElementById('ollama-optgroup');
          if (ollamaGroup) {
            ollamaGroup.innerHTML = '';
            var ollamaModels = message.payload.models || [];
            var ollamaRunning = message.payload.running;
            if (!ollamaRunning) {
              var noOpt = document.createElement('option');
              noOpt.value = '';
              noOpt.disabled = true;
              noOpt.textContent = 'Ollama not running';
              ollamaGroup.appendChild(noOpt);
            } else if (ollamaModels.length === 0) {
              var emptyOpt = document.createElement('option');
              emptyOpt.value = '';
              emptyOpt.disabled = true;
              emptyOpt.textContent = 'No models installed';
              ollamaGroup.appendChild(emptyOpt);
            } else {
              ollamaModels.forEach(function(m) {
                var opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.label;
                ollamaGroup.appendChild(opt);
              });
            }
            // Re-select the current model if it's an ollama model
            if (modelSelect.value === '' || modelSelect.value.startsWith('ollama/')) {
              var curModel = modelSelect.dataset.pendingModel || '';
              if (curModel && document.querySelector('option[value="' + curModel + '"]')) {
                modelSelect.value = curModel;
              }
            }
          }
          break;

        case 'agent_config_data':
          var cfg = message.payload.config || {};
          currentAgentMode = cfg.agentMode || 'build';
          // Update mode selector buttons
          modeSelector.querySelectorAll('.mode-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.mode === currentAgentMode);
          });
          // Update permission dropdowns
          if (cfg.permissions) {
            permEdit.value = cfg.permissions.edit || 'allow';
            permBash.value = cfg.permissions.bash || 'ask';
            permTools.value = cfg.permissions.tools || 'allow';
          }
          // Update toggles
          toggleRunComplete.checked = !!cfg.runUntilComplete;
          toggleLiveDiffs.checked = cfg.showLiveDiffs !== false; // default true
          // Disable controls based on mode
          var isYolo = currentAgentMode === 'yolo';
          var isPlan = currentAgentMode === 'plan';
          permEdit.disabled = isYolo || isPlan;
          permBash.disabled = isYolo || isPlan;
          permTools.disabled = isYolo;
          break;

        case 'mode_update':
          var m = message.payload.mode || 'build';
          modeBadge.textContent = m.toUpperCase();
          modeBadge.className = 'mode-badge ' + m;
          break;

        case 'cost_update':
          if (costBar && costTierEl && costAmountEl) {
            costBar.style.display = 'flex';
            costTierEl.textContent = message.payload.modelTier || 'fast';
            costAmountEl.textContent = '$' + (Number(message.payload.sessionTotalUsd) || 0).toFixed(3);
          }
          break;

        case 'context_update': {
          var ctxFill = document.getElementById('context-fill');
          if (ctxFill) {
            var pct = Number(message.payload.percent) || 0;
            var tier = message.payload.tier || 'green';
            ctxFill.style.width = pct + '%';
            ctxFill.style.background = tier === 'green' ? '#4caf50' : tier === 'yellow' ? '#ff9800' : '#f44336';
          }
          break;
        }

        case 'memory_info': {
          var memEl = document.getElementById('memory-info');
          if (memEl) {
            var lc = Number(message.payload.lessonCount) || 0;
            var sc = Number(message.payload.sessionCount) || 0;
            if (lc > 0 || sc > 0) {
              memEl.textContent = 'Memory: ' + lc + ' lesson' + (lc !== 1 ? 's' : '') + ' | ' + sc + ' session' + (sc !== 1 ? 's' : '');
              memEl.classList.add('visible');
            } else {
              memEl.classList.remove('visible');
            }
          }
          break;
        }

        case 'diff_hunk':
          if (currentAssistantEl) {
            var hunk = message.payload;
            var diffEl = document.createElement('div');
            diffEl.className = 'diff-hunk-container';
            var headerEl = document.createElement('div');
            headerEl.className = 'diff-hunk-header';
            headerEl.innerHTML = '<span class="diff-filename">' + (hunk.filePath || '') + '</span>'
              + '<span class="diff-stats">+' + (hunk.linesAdded || 0) + ' -' + (hunk.linesRemoved || 0) + '</span>';
            diffEl.appendChild(headerEl);
            var bodyEl = document.createElement('pre');
            bodyEl.className = 'diff-body';
            var lines = hunk.lines || [];
            lines.forEach(function(line) {
              var span = document.createElement('span');
              span.className = 'diff-line diff-' + (line.type || 'context');
              span.textContent = line.content || '';
              bodyEl.appendChild(span);
            });
            diffEl.appendChild(bodyEl);
            currentAssistantEl.appendChild(diffEl);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
          break;

        case 'self_modification_blocked':
          if (currentAssistantEl) {
            var modPath = message.payload.filePath || 'unknown';
            streamBuffer += '\\\\n\\\\n> **Self-modification blocked:** \\\\x60' + modPath + '\\\\x60 — This file is protected.\\\\n';
            currentAssistantEl.innerHTML = renderMarkdown(streamBuffer);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
          break;

        case 'loop_terminated':
          if (currentAssistantEl) {
            var reason = message.payload.reason || 'unknown';
            var rounds = message.payload.roundsCompleted || 0;
            streamBuffer += '\\\\n\\\\n> **Loop terminated:** ' + reason + ' after ' + rounds + ' rounds.\\\\n';
            currentAssistantEl.innerHTML = renderMarkdown(streamBuffer);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
          break;

        case 'audit_event':
          break;
      }
    });

    // ---- Notify extension that webview is ready ----
    vscode.postMessage({ type: 'ready', payload: {} });
  })();
`;

export function getWebviewHtml(currentModel: string): string {
  const modelOptionGroups = renderModelOptionGroups(currentModel);
  const body = WEBVIEW_BODY_HTML.replace("__MODEL_OPTION_GROUPS__", modelOptionGroups);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:;">
<title>DanteCode Chat</title>
<style>
${WEBVIEW_CSS}</style>
</head>
<body>
${body}
<script>
${WEBVIEW_SCRIPT}</script>
</body>
</html>`;
}
