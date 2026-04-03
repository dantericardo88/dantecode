// ============================================================================
// @dantecode/skills-policy — compatibility mapper
//
// Maps the `compatibility` field from a SKILL.md to a CompatibilityResult.
// Absence of compatibility list = compatible with all (liberal default).
// "claude" must be present for native Dante execution.
// Unknown agents → SKILL-005 advisory warning (not a blocking error).
// ============================================================================

/** Agents Dante considers known/supported. */
export const KNOWN_AGENTS = new Set([
  "claude",
  "codex",
  "cursor",
  "gemini",
  "qwen",
  "continue",
  "opencode",
  "aider",
  "cody",
  "copilot",
]);

export interface CompatibilityResult {
  /** True if Dante can run this skill (claude is listed, or list is empty). */
  compatible: boolean;
  /** True if the compatibility list is absent (permissive default). */
  openCompat: boolean;
  /** Agents from the list that are not in KNOWN_AGENTS. */
  unknownAgents: string[];
  /** SKILL-005 advisory warnings (one per unknown agent). */
  warnings: CompatibilityWarning[];
}

export interface CompatibilityWarning {
  code: "SKILL-005";
  message: string;
  /** The unknown agent that triggered the warning. */
  agent: string;
}

/**
 * Maps a skill's `compatibility` list to a CompatibilityResult.
 *
 * Rules:
 * - No list (undefined/empty) → openCompat: true, compatible: true
 * - List present and includes "claude" → compatible: true
 * - List present but missing "claude" → compatible: false
 * - Unknown agents in list → SKILL-005 advisory warning (not blocking)
 *
 * @param compatibility - The compatibility array from SKILL.md, or undefined.
 */
export function mapCompatibilityToPolicy(compatibility: string[] | undefined): CompatibilityResult {
  if (!compatibility || compatibility.length === 0) {
    return { compatible: true, openCompat: true, unknownAgents: [], warnings: [] };
  }

  const unknownAgents: string[] = [];
  const warnings: CompatibilityWarning[] = [];

  for (const agent of compatibility) {
    if (!KNOWN_AGENTS.has(agent.toLowerCase())) {
      unknownAgents.push(agent);
      warnings.push({
        code: "SKILL-005",
        message: `Unknown agent "${agent}" in compatibility list — compatibility preflight advisory`,
        agent,
      });
    }
  }

  const normalizedList = compatibility.map((a) => a.toLowerCase());
  const compatible = normalizedList.includes("claude");

  return { compatible, openCompat: false, unknownAgents, warnings };
}
