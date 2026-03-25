import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { parseFrontmatter } from "./parse-frontmatter.js";
import { parseSkillMd } from "./parse-skill-md.js";
import type { AgentSkillParsed } from "./parse-skill-md.js";
import { validateAgentSkill } from "./validate-agent-skill.js";
import { getBuiltinHFManifest, loadHFManifest } from "./hf-manifest.js";
import { installHFSkill } from "./install-hf-skill.js";

// Helper: build a valid SKILL.md string
function buildSkillMd(opts: {
  name?: string;
  description?: string;
  compatibility?: string[];
  allowedTools?: string[];
  license?: string;
  body?: string;
}): string {
  const lines: string[] = ["---"];
  if (opts.name !== undefined) lines.push(`name: ${opts.name}`);
  if (opts.description !== undefined) lines.push(`description: ${opts.description}`);
  if (opts.license !== undefined) lines.push(`license: ${opts.license}`);
  if (opts.compatibility && opts.compatibility.length > 0) {
    lines.push("compatibility:");
    for (const c of opts.compatibility) lines.push(`  - ${c}`);
  }
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    lines.push("allowed-tools:");
    for (const t of opts.allowedTools) lines.push(`  - ${t}`);
  }
  lines.push("---");
  lines.push("");
  lines.push(opts.body ?? "This is the instructions body for the skill.");
  return lines.join("\n");
}

// Temp dir helpers
let tempDir: string;

beforeEach(async () => {
  tempDir = join(
    tmpdir(),
    `skills-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---- parseFrontmatter tests ----

describe("parseFrontmatter", () => {
  it("valid YAML-like frontmatter returns ok:true with correct data", () => {
    const content = `---\nname: My Skill\ndescription: Does something\nlicense: MIT\n---\n\nBody here.`;
    const result = parseFrontmatter(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data["name"]).toBe("My Skill");
    expect(result.data["description"]).toBe("Does something");
    expect(result.data["license"]).toBe("MIT");
  });

  it("missing --- delimiters returns ok:false", () => {
    const content = `name: My Skill\ndescription: Does something`;
    const result = parseFrontmatter(content);
    expect(result.ok).toBe(false);
  });

  it("only opening --- but no closing returns ok:false", () => {
    const content = `---\nname: My Skill\ndescription: Does something`;
    const result = parseFrontmatter(content);
    expect(result.ok).toBe(false);
  });

  it("array values parsed correctly for compatibility", () => {
    const content = `---\nname: Test\ndescription: Desc\ncompatibility:\n  - claude\n  - codex\n---\n\nBody`;
    const result = parseFrontmatter(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data["compatibility"]).toEqual(["claude", "codex"]);
  });

  it("array values parsed correctly for allowed-tools", () => {
    const content = `---\nname: Test\ndescription: Desc\nallowed-tools:\n  - Read\n  - Write\n---\n\nBody`;
    const result = parseFrontmatter(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data["allowed-tools"]).toEqual(["Read", "Write"]);
  });

  it("quoted strings are unquoted", () => {
    const content = `---\nname: "Quoted Skill"\ndescription: 'Single Quoted'\n---\n\nBody`;
    const result = parseFrontmatter(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data["name"]).toBe("Quoted Skill");
    expect(result.data["description"]).toBe("Single Quoted");
  });
});

// ---- parseSkillMd tests ----

describe("parseSkillMd", () => {
  it("valid SKILL.md with name + description returns ok:true", () => {
    const content = buildSkillMd({
      name: "My Skill",
      description: "Does something useful",
    });
    const result = parseSkillMd(content, "/skills/my-skill/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill.name).toBe("My Skill");
    expect(result.skill.description).toBe("Does something useful");
  });

  it("missing name returns ok:false with SKILL-002", () => {
    const content = buildSkillMd({ description: "Does something useful" });
    const result = parseSkillMd(content, "/skills/SKILL.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("SKILL-002");
  });

  it("missing description returns ok:false with SKILL-003", () => {
    const content = buildSkillMd({ name: "My Skill" });
    const result = parseSkillMd(content, "/skills/SKILL.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("SKILL-003");
  });

  it("malformed frontmatter returns ok:false with SKILL-001", () => {
    const content = `name: My Skill\ndescription: No frontmatter delimiters`;
    const result = parseSkillMd(content, "/skills/SKILL.md");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("SKILL-001");
  });

  it("body after frontmatter is extracted as instructions", () => {
    const content = buildSkillMd({
      name: "My Skill",
      description: "Desc",
      body: "These are the actual instructions for the skill.",
    });
    const result = parseSkillMd(content, "/skills/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill.instructions).toContain("These are the actual instructions for the skill.");
  });

  it("allowed-tools in frontmatter mapped to allowedTools field", () => {
    const content = buildSkillMd({
      name: "My Skill",
      description: "Desc",
      allowedTools: ["Read", "Write", "Bash"],
    });
    const result = parseSkillMd(content, "/skills/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill.allowedTools).toEqual(["Read", "Write", "Bash"]);
  });

  it("hasScripts/hasReferences/hasAssets propagated from opts", () => {
    const content = buildSkillMd({ name: "My Skill", description: "Desc" });
    const result = parseSkillMd(content, "/skills/SKILL.md", {
      hasScripts: true,
      hasReferences: true,
      hasAssets: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill.hasScripts).toBe(true);
    expect(result.skill.hasReferences).toBe(true);
    expect(result.skill.hasAssets).toBe(true);
  });

  it("compatibility in frontmatter parsed as array", () => {
    const content = buildSkillMd({
      name: "My Skill",
      description: "Desc",
      compatibility: ["claude", "codex"],
    });
    const result = parseSkillMd(content, "/skills/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill.compatibility).toEqual(["claude", "codex"]);
  });

  it("sourcePath is preserved on parsed skill", () => {
    const content = buildSkillMd({ name: "My Skill", description: "Desc" });
    const result = parseSkillMd(content, "/absolute/path/SKILL.md");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill.sourcePath).toBe("/absolute/path/SKILL.md");
  });
});

// ---- validateAgentSkill tests ----

describe("validateAgentSkill", () => {
  function makeValidParsed(overrides: Partial<AgentSkillParsed> = {}): AgentSkillParsed {
    return {
      name: "valid-skill",
      description: "A valid skill with sufficient description",
      instructions: "These are instructions that are definitely long enough.",
      hasScripts: false,
      hasReferences: false,
      hasAssets: false,
      sourcePath: "/skills/valid-skill/SKILL.md",
      ...overrides,
    };
  }

  it("valid skill returns valid:true, no errors", () => {
    const skill = makeValidParsed();
    const result = validateAgentSkill(skill);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("empty name returns SKILL-002", () => {
    const skill = makeValidParsed({ name: "" });
    const result = validateAgentSkill(skill);
    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("SKILL-002");
  });

  it("empty description returns SKILL-003", () => {
    const skill = makeValidParsed({ description: "" });
    const result = validateAgentSkill(skill);
    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("SKILL-003");
  });

  it("allowed-tools present generates advisory warning", () => {
    const skill = makeValidParsed({ allowedTools: ["Read", "Write"] });
    const result = validateAgentSkill(skill);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    const warnCodes = result.warnings.map((w) => w.code);
    expect(warnCodes).toContain("SKILL-WARN-001");
  });

  it("very short instructions generates warning", () => {
    const skill = makeValidParsed({ instructions: "short" });
    const result = validateAgentSkill(skill);
    expect(result.valid).toBe(true);
    const warnCodes = result.warnings.map((w) => w.code);
    expect(warnCodes).toContain("SKILL-WARN-002");
  });

  it("multiple errors returned together", () => {
    const skill = makeValidParsed({ name: "", description: "" });
    const result = validateAgentSkill(skill);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("SKILL-002");
    expect(codes).toContain("SKILL-003");
  });
});

// ---- getBuiltinHFManifest tests ----

describe("getBuiltinHFManifest", () => {
  it("returns manifest with at least 3 entries", () => {
    const manifest = getBuiltinHFManifest();
    expect(manifest.skills.length).toBeGreaterThanOrEqual(3);
  });

  it("all entries have license set", () => {
    const manifest = getBuiltinHFManifest();
    for (const skill of manifest.skills) {
      expect(skill.license).toBeTruthy();
    }
  });

  it("all entries have name and description", () => {
    const manifest = getBuiltinHFManifest();
    for (const skill of manifest.skills) {
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
    }
  });

  it("has correct structure", () => {
    const manifest = getBuiltinHFManifest();
    expect(manifest.version).toBeTruthy();
    expect(manifest.source).toBeTruthy();
    expect(Array.isArray(manifest.skills)).toBe(true);
  });
});

// ---- loadHFManifest tests ----

describe("loadHFManifest", () => {
  it("returns ok:false for nonexistent file", async () => {
    const result = await loadHFManifest(join(tempDir, "nonexistent-manifest.json"));
    expect(result.ok).toBe(false);
  });

  it("returns ok:true for a valid manifest JSON file", async () => {
    const manifest = getBuiltinHFManifest();
    const manifestPath = join(tempDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest), "utf-8");
    const result = await loadHFManifest(manifestPath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.skills.length).toBeGreaterThanOrEqual(3);
  });

  it("returns ok:false for malformed JSON", async () => {
    const manifestPath = join(tempDir, "bad-manifest.json");
    await writeFile(manifestPath, "{ invalid json }", "utf-8");
    const result = await loadHFManifest(manifestPath);
    expect(result.ok).toBe(false);
  });
});

// ---- installHFSkill tests ----

describe("installHFSkill", () => {
  function makeEntry(
    overrides: Partial<{
      name: string;
      description: string;
      sourceRepo: string;
      sourcePath: string;
      license: string;
      compatibility: string[];
      version: string;
    }> = {},
  ) {
    return {
      name: "test-skill",
      description: "A test skill for unit testing",
      sourceRepo: "huggingface/hf-agent-skills",
      sourcePath: "skills/test-skill/SKILL.md",
      license: "Apache-2.0",
      compatibility: ["claude", "codex"],
      version: "1.0.0",
      ...overrides,
    };
  }

  it("creates SKILL.md at correct path with provenance", async () => {
    const entry = makeEntry();
    const result = await installHFSkill({ entry, projectRoot: tempDir });
    expect(result.ok).toBe(true);
    expect(result.skillPath).toContain("test-skill");
    expect(result.skillPath).toContain("SKILL.md");
    // File should exist
    const content = await readFile(result.skillPath!, "utf-8");
    expect(content).toContain("test-skill");
    expect(content).toContain("Apache-2.0");
  });

  it("SKILL-006 when entry has no license", async () => {
    const entry = makeEntry({ license: "" });
    const result = await installHFSkill({ entry, projectRoot: tempDir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SKILL-006");
  });

  it("skips if already installed and force=false", async () => {
    const entry = makeEntry();
    // First install
    const first = await installHFSkill({ entry, projectRoot: tempDir });
    expect(first.ok).toBe(true);
    expect(first.skipped).toBeFalsy();
    // Second install without force
    const second = await installHFSkill({
      entry,
      projectRoot: tempDir,
      force: false,
    });
    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(true);
  });

  it("overwrites if force=true", async () => {
    const entry = makeEntry();
    // First install
    await installHFSkill({ entry, projectRoot: tempDir });
    // Second install with force
    const second = await installHFSkill({
      entry,
      projectRoot: tempDir,
      force: true,
    });
    expect(second.ok).toBe(true);
    expect(second.skipped).toBeFalsy();
  });

  it("sets sourceType='hf' in created SKILL.md", async () => {
    const entry = makeEntry();
    const result = await installHFSkill({ entry, projectRoot: tempDir });
    expect(result.ok).toBe(true);
    const content = await readFile(result.skillPath!, "utf-8");
    expect(content).toContain("source-type: hf");
  });

  it("includes imported-at timestamp in created SKILL.md", async () => {
    const entry = makeEntry();
    const result = await installHFSkill({ entry, projectRoot: tempDir });
    expect(result.ok).toBe(true);
    const content = await readFile(result.skillPath!, "utf-8");
    expect(content).toContain("imported-at:");
  });

  it("includes compatibility in created SKILL.md", async () => {
    const entry = makeEntry({ compatibility: ["claude", "qwen"] });
    const result = await installHFSkill({ entry, projectRoot: tempDir });
    expect(result.ok).toBe(true);
    const content = await readFile(result.skillPath!, "utf-8");
    expect(content).toContain("claude");
    expect(content).toContain("qwen");
  });
});

// ---- Full flow integration test ----

describe("Full flow integration", () => {
  it("parseSkillMd → validateAgentSkill → installHFSkill round-trip", async () => {
    // 1. Build and parse a SKILL.md
    const skillMdContent = buildSkillMd({
      name: "integration-skill",
      description: "An integration test skill",
      compatibility: ["claude", "codex"],
      allowedTools: ["Read"],
      license: "MIT",
      body: "These are the detailed instructions for the integration skill. They are long enough.",
    });
    const parseResult = parseSkillMd(skillMdContent, "/project/skills/integration-skill/SKILL.md");
    expect(parseResult.ok).toBe(true);
    if (!parseResult.ok) return;

    // 2. Validate parsed skill
    const validation = validateAgentSkill(parseResult.skill);
    expect(validation.valid).toBe(true);
    // Should have advisory warning for allowed-tools
    expect(validation.warnings.some((w) => w.code === "SKILL-WARN-001")).toBe(true);

    // 3. Install an HF skill
    const entry = {
      name: "integration-skill",
      description: "An integration test skill",
      sourceRepo: "huggingface/hf-agent-skills",
      sourcePath: "skills/integration-skill/SKILL.md",
      license: "MIT",
    };
    const installResult = await installHFSkill({
      entry,
      projectRoot: tempDir,
    });
    expect(installResult.ok).toBe(true);
    expect(installResult.skillPath).toBeDefined();

    // 4. Read back and parse the installed SKILL.md
    const installedContent = await readFile(installResult.skillPath!, "utf-8");
    const reparsed = parseSkillMd(installedContent, installResult.skillPath!);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.skill.name).toBe("integration-skill");
  });
});
