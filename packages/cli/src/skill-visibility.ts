import { dirname } from "node:path";
import type { SkillRegistryEntry } from "@dantecode/skill-adapter";
import type { SkillRegistryEntryWithScope } from "@dantecode/skills-registry";

/**
 * Merge native SKILL.md discovery with installed SKILL.dc.md registry entries.
 * Imported skills only exist in the registry, so they need a synthetic
 * project-scope discovery record to appear in list views.
 */
export function mergeVisibleSkills(
  discovered: SkillRegistryEntryWithScope[],
  registered: SkillRegistryEntry[],
): SkillRegistryEntryWithScope[] {
  const visibleByName = new Map<string, SkillRegistryEntryWithScope>();

  for (const skill of discovered) {
    visibleByName.set(skill.name.toLowerCase(), {
      ...skill,
      entries: [...skill.entries],
    });
  }

  for (const skill of registered) {
    const key = skill.name.toLowerCase();
    if (visibleByName.has(key)) {
      continue;
    }

    visibleByName.set(key, {
      name: skill.name,
      winningScope: "project",
      entries: [
        {
          scope: "project",
          dirPath: dirname(skill.path),
          skillMdPath: skill.path,
          description: skill.description,
          disabled: false,
          wins: true,
        },
      ],
    });
  }

  return [...visibleByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
