// ============================================================================
// Skillbook Integration - Wrapper for DanteSkillbookIntegration
// ============================================================================

import * as vscode from "vscode";
import { DanteSkillbookIntegration } from "@dantecode/dante-skillbook";
import type { Skill } from "@dantecode/runtime-spine";

/**
 * Singleton skillbook integration
 */
let integration: DanteSkillbookIntegration | undefined;

/**
 * Get or create skillbook integration
 */
function getIntegration(projectRoot: string): DanteSkillbookIntegration {
  if (!integration) {
    integration = new DanteSkillbookIntegration({
      cwd: projectRoot,
      gitStage: true,
    });
  }
  return integration;
}

/**
 * List all skills
 */
export async function listSkills(projectRoot: string): Promise<Skill[]> {
  const inst = getIntegration(projectRoot);
  return inst.getRelevantSkills({}, 100);
}

/**
 * Get skillbook stats
 */
export async function getSkillbookStats(projectRoot: string): Promise<{
  totalSkills: number;
  avgQuality: number;
}> {
  const integration = getIntegration(projectRoot);
  const stats = integration.stats();

  return {
    totalSkills: stats.totalSkills,
    avgQuality: 0, // Quality evaluation not available in this API
  };
}

/**
 * Import skills from path or URL
 * Note: The actual API doesn't have a simple import method
 * This is a placeholder that shows appropriate user feedback
 */
export async function importSkillsFromPath(
  pathOrUrl: string,
  _projectRoot: string,
  outputChannel: vscode.OutputChannel,
): Promise<number> {
  outputChannel.appendLine(`[Skillbook] Import not yet implemented for path: ${pathOrUrl}`);
  void vscode.window.showWarningMessage(
    "Skill import: Full integration coming soon. Use CLI for now."
  );
  return 0;
}

/**
 * Evaluate skill quality
 * Note: Quality evaluation requires DanteForge integration
 * This is a placeholder
 */
export async function evaluateSkill(
  _skillId: string,
  _projectRoot: string,
): Promise<{ score: number } | null> {
  void vscode.window.showInformationMessage(
    "Skill verification: Full integration coming soon"
  );
  return null;
}

/**
 * Clear integration (for cleanup)
 */
export function clearSkillbookIntegration(): void {
  integration = undefined;
}
