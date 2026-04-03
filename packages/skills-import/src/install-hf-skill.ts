import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { HFSkillEntry } from "./hf-manifest.js";

export interface InstallHFSkillOptions {
  entry: HFSkillEntry;
  projectRoot: string;
  force?: boolean; // Overwrite if already installed
}

export interface InstallResult {
  ok: boolean;
  skillPath?: string; // Where the skill was installed
  error?: string; // SKILL-006 | SKILL-009 etc.
  skipped?: boolean; // Already installed and force=false
}

/**
 * Convert a skill name to a filesystem-safe slug.
 * Lowercased, hyphens preserved, non-alphanumeric stripped.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Install a selected HF skill into .dantecode/skills/<slug>/SKILL.md
 * Creates the skill directory and writes a SKILL.md with correct provenance.
 * Sets provenance.sourceType = "hf", preserves license.
 * Returns SKILL-006 if license is missing from entry.
 */
export async function installHFSkill(opts: InstallHFSkillOptions): Promise<InstallResult> {
  const { entry, projectRoot, force } = opts;

  // SKILL-006: license required
  if (!entry.license || entry.license.trim() === "") {
    return {
      ok: false,
      error: "SKILL-006: license is required for HF skill installation",
    };
  }

  const slug = toSlug(entry.name);
  const skillDir = join(projectRoot, ".dantecode", "skills", slug);
  const skillPath = join(skillDir, "SKILL.md");

  // Check if already installed
  if (!force) {
    try {
      await readFile(skillPath, "utf-8");
      // File exists and force=false → skip
      return { ok: true, skillPath, skipped: true };
    } catch {
      // File doesn't exist — proceed with install
    }
  }

  // Build SKILL.md content with provenance frontmatter
  const importedAt = new Date().toISOString();
  const compatibilityYaml =
    entry.compatibility && entry.compatibility.length > 0
      ? `compatibility:\n${entry.compatibility.map((c) => `  - ${c}`).join("\n")}\n`
      : "";
  const tagsYaml =
    entry.tags && entry.tags.length > 0
      ? `tags:\n${entry.tags.map((t) => `  - ${t}`).join("\n")}\n`
      : "";
  const versionYaml = entry.version ? `version: ${entry.version}\n` : "";

  const skillMdContent = [
    "---",
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    `license: ${entry.license}`,
    `source-type: hf`,
    `source-repo: ${entry.sourceRepo}`,
    `source-path: ${entry.sourcePath}`,
    versionYaml.trimEnd(),
    compatibilityYaml.trimEnd(),
    tagsYaml.trimEnd(),
    `imported-at: ${importedAt}`,
    "---",
    "",
    `# ${entry.name}`,
    "",
    entry.description,
    "",
    `## Source`,
    "",
    `This skill was imported from [${entry.sourceRepo}](https://huggingface.co/${entry.sourceRepo}) at \`${entry.sourcePath}\`.`,
    "",
    `## Provenance`,
    "",
    `- Source type: hf`,
    `- Source repo: ${entry.sourceRepo}`,
    `- Source path: ${entry.sourcePath}`,
    `- License: ${entry.license}`,
    `- Imported at: ${importedAt}`,
    entry.version ? `- Version: ${entry.version}` : "",
  ]
    .filter((line) => line !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  try {
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillPath, skillMdContent, "utf-8");
    return { ok: true, skillPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `SKILL-009: failed to write skill to disk — ${message}`,
    };
  }
}
