// ============================================================================
// @dantecode/cli — Git Command
// Sub-commands for git operations: status, log, diff
// ============================================================================

import { execFileSync } from "node:child_process";
import { getStatus, getDiff } from "@dantecode/git-engine";

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ----------------------------------------------------------------------------
// Helper
// ----------------------------------------------------------------------------

/**
 * Runs a git command and returns stdout, or an error message.
 */
function gitExec(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    return stderr || error.message || "Unknown git error";
  }
}

// ----------------------------------------------------------------------------
// Git Command Router
// ----------------------------------------------------------------------------

/**
 * Runs the `dantecode git` command with the given sub-command and arguments.
 *
 * @param args - Arguments after "git" (e.g., ["status"], ["diff", "HEAD~3"]).
 * @param projectRoot - Absolute path to the project root.
 */
export async function runGitCommand(args: string[], projectRoot: string): Promise<void> {
  const subCommand = args[0] || "status";

  switch (subCommand) {
    case "status":
      gitStatus(projectRoot);
      break;
    case "log":
      gitLog(args.slice(1), projectRoot);
      break;
    case "diff":
      gitDiffCmd(args.slice(1), projectRoot);
      break;
    default:
      process.stdout.write(`${RED}Unknown git sub-command: ${subCommand}${RESET}\n`);
      process.stdout.write(`\n${BOLD}Usage:${RESET}\n`);
      process.stdout.write(
        `  dantecode git status              Show DanteCode-managed git status\n`,
      );
      process.stdout.write(`  dantecode git log                 Show commit history\n`);
      process.stdout.write(
        `  dantecode git diff [ref]          Show diff (optionally against a ref)\n`,
      );
      break;
  }
}

// ----------------------------------------------------------------------------
// Sub-Commands
// ----------------------------------------------------------------------------

/**
 * Shows the DanteCode-enhanced git status.
 */
function gitStatus(projectRoot: string): void {
  try {
    const status = getStatus(projectRoot);

    process.stdout.write(`\n${BOLD}Git Status${RESET}\n`);

    // Current branch
    try {
      const branch = gitExec(["rev-parse", "--abbrev-ref", "HEAD"], projectRoot);
      process.stdout.write(`  ${DIM}Branch:${RESET} ${BOLD}${branch}${RESET}\n`);
    } catch {
      // Not a git repo or no commits
    }

    // Remote tracking info
    try {
      const upstream = gitExec(["rev-parse", "--abbrev-ref", "@{upstream}"], projectRoot);
      const aheadBehind = gitExec(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], projectRoot);
      const [behind, ahead] = aheadBehind.split("\t").map(Number);
      if (ahead && ahead > 0) {
        process.stdout.write(`  ${GREEN}Ahead ${ahead} commit(s)${RESET}`);
      }
      if (behind && behind > 0) {
        process.stdout.write(`  ${RED}Behind ${behind} commit(s)${RESET}`);
      }
      if (ahead === 0 && behind === 0) {
        process.stdout.write(`  ${DIM}Up to date with ${upstream}${RESET}`);
      }
      process.stdout.write("\n");
    } catch {
      // No upstream or not a git repo
    }

    process.stdout.write("\n");

    // Staged changes
    if (status.staged.length > 0) {
      process.stdout.write(`  ${GREEN}Staged (${status.staged.length}):${RESET}\n`);
      for (const entry of status.staged) {
        const statusChar = `${entry.index}${entry.workTree}`;
        process.stdout.write(`    ${GREEN}${statusChar}${RESET} ${entry.path}\n`);
      }
      process.stdout.write("\n");
    }

    // Unstaged changes
    if (status.unstaged.length > 0) {
      process.stdout.write(`  ${RED}Modified (${status.unstaged.length}):${RESET}\n`);
      for (const entry of status.unstaged) {
        const statusChar = `${entry.index}${entry.workTree}`;
        process.stdout.write(`    ${RED}${statusChar}${RESET} ${entry.path}\n`);
      }
      process.stdout.write("\n");
    }

    // Untracked files
    if (status.untracked.length > 0) {
      process.stdout.write(`  ${DIM}Untracked (${status.untracked.length}):${RESET}\n`);
      for (const entry of status.untracked) {
        process.stdout.write(`    ${DIM}??${RESET} ${entry.path}\n`);
      }
      process.stdout.write("\n");
    }

    // Conflicts
    if (status.conflicted.length > 0) {
      process.stdout.write(`  ${RED}${BOLD}Conflicted (${status.conflicted.length}):${RESET}\n`);
      for (const entry of status.conflicted) {
        const statusChar = `${entry.index}${entry.workTree}`;
        process.stdout.write(`    ${RED}${BOLD}${statusChar}${RESET} ${entry.path}\n`);
      }
      process.stdout.write("\n");
    }

    // Summary
    const total =
      status.staged.length +
      status.unstaged.length +
      status.untracked.length +
      status.conflicted.length;
    if (total === 0) {
      process.stdout.write(`  ${GREEN}Working tree clean.${RESET}\n\n`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${RED}Error: ${message}${RESET}\n`);
    process.stdout.write(`${DIM}Make sure this is a git repository.${RESET}\n`);
  }
}

/**
 * Shows the commit history with a formatted log.
 */
function gitLog(args: string[], projectRoot: string): void {
  const count = args[0] || "15";

  try {
    const log = gitExec(["log", "--oneline", "--graph", "--decorate", "--color=always", `-${count}`], projectRoot);

    process.stdout.write(`\n${BOLD}Commit History (last ${count}):${RESET}\n\n`);
    process.stdout.write(log);
    process.stdout.write("\n\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${RED}Error reading git log: ${message}${RESET}\n`);
  }
}

/**
 * Shows the diff output, optionally against a specific ref.
 */
function gitDiffCmd(args: string[], projectRoot: string): void {
  const ref = args[0];

  try {
    const diff = getDiff(projectRoot, ref);

    if (!diff || diff.trim().length === 0) {
      if (ref) {
        process.stdout.write(`${DIM}No differences found against ${ref}.${RESET}\n`);
      } else {
        process.stdout.write(`${DIM}No unstaged changes.${RESET}\n`);
      }
      return;
    }

    const header = ref ? `${BOLD}Diff against ${ref}:${RESET}` : `${BOLD}Unstaged changes:${RESET}`;

    process.stdout.write(`\n${header}\n\n`);

    // Colorize diff output
    const lines = diff.split("\n");
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        process.stdout.write(`${GREEN}${line}${RESET}\n`);
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        process.stdout.write(`${RED}${line}${RESET}\n`);
      } else if (line.startsWith("@@")) {
        process.stdout.write(`${CYAN}${line}${RESET}\n`);
      } else if (line.startsWith("diff ")) {
        process.stdout.write(`${BOLD}${line}${RESET}\n`);
      } else {
        process.stdout.write(`${line}\n`);
      }
    }

    process.stdout.write("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${RED}Error getting diff: ${message}${RESET}\n`);
  }
}
