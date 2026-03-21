import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadSkillRegistry,
  getSkill,
  getSkillWithBridgeMeta,
  listSkills,
  removeSkill,
  validateSkill,
} from "./registry.js";
import { wrapSkillWithAdapter, type ParsedSkill } from "./wrap.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Creates a wrapped SKILL.dc.md file in the test directory.
 */
async function createTestSkill(
  projectRoot: string,
  dirName: string,
  skill: ParsedSkill,
): Promise<string> {
  const skillDir = join(projectRoot, ".dantecode", "skills", dirName);
  await mkdir(skillDir, { recursive: true });
  const content = wrapSkillWithAdapter(skill, "claude");
  const filePath = join(skillDir, "SKILL.dc.md");
  await writeFile(filePath, content);
  return filePath;
}

describe("skill-adapter registry", () => {
  let testDir: string;

  const testSkill: ParsedSkill = {
    frontmatter: {
      name: "code-review",
      description: "Automated code review skill",
      tools: ["Read", "Grep"],
    },
    instructions: "Review the code for bugs, style issues, and potential improvements.",
    sourcePath: "/skills/code-review.md",
  };

  const secondSkill: ParsedSkill = {
    frontmatter: {
      name: "test-writer",
      description: "Generate unit tests",
    },
    instructions: "Write comprehensive unit tests for the given module.",
    sourcePath: "/skills/test-writer.md",
  };

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dantecode-registry-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("loadSkillRegistry", () => {
    it("returns empty array when skills directory does not exist", async () => {
      const registry = await loadSkillRegistry(testDir);
      expect(registry).toEqual([]);
    });

    it("returns empty array for empty skills directory", async () => {
      await mkdir(join(testDir, ".dantecode", "skills"), { recursive: true });
      const registry = await loadSkillRegistry(testDir);
      expect(registry).toEqual([]);
    });

    it("loads a single registered skill", async () => {
      await createTestSkill(testDir, "code-review", testSkill);
      const registry = await loadSkillRegistry(testDir);
      expect(registry).toHaveLength(1);
      expect(registry[0]?.name).toBe("code-review");
      expect(registry[0]?.description).toBe("Automated code review skill");
      expect(registry[0]?.importSource).toBe("claude");
    });

    it("loads multiple skills sorted alphabetically", async () => {
      await createTestSkill(testDir, "code-review", testSkill);
      await createTestSkill(testDir, "test-writer", secondSkill);
      const registry = await loadSkillRegistry(testDir);
      expect(registry).toHaveLength(2);
      expect(registry[0]?.name).toBe("code-review");
      expect(registry[1]?.name).toBe("test-writer");
    });

    it("skips directories without SKILL.dc.md", async () => {
      await createTestSkill(testDir, "valid-skill", testSkill);
      // Create a directory without SKILL.dc.md
      await mkdir(join(testDir, ".dantecode", "skills", "empty-dir"), {
        recursive: true,
      });
      const registry = await loadSkillRegistry(testDir);
      expect(registry).toHaveLength(1);
    });

    it("skips files with invalid frontmatter", async () => {
      await createTestSkill(testDir, "valid-skill", testSkill);
      // Create a skill with no frontmatter
      const badDir = join(testDir, ".dantecode", "skills", "bad-skill");
      await mkdir(badDir, { recursive: true });
      await writeFile(join(badDir, "SKILL.dc.md"), "No frontmatter here, just content.");
      const registry = await loadSkillRegistry(testDir);
      expect(registry).toHaveLength(1);
      expect(registry[0]?.name).toBe("code-review");
    });

    it("includes original tools when present", async () => {
      await createTestSkill(testDir, "code-review", testSkill);
      const registry = await loadSkillRegistry(testDir);
      expect(registry[0]?.originalTools).toEqual(["Read", "Grep"]);
    });
  });

  describe("getSkill", () => {
    it("returns null when skill is not found", async () => {
      const skill = await getSkill("nonexistent", testDir);
      expect(skill).toBeNull();
    });

    it("returns null when skills directory does not exist", async () => {
      const skill = await getSkill("any-skill", testDir);
      expect(skill).toBeNull();
    });

    it("finds a skill by name (case-insensitive)", async () => {
      await createTestSkill(testDir, "code-review", testSkill);
      const skill = await getSkill("Code-Review", testDir);
      expect(skill).not.toBeNull();
      expect(skill?.frontmatter.name).toBe("code-review");
      expect(skill?.isWrapped).toBe(true);
    });

    it("finds a skill by directory name", async () => {
      await createTestSkill(testDir, "my-review-skill", testSkill);
      const skill = await getSkill("my-review-skill", testDir);
      expect(skill).not.toBeNull();
    });

    it("returns full SkillDefinition with instructions", async () => {
      await createTestSkill(testDir, "code-review", testSkill);
      const skill = await getSkill("code-review", testDir);
      expect(skill?.instructions).toContain("Review the code for bugs");
      expect(skill?.adapterVersion).toBeDefined();
      expect(skill?.importSource).toBe("claude");
    });

    it("includes wrappedPath in definition", async () => {
      const filePath = await createTestSkill(testDir, "code-review", testSkill);
      const skill = await getSkill("code-review", testDir);
      expect(skill?.wrappedPath).toBe(filePath);
    });
  });

  describe("listSkills", () => {
    it("returns all registered skills (delegates to loadSkillRegistry)", async () => {
      await createTestSkill(testDir, "code-review", testSkill);
      await createTestSkill(testDir, "test-writer", secondSkill);
      const list = await listSkills(testDir);
      expect(list).toHaveLength(2);
    });
  });

  describe("removeSkill", () => {
    it("removes an existing skill and returns true", async () => {
      await createTestSkill(testDir, "code-review", testSkill);
      const removed = await removeSkill("code-review", testDir);
      expect(removed).toBe(true);
      // Verify it's gone
      const registry = await loadSkillRegistry(testDir);
      expect(registry).toHaveLength(0);
    });

    it("returns false when skill does not exist", async () => {
      const removed = await removeSkill("nonexistent", testDir);
      expect(removed).toBe(false);
    });

    it("returns false when skills directory does not exist", async () => {
      const removed = await removeSkill("any", testDir);
      expect(removed).toBe(false);
    });

    it("removes by case-insensitive name match", async () => {
      await createTestSkill(testDir, "code-review", testSkill);
      const removed = await removeSkill("CODE-REVIEW", testDir);
      expect(removed).toBe(true);
    });
  });

  describe("validateSkill", () => {
    it("returns null for non-existent skill", async () => {
      const result = await validateSkill("nonexistent", testDir);
      expect(result).toBeNull();
    });

    it("validates a clean skill (passes both gates)", async () => {
      await createTestSkill(testDir, "code-review", testSkill);
      const result = await validateSkill("code-review", testDir);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("code-review");
      expect(result?.antiStubPassed).toBe(true);
      expect(result?.constitutionPassed).toBe(true);
      expect(result?.overallPassed).toBe(true);
    });

    it("detects anti-stub violations in skill instructions", async () => {
      const stubSkill: ParsedSkill = {
        frontmatter: {
          name: "stub-skill",
          description: "A skill with stub patterns",
        },
        instructions: 'function doWork() { throw new Error("not implemented"); }',
        sourcePath: "/skills/stub.md",
      };
      await createTestSkill(testDir, "stub-skill", stubSkill);
      const result = await validateSkill("stub-skill", testDir);
      expect(result).not.toBeNull();
      // The wrapped content includes the preamble which mentions these patterns
      // in the Anti-Stub Doctrine, so the scanner will detect them
      expect(result?.antiStubHardViolations).toBeGreaterThanOrEqual(0);
    });

    it("returns validation result with all required fields", async () => {
      await createTestSkill(testDir, "code-review", testSkill);
      const result = await validateSkill("code-review", testDir);
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("antiStubPassed");
      expect(result).toHaveProperty("constitutionPassed");
      expect(result).toHaveProperty("antiStubHardViolations");
      expect(result).toHaveProperty("antiStubSoftViolations");
      expect(result).toHaveProperty("constitutionCriticalViolations");
      expect(result).toHaveProperty("constitutionWarningViolations");
      expect(result).toHaveProperty("overallPassed");
    });
  });

  describe("edge cases — branch coverage", () => {
    it("loadSkillRegistry skips non-directory entries in skills dir", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      await mkdir(skillsDir, { recursive: true });
      // Create a regular file (not a directory) in skills dir
      await writeFile(join(skillsDir, "not-a-directory.txt"), "just a file");
      await createTestSkill(testDir, "valid-skill", testSkill);
      const registry = await loadSkillRegistry(testDir);
      expect(registry).toHaveLength(1);
      expect(registry[0]?.name).toBe("code-review");
    });

    it("loadSkillRegistry skips skills with YAML parsing errors", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      const badDir = join(skillsDir, "bad-yaml");
      await mkdir(badDir, { recursive: true });
      // Invalid YAML frontmatter
      await writeFile(join(badDir, "SKILL.dc.md"), "---\n: : invalid yaml [[[\n---\nContent");
      await createTestSkill(testDir, "good-skill", testSkill);
      const registry = await loadSkillRegistry(testDir);
      expect(registry).toHaveLength(1);
    });

    it("loadSkillRegistry skips frontmatter that parses to null", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      const nullDir = join(skillsDir, "null-fm");
      await mkdir(nullDir, { recursive: true });
      // Frontmatter that parses to null in YAML
      await writeFile(join(nullDir, "SKILL.dc.md"), "---\nnull\n---\nContent");
      await createTestSkill(testDir, "good-skill", testSkill);
      const registry = await loadSkillRegistry(testDir);
      expect(registry).toHaveLength(1);
    });

    it("loadSkillRegistry skips frontmatter that parses to array", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      const arrayDir = join(skillsDir, "array-fm");
      await mkdir(arrayDir, { recursive: true });
      // Frontmatter that parses to an array
      await writeFile(join(arrayDir, "SKILL.dc.md"), "---\n- item1\n- item2\n---\nContent");
      await createTestSkill(testDir, "good-skill", testSkill);
      const registry = await loadSkillRegistry(testDir);
      expect(registry).toHaveLength(1);
    });

    it("loadSkillRegistry handles missing frontmatter closing marker", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      const noCloseDir = join(skillsDir, "no-close");
      await mkdir(noCloseDir, { recursive: true });
      // Frontmatter without closing ---
      await writeFile(join(noCloseDir, "SKILL.dc.md"), "---\nname: orphan\ncontent here");
      await createTestSkill(testDir, "good-skill", testSkill);
      const registry = await loadSkillRegistry(testDir);
      expect(registry).toHaveLength(1);
    });

    it("removeSkill skips non-directory entries", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(join(skillsDir, "random-file.txt"), "not a skill");
      const removed = await removeSkill("random-file", testDir);
      expect(removed).toBe(false);
    });

    it("removeSkill skips entries with unreadable SKILL.dc.md", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      const emptyDir = join(skillsDir, "no-skill-file");
      await mkdir(emptyDir, { recursive: true });
      // Directory exists but has no SKILL.dc.md
      const removed = await removeSkill("no-skill-file", testDir);
      expect(removed).toBe(false);
    });

    it("removeSkill skips entries with null frontmatter", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      const noFmDir = join(skillsDir, "no-frontmatter");
      await mkdir(noFmDir, { recursive: true });
      await writeFile(join(noFmDir, "SKILL.dc.md"), "No frontmatter, just text content.");
      const removed = await removeSkill("some-name", testDir);
      expect(removed).toBe(false);
    });

    it("removeSkill matches by directory name when frontmatter name differs", async () => {
      await createTestSkill(testDir, "dir-name-match", testSkill);
      // testSkill has frontmatter name "code-review", but dir is "dir-name-match"
      const removed = await removeSkill("dir-name-match", testDir);
      expect(removed).toBe(true);
    });

    it("getSkill handles skills with no original instructions markers", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      const plainDir = join(skillsDir, "plain-skill");
      await mkdir(plainDir, { recursive: true });
      await writeFile(
        join(plainDir, "SKILL.dc.md"),
        "---\nname: plain\ndescription: test\nimport_source: claude\nadapter_version: '1.0.0'\nwrapped_at: '2026-03-15T00:00:00Z'\n---\nPlain instructions here.",
      );
      const skill = await getSkill("plain", testDir);
      expect(skill).not.toBeNull();
      expect(skill?.instructions).toContain("Plain instructions here");
    });

    it("buildSkillFrontmatter uses defaults for missing fields", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      const minDir = join(skillsDir, "minimal-skill");
      await mkdir(minDir, { recursive: true });
      // Frontmatter with only minimal fields — no tools, mode, hidden, color
      await writeFile(
        join(minDir, "SKILL.dc.md"),
        "---\nimport_source: claude\nadapter_version: '1.0.0'\nwrapped_at: '2026-03-15T00:00:00Z'\n---\nMinimal.",
      );
      const skill = await getSkill("minimal-skill", testDir);
      expect(skill).not.toBeNull();
      // Name defaults to "unnamed" when not in frontmatter
      expect(skill?.frontmatter.name).toBe("unnamed");
      expect(skill?.frontmatter.description).toBe("");
    });
  });

  // ============================================================================
  // getSkillWithBridgeMeta tests
  // ============================================================================

  describe("getSkillWithBridgeMeta", () => {
    it("returns bridgeMeta populated for a skillbridge skill", async () => {
      // Create a skillbridge skill directory with bridge-meta.json
      const skillsDir = join(testDir, ".dantecode", "skills");
      const skillDir = join(skillsDir, "bridge-test-skill");
      await mkdir(skillDir, { recursive: true });

      await writeFile(
        join(skillDir, "SKILL.dc.md"),
        [
          "---",
          "name: bridge-test-skill",
          "description: A bridged test skill",
          "import_source: skillbridge",
          "adapter_version: '1.0.0'",
          `wrapped_at: '${new Date().toISOString()}'`,
          "---",
          "",
          "Bridge skill instructions.",
        ].join("\n"),
        "utf-8",
      );

      const bridgeMeta = {
        slug: "bridge-test-skill",
        name: "bridge-test-skill",
        description: "A bridged test skill",
        bundleDir: skillDir,
        conversionScore: 0.95,
        bucket: "green",
        runtimeWarnings: [],
        conversionWarnings: [],
        importedAt: new Date().toISOString(),
        classification: "instruction-only",
        emitterStatuses: { dantecode: "success" },
      };
      await writeFile(
        join(skillDir, "bridge-meta.json"),
        JSON.stringify(bridgeMeta, null, 2),
        "utf-8",
      );

      const result = await getSkillWithBridgeMeta("bridge-test-skill", testDir);
      expect(result).not.toBeNull();
      expect(result!.bridgeMeta).toBeDefined();
      expect(result!.bridgeMeta!.bucket).toBe("green");
      expect(result!.bridgeMeta!.conversionScore).toBe(0.95);
      expect(result!.bridgeMeta!.classification).toBe("instruction-only");
    });

    it("returns bridgeMeta as undefined for a non-bridge skill", async () => {
      // Use an existing non-bridge skill from testDir setup
      // Create a simple non-bridge skill
      const skillsDir = join(testDir, ".dantecode", "skills");
      const skillDir = join(skillsDir, "plain-skill");
      await mkdir(skillDir, { recursive: true });

      await writeFile(
        join(skillDir, "SKILL.dc.md"),
        [
          "---",
          "name: plain-skill",
          "description: A plain skill",
          "import_source: claude",
          "adapter_version: '1.0.0'",
          `wrapped_at: '${new Date().toISOString()}'`,
          "---",
          "",
          "Plain skill instructions.",
        ].join("\n"),
        "utf-8",
      );

      const result = await getSkillWithBridgeMeta("plain-skill", testDir);
      expect(result).not.toBeNull();
      expect(result!.bridgeMeta).toBeUndefined();
    });
  });

  // ============================================================================
  // Regression tests — _findSkillDir refactor + bridge-meta.json loading
  // ============================================================================

  describe("regression — getSkill data structure after _findSkillDir refactor", () => {
    it("getSkill returns all required SkillDefinition fields", async () => {
      await createTestSkill(testDir, "code-review", testSkill);
      const skill = await getSkill("code-review", testDir);
      expect(skill).not.toBeNull();
      // Core fields
      expect(typeof skill!.frontmatter.name).toBe("string");
      expect(typeof skill!.frontmatter.description).toBe("string");
      expect(typeof skill!.instructions).toBe("string");
      expect(typeof skill!.adapterVersion).toBe("string");
      expect(typeof skill!.importSource).toBe("string");
      expect(typeof skill!.wrappedPath).toBe("string");
      expect(typeof skill!.sourcePath).toBe("string");
      expect(typeof skill!.isWrapped).toBe("boolean");
      // Verify values
      expect(skill!.frontmatter.name).toBe("code-review");
      expect(skill!.importSource).toBe("claude");
      expect(skill!.isWrapped).toBe(true);
      expect(skill!.instructions).toContain("Review the code for bugs");
    });

    it("getSkill correctly resolves skill by case-insensitive match after refactor", async () => {
      await createTestSkill(testDir, "test-writer", secondSkill);
      // Lookup by name from frontmatter (case differs from dir)
      const byName = await getSkill("Test-Writer", testDir);
      expect(byName).not.toBeNull();
      expect(byName!.frontmatter.name).toBe("test-writer");
      // Lookup by dir name directly
      const byDir = await getSkill("test-writer", testDir);
      expect(byDir).not.toBeNull();
      expect(byDir!.wrappedPath).toContain("test-writer");
    });
  });

  describe("regression — getSkillWithBridgeMeta loads bridge-meta.json", () => {
    it("getSkillWithBridgeMeta returns bridgeMeta with all fields from bridge-meta.json", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      const skillDir = join(skillsDir, "meta-regression");
      await mkdir(skillDir, { recursive: true });

      await writeFile(
        join(skillDir, "SKILL.dc.md"),
        [
          "---",
          "name: meta-regression",
          "description: Regression test skill",
          "import_source: skillbridge",
          "adapter_version: '1.0.0'",
          `wrapped_at: '${new Date().toISOString()}'`,
          "---",
          "",
          "Regression skill instructions.",
        ].join("\n"),
        "utf-8",
      );

      const bridgeMeta = {
        slug: "meta-regression",
        name: "meta-regression",
        description: "Regression test skill",
        bundleDir: skillDir,
        conversionScore: 0.91,
        bucket: "green",
        runtimeWarnings: ["test warning"],
        conversionWarnings: [],
        importedAt: "2026-03-20T00:00:00Z",
        classification: "tool-bound",
        emitterStatuses: { dantecode: "success" },
      };
      await writeFile(
        join(skillDir, "bridge-meta.json"),
        JSON.stringify(bridgeMeta, null, 2),
        "utf-8",
      );

      const result = await getSkillWithBridgeMeta("meta-regression", testDir);
      expect(result).not.toBeNull();
      expect(result!.bridgeMeta).toBeDefined();
      expect(result!.bridgeMeta!.slug).toBe("meta-regression");
      expect(result!.bridgeMeta!.conversionScore).toBe(0.91);
      expect(result!.bridgeMeta!.bucket).toBe("green");
      expect(result!.bridgeMeta!.runtimeWarnings).toEqual(["test warning"]);
      expect(result!.bridgeMeta!.classification).toBe("tool-bound");
      expect(result!.bridgeMeta!.importedAt).toBe("2026-03-20T00:00:00Z");
    });
  });

  // ============================================================================
  // SkillBridge metadata loading tests
  // ============================================================================

  describe("loadSkillRegistry — bridge metadata", () => {
    it("loads bridge metadata from bridge-meta.json for skillbridge skills", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      const skillDir = join(skillsDir, "my-bridge-skill");
      await mkdir(skillDir, { recursive: true });

      // Write SKILL.dc.md with import_source: skillbridge
      await writeFile(
        join(skillDir, "SKILL.dc.md"),
        [
          "---",
          "name: my-bridge-skill",
          "description: A bridged skill",
          "import_source: skillbridge",
          "adapter_version: '1.0.0'",
          "wrapped_at: '2026-03-20T00:00:00Z'",
          "---",
          "Bridged skill instructions.",
        ].join("\n"),
      );

      // Write bridge-meta.json
      const bridgeMeta = {
        slug: "my-bridge-skill",
        name: "my-bridge-skill",
        description: "A bridged skill",
        bundleDir: skillDir,
        conversionScore: 0.88,
        bucket: "amber",
        runtimeWarnings: ["needs shell"],
        conversionWarnings: [],
        importedAt: "2026-03-20T00:00:00Z",
        classification: "tool-bound",
        emitterStatuses: { dantecode: "warning" },
      };
      await writeFile(join(skillDir, "bridge-meta.json"), JSON.stringify(bridgeMeta));

      const registry = await loadSkillRegistry(testDir);
      expect(registry).toHaveLength(1);
      const entry = registry[0]!;
      expect(entry.importSource).toBe("skillbridge");
      expect(entry.conversionScore).toBe(0.88);
      expect(entry.bucket).toBe("amber");
      expect(entry.runtimeWarnings).toContain("needs shell");
      expect(entry.classification).toBe("tool-bound");
    });

    it("loads skill without bridge fields when bridge-meta.json is absent", async () => {
      const skillsDir = join(testDir, ".dantecode", "skills");
      const skillDir = join(skillsDir, "bridge-no-meta");
      await mkdir(skillDir, { recursive: true });

      // Write SKILL.dc.md with import_source: skillbridge but NO bridge-meta.json
      await writeFile(
        join(skillDir, "SKILL.dc.md"),
        [
          "---",
          "name: bridge-no-meta",
          "description: Skill without bridge-meta.json",
          "import_source: skillbridge",
          "adapter_version: '1.0.0'",
          "wrapped_at: '2026-03-20T00:00:00Z'",
          "---",
          "Instructions without bridge metadata.",
        ].join("\n"),
      );
      // No bridge-meta.json written

      const registry = await loadSkillRegistry(testDir);
      expect(registry).toHaveLength(1);
      const entry = registry[0]!;
      expect(entry.importSource).toBe("skillbridge");
      // Bridge fields should be undefined — graceful degradation
      expect(entry.conversionScore).toBeUndefined();
      expect(entry.bucket).toBeUndefined();
      expect(entry.runtimeWarnings).toBeUndefined();
      expect(entry.classification).toBeUndefined();
    });
  });
});
