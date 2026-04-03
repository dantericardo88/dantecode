// ============================================================================
// @dantecode/skills-registry — Skill Discovery
// Discovers skills from multiple scopes: project, user-global, and compat.
// ============================================================================

import { readdir, stat, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export type SkillScope = "project" | "user" | "compat";

export interface SkillEntry {
  /** From SKILL.md name field, or directory name as fallback. */
  name: string;
  /** Sanitized directory name. */
  slug: string;
  /** Where it was discovered. */
  scope: SkillScope;
  /** Absolute path to SKILL.md. */
  skillMdPath: string;
  /** Absolute path to skill directory. */
  dirPath: string;
  /** True if .disabled marker file exists. */
  disabled: boolean;
}

export interface DiscoveryOptions {
  projectRoot: string;
  /** Default: true */
  includeUserScope?: boolean;
  /** Default: true — discovers from .agents/skills/ */
  includeCompatScope?: boolean;
  /** Override for testing */
  userHome?: string;
}

/**
 * Extracts the `name` field from SKILL.md frontmatter.
 * Returns undefined if no frontmatter or no name field.
 */
async function readSkillName(skillMdPath: string): Promise<string | undefined> {
  let content: string;
  try {
    content = await readFile(skillMdPath, "utf-8");
  } catch {
    return undefined;
  }

  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return undefined;
  }

  const afterOpener = trimmed.slice(3);
  const closingIndex = afterOpener.indexOf("\n---");
  if (closingIndex === -1) {
    return undefined;
  }

  const yamlBlock = afterOpener.slice(0, closingIndex);

  // Simple line-by-line scan for name: field (no YAML library dependency)
  for (const line of yamlBlock.split("\n")) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("name:")) {
      const value = trimmedLine.slice("name:".length).trim();
      // Strip surrounding quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        return value.slice(1, -1).trim() || undefined;
      }
      return value || undefined;
    }
  }

  return undefined;
}

/**
 * Check if a .disabled marker exists in the skill directory.
 */
async function isDisabled(dirPath: string): Promise<boolean> {
  try {
    await access(join(dirPath, ".disabled"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan a single scope directory for SKILL.md files.
 * Each subdirectory in scopeDir that contains a SKILL.md is a skill.
 */
async function scanScopeDir(scopeDir: string, scope: SkillScope): Promise<SkillEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(scopeDir);
  } catch {
    // Directory doesn't exist or can't be read — skip silently
    return [];
  }

  const results: SkillEntry[] = [];

  for (const entry of entries) {
    const dirPath = join(scopeDir, entry);

    let entryStat;
    try {
      entryStat = await stat(dirPath);
    } catch {
      continue;
    }
    if (!entryStat.isDirectory()) continue;

    // Check for SKILL.md presence
    const skillMdPath = join(dirPath, "SKILL.md");
    try {
      await access(skillMdPath);
    } catch {
      // No SKILL.md — skip (not an error)
      continue;
    }

    const slug = entry;
    const nameFromFrontmatter = await readSkillName(skillMdPath);
    const name = nameFromFrontmatter ?? slug;
    const disabled = await isDisabled(dirPath);

    results.push({
      name,
      slug,
      scope,
      skillMdPath,
      dirPath,
      disabled,
    });
  }

  return results;
}

/**
 * Discover skills from all configured scopes.
 *
 * Scope roots:
 *   project: <projectRoot>/.dantecode/skills/
 *   user:    ~/.dantecode/skills/
 *   compat:  <projectRoot>/.agents/skills/
 *
 * Each scope is a directory where subdirectories contain SKILL.md files.
 * Skills without SKILL.md are ignored (but not errored).
 */
export async function discoverSkills(opts: DiscoveryOptions): Promise<SkillEntry[]> {
  const {
    projectRoot,
    includeUserScope = true,
    includeCompatScope = true,
    userHome = homedir(),
  } = opts;

  const allEntries: SkillEntry[] = [];

  // Project scope
  const projectScopeDir = join(projectRoot, ".dantecode", "skills");
  const projectEntries = await scanScopeDir(projectScopeDir, "project");
  allEntries.push(...projectEntries);

  // User scope
  if (includeUserScope) {
    const userScopeDir = join(userHome, ".dantecode", "skills");
    const userEntries = await scanScopeDir(userScopeDir, "user");
    allEntries.push(...userEntries);
  }

  // Compat scope (.agents/skills/)
  if (includeCompatScope) {
    const compatScopeDir = join(projectRoot, ".agents", "skills");
    const compatEntries = await scanScopeDir(compatScopeDir, "compat");
    allEntries.push(...compatEntries);
  }

  return allEntries;
}
