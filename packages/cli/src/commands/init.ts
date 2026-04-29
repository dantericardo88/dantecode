// ============================================================================
// @dantecode/cli — Init Command
// Creates the .dantecode/ directory structure with default STATE.yaml,
// AGENTS.dc.md template, and skills/agents directories.
// ============================================================================

import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { initializeState, stateYamlExists, checkRepoReadiness, recordOnboardingStep } from "@dantecode/core";

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
/** Best-effort mkdir; "already exists" doesn't surface as an error. */
async function ensureInitDir(dirPath: string, displayName: string, created: string[]): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
    created.push(displayName);
  } catch { /* already exists */ }
}

/**
 * Idempotent file creation. If the file exists and !force, push to skipped
 * and return. Otherwise call the writer (string or thunk) and push to created
 * on success. Errors are surfaced via stderr but don't throw.
 */
async function ensureInitFile(
  filePath: string,
  displayName: string,
  force: boolean,
  writer: () => Promise<void>,
  created: string[],
  skipped: string[],
): Promise<void> {
  const exists = await fileExists(filePath);
  if (exists && !force) {
    skipped.push(`${displayName} (already exists)`);
    return;
  }
  try {
    await writer();
    created.push(displayName);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${RED}Error creating ${displayName}: ${message}${RESET}\n`);
  }
}

function printInitSummary(created: string[], skipped: string[]): void {
  if (created.length > 0) {
    process.stdout.write(`${GREEN}Created:${RESET}\n`);
    for (const item of created) process.stdout.write(`  ${GREEN}+${RESET} ${item}\n`);
  }
  if (skipped.length > 0) {
    process.stdout.write(`\n${YELLOW}Skipped:${RESET}\n`);
    for (const item of skipped) process.stdout.write(`  ${DIM}-${RESET} ${item}\n`);
  }
}

function printRepoReadiness(readiness: ReturnType<typeof checkRepoReadiness>): void {
  process.stdout.write(`\n${BOLD}Repo readiness:${RESET}\n`);
  process.stdout.write(`  ${readiness.hasPackageJson ? GREEN + "✓" : DIM + "—"}${RESET} Node.js project (package.json)\n`);
  process.stdout.write(`  ${readiness.hasGit ? GREEN + "✓" : DIM + "—"}${RESET} Git repository\n`);
  process.stdout.write(`  ${readiness.hasDevScript ? GREEN + "✓" : DIM + "—"}${RESET} Dev script${readiness.devCommand ? ` (${readiness.devCommand})` : ""}\n`);
  if (readiness.detectedFramework) {
    process.stdout.write(`  ${GREEN}✓${RESET} Framework: ${readiness.detectedFramework}\n`);
  }
}

const GITIGNORE_CONTENT = [
  "# DanteCode internal files",
  "worktrees/",
  "*.tmp",
  "lessons.db",
  "lessons.db-wal",
  "lessons.db-shm",
  "",
].join("\n");

export async function runInitCommand(projectRoot: string, force: boolean = false): Promise<void> {
  process.stdout.write(`\n${BOLD}Initializing DanteCode project...${RESET}\n\n`);

  const sessionId = `init-${Date.now()}`;
  recordOnboardingStep({ sessionId, step: "init-started" }, projectRoot);

  const dantecodeDir = join(projectRoot, ".dantecode");
  const created: string[] = [];
  const skipped: string[] = [];

  await ensureInitDir(dantecodeDir, ".dantecode/", created);
  await ensureInitDir(join(dantecodeDir, "skills"), ".dantecode/skills/", created);
  await ensureInitDir(join(dantecodeDir, "agents"), ".dantecode/agents/", created);

  const stateExists = await stateYamlExists(projectRoot);
  if (stateExists && !force) {
    skipped.push(".dantecode/STATE.yaml (already exists)");
  } else {
    await ensureInitFile(
      join(dantecodeDir, "STATE.yaml"),
      ".dantecode/STATE.yaml",
      true, // we already gated on stateYamlExists
      () => initializeState(projectRoot).then(() => undefined),
      created,
      skipped,
    );
  }

  await ensureInitFile(
    join(dantecodeDir, "AGENTS.dc.md"),
    ".dantecode/AGENTS.dc.md",
    force,
    () => writeFile(join(dantecodeDir, "AGENTS.dc.md"), AGENTS_DC_MD_TEMPLATE, "utf-8"),
    created,
    skipped,
  );

  await ensureInitFile(
    join(dantecodeDir, ".gitignore"),
    ".dantecode/.gitignore",
    force,
    () => writeFile(join(dantecodeDir, ".gitignore"), GITIGNORE_CONTENT, "utf-8"),
    created,
    skipped,
  );

  printInitSummary(created, skipped);

  // Sprint Dim35: repo readiness check
  const readiness = checkRepoReadiness(projectRoot);
  printRepoReadiness(readiness);
  recordOnboardingStep(
    { sessionId, step: "repo-readiness-checked", framework: readiness.detectedFramework ?? undefined },
    projectRoot,
  );

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
