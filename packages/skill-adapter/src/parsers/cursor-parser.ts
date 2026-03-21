// ============================================================================
// @dantecode/skill-adapter — Cursor IDE Parser
// Parses Cursor .mdc rule files from .cursor/rules/*.mdc
// Cursor rules use markdown with YAML-like frontmatter.
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
export interface ScannedCursorRule {
  /** Absolute path to the .mdc rule file. */
  path: string;
  /** Derived rule name from filename. */
  name: string;
  /** Raw file content. */
  raw: string;
}

/** Fully parsed Cursor rule with frontmatter, instruction body, and cursor-specific metadata. */
export interface ParsedCursorRule {
  frontmatter: SkillFrontmatter;
  instructions: string;
  sourcePath: string;
  cursorMetadata: {
    alwaysApply: boolean;
    globs?: string | string[];
  };
}

// ----------------------------------------------------------------------------
// Default Directory
// ----------------------------------------------------------------------------

const DEFAULT_CURSOR_RULES_DIR = join(homedir(), ".cursor", "rules");

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Extracts YAML frontmatter delimited by `---` markers and returns
 * the parsed content plus the remaining text body.
 *
 * @param raw - The full file content.
 * @returns A tuple of [parsed YAML object, remaining body string].
 */
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

/**
 * Returns the first non-empty, non-heading paragraph from a markdown body.
 * Maximum 200 characters. Used to auto-extract a description when none is
 * provided in the frontmatter.
 *
 * @param body - The markdown body text.
 * @returns A trimmed string of at most 200 chars, or empty string if none found.
 */
export function extractFirstParagraph(body: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip headings
    if (trimmed.startsWith("#")) continue;
    // Skip HTML comments
    if (trimmed.startsWith("<!--")) continue;
    return trimmed.slice(0, 200);
  }
  return "";
}

// ----------------------------------------------------------------------------
// Scanner
// ----------------------------------------------------------------------------

/**
 * Scans for Cursor `.mdc` rule files.
 *
 * Cursor stores rules as `.mdc` files (flat, non-recursive) in
 * `~/.cursor/rules/`. When a custom directory is provided it is also scanned
 * directly (not recursively) for `.mdc` files.
 *
 * @param cursorDir - Optional override for the rules directory.
 *                     Defaults to `~/.cursor/rules/`.
 * @returns Array of ScannedCursorRule objects, one per discovered file.
 */
export async function scanCursorRules(cursorDir?: string): Promise<ScannedCursorRule[]> {
  const dir = cursorDir ?? DEFAULT_CURSOR_RULES_DIR;
  const rules: ScannedCursorRule[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return rules;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (!/\.mdc$/i.test(entry)) continue;

    const fullPath = join(dir, entry);
    let entryStat;
    try {
      entryStat = await stat(fullPath);
    } catch {
      continue;
    }

    if (!entryStat.isFile()) continue;

    let raw: string;
    try {
      raw = await readFile(fullPath, "utf-8");
    } catch {
      continue;
    }

    const name = basename(fullPath, ".mdc").replace(/[._]/g, "-").toLowerCase();
    rules.push({ path: fullPath, name, raw });
  }

  return rules;
}

// ----------------------------------------------------------------------------
// Parser
// ----------------------------------------------------------------------------

/**
 * Parses a Cursor `.mdc` rule file into a ParsedCursorRule.
 *
 * Cursor rules use YAML frontmatter (between `---` delimiters) with:
 * - `name`: rule name (falls back to filename without `.mdc`)
 * - `description`: rule description (auto-extracted from body if absent)
 * - `alwaysApply`: boolean (default false)
 * - `globs`: string or string[] file glob patterns
 *
 * Everything after the closing `---` delimiter is the instruction body.
 *
 * @param content - The raw `.mdc` file content.
 * @param sourcePath - The absolute path where the file was found.
 * @returns A ParsedCursorRule with extracted frontmatter and cursor metadata.
 */
export function parseCursorRule(content: string, sourcePath: string): ParsedCursorRule {
  const [rawFrontmatter, body] = extractFrontmatter(content);

  const fallbackName = basename(sourcePath, ".mdc").replace(/[._]/g, "-").toLowerCase();

  const name =
    typeof rawFrontmatter["name"] === "string" ? rawFrontmatter["name"] : fallbackName;

  // Auto-extract description from body if not in frontmatter
  const descriptionFromFrontmatter =
    typeof rawFrontmatter["description"] === "string" ? rawFrontmatter["description"] : "";
  const description = descriptionFromFrontmatter || extractFirstParagraph(body);

  const alwaysApplyRaw = rawFrontmatter["alwaysApply"];
  const alwaysApply: boolean =
    typeof alwaysApplyRaw === "boolean"
      ? alwaysApplyRaw
      : typeof alwaysApplyRaw === "string"
      ? alwaysApplyRaw.toLowerCase() === "true"
      : false;

  const rawGlobs = rawFrontmatter["globs"];
  const globs: string | string[] | undefined =
    typeof rawGlobs === "string"
      ? rawGlobs
      : Array.isArray(rawGlobs)
      ? (rawGlobs as unknown[]).filter((g): g is string => typeof g === "string")
      : undefined;

  const frontmatter: SkillFrontmatter = {
    name,
    description,
    model: typeof rawFrontmatter["model"] === "string" ? rawFrontmatter["model"] : undefined,
  };

  return {
    frontmatter,
    instructions: body,
    sourcePath,
    cursorMetadata: {
      alwaysApply,
      globs,
    },
  };
}
