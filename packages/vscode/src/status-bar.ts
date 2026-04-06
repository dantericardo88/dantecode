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
  /** Last known PDSE score (0-100). -1 means not scored yet. */
  pdseScore?: number;
}

/** Info payload for the updateStatusBarInfo() convenience method. */
export interface StatusBarInfo {
  model?: string;
  contextPercent?: number;
  activeTasks?: number;
  hasError?: boolean;
  pdseScore?: number;
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
    pdseScore: -1,
  };

  // Register the quick-pick command for status bar clicks
  const quickPickCmd = vscode.commands.registerCommand("dantecode.statusBarQuickPick", () => {
    void showStatusBarQuickPick(state);
  });
  context.subscriptions.push(quickPickCmd);

  item.command = "dantecode.statusBarQuickPick";
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

/**
 * Shows a quick-pick menu when the status bar item is clicked.
 * Provides fast access to common actions.
 */
async function showStatusBarQuickPick(state: StatusBarState): Promise<void> {
  const items: Array<{ label: string; description?: string; action: string }> = [
    {
      label: "$(comment-discussion) Open Chat",
      description: "Open the DanteCode sidebar",
      action: "dantecode.openChat",
    },
    {
      label: "$(symbol-enum) Switch Model",
      description: state.currentModel,
      action: "dantecode.switchModel",
    },
    {
      label: "$(beaker) Run PDSE Score",
      description: "Score the active file",
      action: "dantecode.runPDSE",
    },
    {
      label: "$(terminal) Run GStack QA",
      description: "Typecheck + lint + test",
      action: "dantecode.runGStack",
    },
    {
      label: state.sandboxEnabled ? "$(vm) Disable Sandbox" : "$(vm-outline) Enable Sandbox",
      description: state.sandboxEnabled ? "Currently enabled" : "Currently disabled",
      action: "dantecode.toggleSandbox",
    },
    {
      label: "$(key) Setup API Keys",
      description: "Configure LLM providers",
      action: "dantecode.setupApiKeys",
    },
    {
      label: "$(history) List Checkpoints",
      description: "View saved checkpoints",
      action: "dantecode.listCheckpoints",
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `DanteCode | ${formatModelName(state.currentModel)} | ${state.contextPercent}% ctx`,
  });

  if (picked) {
    await vscode.commands.executeCommand(picked.action);
  }
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
 * Update the PDSE score displayed in the status bar.
 * Color coding: green (>=80), yellow (60-79), red (<60).
 */
export function updatePdseScore(state: StatusBarState, score: number): void {
  state.pdseScore = score;
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
  if (info.pdseScore !== undefined) {
    state.pdseScore = info.pdseScore;
  }
  renderStatusBar(state);
}

/**
 * Build a visual gauge bar for context utilization.
 * Uses Unicode block characters for a compact visual in the status bar.
 * Exported for testing.
 */
export function formatContextGauge(percent: number): string {
  if (percent <= 0) return "";
  const filled = Math.round((percent / 100) * 5);
  const empty = 5 - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

/**
 * Build the status bar display text. Exported for testing.
 *
 * Format: "DanteCode | grok-3 | [gauge] 23% | 2 tasks"
 *   - model segment is always shown
 *   - context gauge shown when > 0%
 *   - tasks segment shown when > 0
 */
export function formatStatusBarText(state: StatusBarState): string {
  const shortModel = formatModelName(state.currentModel);
  const parts: string[] = ["DanteCode", shortModel];

  if (state.contextPercent > 0) {
    const gauge = formatContextGauge(state.contextPercent);
    parts.push(`${gauge} ${state.contextPercent}%`);
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
 *  - "red"    → error state, PDSE gate failed, or PDSE score < 60
 *  - "yellow" → context usage >75%, gate pending, or PDSE score 60-79
 *  - "green"  → healthy (PDSE >= 80 or not scored, everything normal)
 */
export function getStatusBarColor(state: StatusBarState): "green" | "yellow" | "red" {
  if (state.hasError || state.gateStatus === "failed") {
    return "red";
  }
  const pdse = state.pdseScore ?? -1;
  if (pdse >= 0 && pdse < 60) {
    return "red";
  }
  if (pdse >= 60 && pdse < 80) {
    return "yellow";
  }
  if (state.contextPercent > 75 || state.gateStatus === "pending") {
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
  const pdseLabel = (state.pdseScore ?? -1) >= 0 ? `PDSE score: ${state.pdseScore}/100` : "PDSE score: not scored";
  item.tooltip = [
    `Model: ${state.currentModel}`,
    `Tier: ${state.modelTier}`,
    `Context: ${state.contextPercent}%`,
    `Active tasks: ${state.activeTasks}`,
    pdseLabel,
    GATE_TOOLTIPS[gateStatus],
    `Session cost: ~$${state.sessionCostUsd.toFixed(4)}`,
    `Sandbox: ${sandboxEnabled ? "enabled" : "disabled"}`,
    "",
    "Click for quick actions",
  ].join("\n");

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
