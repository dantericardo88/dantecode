// ============================================================================
// @dantecode/git-engine — Auto-Commit System (Aider-derived)
// ============================================================================

import { execSync } from "node:child_process";
import type { GitCommitSpec } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Result returned after a successful auto-commit. */
export interface CommitResult {
  commitHash: string;
  message: string;
  filesCommitted: string[];
}

/** Result returned after a successful git push that was verified remotely. */
export interface PushResult {
  remote: string;
  branch: string;
  localCommit: string;
  remoteCommit: string;
  output: string;
  setUpstream: boolean;
}

/** A single entry from `git status --porcelain`. */
export interface StatusEntry {
  /** Two-character status code (e.g. "M ", " M", "??", "A ", "D "). */
  index: string;
  /** Two-character status code (e.g. "M ", " M", "??", "A ", "D "). */
  workTree: string;
  /** File path relative to repository root. */
  path: string;
  /** Original path if the entry is a rename. */
  origPath?: string;
}

/** Structured result from parsing `git status --porcelain`. */
export interface GitStatusResult {
  staged: StatusEntry[];
  unstaged: StatusEntry[];
  untracked: StatusEntry[];
  conflicted: StatusEntry[];
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const DANTE_FOOTER =
  "\u{1F916} Generated with DanteCode (https://dantecode.dev)\n\nCo-Authored-By: DanteCode <noreply@dantecode.dev>";

const MAX_SUBJECT_LENGTH = 72;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Execute a git command synchronously in the given working directory.
 * Throws with a descriptive message on failure.
 */
function git(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    const msg = stderr || err.message || "Unknown git error";
    throw new Error(`git ${args.split(" ")[0]}: ${msg}`);
  }
}

function getCurrentBranch(projectRoot: string): string {
  const branch = git("rev-parse --abbrev-ref HEAD", projectRoot);
  if (!branch || branch === "HEAD") {
    throw new Error("git push: cannot infer branch from detached HEAD; pass an explicit branch");
  }
  return branch;
}

function formatPushError(message: string, remote: string, branch: string): string {
  if (
    /Authentication failed|Permission denied|could not read Username|Repository not found|403|denied to/i.test(
      message,
    )
  ) {
    return (
      `git push: authentication failed for ${remote}/${branch}. ` +
      `Configure GitHub credentials (PAT or SSH) for this repository and retry. ` +
      `Original error: ${message}`
    );
  }

  if (/No configured push destination|No such remote/i.test(message)) {
    return `git push: remote "${remote}" is not configured. Original error: ${message}`;
  }

  return `git push: ${message}`;
}

/**
 * Truncate the subject line to the maximum length, breaking at a word
 * boundary when possible.
 */
function truncateSubject(line: string): string {
  if (line.length <= MAX_SUBJECT_LENGTH) {
    return line;
  }
  const truncated = line.slice(0, MAX_SUBJECT_LENGTH - 3);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > MAX_SUBJECT_LENGTH / 2) {
    return `${truncated.slice(0, lastSpace)}...`;
  }
  return `${truncated}...`;
}

/**
 * Build a complete commit message from a GitCommitSpec.
 *
 * Format:
 *   <subject (<=72 chars)>
 *   <blank line>
 *   <body — optional>
 *   <blank line>
 *   <footer>
 */
function buildCommitMessage(spec: GitCommitSpec): string {
  const subject = truncateSubject(spec.message);
  const parts: string[] = [subject];

  if (spec.body) {
    parts.push("", spec.body);
  }

  const footer = spec.footer || DANTE_FOOTER;
  parts.push("", footer);

  return parts.join("\n");
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Stage the specified files and create a commit.
 *
 * @param spec - Commit specification including message, files, etc.
 * @param projectRoot - Absolute path to the repository root.
 * @returns The hash, message, and list of committed files.
 */
export function autoCommit(spec: GitCommitSpec, projectRoot: string): CommitResult {
  // Stage the requested files
  if (spec.files.length > 0) {
    // Stage in batches to avoid command-line length limits
    const batchSize = 50;
    for (let i = 0; i < spec.files.length; i += batchSize) {
      const batch = spec.files.slice(i, i + batchSize);
      const escaped = batch.map((f) => `"${f}"`).join(" ");
      git(`add ${escaped}`, projectRoot);
    }
  }

  // Build the full commit message
  const fullMessage = buildCommitMessage(spec);

  // Create the commit using a stdin-fed message to avoid shell escaping issues
  const allowEmptyFlag = spec.allowEmpty ? "--allow-empty " : "";
  try {
    execSync(`git commit ${allowEmptyFlag}--file=-`, {
      cwd: projectRoot,
      encoding: "utf-8",
      input: fullMessage,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error: unknown) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    const stdout = typeof err.stdout === "string" ? err.stdout.trim() : "";
    // If nothing to commit and allowEmpty was not set, that's an error
    if (stderr.includes("nothing to commit") || stdout.includes("nothing to commit")) {
      throw new Error("git commit: nothing to commit (working tree clean)");
    }
    throw new Error(`git commit: ${stderr || err.message || "Unknown error"}`);
  }

  const commitHash = getLastCommitHash(projectRoot);

  return {
    commitHash,
    message: fullMessage,
    filesCommitted: [...spec.files],
  };
}

/**
 * Return the SHA hash of the current HEAD commit.
 */
export function getLastCommitHash(projectRoot: string): string {
  return git("rev-parse HEAD", projectRoot);
}

/**
 * Revert the most recent commit (creates a new revert commit).
 */
export function revertLastCommit(projectRoot: string): string {
  return git("revert HEAD --no-edit", projectRoot);
}

/**
 * Push the current branch (or an explicit branch) to a remote and verify that
 * the remote ref points at the same commit as local HEAD afterward.
 */
export function pushBranch(
  options: { remote?: string; branch?: string; setUpstream?: boolean } = {},
  projectRoot: string,
): PushResult {
  const remote = options.remote?.trim() || "origin";
  const branch = options.branch?.trim() || getCurrentBranch(projectRoot);
  const setUpstream = options.setUpstream === true;
  const localCommit = getLastCommitHash(projectRoot);
  const upstreamFlag = setUpstream ? "-u " : "";

  let output = "";
  try {
    output = git(`push ${upstreamFlag}${remote} ${branch}`, projectRoot);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(formatPushError(message, remote, branch));
  }

  const remoteRef = git(`ls-remote ${remote} refs/heads/${branch}`, projectRoot)
    .split("\n")
    .find(Boolean);

  if (!remoteRef) {
    throw new Error(
      `git push: remote ${remote}/${branch} was not found after push. The push could not be verified.`,
    );
  }

  const remoteCommit = remoteRef.split(/\s+/)[0]?.trim() ?? "";
  if (!remoteCommit) {
    throw new Error(
      `git push: remote ${remote}/${branch} returned an invalid ref after push verification.`,
    );
  }
  if (remoteCommit !== localCommit) {
    throw new Error(
      `git push: verification failed for ${remote}/${branch}. Remote is ${remoteCommit}, local HEAD is ${localCommit}.`,
    );
  }

  return {
    remote,
    branch,
    localCommit,
    remoteCommit,
    output,
    setUpstream,
  };
}

/**
 * Parse `git status --porcelain` into structured data.
 */
export function getStatus(projectRoot: string): GitStatusResult {
  let raw: string;
  try {
    raw = git("status --porcelain", projectRoot);
  } catch {
    // If the command fails (e.g. not a git repo), return empty
    return { staged: [], unstaged: [], untracked: [], conflicted: [] };
  }

  const result: GitStatusResult = {
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  };

  if (!raw) {
    return result;
  }

  const lines = raw.split("\n");

  for (const line of lines) {
    if (line.length < 3) {
      continue;
    }

    const indexStatus = line[0]!;
    const workTreeStatus = line[1]!;
    let filePath = line.slice(3);
    let origPath: string | undefined;

    // Handle renames: "R  old -> new"
    const arrowIndex = filePath.indexOf(" -> ");
    if (arrowIndex !== -1) {
      origPath = filePath.slice(0, arrowIndex);
      filePath = filePath.slice(arrowIndex + 4);
    }

    const entry: StatusEntry = {
      index: indexStatus,
      workTree: workTreeStatus,
      path: filePath,
      ...(origPath !== undefined ? { origPath } : {}),
    };

    // Conflict markers: UU, AA, DD, AU, UA, DU, UD
    const conflictCodes = new Set(["UU", "AA", "DD", "AU", "UA", "DU", "UD"]);
    const combined = `${indexStatus}${workTreeStatus}`;

    if (conflictCodes.has(combined)) {
      result.conflicted.push(entry);
      continue;
    }

    // Untracked
    if (indexStatus === "?" && workTreeStatus === "?") {
      result.untracked.push(entry);
      continue;
    }

    // Staged changes (index has a non-space, non-? character)
    if (indexStatus !== " " && indexStatus !== "?") {
      result.staged.push(entry);
    }

    // Unstaged changes (work tree has a non-space, non-? character)
    if (workTreeStatus !== " " && workTreeStatus !== "?") {
      result.unstaged.push(entry);
    }
  }

  return result;
}
