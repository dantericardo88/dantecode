import { parseFrontmatter, extractBody } from "./parse-frontmatter.js";

export interface AgentSkillParsed {
  name: string;
  description: string;
  compatibility?: string[];
  allowedTools?: string[]; // from "allowed-tools" frontmatter key
  license?: string;
  metadata?: Record<string, unknown>;
  instructions: string; // Body after frontmatter
  hasScripts: boolean; // Whether scripts/ dir exists (checked by caller)
  hasReferences: boolean; // Whether references/ dir exists
  hasAssets: boolean; // Whether assets/ dir exists
  sourcePath: string; // Absolute path to SKILL.md
}

export interface SkillParseError {
  code: string; // SKILL-001 | SKILL-002 | SKILL-003
  message: string;
  field?: string;
}

export type ParseSkillResult =
  | { ok: true; skill: AgentSkillParsed }
  | { ok: false; errors: SkillParseError[] };

/**
 * Parse SKILL.md from a string (content) and metadata about optional dirs.
 * Returns ok:false with structured errors for missing required fields.
 */
export function parseSkillMd(
  content: string,
  sourcePath: string,
  opts?: {
    hasScripts?: boolean;
    hasReferences?: boolean;
    hasAssets?: boolean;
  },
): ParseSkillResult {
  const errors: SkillParseError[] = [];

  // Parse frontmatter
  const fmResult = parseFrontmatter(content);
  if (!fmResult.ok) {
    return {
      ok: false,
      errors: [
        {
          code: "SKILL-001",
          message: `Frontmatter parse error: ${fmResult.error}`,
        },
      ],
    };
  }

  const fm = fmResult.data;

  // Validate required fields
  const name = typeof fm["name"] === "string" ? fm["name"].trim() : undefined;
  if (!name) {
    errors.push({
      code: "SKILL-002",
      message: "Missing required field: name",
      field: "name",
    });
  }

  const description = typeof fm["description"] === "string" ? fm["description"].trim() : undefined;
  if (!description) {
    errors.push({
      code: "SKILL-003",
      message: "Missing required field: description",
      field: "description",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Extract optional fields
  const compatibility = Array.isArray(fm["compatibility"])
    ? (fm["compatibility"] as string[])
    : undefined;

  const allowedTools = Array.isArray(fm["allowed-tools"])
    ? (fm["allowed-tools"] as string[])
    : undefined;

  const license = typeof fm["license"] === "string" ? fm["license"] : undefined;

  // Extract metadata (all other keys not consumed above)
  const knownKeys = new Set(["name", "description", "compatibility", "allowed-tools", "license"]);
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (!knownKeys.has(k)) {
      metadata[k] = v;
    }
  }

  // Extract body (instructions)
  const instructions = extractBody(content).trim();

  return {
    ok: true,
    skill: {
      name: name!,
      description: description!,
      compatibility,
      allowedTools,
      license,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      instructions,
      hasScripts: opts?.hasScripts ?? false,
      hasReferences: opts?.hasReferences ?? false,
      hasAssets: opts?.hasAssets ?? false,
      sourcePath,
    },
  };
}
