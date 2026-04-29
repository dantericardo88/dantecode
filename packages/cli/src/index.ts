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
import { runBenchCommand } from "./commands/bench.js";
import { runA11yCommand } from "./a11y-command.js";

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
  /** --mcp flag — start DanteCode as an MCP stdio server */
  mcp: boolean;
}

/**
 * Parses process.argv into a structured ParsedArgs object.
 * Handles flags, commands, and quoted prompt strings.
 */
/** Initial state for the parser — every field set to its default. */
function makeDefaultParsedArgs(): ParsedArgs {
  return {
    command: null,
    subArgs: [],
    prompt: null,
    model: undefined,
    noGit: false,
    sandbox: true,
    worktree: false,
    verbose: false,
    silent: false,
    configPath: undefined,
    showVersion: false,
    showHelp: false,
    mcp: false,
  };
}

const COMMANDS = new Set([
  "init",
  "skills",
  "agent",
  "config",
  "git",
  "self-update",
  "bench",
  "a11y",
]);

/**
 * Try to consume a known flag at args[i]. On match: mutate `result` and
 * return the new index. On no match: return -1 so the caller can try
 * other branches (command lookup, prompt collection, unknown-flag skip).
 */
function tryParseFlag(arg: string, args: string[], i: number, result: ParsedArgs): number {
  if (arg === "--model" || arg === "-m") {
    result.model = args[i + 1];
    return i + 2;
  }
  if (arg === "--config" || arg === "-c") {
    result.configPath = args[i + 1];
    return i + 2;
  }
  if (arg === "--no-git") { result.noGit = true; return i + 1; }
  if (arg === "--sandbox") { result.sandbox = true; return i + 1; }
  if (arg === "--no-sandbox") { result.sandbox = false; return i + 1; }
  if (arg === "--worktree") { result.worktree = true; return i + 1; }
  if (arg === "--verbose" || arg === "-v") { result.verbose = true; return i + 1; }
  if (arg === "--silent" || arg === "-s") { result.silent = true; return i + 1; }
  if (arg === "--version" || arg === "-V") { result.showVersion = true; return i + 1; }
  if (arg === "--help" || arg === "-h") { result.showHelp = true; return i + 1; }
  if (arg === "--mcp") { result.mcp = true; return i + 1; }
  return -1;
}

/**
 * Skip an unrecognized flag. Consumes a following value-arg only if the
 * next arg doesn't itself start with `-`.
 */
function skipUnknownFlag(args: string[], i: number): number {
  const next = args[i + 1];
  return next && !next.startsWith("-") ? i + 2 : i + 1;
}

/**
 * Sub-arg parsing for after a known command was found. Reuses tryParseFlag
 * for the few flags valid post-command; everything else is collected into
 * result.subArgs.
 */
function parseSubArgs(args: string[], startIdx: number, result: ParsedArgs): void {
  let i = startIdx;
  while (i < args.length) {
    const subArg = args[i]!;
    const next = tryParseFlag(subArg, args, i, result);
    if (next !== -1) {
      i = next;
      continue;
    }
    result.subArgs.push(subArg);
    i += 1;
  }
}

/**
 * Collect a one-shot prompt: everything from startIdx until the next flag.
 * Returns the joined string and the index where parsing should resume.
 */
function collectPromptArgs(args: string[], startIdx: number): { prompt: string; nextIdx: number } {
  const promptParts: string[] = [];
  let i = startIdx;
  while (i < args.length) {
    const nextArg = args[i]!;
    if (nextArg.startsWith("--") || (nextArg.startsWith("-") && nextArg.length === 2)) break;
    promptParts.push(nextArg);
    i += 1;
  }
  return { prompt: promptParts.join(" "), nextIdx: i };
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result = makeDefaultParsedArgs();
  let i = 0;

  while (i < args.length) {
    const arg = args[i]!;

    const flagNext = tryParseFlag(arg, args, i, result);
    if (flagNext !== -1) { i = flagNext; continue; }

    if (arg.startsWith("--") || (arg.startsWith("-") && arg.length === 2)) {
      i = skipUnknownFlag(args, i);
      continue;
    }

    if (COMMANDS.has(arg)) {
      result.command = arg;
      parseSubArgs(args, i + 1, result);
      return result;
    }

    // First non-flag, non-command token starts a one-shot prompt.
    const { prompt, nextIdx } = collectPromptArgs(args, i);
    result.prompt = prompt;
    i = nextIdx;
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

  // --mcp: start DanteCode as an MCP stdio server (for Claude Desktop, Cursor, etc.)
  if (parsed.mcp) {
    const { DanteCodeMCPServer } = await import("@dantecode/mcp");
    const { loadMCPConfig } = await import("@dantecode/mcp");
    const mcpConfig = await loadMCPConfig(projectRoot);
    const server = new DanteCodeMCPServer();
    await server.connectExternal(mcpConfig);
    await server.start();
    return; // stdio transport takes over — process lives until the client disconnects
  }

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
      case "bench":
        await runBenchCommand(parsed.subArgs, projectRoot);
        return;
      case "a11y": {
        const code = await runA11yCommand(parsed.subArgs, { cwd: projectRoot });
        process.exitCode = code;
        return;
      }
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
