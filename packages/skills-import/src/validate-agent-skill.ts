import type { AgentSkillParsed } from "./parse-skill-md.js";

export interface SkillValidationError {
  code: string; // SKILL-001..SKILL-010
  message: string;
  field?: string;
}

export interface SkillValidationWarning {
  code: string;
  message: string;
}

export interface SkillValidationResult {
  valid: boolean;
  errors: SkillValidationError[];
  warnings: SkillValidationWarning[];
}

/**
 * Validate a parsed AgentSkillParsed:
 * - SKILL-002 if name is missing or empty
 * - SKILL-003 if description is missing or empty
 * - Warning if allowed-tools is present (advisory/experimental per spec)
 * - Warning if instructions body is very short (<20 chars)
 */
export function validateAgentSkill(skill: AgentSkillParsed): SkillValidationResult {
  const errors: SkillValidationError[] = [];
  const warnings: SkillValidationWarning[] = [];

  // SKILL-002: name required
  if (!skill.name || skill.name.trim() === "") {
    errors.push({
      code: "SKILL-002",
      message: "Skill name is required and must not be empty",
      field: "name",
    });
  }

  // SKILL-003: description required
  if (!skill.description || skill.description.trim() === "") {
    errors.push({
      code: "SKILL-003",
      message: "Skill description is required and must not be empty",
      field: "description",
    });
  }

  // Advisory warning for allowed-tools
  if (skill.allowedTools && skill.allowedTools.length > 0) {
    warnings.push({
      code: "SKILL-WARN-001",
      message: "allowed-tools is advisory only — it does not grant execution authority",
    });
  }

  // Warning for very short instructions
  if (skill.instructions.length < 20) {
    warnings.push({
      code: "SKILL-WARN-002",
      message: "Instructions body is very short (<20 chars) — consider providing more detail",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
