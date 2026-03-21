import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { bundleSkill, exportSkillToDirectory } from "./bundler.js";
import type { CatalogEntry } from "./catalog.js";

const SKILL_MD_CONTENT = `---
name: bundle-test-skill
description: A skill used for bundler testing
---

You are a test skill for bundler verification.
Always write complete, production-ready code.
`;

const VERIFICATION_JSON = JSON.stringify({
  skillName: "bundle-test-skill",
  overallScore: 90,
  tier: "sovereign",
  passed: true,
  findings: [],
  scriptSafety: null,
}, null, 2);

describe("bundleSkill", () => {
  let projectRoot: string;
  let outputDir: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "bundle-project-"));
    outputDir = await mkdtemp(join(tmpdir(), "bundle-output-"));

    // Set up the skill directory structure
    const skillDir = join(projectRoot, ".dantecode", "skills", "bundle-test-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), SKILL_MD_CONTENT, "utf-8");
    await writeFile(join(skillDir, ".verification.json"), VERIFICATION_JSON, "utf-8");
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true }).catch(() => {});
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it("1. bundleSkill copies SKILL.md to output dir and returns success", async () => {
    const result = await bundleSkill(
      { skillName: "bundle-test-skill", outputPath: outputDir },
      projectRoot,
    );

    expect(result.success).toBe(true);
    expect(result.skillName).toBe("bundle-test-skill");
    expect(result.outputPath).toBe(outputDir);
    expect(result.filesWritten.some((f) => basename(f) === "SKILL.md")).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify file was actually written
    const content = await readFile(join(outputDir, "SKILL.md"), "utf-8");
    expect(content).toContain("bundle-test-skill");
  });

  it("2. bundleSkill with includeVerification: false does not include .verification.json", async () => {
    const result = await bundleSkill(
      {
        skillName: "bundle-test-skill",
        outputPath: outputDir,
        includeVerification: false,
      },
      projectRoot,
    );

    expect(result.success).toBe(true);
    expect(result.filesWritten.some((f) => basename(f) === ".verification.json")).toBe(false);
  });

  it("3. bundleSkill writes bundle-manifest.json", async () => {
    const result = await bundleSkill(
      { skillName: "bundle-test-skill", outputPath: outputDir },
      projectRoot,
    );

    expect(result.success).toBe(true);
    expect(result.filesWritten.some((f) => basename(f) === "bundle-manifest.json")).toBe(true);

    const manifestRaw = await readFile(join(outputDir, "bundle-manifest.json"), "utf-8");
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
    expect(manifest["name"]).toBe("bundle-test-skill");
    expect(typeof manifest["bundledAt"]).toBe("string");
    expect(Array.isArray(manifest["files"])).toBe(true);
  });

  it("4. bundleSkill with nonexistent skill returns success: false", async () => {
    const result = await bundleSkill(
      { skillName: "nonexistent-skill", outputPath: outputDir },
      projectRoot,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.filesWritten.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// New hardening tests
// ---------------------------------------------------------------------------

describe("bundleSkill — empty bundle guard", () => {
  let projectRoot: string;
  let outputDir: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "bundle-empty-project-"));
    outputDir = await mkdtemp(join(tmpdir(), "bundle-empty-output-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true }).catch(() => {});
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it("5. returns success: false when skill dir has no copyable files", async () => {
    // Create skill dir with NO SKILL.md, no scripts, no verification
    const skillDir = join(projectRoot, ".dantecode", "skills", "empty-skill");
    await mkdir(skillDir, { recursive: true });
    // Create a hidden file only (should be skipped by copyIfExists)
    // and a file with wrong extension — nothing matches SKILL.md / SKILL.dc.md
    await writeFile(join(skillDir, "README.txt"), "ignored", "utf-8");

    const result = await bundleSkill(
      { skillName: "empty-skill", outputPath: outputDir, includeVerification: false },
      projectRoot,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Bundle is empty/);
    expect(result.filesWritten.length).toBe(0);
  });

  it("6. bundle with only SKILL.md succeeds and includes SKILL.md + manifest", async () => {
    // Skill dir has only SKILL.md (no SKILL.dc.md, no scripts, no verification)
    const skillDir = join(projectRoot, ".dantecode", "skills", "minimal-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), SKILL_MD_CONTENT, "utf-8");

    const result = await bundleSkill(
      { skillName: "minimal-skill", outputPath: outputDir, includeVerification: false },
      projectRoot,
    );

    expect(result.success).toBe(true);
    expect(result.filesWritten.some((f) => basename(f) === "SKILL.md")).toBe(true);
    expect(result.filesWritten.some((f) => basename(f) === "bundle-manifest.json")).toBe(true);
    // SKILL.dc.md was optional and not present — should not appear
    expect(result.filesWritten.some((f) => basename(f) === "SKILL.dc.md")).toBe(false);
  });
});

describe("bundleSkill — manifest completeness", () => {
  let projectRoot: string;
  let outputDir: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "bundle-manifest-project-"));
    outputDir = await mkdtemp(join(tmpdir(), "bundle-manifest-output-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true }).catch(() => {});
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it("7. bundle manifest lists SKILL.md, SKILL.dc.md, and scripts file", async () => {
    const skillDir = join(projectRoot, ".dantecode", "skills", "full-skill");
    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), SKILL_MD_CONTENT, "utf-8");
    await writeFile(join(skillDir, "SKILL.dc.md"), "# DanteForge wrapper", "utf-8");
    await writeFile(join(skillDir, "scripts", "foo.sh"), "#!/bin/sh\necho hello", "utf-8");

    const result = await bundleSkill(
      { skillName: "full-skill", outputPath: outputDir, includeVerification: false },
      projectRoot,
    );

    expect(result.success).toBe(true);

    const manifestRaw = await readFile(join(outputDir, "bundle-manifest.json"), "utf-8");
    const manifest = JSON.parse(manifestRaw) as { files: string[] };
    // Manifest lists basenames of skill content files written before the manifest itself
    expect(manifest.files).toContain("SKILL.md");
    expect(manifest.files).toContain("SKILL.dc.md");
    // scripts/foo.sh is written with full path; basename is "foo.sh"
    expect(manifest.files).toContain("foo.sh");
    // bundle-manifest.json is added to filesWritten AFTER manifest is written,
    // so it does NOT appear in manifest.files (by design)
    expect(result.filesWritten.some((f) => basename(f) === "bundle-manifest.json")).toBe(true);
  });
});

describe("exportSkillToDirectory — explicit projectRoot", () => {
  let projectRoot: string;
  let outputDir: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "export-project-"));
    outputDir = await mkdtemp(join(tmpdir(), "export-output-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true }).catch(() => {});
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it("8. exportSkillToDirectory bundles skill using explicit projectRoot", async () => {
    // Set up the skill directory
    const skillDir = join(projectRoot, ".dantecode", "skills", "export-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), SKILL_MD_CONTENT, "utf-8");

    // Build a CatalogEntry — installedPath points to the skill dir
    const entry: CatalogEntry = {
      name: "export-skill",
      description: "A skill used for export testing",
      source: "universal",
      sourcePath: skillDir,
      installedPath: skillDir,
      version: "1.0.0",
      tags: [],
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await exportSkillToDirectory(entry, outputDir, projectRoot);

    expect(result.success).toBe(true);
    expect(result.skillName).toBe("export-skill");
    expect(result.filesWritten.some((f) => basename(f) === "SKILL.md")).toBe(true);
    expect(result.filesWritten.some((f) => basename(f) === "bundle-manifest.json")).toBe(true);
  });
});
