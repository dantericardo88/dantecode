// ============================================================================
// @dantecode/cli — Init Command
// Creates the .dantecode/ directory structure with default STATE.yaml,
// AGENTS.dc.md template, and skills/agents directories.
// ============================================================================

import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { initializeState, stateYamlExists } from "@dantecode/core";

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ----------------------------------------------------------------------------
// AGENTS.dc.md Template
// ----------------------------------------------------------------------------

const AGENTS_DC_MD_TEMPLATE = `---
name: project-agent
description: Default project agent for DanteCode
---

# Project Agent

This is the default agent configuration for your DanteCode project.
Customize it to define how DanteCode interacts with your codebase.

## Instructions

- Follow the project's coding conventions and style guide
- Write complete, production-ready code (no stubs or placeholders)
- Include error handling for all async operations
- Add JSDoc comments to exported functions and types
- Run type-checking and tests after making changes

## Context

This project uses:
- Language: (specify your language)
- Framework: (specify your framework)
- Test runner: (specify your test runner)
- Build tool: (specify your build tool)

## Rules

1. Always read existing files before editing them
2. Preserve existing code style and conventions
3. Do not modify files outside the project scope
4. Ask for clarification when the task is ambiguous
5. Verify changes by running the project's test suite
`;

// ----------------------------------------------------------------------------
// Init Command
// ----------------------------------------------------------------------------

/**
 * Runs the `dantecode init` command.
 *
 * Creates the full .dantecode/ directory structure:
 * - .dantecode/STATE.yaml (project configuration)
 * - .dantecode/AGENTS.dc.md (default agent definition)
 * - .dantecode/skills/ (skill storage directory)
 * - .dantecode/agents/ (agent definition directory)
 *
 * If STATE.yaml already exists, prompts to skip or overwrite.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @param force - If true, overwrites existing files without prompting.
 */
export async function runInitCommand(
  projectRoot: string,
  force: boolean = false,
): Promise<void> {
  process.stdout.write(`\n${BOLD}Initializing DanteCode project...${RESET}\n\n`);

  const dantecodeDir = join(projectRoot, ".dantecode");
  const created: string[] = [];
  const skipped: string[] = [];

  // Create .dantecode/ directory
  try {
    await mkdir(dantecodeDir, { recursive: true });
    created.push(".dantecode/");
  } catch {
    // Directory might already exist, which is fine
  }

  // Create .dantecode/skills/ directory
  const skillsDir = join(dantecodeDir, "skills");
  try {
    await mkdir(skillsDir, { recursive: true });
    created.push(".dantecode/skills/");
  } catch {
    // Already exists
  }

  // Create .dantecode/agents/ directory
  const agentsDir = join(dantecodeDir, "agents");
  try {
    await mkdir(agentsDir, { recursive: true });
    created.push(".dantecode/agents/");
  } catch {
    // Already exists
  }

  // Create STATE.yaml
  const stateExists = await stateYamlExists(projectRoot);
  if (stateExists && !force) {
    skipped.push(".dantecode/STATE.yaml (already exists)");
  } else {
    try {
      await initializeState(projectRoot);
      created.push(".dantecode/STATE.yaml");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${RED}Error creating STATE.yaml: ${message}${RESET}\n`);
    }
  }

  // Create AGENTS.dc.md template
  const agentsMdPath = join(dantecodeDir, "AGENTS.dc.md");
  const agentsMdExists = await fileExists(agentsMdPath);
  if (agentsMdExists && !force) {
    skipped.push(".dantecode/AGENTS.dc.md (already exists)");
  } else {
    try {
      await writeFile(agentsMdPath, AGENTS_DC_MD_TEMPLATE, "utf-8");
      created.push(".dantecode/AGENTS.dc.md");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${RED}Error creating AGENTS.dc.md: ${message}${RESET}\n`);
    }
  }

  // Create .gitignore for .dantecode/ (don't track worktrees and temp files)
  const gitignorePath = join(dantecodeDir, ".gitignore");
  const gitignoreExists = await fileExists(gitignorePath);
  if (gitignoreExists && !force) {
    skipped.push(".dantecode/.gitignore (already exists)");
  } else {
    const gitignoreContent = [
      "# DanteCode internal files",
      "worktrees/",
      "*.tmp",
      "lessons.db",
      "lessons.db-wal",
      "lessons.db-shm",
      "",
    ].join("\n");

    try {
      await writeFile(gitignorePath, gitignoreContent, "utf-8");
      created.push(".dantecode/.gitignore");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${RED}Error creating .gitignore: ${message}${RESET}\n`);
    }
  }

  // Print summary
  if (created.length > 0) {
    process.stdout.write(`${GREEN}Created:${RESET}\n`);
    for (const item of created) {
      process.stdout.write(`  ${GREEN}+${RESET} ${item}\n`);
    }
  }

  if (skipped.length > 0) {
    process.stdout.write(`\n${YELLOW}Skipped:${RESET}\n`);
    for (const item of skipped) {
      process.stdout.write(`  ${DIM}-${RESET} ${item}\n`);
    }
  }

  process.stdout.write(`\n${GREEN}${BOLD}DanteCode project initialized!${RESET}\n`);
  process.stdout.write(`${DIM}Run 'dantecode' to start the interactive REPL.${RESET}\n\n`);
}

/**
 * Checks whether a file exists at the given path.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
