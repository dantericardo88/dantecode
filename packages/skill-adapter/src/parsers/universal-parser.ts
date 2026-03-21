// ============================================================================
// @dantecode/skill-adapter — Universal Skill Parser
// Auto-detects skill format from directory structure and delegates to the
// correct parser. Supports all 8 agent skill formats.
// ============================================================================

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import YAML from "yaml";
import { parseClaudeSkill } from "./claude.js";
import { parseContinueAgent } from "./continue.js";
import { parseOpencodeAgent } from "./opencode.js";
import { parseCodexSkill } from "./codex-parser.js";
import { parseCursorRule } from "./cursor-parser.js";
import { parseQwenSkill } from "./qwen-parser.js";
import type { ParsedSkill } from "../wrap.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type SkillSourceFormat =
  | "claude"
  | "codex"
  | "cursor"
  | "qwen"
  | "opencode"
  | "continue"
  | "universal"
  | "danteforge"
  | "unknown";

export interface DetectionResult {
  format: SkillSourceFormat;
  /** Confidence score: 0–1 */
  confidence: number;
  /** Discovered skill file paths for this format. */
  paths: string[];
  metadata?: Record<string, unknown>;
}

export interface UniversalParsedSkill {
  name: string;
  description: string;
  instructions: string;
  source: SkillSourceFormat;
  sourcePath: string;
  version?: string;
  tags?: string[];
  scripts?: string[];
  metadata?: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// File System Helpers
// ----------------------------------------------------------------------------

/**
 * Returns true if the given path exists (file or directory).
 */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively finds all `*.md` files under `dir`, skipping hidden directories.
 */
export async function globMarkdownFiles(dir: string): Promise<string[]> {
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
      const nested = await globMarkdownFiles(fullPath);
      results.push(...nested);
    } else if (entryStat.isFile() && /\.md$/i.test(entry)) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Finds all `*.mdc` files in `dir` (flat, non-recursive).
 */
export async function globMdcFiles(dir: string): Promise<string[]> {
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

    if (entryStat.isFile() && /\.mdc$/i.test(entry)) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Finds all `*.toml` files in `dir` (flat, non-recursive).
 */
export async function globTomlFiles(dir: string): Promise<string[]> {
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

    if (entryStat.isFile() && /\.toml$/i.test(entry)) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Recursively finds all files named exactly `SKILL.md` anywhere in the tree.
 * Skips hidden directories.
 */
export async function findSkillMdFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(rootDir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;

    const fullPath = join(rootDir, entry);
    let entryStat;
    try {
      entryStat = await stat(fullPath);
    } catch {
      continue;
    }

    if (entryStat.isDirectory()) {
      const nested = await findSkillMdFiles(fullPath);
      results.push(...nested);
    } else if (entryStat.isFile() && entry === "SKILL.md") {
      results.push(fullPath);
    }
  }

  return results;
}

// ----------------------------------------------------------------------------
// Detection
// ----------------------------------------------------------------------------

/**
 * Detects which skill formats are present within a project root directory.
 *
 * Checks for known directory structures and files corresponding to each
 * supported agent skill format. Returns a DetectionResult for every format
 * that is found.
 *
 * @param rootDir - The project root directory to inspect.
 * @returns Array of DetectionResult entries, one per detected format.
 */
export async function detectSkillSources(rootDir: string): Promise<DetectionResult[]> {
  const results: DetectionResult[] = [];

  // Helper: check a subdirectory and collect matching files
  async function check(
    subpath: string,
    format: SkillSourceFormat,
    confidence: number,
    collector: (dir: string) => Promise<string[]>,
  ): Promise<void> {
    const fullDir = join(rootDir, subpath);
    if (!(await pathExists(fullDir))) return;

    let paths: string[] = [];
    try {
      paths = await collector(fullDir);
    } catch {
      // directory exists but unreadable — still report with empty paths
    }

    results.push({ format, confidence, paths });
  }

  // Claude
  await check(".claude/skills", "claude", 1.0, globMarkdownFiles);
  await check(".claude/commands", "claude", 0.9, globMarkdownFiles);

  // Codex
  await check(".codex/skills", "codex", 1.0, globMarkdownFiles);
  await check(".codex/agents", "codex", 0.8, globTomlFiles);

  // Cursor
  await check(".cursor/rules", "cursor", 1.0, globMdcFiles);

  // Qwen (and Gemini fork)
  await check(".qwen/skills", "qwen", 1.0, globMarkdownFiles);
  await check(".gemini/skills", "qwen", 0.9, globMarkdownFiles);

  // OpenCode
  await check(".opencode/skills", "opencode", 1.0, globMarkdownFiles);

  // Continue
  await check(".continue", "continue", 0.8, globMarkdownFiles);

  // DanteForge
  await check(".danteforge/skills", "danteforge", 1.0, globMarkdownFiles);

  // Universal SKILL.md files (any location)
  try {
    const skillMds = await findSkillMdFiles(rootDir);
    if (skillMds.length > 0) {
      results.push({ format: "universal", confidence: 0.7, paths: skillMds });
    }
  } catch {
    // ignore
  }

  return results;
}

// ----------------------------------------------------------------------------
// Universal Parser
// ----------------------------------------------------------------------------

/**
 * Parses a skill file at `filePath` using the parser appropriate for `format`.
 *
 * Delegates to the correct format-specific parser and maps the result to the
 * UniversalParsedSkill shape. For "danteforge" format, treats the file as a
 * Claude SKILL.md. For "unknown" format, attempts YAML frontmatter extraction
 * with raw body fallback.
 *
 * @param filePath - Absolute path to the skill file.
 * @param format - The detected or specified source format.
 * @returns A UniversalParsedSkill with normalized fields.
 */
export async function parseUniversalSkill(
  filePath: string,
  format: SkillSourceFormat,
): Promise<UniversalParsedSkill> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    content = "";
  }

  const fallbackName = basename(filePath)
    .replace(/\.(md|mdc|toml)$/i, "")
    .replace(/^SKILL[._-]?/i, "")
    .replace(/[._]/g, "-")
    .toLowerCase() || "unknown";

  switch (format) {
    case "claude":
    case "danteforge": {
      const parsed = parseClaudeSkill(content, filePath);
      return {
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        instructions: parsed.instructions,
        source: format,
        sourcePath: filePath,
        metadata: parsed.frontmatter.model
          ? { model: parsed.frontmatter.model }
          : undefined,
      };
    }

    case "continue": {
      const parsed = parseContinueAgent(content, filePath);
      return {
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        instructions: parsed.instructions,
        source: format,
        sourcePath: filePath,
      };
    }

    case "opencode": {
      const parsed = parseOpencodeAgent(content, filePath);
      return {
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        instructions: parsed.instructions,
        source: format,
        sourcePath: filePath,
        metadata: parsed.frontmatter.mode ? { mode: parsed.frontmatter.mode } : undefined,
      };
    }

    case "codex": {
      const parsed = parseCodexSkill(content, filePath);
      return {
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        instructions: parsed.instructions,
        source: format,
        sourcePath: filePath,
        metadata: parsed.metadata as Record<string, unknown> | undefined,
      };
    }

    case "cursor": {
      const parsed = parseCursorRule(content, filePath);
      return {
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        instructions: parsed.instructions,
        source: format,
        sourcePath: filePath,
        metadata: parsed.cursorMetadata as unknown as Record<string, unknown>,
      };
    }

    case "qwen":
    case "universal": {
      const parsed = parseQwenSkill(content, filePath);
      return {
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        instructions: parsed.instructions,
        source: format,
        sourcePath: filePath,
      };
    }

    default: {
      // "unknown" — attempt YAML frontmatter extraction
      const fm = extractUnknownFrontmatter(content);
      const name =
        typeof fm.data["name"] === "string" ? fm.data["name"] : fallbackName;
      const description =
        typeof fm.data["description"] === "string" ? fm.data["description"] : "";
      return {
        name,
        description,
        instructions: fm.body,
        source: "unknown",
        sourcePath: filePath,
      };
    }
  }
}

function extractUnknownFrontmatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return { data: {}, body: raw };
  }

  const afterOpener = trimmed.slice(3);
  const closingIndex = afterOpener.indexOf("\n---");
  if (closingIndex === -1) {
    return { data: {}, body: raw };
  }

  const yamlBlock = afterOpener.slice(0, closingIndex).trim();
  const body = afterOpener.slice(closingIndex + 4).trim();

  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlBlock);
  } catch {
    return { data: {}, body: raw };
  }

  if (
    parsed === null ||
    parsed === undefined ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return { data: {}, body: raw };
  }

  return { data: parsed as Record<string, unknown>, body };
}

// ----------------------------------------------------------------------------
// Conversion
// ----------------------------------------------------------------------------

/**
 * Converts a UniversalParsedSkill to the ParsedSkill shape used by wrap.ts.
 *
 * @param u - The universal parsed skill to convert.
 * @returns A ParsedSkill compatible with wrapSkillWithAdapter().
 */
export function universalToWrappable(u: UniversalParsedSkill): ParsedSkill {
  return {
    frontmatter: {
      name: u.name,
      description: u.description,
      tools: Array.isArray(u.metadata?.["tools"])
        ? (u.metadata["tools"] as unknown[]).filter((t): t is string => typeof t === "string")
        : undefined,
      model:
        typeof u.metadata?.["model"] === "string" ? u.metadata["model"] : undefined,
      mode:
        typeof u.metadata?.["mode"] === "string" ? u.metadata["mode"] : undefined,
    },
    instructions: u.instructions,
    sourcePath: u.sourcePath,
  };
}
