// ============================================================================
// @dantecode/cli — Main Entry Point
// Parses CLI arguments, routes to the appropriate command or REPL.
// ============================================================================

import { resolve } from "node:path";
import { getHelpText } from "./banner.js";
import { startRepl, runOneShotPrompt } from "./repl.js";
import type { ReplOptions } from "./repl.js";
import { runInitCommand } from "./commands/init.js";
import { runSkillsCommand } from "./commands/skills.js";
import { runAgentCommand } from "./commands/agent.js";
import { runConfigCommand } from "./commands/config.js";
import { runGitCommand } from "./commands/git.js";
import { runSelfUpdateCommand } from "./commands/self-update.js";

// ----------------------------------------------------------------------------
// Version
// ----------------------------------------------------------------------------

const VERSION = "1.0.0";

// ----------------------------------------------------------------------------
// Argument Parsing
// ----------------------------------------------------------------------------

/** Parsed result from CLI argument parsing. */
interface ParsedArgs {
  /** The primary command (init, skills, agent, config, git) or null for REPL. */
  command: string | null;
  /** Sub-arguments passed to the command. */
  subArgs: string[];
  /** One-shot prompt string (when user does: dantecode "prompt"). */
  prompt: string | null;
  /** --model override */
  model: string | undefined;
  /** --no-git flag */
  noGit: boolean;
  /** --sandbox flag */
  sandbox: boolean;
  /** --worktree flag */
  worktree: boolean;
  /** --verbose flag */
  verbose: boolean;
  /** --silent flag */
  silent: boolean;
  /** --config <path> */
  configPath: string | undefined;
  /** --version flag */
  showVersion: boolean;
  /** --help flag */
  showHelp: boolean;
}

/**
 * Parses process.argv into a structured ParsedArgs object.
 * Handles flags, commands, and quoted prompt strings.
 */
function parseArgs(argv: string[]): ParsedArgs {
  // Skip the first two args (runtime executable and script path)
  const args = argv.slice(2);

  const result: ParsedArgs = {
    command: null,
    subArgs: [],
    prompt: null,
    model: undefined,
    noGit: false,
    sandbox: false,
    worktree: false,
    verbose: false,
    silent: false,
    configPath: undefined,
    showVersion: false,
    showHelp: false,
  };

  const commands = new Set(["init", "skills", "agent", "config", "git", "self-update"]);
  let i = 0;
  let foundCommand = false;

  while (i < args.length) {
    const arg = args[i]!;

    // Flags
    if (arg === "--model" || arg === "-m") {
      result.model = args[i + 1];
      i += 2;
      continue;
    }

    if (arg === "--no-git") {
      result.noGit = true;
      i += 1;
      continue;
    }

    if (arg === "--sandbox") {
      result.sandbox = true;
      i += 1;
      continue;
    }

    if (arg === "--worktree") {
      result.worktree = true;
      i += 1;
      continue;
    }

    if (arg === "--verbose" || arg === "-v") {
      result.verbose = true;
      i += 1;
      continue;
    }

    if (arg === "--silent" || arg === "-s") {
      result.silent = true;
      i += 1;
      continue;
    }

    if (arg === "--config" || arg === "-c") {
      result.configPath = args[i + 1];
      i += 2;
      continue;
    }

    if (arg === "--version" || arg === "-V") {
      result.showVersion = true;
      i += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      result.showHelp = true;
      i += 1;
      continue;
    }

    // Skip unknown flags
    if (arg.startsWith("--") || (arg.startsWith("-") && arg.length === 2)) {
      // Check if this flag takes a value
      if (args[i + 1] && !args[i + 1]!.startsWith("-")) {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    // Commands
    if (!foundCommand && commands.has(arg)) {
      result.command = arg;
      foundCommand = true;
      // All remaining non-flag args are sub-args for the command
      i += 1;
      while (i < args.length) {
        const subArg = args[i]!;
        // Still parse flags even after a command
        if (subArg === "--model" || subArg === "-m") {
          result.model = args[i + 1];
          i += 2;
          continue;
        }
        if (subArg === "--no-git") {
          result.noGit = true;
          i += 1;
          continue;
        }
        if (subArg === "--sandbox") {
          result.sandbox = true;
          i += 1;
          continue;
        }
        if (subArg === "--verbose" || subArg === "-v") {
          result.verbose = true;
          i += 1;
          continue;
        }
        if (subArg === "--silent" || subArg === "-s") {
          result.silent = true;
          i += 1;
          continue;
        }
        result.subArgs.push(subArg);
        i += 1;
      }
      continue;
    }

    // If not a command and not a flag, it's a one-shot prompt
    if (!foundCommand) {
      // Collect all remaining non-flag args as the prompt
      const promptParts: string[] = [arg];
      i += 1;
      while (i < args.length) {
        const nextArg = args[i]!;
        if (nextArg.startsWith("--") || (nextArg.startsWith("-") && nextArg.length === 2)) {
          break;
        }
        promptParts.push(nextArg);
        i += 1;
      }
      result.prompt = promptParts.join(" ");
      continue;
    }

    i += 1;
  }

  return result;
}

// ----------------------------------------------------------------------------
// Main Entry Point
// ----------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  // --version
  if (parsed.showVersion) {
    process.stdout.write(`DanteCode v${VERSION}\n`);
    return;
  }

  // --help
  if (parsed.showHelp) {
    process.stdout.write(getHelpText());
    return;
  }

  // Resolve project root
  const projectRoot = resolve(process.cwd());

  // Build common REPL options
  const replOptions: ReplOptions = {
    projectRoot,
    model: parsed.model,
    enableGit: !parsed.noGit,
    enableSandbox: parsed.sandbox,
    enableWorktree: parsed.worktree,
    verbose: parsed.verbose,
    silent: parsed.silent,
    configPath: parsed.configPath,
  };

  // Route to the appropriate command
  if (parsed.command) {
    switch (parsed.command) {
      case "init":
        await runInitCommand(projectRoot);
        return;
      case "skills":
        await runSkillsCommand(parsed.subArgs, projectRoot);
        return;
      case "agent":
        await runAgentCommand(parsed.subArgs, projectRoot);
        return;
      case "config":
        await runConfigCommand(parsed.subArgs, projectRoot);
        return;
      case "git":
        await runGitCommand(parsed.subArgs, projectRoot);
        return;
      case "self-update":
        await runSelfUpdateCommand(projectRoot, {
          verbose: parsed.verbose,
          dryRun: parsed.subArgs.includes("--dry-run"),
        });
        return;
    }
  }

  // One-shot prompt mode
  if (parsed.prompt) {
    await runOneShotPrompt(parsed.prompt, replOptions);
    return;
  }

  // Default: interactive REPL
  await startRepl(replOptions);
}

// ----------------------------------------------------------------------------
// Run
// ----------------------------------------------------------------------------

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\x1b[31mFatal error: ${message}\x1b[0m\n`);
  process.exit(1);
});
