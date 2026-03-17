// ============================================================================
// DanteCode VS Code Extension — Status Bar Management
// ============================================================================

import * as vscode from "vscode";

export type GateStatus = "passed" | "failed" | "pending" | "none";

export interface StatusBarState {
  item: vscode.StatusBarItem;
  currentModel: string;
  gateStatus: GateStatus;
  sandboxEnabled: boolean;
}

const GATE_ICONS: Record<GateStatus, string> = {
  passed: "$(pass-filled)",
  failed: "$(error)",
  pending: "$(loading~spin)",
  none: "$(dash)",
};

const GATE_TOOLTIPS: Record<GateStatus, string> = {
  passed: "PDSE gate: PASSED",
  failed: "PDSE gate: FAILED",
  pending: "PDSE gate: scoring...",
  none: "PDSE gate: not yet run",
};

const SANDBOX_ICON = "$(vm)";

function formatModelName(model: string): string {
  const slashIndex = model.indexOf("/");
  return slashIndex >= 0 ? model.substring(slashIndex + 1) : model;
}

export function createStatusBar(context: vscode.ExtensionContext): StatusBarState {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  const config = vscode.workspace.getConfiguration("dantecode");
  const defaultModel = config.get<string>("defaultModel", "grok/grok-3");
  const sandboxEnabled = config.get<boolean>("sandboxEnabled", false);

  const state: StatusBarState = {
    item,
    currentModel: defaultModel,
    gateStatus: "none",
    sandboxEnabled,
  };

  item.command = "dantecode.switchModel";
  renderStatusBar(state);

  item.show();
  context.subscriptions.push(item);

  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("dantecode")) {
      const updatedConfig = vscode.workspace.getConfiguration("dantecode");
      state.currentModel = updatedConfig.get<string>("defaultModel", "grok/grok-3");
      state.sandboxEnabled = updatedConfig.get<boolean>("sandboxEnabled", false);
      renderStatusBar(state);
    }
  });
  context.subscriptions.push(configWatcher);

  return state;
}

export function updateStatusBar(
  state: StatusBarState,
  model: string,
  gateStatus: GateStatus,
): void {
  state.currentModel = model;
  state.gateStatus = gateStatus;
  renderStatusBar(state);
}

export function updateSandboxStatus(state: StatusBarState, enabled: boolean): void {
  state.sandboxEnabled = enabled;
  renderStatusBar(state);
}

function renderStatusBar(state: StatusBarState): void {
  const { item, currentModel, gateStatus, sandboxEnabled } = state;

  const gateIcon = GATE_ICONS[gateStatus];
  const sandboxLabel = sandboxEnabled ? ` ${SANDBOX_ICON}` : "";
  const shortModel = formatModelName(currentModel);

  item.text = `${gateIcon} DanteCode: ${shortModel}${sandboxLabel}`;
  item.tooltip = [
    `Model: ${currentModel}`,
    GATE_TOOLTIPS[gateStatus],
    `Sandbox: ${sandboxEnabled ? "enabled" : "disabled"}`,
    "",
    "Click to switch model",
  ].join("\n");

  // Theme-aware colors
  item.backgroundColor = undefined;
  item.color = undefined;

  switch (gateStatus) {
    case "failed":
      item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      item.color = new vscode.ThemeColor("statusBarItem.errorForeground");
      break;
    case "pending":
      item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      item.color = new vscode.ThemeColor("statusBarItem.warningForeground");
      break;
    case "passed":
      item.color = new vscode.ThemeColor("statusBarItem.foreground");
      break;
  }

}
