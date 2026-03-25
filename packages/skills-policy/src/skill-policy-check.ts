// ============================================================================
// @dantecode/skills-policy — runSkillPolicyCheck
//
// Runs a full policy check for a skill before execution.
// SKILL-004: blocking — unsupported tool in allowed-tools list
// SKILL-005: advisory — compatibility preflight failed (not blocking)
//
// Design: mapAllowedTools is advisory input, NOT blind authority.
// A SKILL-004 blocks execution because the skill explicitly requires
// a tool Dante cannot provide — that's a genuine capability mismatch.
// ============================================================================

import { mapAllowedToolsToPolicy } from "./map-allowed-tools.js";
import type { AllowedToolsMappingResult } from "./map-allowed-tools.js";
import { mapCompatibilityToPolicy } from "./map-compatibility.js";
import type { CompatibilityResult, CompatibilityWarning } from "./map-compatibility.js";

export interface PolicyCheckInput {
  /** From SKILL.md allowed-tools (may be undefined if not present). */
  allowedTools?: string[];
  /** From SKILL.md compatibility (may be undefined if not present). */
  compatibility?: string[];
}

export interface PolicyError {
  code: "SKILL-004";
  message: string;
  tool: string;
}

export interface PolicyCheckResult {
  /** False when any blocking error is present. */
  passed: boolean;
  /** Blocking errors that prevent skill execution. */
  errors: PolicyError[];
  /** Advisory warnings (don't block execution). */
  warnings: CompatibilityWarning[];
  /** Raw result from allowed-tools mapping. */
  toolsMapping: AllowedToolsMappingResult;
  /** Raw result from compatibility mapping. */
  compatMapping: CompatibilityResult;
}

/**
 * Run a full policy check for a skill.
 *
 * SKILL-004 is BLOCKING — unsupported tool in allowed-tools list
 * means the skill explicitly requires a capability Dante cannot provide.
 *
 * SKILL-005 is ADVISORY — unknown agent in compatibility list.
 * It does not block execution but surfaces a preflight warning.
 *
 * @param input - allowed-tools and compatibility from SKILL.md.
 */
export function runSkillPolicyCheck(input: PolicyCheckInput): PolicyCheckResult {
  const toolsMapping = mapAllowedToolsToPolicy(input.allowedTools ?? []);
  const compatMapping = mapCompatibilityToPolicy(input.compatibility);

  const errors: PolicyError[] = [];

  // SKILL-004: block on each unsupported tool
  for (const tool of toolsMapping.unsupportedTools) {
    errors.push({
      code: "SKILL-004",
      message: `Unsupported tool "${tool}" in allowed-tools — Dante cannot provide this tool (SKILL-004)`,
      tool,
    });
  }

  // SKILL-005 warnings from compatibility mapping (advisory, non-blocking)
  const warnings = [...compatMapping.warnings];

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    toolsMapping,
    compatMapping,
  };
}
