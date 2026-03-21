/**
 * stats.ts
 *
 * Skillbook statistics aggregation.
 */

import type { Skill, SkillbookStats } from "./types.js";

/**
 * Compute stats from a list of skills.
 */
export function computeStats(skills: Skill[]): SkillbookStats {
  const sections: Record<string, number> = {};
  let lastUpdatedAt: string | undefined;

  for (const skill of skills) {
    sections[skill.section] = (sections[skill.section] ?? 0) + 1;
    if (!lastUpdatedAt || skill.updatedAt > lastUpdatedAt) {
      lastUpdatedAt = skill.updatedAt;
    }
  }

  return {
    totalSkills: skills.length,
    sections,
    lastUpdatedAt,
  };
}
