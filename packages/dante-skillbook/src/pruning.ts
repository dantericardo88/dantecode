/**
 * pruning.ts
 *
 * Skill pruning layer — removes stale, low-value, or excess skills.
 * Keeps the skillbook clean and token-efficient.
 */

import type { Skill } from "./types.js";

export interface PruningPolicy {
  /** Max skills per section. Default: 20. */
  maxPerSection?: number;
  /** Minimum trust score to keep (0 = keep all). Default: 0. */
  minTrustScore?: number;
  /** Max age in days before a skill is considered stale. 0 = no age limit. Default: 0. */
  maxAgeDays?: number;
  /** Max total skills. Default: 200. */
  maxTotal?: number;
}

const DEFAULT_POLICY: Required<PruningPolicy> = {
  maxPerSection: 20,
  minTrustScore: 0,
  maxAgeDays: 0,
  maxTotal: 200,
};

/**
 * Apply pruning policy to a list of skills.
 * Returns the pruned list (survivors only).
 */
export function pruneSkills(skills: Skill[], policy: PruningPolicy = {}): Skill[] {
  const p: Required<PruningPolicy> = { ...DEFAULT_POLICY, ...policy };
  const now = Date.now();
  const maxAgeMs = p.maxAgeDays > 0 ? p.maxAgeDays * 24 * 60 * 60 * 1000 : 0;

  // 1. Filter by trust score
  let survivors = skills.filter((s) => {
    if (p.minTrustScore > 0 && (s.trustScore ?? 1) < p.minTrustScore) return false;
    return true;
  });

  // 2. Filter by age
  if (maxAgeMs > 0) {
    survivors = survivors.filter((s) => {
      const age = now - new Date(s.updatedAt).getTime();
      return age <= maxAgeMs;
    });
  }

  // 3. Cap per section — keep highest trust within each section
  const bySection: Map<string, Skill[]> = new Map();
  for (const skill of survivors) {
    const list = bySection.get(skill.section) ?? [];
    list.push(skill);
    bySection.set(skill.section, list);
  }

  const afterSectionCap: Skill[] = [];
  for (const [, list] of bySection) {
    const sorted = list.sort((a, b) => (b.trustScore ?? 0.5) - (a.trustScore ?? 0.5));
    afterSectionCap.push(...sorted.slice(0, p.maxPerSection));
  }

  // 4. Global cap — keep most recently updated
  const afterGlobalCap = afterSectionCap
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, p.maxTotal);

  return afterGlobalCap;
}
