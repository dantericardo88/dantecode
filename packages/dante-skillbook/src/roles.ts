/**
 * roles.ts
 *
 * DanteAgent, DanteReflector, DanteSkillManager role implementations.
 * Each role produces structured output for the next stage.
 * Model routing hooks are exposed for future model-router integration.
 */

import type { Skill, TaskResult, UpdateOperation } from "./types.js";
import {
  buildAgentPrompt,
  buildReflectorPrompt,
  buildSkillManagerPrompt,
  AGENT_SYSTEM_PROMPT,
  REFLECTOR_SYSTEM_PROMPT,
  SKILL_MANAGER_SYSTEM_PROMPT,
} from "./prompts.js";

// ────────────────────────────────────────────────────────
// Role interfaces
// ────────────────────────────────────────────────────────

export interface AgentRoleInput {
  task: string;
  relevantSkills: Skill[];
}

export interface AgentRoleOutput {
  systemPrompt: string;
  userPrompt: string;
  /** Hint for model-router: which model class to use. */
  modelHint: "primary" | "fast";
}

export interface ReflectorInput {
  taskResult: TaskResult;
}

export interface ReflectorOutput {
  systemPrompt: string;
  userPrompt: string;
  modelHint: "primary" | "fast";
}

export interface SkillManagerInput {
  reflectionText: string;
  existingSkillIds: string[];
}

export interface SkillManagerOutput {
  systemPrompt: string;
  userPrompt: string;
  modelHint: "primary" | "fast";
  /** Parsed update proposals — populated after LLM call and JSON parse. */
  parsedProposals?: UpdateOperation[];
}

// ────────────────────────────────────────────────────────
// Role builders
// ────────────────────────────────────────────────────────

/**
 * Build DanteAgent prompt payload.
 * Call this before sending the prompt to the LLM.
 */
export function buildAgentRole(input: AgentRoleInput): AgentRoleOutput {
  return {
    systemPrompt: AGENT_SYSTEM_PROMPT,
    userPrompt: buildAgentPrompt(input.task, input.relevantSkills),
    modelHint: "primary",
  };
}

/**
 * Build DanteReflector prompt payload.
 */
export function buildReflectorRole(input: ReflectorInput): ReflectorOutput {
  const { taskResult } = input;
  return {
    systemPrompt: REFLECTOR_SYSTEM_PROMPT,
    userPrompt: buildReflectorPrompt({
      task: taskResult.summary,
      outcome: taskResult.outcome,
      summary: taskResult.summary,
      evidence: taskResult.evidence,
    }),
    modelHint: "fast",
  };
}

/**
 * Build DanteSkillManager prompt payload.
 */
export function buildSkillManagerRole(input: SkillManagerInput): SkillManagerOutput {
  return {
    systemPrompt: SKILL_MANAGER_SYSTEM_PROMPT,
    userPrompt: buildSkillManagerPrompt({
      reflectionText: input.reflectionText,
      existingSkillIds: input.existingSkillIds,
    }),
    modelHint: "fast",
  };
}

/**
 * Attempt to parse LLM output as UpdateOperation[].
 * Returns [] if the output cannot be parsed.
 */
export function parseSkillManagerOutput(rawOutput: string): UpdateOperation[] {
  // Extract JSON array from the output
  const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Basic validation: each item must have action field
    return (parsed as UpdateOperation[]).filter(
      (item): item is UpdateOperation =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).action === "string" &&
        typeof (item as Record<string, unknown>).rationale === "string",
    );
  } catch {
    return [];
  }
}
