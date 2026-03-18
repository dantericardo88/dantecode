// ============================================================================
// @dantecode/skill-adapter — Claude Skill Parser
// Scans ~/.claude/skills/ for SKILL.md files and parses YAML frontmatter.
// ============================================================================

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";
import type { SkillFrontmatter } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Raw scan result before parsing. */
export interface ScannedSkill {
  /** Absolute path to the skill file. */
  path: string;
  /** Derived skill name from filename (e.g., "my-skill" from "my-skill.md"). */
  name: string;
  /** Raw file content. */
  raw: string;
}

/** Fully parsed Claude skill with frontmatter and instruction body. */
export interface ParsedClaudeSkill {
  frontmatter: SkillFrontmatter;
  instructions: string;
  sourcePath: string;
}

// ----------------------------------------------------------------------------
// Default Directory
// ----------------------------------------------------------------------------

const DEFAULT_CLAUDE_SKILLS_DIR = join(homedir(), ".claude", "skills");

// ----------------------------------------------------------------------------
// Recursive File Discovery
// ----------------------------------------------------------------------------

/**
 * Recursively discovers all markdown files within a directory tree.
 * Follows subdirectories but skips hidden directories (prefixed with `.`).
 *
 * @param dir - Absolute path to the directory to scan.
 * @returns Array of absolute file paths to markdown files.
 */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // Directory does not exist or is not readable
    return results;
  }

  for (const entry of entries) {
    // Skip hidden directories and files
    if (entry.startsWith(".")) continue;

    const fullPath = join(dir, entry);
    let entryStat;
    try {
      entryStat = await stat(fullPath);
    } catch {
      // Skip entries we cannot stat (broken symlinks, permission issues)
      continue;
    }

    if (entryStat.isDirectory()) {
      const nested = await findMarkdownFiles(fullPath);
      results.push(...nested);
    } else if (entryStat.isFile() && /\.md$/i.test(entry)) {
      results.push(fullPath);
    }
  }

  return results;
}

// ----------------------------------------------------------------------------
// Scanner
// ----------------------------------------------------------------------------

/**
 * Scans the Claude skills directory for SKILL.md files recursively.
 *
 * Each `.md` file found is read and returned as a ScannedSkill with:
 * - `path`: the absolute filesystem path
 * - `name`: derived from the filename without extension
 * - `raw`: the full file content
 *
 * @param claudeDir - Optional override for the skills directory.
 *                     Defaults to `~/.claude/skills/`.
 * @returns Array of ScannedSkill objects, one per discovered markdown file.
 */
export async function scanClaudeSkills(claudeDir?: string): Promise<ScannedSkill[]> {
  const dir = claudeDir ?? DEFAULT_CLAUDE_SKILLS_DIR;
  const files = await findMarkdownFiles(dir);
  const skills: ScannedSkill[] = [];

  for (const filePath of files) {
    const raw = await readFile(filePath, "utf-8");
    const name =
      basename(filePath, ".md")
        .replace(/^SKILL[._-]?/i, "")
        .replace(/[._]/g, "-")
        .toLowerCase() || basename(filePath, ".md").toLowerCase();

    skills.push({ path: filePath, name, raw });
  }

  return skills;
}

// ----------------------------------------------------------------------------
// Parser
// ----------------------------------------------------------------------------

/**
 * Extracts YAML frontmatter delimited by `---` markers and returns
 * the parsed content plus the remaining text body.
 *
 * @param raw - The full markdown file content.
 * @returns A tuple of [parsed YAML object, remaining body string].
 *          Returns [empty object, full content] if no frontmatter is found.
 */
function extractFrontmatter(raw: string): [Record<string, unknown>, string] {
  const trimmed = raw.trimStart();

  if (!trimmed.startsWith("---")) {
    return [{}, raw];
  }

  // Find the closing --- delimiter (must be on its own line)
  const afterOpener = trimmed.slice(3);
  const closingIndex = afterOpener.indexOf("\n---");
  if (closingIndex === -1) {
    return [{}, raw];
  }

  const yamlBlock = afterOpener.slice(0, closingIndex).trim();
  const body = afterOpener.slice(closingIndex + 4).trim();

  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlBlock);
  } catch {
    // If YAML parsing fails, treat entire content as instructions
    return [{}, raw];
  }

  if (
    parsed === null ||
    parsed === undefined ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return [{}, raw];
  }

  return [parsed as Record<string, unknown>, body];
}

/**
 * Parses a Claude SKILL.md file into structured frontmatter and instruction body.
 *
 * Extracts YAML frontmatter (between `---` delimiters) and parses:
 * - `name`: skill name (falls back to filename-derived name)
 * - `description`: skill description (falls back to empty string)
 * - `tools`: array of tool names the skill requires
 * - `model`: optional model requirement
 *
 * Everything after the closing `---` delimiter is treated as the
 * instruction body, returned verbatim.
 *
 * @param content - The raw markdown file content.
 * @param sourcePath - The absolute path where the file was found.
 * @returns A ParsedClaudeSkill with extracted frontmatter and instructions.
 */
export function parseClaudeSkill(content: string, sourcePath: string): ParsedClaudeSkill {
  const [rawFrontmatter, body] = extractFrontmatter(content);

  // Derive a fallback name from the source path
  const fallbackName =
    basename(sourcePath, ".md")
      .replace(/^SKILL[._-]?/i, "")
      .replace(/[._]/g, "-")
      .toLowerCase() || basename(sourcePath, ".md").toLowerCase();

  const frontmatter: SkillFrontmatter = {
    name: typeof rawFrontmatter["name"] === "string" ? rawFrontmatter["name"] : fallbackName,
    description:
      typeof rawFrontmatter["description"] === "string" ? rawFrontmatter["description"] : "",
    tools: Array.isArray(rawFrontmatter["tools"])
      ? (rawFrontmatter["tools"] as unknown[]).filter((t): t is string => typeof t === "string")
      : undefined,
    model: typeof rawFrontmatter["model"] === "string" ? rawFrontmatter["model"] : undefined,
  };

  return {
    frontmatter,
    instructions: body,
    sourcePath,
  };
}
