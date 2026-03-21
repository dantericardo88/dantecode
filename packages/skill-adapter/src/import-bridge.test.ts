// ============================================================================
// @dantecode/skill-adapter — Import Bridge Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

vi.mock("@dantecode/core", () => ({
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  importSkillBridgeBundle,
  listBridgeWarnings,
  validateBridgeSkill,
} from "./import-bridge.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GREEN_MANIFEST = {
  version: "1",
  source: { kind: "local-dir", url: "", repo: "", commit: "", path: "", license: "MIT" },
  normalizedSkill: {
    name: "my-skill",
    slug: "my-skill",
    description: "A test skill",
    instructions: "Do the thing.",
    supportFiles: [],
    frontmatter: {},
    capabilities: {
      filesystem: false,
      network: false,
      shell: false,
      mcp: false,
      browser: false,
      llmRepairNeeded: false,
    },
    classification: "instruction-only",
  },
  emitters: {
    dantecode: { status: "success" },
    qwenSkill: { status: "success" },
    mcp: { status: "skipped" },
    cliWrapper: { status: "skipped" },
  },
  verification: {
    parsePassed: true,
    constitutionPassed: true,
    antiStubPassed: true,
    conversionScore: 0.95,
  },
  warnings: [],
};

const AMBER_MANIFEST = {
  ...GREEN_MANIFEST,
  normalizedSkill: {
    ...GREEN_MANIFEST.normalizedSkill,
    slug: "amber-skill",
    name: "amber-skill",
    capabilities: {
      ...GREEN_MANIFEST.normalizedSkill.capabilities,
      shell: true,
      mcp: true,
    },
  },
  emitters: {
    ...GREEN_MANIFEST.emitters,
    dantecode: { status: "warning", warnings: ["shell execution required"] },
  },
  warnings: ["skill uses shell commands"],
};

const RED_MANIFEST = {
  ...GREEN_MANIFEST,
  normalizedSkill: {
    ...GREEN_MANIFEST.normalizedSkill,
    slug: "red-skill",
    name: "red-skill",
  },
  emitters: {
    ...GREEN_MANIFEST.emitters,
    dantecode: { status: "blocked" },
  },
  verification: {
    ...GREEN_MANIFEST.verification,
    parsePassed: false,
    conversionScore: 0.3,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildBundle(
  bundleDir: string,
  manifest: unknown,
  hasDcTarget = true,
): Promise<void> {
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, "skillbridge.json"), JSON.stringify(manifest, null, 2), "utf-8");
  if (hasDcTarget) {
    const dcDir = join(bundleDir, "targets", "dantecode");
    await mkdir(dcDir, { recursive: true });
    await writeFile(
      join(dcDir, "SKILL.dc.md"),
      `---\nname: my-skill\ndescription: A test skill\nimport_source: skillbridge\nadapter_version: 1.0.0\nwrapped_at: ${new Date().toISOString()}\n---\n\nDo the thing.\n`,
      "utf-8",
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("importSkillBridgeBundle", () => {
  let tmpRoot: string;
  let bundleDir: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "sb-import-test-"));
    bundleDir = join(tmpRoot, "bundle");
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("successfully imports a green bundle", async () => {
    await buildBundle(bundleDir, GREEN_MANIFEST);
    const result = await importSkillBridgeBundle({ bundleDir, projectRoot });

    expect(result.success).toBe(true);
    expect(result.slug).toBe("my-skill");
    expect(result.bucket).toBe("green");
    expect(result.conversionScore).toBe(0.95);
    expect(result.runtimeWarnings).toHaveLength(0);
  });

  it("copies SKILL.dc.md to .dantecode/skills/<slug>/", async () => {
    await buildBundle(bundleDir, GREEN_MANIFEST);
    const result = await importSkillBridgeBundle({ bundleDir, projectRoot });

    expect(result.success).toBe(true);
    const skillFile = join(projectRoot, ".dantecode", "skills", "my-skill", "SKILL.dc.md");
    const content = await readFile(skillFile, "utf-8");
    expect(content).toContain("Do the thing.");
  });

  it("writes warnings.json with correct shape", async () => {
    await buildBundle(bundleDir, GREEN_MANIFEST);
    const result = await importSkillBridgeBundle({ bundleDir, projectRoot });
    expect(result.success).toBe(true);

    const warningsFile = join(projectRoot, ".dantecode", "skills", "my-skill", "warnings.json");
    const raw = await readFile(warningsFile, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["bucket"]).toBe("green");
    expect(parsed["conversionScore"]).toBe(0.95);
    expect(Array.isArray(parsed["runtimeWarnings"])).toBe(true);
  });

  it("writes bridge-meta.json with correct shape", async () => {
    await buildBundle(bundleDir, GREEN_MANIFEST);
    const result = await importSkillBridgeBundle({ bundleDir, projectRoot });
    expect(result.success).toBe(true);

    const metaFile = join(projectRoot, ".dantecode", "skills", "my-skill", "bridge-meta.json");
    const raw = await readFile(metaFile, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["slug"]).toBe("my-skill");
    expect(parsed["classification"]).toBe("instruction-only");
    expect(typeof parsed["importedAt"]).toBe("string");
  });

  it("copies skillbridge.json manifest", async () => {
    await buildBundle(bundleDir, GREEN_MANIFEST);
    await importSkillBridgeBundle({ bundleDir, projectRoot });

    const manifestFile = join(projectRoot, ".dantecode", "skills", "my-skill", "skillbridge.json");
    const content = await readFile(manifestFile, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed["version"]).toBe("1");
  });

  it("classifies amber bundle and includes runtime warnings", async () => {
    const amberBundleDir = join(tmpRoot, "amber-bundle");
    await buildBundle(amberBundleDir, AMBER_MANIFEST);

    // Fix the SKILL.dc.md slug
    const dcDir = join(amberBundleDir, "targets", "dantecode");
    await writeFile(
      join(dcDir, "SKILL.dc.md"),
      `---\nname: amber-skill\ndescription: A test skill\nimport_source: skillbridge\nadapter_version: 1.0.0\nwrapped_at: ${new Date().toISOString()}\n---\n\nDo the thing.\n`,
      "utf-8",
    );

    const result = await importSkillBridgeBundle({
      bundleDir: amberBundleDir,
      projectRoot,
    });

    expect(result.success).toBe(true);
    expect(result.bucket).toBe("amber");
    expect(result.runtimeWarnings.length).toBeGreaterThan(0);
  });

  it("rejects red bundle by default", async () => {
    const redBundleDir = join(tmpRoot, "red-bundle");
    await buildBundle(redBundleDir, RED_MANIFEST);

    const result = await importSkillBridgeBundle({
      bundleDir: redBundleDir,
      projectRoot,
    });

    expect(result.success).toBe(false);
    expect(result.bucket).toBe("red");
    expect(result.error).toMatch(/blocked|red/i);
  });

  it("imports red bundle when allowBlocked is true", async () => {
    const redBundleDir = join(tmpRoot, "red-bundle");
    await buildBundle(redBundleDir, RED_MANIFEST);

    const result = await importSkillBridgeBundle({
      bundleDir: redBundleDir,
      projectRoot,
      allowBlocked: true,
    });

    expect(result.success).toBe(true);
    expect(result.bucket).toBe("red");
  });

  it("fails gracefully when bundle directory does not exist", async () => {
    const result = await importSkillBridgeBundle({
      bundleDir: "/nonexistent/bundle",
      projectRoot,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("fails gracefully when DanteCode target is missing", async () => {
    await buildBundle(bundleDir, GREEN_MANIFEST, false); // no DC target
    const result = await importSkillBridgeBundle({ bundleDir, projectRoot });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/DanteCode target|SKILL\.dc\.md/i);
  });

  it("generates shell capability warning when shell=true", async () => {
    const manifest = {
      ...GREEN_MANIFEST,
      normalizedSkill: {
        ...GREEN_MANIFEST.normalizedSkill,
        slug: "shell-skill",
        name: "shell-skill",
        capabilities: { ...GREEN_MANIFEST.normalizedSkill.capabilities, shell: true },
      },
    };
    const shellBundleDir = join(tmpRoot, "shell-bundle");
    await buildBundle(shellBundleDir, manifest);

    // Update the SKILL.dc.md slug
    await writeFile(
      join(shellBundleDir, "targets", "dantecode", "SKILL.dc.md"),
      `---\nname: shell-skill\nimport_source: skillbridge\nadapter_version: 1.0.0\nwrapped_at: ${new Date().toISOString()}\n---\n\nDo the thing.\n`,
      "utf-8",
    );

    const result = await importSkillBridgeBundle({ bundleDir: shellBundleDir, projectRoot });
    expect(result.success).toBe(true);
    expect(result.runtimeWarnings.some((w) => /shell|bash/i.test(w))).toBe(true);
  });

  describe("path traversal protection", () => {
    it("sanitizes path-traversal slug and writes inside project root", async () => {
      const traversalManifest = {
        ...GREEN_MANIFEST,
        normalizedSkill: {
          ...GREEN_MANIFEST.normalizedSkill,
          slug: "../../escape",
          name: "escape",
        },
      };
      const traversalBundleDir = join(tmpRoot, "traversal-bundle");
      await buildBundle(traversalBundleDir, traversalManifest);
      // Fix the SKILL.dc.md for the new name
      await writeFile(
        join(traversalBundleDir, "targets", "dantecode", "SKILL.dc.md"),
        `---\nname: escape\ndescription: Escape skill\nimport_source: skillbridge\nadapter_version: 1.0.0\nwrapped_at: ${new Date().toISOString()}\n---\n\nEscape skill.\n`,
        "utf-8",
      );

      const result = await importSkillBridgeBundle({ bundleDir: traversalBundleDir, projectRoot });
      expect(result.success).toBe(true);
      // Slug must be sanitized — no traversal chars
      expect(result.slug).toBe("escape");
      expect(result.slug).not.toContain("..");
      // skillDir must be inside project root
      expect(result.skillDir).toContain(projectRoot);
      expect(result.skillDir).not.toContain("..");
    });
  });

  describe("dry-run mode", () => {
    it("dryRun: true returns result with dryRun: true and writes NO files", async () => {
      await buildBundle(bundleDir, GREEN_MANIFEST);

      const result = await importSkillBridgeBundle({ bundleDir, projectRoot, dryRun: true });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.slug).toBe("my-skill");
      expect(result.bucket).toBe("green");

      // No skill directory should have been created
      const skillFile = join(projectRoot, ".dantecode", "skills", "my-skill", "SKILL.dc.md");
      await expect(readFile(skillFile, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("dryRun: true with blocked (red) bundle still returns blocked error", async () => {
      const redBundleDir = join(tmpRoot, "red-dry-bundle");
      await buildBundle(redBundleDir, RED_MANIFEST);

      const result = await importSkillBridgeBundle({
        bundleDir: redBundleDir,
        projectRoot,
        dryRun: true,
      });

      // Security check fires before dryRun gate — blocked error returned
      expect(result.success).toBe(false);
      expect(result.bucket).toBe("red");
      expect(result.error).toMatch(/blocked|red/i);
    });

    it("dryRun: true with existing slug and no force still returns overwrite error", async () => {
      // First import installs the skill for real
      await buildBundle(bundleDir, GREEN_MANIFEST);
      const first = await importSkillBridgeBundle({ bundleDir, projectRoot });
      expect(first.success).toBe(true);

      // Dry run on same slug without force — overwrite protection fires first
      const result = await importSkillBridgeBundle({ bundleDir, projectRoot, dryRun: true });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already exists/i);
    });

    it("dryRun: true + force: true still prevents writes", async () => {
      // First: real import installs the skill
      await buildBundle(bundleDir, GREEN_MANIFEST);
      const first = await importSkillBridgeBundle({ bundleDir, projectRoot });
      expect(first.success).toBe(true);

      // Get mtime before dry-run attempt
      const skillFile = join(projectRoot, ".dantecode", "skills", "my-skill", "SKILL.dc.md");
      const { mtimeMs: mtimeBefore } = await stat(skillFile);

      // Dry-run with force: should succeed (overwrite protection bypassed by force)
      // but NO files should be written
      const result = await importSkillBridgeBundle({
        bundleDir,
        projectRoot,
        dryRun: true,
        force: true,
      });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);

      // File mtime must be unchanged — no write occurred
      const { mtimeMs: mtimeAfter } = await stat(skillFile);
      expect(mtimeAfter).toBe(mtimeBefore);
    });
  });

  describe("overwrite protection", () => {
    it("returns success:false when skill already exists and force is not set", async () => {
      await buildBundle(bundleDir, GREEN_MANIFEST);
      const first = await importSkillBridgeBundle({ bundleDir, projectRoot });
      expect(first.success).toBe(true);

      // Second import without force — should be rejected
      const second = await importSkillBridgeBundle({ bundleDir, projectRoot });
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/already exists/i);
    });

    it("returns success:false by default when force is not passed", async () => {
      await buildBundle(bundleDir, GREEN_MANIFEST);
      await importSkillBridgeBundle({ bundleDir, projectRoot });
      // No force field — defaults to false
      const result = await importSkillBridgeBundle({ bundleDir, projectRoot });
      expect(result.success).toBe(false);
    });

    it("overwrites existing skill when force: true", async () => {
      await buildBundle(bundleDir, GREEN_MANIFEST);
      const first = await importSkillBridgeBundle({ bundleDir, projectRoot });
      expect(first.success).toBe(true);

      const second = await importSkillBridgeBundle({ bundleDir, projectRoot, force: true });
      expect(second.success).toBe(true);
      expect(second.slug).toBe("my-skill");
      expect(second.bucket).toBe("green");
    });
  });
});

describe("listBridgeWarnings", () => {
  let tmpRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "sb-warnings-test-"));
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns null for a skill that has no warnings.json", async () => {
    const result = await listBridgeWarnings("nonexistent", projectRoot);
    expect(result).toBeNull();
  });

  it("returns warning payload for an existing bridge skill", async () => {
    const skillDir = join(projectRoot, ".dantecode", "skills", "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "warnings.json"),
      JSON.stringify({
        runtimeWarnings: ["needs shell"],
        conversionWarnings: ["check mcp"],
        bucket: "amber",
        conversionScore: 0.78,
      }),
      "utf-8",
    );

    const result = await listBridgeWarnings("my-skill", projectRoot);
    expect(result).not.toBeNull();
    expect(result!.runtimeWarnings).toEqual(["needs shell"]);
    expect(result!.bucket).toBe("amber");
    expect(result!.conversionScore).toBe(0.78);
  });
});

describe("validateBridgeSkill", () => {
  let tmpRoot: string;
  let projectRoot: string;
  let bundleDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "sb-validate-test-"));
    projectRoot = join(tmpRoot, "project");
    bundleDir = join(tmpRoot, "bundle");
    await mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns true after a successful import", async () => {
    await buildBundle(bundleDir, GREEN_MANIFEST);
    await importSkillBridgeBundle({ bundleDir, projectRoot });

    const valid = await validateBridgeSkill("my-skill", projectRoot);
    expect(valid).toBe(true);
  });

  it("returns false for a non-existent skill", async () => {
    const valid = await validateBridgeSkill("ghost-skill", projectRoot);
    expect(valid).toBe(false);
  });

  it("returns false when SKILL.dc.md is absent", async () => {
    const skillDir = join(projectRoot, ".dantecode", "skills", "broken-skill");
    await mkdir(skillDir, { recursive: true });
    // Write skillbridge.json but no SKILL.dc.md
    await writeFile(join(skillDir, "skillbridge.json"), JSON.stringify(GREEN_MANIFEST), "utf-8");

    const valid = await validateBridgeSkill("broken-skill", projectRoot);
    expect(valid).toBe(false);
  });
});
