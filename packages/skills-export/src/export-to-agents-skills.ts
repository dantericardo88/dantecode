// ============================================================================
// @dantecode/skills-export — Export to Codex .agents/skills/ Layout
// Exports a skill into a Codex-compatible .agents/skills/<slug>/ directory.
// ============================================================================

import { join } from "node:path";
import { exportAgentSkill } from "./export-agent-skill.js";
import type { ExportableSkill, ExportResult } from "./export-agent-skill.js";

// ----------------------------------------------------------------------------
// Path Helpers
// ----------------------------------------------------------------------------

/**
 * Get the expected output path for a skill in .agents/skills/ layout.
 *
 * Returns: `<targetRoot>/.agents/skills/<slug>/SKILL.md`
 *
 * Does NOT create any files — pure path calculation.
 *
 * @param slug       - The sanitized skill slug (directory name component).
 * @param targetRoot - Absolute path to the repository root.
 * @returns          The absolute path where the SKILL.md would be written.
 */
export function getAgentsSkillsPath(slug: string, targetRoot: string): string {
  return join(targetRoot, ".agents", "skills", slug, "SKILL.md");
}

// ----------------------------------------------------------------------------
// Main Export Function
// ----------------------------------------------------------------------------

/**
 * Export a skill to a Codex-compatible .agents/skills/<slug>/ directory.
 *
 * The targetRoot is the repository root. Exports to:
 *   `<targetRoot>/.agents/skills/<slug>/SKILL.md`
 *
 * After export, the skill is discoverable by Codex and other
 * Agent Skills-compatible tools.
 *
 * @param skill      - The skill data to export.
 * @param targetRoot - Absolute path to the repository root.
 * @returns          ExportResult with the path to the exported SKILL.md and any warnings.
 */
export async function exportToAgentsSkills(
  skill: ExportableSkill,
  targetRoot: string,
): Promise<ExportResult> {
  const outDir = join(targetRoot, ".agents", "skills");
  return exportAgentSkill(skill, outDir);
}
