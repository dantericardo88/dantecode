import { describe, expect, it } from "vitest";
import type { SkillRegistryEntry } from "@dantecode/skill-adapter";
import type { SkillRegistryEntryWithScope } from "@dantecode/skills-registry";
import { mergeVisibleSkills } from "./skill-visibility.js";

describe("mergeVisibleSkills", () => {
  it("adds registry-only imported skills to the visible discovery view", () => {
    const discovered: SkillRegistryEntryWithScope[] = [];
    const registered: SkillRegistryEntry[] = [
      {
        name: "Sample Refactor Skill",
        description: "Imported wrapper",
        importSource: "claude",
        adapterVersion: "1.0.0",
        wrappedAt: "2026-03-27T00:00:00.000Z",
        path: "/project/.dantecode/skills/sample-refactor-skill/SKILL.dc.md",
      },
    ];

    const visible = mergeVisibleSkills(discovered, registered);

    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      name: "Sample Refactor Skill",
      winningScope: "project",
    });
    expect(visible[0]?.entries[0]).toMatchObject({
      scope: "project",
      skillMdPath: "/project/.dantecode/skills/sample-refactor-skill/SKILL.dc.md",
      wins: true,
    });
  });

  it("keeps discovered skills intact when they already exist in the visible set", () => {
    const discovered: SkillRegistryEntryWithScope[] = [
      {
        name: "Sample Refactor Skill",
        winningScope: "project",
        entries: [
          {
            scope: "project",
            dirPath: "/project/.dantecode/skills/sample-refactor-skill",
            skillMdPath: "/project/.dantecode/skills/sample-refactor-skill/SKILL.md",
            description: "Native skill",
            disabled: false,
            wins: true,
          },
        ],
      },
    ];
    const registered: SkillRegistryEntry[] = [
      {
        name: "Sample Refactor Skill",
        description: "Imported wrapper",
        importSource: "claude",
        adapterVersion: "1.0.0",
        wrappedAt: "2026-03-27T00:00:00.000Z",
        path: "/project/.dantecode/skills/sample-refactor-skill/SKILL.dc.md",
      },
    ];

    const visible = mergeVisibleSkills(discovered, registered);

    expect(visible).toHaveLength(1);
    expect(visible[0]?.entries).toHaveLength(1);
    expect(visible[0]?.entries[0]?.skillMdPath).toBe(
      "/project/.dantecode/skills/sample-refactor-skill/SKILL.md",
    );
  });
});
