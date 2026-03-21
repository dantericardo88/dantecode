/**
 * prompts.ts
 *
 * Role-specific prompt assembly for DanteAgent, DanteReflector, DanteSkillManager.
 * Injects top-K relevant skills into prompts without token bloat.
 */

import type { Skill } from "./types.js";

// ────────────────────────────────────────────────────────
// System prompts for each role
// ────────────────────────────────────────────────────────

export const AGENT_SYSTEM_PROMPT = `You are DanteAgent, an expert coding and research agent.
You have access to a curated DanteSkillbook of verified strategies.
Always apply relevant skills from the Skillbook when they match the current task.
Produce concrete, evidence-backed results. Never produce stubs or placeholders.`;

export const REFLECTOR_SYSTEM_PROMPT = `You are DanteReflector, a critical analyst of completed tasks.
Your job is to identify what worked, what failed, what strategy proved reusable, and what should be avoided next time.
Be specific and evidence-grounded. Extract concrete lessons that can improve future runs.
Do NOT praise trivial successes — focus on meaningful, durable insights.`;

export const SKILL_MANAGER_SYSTEM_PROMPT = `You are DanteSkillManager, a governed curator of the DanteSkillbook.
You receive reflection outputs and produce structured update proposals.
Actions available: add (new skill), refine (improve existing), remove (stale/wrong), merge (combine overlapping), reject (not strategy-worthy).
Every proposal must include a rationale. Quality over quantity — prefer fewer, higher-trust updates.
DanteForge will gate every proposal before it reaches the Skillbook.`;

// ────────────────────────────────────────────────────────
// Skill injection helpers
// ────────────────────────────────────────────────────────

/**
 * Format a list of skills into a concise injection block.
 */
export function formatSkillsBlock(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const lines: string[] = ["## Relevant Skills from DanteSkillbook\n"];
  for (const skill of skills) {
    lines.push(`### ${skill.title} (section: ${skill.section})`);
    lines.push(skill.content);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Build the agent prompt with injected skills.
 */
export function buildAgentPrompt(task: string, relevantSkills: Skill[]): string {
  const skillsBlock = formatSkillsBlock(relevantSkills);
  return skillsBlock
    ? `${skillsBlock}\n---\n\n## Task\n\n${task}`
    : `## Task\n\n${task}`;
}

/**
 * Build the reflector prompt for a completed task.
 */
export function buildReflectorPrompt(opts: {
  task: string;
  outcome: string;
  summary: string;
  evidence?: string[];
}): string {
  const { task, outcome, summary, evidence } = opts;
  const evidenceBlock = evidence?.length
    ? `\n## Evidence\n\n${evidence.map(e => `- ${e}`).join("\n")}`
    : "";
  return `## Task\n\n${task}\n\n## Outcome\n\n${outcome}\n\n## Summary\n\n${summary}${evidenceBlock}\n\n---\n\nPlease reflect on this task execution. What worked, what failed, what strategy is reusable?`;
}

/**
 * Build the skill-manager prompt for converting reflection into update proposals.
 */
export function buildSkillManagerPrompt(opts: {
  reflectionText: string;
  existingSkillIds: string[];
}): string {
  const { reflectionText, existingSkillIds } = opts;
  const idsBlock = existingSkillIds.length
    ? `\n## Existing Skill IDs (for refine/remove/merge actions)\n\n${existingSkillIds.join(", ")}`
    : "";
  return `## Reflection Output\n\n${reflectionText}${idsBlock}\n\n---\n\nBased on this reflection, propose structured Skillbook update operations. Return a JSON array of UpdateOperation objects with fields: action, targetSkillId?, candidateSkill?, rationale.`;
}
