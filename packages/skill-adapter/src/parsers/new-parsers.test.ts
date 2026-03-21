import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCodexSkill, scanCodexSkills } from "./codex-parser.js";
import { parseCursorRule, scanCursorRules } from "./cursor-parser.js";
import { parseQwenSkill, scanQwenSkills } from "./qwen-parser.js";
import { detectSkillSources } from "./universal-parser.js";

// ---------------------------------------------------------------------------
// Codex Parser Tests
// ---------------------------------------------------------------------------

describe("codex parser", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "codex-parser-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("parseCodexSkill", () => {
    it("parses TOML with all fields", () => {
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
      const content = `name = "minimal-agent"
`;
      const result = parseCodexSkill(content, "/agents/minimal-agent.toml");
      expect(result.frontmatter.name).toBe("minimal-agent");
      expect(result.frontmatter.description).toBe("");
      expect(result.instructions).toBe("");
      expect(result.metadata).toBeUndefined();
    });

    it("handles malformed TOML gracefully and falls back to filename", () => {
      const content = `this is not valid toml at all !!!
=== broken ===
{{{{`;
      const result = parseCodexSkill(content, "/agents/broken-agent.toml");
      // Should not throw; name falls back to filename
      expect(result.frontmatter.name).toBe("broken-agent");
      expect(result.sourcePath).toBe("/agents/broken-agent.toml");
    });

    it("parses markdown SKILL.md file (no TOML)", () => {
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

    it("extracts mcp_servers array from TOML", () => {
      const content = `name = "mcp-agent"
mcp_servers = ["server-a", "server-b", "server-c"]
developer_instructions = "Use MCP servers."
`;
      const result = parseCodexSkill(content, "/agents/mcp-agent.toml");
      expect(result.metadata?.mcpServers).toEqual(["server-a", "server-b", "server-c"]);
    });

    it("parses boolean fields in TOML", () => {
      const content = `name = "bool-agent"
some_flag = true
other_flag = false
developer_instructions = "Boolean test."
`;
      const result = parseCodexSkill(content, "/agents/bool-agent.toml");
      // The parser should not throw on boolean fields
      expect(result.frontmatter.name).toBe("bool-agent");
      expect(result.instructions).toBe("Boolean test.");
    });

    it("scanCodexSkills discovers TOML and markdown files from a temp directory", async () => {
      // Create agent TOML files in a sub-dir named "agents"
      const agentsDir = join(tempDir, "agents");
      const skillsDir = join(tempDir, "skills");
      await mkdir(agentsDir);
      await mkdir(skillsDir);

      await writeFile(
        join(agentsDir, "agent-one.toml"),
        `name = "agent-one"\ndeveloper_instructions = "Do something."`,
      );
      await writeFile(
        join(skillsDir, "my-skill.md"),
        `---\nname: my-skill\n---\nInstructions.`,
      );

      const resultFromSkillsDir = await scanCodexSkills(skillsDir);
      expect(resultFromSkillsDir.length).toBe(1);
      expect(resultFromSkillsDir[0]!.format).toBe("markdown");
      expect(resultFromSkillsDir[0]!.name).toBe("my-skill");
    });
  });
});

// ---------------------------------------------------------------------------
// Cursor Parser Tests
// ---------------------------------------------------------------------------

describe("cursor parser", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cursor-parser-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("parseCursorRule", () => {
    it("parses .mdc file with frontmatter (name, description, alwaysApply, globs)", () => {
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
      const content = `---
name: global-rule
alwaysApply: true
---

This rule always applies.
`;
      const result = parseCursorRule(content, "/rules/global-rule.mdc");
      expect(result.cursorMetadata.alwaysApply).toBe(true);
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
      const content = `---
name: no-body
description: Has no body content
alwaysApply: false
---
`;
      const result = parseCursorRule(content, "/rules/no-body.mdc");
      expect(result.frontmatter.name).toBe("no-body");
      expect(result.instructions).toBe("");
    });

    it("scanCursorRules discovers .mdc files in temp directory", async () => {
      await writeFile(
        join(tempDir, "rule-one.mdc"),
        `---\nname: rule-one\nalwaysApply: false\n---\nDo something.`,
      );
      await writeFile(
        join(tempDir, "rule-two.mdc"),
        `---\nname: rule-two\nalwaysApply: true\n---\nDo more.`,
      );
      // Non-.mdc file — should be ignored
      await writeFile(join(tempDir, "ignored.md"), "Not an mdc file.");

      const result = await scanCursorRules(tempDir);
      expect(result.length).toBe(2);
      expect(result.map((r) => r.name).sort()).toEqual(["rule-one", "rule-two"]);
    });
  });
});

// ---------------------------------------------------------------------------
// Qwen Parser Tests
// ---------------------------------------------------------------------------

describe("qwen parser", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "qwen-parser-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("parseQwenSkill", () => {
    it("parses SKILL.md with frontmatter", () => {
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

    it("scanQwenSkills discovers markdown files in temp directory", async () => {
      await writeFile(
        join(tempDir, "SKILL-one.md"),
        `---\nname: skill-one\n---\nInstructions one.`,
      );
      await writeFile(
        join(tempDir, "SKILL-two.md"),
        `---\nname: skill-two\n---\nInstructions two.`,
      );
      // Non-markdown file — should be ignored
      await writeFile(join(tempDir, "config.json"), "{}");

      const result = await scanQwenSkills(tempDir);
      expect(result.length).toBe(2);
      expect(result.map((s) => s.name).sort()).toEqual(["one", "two"]);
    });
  });
});

// ---------------------------------------------------------------------------
// Universal Parser Tests
// ---------------------------------------------------------------------------

describe("universal parser", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "universal-parser-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("detectSkillSources", () => {
    it("finds .claude/skills/ → returns { format: 'claude', confidence: 1.0 }", async () => {
      const skillsDir = join(tempDir, ".claude", "skills");
      await mkdir(skillsDir, { recursive: true });
      await writeFile(
        join(skillsDir, "my-skill.md"),
        `---\nname: my-skill\n---\nInstructions.`,
      );

      const results = await detectSkillSources(tempDir);
      const claudeResult = results.find((r) => r.format === "claude" && r.confidence === 1.0);
      expect(claudeResult).toBeDefined();
      expect(claudeResult!.paths.length).toBeGreaterThan(0);
    });

    it("finds .codex/agents/ → returns { format: 'codex', confidence: 0.8 }", async () => {
      const agentsDir = join(tempDir, ".codex", "agents");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(
        join(agentsDir, "my-agent.toml"),
        `name = "my-agent"\ndeveloper_instructions = "Do things."`,
      );

      const results = await detectSkillSources(tempDir);
      const codexResult = results.find((r) => r.format === "codex" && r.confidence === 0.8);
      expect(codexResult).toBeDefined();
      expect(codexResult!.paths.length).toBeGreaterThan(0);
    });

    it("finds .cursor/rules/ → returns { format: 'cursor', confidence: 1.0 }", async () => {
      const rulesDir = join(tempDir, ".cursor", "rules");
      await mkdir(rulesDir, { recursive: true });
      await writeFile(
        join(rulesDir, "my-rule.mdc"),
        `---\nname: my-rule\nalwaysApply: false\n---\nDo this.`,
      );

      const results = await detectSkillSources(tempDir);
      const cursorResult = results.find((r) => r.format === "cursor" && r.confidence === 1.0);
      expect(cursorResult).toBeDefined();
      expect(cursorResult!.paths.length).toBeGreaterThan(0);
    });

    it("detects multiple formats in same project", async () => {
      // Create .claude/skills/ and .cursor/rules/
      const skillsDir = join(tempDir, ".claude", "skills");
      const rulesDir = join(tempDir, ".cursor", "rules");
      await mkdir(skillsDir, { recursive: true });
      await mkdir(rulesDir, { recursive: true });

      await writeFile(
        join(skillsDir, "claude-skill.md"),
        `---\nname: claude-skill\n---\nClaude instructions.`,
      );
      await writeFile(
        join(rulesDir, "cursor-rule.mdc"),
        `---\nname: cursor-rule\nalwaysApply: false\n---\nCursor instructions.`,
      );

      const results = await detectSkillSources(tempDir);
      const formats = results.map((r) => r.format);
      expect(formats).toContain("claude");
      expect(formats).toContain("cursor");
    });

    it("returns 'universal' format for raw SKILL.md file", async () => {
      // Place a SKILL.md directly in a subdirectory
      const subDir = join(tempDir, "my-module");
      await mkdir(subDir, { recursive: true });
      await writeFile(
        join(subDir, "SKILL.md"),
        `---\nname: raw-skill\n---\nRaw instructions.`,
      );

      const results = await detectSkillSources(tempDir);
      const universalResult = results.find((r) => r.format === "universal");
      expect(universalResult).toBeDefined();
      expect(universalResult!.confidence).toBe(0.7);
      expect(universalResult!.paths.length).toBeGreaterThan(0);
    });

    it("returns empty array for empty directory", async () => {
      const results = await detectSkillSources(tempDir);
      expect(results).toEqual([]);
    });
  });
});
