// ============================================================================
// @dantecode/skills-export — Skill SKILL.md Renderer
// Renders a DanteCode-native skill into Agent Skills-compatible SKILL.md format.
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface RenderableSkill {
  name: string;
  description: string;
  license?: string;
  compatibility?: string[];
  /** Maps to "allowed-tools:" in frontmatter */
  allowedTools?: string[];
  instructions: string;
  /** Extra frontmatter fields (only included when includeMetadata=true) */
  metadata?: Record<string, unknown>;
}

export interface RenderOptions {
  /** Default: true — include allowed-tools if present */
  includeAllowedTools?: boolean;
  /** Default: true — include compatibility if present */
  includeCompatibility?: boolean;
  /** Default: false — Dante-specific metadata may not transfer cleanly */
  includeMetadata?: boolean;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Render a YAML scalar value. Strings that contain special YAML characters
 * are quoted; otherwise returned as-is.
 */
function renderScalar(value: string): string {
  // Quote if contains colon-space, leading/trailing whitespace, or special chars
  if (
    /[:{}\[\],#|>&*!'"@%]/.test(value) ||
    value !== value.trim() ||
    value === "" ||
    /^[-?|>!'"%@`]/.test(value)
  ) {
    // Use double-quoted string, escaping inner double quotes
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Render a YAML array in block form:
 *   key:
 *     - item1
 *     - item2
 */
function renderYamlArray(key: string, items: string[]): string {
  const lines = items.map((item) => `  - ${renderScalar(item)}`);
  return `${key}:\n${lines.join("\n")}`;
}

// ----------------------------------------------------------------------------
// Main Renderer
// ----------------------------------------------------------------------------

/**
 * Render a skill to Agent Skills-compatible SKILL.md format.
 *
 * Produces YAML frontmatter between `---` delimiters followed by the
 * instructions body. The output format is:
 *
 * ```
 * ---
 * name: My Skill
 * description: What this skill does
 * license: MIT
 * compatibility:
 *   - claude
 *   - codex
 * allowed-tools:
 *   - Read
 *   - Write
 * ---
 *
 * [Instructions body]
 * ```
 *
 * @param skill - The skill data to render.
 * @param opts  - Rendering options controlling which sections are included.
 * @returns     The complete SKILL.md string.
 */
export function renderSkillMd(skill: RenderableSkill, opts?: RenderOptions): string {
  const includeAllowedTools = opts?.includeAllowedTools ?? true;
  const includeCompatibility = opts?.includeCompatibility ?? true;
  const includeMetadata = opts?.includeMetadata ?? false;

  const frontmatterLines: string[] = [];

  // Required fields — always present
  frontmatterLines.push(`name: ${renderScalar(skill.name)}`);
  frontmatterLines.push(`description: ${renderScalar(skill.description)}`);

  // Optional scalar: license
  if (skill.license !== undefined) {
    frontmatterLines.push(`license: ${renderScalar(skill.license)}`);
  }

  // Optional array: compatibility
  if (includeCompatibility && skill.compatibility !== undefined && skill.compatibility.length > 0) {
    frontmatterLines.push(renderYamlArray("compatibility", skill.compatibility));
  }

  // Optional array: allowed-tools (uses hyphenated YAML key per Agent Skills spec)
  if (includeAllowedTools && skill.allowedTools !== undefined && skill.allowedTools.length > 0) {
    frontmatterLines.push(renderYamlArray("allowed-tools", skill.allowedTools));
  }

  // Optional extra metadata (Dante-specific fields)
  if (includeMetadata && skill.metadata !== undefined) {
    for (const [key, value] of Object.entries(skill.metadata)) {
      if (typeof value === "string") {
        frontmatterLines.push(`${key}: ${renderScalar(value)}`);
      } else if (Array.isArray(value)) {
        const strItems = value.filter((v): v is string => typeof v === "string");
        if (strItems.length > 0) {
          frontmatterLines.push(renderYamlArray(key, strItems));
        }
      } else if (value !== null && value !== undefined) {
        frontmatterLines.push(`${key}: ${String(value)}`);
      }
    }
  }

  const frontmatter = `---\n${frontmatterLines.join("\n")}\n---`;
  // Blank line between frontmatter and body, trailing newline
  return `${frontmatter}\n\n${skill.instructions}\n`;
}
