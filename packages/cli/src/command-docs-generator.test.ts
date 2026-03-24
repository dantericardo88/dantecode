// ============================================================================
// @dantecode/cli — Command Docs Generator Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { CommandDocsGenerator, type DocsSlashCommand } from "./command-docs-generator.js";

const SAMPLE_COMMANDS: DocsSlashCommand[] = [
  { name: "help", description: "Show all commands", usage: "/help" },
  { name: "add", description: "Add file to context", usage: "/add <file>" },
  { name: "diff", description: "Show pending changes", usage: "/diff" },
  { name: "autoforge", description: "Run autoforge IAL loop", usage: "/autoforge [--silent]" },
];

describe("CommandDocsGenerator", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Single command formatting
  // ──────────────────────────────────────────────────────────────────────────

  describe("formatCommand", () => {
    it("formats a command as a Markdown section", () => {
      const gen = new CommandDocsGenerator();
      const output = gen.formatCommand(SAMPLE_COMMANDS[0]!);

      expect(output).toContain("### /help");
      expect(output).toContain("Show all commands");
      expect(output).toContain("**Usage:** `/help`");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Full document generation
  // ──────────────────────────────────────────────────────────────────────────

  describe("generate", () => {
    it("generates a complete Markdown document with TOC", () => {
      const gen = new CommandDocsGenerator();
      const output = gen.generate(SAMPLE_COMMANDS);

      expect(output).toContain("# DanteCode Command Reference");
      expect(output).toContain("## Table of Contents");
      expect(output).toContain("## Commands");
      // Commands should be sorted alphabetically
      const addIndex = output.indexOf("/add");
      const helpIndex = output.indexOf("/help");
      expect(addIndex).toBeLessThan(helpIndex);
    });

    it("includes all commands in the output", () => {
      const gen = new CommandDocsGenerator();
      const output = gen.generate(SAMPLE_COMMANDS);

      for (const cmd of SAMPLE_COMMANDS) {
        expect(output).toContain(`### /${cmd.name}`);
        expect(output).toContain(cmd.description);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // File output
  // ──────────────────────────────────────────────────────────────────────────

  describe("generateToFile", () => {
    it("writes generated docs to a file", async () => {
      const writtenFiles: Array<{ path: string; content: string }> = [];
      const gen = new CommandDocsGenerator({
        writeFileFn: async (path, data) => {
          writtenFiles.push({ path, content: data });
        },
        mkdirFn: async () => undefined,
      });

      await gen.generateToFile(SAMPLE_COMMANDS, "/output/commands.md");

      expect(writtenFiles).toHaveLength(1);
      expect(writtenFiles[0]!.path).toBe("/output/commands.md");
      expect(writtenFiles[0]!.content).toContain("# DanteCode Command Reference");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty command list", () => {
      const gen = new CommandDocsGenerator();
      const output = gen.generate([]);
      expect(output).toContain("# DanteCode Command Reference");
      expect(output).toContain("## Table of Contents");
    });
  });
});
