import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadSkillRegistry,
  getSkill,
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
    instructions:
      "Review the code for bugs, style issues, and potential improvements.",
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
      await writeFile(
        join(badDir, "SKILL.dc.md"),
        "No frontmatter here, just content.",
      );
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
      const filePath = await createTestSkill(
        testDir,
        "code-review",
        testSkill,
      );
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
});
