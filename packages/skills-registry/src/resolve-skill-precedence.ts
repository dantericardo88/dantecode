// ============================================================================
// @dantecode/skills-registry — Skill Precedence Resolution
// Resolves which skill entry wins when multiple scopes define the same name.
// ============================================================================

import type { SkillEntry, SkillScope } from "./discover-skills.js";

// Scope priority: project=1 (highest), user=2, compat=3 (lowest)
const SCOPE_PRIORITY: Record<SkillScope, number> = {
  project: 1,
  user: 2,
  compat: 3,
};

/**
 * Given a list of entries (possibly from multiple scopes),
 * return the resolved list where each name appears exactly once,
 * winning entry is the highest-priority scope.
 *
 * Does NOT silently drop collisions — callers should check registry.getCollisions().
 * This function resolves which one WINS, not whether a collision exists.
 *
 * Disabled entries are preserved (not filtered here — callers do that).
 */
export function resolveSkillPrecedence(entries: SkillEntry[]): SkillEntry[] {
  const byName = new Map<string, SkillEntry>();

  for (const entry of entries) {
    const existing = byName.get(entry.name);
    if (existing === undefined) {
      byName.set(entry.name, entry);
    } else {
      // Keep the higher-priority scope (lower number = higher priority)
      const existingPriority = SCOPE_PRIORITY[existing.scope];
      const newPriority = SCOPE_PRIORITY[entry.scope];
      if (newPriority < existingPriority) {
        byName.set(entry.name, entry);
      }
    }
  }

  return Array.from(byName.values());
}
