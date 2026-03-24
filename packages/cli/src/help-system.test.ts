// ============================================================================
// @dantecode/cli — Help System Tests
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { HelpSystem, type HelpSlashCommand } from "./help-system.js";

// Mock existsSync
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { existsSync } from "node:fs";

const SAMPLE_COMMANDS: HelpSlashCommand[] = [
  { name: "help", description: "Show all commands", usage: "/help", tier: 1 },
  { name: "model", description: "Switch model", usage: "/model <id>", tier: 1 },
  { name: "add", description: "Add file to context", usage: "/add <file>", tier: 1 },
  { name: "diff", description: "Show changes", usage: "/diff", tier: 1 },
  { name: "autoforge", description: "Run autoforge", usage: "/autoforge", tier: 2 },
  { name: "pdse", description: "Run PDSE scorer", usage: "/pdse <file>", tier: 2 },
  { name: "worktree", description: "Create worktree", usage: "/worktree", tier: 2 },
  { name: "skill", description: "List skills", usage: "/skill [name]", tier: 1 },
];

describe("HelpSystem", () => {
  let help: HelpSystem;

  beforeEach(() => {
    help = new HelpSystem();
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Command grouping
  // ──────────────────────────────────────────────────────────────────────────

  describe("getGroupedCommands", () => {
    it("groups commands by category", () => {
      const groups = help.getGroupedCommands(SAMPLE_COMMANDS);

      expect(groups["Core"]).toBeDefined();
      expect(groups["Development"]).toBeDefined();
      expect(groups["Security"]).toBeDefined();

      const coreNames = groups["Core"]!.map((c) => c.name);
      expect(coreNames).toContain("help");
      expect(coreNames).toContain("model");
    });

    it("places unknown commands in Other category", () => {
      const commands: HelpSlashCommand[] = [
        { name: "unknown-cmd", description: "Mystery", usage: "/unknown-cmd" },
      ];
      const groups = help.getGroupedCommands(commands);
      expect(groups["Other"]).toBeDefined();
      expect(groups["Other"]![0]!.name).toBe("unknown-cmd");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // First-run detection
  // ──────────────────────────────────────────────────────────────────────────

  describe("detectFirstRun", () => {
    it("returns true when .dantecode directory does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(help.detectFirstRun("/project")).toBe(true);
    });

    it("returns false when .dantecode directory exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      expect(help.detectFirstRun("/project")).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Contextual suggestions
  // ──────────────────────────────────────────────────────────────────────────

  describe("getContextualSuggestions", () => {
    it("suggests /add for new sessions with no messages", () => {
      const suggestions = help.getContextualSuggestions({
        messageCount: 0,
        hasGitRepo: false,
        hasDantecodeDir: true,
      });
      expect(suggestions.some((s) => s.includes("/add"))).toBe(true);
    });

    it("suggests /compact for long sessions", () => {
      const suggestions = help.getContextualSuggestions({
        messageCount: 15,
        hasGitRepo: true,
        hasDantecodeDir: true,
      });
      expect(suggestions.some((s) => s.includes("/compact"))).toBe(true);
    });

    it("suggests /diff and /commit when git repo has messages", () => {
      const suggestions = help.getContextualSuggestions({
        messageCount: 3,
        hasGitRepo: true,
        hasDantecodeDir: true,
      });
      expect(suggestions.some((s) => s.includes("/diff"))).toBe(true);
      expect(suggestions.some((s) => s.includes("/commit"))).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Formatted output
  // ──────────────────────────────────────────────────────────────────────────

  describe("formatGroupedHelp", () => {
    it("renders grouped help with ANSI colors", () => {
      const groups = help.getGroupedCommands(SAMPLE_COMMANDS);
      const output = help.formatGroupedHelp(groups);
      expect(output).toContain("DanteCode Commands");
      expect(output).toContain("Core");
      expect(output).toContain("/help");
    });

    it("filters by tier when tier=1", () => {
      const groups = help.getGroupedCommands(SAMPLE_COMMANDS);
      const output = help.formatGroupedHelp(groups, 1);
      // autoforge is tier 2, should be filtered out
      expect(output).not.toContain("/autoforge");
      // help is tier 1, should be present
      expect(output).toContain("/help");
      expect(output).toContain("--all");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // First-run suggestions
  // ──────────────────────────────────────────────────────────────────────────

  describe("getFirstRunSuggestions", () => {
    it("returns essential commands for new users", () => {
      const suggestions = help.getFirstRunSuggestions();
      expect(suggestions.length).toBeGreaterThanOrEqual(2);
      expect(suggestions.some((s) => s.includes("/help"))).toBe(true);
      expect(suggestions.some((s) => s.includes("/model"))).toBe(true);
    });
  });
});
