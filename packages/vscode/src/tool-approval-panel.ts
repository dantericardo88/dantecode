// ============================================================================
// packages/vscode/src/tool-approval-panel.ts
//
// Inline tool approval card — serializes a tool call into an HTML card that
// is injected into the chat webview before the tool fires.
//
// Design:
//   - Pure functions: buildApprovalCard() + renderApprovalCardHtml()
//   - No vscode imports — safe to import in tests without the vscode mock
//   - XSS-safe: all user-supplied values are HTML-escaped before insertion
//   - Data attributes drive click delegation in the webview JS
// ============================================================================

import type { ColoredDiffHunk } from "@dantecode/config-types";
import type { ToolApprovalRequest } from "./agent-tools.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ToolApprovalCardRequest extends ToolApprovalRequest {
  requestId: string;
}

export interface ToolApprovalCard {
  requestId: string;
  toolName: string;
  toolIcon: string;
  paramSummary: string;
  diffHtml: string | null;
  permissionKind: "edit" | "bash" | "tools";
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toolIcon(toolName: string): string {
  const icons: Record<string, string> = {
    Write: "edit",
    Edit: "diff-modified",
    Bash: "terminal",
    Browser: "globe",
    GitCommit: "git-commit",
    GitPush: "cloud-upload",
  };
  return icons[toolName] ?? "tools";
}

function buildParamSummary(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "Write" || toolName === "Edit") {
    const fp = String(input["file_path"] ?? "");
    return fp ? fp.replace(/\\/g, "/") : "unknown file";
  }
  if (toolName === "Bash") {
    const cmd = String(input["command"] ?? "");
    return cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd;
  }
  if (toolName === "Browser") {
    const action = String(input["action"] ?? "");
    const url = input["url"] ? ` ${String(input["url"])}` : "";
    return `${action}${url}`;
  }
  return toolName;
}

function renderHunkDiff(hunk: ColoredDiffHunk): string {
  if (!hunk.lines || hunk.lines.length === 0) return "";
  const parts: string[] = [];
  for (const line of hunk.lines.slice(0, 60)) {
    const escaped = htmlEscape(line.content);
    if (line.type === "add") {
      parts.push(`<div class="tac-da">+${escaped}</div>`);
    } else if (line.type === "remove") {
      parts.push(`<div class="tac-dr">-${escaped}</div>`);
    } else {
      parts.push(`<div class="tac-dc"> ${escaped}</div>`);
    }
  }
  if (hunk.truncated) {
    const omitted = (hunk.fullLineCount ?? hunk.lines.length) - 60;
    parts.push(`<div class="tac-dc">… ${omitted} more lines omitted</div>`);
  }
  return parts.join("\n");
}

// ----------------------------------------------------------------------------
// buildApprovalCard
// ----------------------------------------------------------------------------

export function buildApprovalCard(req: ToolApprovalCardRequest): ToolApprovalCard {
  return {
    requestId: req.requestId,
    toolName: req.toolName,
    toolIcon: toolIcon(req.toolName),
    paramSummary: buildParamSummary(req.toolName, req.input),
    diffHtml: req.previewHunk ? renderHunkDiff(req.previewHunk) : null,
    permissionKind: req.permissionKind,
  };
}

// ----------------------------------------------------------------------------
// renderApprovalCardHtml
// ----------------------------------------------------------------------------

export function renderApprovalCardHtml(card: ToolApprovalCard): string {
  const reqId = htmlEscape(card.requestId);
  const icon = htmlEscape(card.toolIcon);
  const toolName = htmlEscape(card.toolName);
  const paramSummary = htmlEscape(card.paramSummary);
  const permKind = htmlEscape(card.permissionKind);

  const diffBlock = card.diffHtml
    ? `<div class="tac-diff">${card.diffHtml}</div>`
    : "";

  return `<div class="tool-approval-card" data-request-id="${reqId}">
  <div class="tac-header">
    <span class="tac-icon codicon codicon-${icon}"></span>
    <span class="tac-tool-name">${toolName}</span>
    <span class="tac-params">${paramSummary}</span>
  </div>
  ${diffBlock}
  <div class="tac-actions">
    <button class="tac-approve" data-req="${reqId}" data-kind="${permKind}">&#10003; Approve</button>
    <button class="tac-approve-all" data-req="${reqId}" data-kind="${permKind}">Always approve ${permKind}</button>
    <button class="tac-deny" data-req="${reqId}" data-kind="${permKind}">&#10005; Deny</button>
  </div>
</div>`;
}
