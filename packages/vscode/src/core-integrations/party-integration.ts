// ============================================================================
// Party Mode / Council Orchestrator Integration
// Wrapper for @dantecode/core CouncilOrchestrator
// ============================================================================

import * as vscode from "vscode";

/**
 * Launch party mode with multiple agents
 * Note: Full integration requires implementing CouncilAgentAdapter interface
 * This is a complex integration that requires agent adapters
 */
export async function launchPartyMode(
  _objective: string,
  _agents: string[],
  _projectRoot: string,
  _outputChannel: vscode.OutputChannel,
): Promise<string> {
  void vscode.window.showWarningMessage(
    "Party Mode: Full integration coming soon. Use CLI for now."
  );
  return "party-mode-placeholder";
}

/**
 * Get current party mode status
 */
export function getPartyModeStatus(): string | null {
  return null;
}

/**
 * Get current run ID
 */
export function getActiveRunId(): string | undefined {
  return undefined;
}

/**
 * Stop active party mode
 */
export function stopPartyMode(): void {
  // Placeholder
}

/**
 * Request merge approval (called when orchestrator is ready to merge)
 */
export async function requestMergeApproval(): Promise<boolean> {
  return false;
}
