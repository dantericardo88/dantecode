// ============================================================================
// DanteCode VS Code Extension — Status Bar Management
// ============================================================================

import * as vscode from "vscode";
import { DEFAULT_MODEL_ID } from "@dantecode/core";

export type GateStatus = "passed" | "failed" | "pending" | "none";

export interface StatusBarState {
  item: vscode.StatusBarItem;
  currentModel: string;
  gateStatus: GateStatus;
  sandboxEnabled: boolean;
  /** Blade v1.2: current model tier for cost routing display. */
  modelTier: "fast" | "capable";
  /** Blade v1.2: accumulated session cost in USD. */
  sessionCostUsd: number;
  /** Context window utilization percentage (0-100). */
  contextPercent: number;
  /** Number of currently running background tasks. */
  activeTasks: number;
  /** Whether the status bar is in an error state. */
  hasError: boolean;
  /** Index readiness for semantic search (Wave 3 Task 3.2). */
  indexReadiness?: {
    status: "indexing" | "ready" | "error";
    progress: number; // 0-100
  };
  /** Context pressure percentage (0-100) (Wave 3 Task 3.3). */
  contextPressure?: number;
}

/** Info payload for the updateStatusBarInfo() convenience method. */
export interface StatusBarInfo {
  model?: string;
  contextPercent?: number;
  activeTasks?: number;
  hasError?: boolean;
  indexReadiness?: {
    status: "indexing" | "ready" | "error";
    progress: number;
  };
  contextPressure?: number;
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
  const defaultModel = config.get<string>("defaultModel", DEFAULT_MODEL_ID);
  const sandboxEnabled = config.get<boolean>("sandboxEnabled", false);

  const state: StatusBarState = {
    item,
    currentModel: defaultModel,
    gateStatus: "none",
    sandboxEnabled,
    modelTier: "fast",
    sessionCostUsd: 0,
    contextPercent: 0,
    activeTasks: 0,
    hasError: false,
    indexReadiness: undefined,
    contextPressure: undefined,
  };

  item.command = "dantecode.openChat";
  renderStatusBar(state);

  item.show();
  context.subscriptions.push(item);

  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("dantecode")) {
      const updatedConfig = vscode.workspace.getConfiguration("dantecode");
      state.currentModel = updatedConfig.get<string>("defaultModel", DEFAULT_MODEL_ID);
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

/**
 * Blade v1.2: Update status bar with cost and tier information.
 */
export function updateStatusBarWithCost(
  state: StatusBarState,
  modelTier: "fast" | "capable",
  costUsd: number,
): void {
  state.modelTier = modelTier;
  state.sessionCostUsd = costUsd;
  renderStatusBar(state);
}

/**
 * Convenience method to update context percent, active tasks, model, and error
 * state in a single call. Called after each model response and when background
 * tasks change.
 */
export function updateStatusBarInfo(state: StatusBarState, info: StatusBarInfo): void {
  if (info.model !== undefined) {
    state.currentModel = info.model;
  }
  if (info.contextPercent !== undefined) {
    state.contextPercent = info.contextPercent;
  }
  if (info.activeTasks !== undefined) {
    state.activeTasks = info.activeTasks;
  }
  if (info.hasError !== undefined) {
    state.hasError = info.hasError;
  }
  if (info.indexReadiness !== undefined) {
    state.indexReadiness = info.indexReadiness;
  }
  if (info.contextPressure !== undefined) {
    state.contextPressure = info.contextPressure;
  }
  renderStatusBar(state);
}

/**
 * Build the status bar display text. Exported for testing.
 *
 * Format: "DanteCode | grok-3 | idx: ✓ | ctx: 72% | 2 tasks"
 *   - model segment is always shown
 *   - index readiness shown when available
 *   - context pressure shown when available
 *   - context segment shown when > 0%
 *   - tasks segment shown when > 0
 */
export function formatStatusBarText(state: StatusBarState): string {
  const shortModel = formatModelName(state.currentModel);
  const parts: string[] = ["DanteCode", shortModel];

  // Index readiness badge (Wave 3 Task 3.2)
  if (state.indexReadiness) {
    const { status, progress } = state.indexReadiness;
    if (status === "ready") {
      parts.push("idx: ✓");
    } else if (status === "error") {
      parts.push("idx: ✗");
    } else {
      // indexing
      parts.push(`idx: ${progress}%`);
    }
  }

  // Context pressure badge (Wave 3 Task 3.3)
  if (state.contextPressure !== undefined) {
    parts.push(`ctx: ${state.contextPressure}%`);
  }

  if (state.contextPercent > 0) {
    parts.push(`${state.contextPercent}% ctx`);
  }

  if (state.activeTasks > 0) {
    parts.push(`${state.activeTasks} task${state.activeTasks !== 1 ? "s" : ""}`);
  }

  return parts.join(" | ");
}

/**
 * Determine the status bar color based on current state.
 * Exported for testing.
 *
 *  - "red"    → error state, PDSE gate failed, or context pressure >80%
 *  - "yellow" → context usage >75%, gate pending, or context pressure 50-80%
 *  - "green"  → healthy (everything normal)
 */
export function getStatusBarColor(state: StatusBarState): "green" | "yellow" | "red" {
  if (state.hasError || state.gateStatus === "failed") {
    return "red";
  }

  // Context pressure takes priority over contextPercent (Wave 3 Task 3.3)
  if (state.contextPressure !== undefined && state.contextPressure >= 80) {
    return "red";
  }

  if (state.indexReadiness?.status === "error") {
    return "red";
  }

  if (
    state.contextPercent > 75 ||
    state.gateStatus === "pending" ||
    (state.contextPressure !== undefined && state.contextPressure >= 50)
  ) {
    return "yellow";
  }

  return "green";
}

function renderStatusBar(state: StatusBarState): void {
  const { item, gateStatus, sandboxEnabled } = state;

  const gateIcon = GATE_ICONS[gateStatus];
  const sandboxLabel = sandboxEnabled ? ` ${SANDBOX_ICON}` : "";

  const costLabel = state.sessionCostUsd > 0 ? `  ~$${state.sessionCostUsd.toFixed(3)}` : "";
  const tierLabel = state.modelTier === "capable" ? " [capable]" : "";

  item.text = `${gateIcon} ${formatStatusBarText(state)}${tierLabel}${sandboxLabel}${costLabel}`;

  const tooltipLines = [
    `Model: ${state.currentModel}`,
    `Tier: ${state.modelTier}`,
    `Context: ${state.contextPercent}%`,
    `Active tasks: ${state.activeTasks}`,
    GATE_TOOLTIPS[gateStatus],
    `Session cost: ~$${state.sessionCostUsd.toFixed(4)}`,
    `Sandbox: ${sandboxEnabled ? "enabled" : "disabled"}`,
  ];

  // Add index readiness to tooltip (Wave 3 Task 3.2)
  if (state.indexReadiness) {
    const { status, progress } = state.indexReadiness;
    if (status === "ready") {
      tooltipLines.push("Index: Ready");
    } else if (status === "error") {
      tooltipLines.push("Index: Error");
    } else {
      tooltipLines.push(`Index: Indexing (${progress}%)`);
    }
  }

  // Add context pressure to tooltip (Wave 3 Task 3.3)
  if (state.contextPressure !== undefined) {
    const pressureStatus =
      state.contextPressure >= 80 ? "Critical" : state.contextPressure >= 50 ? "High" : "Normal";
    tooltipLines.push(`Context Pressure: ${state.contextPressure}% (${pressureStatus})`);
  }

  tooltipLines.push("");
  tooltipLines.push("Click to open DanteCode sidebar");

  item.tooltip = tooltipLines.join("\n");

  // Theme-aware colors based on health state
  item.backgroundColor = undefined;
  item.color = undefined;

  const color = getStatusBarColor(state);
  switch (color) {
    case "red":
      item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      item.color = new vscode.ThemeColor("statusBarItem.errorForeground");
      break;
    case "yellow":
      item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      item.color = new vscode.ThemeColor("statusBarItem.warningForeground");
      break;
    case "green":
      // Use a subtle green foreground when healthy; no background override
      item.color = new vscode.ThemeColor("charts.green");
      break;
  }
}
