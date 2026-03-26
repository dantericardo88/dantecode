// ============================================================================
// @dantecode/cli — Skills Command
// Sub-commands for managing skills: list, import, wrap, show, validate, remove
// ============================================================================

import { readFile, writeFile, mkdir, stat, unlink, access } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  listSkills,
  getSkill,
  getSkillWithBridgeMeta,
  removeSkill,
  validateSkill,
  importSkills,
  wrapSkillWithAdapter,
  importSkillBridgeBundle,
  listBridgeWarnings,
  validateBridgeSkill,
  installSkill,
  SkillCatalog,
  bundleSkill,
  detectSkillSources,
  parseUniversalSkill,
  SkillChain,
} from "@dantecode/skill-adapter";
import type { ImportSource, ParsedSkill, CatalogEntry } from "@dantecode/skill-adapter";
import { parseSkillMd, validateAgentSkill } from "@dantecode/skills-import";

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
    case "import-bridge":
      await skillsImportBridge(args.slice(1), projectRoot);
      break;
    case "convert":
      await skillsConvert(args.slice(1), projectRoot);
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
    case "install":
      await skillsInstall(args.slice(1), projectRoot);
      break;
    case "search":
      await skillsSearch(args.slice(1), projectRoot);
      break;
    case "scan":
      await skillsScan(args.slice(1), projectRoot);
      break;
    case "info":
    case "skill-info":
      await skillsInfo(args.slice(1), projectRoot);
      break;
    case "disable":
      await skillsDisable(args.slice(1), projectRoot);
      break;
    case "enable":
      await skillsEnable(args.slice(1), projectRoot);
      break;
    case "export":
      await skillsExport(args.slice(1), projectRoot);
      break;
    case "import-all":
      await skillsImportAll(args.slice(1), projectRoot);
      break;
    case "compose":
      await skillsCompose(args.slice(1), projectRoot);
      break;
    case "agent-skills-import":
      await skillsAgentSkillsImport(args.slice(1), projectRoot);
      break;
    default:
      process.stdout.write(`${RED}Unknown skills sub-command: ${subCommand}${RESET}\n`);
      process.stdout.write(`\n${BOLD}Usage:${RESET}\n`);
      process.stdout.write(
        `  dantecode skills list                        List registered skills\n`,
      );
      process.stdout.write(`  dantecode skills import --from-claude        Import from Claude\n`);
      process.stdout.write(
        `  dantecode skills import --from-continue      Import from Continue.dev\n`,
      );
      process.stdout.write(`  dantecode skills import --from-opencode      Import from OpenCode\n`);
      process.stdout.write(
        `  dantecode skills import --from-codex         Import from Codex CLI\n`,
      );
      process.stdout.write(
        `  dantecode skills import --from-cursor        Import from Cursor rules\n`,
      );
      process.stdout.write(
        `  dantecode skills import --from-qwen          Import from Qwen Code\n`,
      );
      process.stdout.write(
        `  dantecode skills import --file <path>        Import a single skill file\n`,
      );
      process.stdout.write(
        `  dantecode skills import-bridge <bundle-dir>  Import a SkillBridge bundle\n`,
      );
      process.stdout.write(
        `  dantecode skills convert <source> --to dantecode  Convert via DanteForge\n`,
      );
      process.stdout.write(
        `  dantecode skills wrap <name>                 Wrap an existing skill\n`,
      );
      process.stdout.write(
        `  dantecode skills show <name>                 Show skill definition\n`,
      );
      process.stdout.write(
        `  dantecode skills info <name>                 Show full metadata for a skill\n`,
      );
      process.stdout.write(`  dantecode skills skill-info <name>           Alias for info\n`);
      process.stdout.write(
        `  dantecode skills disable <name>              Disable a skill (keeps files)\n`,
      );
      process.stdout.write(
        `  dantecode skills enable <name>               Re-enable a disabled skill\n`,
      );
      process.stdout.write(`  dantecode skills validate <name>             Validate a skill\n`);
      process.stdout.write(`  dantecode skills remove <name>               Remove a skill\n`);
      process.stdout.write(
        `  dantecode skills install <source>            Install skill from path/URL\n`,
      );
      process.stdout.write(
        `  dantecode skills search [query]              Search the skill catalog\n`,
      );
      process.stdout.write(
        `  dantecode skills scan [path]                 Scan directory for skill sources\n`,
      );
      process.stdout.write(
        `  dantecode skills export <name> [--out <dir>] Export skill to Agent Skills format\n`,
      );
      process.stdout.write(
        `  dantecode skills import-all <path>           Import all detected skills from path\n`,
      );
      process.stdout.write(
        `  dantecode skills compose <chain-name>        Show/manage a skill chain\n`,
      );
      process.stdout.write(
        `  dantecode skills agent-skills-import [--dir <path>]  Import from .agents/skills/\n`,
      );
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

    // Bridge bucket indicator
    let bucketTag = "";
    if (skill.importSource === "skillbridge" && skill.bucket) {
      const bucketColor =
        skill.bucket === "green" ? GREEN : skill.bucket === "amber" ? YELLOW : RED;
      bucketTag = ` ${bucketColor}[${skill.bucket}]${RESET}`;
    }

    process.stdout.write(
      `  ${YELLOW}${name}${RESET} ${DIM}${source}${RESET} ${DIM}${version}${RESET} ${desc}${bucketTag}\n`,
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
      case "--from-codex":
        source = "codex";
        break;
      case "--from-cursor":
        source = "cursor";
        break;
      case "--from-qwen":
        source = "qwen";
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
        `  dantecode skills import --from-codex\n` +
        `  dantecode skills import --from-cursor\n` +
        `  dantecode skills import --from-qwen\n` +
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

  const content = await readFile(resolved, "utf-8");

  const parseResult = parseSkillMd(content, resolved);
  if (!parseResult.ok) {
    const details = parseResult.errors.map((e) => `[${e.code}] ${e.message}`).join("; ");
    throw new Error(`Skill parse failed — ${details}`);
  }

  const validation = validateAgentSkill(parseResult.skill);
  if (!validation.valid) {
    const details = validation.errors.map((e) => `[${e.code}] ${e.message}`).join("; ");
    throw new Error(`Skill validation failed — ${details}`);
  }
  for (const warn of validation.warnings) {
    process.stdout.write(`${DIM}[${warn.code}] ${warn.message}${RESET}\n`);
  }

  const parsedSkill: ParsedSkill = {
    frontmatter: { name: parseResult.skill.name, description: parseResult.skill.description },
    instructions: parseResult.skill.instructions,
    sourcePath: parseResult.skill.sourcePath,
  };

  const wrappedContent = wrapSkillWithAdapter(parsedSkill, "claude");

  // Write to .dantecode/skills/<name>/SKILL.dc.md
  const name = parseResult.skill.name;
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

  // Show bridge metadata if this is a skillbridge-sourced skill
  if (skill.importSource === "skillbridge") {
    await showBridgeDetails(skillName, projectRoot);
  }
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
  process.stdout.write(`\n  ${BOLD}Overall:${RESET} ${overallIcon}\n`);

  // For bridge skills, also validate bundle integrity
  const skillDef = await getSkill(skillName, projectRoot);
  if (skillDef?.importSource === "skillbridge") {
    const bridgeValid = await validateBridgeSkill(skillName, projectRoot);
    const bridgeIcon = bridgeValid ? `${GREEN}VALID${RESET}` : `${RED}INVALID${RESET}`;
    process.stdout.write(`  Bridge manifest:    ${bridgeIcon}\n`);
    process.stdout.write("\n");
  } else {
    process.stdout.write("\n");
  }
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

/**
 * Imports a compiled SkillBridge bundle into the local project.
 * Usage: dantecode skills import-bridge <bundle-dir> [--allow-blocked] [--force] [--dry-run]
 */
async function skillsImportBridge(args: string[], projectRoot: string): Promise<void> {
  const bundleDir = args.find((a) => !a.startsWith("--"));
  const allowBlocked = args.includes("--allow-blocked");
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");

  if (!bundleDir) {
    process.stdout.write(
      `${RED}Usage: dantecode skills import-bridge <bundle-dir> [--allow-blocked] [--force] [--dry-run]${RESET}\n\n` +
        `${DIM}  <bundle-dir>     Path to the compiled SkillBridge bundle (contains skillbridge.json)\n` +
        `  --allow-blocked  Import even if the bundle is classified as red (blocked)\n` +
        `  --force          Overwrite an existing skill with the same slug\n` +
        `  --dry-run        Preview import without writing any files${RESET}\n`,
    );
    return;
  }

  const resolvedBundleDir = resolve(projectRoot, bundleDir);

  if (dryRun) {
    process.stdout.write(
      `\n${YELLOW}[DRY RUN]${RESET} ${DIM}Previewing import from: ${resolvedBundleDir}${RESET}\n`,
    );
  } else {
    process.stdout.write(
      `\n${DIM}Importing SkillBridge bundle from: ${resolvedBundleDir}${RESET}\n`,
    );
  }

  const result = await importSkillBridgeBundle({
    bundleDir: resolvedBundleDir,
    projectRoot,
    allowBlocked,
    force,
    dryRun,
  });

  if (!result.success) {
    process.stdout.write(`\n${RED}Import failed:${RESET} ${result.error ?? "Unknown error"}\n\n`);
    return;
  }

  // Bucket indicator
  const bucketColor = result.bucket === "green" ? GREEN : result.bucket === "amber" ? YELLOW : RED;
  const bucketLabel = result.bucket.toUpperCase();

  if (result.dryRun) {
    process.stdout.write(
      `\n${YELLOW}[DRY RUN]${RESET} Would import: ${BOLD}${result.slug}${RESET}\n` +
        `  ${DIM}Skill dir:       ${result.skillDir}${RESET}\n` +
        `  ${DIM}Quality bucket:  ${bucketColor}${bucketLabel}${RESET}\n` +
        `  ${DIM}Conv. score:     ${(result.conversionScore * 100).toFixed(0)}%${RESET}\n` +
        `\n${YELLOW}[DRY RUN]${RESET} ${DIM}No files were written.${RESET}\n`,
    );
  } else {
    process.stdout.write(
      `\n${GREEN}Bundle imported:${RESET} ${BOLD}${result.slug}${RESET}\n` +
        `  ${DIM}Skill dir:       ${result.skillDir}${RESET}\n` +
        `  ${DIM}Quality bucket:  ${bucketColor}${bucketLabel}${RESET}\n` +
        `  ${DIM}Conv. score:     ${(result.conversionScore * 100).toFixed(0)}%${RESET}\n`,
    );
  }

  if (result.runtimeWarnings.length > 0) {
    process.stdout.write(
      `\n${YELLOW}Runtime warnings (${result.runtimeWarnings.length}):${RESET}\n`,
    );
    for (const w of result.runtimeWarnings) {
      process.stdout.write(`  ${YELLOW}!${RESET} ${w}\n`);
    }
  }

  if (result.conversionWarnings.length > 0) {
    process.stdout.write(
      `\n${DIM}Conversion warnings (${result.conversionWarnings.length}):${RESET}\n`,
    );
    for (const w of result.conversionWarnings) {
      process.stdout.write(`  ${DIM}- ${w}${RESET}\n`);
    }
  }

  if (!result.dryRun) {
    process.stdout.write(
      `\n${DIM}Use 'dantecode skills show ${result.slug}' to view the skill.${RESET}\n\n`,
    );
  }
}

/**
 * Facade command: dantecode skills convert <source> --to dantecode
 * Delegates conversion to DanteForge binary, then imports the resulting bundle.
 */
async function skillsConvert(args: string[], projectRoot: string): Promise<void> {
  const source = args.find((a) => !a.startsWith("--"));
  const toTargets = (() => {
    const idx = args.indexOf("--to");
    return idx !== -1 && args[idx + 1] ? (args[idx + 1] ?? "dantecode") : "dantecode";
  })();

  // Parse --bundle-dir <path> option
  const bundleDirIdx = args.indexOf("--bundle-dir");
  const bundleDirOverride =
    bundleDirIdx !== -1 && args[bundleDirIdx + 1] ? args[bundleDirIdx + 1] : undefined;

  if (!source) {
    process.stdout.write(
      `${RED}Usage: dantecode skills convert <source> --to dantecode${RESET}\n\n` +
        `${DIM}  <source>         Local folder, single SKILL.md, or GitHub URL\n` +
        `  --to             Target(s): dantecode,qwen-skill,mcp (default: dantecode)\n` +
        `  --bundle-dir     Override the path to the compiled bundle directory${RESET}\n` +
        `\n${DIM}This command delegates to 'danteforge skills convert' and then imports\n` +
        `the resulting bundle via 'dantecode skills import-bridge'.${RESET}\n`,
    );
    return;
  }

  process.stdout.write(
    `\n${DIM}Converting skill source via DanteForge: ${source}${RESET}\n` +
      `${DIM}Target(s): ${toTargets}${RESET}\n\n`,
  );

  // Shell out to danteforge binary for the actual compilation
  const execFileAsync = promisify(execFile);

  const dfArgs = ["skills", "convert", source, "--to", toTargets, "--verify"];

  try {
    const { stdout, stderr } = await execFileAsync("danteforge", dfArgs, {
      cwd: projectRoot,
      timeout: 120_000,
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      `${RED}DanteForge conversion failed:${RESET} ${message}\n` +
        `\n${DIM}Make sure 'danteforge' is installed and available in PATH.\n` +
        `Alternatively, run the conversion manually and use:\n` +
        `  dantecode skills import-bridge <bundle-dir>${RESET}\n`,
    );
    return;
  }

  // Derive the expected bundle output path
  // DanteForge defaults to .danteforge/converted/<slug>/
  const rawSlug = resolve(projectRoot, source).split(/[\\/]/).filter(Boolean).pop() ?? "skill";
  const slug = rawSlug.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const defaultBundleDir = join(projectRoot, ".danteforge", "converted", slug);
  const bundleDir = bundleDirOverride ? resolve(projectRoot, bundleDirOverride) : defaultBundleDir;

  // Verify the bundle directory exists before attempting import
  try {
    await stat(bundleDir);
  } catch {
    process.stderr.write(`Bundle directory not found: ${bundleDir}\n`);
    process.stderr.write(
      `Hint: DanteForge may have written to a different path. Use --bundle-dir <path> to specify it.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`\n${DIM}Importing bundle: ${bundleDir}${RESET}\n`);
  await skillsImportBridge([bundleDir], projectRoot);
}

/**
 * Augments skillsShow to display bridge metadata when present.
 * Called from show for skillbridge-sourced skills.
 */
async function showBridgeDetails(skillName: string, projectRoot: string): Promise<void> {
  const warnings = await listBridgeWarnings(skillName, projectRoot);
  if (!warnings) return;

  const bucketColor =
    warnings.bucket === "green" ? GREEN : warnings.bucket === "amber" ? YELLOW : RED;

  process.stdout.write(`\n${BOLD}SkillBridge Metadata:${RESET}\n`);
  process.stdout.write(
    `  ${DIM}Quality bucket:  ${bucketColor}${warnings.bucket.toUpperCase()}${RESET}\n`,
  );
  process.stdout.write(
    `  ${DIM}Conv. score:     ${(warnings.conversionScore * 100).toFixed(0)}%${RESET}\n`,
  );

  if (warnings.runtimeWarnings.length > 0) {
    process.stdout.write(
      `\n${YELLOW}Runtime warnings (${warnings.runtimeWarnings.length}):${RESET}\n`,
    );
    for (const w of warnings.runtimeWarnings) {
      process.stdout.write(`  ${YELLOW}!${RESET} ${w}\n`);
    }
  }

  const valid = await validateBridgeSkill(skillName, projectRoot);
  const validIcon = valid ? `${GREEN}VALID${RESET}` : `${RED}INVALID${RESET}`;
  process.stdout.write(`\n  ${DIM}Bundle integrity: ${validIcon}\n${RESET}`);
}

// ----------------------------------------------------------------------------
// New Sub-Commands (Lane 3)
// ----------------------------------------------------------------------------

/**
 * Installs a skill from a local path, git URL, or HTTP URL.
 * Usage: dantecode skills install <source> [--tier guardian|sentinel|sovereign] [--force] [--symlink] [--no-verify]
 */
async function skillsInstall(args: string[], projectRoot: string): Promise<void> {
  // Parse args
  const source = args.find((a) => !a.startsWith("--"));
  if (!source) {
    process.stdout.write(
      `${RED}Usage: dantecode skills install <source> [--tier guardian|sentinel|sovereign] [--force] [--symlink] [--no-verify]${RESET}\n`,
    );
    return;
  }

  let tier: "guardian" | "sentinel" | "sovereign" = "guardian";
  const tierIdx = args.indexOf("--tier");
  if (tierIdx !== -1 && args[tierIdx + 1]) {
    const t = args[tierIdx + 1] as string;
    if (t === "guardian" || t === "sentinel" || t === "sovereign") {
      tier = t;
    } else {
      process.stderr.write(
        `Error: invalid --tier value "${t}". Must be one of: guardian, sentinel, sovereign\n`,
      );
      process.exit(1);
    }
  }

  const force = args.includes("--force");
  const symlink = args.includes("--symlink");
  const noVerify = args.includes("--no-verify");

  process.stdout.write(`\n${DIM}Installing skill from: ${source}...${RESET}\n`);

  const result = await installSkill(
    { source, verify: !noVerify, tier, force, symlink },
    projectRoot,
  );

  if (result.success) {
    process.stdout.write(`\n${GREEN}Skill installed:${RESET} ${BOLD}${result.name}${RESET}\n`);
    process.stdout.write(`  ${DIM}Installed path: ${result.installedPath}${RESET}\n`);
    if (result.verification) {
      process.stdout.write(
        `  ${DIM}Verification score: ${result.verification.overallScore} (${result.verification.tier})${RESET}\n`,
      );
    }
    process.stdout.write("\n");
  } else {
    process.stdout.write(`\n${RED}Install failed:${RESET} ${result.error ?? "Unknown error"}\n\n`);
  }
}

/**
 * Searches the skill catalog for matching entries.
 * Usage: dantecode skills search [query] [--tag <tag>] [--source <format>] [--tier <tier>] [--verified-only]
 */
async function skillsSearch(args: string[], projectRoot: string): Promise<void> {
  const query = args.find((a) => !a.startsWith("--")) ?? "";

  const tagIdx = args.indexOf("--tag");
  const tag = tagIdx !== -1 ? args[tagIdx + 1] : undefined;

  const sourceIdx = args.indexOf("--source");
  const sourceFilter = sourceIdx !== -1 ? args[sourceIdx + 1] : undefined;

  const tierIdx = args.indexOf("--tier");
  const tierFilter = tierIdx !== -1 ? args[tierIdx + 1] : undefined;

  const verifiedOnly = args.includes("--verified-only");

  const catalog = new SkillCatalog(projectRoot);
  await catalog.load();

  let entries = query ? catalog.search(query) : catalog.getAll();

  if (tag) {
    const tagLower = tag.toLowerCase();
    entries = entries.filter((e: CatalogEntry) =>
      e.tags.some((t: string) => t.toLowerCase() === tagLower),
    );
  }

  if (sourceFilter) {
    entries = entries.filter((e: CatalogEntry) => e.source === sourceFilter);
  }

  if (tierFilter) {
    entries = entries.filter((e: CatalogEntry) => e.verificationTier === tierFilter);
  }

  if (verifiedOnly) {
    entries = entries.filter((e: CatalogEntry) => e.verificationScore !== undefined);
  }

  if (entries.length === 0) {
    process.stdout.write(`\n${DIM}No skills found matching your criteria.${RESET}\n\n`);
    return;
  }

  process.stdout.write(`\n${BOLD}Skill Search Results (${entries.length}):${RESET}\n\n`);

  const nameWidth = 24;
  const sourceWidth = 12;
  const tierWidth = 10;
  const scoreWidth = 8;

  process.stdout.write(
    `  ${"Name".padEnd(nameWidth)} ${"Source".padEnd(sourceWidth)} ${"Tier".padEnd(tierWidth)} ${"Score".padEnd(scoreWidth)} Description\n`,
  );
  process.stdout.write(
    `  ${"─".repeat(nameWidth)} ${"─".repeat(sourceWidth)} ${"─".repeat(tierWidth)} ${"─".repeat(scoreWidth)} ${"─".repeat(40)}\n`,
  );

  for (const entry of entries) {
    const name = entry.name.slice(0, nameWidth).padEnd(nameWidth);
    const src = entry.source.slice(0, sourceWidth).padEnd(sourceWidth);
    const tier = (entry.verificationTier ?? "-").slice(0, tierWidth).padEnd(tierWidth);
    const score =
      entry.verificationScore !== undefined
        ? String(entry.verificationScore).slice(0, scoreWidth).padEnd(scoreWidth)
        : "-".padEnd(scoreWidth);
    const desc = entry.description.slice(0, 60);

    process.stdout.write(
      `  ${YELLOW}${name}${RESET} ${DIM}${src}${RESET} ${DIM}${tier}${RESET} ${DIM}${score}${RESET} ${desc}\n`,
    );
  }

  process.stdout.write("\n");
}

/**
 * Scans a directory for skill source formats.
 * Usage: dantecode skills scan [path]
 */
async function skillsScan(args: string[], projectRoot: string): Promise<void> {
  const scanPath = args.find((a) => !a.startsWith("--")) ?? projectRoot;
  const resolvedScanPath = resolve(projectRoot, scanPath);

  process.stdout.write(`\n${DIM}Scanning: ${resolvedScanPath}${RESET}\n`);

  const detections = await detectSkillSources(resolvedScanPath);

  if (detections.length === 0) {
    process.stdout.write(`\n${DIM}No skill sources detected.${RESET}\n\n`);
    return;
  }

  process.stdout.write(`\n${BOLD}Found ${detections.length} skill source(s):${RESET}\n\n`);

  for (const detection of detections) {
    const pct = Math.round(detection.confidence * 100);
    process.stdout.write(
      `  ${YELLOW}${detection.format}${RESET} ${DIM}(${pct}% confidence)${RESET} — ${detection.paths.length} file(s) found\n`,
    );
    for (const p of detection.paths) {
      process.stdout.write(`    ${DIM}${p}${RESET}\n`);
    }
  }

  process.stdout.write("\n");
}

/**
 * Exports/bundles a skill to a directory.
 * Usage: dantecode skills export <name> [--out <dir>]
 *        dantecode skills export <name> [outputPath]  (legacy positional form)
 *
 * When --out is provided, writes to Agent Skills format: <out>/<slug>/SKILL.md
 * Otherwise falls back to bundleSkill (legacy behavior, optionally with positional outputPath).
 */
async function skillsExport(args: string[], projectRoot: string): Promise<void> {
  // Collect positional args (not flags and not values that directly follow a known flag)
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--out") {
      i++; // skip the value
    } else if (!a.startsWith("--")) {
      positional.push(a);
    }
  }
  const skillName = positional[0];
  if (!skillName) {
    process.stdout.write(`${RED}Usage: dantecode skills export <name> [--out <dir>]${RESET}\n`);
    return;
  }

  // Parse --out flag
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 && args[outIdx + 1] ? resolve(projectRoot, args[outIdx + 1]!) : null;

  process.stdout.write(`\n${DIM}Exporting skill: ${skillName}${RESET}\n`);

  const skill = await getSkill(skillName, projectRoot);
  if (!skill) {
    process.stdout.write(`${RED}Skill not found: ${skillName}${RESET}\n`);
    return;
  }

  if (outDir !== null) {
    // Agent Skills format: <out>/<slug>/SKILL.md
    const slug = skillName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const skillOutDir = join(outDir, slug);
    const skillOutFile = join(skillOutDir, "SKILL.md");

    try {
      await mkdir(skillOutDir, { recursive: true });

      // Build Agent Skills SKILL.md content from the skill definition
      const mdLines: string[] = [];
      mdLines.push("---");
      mdLines.push(`name: ${skill.frontmatter.name}`);
      mdLines.push(`description: ${skill.frontmatter.description}`);
      mdLines.push(`import_source: ${skill.importSource ?? "dantecode"}`);
      if (skill.frontmatter.tools && skill.frontmatter.tools.length > 0) {
        mdLines.push(`tools:`);
        for (const t of skill.frontmatter.tools) {
          mdLines.push(`  - ${t}`);
        }
      }
      mdLines.push("---");
      mdLines.push("");
      mdLines.push(skill.instructions);

      await writeFile(skillOutFile, mdLines.join("\n"), "utf-8");

      // Make relative path for display
      const displayPath = `./agent-skills-export/${slug}/SKILL.md`;
      process.stdout.write(
        `\n${GREEN}Exported ${skillName}${RESET} ${DIM}→ ${displayPath}${RESET}\n\n`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\n${RED}Export failed:${RESET} ${message}\n\n`);
    }
    return;
  }

  // Legacy: use bundleSkill; support positional outputPath as second arg
  const legacyOutputPath =
    positional[1] != null
      ? resolve(projectRoot, positional[1])
      : join(projectRoot, "exported-skills", skillName.toLowerCase().replace(/[^a-z0-9-]/g, "-"));

  const result = await bundleSkill(
    {
      skillName,
      outputPath: legacyOutputPath,
      includeVerification: true,
      includeScripts: true,
    },
    projectRoot,
  );

  if (result.success) {
    process.stdout.write(`\n${GREEN}Skill exported:${RESET} ${BOLD}${skillName}${RESET}\n`);
    process.stdout.write(`  ${DIM}Output path: ${result.outputPath}${RESET}\n`);
    process.stdout.write(`  ${DIM}Files written: ${result.filesWritten}${RESET}\n\n`);
  } else {
    process.stdout.write(`\n${RED}Export failed:${RESET} ${result.error ?? "Unknown error"}\n\n`);
  }
}

// ----------------------------------------------------------------------------
// Lane D — New Sub-Commands
// ----------------------------------------------------------------------------

/**
 * Displays full metadata for a named skill using getSkillWithBridgeMeta.
 * Usage: dantecode skills info <name>
 *        dantecode skills skill-info <name>
 */
async function skillsInfo(args: string[], projectRoot: string): Promise<void> {
  const skillName = args[0];
  if (!skillName) {
    process.stdout.write(`${RED}Usage: dantecode skills info <name>${RESET}\n`);
    return;
  }

  const skill = await getSkillWithBridgeMeta(skillName, projectRoot);
  if (!skill) {
    process.stdout.write(`${RED}Skill not found: ${skillName}${RESET}\n`);
    return;
  }

  // Check if a .disabled marker exists
  const slug = skillName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const disabledMarker = join(projectRoot, ".dantecode", "skills", slug, ".disabled");
  let isDisabled = false;
  try {
    await access(disabledMarker);
    isDisabled = true;
  } catch {
    // file does not exist — skill is enabled
  }

  const status = isDisabled ? `${YELLOW}disabled${RESET}` : `${GREEN}enabled${RESET}`;

  process.stdout.write(`\n${BOLD}Skill:${RESET} ${skill.frontmatter.name}\n`);

  const importSource = skill.importSource ?? "unknown";
  const scope = importSource === "claude" ? "global" : "project";
  process.stdout.write(`${DIM}Source:${RESET} ${importSource} (${scope} scope)\n`);
  process.stdout.write(`${DIM}Scope:${RESET} ${scope}\n`);

  if (skill.wrappedPath) {
    process.stdout.write(`${DIM}Path:${RESET} ${skill.wrappedPath}\n`);
  }

  if (skill.sourcePath && skill.sourcePath !== skill.wrappedPath) {
    process.stdout.write(
      `${DIM}Provenance:${RESET} imported from ${importSource} at ${skill.sourcePath}\n`,
    );
  }

  if (skill.frontmatter.tools && skill.frontmatter.tools.length > 0) {
    const toolEnforcement = "(advisory)";
    process.stdout.write(
      `${DIM}Allowed tools:${RESET} ${skill.frontmatter.tools.join(", ")} ${toolEnforcement}\n`,
    );
  }

  // Compatibility: list sources that can run this skill
  const compatibility: string[] = ["claude"];
  if (importSource !== "claude") compatibility.push(importSource);
  process.stdout.write(`${DIM}Compatibility:${RESET} ${compatibility.join(", ")}\n`);

  // License: default MIT (BridgeBundleMetadata does not carry a license field)
  const license = "MIT";
  process.stdout.write(`${DIM}License:${RESET} ${license}\n`);

  process.stdout.write(`${DIM}Status:${RESET} ${status}\n`);

  // Show bridge metadata if present
  if (skill.bridgeMeta) {
    const meta = skill.bridgeMeta;
    const bucket = meta.bucket ?? "unknown";
    const bucketColor = bucket === "green" ? GREEN : bucket === "amber" ? YELLOW : RED;
    process.stdout.write(`\n${BOLD}SkillBridge:${RESET}\n`);
    process.stdout.write(
      `  ${DIM}Quality bucket:  ${bucketColor}${bucket.toUpperCase()}${RESET}\n`,
    );
    if (meta.conversionScore !== undefined) {
      process.stdout.write(
        `  ${DIM}Conv. score:     ${(meta.conversionScore * 100).toFixed(0)}%${RESET}\n`,
      );
    }
  }

  process.stdout.write("\n");
}

/**
 * Marks a skill as disabled by writing a `.disabled` marker file.
 * Usage: dantecode skills disable <name>
 */
async function skillsDisable(args: string[], projectRoot: string): Promise<void> {
  const skillName = args[0];
  if (!skillName) {
    process.stdout.write(`${RED}Usage: dantecode skills disable <name>${RESET}\n`);
    return;
  }

  // Verify the skill exists
  const skill = await getSkill(skillName, projectRoot);
  if (!skill) {
    process.stdout.write(`${RED}Skill not found: ${skillName}${RESET}\n`);
    return;
  }

  const slug = skillName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const skillDir = join(projectRoot, ".dantecode", "skills", slug);
  const disabledMarker = join(skillDir, ".disabled");

  try {
    await writeFile(disabledMarker, "", "utf-8");
    process.stdout.write(
      `${GREEN}Skill "${skillName}" disabled.${RESET} ` +
        `${DIM}Re-enable with: dantecode skills enable ${skillName}${RESET}\n`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${RED}Failed to disable skill: ${message}${RESET}\n`);
  }
}

/**
 * Re-enables a disabled skill by removing the `.disabled` marker file.
 * Usage: dantecode skills enable <name>
 */
async function skillsEnable(args: string[], projectRoot: string): Promise<void> {
  const skillName = args[0];
  if (!skillName) {
    process.stdout.write(`${RED}Usage: dantecode skills enable <name>${RESET}\n`);
    return;
  }

  // Verify the skill exists
  const skill = await getSkill(skillName, projectRoot);
  if (!skill) {
    process.stdout.write(`${RED}Skill not found: ${skillName}${RESET}\n`);
    return;
  }

  const slug = skillName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const disabledMarker = join(projectRoot, ".dantecode", "skills", slug, ".disabled");

  try {
    await unlink(disabledMarker);
    process.stdout.write(`${GREEN}Skill "${skillName}" enabled.${RESET}\n`);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Not disabled — still report success
      process.stdout.write(
        `${GREEN}Skill "${skillName}" enabled.${RESET} ${DIM}(was not disabled)${RESET}\n`,
      );
    } else {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`${RED}Failed to enable skill: ${message}${RESET}\n`);
    }
  }
}

/**
 * Imports skills from .agents/skills/ (Agent Skills compat dir) or --dir override.
 * Usage: dantecode skills agent-skills-import [--dir <path>]
 */
async function skillsAgentSkillsImport(args: string[], projectRoot: string): Promise<void> {
  // Parse --dir flag
  const dirIdx = args.indexOf("--dir");
  const importDir =
    dirIdx !== -1 && args[dirIdx + 1]
      ? resolve(projectRoot, args[dirIdx + 1]!)
      : join(projectRoot, ".agents", "skills");

  process.stdout.write(`\n${DIM}Scanning for Agent Skills in: ${importDir}${RESET}\n`);

  // Check the directory exists
  let dirEntries: string[];
  try {
    const { readdir: fsReaddir } = await import("node:fs/promises");
    dirEntries = await fsReaddir(importDir);
  } catch {
    process.stdout.write(
      `${YELLOW}Agent Skills directory not found: ${importDir}${RESET}\n` +
        `${DIM}Create .agents/skills/ and place SKILL.md files inside skill subdirectories,\n` +
        `or specify a path with --dir <path>.${RESET}\n\n`,
    );
    return;
  }

  if (dirEntries.length === 0) {
    process.stdout.write(`${YELLOW}No entries found in: ${importDir}${RESET}\n`);
    return;
  }

  process.stdout.write(`\n${BOLD}Found ${dirEntries.length} candidate(s):${RESET}\n\n`);

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of dirEntries) {
    const entryPath = join(importDir, entry);

    // Try SKILL.md inside subdirectory, then treat the entry itself as a skill file
    let skillFilePath: string | null = null;
    try {
      const entryInfo = await stat(entryPath);
      if (entryInfo.isDirectory()) {
        // Look for SKILL.md inside the subdir
        const candidatePath = join(entryPath, "SKILL.md");
        try {
          await access(candidatePath);
          skillFilePath = candidatePath;
        } catch {
          // No SKILL.md inside subdirectory
        }
      } else if (entry.endsWith(".md")) {
        skillFilePath = entryPath;
      }
    } catch {
      // Cannot stat entry
    }

    if (!skillFilePath) {
      process.stdout.write(`  ${DIM}${entry}${RESET} ${YELLOW}[SKIP] no SKILL.md found${RESET}\n`);
      skipped++;
      continue;
    }

    process.stdout.write(`  ${DIM}Importing: ${entry}...${RESET} `);

    try {
      await importSingleFile(skillFilePath, projectRoot);
      imported++;
      // importSingleFile already prints success; suppress duplicate by overwriting
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`${RED}[FAIL] ${DIM}${message}${RESET}\n`);
      failed++;
    }
  }

  process.stdout.write(
    `\n${DIM}Agent Skills import complete — Imported: ${imported}, Skipped: ${skipped}, Failed: ${failed}${RESET}\n\n`,
  );
}

/**
 * Imports all detected skills from a directory.
 * Usage: dantecode skills import-all <path> [--force] [--no-verify] [--tier guardian|sentinel|sovereign]
 */
async function skillsImportAll(args: string[], projectRoot: string): Promise<void> {
  const scanPath = args.find((a) => !a.startsWith("--"));
  if (!scanPath) {
    process.stdout.write(
      `${RED}Usage: dantecode skills import-all <path> [--force] [--no-verify] [--tier guardian|sentinel|sovereign]${RESET}\n`,
    );
    return;
  }

  const force = args.includes("--force");
  const noVerify = args.includes("--no-verify");

  let tier: "guardian" | "sentinel" | "sovereign" = "guardian";
  const tierIdx = args.indexOf("--tier");
  if (tierIdx !== -1 && args[tierIdx + 1]) {
    const t = args[tierIdx + 1] as string;
    if (t === "guardian" || t === "sentinel" || t === "sovereign") {
      tier = t;
    } else {
      process.stderr.write(
        `Error: invalid --tier value "${t}". Must be one of: guardian, sentinel, sovereign\n`,
      );
      process.exit(1);
    }
  }

  const resolvedScanPath = resolve(projectRoot, scanPath);

  process.stdout.write(`\n${DIM}Scanning: ${resolvedScanPath}${RESET}\n`);

  const detections = await detectSkillSources(resolvedScanPath);

  if (detections.length === 0) {
    process.stdout.write(`${YELLOW}No skill sources detected at: ${resolvedScanPath}${RESET}\n`);
    return;
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const detection of detections) {
    for (const skillPath of detection.paths) {
      let skillName =
        basename(skillPath)
          .replace(/\.(md|mdc|toml)$/i, "")
          .replace(/^SKILL[._-]?/i, "")
          .toLowerCase() || "unknown";

      try {
        const parsed = await parseUniversalSkill(skillPath, detection.format);
        skillName = parsed.name;

        process.stdout.write(`  ${DIM}Installing ${skillName}...${RESET} `);

        const result = await installSkill(
          { source: skillPath, verify: !noVerify, tier, force },
          projectRoot,
        );

        if (result.success) {
          process.stdout.write(`${GREEN}[OK]${RESET}\n`);
          imported++;
        } else {
          process.stdout.write(`${YELLOW}[SKIP] ${DIM}${result.error ?? ""}${RESET}\n`);
          skipped++;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stdout.write(`${RED}[FAIL] ${DIM}${message}${RESET}\n`);
        failed++;
      }
    }
  }

  process.stdout.write(
    `\n${DIM}Imported: ${imported}, Skipped: ${skipped}, Failed: ${failed}${RESET}\n\n`,
  );
}

/**
 * Shows or initializes a skill chain definition.
 * Usage: dantecode skills compose <chain-name>
 */
async function skillsCompose(args: string[], projectRoot: string): Promise<void> {
  const chainName = args[0];
  if (!chainName) {
    process.stdout.write(`${RED}Usage: dantecode skills compose <name>${RESET}\n`);
    return;
  }

  const chainFile = join(projectRoot, ".dantecode", "skill-chains", `${chainName}.yaml`);

  let fileContent: string | null = null;
  try {
    fileContent = await readFile(chainFile, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  if (fileContent !== null) {
    process.stdout.write(`\n${BOLD}Skill Chain: ${chainName}${RESET}\n`);
    process.stdout.write(`${DIM}File: ${chainFile}${RESET}\n\n`);

    try {
      const chain = SkillChain.fromYAML(fileContent);
      const steps = chain.getSteps();

      process.stdout.write(`${BOLD}Steps (${steps.length}):${RESET}\n`);
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        process.stdout.write(`  ${i + 1}. ${YELLOW}${step.skillName}${RESET}`);
        if (step.gate) {
          const gateDesc: string[] = [];
          if (step.gate.minPdse !== undefined) {
            gateDesc.push(`minPdse: ${step.gate.minPdse}`);
          }
          if (step.gate.onFail) {
            gateDesc.push(`onFail: ${step.gate.onFail}`);
          }
          process.stdout.write(` ${DIM}[gate: ${gateDesc.join(", ")}]${RESET}`);
        }
        process.stdout.write("\n");
      }
      process.stdout.write("\n");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`${RED}Error parsing chain file: ${message}${RESET}\n`);
      process.stdout.write(`${DIM}Raw content:\n${fileContent}${RESET}\n`);
    }
  } else {
    process.stdout.write(`\n${BOLD}Chain '${chainName}' not found.${RESET}\n`);
    process.stdout.write(`${DIM}To create it, write a YAML file at:${RESET}\n`);
    process.stdout.write(`  ${chainFile}\n\n`);
    process.stdout.write(`${BOLD}Template:${RESET}\n`);

    const template = new SkillChain(chainName, "Describe your chain here");
    template.add("skill-one", { input: "$input" });
    template.addGate("skill-two", { minPdse: 80, onFail: "stop" }, { data: "$previous.output" });

    process.stdout.write(`${DIM}${template.toYAML()}${RESET}`);
    process.stdout.write(
      `\n${DIM}Chain builder: add steps interactively using the /skill-chain API${RESET}\n\n`,
    );
  }
}
