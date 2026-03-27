// ============================================================================
// @dantecode/skills-registry — Skill Discovery with Scope Visibility
// ============================================================================

import type { DiscoveryOptions } from "./discover-skills.js";
import { discoverSkills } from "./discover-skills.js";
import { SkillRegistry } from "./skill-registry.js";

/**
 * Discover skills from all scopes and return deterministic, visible view.
 * Shows which skills are available, from which scopes, and their precedence.
 */
export async function discoverSkillsWithScopes(opts: DiscoveryOptions) {
  const discovered = await discoverSkills(opts);
  const registry = new SkillRegistry();
  registry.register(discovered);

  return registry.listWithScopes();
}
