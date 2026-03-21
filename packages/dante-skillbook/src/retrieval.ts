/**
 * retrieval.ts
 *
 * Skill retrieval layer — selects top-K relevant skills for a task.
 * Prevents token bloat by never injecting the entire skillbook.
 */

import type { Skill, TaskContext } from "./types.js";

/** Simple Jaccard similarity between two token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length >= 2),
  );
}

export interface ScoredSkill {
  skill: Skill;
  score: number;
}

/**
 * Score a skill against a task context.
 */
export function scoreSkill(skill: Skill, context: TaskContext, keywords: string[]): number {
  const taskTokens = tokenize(keywords.join(" "));
  const skillTokens = tokenize(`${skill.title} ${skill.content} ${skill.section}`);
  let score = jaccard(taskTokens, skillTokens);

  // Boost by trust score
  if (skill.trustScore !== undefined) {
    score *= 0.7 + 0.3 * skill.trustScore;
  }

  // Penalize mismatched task type
  if (context.taskType && skill.section && !skill.section.includes(context.taskType)) {
    score *= 0.9; // slight penalty
  }

  return score;
}

/**
 * Retrieve the top-K most relevant skills for a task context.
 */
export function getRelevantSkills(skills: Skill[], context: TaskContext, limit = 5): Skill[] {
  const keywords = [...(context.keywords ?? []), context.taskType ?? ""].filter(Boolean);

  if (keywords.length === 0) {
    // No context — return most recent skills up to limit
    return [...skills].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }

  const scored: ScoredSkill[] = skills.map((skill) => ({
    skill,
    score: scoreSkill(skill, context, keywords),
  }));

  const sorted = scored.sort((a, b) => b.score - a.score);

  // If the best score is zero, no skill is relevant — return empty.
  if (sorted.length === 0 || (sorted[0]?.score ?? 0) === 0) return [];

  return sorted.slice(0, limit).map((s) => s.skill);
}
