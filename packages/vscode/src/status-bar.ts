// ============================================================================
// DanteCode VS Code Extension — Status Bar Management
// Creates and manages the status bar item that displays the current model,
// PDSE gate status, and sandbox mode indicator.
// ============================================================================

import * as vscode from "vscode";

/**
 * Possible gate statuses displayed in the status bar alongside the model name.
 */
export type GateStatus = "passed" | "failed" | "pending" | "none";

/**
 * State tracked by the status bar manager. Exposes the VS Code StatusBarItem
 * so that the extension can dispose it when deactivating.
 */
export interface StatusBarState {
  item: vscode.StatusBarItem;
  currentModel: string;
  gateStatus: GateStatus;
  sandboxEnabled: boolean;
}

/**
 * Icon mappings for each gate status value. Uses VS Code codicon identifiers
 * for consistent rendering across themes.
 */
const GATE_ICONS: Record<GateStatus, string> = {
  passed: "$(pass-filled)",
  failed: "$(error)",
  pending: "$(loading~spin)",
  none: "$(dash)",
};

/**
 * Tooltip descriptions for each gate status.
 */
const GATE_TOOLTIPS: Record<GateStatus, string> = {
  passed: "PDSE gate: PASSED",
  failed: "PDSE gate: FAILED",
  pending: "PDSE gate: scoring...",
  none: "PDSE gate: not yet run",
};

/**
 * Creates and registers the DanteCode status bar item. The item is placed
 * at priority 100 on the left side of the status bar. Clicking it triggers
 * the model switch command.
 *
 * @param context - The extension context, used to register the disposable.
 * @returns The StatusBarState object for later updates.
 */
export function createStatusBar(context: vscode.ExtensionContext): StatusBarState {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  // Read the configured default model from settings
  const config = vscode.workspace.getConfiguration("dantecode");
  const defaultModel = config.get<string>("defaultModel", "grok/grok-3");
  const sandboxEnabled = config.get<boolean>("sandboxEnabled", false);

  const state: StatusBarState = {
    item,
    currentModel: defaultModel,
    gateStatus: "none",
    sandboxEnabled,
  };

  // Set the command that fires when the user clicks the status bar item
  item.command = "dantecode.switchModel";

  // Render initial state
  renderStatusBar(state);

  // Show and register for disposal
  item.show();
  context.subscriptions.push(item);

  // Listen for configuration changes to update the status bar reactively
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("dantecode.defaultModel")) {
      const updatedConfig = vscode.workspace.getConfiguration("dantecode");
      state.currentModel = updatedConfig.get<string>("defaultModel", "grok/grok-3");
      renderStatusBar(state);
    }
    if (e.affectsConfiguration("dantecode.sandboxEnabled")) {
      const updatedConfig = vscode.workspace.getConfiguration("dantecode");
      state.sandboxEnabled = updatedConfig.get<boolean>("sandboxEnabled", false);
      renderStatusBar(state);
    }
  });
  context.subscriptions.push(configWatcher);

  return state;
}

/**
 * Updates the status bar to reflect a new model and/or gate status.
 *
 * @param state - The StatusBarState to mutate and re-render.
 * @param model - The new model identifier (e.g. "grok/grok-3").
 * @param gateStatus - The current PDSE gate status.
 */
export function updateStatusBar(state: StatusBarState, model: string, gateStatus: 'passed' | 'failed' | 'pending' | 'none') {
  state.currentModel = model;
  state.gateStatus = gateStatus;

  const modelLabel = model.split('/').pop() || model;
  let icon = '';
  let bgColor: vscode.ThemeColor | undefined;
  let tooltip = `Model: ${model}\nPDSE Gate: ${gateStatus.toUpperCase()}\nClick to switch model`;

  switch (gateStatus) {
    case 'passed':
      icon = '$(pass-filled) ';
      tooltip += '\n✅ Quality gate passed';
      break;
    case 'failed':
      icon = '$(error) ';
      bgColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      tooltip += '\n❌ Quality gate failed';
      break;
    case 'pending':
      icon = '$(loading~spin) ';
      tooltip += '\n⏳ Verifying...';
      break;
    default:
      icon = '$(dash) ';
  }

  state.item.text = `$(dante-fire) ${icon}DanteCode: ${modelLabel}`;
  state.item.tooltip = tooltip;
  state.item.backgroundColor = bgColor;

  // Animation: subtle pulse on status change
  state.item.color = new vscode.ThemeColor('statusBarItem.foreground');
  setTimeout(() => {
    state.item.color = undefined;
  }, 500);
}(
  state: StatusBarState,
  model: string,
  gateStatus: GateStatus,
): void {
  state.currentModel = model;
  state.gateStatus = gateStatus;
  renderStatusBar(state);
}

/**
 * Updates only the sandbox indicator on the status bar.
 *
 * @param state - The StatusBarState to mutate and re-render.
 * @param enabled - Whether sandbox mode is enabled.
 */
export function updateSandboxStatus(state: StatusBarState, enabled: boolean): void {
  state.sandboxEnabled = enabled;
  renderStatusBar(state);
}

/**
 * Internal renderer that composes the status bar text and tooltip from
 * the current state values. Called after every state mutation.
 */
function renderStatusBar(state: StatusBarState): void {
  const { item, currentModel, gateStatus, sandboxEnabled } = state;

  // Format: "$(icon) DanteCode: model-name [sandbox]"
  const gateIcon = GATE_ICONS[gateStatus];
  const sandboxLabel = sandboxEnabled ? " $(vm)" : "";
  const shortModel = formatModelName(currentModel);

  item.text = `${gateIcon} DanteCode: ${shortModel}${sandboxLabel}`;
  item.tooltip = [
    `Model: ${currentModel}`,
    GATE_TOOLTIPS[gateStatus],
    `Sandbox: ${sandboxEnabled ? "enabled" : "disabled"}`,
    "",
    "Click to switch model",
  ].join("\n");

  // Color the status bar item based on gate status
  switch (gateStatus) {
    case "passed":
      item.backgroundColor = undefined;
      item.color = new vscode.ThemeColor("statusBarItem.foreground");
      break;
    case "failed":
      item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      item.color = new vscode.ThemeColor("statusBarItem.errorForeground");
      break;
    case "pending":
      item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      item.color = new vscode.ThemeColor("statusBarItem.warningForeground");
      break;
    case "none":
      item.backgroundColor = undefined;
      item.color = undefined;
      break;
  }
}

/**
 * Formats a full model identifier (e.g. "grok/grok-3") into a shorter
 * display name (e.g. "grok-3") for the status bar.
 *
 * If the model string contains a slash, the part after the slash is used.
 * Otherwise the full string is returned.
 */
function formatModelName(model: string): string {
  const slashIndex = model.indexOf("/");
  if (slashIndex >= 0) {
    return model.substring(slashIndex + 1);
  }
  return model;
}
