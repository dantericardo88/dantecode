import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { bundleSkill } from "./bundler.js";

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
