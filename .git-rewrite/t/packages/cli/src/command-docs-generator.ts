// ============================================================================
// @dantecode/cli — Command Docs Generator
// Auto-generates Markdown reference documentation from slash command
// definitions. Supports single-command formatting and batch file output.
// ============================================================================

import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** Minimal command definition needed for docs generation. */
export interface DocsSlashCommand {
  name: string;
  description: string;
  usage: string;
}

// ────────────────────────────────────────────────────────────────────────────
// CommandDocsGenerator
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generates Markdown reference documentation from slash command definitions.
 *
 * Produces a structured document with a table of contents and per-command
 * sections organized alphabetically.
 */
export class CommandDocsGenerator {
  private readonly writeFileFn: (path: string, data: string) => Promise<void>;
  private readonly mkdirFn: (
    path: string,
    opts: { recursive: boolean },
  ) => Promise<string | undefined>;

  constructor(options?: {
    writeFileFn?: (path: string, data: string) => Promise<void>;
    mkdirFn?: (path: string, opts: { recursive: boolean }) => Promise<string | undefined>;
  }) {
    this.writeFileFn = options?.writeFileFn ?? ((p, d) => writeFile(p, d, "utf-8"));
    this.mkdirFn = options?.mkdirFn ?? mkdir;
  }

  /**
   * Formats a single command as a Markdown section.
   *
   * Output format:
   * ```
   * ### /command
   *
   * Description text.
   *
   * **Usage:** `/command [args]`
   * ```
   */
  formatCommand(cmd: DocsSlashCommand): string {
    const lines: string[] = [
      `### /${cmd.name}`,
      "",
      cmd.description,
      "",
      `**Usage:** \`${cmd.usage}\``,
    ];
    return lines.join("\n");
  }

  /**
   * Generates a complete Markdown command reference document.
   *
   * Includes a title, generation timestamp, table of contents,
   * and formatted sections for each command sorted alphabetically.
   */
  generate(commands: DocsSlashCommand[]): string {
    const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name));
    const lines: string[] = [];

    // Header
    lines.push("# DanteCode Command Reference");
    lines.push("");
    lines.push(`> Auto-generated on ${new Date().toISOString().split("T")[0]}`);
    lines.push("");

    // Table of contents
    lines.push("## Table of Contents");
    lines.push("");
    for (const cmd of sorted) {
      const anchor = cmd.name.replace(/[^a-z0-9-]/g, "");
      lines.push(`- [/${cmd.name}](#${anchor})`);
    }
    lines.push("");

    // Command sections
    lines.push("## Commands");
    lines.push("");
    for (const cmd of sorted) {
      lines.push(this.formatCommand(cmd));
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Generates the Markdown document and writes it to a file.
   *
   * Creates parent directories if they do not exist.
   */
  async generateToFile(commands: DocsSlashCommand[], outputPath: string): Promise<void> {
    const content = this.generate(commands);
    await this.mkdirFn(dirname(outputPath), { recursive: true });
    await this.writeFileFn(outputPath, content);
  }
}
