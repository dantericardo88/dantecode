// ============================================================================
// DanteCode VS Code Extension — Audit Panel Provider
// Displays the audit event log from .dantecode/audit.jsonl in a webview
// panel within the DanteCode activity bar. Supports auto-refresh on file
// change and human-readable event formatting.
// ============================================================================

import * as vscode from "vscode";
import { readAuditEvents } from "@dantecode/core";
import type { AuditEventType } from "@dantecode/config-types";

/**
 * Maximum number of audit events to display in the panel at once.
 * Older events are paginated or truncated for performance.
 */
const MAX_EVENTS_DISPLAYED = 200;

/**
 * HTML-escapes a string for safe inclusion in HTML content (module-level helper for renderProofPayloadForTesting).
 */
function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Render proof-first payload HTML for V+E events (exported for testing).
 */
export function renderProofPayloadForTesting(type: string, payload: any): string {
  var html = '<div class="proof-content">';

  // Add proof badge
  if (type === "mutation_observed") {
    html += '<div class="proof-badge mutation">MUTATION</div>';
  } else if (type === "validation_observed") {
    html += '<div class="proof-badge validation">VALIDATION</div>';
  } else if (type === "completion_gate_passed") {
    html += '<div class="proof-badge gate-passed">GATE PASSED</div>';
  } else if (type === "completion_gate_failed") {
    html += '<div class="proof-badge gate-failed">GATE FAILED</div>';
  } else if (type.startsWith("tool_call_")) {
    html +=
      '<div class="proof-badge tool">' +
      (type === "tool_call_succeeded"
        ? "TOOL SUCCESS"
        : type === "tool_call_failed"
          ? "TOOL FAILED"
          : "TOOL START") +
      "</div>";
  }

  // Structured fields
  if (
    type === "tool_call_started" ||
    type === "tool_call_succeeded" ||
    type === "tool_call_failed"
  ) {
    html +=
      '<div class="proof-field"><strong>Tool:</strong> ' +
      escapeHtml(payload.toolName || "Unknown") +
      "</div>";
    html +=
      '<div class="proof-field"><strong>Tool Call ID:</strong> ' +
      escapeHtml(payload.toolCallId || "N/A") +
      "</div>";
    html +=
      '<div class="proof-field"><strong>Input:</strong> ' +
      escapeHtml(JSON.stringify(payload.input, null, 2)) +
      "</div>";
    if (payload.result) {
      html +=
        '<div class="proof-field"><strong>Result:</strong> ' +
        escapeHtml(payload.result.content || "N/A") +
        "</div>";
    }
  } else if (type === "mutation_observed") {
    html +=
      '<div class="proof-field"><strong>Tool Call ID:</strong> ' +
      escapeHtml(payload.toolCallId || "N/A") +
      "</div>";
    html +=
      '<div class="proof-field"><strong>File:</strong> ' +
      escapeHtml(payload.path || "N/A") +
      "</div>";
    html +=
      '<div class="proof-field"><strong>Before Hash:</strong> ' +
      escapeHtml(payload.beforeHash || "N/A") +
      "</div>";
    html +=
      '<div class="proof-field"><strong>After Hash:</strong> ' +
      escapeHtml(payload.afterHash || "N/A") +
      "</div>";
    html +=
      '<div class="proof-field"><strong>Diff Summary:</strong> ' +
      escapeHtml(payload.diffSummary || "N/A") +
      "</div>";
    html +=
      '<div class="proof-field"><strong>Additions/Deletions:</strong> +' +
      (payload.additions || 0) +
      " -" +
      (payload.deletions || 0) +
      "</div>";
    if (payload.readSnapshotId) {
      html +=
        '<div class="proof-field"><strong>Read Snapshot ID:</strong> ' +
        escapeHtml(payload.readSnapshotId) +
        "</div>";
    }
  } else if (type === "validation_observed") {
    html +=
      '<div class="proof-field"><strong>Tool Call ID:</strong> ' +
      escapeHtml(payload.toolCallId || "N/A") +
      "</div>";
    html +=
      '<div class="proof-field"><strong>Type:</strong> ' +
      escapeHtml(payload.type || "N/A") +
      "</div>";
    html +=
      '<div class="proof-field"><strong>Command:</strong> ' +
      escapeHtml(payload.command || "N/A") +
      "</div>";
    html +=
      '<div class="proof-field"><strong>Passed:</strong> ' +
      (payload.passed ? "Yes" : "No") +
      "</div>";
    html +=
      '<div class="proof-field"><strong>Output:</strong> ' +
      escapeHtml(payload.output || "N/A") +
      "</div>";
  } else if (type === "completion_gate_failed" || type === "completion_gate_passed") {
    html +=
      '<div class="proof-field"><strong>Passed:</strong> ' + (payload.ok ? "Yes" : "No") + "</div>";
    if (payload.reasonCode) {
      html +=
        '<div class="proof-field"><strong>Reason:</strong> ' +
        escapeHtml(payload.reasonCode) +
        "</div>";
    }
    if (payload.message) {
      html +=
        '<div class="proof-field"><strong>Message:</strong> ' +
        escapeHtml(payload.message) +
        "</div>";
    }
  }

  // Raw JSON as details
  html +=
    "<details><summary>Raw JSON</summary><pre>" +
    escapeHtml(JSON.stringify(payload, null, 2)) +
    "</pre></details>";

  html += "</div>";
  return html;
}

/**
 * Human-readable labels for each audit event type, used in the event list.
 */
const EVENT_TYPE_LABELS: Record<AuditEventType, string> = {
  session_start: "Session Started",
  session_end: "Session Ended",
  file_read: "File Read",
  file_write: "File Written",
  file_edit: "File Edited",
  bash_execute: "Command Executed",
  git_commit: "Git Commit",
  git_push: "Git Push",
  git_worktree_create: "Worktree Created",
  git_worktree_merge: "Worktree Merged",
  pdse_gate_pass: "PDSE Gate Passed",
  pdse_gate_fail: "PDSE Gate Failed",
  autoforge_start: "Autoforge Started",
  autoforge_iteration: "Autoforge Iteration",
  autoforge_success: "Autoforge Succeeded",
  autoforge_abort: "Autoforge Aborted",
  skill_import: "Skill Imported",
  skill_activate: "Skill Activated",
  lesson_record: "Lesson Recorded",
  lesson_inject: "Lesson Injected",
  agent_spawn: "Agent Spawned",
  agent_complete: "Agent Completed",
  noma_violation: "NOMA Violation",
  constitution_violation: "Constitution Violation",
  sandbox_start: "Sandbox Started",
  sandbox_stop: "Sandbox Stopped",
  self_modification_attempt: "Self-Modification Attempt",
  self_modification_allowed: "Self-Modification Allowed",
  self_modification_denied: "Self-Modification Denied",
  loop_terminated: "Loop Terminated",
  tier_escalation: "Tier Escalation",
  cost_update: "Cost Update",
  request_retry: "Request Retried",
  context_compacted: "Context Compacted",
  budget_blocked: "Budget Blocked",
  webhook_received: "Webhook Received",
  tool_call_started: "Tool Call Started",
  tool_call_succeeded: "Tool Call Succeeded",
  tool_call_failed: "Tool Call Failed",
  mutation_observed: "Mutation Observed",
  validation_observed: "Validation Observed",
  completion_gate_failed: "Completion Gate Failed",
  completion_gate_passed: "Completion Gate Passed",
};

/**
 * Icon mappings for event types, using VS Code codicon names.
 */
const EVENT_TYPE_ICONS: Record<string, string> = {
  session_start: "play",
  session_end: "debug-stop",
  file_read: "file",
  file_write: "file-add",
  file_edit: "edit",
  bash_execute: "terminal",
  git_commit: "git-commit",
  git_push: "cloud-upload",
  git_worktree_create: "git-branch",
  git_worktree_merge: "git-merge",
  pdse_gate_pass: "pass-filled",
  pdse_gate_fail: "error",
  autoforge_start: "rocket",
  autoforge_iteration: "sync",
  autoforge_success: "check-all",
  autoforge_abort: "close",
  skill_import: "extensions",
  skill_activate: "zap",
  lesson_record: "book",
  lesson_inject: "lightbulb",
  agent_spawn: "vm-running",
  agent_complete: "vm",
  noma_violation: "warning",
  constitution_violation: "shield",
  sandbox_start: "vm-running",
  sandbox_stop: "vm",
  request_retry: "history",
  context_compacted: "fold",
  budget_blocked: "circle-slash",
  tool_call_started: "play-circle",
  tool_call_succeeded: "check",
  tool_call_failed: "error",
  mutation_observed: "diff-added",
  validation_observed: "checklist",
  completion_gate_failed: "shield-x",
  completion_gate_passed: "shield-check",
};

/**
 * Color categories for event types, used for the event dot indicator.
 * Maps to VS Code theme color CSS variables.
 */
function getEventColor(type: AuditEventType): string {
  if (
    type.includes("fail") ||
    type.includes("violation") ||
    type.includes("abort") ||
    type === "tool_call_failed" ||
    type === "completion_gate_failed"
  ) {
    return "var(--vscode-testing-iconFailed)";
  }
  if (
    type.includes("pass") ||
    type.includes("success") ||
    type.includes("complete") ||
    type === "tool_call_succeeded" ||
    type === "completion_gate_passed"
  ) {
    return "var(--vscode-testing-iconPassed)";
  }
  if (
    type.includes("start") ||
    type.includes("spawn") ||
    type.includes("create") ||
    type === "tool_call_started"
  ) {
    return "var(--vscode-textLink-foreground)";
  }
  if (type === "mutation_observed" || type === "validation_observed") {
    return "var(--vscode-charts-green)";
  }
  return "var(--vscode-descriptionForeground)";
}

/**
 * AuditPanelProvider implements the VS Code WebviewViewProvider interface
 * to render the audit event log in the DanteCode activity bar.
 *
 * Features:
 * - Reads events from .dantecode/audit.jsonl via the @dantecode/core API
 * - Auto-refreshes when the audit.jsonl file changes on disk
 * - Formats events with timestamps, icons, and expandable payloads
 * - Displays up to MAX_EVENTS_DISPLAYED events in reverse chronological order
 */
export class AuditPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.auditView";

  private view: vscode.WebviewView | undefined;
  private fileWatcher: vscode.FileSystemWatcher | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Called by VS Code when the audit webview needs to be resolved.
   * Sets up the webview HTML, starts the file watcher for auto-refresh,
   * and loads the initial set of events.
   */
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

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: { type: string }) => {
      if (message.type === "refresh" || message.type === "ready") {
        await this.refreshEvents();
      }
    });

    // Start watching the audit.jsonl file for changes
    this.startFileWatcher();

    // Load initial events
    void this.refreshEvents();

    // Re-create the watcher if workspace folders change
    const folderWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.disposeFileWatcher();
      this.startFileWatcher();
      void this.refreshEvents();
    });

    webviewView.onDidDispose(() => {
      folderWatcher.dispose();
      this.disposeFileWatcher();
    });
  }

  /**
   * Creates a file system watcher for the audit.jsonl file in the current
   * workspace. When the file changes, the events are re-read and sent
   * to the webview.
   */
  private startFileWatcher(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return;
    }

    const pattern = new vscode.RelativePattern(folders[0]!, ".dantecode/audit.jsonl");

    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.fileWatcher.onDidChange(() => void this.refreshEvents());
    this.fileWatcher.onDidCreate(() => void this.refreshEvents());
    this.fileWatcher.onDidDelete(() => void this.refreshEvents());
  }

  /**
   * Disposes the active file watcher.
   */
  private disposeFileWatcher(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = undefined;
    }
  }

  /**
   * Reads the latest audit events and sends them to the webview for rendering.
   */
  async refreshEvents(): Promise<void> {
    if (!this.view) {
      return;
    }

    const projectRoot = this.getProjectRoot();
    if (projectRoot.length === 0) {
      void this.view.webview.postMessage({
        type: "events",
        payload: { events: [], error: null },
      });
      return;
    }

    try {
      const events = await readAuditEvents(projectRoot, {
        limit: MAX_EVENTS_DISPLAYED,
      });

      // Reverse to show newest first
      events.reverse();

      // Map events to a serializable format for the webview
      const serialized = events.map((event) => ({
        id: event.id,
        type: event.type,
        typeLabel: EVENT_TYPE_LABELS[event.type] ?? event.type,
        icon: EVENT_TYPE_ICONS[event.type] ?? "circle-outline",
        color: getEventColor(event.type),
        timestamp: event.timestamp,
        formattedTime: formatTimestamp(event.timestamp),
        sessionId: event.sessionId,
        modelId: event.modelId,
        payload: event.payload,
      }));

      void this.view.webview.postMessage({
        type: "events",
        payload: { events: serialized, error: null },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      void this.view.webview.postMessage({
        type: "events",
        payload: { events: [], error: message },
      });
    }
  }

  /**
   * Returns the first workspace folder's fsPath, or an empty string.
   */
  private getProjectRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? "";
  }

  /**
   * Generates the full HTML for the audit panel webview.
   */
  private getHtmlForWebview(_webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>DanteCode Audit Log</title>
  <style nonce="${nonce}">
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

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

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBarSectionHeader-background);
      flex-shrink: 0;
    }

    .header-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--vscode-sideBarSectionHeader-foreground);
    }

    .refresh-btn {
      padding: 2px 8px;
      font-size: 12px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-secondaryBackground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }

    .refresh-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .event-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      gap: 8px;
    }

    .error-state {
      padding: 12px;
      margin: 8px 12px;
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: 4px;
      font-size: 12px;
      color: var(--vscode-errorForeground);
    }

    .event-item {
      display: flex;
      flex-direction: column;
      padding: 6px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      cursor: pointer;
    }

    .event-item:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .event-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .event-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .event-type {
      font-size: 12px;
      font-weight: 600;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .event-time {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }

    .event-meta {
      display: none;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
      padding-left: 16px;
    }

    .event-meta.visible {
      display: block;
    }

    .event-meta-row {
      display: flex;
      gap: 4px;
      margin-top: 2px;
    }

    .event-meta-key {
      font-weight: 600;
      min-width: 60px;
    }

    .event-payload {
      display: none;
      margin-top: 6px;
      padding: 6px 8px;
      padding-left: 16px;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 3px;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
    }

    .event-payload.visible {
      display: block;
    }

    .event-count {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      padding: 4px 12px;
      text-align: right;
    }

    .proof-content {
      font-size: 11px;
    }

    .proof-badge {
      display: inline-block;
      padding: 2px 6px;
      margin: 4px 0;
      font-size: 10px;
      font-weight: bold;
      border-radius: 3px;
      color: var(--vscode-badge-foreground);
    }

    .proof-badge.mutation {
      background: var(--vscode-charts-green);
    }

    .proof-badge.validation {
      background: var(--vscode-charts-blue);
    }

    .proof-badge.gate-passed {
      background: var(--vscode-testing-iconPassed);
    }

    .proof-badge.gate-failed {
      background: var(--vscode-testing-iconFailed);
    }

    .proof-badge.tool {
      background: var(--vscode-charts-orange);
    }

    .proof-field {
      margin: 4px 0;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .proof-field strong {
      color: var(--vscode-sideBarTitle-foreground);
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="header-title">Audit Log</span>
    <button class="refresh-btn" id="refresh-btn">Refresh</button>
  </div>

  <div class="event-list" id="event-list">
    <div class="empty-state" id="empty-state">
      <p>No audit events yet.</p>
      <p>Events will appear here as you use DanteCode.</p>
    </div>
  </div>

  <div class="event-count" id="event-count"></div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      const eventList = document.getElementById('event-list');
      const emptyState = document.getElementById('empty-state');
      const eventCount = document.getElementById('event-count');
      const refreshBtn = document.getElementById('refresh-btn');

      refreshBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'refresh' });
      });

      // Track which events are expanded
      const expandedEvents = new Set();

      // Use the exported function for actual rendering
      window.renderProofPayload = renderProofPayloadForTesting;

      window.addEventListener('message', function(event) {
        var message = event.data;

        if (message.type === 'events') {
          var events = message.payload.events || [];
          var error = message.payload.error;

          // Clear existing content
          eventList.innerHTML = '';

          if (error) {
            var errorEl = document.createElement('div');
            errorEl.className = 'error-state';
            errorEl.textContent = 'Error loading audit log: ' + error;
            eventList.appendChild(errorEl);
            eventCount.textContent = '';
            return;
          }

          if (events.length === 0) {
            var emptyEl = document.createElement('div');
            emptyEl.className = 'empty-state';
            emptyEl.innerHTML = '<p>No audit events yet.</p><p>Events will appear here as you use DanteCode.</p>';
            eventList.appendChild(emptyEl);
            eventCount.textContent = '';
            return;
          }

          events.forEach(function(evt) {
            var item = document.createElement('div');
            item.className = 'event-item';

            // Header row: dot + type label + timestamp
            var header = document.createElement('div');
            header.className = 'event-header';

            var dot = document.createElement('span');
            dot.className = 'event-dot';
            dot.style.background = evt.color;

            var typeLabel = document.createElement('span');
            typeLabel.className = 'event-type';
            typeLabel.textContent = evt.typeLabel;

            var timeLabel = document.createElement('span');
            timeLabel.className = 'event-time';
            timeLabel.textContent = evt.formattedTime;

            header.appendChild(dot);
            header.appendChild(typeLabel);
            header.appendChild(timeLabel);
            item.appendChild(header);

            // Metadata row (session, model)
            var meta = document.createElement('div');
            meta.className = 'event-meta';

            var sessionRow = document.createElement('div');
            sessionRow.className = 'event-meta-row';
            sessionRow.innerHTML = '<span class="event-meta-key">Session:</span><span>' +
              escapeHtml(evt.sessionId.substring(0, 16)) + '...</span>';
            meta.appendChild(sessionRow);

            var modelRow = document.createElement('div');
            modelRow.className = 'event-meta-row';
            modelRow.innerHTML = '<span class="event-meta-key">Model:</span><span>' +
              escapeHtml(evt.modelId) + '</span>';
            meta.appendChild(modelRow);

            item.appendChild(meta);

            // Payload (collapsed by default)
            var payload = document.createElement('div');
            payload.className = 'event-payload';
            var proofTypes = ['tool_call_started', 'tool_call_succeeded', 'tool_call_failed', 'mutation_observed', 'validation_observed', 'completion_gate_failed', 'completion_gate_passed'];
            if (proofTypes.includes(evt.type)) {
              payload.innerHTML = renderProofPayload(evt.type, evt.payload);
            } else {
              payload.textContent = JSON.stringify(evt.payload, null, 2);
            }
            item.appendChild(payload);

            // Restore expansion state
            if (expandedEvents.has(evt.id)) {
              meta.classList.add('visible');
              payload.classList.add('visible');
            }

            // Toggle expansion on click
            item.addEventListener('click', function() {
              var isExpanded = meta.classList.contains('visible');
              if (isExpanded) {
                meta.classList.remove('visible');
                payload.classList.remove('visible');
                expandedEvents.delete(evt.id);
              } else {
                meta.classList.add('visible');
                payload.classList.add('visible');
                expandedEvents.add(evt.id);
              }
            });

            eventList.appendChild(item);
          });

          eventCount.textContent = events.length + ' event' + (events.length !== 1 ? 's' : '');
        }
      });

      function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      // Notify extension that webview is ready
      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }
}

/**
 * Formats an ISO timestamp into a human-readable relative or absolute time.
 * For events within the last 24 hours, shows relative time (e.g. "5m ago").
 * For older events, shows the date and time.
 */
function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  // Older than 7 days: show date
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Generates a random nonce string for Content Security Policy script tags.
 */
function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
