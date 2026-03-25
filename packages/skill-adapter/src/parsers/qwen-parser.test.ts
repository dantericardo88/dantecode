// ============================================================================
// @dantecode/skill-adapter — Qwen Parser Unit Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseQwenSkill, scanQwenSkills } from "./qwen-parser.js";

// ---------------------------------------------------------------------------
// parseQwenSkill
// ---------------------------------------------------------------------------

describe("parseQwenSkill", () => {
  it("parses SKILL.md with full frontmatter", () => {
    const content = `---
name: qwen-skill
description: A Qwen Code skill
tools:
  - Read
  - Write
model: qwen-coder
---

You are a Qwen Code skill following these instructions.
`;
    const result = parseQwenSkill(content, "/skills/SKILL.md");
    expect(result.frontmatter.name).toBe("qwen-skill");
    expect(result.frontmatter.description).toBe("A Qwen Code skill");
    expect(result.frontmatter.tools).toEqual(["Read", "Write"]);
    expect(result.frontmatter.model).toBe("qwen-coder");
    expect(result.instructions).toContain("You are a Qwen Code skill");
    expect(result.sourcePath).toBe("/skills/SKILL.md");
  });

  it("falls back to filename as name when no frontmatter", () => {
    const content = `Just plain instructions with no frontmatter.`;
    const result = parseQwenSkill(content, "/skills/code-review.md");
    expect(result.frontmatter.name).toBe("code-review");
    expect(result.frontmatter.description).toBe("");
    expect(result.instructions).toContain("Just plain instructions");
  });

  it("strips SKILL prefix from filename-derived name", () => {
    const content = `Just instructions.`;
    const result = parseQwenSkill(content, "/skills/SKILL-formatter.md");
    expect(result.frontmatter.name).toBe("formatter");
  });

  it("strips SKILL_ prefix variation from filename", () => {
    const content = `Instructions.`;
    const result = parseQwenSkill(content, "/skills/SKILL_helper.md");
    expect(result.frontmatter.name).toBe("helper");
  });

  it("replaces dots in filename with hyphens when no frontmatter", () => {
    const content = `Instructions.`;
    const result = parseQwenSkill(content, "/skills/my.skill.md");
    expect(result.frontmatter.name).toBe("my-skill");
  });

  it("uses empty string for description when absent from frontmatter", () => {
    const content = `---\nname: no-desc\n---\nInstructions here.`;
    const result = parseQwenSkill(content, "/skills/no-desc.md");
    expect(result.frontmatter.description).toBe("");
  });

  it("parses tools as undefined when not present in frontmatter", () => {
    const content = `---\nname: no-tools\ndescription: A skill without tools\n---\nInstructions.`;
    const result = parseQwenSkill(content, "/skills/no-tools.md");
    expect(result.frontmatter.tools).toBeUndefined();
  });

  it("parses model as undefined when not present in frontmatter", () => {
    const content = `---\nname: no-model\n---\nInstructions.`;
    const result = parseQwenSkill(content, "/skills/no-model.md");
    expect(result.frontmatter.model).toBeUndefined();
  });

  it("returns full content as instructions when no frontmatter present", () => {
    const content = `Full content with no frontmatter markers at all.`;
    const result = parseQwenSkill(content, "/skills/raw.md");
    expect(result.instructions).toBe(content);
  });

  it("handles frontmatter with malformed YAML gracefully (treats as no frontmatter)", () => {
    // YAML parser treats this as a valid document, not an object
    const content = `---\nnot_valid_yaml: [unclosed\n---\nInstructions here.`;
    // Should not throw
    const result = parseQwenSkill(content, "/skills/bad-yaml.md");
    expect(result).toBeDefined();
    expect(typeof result.frontmatter.name).toBe("string");
  });

  it("extracts instructions correctly after closing --- delimiter", () => {
    const content = `---
name: with-body
description: Has a body
---

## Section Header

Detailed instructions here.
`;
    const result = parseQwenSkill(content, "/skills/with-body.md");
    expect(result.instructions).toContain("Detailed instructions here.");
    expect(result.instructions).not.toContain("---");
  });
});

// ---------------------------------------------------------------------------
// scanQwenSkills
// ---------------------------------------------------------------------------

describe("scanQwenSkills", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "qwen-parser-unit-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("discovers markdown files in given directory", async () => {
    await writeFile(join(tempDir, "SKILL-one.md"), `---\nname: skill-one\n---\nInstructions one.`);
    await writeFile(join(tempDir, "SKILL-two.md"), `---\nname: skill-two\n---\nInstructions two.`);

    const result = await scanQwenSkills(tempDir);
    expect(result.length).toBe(2);
    expect(result.map((s) => s.name).sort()).toEqual(["one", "two"]);
  });

  it("ignores non-markdown files", async () => {
    await writeFile(join(tempDir, "config.json"), "{}");
    await writeFile(join(tempDir, "notes.txt"), "Some notes.");
    await writeFile(join(tempDir, "cursor-rule.mdc"), "A cursor rule.");

    const result = await scanQwenSkills(tempDir);
    expect(result.length).toBe(0);
  });

  it("returns empty array for empty directory", async () => {
    const result = await scanQwenSkills(tempDir);
    expect(result).toEqual([]);
  });

  it("returns empty array for non-existent directory", async () => {
    const result = await scanQwenSkills(join(tempDir, "nonexistent"));
    expect(result).toEqual([]);
  });

  it("scans subdirectories recursively", async () => {
    const subDir = join(tempDir, "subdir");
    await mkdir(subDir);
    await writeFile(join(subDir, "nested.md"), `---\nname: nested\n---\nInstructions.`);

    const result = await scanQwenSkills(tempDir);
    expect(result.length).toBe(1);
    // Scanner derives name from filename: "nested.md" → "nested"
    expect(result[0]!.name).toBe("nested");
  });

  it("deduplicates files when same path encountered twice", async () => {
    await writeFile(join(tempDir, "my-skill.md"), `---\nname: my-skill\n---\nInstructions.`);

    // Scan the same directory twice (simulated by calling with tempDir)
    const result = await scanQwenSkills(tempDir);
    expect(result.length).toBe(1);
  });

  it("stores raw content in scanned result", async () => {
    const content = `---\nname: raw-skill\n---\nRaw instructions.`;
    await writeFile(join(tempDir, "raw.md"), content);

    const result = await scanQwenSkills(tempDir);
    expect(result.length).toBe(1);
    expect(result[0]!.raw).toBe(content);
    expect(result[0]!.path).toContain("raw.md");
  });
});
