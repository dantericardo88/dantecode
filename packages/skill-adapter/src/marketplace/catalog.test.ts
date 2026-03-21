import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillCatalog } from "./catalog.js";
import type { CatalogEntry } from "./catalog.js";

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    name: "test-skill",
    description: "A test skill for catalog testing",
    source: "claude",
    sourcePath: "/test/SKILL.md",
    installedPath: "/test/.dantecode/skills/test-skill",
    version: "1.0.0",
    tags: ["testing", "automation"],
    verificationScore: 90,
    verificationTier: "sovereign",
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("SkillCatalog", () => {
  it("1. upsert + get round-trip", () => {
    const catalog = new SkillCatalog("/fake/root");
    const entry = makeEntry();
    catalog.upsert(entry);
    const fetched = catalog.get("test-skill");
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("test-skill");
    expect(fetched?.description).toBe("A test skill for catalog testing");
    expect(fetched?.version).toBe("1.0.0");
  });

  it("2. search finds by name and description", () => {
    const catalog = new SkillCatalog("/fake/root");
    catalog.upsert(makeEntry({ name: "alpha-skill", description: "An alpha testing tool" }));
    catalog.upsert(makeEntry({ name: "beta-skill", description: "A beta deployment skill" }));

    const byName = catalog.search("alpha");
    expect(byName.length).toBe(1);
    expect(byName[0]!.name).toBe("alpha-skill");

    const byDesc = catalog.search("deployment");
    expect(byDesc.length).toBe(1);
    expect(byDesc[0]!.name).toBe("beta-skill");

    const all = catalog.search("");
    expect(all.length).toBe(2);
  });

  it("3. filterByTag returns only matching entries", () => {
    const catalog = new SkillCatalog("/fake/root");
    catalog.upsert(makeEntry({ name: "skill-a", tags: ["security", "testing"] }));
    catalog.upsert(makeEntry({ name: "skill-b", tags: ["automation"] }));
    catalog.upsert(makeEntry({ name: "skill-c", tags: ["security", "automation"] }));

    const securitySkills = catalog.filterByTag("security");
    expect(securitySkills.length).toBe(2);
    expect(securitySkills.map((e) => e.name).sort()).toEqual(["skill-a", "skill-c"]);

    const automationSkills = catalog.filterByTag("automation");
    expect(automationSkills.length).toBe(2);
  });

  it("4. filterBySource returns only matching source entries", () => {
    const catalog = new SkillCatalog("/fake/root");
    catalog.upsert(makeEntry({ name: "claude-skill", source: "claude" }));
    catalog.upsert(makeEntry({ name: "codex-skill", source: "codex" }));
    catalog.upsert(makeEntry({ name: "claude-skill-2", source: "claude" }));

    const claudeSkills = catalog.filterBySource("claude");
    expect(claudeSkills.length).toBe(2);
    expect(claudeSkills.every((e) => e.source === "claude")).toBe(true);

    const codexSkills = catalog.filterBySource("codex");
    expect(codexSkills.length).toBe(1);
    expect(codexSkills[0]!.name).toBe("codex-skill");
  });

  it("5. remove returns true on found entry, false on missing", () => {
    const catalog = new SkillCatalog("/fake/root");
    catalog.upsert(makeEntry({ name: "removable-skill" }));

    expect(catalog.get("removable-skill")).not.toBeNull();
    const removed = catalog.remove("removable-skill");
    expect(removed).toBe(true);
    expect(catalog.get("removable-skill")).toBeNull();

    const removedAgain = catalog.remove("removable-skill");
    expect(removedAgain).toBe(false);
  });

  it("5b. filterByTier('guardian') returns only guardian entries", () => {
    const catalog = new SkillCatalog("/fake/root");
    catalog.upsert(makeEntry({ name: "g-skill", verificationTier: "guardian" }));
    catalog.upsert(makeEntry({ name: "s-skill", verificationTier: "sentinel" }));
    catalog.upsert(makeEntry({ name: "v-skill", verificationTier: "sovereign" }));

    const result = catalog.filterByTier("guardian");
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("g-skill");
  });

  it("5c. filterByTier('sovereign') returns only sovereign entries", () => {
    const catalog = new SkillCatalog("/fake/root");
    catalog.upsert(makeEntry({ name: "g-skill", verificationTier: "guardian" }));
    catalog.upsert(makeEntry({ name: "s-skill", verificationTier: "sentinel" }));
    catalog.upsert(makeEntry({ name: "v-skill", verificationTier: "sovereign" }));

    const result = catalog.filterByTier("sovereign");
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("v-skill");
  });

  it("5d. filterByTierMinimum('sentinel') returns sentinel + sovereign entries", () => {
    const catalog = new SkillCatalog("/fake/root");
    catalog.upsert(makeEntry({ name: "g-skill", verificationTier: "guardian" }));
    catalog.upsert(makeEntry({ name: "s-skill", verificationTier: "sentinel" }));
    catalog.upsert(makeEntry({ name: "v-skill", verificationTier: "sovereign" }));

    const result = catalog.filterByTierMinimum("sentinel");
    expect(result.length).toBe(2);
    const names = result.map((e) => e.name).sort();
    expect(names).toEqual(["s-skill", "v-skill"]);
  });

  it("5e. filterByTierMinimum('guardian') returns all entries that have a tier", () => {
    const catalog = new SkillCatalog("/fake/root");
    catalog.upsert(makeEntry({ name: "g-skill", verificationTier: "guardian" }));
    catalog.upsert(makeEntry({ name: "s-skill", verificationTier: "sentinel" }));
    catalog.upsert(makeEntry({ name: "v-skill", verificationTier: "sovereign" }));
    catalog.upsert(makeEntry({ name: "no-tier", verificationTier: undefined }));

    const result = catalog.filterByTierMinimum("guardian");
    expect(result.length).toBe(3);
    const names = result.map((e) => e.name).sort();
    expect(names).toEqual(["g-skill", "s-skill", "v-skill"]);
  });

  it("5f. filterByTierMinimum('sovereign') returns only sovereign entries", () => {
    const catalog = new SkillCatalog("/fake/root");
    catalog.upsert(makeEntry({ name: "g-skill", verificationTier: "guardian" }));
    catalog.upsert(makeEntry({ name: "s-skill", verificationTier: "sentinel" }));
    catalog.upsert(makeEntry({ name: "v-skill", verificationTier: "sovereign" }));

    const result = catalog.filterByTierMinimum("sovereign");
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("v-skill");
  });

  it("6. save + load round-trip with real temp dir", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "catalog-test-"));
    try {
      const catalog = new SkillCatalog(tmpDir);
      await catalog.load(); // Should succeed with empty catalog

      const entry = makeEntry({
        name: "persisted-skill",
        description: "A skill to be persisted",
        tags: ["persistence", "test"],
      });
      catalog.upsert(entry);
      await catalog.save();

      // Load into a new instance
      const catalog2 = new SkillCatalog(tmpDir);
      await catalog2.load();

      const fetched = catalog2.get("persisted-skill");
      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe("persisted-skill");
      expect(fetched?.description).toBe("A skill to be persisted");
      expect(fetched?.tags).toEqual(["persistence", "test"]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
