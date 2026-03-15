import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseClaudeSkill, scanClaudeSkills } from "./claude.js";
import { parseContinueAgent, scanContinueAgents } from "./continue.js";
import { parseOpencodeAgent, scanOpencodeAgents } from "./opencode.js";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const SKILL_WITH_FRONTMATTER = `---
name: test-skill
description: A test skill for unit tests
tools:
  - Read
  - Write
  - Bash
model: grok/grok-3
---

You are a test skill. Follow these instructions carefully.

Always produce complete, production-ready code.
`;

const SKILL_WITHOUT_FRONTMATTER = `You are a plain skill with no frontmatter.

Just follow these instructions.
`;

const SKILL_WITH_INVALID_YAML = `---
name: [broken yaml
this: is not: valid: yaml: {{}}
---

Instructions here.
`;

const SKILL_WITH_PARTIAL_FRONTMATTER = `---
name: partial-skill
---

Instructions with only name in frontmatter.
`;

// ---------------------------------------------------------------------------
// Claude Parser Tests
// ---------------------------------------------------------------------------

describe("claude parser", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claude-parser-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("parseClaudeSkill", () => {
    it("parses frontmatter with all fields", () => {
      const result = parseClaudeSkill(SKILL_WITH_FRONTMATTER, "/skills/test.md");
      expect(result.frontmatter.name).toBe("test-skill");
      expect(result.frontmatter.description).toBe("A test skill for unit tests");
      expect(result.frontmatter.tools).toEqual(["Read", "Write", "Bash"]);
      expect(result.frontmatter.model).toBe("grok/grok-3");
      expect(result.instructions).toContain("You are a test skill");
    });

    it("uses filename as fallback name when no frontmatter", () => {
      const result = parseClaudeSkill(SKILL_WITHOUT_FRONTMATTER, "/skills/my-tool.md");
      expect(result.frontmatter.name).toBe("my-tool");
      expect(result.frontmatter.description).toBe("");
      expect(result.frontmatter.tools).toBeUndefined();
      expect(result.instructions).toContain("plain skill with no frontmatter");
    });

    it("strips SKILL prefix from filename-derived name", () => {
      const result = parseClaudeSkill(SKILL_WITHOUT_FRONTMATTER, "/skills/SKILL-formatter.md");
      expect(result.frontmatter.name).toBe("formatter");
    });

    it("handles invalid YAML gracefully", () => {
      const result = parseClaudeSkill(SKILL_WITH_INVALID_YAML, "/skills/broken.md");
      expect(result.frontmatter.name).toBe("broken");
      expect(result.instructions).toContain("name: [broken yaml");
    });

    it("handles partial frontmatter (only name)", () => {
      const result = parseClaudeSkill(SKILL_WITH_PARTIAL_FRONTMATTER, "/skills/partial.md");
      expect(result.frontmatter.name).toBe("partial-skill");
      expect(result.frontmatter.description).toBe("");
      expect(result.frontmatter.tools).toBeUndefined();
      expect(result.frontmatter.model).toBeUndefined();
    });

    it("preserves sourcePath", () => {
      const result = parseClaudeSkill(SKILL_WITH_FRONTMATTER, "/home/user/.claude/skills/test.md");
      expect(result.sourcePath).toBe("/home/user/.claude/skills/test.md");
    });

    it("handles frontmatter with no closing delimiter", () => {
      const content = `---
name: unclosed
description: No closing delimiter`;
      const result = parseClaudeSkill(content, "/skills/unclosed.md");
      // Should treat entire content as instructions (no valid frontmatter)
      expect(result.frontmatter.name).toBe("unclosed");
      expect(result.instructions).toContain("name: unclosed");
    });
  });

  describe("scanClaudeSkills", () => {
    it("returns empty array for non-existent directory", async () => {
      const result = await scanClaudeSkills(join(tempDir, "nonexistent"));
      expect(result).toEqual([]);
    });

    it("discovers markdown files in directory", async () => {
      await writeFile(join(tempDir, "my-skill.md"), SKILL_WITH_FRONTMATTER);
      await writeFile(join(tempDir, "another.md"), SKILL_WITHOUT_FRONTMATTER);
      await writeFile(join(tempDir, "not-markdown.txt"), "ignored");

      const result = await scanClaudeSkills(tempDir);
      expect(result.length).toBe(2);
      expect(result.map((s) => s.name).sort()).toEqual(["another", "my-skill"]);
    });

    it("discovers files in subdirectories recursively", async () => {
      const subDir = join(tempDir, "category");
      await mkdir(subDir);
      await writeFile(join(subDir, "deep-skill.md"), SKILL_WITH_FRONTMATTER);

      const result = await scanClaudeSkills(tempDir);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe("deep-skill");
    });

    it("skips hidden directories", async () => {
      const hidden = join(tempDir, ".hidden");
      await mkdir(hidden);
      await writeFile(join(hidden, "secret.md"), SKILL_WITH_FRONTMATTER);

      const result = await scanClaudeSkills(tempDir);
      expect(result.length).toBe(0);
    });

    it("strips SKILL prefix from filenames", async () => {
      await writeFile(join(tempDir, "SKILL-formatter.md"), SKILL_WITH_FRONTMATTER);
      await writeFile(join(tempDir, "SKILL_linter.md"), SKILL_WITH_FRONTMATTER);

      const result = await scanClaudeSkills(tempDir);
      const names = result.map((s) => s.name).sort();
      expect(names).toEqual(["formatter", "linter"]);
    });
  });
});

// ---------------------------------------------------------------------------
// Continue Parser Tests
// ---------------------------------------------------------------------------

describe("continue parser", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "continue-parser-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("parseContinueAgent", () => {
    it("parses frontmatter with all fields", () => {
      const result = parseContinueAgent(SKILL_WITH_FRONTMATTER, "/agents/test.md");
      expect(result.frontmatter.name).toBe("test-skill");
      expect(result.frontmatter.description).toBe("A test skill for unit tests");
      expect(result.frontmatter.tools).toEqual(["Read", "Write", "Bash"]);
      expect(result.frontmatter.model).toBe("grok/grok-3");
    });

    it("uses filename as fallback name", () => {
      const result = parseContinueAgent(SKILL_WITHOUT_FRONTMATTER, "/agents/code-review.md");
      expect(result.frontmatter.name).toBe("code-review");
    });

    it("converts dots and underscores in filename to dashes", () => {
      const result = parseContinueAgent(SKILL_WITHOUT_FRONTMATTER, "/agents/my_agent.v2.md");
      expect(result.frontmatter.name).toBe("my-agent-v2");
    });

    it("handles invalid YAML gracefully", () => {
      const result = parseContinueAgent(SKILL_WITH_INVALID_YAML, "/agents/broken.md");
      expect(result.frontmatter.name).toBe("broken");
    });

    it("filters non-string tools from array", () => {
      const content = `---
name: mixed-tools
tools:
  - Read
  - 42
  - Write
  - true
---

Instructions.
`;
      const result = parseContinueAgent(content, "/agents/mixed.md");
      expect(result.frontmatter.tools).toEqual(["Read", "Write"]);
    });
  });

  describe("scanContinueAgents", () => {
    it("returns empty array for non-existent directory", async () => {
      const result = await scanContinueAgents(join(tempDir, "nonexistent"));
      expect(result).toEqual([]);
    });

    it("discovers and reads agent files", async () => {
      await writeFile(join(tempDir, "reviewer.md"), SKILL_WITH_FRONTMATTER);

      const result = await scanContinueAgents(tempDir);
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe("reviewer");
      expect(result[0]!.raw).toContain("test-skill");
    });

    it("discovers files in subdirectories", async () => {
      const subDir = join(tempDir, "custom");
      await mkdir(subDir);
      await writeFile(join(subDir, "helper.md"), SKILL_WITH_FRONTMATTER);

      const result = await scanContinueAgents(tempDir);
      expect(result.length).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// OpenCode Parser Tests
// ---------------------------------------------------------------------------

describe("opencode parser", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opencode-parser-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("parseOpencodeAgent", () => {
    it("parses frontmatter with all fields including mode", () => {
      const content = `---
name: code-agent
description: An OpenCode agent
tools:
  - Read
  - Write
model: grok/grok-3
mode: primary
---

You are the primary code agent.
`;
      const result = parseOpencodeAgent(content, "/agents/code-agent.md");
      expect(result.frontmatter.name).toBe("code-agent");
      expect(result.frontmatter.description).toBe("An OpenCode agent");
      expect(result.frontmatter.tools).toEqual(["Read", "Write"]);
      expect(result.frontmatter.model).toBe("grok/grok-3");
      expect(result.frontmatter.mode).toBe("primary");
    });

    it("parses subagent mode", () => {
      const content = `---
name: helper
mode: subagent
---

You are a subagent.
`;
      const result = parseOpencodeAgent(content, "/agents/helper.md");
      expect(result.frontmatter.mode).toBe("subagent");
    });

    it("normalizes mode to lowercase", () => {
      const content = `---
name: upper-mode
mode: PRIMARY
---

Instructions.
`;
      const result = parseOpencodeAgent(content, "/agents/upper.md");
      expect(result.frontmatter.mode).toBe("primary");
    });

    it("ignores unrecognized mode values", () => {
      const content = `---
name: bad-mode
mode: supervisor
---

Instructions.
`;
      const result = parseOpencodeAgent(content, "/agents/bad.md");
      expect(result.frontmatter.mode).toBeUndefined();
    });

    it("uses filename as fallback name", () => {
      const result = parseOpencodeAgent(SKILL_WITHOUT_FRONTMATTER, "/agents/my-agent.md");
      expect(result.frontmatter.name).toBe("my-agent");
    });

    it("handles invalid YAML gracefully", () => {
      const result = parseOpencodeAgent(SKILL_WITH_INVALID_YAML, "/agents/broken.md");
      expect(result.frontmatter.name).toBe("broken");
    });
  });

  describe("scanOpencodeAgents", () => {
    it("returns empty array for non-existent directory", async () => {
      const result = await scanOpencodeAgents(join(tempDir, "nonexistent"));
      expect(result).toEqual([]);
    });

    it("discovers agent files", async () => {
      await writeFile(join(tempDir, "primary.md"), "---\nname: primary\nmode: primary\n---\nInstructions.");
      await writeFile(join(tempDir, "helper.md"), "---\nname: helper\nmode: subagent\n---\nHelper.");

      const result = await scanOpencodeAgents(tempDir);
      expect(result.length).toBe(2);
      expect(result.map((a) => a.name).sort()).toEqual(["helper", "primary"]);
    });

    it("skips non-markdown files", async () => {
      await writeFile(join(tempDir, "config.json"), '{"key": "value"}');
      await writeFile(join(tempDir, "agent.md"), SKILL_WITH_FRONTMATTER);

      const result = await scanOpencodeAgents(tempDir);
      expect(result.length).toBe(1);
    });

    it("skips hidden directories", async () => {
      const hidden = join(tempDir, ".internal");
      await mkdir(hidden);
      await writeFile(join(hidden, "secret.md"), SKILL_WITH_FRONTMATTER);

      const result = await scanOpencodeAgents(tempDir);
      expect(result.length).toBe(0);
    });
  });
});
