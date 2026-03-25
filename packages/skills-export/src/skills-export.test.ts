// ============================================================================
// @dantecode/skills-export — Test Suite
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

import { renderSkillMd } from "./render-skill-md.js";
import { exportAgentSkill } from "./export-agent-skill.js";
import { exportToAgentsSkills, getAgentsSkillsPath } from "./export-to-agents-skills.js";
import type { RenderableSkill, ExportableSkill } from "./index.js";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeRenderable(overrides?: Partial<RenderableSkill>): RenderableSkill {
  return {
    name: "My Skill",
    description: "What this skill does",
    instructions: "Do the thing well.",
    ...overrides,
  };
}

function makeExportable(overrides?: Partial<ExportableSkill>): ExportableSkill {
  return {
    name: "My Skill",
    slug: "my-skill",
    description: "What this skill does",
    instructions: "Do the thing well.",
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "skills-export-test-"));
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// ----------------------------------------------------------------------------
// renderSkillMd tests
// ----------------------------------------------------------------------------

describe("renderSkillMd", () => {
  it("produces --- frontmatter delimiters", () => {
    const result = renderSkillMd(makeRenderable());
    expect(result).toMatch(/^---\n/);
    expect(result).toMatch(/\n---\n/);
  });

  it("includes name and description", () => {
    const result = renderSkillMd(makeRenderable({ name: "Test Skill", description: "Desc here" }));
    expect(result).toContain("name: Test Skill");
    expect(result).toContain("description: Desc here");
  });

  it("includes license when provided", () => {
    const result = renderSkillMd(makeRenderable({ license: "MIT" }));
    expect(result).toContain("license: MIT");
  });

  it("does not include license key when omitted", () => {
    const result = renderSkillMd(makeRenderable({ license: undefined }));
    expect(result).not.toContain("license:");
  });

  it("renders compatibility as YAML array", () => {
    const result = renderSkillMd(makeRenderable({ compatibility: ["claude", "codex"] }));
    expect(result).toContain("compatibility:");
    expect(result).toContain("  - claude");
    expect(result).toContain("  - codex");
  });

  it("renders allowed-tools as YAML array with hyphenated key", () => {
    const result = renderSkillMd(makeRenderable({ allowedTools: ["Read", "Write"] }));
    expect(result).toContain("allowed-tools:");
    expect(result).toContain("  - Read");
    expect(result).toContain("  - Write");
  });

  it("instructions body appears after the closing --- delimiter", () => {
    const result = renderSkillMd(makeRenderable({ instructions: "Follow these steps carefully." }));
    const closingIdx = result.indexOf("\n---\n");
    const bodyStart = result.indexOf("Follow these steps carefully.");
    expect(closingIdx).toBeGreaterThan(0);
    expect(bodyStart).toBeGreaterThan(closingIdx);
  });

  it("has a blank line between the frontmatter and body", () => {
    const result = renderSkillMd(makeRenderable({ instructions: "Body text" }));
    // The closing --- is followed by \n\n then the body
    expect(result).toContain("---\n\nBody text");
  });

  it("skips allowedTools when includeAllowedTools=false", () => {
    const result = renderSkillMd(makeRenderable({ allowedTools: ["Read", "Write"] }), {
      includeAllowedTools: false,
    });
    expect(result).not.toContain("allowed-tools:");
  });

  it("skips compatibility when includeCompatibility=false", () => {
    const result = renderSkillMd(makeRenderable({ compatibility: ["claude", "codex"] }), {
      includeCompatibility: false,
    });
    expect(result).not.toContain("compatibility:");
  });

  it("does not render empty keys for missing optional fields", () => {
    const result = renderSkillMd(makeRenderable());
    // No undefined/empty keys should appear
    expect(result).not.toContain("license:");
    expect(result).not.toContain("compatibility:");
    expect(result).not.toContain("allowed-tools:");
    expect(result).not.toContain("metadata:");
  });

  it("round-trip: rendered output has correct structure", () => {
    const skill = makeRenderable({
      name: "Round Trip Skill",
      description: "Test round trip",
      license: "Apache-2.0",
      compatibility: ["claude", "codex"],
      allowedTools: ["Read"],
      instructions: "# Instructions\nDo the thing.",
    });
    const rendered = renderSkillMd(skill);

    // Check structural markers
    expect(rendered.startsWith("---\n")).toBe(true);
    // Has exactly two --- delimiters (multiline + global flags to count all)
    const delimCount = (rendered.match(/^---$/gm) ?? []).length;
    expect(delimCount).toBe(2);
    // Name and description are present
    expect(rendered).toContain("name: Round Trip Skill");
    expect(rendered).toContain("description: Test round trip");
    // Instructions appear after frontmatter
    const parts = rendered.split("\n---\n");
    expect(parts.length).toBe(2);
    expect(parts[1]).toContain("# Instructions");
  });

  it("includes metadata fields when includeMetadata=true", () => {
    const result = renderSkillMd(makeRenderable({ metadata: { customField: "customValue" } }), {
      includeMetadata: true,
    });
    expect(result).toContain("customField: customValue");
  });

  it("excludes metadata fields when includeMetadata=false (default)", () => {
    const result = renderSkillMd(makeRenderable({ metadata: { customField: "customValue" } }));
    expect(result).not.toContain("customField:");
  });
});

// ----------------------------------------------------------------------------
// exportAgentSkill tests
// ----------------------------------------------------------------------------

describe("exportAgentSkill", () => {
  it("creates <outDir>/<slug>/SKILL.md file", async () => {
    const skill = makeExportable({ slug: "test-skill" });
    await exportAgentSkill(skill, tmpDir);

    const expectedPath = join(tmpDir, "test-skill", "SKILL.md");
    await expect(access(expectedPath)).resolves.toBeUndefined();
  });

  it("returns ok:true and correct outputPath", async () => {
    const skill = makeExportable({ slug: "ok-skill" });
    const result = await exportAgentSkill(skill, tmpDir);

    expect(result.ok).toBe(true);
    expect(result.outputPath).toBe(join(tmpDir, "ok-skill", "SKILL.md"));
  });

  it("creates parent directory if not exists", async () => {
    const nestedOutDir = join(tmpDir, "nested", "output");
    const skill = makeExportable({ slug: "nested-skill" });
    const result = await exportAgentSkill(skill, nestedOutDir);

    expect(result.ok).toBe(true);
    const expectedPath = join(nestedOutDir, "nested-skill", "SKILL.md");
    await expect(access(expectedPath)).resolves.toBeUndefined();
  });

  it("SKILL.md content starts with ---", async () => {
    const skill = makeExportable({ slug: "content-check" });
    const result = await exportAgentSkill(skill, tmpDir);

    const content = await readFile(result.outputPath!, "utf-8");
    expect(content.startsWith("---\n")).toBe(true);
  });

  it("emits SKILL-008 warning when provenance fields present", async () => {
    const skill = makeExportable({
      slug: "provenance-skill",
      provenance: {
        sourceType: "hf",
        license: "Apache-2.0",
        importedAt: "2026-01-01",
      },
    });
    const result = await exportAgentSkill(skill, tmpDir);

    expect(result.ok).toBe(true);
    const skill008 = result.warnings.find((w) => w.code === "SKILL-008");
    expect(skill008).toBeDefined();
    expect(skill008?.field).toBe("provenance");
  });

  it("no warnings when skill is pure Agent Skills compatible", async () => {
    const skill = makeExportable({
      slug: "pure-skill",
      license: "MIT",
      compatibility: ["claude"],
      allowedTools: ["Read"],
    });
    const result = await exportAgentSkill(skill, tmpDir);

    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("existing directory is OK — no error on second export", async () => {
    const skill = makeExportable({ slug: "idempotent-skill" });
    // Export twice — should not error
    const r1 = await exportAgentSkill(skill, tmpDir);
    const r2 = await exportAgentSkill(skill, tmpDir);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// exportToAgentsSkills tests
// ----------------------------------------------------------------------------

describe("exportToAgentsSkills", () => {
  it("exports to targetRoot/.agents/skills/<slug>/SKILL.md", async () => {
    const skill = makeExportable({ slug: "agents-skill" });
    const result = await exportToAgentsSkills(skill, tmpDir);

    expect(result.ok).toBe(true);
    const expectedPath = join(tmpDir, ".agents", "skills", "agents-skill", "SKILL.md");
    await expect(access(expectedPath)).resolves.toBeUndefined();
  });

  it("returns correct outputPath", async () => {
    const skill = makeExportable({ slug: "path-check" });
    const result = await exportToAgentsSkills(skill, tmpDir);

    expect(result.outputPath).toBe(join(tmpDir, ".agents", "skills", "path-check", "SKILL.md"));
  });
});

// ----------------------------------------------------------------------------
// getAgentsSkillsPath tests
// ----------------------------------------------------------------------------

describe("getAgentsSkillsPath", () => {
  it("returns correct path without creating files", () => {
    const path = getAgentsSkillsPath("my-skill", "/repo/root");
    expect(path).toBe(join("/repo/root", ".agents", "skills", "my-skill", "SKILL.md"));
  });

  it("handles slugs with hyphens correctly", () => {
    const path = getAgentsSkillsPath("code-review-pro", "/home/user/project");
    expect(path).toContain("code-review-pro");
    expect(path.endsWith("SKILL.md")).toBe(true);
  });

  it("does not create any files — pure path calculation", async () => {
    const path = getAgentsSkillsPath("no-create-skill", tmpDir);
    // File should NOT exist
    await expect(access(path)).rejects.toThrow();
  });
});

// ----------------------------------------------------------------------------
// Full export flow tests
// ----------------------------------------------------------------------------

describe("full export flow", () => {
  it("create skill → exportToAgentsSkills → verify file exists at correct path", async () => {
    const skill: ExportableSkill = {
      name: "Full Flow Skill",
      slug: "full-flow-skill",
      description: "End-to-end export test",
      license: "MIT",
      compatibility: ["claude", "codex"],
      allowedTools: ["Read", "Write"],
      instructions: "# Full Flow\nDo everything.",
    };

    const result = await exportToAgentsSkills(skill, tmpDir);

    expect(result.ok).toBe(true);
    const expectedPath = join(tmpDir, ".agents", "skills", "full-flow-skill", "SKILL.md");
    expect(result.outputPath).toBe(expectedPath);

    const content = await readFile(expectedPath, "utf-8");
    expect(content).toContain("name: Full Flow Skill");
    expect(content).toContain("license: MIT");
    expect(content).toContain("# Full Flow");
  });

  it("round-trip: export then check SKILL.md has name + description from skill", async () => {
    const skill: ExportableSkill = {
      name: "Round Trip Export",
      slug: "round-trip-export",
      description: "Verify name and description survive export",
      instructions: "These are the instructions.",
    };

    const result = await exportToAgentsSkills(skill, tmpDir);
    const content = await readFile(result.outputPath!, "utf-8");

    expect(content).toContain("name: Round Trip Export");
    expect(content).toContain("description: Verify name and description survive export");
  });

  it("skill with all Dante-specific metadata generates SKILL-008 warning", async () => {
    const skill: ExportableSkill = {
      name: "Dante Skill",
      slug: "dante-skill",
      description: "Skill with full Dante metadata",
      instructions: "Run the gauntlet.",
      provenance: {
        sourceType: "dantecode",
        license: "MIT",
        importedAt: "2026-01-01T00:00:00Z",
        sessionId: "sess-abc123",
        receiptChainHash: "abcdef1234567890",
      },
      metadata: {
        danteVersion: "1.0.0",
        forgeScore: "95",
      },
    };

    const result = await exportAgentSkill(skill, tmpDir);

    expect(result.ok).toBe(true);
    const warning = result.warnings.find((w) => w.code === "SKILL-008");
    expect(warning).toBeDefined();
    expect(warning?.message).toMatch(/provenance/i);
  });
});
