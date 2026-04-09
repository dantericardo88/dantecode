// ============================================================================
// Skillbook Integration - Wrapper for DanteSkillbookIntegration
// ============================================================================

import * as vscode from "vscode";
import { DanteSkillbookIntegration } from "@dantecode/dante-skillbook";
import { importSkills } from "@dantecode/skill-adapter";
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
 * Import skills from a local directory path.
 * Uses the skill-adapter importSkills function to scan and import skills
 * from the given directory into the project's .dantecode/ registry.
 */
export async function importSkillsFromPath(
  pathOrUrl: string,
  projectRoot: string,
  outputChannel: vscode.OutputChannel,
): Promise<number> {
  try {
    // importSkills scans a source directory; treat pathOrUrl as the sourceDir
    const result = await importSkills({
      source: "claude",
      sourceDir: pathOrUrl,
      projectRoot,
    });
    const count = result.imported.length;
    outputChannel.appendLine(`[Skillbook] Imported ${count} skill(s) from ${pathOrUrl}`);
    if (result.skipped.length > 0) {
      outputChannel.appendLine(`[Skillbook] Skipped ${result.skipped.length} skill(s)`);
    }
    if (result.errors.length > 0) {
      result.errors.forEach((e: string) => outputChannel.appendLine(`[Skillbook] Error: ${e}`));
    }
    // Reload the integration so new skills are visible immediately
    getIntegration(projectRoot).reload();
    return count;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[Skillbook] Import failed: ${msg}`);
    void vscode.window.showErrorMessage(`DanteCode: Skill import failed — ${msg}`);
    return 0;
  }
}

/**
 * Evaluate skill quality based on available metadata.
 * Computes a 0-100 quality score from trust tier and usage count.
 * Returns null if the skill is not found.
 */
export async function evaluateSkill(
  skillId: string,
  projectRoot: string,
): Promise<{ score: number } | null> {
  try {
    const skills = await listSkills(projectRoot);
    const skill = skills.find(
      (s) => (s as Skill & { id?: string }).id === skillId || s.title === skillId,
    );
    if (!skill) return null;

    const useCount = (skill as Skill & { useCount?: number }).useCount ?? 0;
    const meta = (skill as Skill & { metadata?: Record<string, string | undefined> }).metadata;
    const trustTier = meta?.trustTier;
    const tierBonus = trustTier === "verified" ? 20 : trustTier === "trusted" ? 10 : 0;
    const score = Math.min(100, Math.max(0, 40 + Math.log1p(useCount) * 10 + tierBonus));
    return { score };
  } catch {
    return null;
  }
}

/**
 * Clear integration (for cleanup)
 */
export function clearSkillbookIntegration(): void {
  integration = undefined;
}
