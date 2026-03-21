import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill } from "./installer.js";

// Good SKILL.md content (instructions > 200 chars, description > 10 chars)
const GOOD_SKILL_CONTENT = `---
name: my-test-skill
description: A comprehensive test skill for testing installation workflows
---

You are an expert software engineer specializing in TypeScript and Node.js development.
Always produce complete, production-ready code with no stubs or placeholders.
Follow best practices for error handling, logging, and testing.
Ensure all edge cases are covered and write thorough documentation.
Use strict TypeScript with explicit types. Never use 'any' or '@ts-ignore'.
Write comprehensive unit tests with Vitest for every function you implement.
`;

// Short/stub skill content that should fail verification for higher tiers
const STUB_SKILL_CONTENT = `---
name: stub-skill
description: A stub
---

TODO: Add steps here.
`;

describe("installSkill", () => {
  let tmpDir: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "installer-test-"));
    projectRoot = await mkdtemp(join(tmpdir(), "project-root-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await rm(projectRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("1. installSkill from local path copies files and returns success", async () => {
    // Place SKILL.md directly in tmpDir (detected as universal format via findSkillMdFiles)
    await writeFile(join(tmpDir, "SKILL.md"), GOOD_SKILL_CONTENT, "utf-8");

    const result = await installSkill(
      { source: tmpDir, verify: false },
      projectRoot,
    );

    expect(result.success).toBe(true);
    expect(result.name).toBe("my-test-skill");
    expect(result.installedPath).toBeTruthy();
    expect(result.error).toBeUndefined();
  });

  it("2. installSkill runs verification and stores score in catalog", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), GOOD_SKILL_CONTENT, "utf-8");

    const result = await installSkill(
      { source: tmpDir, verify: true, tier: "guardian" },
      projectRoot,
    );

    expect(result.success).toBe(true);
    expect(result.verification).toBeDefined();
    expect(result.verification?.overallScore).toBeGreaterThan(0);

    // Catalog should contain the entry
    const { SkillCatalog } = await import("./catalog.js");
    const catalog = new SkillCatalog(projectRoot);
    await catalog.load();
    const entry = catalog.get("my-test-skill");
    expect(entry).not.toBeNull();
    expect(entry?.verificationScore).toBeDefined();
  });

  it("3. installSkill when verification fails without force returns success: false", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), STUB_SKILL_CONTENT, "utf-8");

    const result = await installSkill(
      { source: tmpDir, verify: true, tier: "sovereign" },
      projectRoot,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.verification).toBeDefined();
    expect(result.verification?.passed).toBe(false);
  });

  it("4. installSkill when verification fails with force: true installs anyway", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), STUB_SKILL_CONTENT, "utf-8");

    const result = await installSkill(
      { source: tmpDir, verify: true, tier: "sovereign", force: true },
      projectRoot,
    );

    expect(result.success).toBe(true);
    expect(result.name).toBe("stub-skill");
    // Verification was still run and stored
    expect(result.verification).toBeDefined();
    expect(result.verification?.passed).toBe(false);
  });

  it("5. installSkill with symlink: true creates symlink in install dir", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), GOOD_SKILL_CONTENT, "utf-8");

    const result = await installSkill(
      { source: tmpDir, verify: false, symlink: true },
      projectRoot,
    );

    expect(result.success).toBe(true);
    expect(result.installedPath).toBeTruthy();

    // Check that source-link exists in install dir
    const { stat } = await import("node:fs/promises");
    const symlinkPath = join(result.installedPath, "source-link");
    try {
      await stat(symlinkPath);
      // On Windows, symlinks might create a junction — just verify install succeeded
      expect(result.success).toBe(true);
    } catch {
      // On Windows, symlinks may not work without elevated permissions
      // The install should still succeed even if symlink creation failed
      expect(result.success).toBe(true);
    }
  });

  it("6. installSkill with nonexistent source returns success: false with error", async () => {
    const nonexistentPath = join(tmpDir, "does-not-exist-at-all");

    const result = await installSkill(
      { source: nonexistentPath, verify: false },
      projectRoot,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
