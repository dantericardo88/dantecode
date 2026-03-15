// ============================================================================
// @dantecode/skill-adapter — Skill Registry
// Manages the local registry of imported and wrapped skills stored in
// .dantecode/skills/. Provides loading, listing, retrieval, removal,
// and validation of registered skills.
// ============================================================================

import { readdir, readFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { runAntiStubScanner, runConstitutionCheck } from "@dantecode/danteforge";
import type { SkillFrontmatter, SkillDefinition } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** Relative path under project root where skills are stored. */
const SKILLS_DIR = ".dantecode/skills";

/** Expected filename for a wrapped DanteCode skill. */
const SKILL_FILENAME = "SKILL.dc.md";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Summary metadata for a registered skill. */
export interface SkillRegistryEntry {
  /** The skill name from frontmatter. */
  name: string;
  /** The skill description from frontmatter. */
  description: string;
  /** The import source (claude, continue, opencode). */
  importSource: string;
  /** The adapter version used during wrapping. */
  adapterVersion: string;
  /** ISO timestamp of when the skill was wrapped. */
  wrappedAt: string;
  /** Absolute path to the SKILL.dc.md file. */
  path: string;
  /** The original tools from the source skill. */
  originalTools?: string[];
  /** The mode (primary/subagent) if specified. */
  mode?: string;
}

/** Result of validating a skill. */
export interface SkillValidationResult {
  name: string;
  antiStubPassed: boolean;
  constitutionPassed: boolean;
  antiStubHardViolations: number;
  antiStubSoftViolations: number;
  constitutionCriticalViolations: number;
  constitutionWarningViolations: number;
  overallPassed: boolean;
}

// ----------------------------------------------------------------------------
// Internal Helpers
// ----------------------------------------------------------------------------

/**
 * Extracts YAML frontmatter from a SKILL.dc.md file.
 *
 * @param raw - The full file content.
 * @returns Parsed frontmatter as a record, or null if extraction fails.
 */
function extractFrontmatter(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trimStart();

  if (!trimmed.startsWith("---")) {
    return null;
  }

  const afterOpener = trimmed.slice(3);
  const closingIndex = afterOpener.indexOf("\n---");
  if (closingIndex === -1) {
    return null;
  }

  const yamlBlock = afterOpener.slice(0, closingIndex).trim();

  try {
    const parsed: unknown = YAML.parse(yamlBlock);
    if (
      parsed === null ||
      parsed === undefined ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extracts the instruction body from a SKILL.dc.md file.
 * The instruction body is the content between the ORIGINAL SKILL INSTRUCTIONS
 * comment markers.
 *
 * @param raw - The full file content.
 * @returns The extracted instruction body, or the full content after frontmatter.
 */
function extractInstructions(raw: string): string {
  // Look for the original skill instructions section
  const startMarker = "<!-- ORIGINAL SKILL INSTRUCTIONS";
  const postambleMarker = "<!-- DANTEFORGE POSTAMBLE";

  const startIdx = raw.indexOf(startMarker);
  if (startIdx === -1) {
    // Fallback: extract everything after frontmatter
    const trimmed = raw.trimStart();
    if (trimmed.startsWith("---")) {
      const afterOpener = trimmed.slice(3);
      const closingIndex = afterOpener.indexOf("\n---");
      if (closingIndex !== -1) {
        return afterOpener.slice(closingIndex + 4).trim();
      }
    }
    return raw;
  }

  // Find the end of the ORIGINAL SKILL INSTRUCTIONS comment block
  const afterStart = raw.indexOf("-->", startIdx);
  if (afterStart === -1) {
    return raw.slice(startIdx);
  }

  // The instructions are between the end of the start comment and the postamble
  const instructionsStart = afterStart + 3;
  const postambleIdx = raw.indexOf(postambleMarker, instructionsStart);
  if (postambleIdx === -1) {
    return raw.slice(instructionsStart).trim();
  }

  return raw.slice(instructionsStart, postambleIdx).trim();
}

/**
 * Builds a SkillFrontmatter from a raw frontmatter record.
 */
function buildSkillFrontmatter(fm: Record<string, unknown>): SkillFrontmatter {
  return {
    name: typeof fm["name"] === "string" ? fm["name"] : "unnamed",
    description: typeof fm["description"] === "string" ? fm["description"] : "",
    tools: Array.isArray(fm["original_tools"])
      ? (fm["original_tools"] as unknown[]).filter((t): t is string => typeof t === "string")
      : undefined,
    model: typeof fm["original_model"] === "string" ? fm["original_model"] : undefined,
    mode: typeof fm["mode"] === "string" ? fm["mode"] : undefined,
    hidden: typeof fm["hidden"] === "boolean" ? fm["hidden"] : undefined,
    color: typeof fm["color"] === "string" ? fm["color"] : undefined,
  };
}

// ----------------------------------------------------------------------------
// Registry Functions
// ----------------------------------------------------------------------------

/**
 * Scans `.dantecode/skills/` and builds a registry of all imported skills.
 *
 * Each subdirectory under the skills directory is expected to contain a
 * `SKILL.dc.md` file. The frontmatter of each file is parsed to build
 * the registry entries.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @returns Array of SkillRegistryEntry objects for all discovered skills.
 */
export async function loadSkillRegistry(projectRoot: string): Promise<SkillRegistryEntry[]> {
  const skillsDir = join(projectRoot, SKILLS_DIR);
  const registry: SkillRegistryEntry[] = [];

  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    // Skills directory does not exist — return empty registry
    return registry;
  }

  for (const entry of entries) {
    const skillDir = join(skillsDir, entry);

    // Skip non-directories
    let entryStat;
    try {
      entryStat = await stat(skillDir);
    } catch {
      continue;
    }
    if (!entryStat.isDirectory()) continue;

    // Look for SKILL.dc.md
    const skillFilePath = join(skillDir, SKILL_FILENAME);
    let content: string;
    try {
      content = await readFile(skillFilePath, "utf-8");
    } catch {
      // No SKILL.dc.md in this directory — skip
      continue;
    }

    // Parse frontmatter
    const fm = extractFrontmatter(content);
    if (fm === null) continue;

    const registryEntry: SkillRegistryEntry = {
      name: typeof fm["name"] === "string" ? fm["name"] : entry,
      description: typeof fm["description"] === "string" ? fm["description"] : "",
      importSource: typeof fm["import_source"] === "string" ? fm["import_source"] : "unknown",
      adapterVersion: typeof fm["adapter_version"] === "string" ? fm["adapter_version"] : "unknown",
      wrappedAt: typeof fm["wrapped_at"] === "string" ? fm["wrapped_at"] : "",
      path: skillFilePath,
      originalTools: Array.isArray(fm["original_tools"])
        ? (fm["original_tools"] as unknown[]).filter((t): t is string => typeof t === "string")
        : undefined,
      mode: typeof fm["mode"] === "string" ? fm["mode"] : undefined,
    };

    registry.push(registryEntry);
  }

  // Sort by name for deterministic ordering
  registry.sort((a, b) => a.name.localeCompare(b.name));

  return registry;
}

/**
 * Returns a specific skill definition by name.
 *
 * Searches the `.dantecode/skills/` directory for a skill whose frontmatter
 * `name` field matches the requested name (case-insensitive). Returns the
 * full SkillDefinition including parsed frontmatter, instructions, and
 * adapter metadata.
 *
 * @param name - The name of the skill to retrieve.
 * @param projectRoot - Absolute path to the project root directory.
 * @returns The SkillDefinition, or null if not found.
 */
export async function getSkill(name: string, projectRoot: string): Promise<SkillDefinition | null> {
  const skillsDir = join(projectRoot, SKILLS_DIR);
  const normalizedName = name.toLowerCase();

  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    const skillDir = join(skillsDir, entry);

    let entryStat;
    try {
      entryStat = await stat(skillDir);
    } catch {
      continue;
    }
    if (!entryStat.isDirectory()) continue;

    const skillFilePath = join(skillDir, SKILL_FILENAME);
    let content: string;
    try {
      content = await readFile(skillFilePath, "utf-8");
    } catch {
      continue;
    }

    const fm = extractFrontmatter(content);
    if (fm === null) continue;

    const skillName = typeof fm["name"] === "string" ? fm["name"] : entry;

    // Match by name (case-insensitive) or by directory name
    if (skillName.toLowerCase() === normalizedName || entry.toLowerCase() === normalizedName) {
      const frontmatter = buildSkillFrontmatter(fm);
      const instructions = extractInstructions(content);

      const definition: SkillDefinition = {
        frontmatter,
        instructions,
        sourcePath:
          typeof fm["original_source_path"] === "string"
            ? fm["original_source_path"]
            : skillFilePath,
        wrappedPath: skillFilePath,
        isWrapped: true,
        importSource: typeof fm["import_source"] === "string" ? fm["import_source"] : undefined,
        adapterVersion:
          typeof fm["adapter_version"] === "string" ? fm["adapter_version"] : "unknown",
        constitutionCheckPassed: true,
        antiStubScanPassed: true,
      };

      return definition;
    }
  }

  return null;
}

/**
 * Returns all registered skill names and their summary metadata.
 *
 * This is a convenience wrapper around `loadSkillRegistry` that returns
 * the complete registry.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @returns Array of SkillRegistryEntry objects.
 */
export async function listSkills(projectRoot: string): Promise<SkillRegistryEntry[]> {
  return loadSkillRegistry(projectRoot);
}

/**
 * Removes a skill from the registry by deleting its directory under
 * `.dantecode/skills/`.
 *
 * Searches for the skill by name (case-insensitive) and removes the
 * entire skill directory including the SKILL.dc.md file and any
 * associated metadata.
 *
 * @param name - The name of the skill to remove.
 * @param projectRoot - Absolute path to the project root directory.
 * @returns True if the skill was found and removed, false if not found.
 */
export async function removeSkill(name: string, projectRoot: string): Promise<boolean> {
  const skillsDir = join(projectRoot, SKILLS_DIR);
  const normalizedName = name.toLowerCase();

  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return false;
  }

  for (const entry of entries) {
    const skillDir = join(skillsDir, entry);

    let entryStat;
    try {
      entryStat = await stat(skillDir);
    } catch {
      continue;
    }
    if (!entryStat.isDirectory()) continue;

    const skillFilePath = join(skillDir, SKILL_FILENAME);
    let content: string;
    try {
      content = await readFile(skillFilePath, "utf-8");
    } catch {
      continue;
    }

    const fm = extractFrontmatter(content);
    if (fm === null) continue;

    const skillName = typeof fm["name"] === "string" ? fm["name"] : entry;

    if (skillName.toLowerCase() === normalizedName || entry.toLowerCase() === normalizedName) {
      await rm(skillDir, { recursive: true, force: true });
      return true;
    }
  }

  return false;
}

/**
 * Validates a skill by running the anti-stub scanner and constitution checker
 * against its instruction content.
 *
 * Reads the SKILL.dc.md file, extracts the original instruction body, and
 * runs both quality gates. Returns a detailed validation result.
 *
 * @param name - The name of the skill to validate.
 * @param projectRoot - Absolute path to the project root directory.
 * @returns A SkillValidationResult, or null if the skill is not found.
 */
export async function validateSkill(
  name: string,
  projectRoot: string,
): Promise<SkillValidationResult | null> {
  const skill = await getSkill(name, projectRoot);
  if (skill === null) {
    return null;
  }

  // Run anti-stub scan
  const antiStubResult = runAntiStubScanner(skill.instructions, projectRoot, skill.wrappedPath);

  // Run constitution check
  const constitutionResult = runConstitutionCheck(skill.instructions, skill.wrappedPath);

  const criticalConstitutionViolations = constitutionResult.violations.filter(
    (v: { severity: string }) => v.severity === "critical",
  );
  const warningConstitutionViolations = constitutionResult.violations.filter(
    (v: { severity: string }) => v.severity === "warning",
  );

  const antiStubPassed = antiStubResult.passed;
  const constitutionPassed = criticalConstitutionViolations.length === 0;

  return {
    name: skill.frontmatter.name,
    antiStubPassed,
    constitutionPassed,
    antiStubHardViolations: antiStubResult.hardViolations.length,
    antiStubSoftViolations: antiStubResult.softViolations.length,
    constitutionCriticalViolations: criticalConstitutionViolations.length,
    constitutionWarningViolations: warningConstitutionViolations.length,
    overallPassed: antiStubPassed && constitutionPassed,
  };
}
