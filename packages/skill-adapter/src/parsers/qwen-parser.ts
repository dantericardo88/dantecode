// ============================================================================
// @dantecode/skill-adapter — Qwen Code / Gemini CLI Parser
// Qwen Code is a Gemini CLI fork — uses identical SKILL.md format.
// Skills live in ~/.qwen/skills/ or project .qwen/skills/
// Also supports ~/.gemini/skills/ (Gemini CLI path).
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
export interface ScannedQwenSkill {
  /** Absolute path to the skill file. */
  path: string;
  /** Derived skill name from filename. */
  name: string;
  /** Raw file content. */
  raw: string;
}

/** Fully parsed Qwen/Gemini skill with frontmatter and instruction body. */
export interface ParsedQwenSkill {
  frontmatter: SkillFrontmatter;
  instructions: string;
  sourcePath: string;
}

// ----------------------------------------------------------------------------
// Default Directories
// ----------------------------------------------------------------------------

const DEFAULT_QWEN_SKILLS_DIR = join(homedir(), ".qwen", "skills");
const DEFAULT_GEMINI_SKILLS_DIR = join(homedir(), ".gemini", "skills");

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
    return results;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;

    const fullPath = join(dir, entry);
    let entryStat;
    try {
      entryStat = await stat(fullPath);
    } catch {
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
 * Scans the Qwen and Gemini skills directories for SKILL.md files.
 *
 * Scans both `~/.qwen/skills/` (Qwen Code path) and `~/.gemini/skills/`
 * (Gemini CLI path, since Qwen Code is a fork with identical format).
 *
 * @param qwenDir - Optional override directory. When provided, only this
 *                   directory is scanned (not the default Gemini path).
 * @returns Array of ScannedQwenSkill objects, one per discovered file.
 */
export async function scanQwenSkills(qwenDir?: string): Promise<ScannedQwenSkill[]> {
  const skills: ScannedQwenSkill[] = [];
  const seenPaths = new Set<string>();

  const dirs =
    qwenDir !== undefined ? [qwenDir] : [DEFAULT_QWEN_SKILLS_DIR, DEFAULT_GEMINI_SKILLS_DIR];

  for (const dir of dirs) {
    const files = await findMarkdownFiles(dir);
    for (const filePath of files) {
      if (seenPaths.has(filePath)) continue;
      seenPaths.add(filePath);

      let raw: string;
      try {
        raw = await readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const name =
        basename(filePath, ".md")
          .replace(/^SKILL[._-]?/i, "")
          .replace(/[._]/g, "-")
          .toLowerCase() || basename(filePath, ".md").toLowerCase();

      skills.push({ path: filePath, name, raw });
    }
  }

  return skills;
}

// ----------------------------------------------------------------------------
// Parser Helpers
// ----------------------------------------------------------------------------

function extractFrontmatter(raw: string): [Record<string, unknown>, string] {
  const trimmed = raw.trimStart();

  if (!trimmed.startsWith("---")) {
    return [{}, raw];
  }

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

// ----------------------------------------------------------------------------
// Parser
// ----------------------------------------------------------------------------

/**
 * Parses a Qwen Code or Gemini CLI SKILL.md file into a ParsedQwenSkill.
 *
 * Uses the same SKILL.md format as Claude Code:
 * - `name`: skill name (falls back to filename with SKILL prefix stripped)
 * - `description`: skill description (falls back to empty string)
 * - `tools`: array of tool names
 * - `model`: optional model requirement
 *
 * Everything after the closing `---` delimiter is the instruction body.
 *
 * @param content - The raw markdown file content.
 * @param sourcePath - The absolute path where the file was found.
 * @returns A ParsedQwenSkill with extracted frontmatter and instructions.
 */
export function parseQwenSkill(content: string, sourcePath: string): ParsedQwenSkill {
  const [rawFrontmatter, body] = extractFrontmatter(content);

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
