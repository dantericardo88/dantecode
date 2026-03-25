// ============================================================================
// @dantecode/skills-export — Export Agent Skill
// Exports a single DanteCode skill to Agent Skills format in a target directory.
// ============================================================================

import { writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { renderSkillMd } from "./render-skill-md.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ExportableSkill {
  name: string;
  /** Sanitized directory name used for the output directory */
  slug: string;
  description: string;
  license?: string;
  compatibility?: string[];
  allowedTools?: string[];
  instructions: string;
  provenance?: {
    sourceType?: string;
    license?: string;
    [key: string]: unknown;
  };
  metadata?: Record<string, unknown>;
}

export interface ExportResult {
  ok: boolean;
  /** Absolute path to the written SKILL.md (present when ok=true) */
  outputPath?: string;
  warnings: ExportWarning[];
  /** Error message when export fails */
  error?: string;
}

export interface ExportWarning {
  code: "SKILL-008" | "EXPORT-001";
  message: string;
  field?: string;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Determine whether a skill has Dante-specific fields that cannot be
 * represented in the standard Agent Skills format.
 */
function collectSkill008Warnings(skill: ExportableSkill): ExportWarning[] {
  const warnings: ExportWarning[] = [];

  if (skill.provenance !== undefined) {
    const provenanceKeys = Object.keys(skill.provenance);
    if (provenanceKeys.length > 0) {
      warnings.push({
        code: "SKILL-008",
        message:
          "Skill has provenance fields that cannot be represented in Agent Skills SKILL.md format and will be omitted",
        field: "provenance",
      });
    }
  }

  return warnings;
}

// ----------------------------------------------------------------------------
// Main Export Function
// ----------------------------------------------------------------------------

/**
 * Export a skill to Agent Skills format in the given output directory.
 *
 * Creates: `<outDir>/<slug>/SKILL.md`
 *
 * Emits SKILL-008 warnings when Dante-specific fields (provenance, receipts)
 * cannot be represented in the standard format.
 *
 * @param skill  - The skill data to export.
 * @param outDir - The directory under which to create `<slug>/SKILL.md`.
 * @returns      ExportResult indicating success/failure and any warnings.
 */
export async function exportAgentSkill(
  skill: ExportableSkill,
  outDir: string,
): Promise<ExportResult> {
  const warnings: ExportWarning[] = collectSkill008Warnings(skill);

  try {
    // Create <outDir>/<slug>/ directory
    const skillDir = join(outDir, skill.slug);
    await mkdir(skillDir, { recursive: true });

    const outputPath = join(skillDir, "SKILL.md");

    // Check if file already exists — that's fine, we overwrite
    // (callers that need idempotency can check themselves)

    // Render to SKILL.md format (without Dante-specific provenance)
    const content = renderSkillMd({
      name: skill.name,
      description: skill.description,
      license: skill.license,
      compatibility: skill.compatibility,
      allowedTools: skill.allowedTools,
      instructions: skill.instructions,
      metadata: skill.metadata,
    });

    await writeFile(outputPath, content, "utf-8");

    return {
      ok: true,
      outputPath,
      warnings,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      warnings,
      error: message,
    };
  }
}

// ----------------------------------------------------------------------------
// Re-export types for convenience
// ----------------------------------------------------------------------------

export { access };
