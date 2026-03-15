// ============================================================================
// @dantecode/cli — Skills Command
// Sub-commands for managing skills: list, import, wrap, show, validate, remove
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import {
  listSkills,
  getSkill,
  removeSkill,
  validateSkill,
  importSkills,
  wrapSkillWithAdapter,
} from "@dantecode/skill-adapter";
import type { ImportSource, ParsedSkill } from "@dantecode/skill-adapter";

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
// Skills Command Router
// ----------------------------------------------------------------------------

/**
 * Runs the `dantecode skills` command with the given sub-command and arguments.
 *
 * @param args - The argument list after "skills" (e.g., ["list"], ["import", "--from-claude"]).
 * @param projectRoot - Absolute path to the project root.
 */
export async function runSkillsCommand(args: string[], projectRoot: string): Promise<void> {
  const subCommand = args[0] || "list";

  switch (subCommand) {
    case "list":
      await skillsList(projectRoot);
      break;
    case "import":
      await skillsImport(args.slice(1), projectRoot);
      break;
    case "wrap":
      await skillsWrap(args.slice(1), projectRoot);
      break;
    case "show":
      await skillsShow(args.slice(1), projectRoot);
      break;
    case "validate":
      await skillsValidate(args.slice(1), projectRoot);
      break;
    case "remove":
      await skillsRemove(args.slice(1), projectRoot);
      break;
    default:
      process.stdout.write(`${RED}Unknown skills sub-command: ${subCommand}${RESET}\n`);
      process.stdout.write(`\n${BOLD}Usage:${RESET}\n`);
      process.stdout.write(`  dantecode skills list                   List registered skills\n`);
      process.stdout.write(`  dantecode skills import --from-claude   Import skills from Claude\n`);
      process.stdout.write(
        `  dantecode skills import --from-continue Import skills from Continue.dev\n`,
      );
      process.stdout.write(
        `  dantecode skills import --from-opencode Import skills from OpenCode\n`,
      );
      process.stdout.write(
        `  dantecode skills import --file <path>   Import a single skill file\n`,
      );
      process.stdout.write(`  dantecode skills wrap <name>            Wrap an existing skill\n`);
      process.stdout.write(`  dantecode skills show <name>            Show skill definition\n`);
      process.stdout.write(`  dantecode skills validate <name>        Validate a skill\n`);
      process.stdout.write(`  dantecode skills remove <name>          Remove a skill\n`);
      break;
  }
}

// ----------------------------------------------------------------------------
// Sub-Commands
// ----------------------------------------------------------------------------

/**
 * Lists all registered skills in a table format.
 */
async function skillsList(projectRoot: string): Promise<void> {
  const skills = await listSkills(projectRoot);

  if (skills.length === 0) {
    process.stdout.write(
      `\n${DIM}No skills registered.${RESET}\n` +
        `${DIM}Use 'dantecode skills import' to import skills from Claude, Continue.dev, or OpenCode.${RESET}\n\n`,
    );
    return;
  }

  process.stdout.write(`\n${BOLD}Registered Skills (${skills.length}):${RESET}\n\n`);

  // Table header
  const nameWidth = 24;
  const sourceWidth = 12;
  const versionWidth = 10;

  process.stdout.write(
    `  ${"Name".padEnd(nameWidth)} ${"Source".padEnd(sourceWidth)} ${"Version".padEnd(versionWidth)} Description\n`,
  );
  process.stdout.write(
    `  ${"─".repeat(nameWidth)} ${"─".repeat(sourceWidth)} ${"─".repeat(versionWidth)} ${"─".repeat(40)}\n`,
  );

  for (const skill of skills) {
    const name = skill.name.slice(0, nameWidth).padEnd(nameWidth);
    const source = skill.importSource.slice(0, sourceWidth).padEnd(sourceWidth);
    const version = skill.adapterVersion.slice(0, versionWidth).padEnd(versionWidth);
    const desc = skill.description.slice(0, 60);

    process.stdout.write(
      `  ${YELLOW}${name}${RESET} ${DIM}${source}${RESET} ${DIM}${version}${RESET} ${desc}\n`,
    );
  }

  process.stdout.write("\n");
}

/**
 * Imports skills from an external source or a single file.
 */
async function skillsImport(args: string[], projectRoot: string): Promise<void> {
  let source: ImportSource | null = null;
  let singleFilePath: string | null = null;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case "--from-claude":
        source = "claude";
        break;
      case "--from-continue":
        source = "continue";
        break;
      case "--from-opencode":
        source = "opencode";
        break;
      case "--file":
        singleFilePath = args[i + 1] || null;
        i++;
        break;
      default:
        if (!arg.startsWith("--")) {
          singleFilePath = arg;
        }
        break;
    }
  }

  // Handle single file import
  if (singleFilePath) {
    await importSingleFile(singleFilePath, projectRoot);
    return;
  }

  if (!source) {
    process.stdout.write(
      `${RED}No import source specified.${RESET}\n\n` +
        `${BOLD}Usage:${RESET}\n` +
        `  dantecode skills import --from-claude\n` +
        `  dantecode skills import --from-continue\n` +
        `  dantecode skills import --from-opencode\n` +
        `  dantecode skills import --file <path>\n`,
    );
    return;
  }

  process.stdout.write(`\n${DIM}Importing skills from ${source}...${RESET}\n`);

  const result = await importSkills({
    source,
    projectRoot,
  });

  // Print results
  if (result.imported.length > 0) {
    process.stdout.write(`\n${GREEN}Imported (${result.imported.length}):${RESET}\n`);
    for (const name of result.imported) {
      process.stdout.write(`  ${GREEN}+${RESET} ${name}\n`);
    }
  }

  if (result.skipped.length > 0) {
    process.stdout.write(`\n${YELLOW}Skipped (${result.skipped.length}):${RESET}\n`);
    for (const skip of result.skipped) {
      process.stdout.write(`  ${YELLOW}-${RESET} ${skip.name}: ${DIM}${skip.reason}${RESET}\n`);
    }
  }

  if (result.errors.length > 0) {
    process.stdout.write(`\n${RED}Errors (${result.errors.length}):${RESET}\n`);
    for (const error of result.errors) {
      process.stdout.write(`  ${RED}!${RESET} ${error}\n`);
    }
  }

  const total = result.imported.length + result.skipped.length + result.errors.length;
  process.stdout.write(
    `\n${DIM}Total scanned: ${total} | Imported: ${result.imported.length} | Skipped: ${result.skipped.length} | Errors: ${result.errors.length}${RESET}\n\n`,
  );
}

/**
 * Imports a single skill file by reading it, parsing frontmatter, and wrapping it.
 */
async function importSingleFile(filePath: string, projectRoot: string): Promise<void> {
  const resolved = resolve(projectRoot, filePath);

  try {
    const content = await readFile(resolved, "utf-8");

    // Parse basic frontmatter
    let name = basename(filePath, ".md");
    let description = "";

    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch?.[1]) {
      const nameMatch = fmMatch[1].match(/name:\s*(.+)/);
      const descMatch = fmMatch[1].match(/description:\s*(.+)/);
      if (nameMatch?.[1]) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, "");
      if (descMatch?.[1]) description = descMatch[1].trim().replace(/^['"]|['"]$/g, "");
    }

    // Extract instructions (everything after frontmatter)
    const instructions = fmMatch ? content.slice(content.indexOf("---", 3) + 3).trim() : content;

    // Wrap with adapter
    const parsedSkill: ParsedSkill = {
      frontmatter: {
        name,
        description,
      },
      instructions,
      sourcePath: resolved,
    };

    const wrappedContent = wrapSkillWithAdapter(parsedSkill, "claude");

    // Write to .dantecode/skills/<name>/SKILL.dc.md
    const sanitizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-{2,}/g, "-");
    const skillDir = join(projectRoot, ".dantecode", "skills", sanitizedName);
    await mkdir(skillDir, { recursive: true });

    const outputPath = join(skillDir, "SKILL.dc.md");
    await writeFile(outputPath, wrappedContent, "utf-8");

    process.stdout.write(
      `\n${GREEN}Imported skill:${RESET} ${BOLD}${name}${RESET}\n` +
        `  ${DIM}Source: ${resolved}${RESET}\n` +
        `  ${DIM}Output: ${outputPath}${RESET}\n\n`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${RED}Error importing file: ${message}${RESET}\n`);
  }
}

/**
 * Wraps an existing skill with the DanteForge adapter.
 */
async function skillsWrap(args: string[], projectRoot: string): Promise<void> {
  const skillName = args[0];
  if (!skillName) {
    process.stdout.write(`${RED}Usage: dantecode skills wrap <name>${RESET}\n`);
    return;
  }

  const skill = await getSkill(skillName, projectRoot);
  if (!skill) {
    process.stdout.write(`${RED}Skill not found: ${skillName}${RESET}\n`);
    return;
  }

  // Re-wrap the skill with the adapter
  const parsedSkill: ParsedSkill = {
    frontmatter: skill.frontmatter,
    instructions: skill.instructions,
    sourcePath: skill.sourcePath,
  };

  const source: ImportSource = (skill.importSource as ImportSource) || "claude";
  const wrappedContent = wrapSkillWithAdapter(parsedSkill, source);

  // Overwrite the existing SKILL.dc.md
  if (skill.wrappedPath) {
    await writeFile(skill.wrappedPath, wrappedContent, "utf-8");
    process.stdout.write(
      `${GREEN}Re-wrapped skill:${RESET} ${BOLD}${skill.frontmatter.name}${RESET}\n` +
        `  ${DIM}Output: ${skill.wrappedPath}${RESET}\n`,
    );
  } else {
    process.stdout.write(`${RED}No wrapped path found for skill: ${skillName}${RESET}\n`);
  }
}

/**
 * Shows the full definition of a skill.
 */
async function skillsShow(args: string[], projectRoot: string): Promise<void> {
  const skillName = args[0];
  if (!skillName) {
    process.stdout.write(`${RED}Usage: dantecode skills show <name>${RESET}\n`);
    return;
  }

  const skill = await getSkill(skillName, projectRoot);
  if (!skill) {
    process.stdout.write(`${RED}Skill not found: ${skillName}${RESET}\n`);
    return;
  }

  process.stdout.write(`\n${BOLD}Skill: ${skill.frontmatter.name}${RESET}\n`);
  process.stdout.write(`${DIM}Description: ${skill.frontmatter.description}${RESET}\n`);
  process.stdout.write(`${DIM}Source: ${skill.sourcePath}${RESET}\n`);
  process.stdout.write(`${DIM}Wrapped: ${skill.wrappedPath || "N/A"}${RESET}\n`);
  process.stdout.write(`${DIM}Adapter: ${skill.adapterVersion}${RESET}\n`);

  if (skill.frontmatter.tools && skill.frontmatter.tools.length > 0) {
    process.stdout.write(`${DIM}Tools: ${skill.frontmatter.tools.join(", ")}${RESET}\n`);
  }
  if (skill.frontmatter.model) {
    process.stdout.write(`${DIM}Model: ${skill.frontmatter.model}${RESET}\n`);
  }

  process.stdout.write(`\n${BOLD}Instructions:${RESET}\n`);
  process.stdout.write(`${skill.instructions}\n\n`);
}

/**
 * Validates a skill by running anti-stub and constitution checks.
 */
async function skillsValidate(args: string[], projectRoot: string): Promise<void> {
  const skillName = args[0];
  if (!skillName) {
    process.stdout.write(`${RED}Usage: dantecode skills validate <name>${RESET}\n`);
    return;
  }

  const result = await validateSkill(skillName, projectRoot);
  if (!result) {
    process.stdout.write(`${RED}Skill not found: ${skillName}${RESET}\n`);
    return;
  }

  process.stdout.write(`\n${BOLD}Validation Results: ${result.name}${RESET}\n\n`);

  // Anti-stub results
  const antiStubIcon = result.antiStubPassed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
  process.stdout.write(`  Anti-Stub Scan:     ${antiStubIcon}\n`);
  process.stdout.write(`    Hard violations:  ${result.antiStubHardViolations}\n`);
  process.stdout.write(`    Soft violations:  ${result.antiStubSoftViolations}\n`);

  // Constitution results
  const constitutionIcon = result.constitutionPassed
    ? `${GREEN}PASS${RESET}`
    : `${RED}FAIL${RESET}`;
  process.stdout.write(`  Constitution Check: ${constitutionIcon}\n`);
  process.stdout.write(`    Critical:         ${result.constitutionCriticalViolations}\n`);
  process.stdout.write(`    Warnings:         ${result.constitutionWarningViolations}\n`);

  // Overall
  const overallIcon = result.overallPassed ? `${GREEN}PASSED${RESET}` : `${RED}FAILED${RESET}`;
  process.stdout.write(`\n  ${BOLD}Overall:${RESET} ${overallIcon}\n\n`);
}

/**
 * Removes a skill from the registry.
 */
async function skillsRemove(args: string[], projectRoot: string): Promise<void> {
  const skillName = args[0];
  if (!skillName) {
    process.stdout.write(`${RED}Usage: dantecode skills remove <name>${RESET}\n`);
    return;
  }

  const removed = await removeSkill(skillName, projectRoot);
  if (removed) {
    process.stdout.write(`${GREEN}Removed skill:${RESET} ${BOLD}${skillName}${RESET}\n`);
  } else {
    process.stdout.write(`${RED}Skill not found: ${skillName}${RESET}\n`);
  }
}
