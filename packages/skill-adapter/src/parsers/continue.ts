// ============================================================================
// @dantecode/skill-adapter — Continue.dev Agent Parser
// Scans .continue/agents/ for agent markdown files and parses their
// YAML frontmatter into the DanteCode skill format.
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
export interface ScannedContinueAgent {
  /** Absolute path to the agent file. */
  path: string;
  /** Derived agent name from filename. */
  name: string;
  /** Raw file content. */
  raw: string;
}

/** Fully parsed Continue.dev agent with frontmatter and instruction body. */
export interface ParsedContinueAgent {
  frontmatter: SkillFrontmatter;
  instructions: string;
  sourcePath: string;
}

// ----------------------------------------------------------------------------
// Default Directory
// ----------------------------------------------------------------------------

const DEFAULT_CONTINUE_AGENTS_DIR = join(homedir(), ".continue", "agents");

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
 * Scans the Continue.dev agents directory for agent markdown files.
 *
 * Continue.dev stores agent definitions as markdown files with YAML
 * frontmatter in `~/.continue/agents/`. Each file defines one agent
 * with a name, description, and optional tools list.
 *
 * @param continueDir - Optional override for the agents directory.
 *                       Defaults to `~/.continue/agents/`.
 * @returns Array of ScannedContinueAgent objects, one per discovered file.
 */
export async function scanContinueAgents(continueDir?: string): Promise<ScannedContinueAgent[]> {
  const dir = continueDir ?? DEFAULT_CONTINUE_AGENTS_DIR;
  const files = await findMarkdownFiles(dir);
  const agents: ScannedContinueAgent[] = [];

  for (const filePath of files) {
    const raw = await readFile(filePath, "utf-8");
    const name = basename(filePath, ".md").replace(/[._]/g, "-").toLowerCase();

    agents.push({ path: filePath, name, raw });
  }

  return agents;
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
 * Parses a Continue.dev agent markdown file into structured frontmatter
 * and instruction body.
 *
 * Continue.dev agents use YAML frontmatter with:
 * - `name`: agent name
 * - `description`: agent description
 * - `tools`: array of tool identifiers the agent can use
 *
 * Everything after the closing `---` delimiter is treated as the
 * instruction body, returned verbatim.
 *
 * @param content - The raw markdown file content.
 * @param sourcePath - The absolute path where the file was found.
 * @returns A ParsedContinueAgent with extracted frontmatter and instructions.
 */
export function parseContinueAgent(content: string, sourcePath: string): ParsedContinueAgent {
  const [rawFrontmatter, body] = extractFrontmatter(content);

  const fallbackName = basename(sourcePath, ".md").replace(/[._]/g, "-").toLowerCase();

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
