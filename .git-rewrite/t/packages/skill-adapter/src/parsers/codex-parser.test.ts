// ============================================================================
// @dantecode/skill-adapter — Codex Parser Unit Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCodexSkill, scanCodexSkills, parseTOML } from "./codex-parser.js";

// ---------------------------------------------------------------------------
// parseTOML helpers
// ---------------------------------------------------------------------------

describe("parseTOML", () => {
  it("parses simple key=value pairs", () => {
    const toml = `name = "my-agent"\ndescription = "A test agent"`;
    const result = parseTOML(toml);
    expect(result["name"]).toBe("my-agent");
    expect(result["description"]).toBe("A test agent");
  });

  it("parses boolean values", () => {
    const toml = `enabled = true\ndisabled = false`;
    const result = parseTOML(toml);
    expect(result["enabled"]).toBe(true);
    expect(result["disabled"]).toBe(false);
  });

  it("parses arrays", () => {
    const toml = `servers = ["a", "b", "c"]`;
    const result = parseTOML(toml);
    expect(result["servers"]).toEqual(["a", "b", "c"]);
  });

  it("parses multi-line triple-quoted strings", () => {
    const toml = `instructions = """\nLine 1\nLine 2\n"""`;
    const result = parseTOML(toml);
    expect(String(result["instructions"])).toContain("Line 1");
    expect(String(result["instructions"])).toContain("Line 2");
  });

  it("skips comments and blank lines", () => {
    const toml = `# This is a comment\n\nname = "agent"`;
    const result = parseTOML(toml);
    expect(result["name"]).toBe("agent");
    expect(Object.keys(result)).not.toContain("#");
  });

  it("skips section headers", () => {
    const toml = `[section]\nname = "in-section"`;
    const result = parseTOML(toml);
    // Section header itself is skipped; key inside section is parsed
    expect(result["name"]).toBe("in-section");
  });
});

// ---------------------------------------------------------------------------
// parseCodexSkill — TOML format
// ---------------------------------------------------------------------------

describe("parseCodexSkill — TOML format", () => {
  it("parses TOML agent with all fields", () => {
    const content = `name = "my-agent"
description = "A smart coding agent"
developer_instructions = "You are a helpful coding assistant."
model = "gpt-4o"
model_reasoning_effort = "high"
sandbox_mode = "docker"
`;
    const result = parseCodexSkill(content, "/agents/my-agent.toml");
    expect(result.frontmatter.name).toBe("my-agent");
    expect(result.frontmatter.description).toBe("A smart coding agent");
    expect(result.instructions).toBe("You are a helpful coding assistant.");
    expect(result.metadata?.model).toBe("gpt-4o");
    expect(result.metadata?.reasoningEffort).toBe("high");
    expect(result.metadata?.sandboxMode).toBe("docker");
    expect(result.sourcePath).toBe("/agents/my-agent.toml");
  });

  it("parses TOML with multi-line developer_instructions using triple-quotes", () => {
    const content = `name = "multi-agent"
description = "Multi-line instructions"
developer_instructions = """
You are a coding agent.
Follow best practices.
Always write tests.
"""
`;
    const result = parseCodexSkill(content, "/agents/multi-agent.toml");
    expect(result.frontmatter.name).toBe("multi-agent");
    expect(result.instructions).toContain("You are a coding agent.");
    expect(result.instructions).toContain("Follow best practices.");
    expect(result.instructions).toContain("Always write tests.");
  });

  it("parses TOML with missing optional fields and uses defaults", () => {
    const content = `name = "minimal-agent"\n`;
    const result = parseCodexSkill(content, "/agents/minimal-agent.toml");
    expect(result.frontmatter.name).toBe("minimal-agent");
    expect(result.frontmatter.description).toBe("");
    expect(result.instructions).toBe("");
    expect(result.metadata).toBeUndefined();
  });

  it("falls back to filename as name when no name field in TOML", () => {
    const content = `description = "No name field"\ndeveloper_instructions = "Instructions."`;
    const result = parseCodexSkill(content, "/agents/my-unnamed-agent.toml");
    expect(result.frontmatter.name).toBe("my-unnamed-agent");
  });

  it("uses first nickname_candidate as name when name field is absent", () => {
    const content = `nickname_candidates = ["nick-one", "nick-two"]\ndeveloper_instructions = "Instructions."`;
    const result = parseCodexSkill(content, "/agents/agent.toml");
    expect(result.frontmatter.name).toBe("nick-one");
  });

  it("extracts mcp_servers array from TOML", () => {
    const content = `name = "mcp-agent"
mcp_servers = ["server-a", "server-b", "server-c"]
developer_instructions = "Use MCP servers."
`;
    const result = parseCodexSkill(content, "/agents/mcp-agent.toml");
    expect(result.metadata?.mcpServers).toEqual(["server-a", "server-b", "server-c"]);
  });

  it("handles TOML with no developer_instructions — empty instructions", () => {
    const content = `name = "empty-agent"\ndescription = "No instructions"`;
    const result = parseCodexSkill(content, "/agents/empty-agent.toml");
    expect(result.instructions).toBe("");
  });

  it("produces metadata undefined when no metadata fields present", () => {
    const content = `name = "no-meta"\ndeveloper_instructions = "Just instructions."`;
    const result = parseCodexSkill(content, "/agents/no-meta.toml");
    expect(result.metadata).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseCodexSkill — Markdown format
// ---------------------------------------------------------------------------

describe("parseCodexSkill — Markdown format", () => {
  it("parses markdown SKILL.md file with YAML frontmatter", () => {
    const content = `---
name: md-skill
description: A markdown skill
tools:
  - Read
  - Write
---

You are a markdown-format skill.
`;
    const result = parseCodexSkill(content, "/skills/SKILL-md-skill.md");
    expect(result.frontmatter.name).toBe("md-skill");
    expect(result.frontmatter.description).toBe("A markdown skill");
    expect(result.frontmatter.tools).toEqual(["Read", "Write"]);
    expect(result.instructions).toContain("You are a markdown-format skill.");
  });

  it("falls back to filename for markdown without frontmatter", () => {
    const content = "Just plain instructions without frontmatter.";
    const result = parseCodexSkill(content, "/skills/code-review.md");
    expect(result.frontmatter.name).toBe("code-review");
    expect(result.instructions).toContain("Just plain instructions");
  });

  it("strips SKILL prefix from filename for markdown files", () => {
    const content = "Instructions for formatter skill.";
    const result = parseCodexSkill(content, "/skills/SKILL-formatter.md");
    expect(result.frontmatter.name).toBe("formatter");
  });
});

// ---------------------------------------------------------------------------
// scanCodexSkills
// ---------------------------------------------------------------------------

describe("scanCodexSkills", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "codex-parser-unit-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("discovers markdown files from a given directory", async () => {
    await writeFile(join(tempDir, "my-skill.md"), `---\nname: my-skill\n---\nInstructions.`);

    const result = await scanCodexSkills(tempDir);
    expect(result.length).toBe(1);
    expect(result[0]!.format).toBe("markdown");
    expect(result[0]!.name).toBe("my-skill");
  });

  it("discovers TOML files from a given directory", async () => {
    await writeFile(
      join(tempDir, "my-agent.toml"),
      `name = "my-agent"\ndeveloper_instructions = "Do something."`,
    );

    const result = await scanCodexSkills(tempDir);
    expect(result.length).toBe(1);
    expect(result[0]!.format).toBe("toml");
    expect(result[0]!.name).toBe("my-agent");
  });

  it("discovers both TOML and markdown files from same directory", async () => {
    await writeFile(join(tempDir, "md-skill.md"), `---\nname: md-skill\n---\nInstructions.`);
    await writeFile(
      join(tempDir, "toml-agent.toml"),
      `name = "toml-agent"\ndeveloper_instructions = "Do things."`,
    );

    const result = await scanCodexSkills(tempDir);
    expect(result.length).toBe(2);
    const formats = result.map((r) => r.format);
    expect(formats).toContain("markdown");
    expect(formats).toContain("toml");
  });

  it("ignores non-markdown, non-TOML files", async () => {
    await writeFile(join(tempDir, "config.json"), "{}");
    await writeFile(join(tempDir, "notes.txt"), "Some notes.");

    const result = await scanCodexSkills(tempDir);
    expect(result.length).toBe(0);
  });

  it("returns empty array for empty directory", async () => {
    const result = await scanCodexSkills(tempDir);
    expect(result).toEqual([]);
  });

  it("scans subdirectories recursively for markdown files", async () => {
    const subDir = join(tempDir, "subdir");
    await mkdir(subDir);
    await writeFile(join(subDir, "my-nested.md"), `---\nname: my-nested\n---\nInstructions.`);

    const result = await scanCodexSkills(tempDir);
    expect(result.length).toBe(1);
    // Scanner derives name from filename: "my-nested.md" → "my-nested"
    expect(result[0]!.name).toBe("my-nested");
  });
});
