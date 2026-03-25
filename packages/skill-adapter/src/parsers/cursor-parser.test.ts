// ============================================================================
// @dantecode/skill-adapter — Cursor Parser Unit Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCursorRule, scanCursorRules, extractFirstParagraph } from "./cursor-parser.js";

// ---------------------------------------------------------------------------
// extractFirstParagraph
// ---------------------------------------------------------------------------

describe("extractFirstParagraph", () => {
  it("extracts the first non-empty, non-heading line", () => {
    const body = `\n# Heading\n\nFirst real paragraph.`;
    expect(extractFirstParagraph(body)).toBe("First real paragraph.");
  });

  it("skips HTML comments", () => {
    const body = `<!-- comment -->\nActual content.`;
    expect(extractFirstParagraph(body)).toBe("Actual content.");
  });

  it("returns empty string for body with only headings", () => {
    const body = `# Heading 1\n## Heading 2`;
    expect(extractFirstParagraph(body)).toBe("");
  });

  it("truncates to 200 characters", () => {
    const longLine = "x".repeat(300);
    expect(extractFirstParagraph(longLine).length).toBe(200);
  });

  it("returns empty string for empty body", () => {
    expect(extractFirstParagraph("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseCursorRule
// ---------------------------------------------------------------------------

describe("parseCursorRule", () => {
  it("parses .mdc file with full frontmatter (name, description, alwaysApply, globs)", () => {
    const content = `---
name: typescript-style
description: TypeScript coding style rules
alwaysApply: false
globs: "**/*.ts"
---

Always use strict TypeScript. Avoid \`any\` types.
`;
    const result = parseCursorRule(content, "/rules/typescript-style.mdc");
    expect(result.frontmatter.name).toBe("typescript-style");
    expect(result.frontmatter.description).toBe("TypeScript coding style rules");
    expect(result.cursorMetadata.alwaysApply).toBe(false);
    expect(result.cursorMetadata.globs).toBe("**/*.ts");
    expect(result.instructions).toContain("Always use strict TypeScript");
    expect(result.sourcePath).toBe("/rules/typescript-style.mdc");
  });

  it("extracts alwaysApply: true correctly", () => {
    const content = `---\nname: global-rule\nalwaysApply: true\n---\n\nThis rule always applies.`;
    const result = parseCursorRule(content, "/rules/global-rule.mdc");
    expect(result.cursorMetadata.alwaysApply).toBe(true);
    expect(typeof result.cursorMetadata.alwaysApply).toBe("boolean");
  });

  it("handles .mdc without frontmatter — name from filename, alwaysApply defaults false", () => {
    const content = `Just plain instructions without any frontmatter at all.`;
    const result = parseCursorRule(content, "/rules/plain-rule.mdc");
    expect(result.frontmatter.name).toBe("plain-rule");
    expect(result.cursorMetadata.alwaysApply).toBe(false);
    expect(result.cursorMetadata.globs).toBeUndefined();
    expect(result.instructions).toContain("plain instructions");
  });

  it("handles .mdc with only frontmatter, no body — empty instructions", () => {
    const content = `---\nname: no-body\ndescription: Has no body\nalwaysApply: false\n---\n`;
    const result = parseCursorRule(content, "/rules/no-body.mdc");
    expect(result.frontmatter.name).toBe("no-body");
    expect(result.instructions).toBe("");
  });

  it('alwaysApply string "false" parses as false', () => {
    const content = `---\nname: str-false-rule\nalwaysApply: "false"\n---\nInstructions.`;
    const result = parseCursorRule(content, "/rules/str-false-rule.mdc");
    expect(result.cursorMetadata.alwaysApply).toBe(false);
  });

  it("globs YAML array is preserved as array", () => {
    const content = `---\nname: glob-array-rule\nglobs:\n  - "*.ts"\n  - "*.tsx"\n---\nInstructions.`;
    const result = parseCursorRule(content, "/rules/glob-array-rule.mdc");
    expect(Array.isArray(result.cursorMetadata.globs)).toBe(true);
    expect(result.cursorMetadata.globs).toContain("*.ts");
    expect(result.cursorMetadata.globs).toContain("*.tsx");
  });

  it("auto-extracts description from body when not in frontmatter", () => {
    const content = `---\nname: auto-desc\n---\n\nThis is the first line of instructions.`;
    const result = parseCursorRule(content, "/rules/auto-desc.mdc");
    expect(result.frontmatter.description).toBe("This is the first line of instructions.");
  });

  it("extracts model from frontmatter when present", () => {
    const content = `---\nname: model-rule\nmodel: gpt-4o\nalwaysApply: false\n---\nInstructions.`;
    const result = parseCursorRule(content, "/rules/model-rule.mdc");
    expect(result.frontmatter.model).toBe("gpt-4o");
  });

  it("name falls back to filename without .mdc extension", () => {
    const content = `Just instructions.`;
    const result = parseCursorRule(content, "/rules/my-awesome-rule.mdc");
    expect(result.frontmatter.name).toBe("my-awesome-rule");
  });

  it("replaces dots in filename with hyphens for fallback name", () => {
    const content = `Just instructions.`;
    const result = parseCursorRule(content, "/rules/some.rule.mdc");
    expect(result.frontmatter.name).toBe("some-rule");
  });
});

// ---------------------------------------------------------------------------
// scanCursorRules
// ---------------------------------------------------------------------------

describe("scanCursorRules", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cursor-parser-unit-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("discovers .mdc files in temp directory", async () => {
    await writeFile(
      join(tempDir, "rule-one.mdc"),
      `---\nname: rule-one\nalwaysApply: false\n---\nDo something.`,
    );
    await writeFile(
      join(tempDir, "rule-two.mdc"),
      `---\nname: rule-two\nalwaysApply: true\n---\nDo more.`,
    );

    const result = await scanCursorRules(tempDir);
    expect(result.length).toBe(2);
    expect(result.map((r) => r.name).sort()).toEqual(["rule-one", "rule-two"]);
  });

  it("ignores non-.mdc files", async () => {
    await writeFile(join(tempDir, "ignored.md"), "Not an mdc file.");
    await writeFile(join(tempDir, "also-ignored.txt"), "Also not mdc.");

    const result = await scanCursorRules(tempDir);
    expect(result.length).toBe(0);
  });

  it("returns empty array for empty directory", async () => {
    const result = await scanCursorRules(tempDir);
    expect(result).toEqual([]);
  });

  it("returns empty array for non-existent directory", async () => {
    const result = await scanCursorRules(join(tempDir, "nonexistent"));
    expect(result).toEqual([]);
  });

  it("stores raw file content in scanned result", async () => {
    const content = `---\nname: raw-rule\nalwaysApply: false\n---\nRaw instructions.`;
    await writeFile(join(tempDir, "raw-rule.mdc"), content);

    const result = await scanCursorRules(tempDir);
    expect(result.length).toBe(1);
    expect(result[0]!.raw).toBe(content);
    expect(result[0]!.path).toContain("raw-rule.mdc");
  });
});
