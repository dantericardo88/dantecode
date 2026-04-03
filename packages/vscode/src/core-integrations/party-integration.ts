// ============================================================================
// Party Mode / Council Orchestrator Integration
// Wrapper for @dantecode/core CouncilOrchestrator
// ============================================================================

import * as vscode from "vscode";

/**
 * Active run tracking
 */
let activeRunId: string | undefined;
let activeStatus: string | undefined;

/**
 * Launch party mode with multiple agents.
 * Full integration requires implementing CouncilAgentAdapter interface.
 * Current: generates run ID, logs to output, fires status events.
 */
export async function launchPartyMode(
  objective: string,
  agents: string[],
  _projectRoot: string,
  outputChannel: vscode.OutputChannel,
): Promise<string> {
  const runId = `party-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  activeRunId = runId;
  activeStatus = "planning";

  outputChannel.appendLine(`[Party Mode] Objective: ${objective}`);
  outputChannel.appendLine(`[Party Mode] Agents: ${agents.join(", ")}`);
  outputChannel.appendLine(`[Party Mode] Run ID: ${runId}`);
  outputChannel.appendLine(`[Party Mode] NOTE: Full CouncilOrchestrator integration pending`);

  // Fire initial status event for the party progress panel
  void vscode.commands.executeCommand("dantecode.partyStatus", {
    from: "idle",
    to: "planning",
    runId,
  });

  void vscode.window.showInformationMessage(
    `Party Mode launched! Run ID: ${runId.substring(0, 8)}... (full integration pending)`
  );

  return runId;
}

/**
 * Get current party mode status
 */
export function getPartyModeStatus(): string | null {
  return activeStatus ?? null;
}

/**
 * Get current run ID
 */
export function getActiveRunId(): string | undefined {
  return activeRunId;
}

/**
 * Stop active party mode
 */
export function stopPartyMode(): void {
  activeRunId = undefined;
  activeStatus = undefined;
}

/**
 * Request merge approval (called when orchestrator is ready to merge)
 */
export async function requestMergeApproval(): Promise<boolean> {
  const result = await vscode.window.showInformationMessage(
    "Party Mode agents have completed their work. Merge changes?",
    { modal: true },
    "Merge",
    "Cancel",
  );
  return result === "Merge";
}
