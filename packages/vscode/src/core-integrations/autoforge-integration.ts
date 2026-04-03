// ============================================================================
// Autoforge Integration
// Wrapper for @dantecode/danteforge autoforge execution
// ============================================================================

import * as vscode from "vscode";

/**
 * Run autoforge on current file or selection
 * Note: Full integration requires correct runAutoforgeIAL signatures from DanteForge
 * This is deferred until DanteForge API is fully documented
 */
export async function runAutoforge(
  _targetFile: string,
  _projectRoot: string,
  _apiKey: string,
  _modelId: string = "claude-sonnet-4-6",
  _outputChannel: vscode.OutputChannel,
): Promise<{ finalScore: number | null }> {
  void vscode.window.showWarningMessage(
    "Autoforge: Full integration coming soon. Use CLI for now."
  );
  return { finalScore: null };
}

/**
 * Get autoforge status
 */
export function getAutoforgeStatus(): string | null {
  return null;
}
