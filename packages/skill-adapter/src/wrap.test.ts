import { describe, it, expect } from "vitest";
import {
  wrapSkillWithAdapter,
  ADAPTER_VERSION,
  type ParsedSkill,
  type ImportSource,
} from "./wrap.js";

describe("skill-adapter wrap", () => {
  const baseSkill: ParsedSkill = {
    frontmatter: {
      name: "test-skill",
      description: "A test skill for unit testing",
    },
    instructions: "Write clean TypeScript code following best practices.",
    sourcePath: "/skills/test-skill.md",
  };

  describe("ADAPTER_VERSION", () => {
    it("is a valid semver string", () => {
      expect(ADAPTER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("wrapSkillWithAdapter", () => {
    it("returns a string with YAML frontmatter delimiters", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result.startsWith("---\n")).toBe(true);
      expect(result).toContain("\n---\n");
    });

    it("includes skill name and description in frontmatter", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).toContain("name: test-skill");
      expect(result).toContain("description: A test skill for unit testing");
    });

    it("includes adapter metadata in frontmatter", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).toContain(`adapter_version: ${ADAPTER_VERSION}`);
      expect(result).toContain("import_source: claude");
      expect(result).toContain("original_source_path: /skills/test-skill.md");
    });

    it("includes dante_tools array", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).toContain("anti_stub_scanner");
      expect(result).toContain("pdse_scorer");
      expect(result).toContain("constitution_checker");
      expect(result).toContain("gstack_runner");
      expect(result).toContain("lessons_system");
      expect(result).toContain("audit_logger");
    });

    it("includes the preamble block with Anti-Stub Doctrine", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).toContain("DANTEFORGE PREAMBLE");
      expect(result).toContain("Anti-Stub Doctrine");
      expect(result).toContain("COMPLETE, PRODUCTION-READY code");
    });

    it("includes the preamble block with PDSE Clarity Gate", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).toContain("PDSE Clarity Gate");
      expect(result).toContain("Completeness");
      expect(result).toContain("Correctness");
      expect(result).toContain("Clarity");
      expect(result).toContain("Consistency");
    });

    it("includes the preamble block with Constitution Rules", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).toContain("Constitution Rules");
      expect(result).toContain("No Credential Exposure");
      expect(result).toContain("No Background Processes");
      expect(result).toContain("No Dangerous Operations");
      expect(result).toContain("No Code Injection");
    });

    it("includes original skill instructions verbatim", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).toContain("Write clean TypeScript code following best practices.");
    });

    it("includes ORIGINAL SKILL INSTRUCTIONS comment marker", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).toContain("ORIGINAL SKILL INSTRUCTIONS");
    });

    it("includes the postamble block with GStack QA", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).toContain("DANTEFORGE POSTAMBLE");
      expect(result).toContain("GStack QA Pipeline");
      expect(result).toContain("tsc --noEmit");
      expect(result).toContain("vitest run");
    });

    it("includes postamble with Lessons Injection", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).toContain("Lessons Injection");
    });

    it("includes postamble with Audit Log", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).toContain("Audit Log");
      expect(result).toContain(".dantecode/audit.jsonl");
    });

    it("includes postamble with Commit Hook", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).toContain("Commit Hook");
      expect(result).toContain("Co-Authored-By: DanteCode");
    });

    it("preserves section ordering: preamble → instructions → postamble", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      const preambleIdx = result.indexOf("DANTEFORGE PREAMBLE");
      const instructionsIdx = result.indexOf("ORIGINAL SKILL INSTRUCTIONS");
      const postambleIdx = result.indexOf("DANTEFORGE POSTAMBLE");

      expect(preambleIdx).toBeLessThan(instructionsIdx);
      expect(instructionsIdx).toBeLessThan(postambleIdx);
    });

    it("carries over optional tools from original frontmatter", () => {
      const skill: ParsedSkill = {
        ...baseSkill,
        frontmatter: {
          ...baseSkill.frontmatter,
          tools: ["Read", "Write", "Bash"],
        },
      };
      const result = wrapSkillWithAdapter(skill, "claude");
      expect(result).toContain("original_tools");
      expect(result).toContain("Read");
      expect(result).toContain("Write");
      expect(result).toContain("Bash");
    });

    it("carries over optional model from original frontmatter", () => {
      const skill: ParsedSkill = {
        ...baseSkill,
        frontmatter: {
          ...baseSkill.frontmatter,
          model: "claude-sonnet-4-6",
        },
      };
      const result = wrapSkillWithAdapter(skill, "claude");
      expect(result).toContain("original_model: claude-sonnet-4-6");
    });

    it("carries over mode, hidden, and color when set", () => {
      const skill: ParsedSkill = {
        ...baseSkill,
        frontmatter: {
          ...baseSkill.frontmatter,
          mode: "agent",
          hidden: true,
          color: "#ff5500",
        },
      };
      const result = wrapSkillWithAdapter(skill, "claude");
      expect(result).toContain("mode: agent");
      expect(result).toContain("hidden: true");
      expect(result).toContain('color: "#ff5500"');
    });

    it("does not include optional fields when not set", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      expect(result).not.toContain("original_tools");
      expect(result).not.toContain("original_model");
      expect(result).not.toContain("hidden:");
      expect(result).not.toContain("color:");
    });

    it("handles all import sources correctly", () => {
      const sources: ImportSource[] = ["claude", "continue", "opencode"];
      for (const source of sources) {
        const result = wrapSkillWithAdapter(baseSkill, source);
        expect(result).toContain(`import_source: ${source}`);
        expect(result).toContain(`Source: ${source}`);
      }
    });

    it("includes wrapped_at ISO timestamp in frontmatter", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      // ISO 8601 pattern
      expect(result).toMatch(/wrapped_at: \d{4}-\d{2}-\d{2}T/);
    });

    it("produces valid structure with all sections present", () => {
      const result = wrapSkillWithAdapter(baseSkill, "claude");
      // Count the frontmatter delimiters (exactly 2 --- lines)
      const dashes = result.match(/^---$/gm);
      expect(dashes).toBeDefined();
      expect(dashes!.length).toBe(2);
      // Verify both END markers
      expect(result).toContain("END DANTEFORGE PREAMBLE");
      expect(result).toContain("END DANTEFORGE POSTAMBLE");
    });
  });
});
