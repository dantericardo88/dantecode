import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock ALL external dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dantecode/danteforge", () => ({
  runAntiStubScanner: vi.fn(),
  runConstitutionCheck: vi.fn(),
}));

vi.mock("@dantecode/core", () => ({
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
  readOrInitializeState: vi.fn(),
  updateStateYaml: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./parsers/index.js", () => ({
  scanClaudeSkills: vi.fn(),
  parseClaudeSkill: vi.fn(),
  scanContinueAgents: vi.fn(),
  parseContinueAgent: vi.fn(),
  scanOpencodeAgents: vi.fn(),
  parseOpencodeAgent: vi.fn(),
}));

vi.mock("./wrap.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    wrapSkillWithAdapter: vi.fn().mockReturnValue("# Wrapped skill content\n"),
  };
});

import { importSkills, type ImportOptions } from "./importer.js";
import { mkdir, writeFile } from "node:fs/promises";
import { runAntiStubScanner, runConstitutionCheck } from "@dantecode/danteforge";
import { appendAuditEvent, readOrInitializeState, updateStateYaml } from "@dantecode/core";
import {
  scanClaudeSkills,
  parseClaudeSkill,
  scanContinueAgents,
  scanOpencodeAgents,
} from "./parsers/index.js";
import { wrapSkillWithAdapter } from "./wrap.js";

// ---------------------------------------------------------------------------
// Helper: mock parsed skill
// ---------------------------------------------------------------------------

function mockParsedSkill(name: string, overrides?: Record<string, unknown>) {
  return {
    frontmatter: {
      name,
      description: `Description for ${name}`,
      tools: ["Read", "Write"],
      model: "claude-sonnet-4-6",
      mode: "agent",
      ...overrides,
    },
    instructions: `Instructions for ${name}`,
    sourcePath: `/mock/path/${name}.md`,
  };
}

function setupClaudeSource(skills: ReturnType<typeof mockParsedSkill>[]) {
  (scanClaudeSkills as Mock).mockResolvedValueOnce(
    skills.map((s) => ({ raw: `raw-${s.frontmatter.name}`, path: s.sourcePath })),
  );
  for (const skill of skills) {
    (parseClaudeSkill as Mock).mockReturnValueOnce(skill);
  }
}

function setupPassingGates() {
  (runAntiStubScanner as Mock).mockReturnValue({
    passed: true,
    hardViolations: [],
    softViolations: [],
    scannedLines: 10,
  });
  (runConstitutionCheck as Mock).mockReturnValue({
    violations: [],
    passed: true,
  });
}

function setupState(dirs: string[] = []) {
  (readOrInitializeState as Mock).mockResolvedValue({
    skills: { directories: dirs },
    version: 1,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("importer", () => {
  const baseOptions: ImportOptions = {
    source: "claude",
    projectRoot: "/test/project",
    sessionId: "test-session",
    modelId: "test-model",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupPassingGates();
    setupState([]);
  });

  // -------------------------------------------------------------------------
  // Empty / error scan cases
  // -------------------------------------------------------------------------

  describe("scan phase", () => {
    it("returns empty result when no skills are found", async () => {
      (scanClaudeSkills as Mock).mockResolvedValueOnce([]);

      const result = await importSkills(baseOptions);

      expect(result.imported).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it("returns error when scan throws", async () => {
      (scanClaudeSkills as Mock).mockRejectedValueOnce(new Error("scan failed"));

      const result = await importSkills(baseOptions);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("Failed to scan claude skills");
      expect(result.errors[0]).toContain("scan failed");
    });

    it("dispatches to continue parser for continue source", async () => {
      (scanContinueAgents as Mock).mockResolvedValueOnce([]);

      await importSkills({ ...baseOptions, source: "continue" });

      expect(scanContinueAgents).toHaveBeenCalled();
      expect(scanClaudeSkills).not.toHaveBeenCalled();
    });

    it("dispatches to opencode parser for opencode source", async () => {
      (scanOpencodeAgents as Mock).mockResolvedValueOnce([]);

      await importSkills({ ...baseOptions, source: "opencode" });

      expect(scanOpencodeAgents).toHaveBeenCalled();
      expect(scanClaudeSkills).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("happy path", () => {
    it("imports a single skill successfully", async () => {
      const skill = mockParsedSkill("my-skill");
      setupClaudeSource([skill]);

      const result = await importSkills(baseOptions);

      expect(result.imported).toEqual(["my-skill"]);
      expect(result.skipped).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it("creates the skills directory", async () => {
      setupClaudeSource([mockParsedSkill("test-skill")]);

      await importSkills(baseOptions);

      expect(mkdir).toHaveBeenCalledWith(
        expect.stringContaining(".dantecode"),
        expect.objectContaining({ recursive: true }),
      );
    });

    it("writes wrapped content to SKILL.dc.md", async () => {
      setupClaudeSource([mockParsedSkill("test-skill")]);

      await importSkills(baseOptions);

      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining("SKILL.dc.md"),
        "# Wrapped skill content\n",
        "utf-8",
      );
    });

    it("calls wrapSkillWithAdapter with correct source", async () => {
      setupClaudeSource([mockParsedSkill("test-skill")]);

      await importSkills(baseOptions);

      expect(wrapSkillWithAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          frontmatter: expect.objectContaining({ name: "test-skill" }),
        }),
        "claude",
      );
    });

    it("logs audit event for imported skill", async () => {
      setupClaudeSource([mockParsedSkill("test-skill")]);

      await importSkills(baseOptions);

      expect(appendAuditEvent).toHaveBeenCalledWith(
        "/test/project",
        expect.objectContaining({
          type: "skill_import",
          payload: expect.objectContaining({
            action: "imported",
            skillName: "test-skill",
          }),
        }),
      );
    });

    it("imports multiple skills", async () => {
      const skills = [mockParsedSkill("skill-a"), mockParsedSkill("skill-b")];
      setupClaudeSource(skills);

      const result = await importSkills(baseOptions);

      expect(result.imported).toEqual(["skill-a", "skill-b"]);
      expect(writeFile).toHaveBeenCalledTimes(2);
    });

    it("includes hasTools and hasModel in audit payload", async () => {
      setupClaudeSource([mockParsedSkill("tool-skill", { tools: ["Read"], model: "gpt-4" })]);

      await importSkills(baseOptions);

      const auditCalls = (appendAuditEvent as Mock).mock.calls;
      const importCall = auditCalls.find(
        (c: unknown[]) => (c[1] as { payload: { action: string } }).payload.action === "imported",
      );
      expect(importCall![1].payload.hasTools).toBe(true);
      expect(importCall![1].payload.hasModel).toBe(true);
    });

    it("reports hasTools=false when no tools", async () => {
      setupClaudeSource([mockParsedSkill("no-tool-skill", { tools: undefined })]);

      await importSkills(baseOptions);

      const auditCalls = (appendAuditEvent as Mock).mock.calls;
      const importCall = auditCalls.find(
        (c: unknown[]) => (c[1] as { payload: { action: string } }).payload.action === "imported",
      );
      expect(importCall![1].payload.hasTools).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Name sanitization (tested indirectly through directory names)
  // -------------------------------------------------------------------------

  describe("name sanitization", () => {
    it("lowercases and replaces special characters", async () => {
      setupClaudeSource([mockParsedSkill("My Cool Skill!")]);

      await importSkills(baseOptions);

      expect(mkdir).toHaveBeenCalledWith(
        expect.stringContaining("my-cool-skill"),
        expect.objectContaining({ recursive: true }),
      );
    });

    it("collapses consecutive hyphens", async () => {
      setupClaudeSource([mockParsedSkill("skill--with---hyphens")]);

      await importSkills(baseOptions);

      expect(mkdir).toHaveBeenCalledWith(
        expect.stringContaining("skill-with-hyphens"),
        expect.objectContaining({ recursive: true }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Anti-stub scanner gate
  // -------------------------------------------------------------------------

  describe("anti-stub gate", () => {
    it("skips skill when anti-stub scan fails", async () => {
      setupClaudeSource([mockParsedSkill("stubby-skill")]);
      (runAntiStubScanner as Mock).mockReturnValueOnce({
        passed: false,
        hardViolations: [
          { type: "stub_detected", severity: "hard", message: "Found stub", line: 5 },
        ],
        softViolations: [],
        scannedLines: 10,
      });

      const result = await importSkills(baseOptions);

      expect(result.imported).toEqual([]);
      expect(result.skipped.length).toBe(1);
      expect(result.skipped[0]!.name).toBe("stubby-skill");
      expect(result.skipped[0]!.reason).toContain("Anti-stub scan failed");
      expect(result.skipped[0]!.reason).toContain("Found stub");
    });

    it("logs audit event for anti-stub skip", async () => {
      setupClaudeSource([mockParsedSkill("stub-skill")]);
      (runAntiStubScanner as Mock).mockReturnValueOnce({
        passed: false,
        hardViolations: [{ type: "stub_detected", severity: "hard", message: "Stub" }],
        softViolations: [],
        scannedLines: 5,
      });

      await importSkills(baseOptions);

      expect(appendAuditEvent).toHaveBeenCalledWith(
        "/test/project",
        expect.objectContaining({
          type: "skill_import",
          payload: expect.objectContaining({
            action: "skipped",
            reason: "anti_stub_scan_failed",
          }),
        }),
      );
    });

    it("bypasses anti-stub when skipAntiStub is true", async () => {
      setupClaudeSource([mockParsedSkill("skip-scan-skill")]);

      const result = await importSkills({ ...baseOptions, skipAntiStub: true });

      expect(result.imported).toEqual(["skip-scan-skill"]);
      expect(runAntiStubScanner).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Constitution check gate
  // -------------------------------------------------------------------------

  describe("constitution gate", () => {
    it("skips skill on critical constitution violation", async () => {
      setupClaudeSource([mockParsedSkill("insecure-skill")]);
      (runConstitutionCheck as Mock).mockReturnValueOnce({
        violations: [
          {
            type: "hardcoded_secret",
            severity: "critical",
            message: "API key detected",
            line: 10,
          },
        ],
        passed: false,
      });

      const result = await importSkills(baseOptions);

      expect(result.imported).toEqual([]);
      expect(result.skipped.length).toBe(1);
      expect(result.skipped[0]!.reason).toContain("Constitution check failed");
      expect(result.skipped[0]!.reason).toContain("API key detected");
    });

    it("allows skill through with only warning-level violations", async () => {
      setupClaudeSource([mockParsedSkill("warn-skill")]);
      (runConstitutionCheck as Mock).mockReturnValueOnce({
        violations: [
          {
            type: "long_function",
            severity: "warning",
            message: "Function too long",
          },
        ],
        passed: true,
      });

      const result = await importSkills(baseOptions);

      expect(result.imported).toEqual(["warn-skill"]);
    });

    it("bypasses constitution when skipConstitution is true", async () => {
      setupClaudeSource([mockParsedSkill("skip-constitution")]);

      const result = await importSkills({ ...baseOptions, skipConstitution: true });

      expect(result.imported).toEqual(["skip-constitution"]);
      expect(runConstitutionCheck).not.toHaveBeenCalled();
    });

    it("logs audit event for constitution violation", async () => {
      setupClaudeSource([mockParsedSkill("blocked-skill")]);
      (runConstitutionCheck as Mock).mockReturnValueOnce({
        violations: [
          {
            type: "hardcoded_secret",
            severity: "critical",
            message: "Secret found",
            line: 3,
          },
        ],
        passed: false,
      });

      await importSkills(baseOptions);

      expect(appendAuditEvent).toHaveBeenCalledWith(
        "/test/project",
        expect.objectContaining({
          type: "constitution_violation",
          payload: expect.objectContaining({
            action: "skill_import_blocked",
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("reports error when writeFile throws", async () => {
      setupClaudeSource([mockParsedSkill("write-fail")]);
      (writeFile as Mock).mockRejectedValueOnce(new Error("disk full"));

      const result = await importSkills(baseOptions);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("disk full");
    });

    it("continues processing other skills after one fails", async () => {
      const skills = [mockParsedSkill("fail-skill"), mockParsedSkill("ok-skill")];
      setupClaudeSource(skills);
      (writeFile as Mock)
        .mockRejectedValueOnce(new Error("write error"))
        .mockResolvedValueOnce(undefined);

      const result = await importSkills(baseOptions);

      expect(result.errors.length).toBe(1);
      expect(result.imported).toEqual(["ok-skill"]);
    });

    it("swallows audit logging failure during error handling", async () => {
      setupClaudeSource([mockParsedSkill("double-fail")]);
      (writeFile as Mock).mockRejectedValueOnce(new Error("write error"));
      // Make the error audit event also fail
      (appendAuditEvent as Mock).mockRejectedValueOnce(new Error("audit also failed"));

      const result = await importSkills(baseOptions);

      // Should still report the original error, not crash
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("write error");
    });
  });

  // -------------------------------------------------------------------------
  // STATE.yaml update
  // -------------------------------------------------------------------------

  describe("STATE.yaml update", () => {
    it("adds .dantecode/skills to state directories when not present", async () => {
      setupClaudeSource([mockParsedSkill("state-skill")]);
      setupState([]);

      await importSkills(baseOptions);

      expect(updateStateYaml).toHaveBeenCalledWith(
        "/test/project",
        expect.objectContaining({
          skills: expect.objectContaining({
            directories: [".dantecode/skills"],
          }),
        }),
      );
    });

    it("does not duplicate directory entry if already present", async () => {
      setupClaudeSource([mockParsedSkill("state-skill")]);
      setupState([".dantecode/skills"]);

      await importSkills(baseOptions);

      expect(updateStateYaml).toHaveBeenCalledWith(
        "/test/project",
        expect.objectContaining({
          skills: expect.objectContaining({
            directories: [".dantecode/skills"],
          }),
        }),
      );
    });

    it("does not update state when nothing was imported", async () => {
      (scanClaudeSkills as Mock).mockResolvedValueOnce([]);

      await importSkills(baseOptions);

      expect(readOrInitializeState).not.toHaveBeenCalled();
      expect(updateStateYaml).not.toHaveBeenCalled();
    });

    it("reports error when state update fails", async () => {
      setupClaudeSource([mockParsedSkill("state-fail")]);
      (readOrInitializeState as Mock).mockRejectedValueOnce(new Error("state read error"));

      const result = await importSkills(baseOptions);

      expect(result.imported).toEqual(["state-fail"]);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("Failed to update STATE.yaml");
    });
  });
});
