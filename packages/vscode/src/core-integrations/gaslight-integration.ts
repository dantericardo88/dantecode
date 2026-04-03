// ============================================================================
// Gaslight Integration
// Wrapper for @dantecode/dante-gaslight iteration engine
// ============================================================================

import * as vscode from "vscode";

/**
 * Run gaslight iteration on draft content
 * Note: Full integration requires proper DanteGaslight API exports
 * This is deferred as gaslight is optional enhancement
 */
export async function runGaslight(
  _draft: string,
  _trigger: string,
  _projectRoot: string,
  _outputChannel: vscode.OutputChannel,
): Promise<{ refined: string; iterations: number } | null> {
  void vscode.window.showInformationMessage(
    "Gaslight: Full integration coming soon"
  );
  return null;
}

/**
 * Get gaslight stats
 */
export function getGaslightStats(_projectRoot: string): { sessionsRun: number; avgIterations: number } | null {
  return null;
}
