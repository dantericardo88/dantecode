// ============================================================================
// @dantecode/skill-adapter — Codex CLI Parser
// Parses Codex agent TOML files and Codex SKILL.md files.
// Codex agents live at ~/.codex/agents/*.toml or project .codex/agents/*.toml
// Codex skills (markdown) live at ~/.codex/skills/ or project .codex/skills/
// ============================================================================

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";
import type { SkillFrontmatter } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Raw scan result before parsing — includes the detected format. */
export interface ScannedCodexSkill {
  /** Absolute path to the skill or agent file. */
  path: string;
  /** Derived name from filename. */
  name: string;
  /** Raw file content. */
  raw: string;
  /** Whether the file is a TOML agent definition or a markdown skill. */
  format: "toml" | "markdown";
}

/** Fully parsed Codex skill/agent with frontmatter, instruction body, and metadata. */
export interface ParsedCodexSkill {
  frontmatter: SkillFrontmatter;
  instructions: string;
  sourcePath: string;
  metadata?: {
    model?: string;
    reasoningEffort?: string;
    sandboxMode?: string;
    mcpServers?: string[];
  };
}

// ----------------------------------------------------------------------------
// Default Directories
// ----------------------------------------------------------------------------

const DEFAULT_CODEX_SKILLS_DIR = join(homedir(), ".codex", "skills");
const DEFAULT_CODEX_AGENTS_DIR = join(homedir(), ".codex", "agents");

// ----------------------------------------------------------------------------
// Self-Contained TOML Parser
// ----------------------------------------------------------------------------

/**
 * Parses a subset of TOML sufficient for Codex agent files.
 * Handles:
 * - Flat key = value pairs (string, number, boolean)
 * - Quoted strings: `key = "value"`
 * - Multi-line strings delimited by `"""`
 * - Arrays: `key = ["a", "b"]`
 * - Booleans: true / false
 * - Comments: lines starting with `#`
 *
 * @param content - Raw TOML file content.
 * @returns Parsed object with string/boolean/array values.
 */
export function parseTOML(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Skip blank lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    // Skip section headers like [section]
    if (trimmed.startsWith("[") && !trimmed.startsWith("[[")) {
      i++;
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      i++;
      continue;
    }

    const rawKey = trimmed.slice(0, eqIdx).trim();
    const rawValue = trimmed.slice(eqIdx + 1).trim();

    // Multi-line string: value starts with """
    if (rawValue.startsWith('"""')) {
      const afterOpen = rawValue.slice(3);
      // Check if it closes on the same line
      const sameLineClose = afterOpen.indexOf('"""');
      if (sameLineClose !== -1) {
        result[rawKey] = afterOpen.slice(0, sameLineClose);
        i++;
        continue;
      }
      // Accumulate lines until closing """
      const parts: string[] = [];
      if (afterOpen.length > 0) {
        parts.push(afterOpen);
      }
      i++;
      let closed = false;
      while (i < lines.length) {
        const multiLine = lines[i]!;
        const closeIdx = multiLine.indexOf('"""');
        if (closeIdx !== -1) {
          const beforeClose = multiLine.slice(0, closeIdx);
          if (beforeClose.length > 0) {
            parts.push(beforeClose);
          }
          closed = true;
          i++;
          break;
        }
        parts.push(multiLine);
        i++;
      }
      if (!closed) {
        // Unterminated multi-line string — store what we have
        result[rawKey] = parts.join("\n");
      } else {
        result[rawKey] = parts.join("\n");
      }
      continue;
    }

    // Array: value starts with [
    if (rawValue.startsWith("[")) {
      // Accumulate until we have a complete closing ]
      let fullValue = rawValue;
      let lineIndex = i + 1;
      while (!fullValue.includes("]") && lineIndex < lines.length) {
        fullValue += " " + (lines[lineIndex]!).trim();
        lineIndex++;
      }

      // Safety check: if still no closing bracket, skip this entry entirely
      if (!fullValue.includes("]")) {
        i = lineIndex;
        continue;
      }

      i = lineIndex;

      const openIdx = fullValue.indexOf("[");
      const closeIdx = fullValue.lastIndexOf("]");
      // Guard: malformed value where [ appears after ] (should not happen, but be safe)
      if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) {
        i = i > lineIndex ? i : lineIndex;
        continue;
      }

      const arrayContent = fullValue.slice(openIdx + 1, closeIdx);
      const items: string[] = [];
      for (const item of arrayContent.split(",")) {
        const cleaned = item.trim().replace(/^["']|["']$/g, "");
        if (cleaned.length > 0) {
          items.push(cleaned);
        }
      }
      result[rawKey] = items;
      continue;
    }

    // Boolean
    if (rawValue === "true") {
      result[rawKey] = true;
      i++;
      continue;
    }
    if (rawValue === "false") {
      result[rawKey] = false;
      i++;
      continue;
    }

    // Quoted string
    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      result[rawKey] = rawValue.slice(1, -1);
      i++;
      continue;
    }

    // Unquoted string / number — store as string
    result[rawKey] = rawValue;
    i++;
  }

  return result;
}

// ----------------------------------------------------------------------------
// Recursive File Discovery
// ----------------------------------------------------------------------------

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

async function findTomlFiles(dir: string): Promise<string[]> {
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

// ----------------------------------------------------------------------------
// Scanner
// ----------------------------------------------------------------------------

/**
 * Scans the Codex skills and agents directories for skill/agent files.
 *
 * When no override is provided, scans both default locations:
 * - `~/.codex/skills/` for markdown SKILL.md files
 * - `~/.codex/agents/` for TOML agent files
 *
 * When an override directory is provided, that directory is scanned for
 * both markdown files (recursively) and TOML files (flat). This lets callers
 * point directly at a skills dir, an agents dir, or any custom location.
 *
 * @param codexDir - Optional override directory to scan.
 *                   When omitted, defaults to `~/.codex/skills/` + `~/.codex/agents/`.
 * @returns Array of ScannedCodexSkill objects, one per discovered file.
 */
export async function scanCodexSkills(codexDir?: string): Promise<ScannedCodexSkill[]> {
  const skills: ScannedCodexSkill[] = [];

  if (codexDir !== undefined) {
    // Override: scan only the given directory
    const mdFiles = await findMarkdownFiles(codexDir);
    for (const filePath of mdFiles) {
      const raw = await readFile(filePath, "utf-8");
      const name =
        basename(filePath, ".md")
          .replace(/^SKILL[._-]?/i, "")
          .replace(/[._]/g, "-")
          .toLowerCase() || basename(filePath, ".md").toLowerCase();
      skills.push({ path: filePath, name, raw, format: "markdown" });
    }

    const tomlFiles = await findTomlFiles(codexDir);
    for (const filePath of tomlFiles) {
      const raw = await readFile(filePath, "utf-8");
      const name = basename(filePath, ".toml").replace(/[._]/g, "-").toLowerCase();
      skills.push({ path: filePath, name, raw, format: "toml" });
    }

    return skills;
  }

  // Default: scan ~/.codex/skills/ (markdown) and ~/.codex/agents/ (TOML)
  const mdFiles = await findMarkdownFiles(DEFAULT_CODEX_SKILLS_DIR);
  for (const filePath of mdFiles) {
    const raw = await readFile(filePath, "utf-8");
    const name =
      basename(filePath, ".md")
        .replace(/^SKILL[._-]?/i, "")
        .replace(/[._]/g, "-")
        .toLowerCase() || basename(filePath, ".md").toLowerCase();
    skills.push({ path: filePath, name, raw, format: "markdown" });
  }

  const tomlFiles = await findTomlFiles(DEFAULT_CODEX_AGENTS_DIR);
  for (const filePath of tomlFiles) {
    const raw = await readFile(filePath, "utf-8");
    const name = basename(filePath, ".toml").replace(/[._]/g, "-").toLowerCase();
    skills.push({ path: filePath, name, raw, format: "toml" });
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
 * Parses a Codex agent TOML file or Codex SKILL.md into a ParsedCodexSkill.
 *
 * For TOML files:
 * - `name` from the `name` or `nickname_candidates[0]` field
 * - `description` from the `description` field
 * - instructions from `developer_instructions`
 * - metadata: model, reasoningEffort (model_reasoning_effort), sandboxMode (sandbox_mode), mcpServers (mcp_servers)
 *
 * For markdown files:
 * - Uses YAML frontmatter (same as Claude SKILL.md format)
 *
 * @param content - The raw file content.
 * @param sourcePath - The absolute path where the file was found.
 * @returns A ParsedCodexSkill with extracted frontmatter, instructions, and metadata.
 */
export function parseCodexSkill(content: string, sourcePath: string): ParsedCodexSkill {
  const ext = extname(sourcePath).toLowerCase();
  const filenameBase = basename(sourcePath, ext);
  const fallbackName = filenameBase.replace(/[._]/g, "-").toLowerCase();

  if (ext === ".toml") {
    let parsed: Record<string, unknown>;
    try {
      parsed = parseTOML(content);
    } catch {
      parsed = {};
    }

    // Derive name: prefer name field, then first nickname_candidate, then filename
    let name = fallbackName;
    if (typeof parsed["name"] === "string" && parsed["name"].length > 0) {
      name = parsed["name"];
    } else if (Array.isArray(parsed["nickname_candidates"]) && parsed["nickname_candidates"].length > 0) {
      const first = parsed["nickname_candidates"][0];
      if (typeof first === "string") {
        name = first;
      }
    }

    const description = typeof parsed["description"] === "string" ? parsed["description"] : "";
    const instructions = typeof parsed["developer_instructions"] === "string"
      ? parsed["developer_instructions"].trim()
      : "";

    const model = typeof parsed["model"] === "string" ? parsed["model"] : undefined;
    const reasoningEffort =
      typeof parsed["model_reasoning_effort"] === "string"
        ? parsed["model_reasoning_effort"]
        : undefined;
    const sandboxMode =
      typeof parsed["sandbox_mode"] === "string" ? parsed["sandbox_mode"] : undefined;
    const mcpServers = Array.isArray(parsed["mcp_servers"])
      ? (parsed["mcp_servers"] as unknown[]).filter((s): s is string => typeof s === "string")
      : undefined;

    const metadata =
      model !== undefined ||
      reasoningEffort !== undefined ||
      sandboxMode !== undefined ||
      mcpServers !== undefined
        ? { model, reasoningEffort, sandboxMode, mcpServers }
        : undefined;

    const frontmatter: SkillFrontmatter = {
      name,
      description,
      model,
    };

    return {
      frontmatter,
      instructions,
      sourcePath,
      metadata,
    };
  }

  // Markdown format — same as Claude SKILL.md
  const [rawFrontmatter, body] = extractFrontmatter(content);

  const mdFallbackName =
    basename(sourcePath, ".md")
      .replace(/^SKILL[._-]?/i, "")
      .replace(/[._]/g, "-")
      .toLowerCase() || basename(sourcePath, ".md").toLowerCase();

  const frontmatter: SkillFrontmatter = {
    name: typeof rawFrontmatter["name"] === "string" ? rawFrontmatter["name"] : mdFallbackName,
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
