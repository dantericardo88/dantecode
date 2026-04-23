// packages/core/src/git-context-provider.ts
// Git-native context provider — closes dim 8 (Git-native editing: 8→9) gap.
//
// Harvested from: Aider (git blame context), Continue.dev (recent changes injection).
//
// Provides three context signals from git:
//   1. git blame — who last changed each line, used to surface author context
//   2. Recent file changes — which files were edited in last N commits
//   3. Diff against HEAD — current working-tree changes as context
//
// Pattern: Aider's RepoMap × git history; Continue.dev @git context provider.

import { execFileSync } from "node:child_process";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BlameEntry {
  /** Commit SHA (short) */
  commit: string;
  /** Author name */
  author: string;
  /** ISO date string */
  date: string;
  /** 1-indexed line number */
  line: number;
  /** Line content */
  content: string;
}

export interface RecentChange {
  /** Commit SHA (short) */
  commit: string;
  /** Commit message (first line) */
  message: string;
  /** Author name */
  author: string;
  /** ISO date string */
  date: string;
  /** Files touched in this commit */
  files: string[];
}

export interface WorkingTreeDiff {
  /** Relative file path */
  file: string;
  /** Unified diff text */
  diff: string;
  /** Lines added */
  additions: number;
  /** Lines removed */
  deletions: number;
}

export interface GitContextSnapshot {
  /** Root of the git repository */
  repoRoot: string;
  /** Blame for a specific file (if requested) */
  blame?: BlameEntry[];
  /** Recent commits with file lists */
  recentChanges: RecentChange[];
  /** Current working-tree diffs */
  workingTreeDiffs: WorkingTreeDiff[];
  /** Current branch name */
  currentBranch: string;
  /** Generation timestamp */
  generatedAt: string;
}

// ─── Git runner ───────────────────────────────────────────────────────────────

export type ExecFileFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; encoding: "utf-8"; timeout?: number },
) => string;

function defaultExecFile(
  cmd: string,
  args: string[],
  opts: { cwd: string; encoding: "utf-8"; timeout?: number },
): string {
  return execFileSync(cmd, args, opts) as unknown as string;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Parse `git blame --porcelain` output into BlameEntry[].
 */
export function parsePorcelainBlame(raw: string): BlameEntry[] {
  const entries: BlameEntry[] = [];
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    if (!header || header.length < 40) { i++; continue; }
    // Header line: "<sha> <orig-line> <result-line> [count]"
    const parts = header.split(" ");
    const commit = (parts[0] ?? "").slice(0, 8);
    const lineNum = parseInt(parts[2] ?? "0", 10);
    let author = "";
    let date = "";
    let content = "";
    i++;
    while (i < lines.length && !lines[i]?.match(/^[0-9a-f]{40}/)) {
      const l = lines[i]!;
      if (l.startsWith("author ")) author = l.slice(7);
      else if (l.startsWith("author-time ")) {
        const ts = parseInt(l.slice(12), 10);
        date = new Date(ts * 1000).toISOString().slice(0, 10);
      } else if (l.startsWith("\t")) content = l.slice(1);
      i++;
    }
    if (lineNum > 0) {
      entries.push({ commit, author, date, line: lineNum, content });
    }
  }
  return entries;
}

/**
 * Parse `git log --name-only` output into RecentChange[].
 */
export function parseGitLog(raw: string): RecentChange[] {
  const changes: RecentChange[] = [];
  const blocks = raw.split("\n\ncommit ").map((b, idx) => idx === 0 ? b : "commit " + b);
  for (const block of blocks) {
    const commitMatch = block.match(/^commit ([0-9a-f]{7,40})/);
    const authorMatch = block.match(/^Author:\s+(.+?)\s+</m);
    const dateMatch = block.match(/^Date:\s+(.+)/m);
    const msgMatch = block.match(/^\n    (.+)/m);
    if (!commitMatch) continue;
    const commit = commitMatch[1]!.slice(0, 8);
    const author = authorMatch?.[1] ?? "Unknown";
    const date = dateMatch?.[1]?.trim() ?? "";
    const message = msgMatch?.[1]?.trim() ?? "";
    // Files are listed after a blank line following the message
    const bodyLines = block.split("\n");
    const fileStart = bodyLines.findIndex((l) => l === "") + 1;
    const files = bodyLines
      .slice(fileStart > 0 ? fileStart : bodyLines.length)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("commit ") && !l.startsWith("Author:") && !l.startsWith("Date:") && !l.startsWith("    "));
    changes.push({ commit, author, date, message, files });
  }
  return changes;
}

/**
 * Parse `git diff --unified=3` output into WorkingTreeDiff[].
 */
export function parseWorkingTreeDiff(raw: string): WorkingTreeDiff[] {
  const diffs: WorkingTreeDiff[] = [];
  // Split by diff --git header
  const blocks = raw.split(/^diff --git /m).filter(Boolean);
  for (const block of blocks) {
    const fileMatch = block.match(/^a\/.+? b\/(.+?)$/m);
    if (!fileMatch) continue;
    const file = fileMatch[1]!.trim();
    let additions = 0;
    let deletions = 0;
    for (const line of block.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
    diffs.push({ file, diff: "diff --git " + block, additions, deletions });
  }
  return diffs;
}

// ─── Main Provider ────────────────────────────────────────────────────────────

export interface GitContextOptions {
  /** File to blame (relative to repoRoot). If omitted, blame is skipped. */
  blameFile?: string;
  /** Max lines to include in blame output (default: 50) */
  maxBlameLines?: number;
  /** Number of recent commits to include (default: 10) */
  recentCommitCount?: number;
  /** Max token budget for working-tree diffs (approx chars / 4) */
  maxDiffTokens?: number;
  /** Injected exec function for testing */
  execFileFn?: ExecFileFn;
}

/**
 * Capture git context for the given repository root.
 * Returns blame, recent changes, and working-tree diffs.
 * Never throws — returns partial data on any git error.
 */
export function captureGitContext(repoRoot: string, options: GitContextOptions = {}): GitContextSnapshot {
  const {
    blameFile,
    maxBlameLines = 50,
    recentCommitCount = 10,
    maxDiffTokens = 2000,
    execFileFn = defaultExecFile,
  } = options;

  const exec = (args: string[]): string => {
    try {
      return execFileFn("git", args, { cwd: repoRoot, encoding: "utf-8", timeout: 5000 });
    } catch {
      return "";
    }
  };

  // Current branch
  const currentBranch = exec(["rev-parse", "--abbrev-ref", "HEAD"]).trim() || "unknown";

  // Blame
  let blame: BlameEntry[] | undefined;
  if (blameFile) {
    const raw = exec(["blame", "--porcelain", join(repoRoot, blameFile)]);
    if (raw) {
      blame = parsePorcelainBlame(raw).slice(0, maxBlameLines);
    }
  }

  // Recent commits with files
  const logRaw = exec([
    "log",
    `--max-count=${recentCommitCount}`,
    "--name-only",
    "--date=short",
  ]);
  const recentChanges = logRaw ? parseGitLog(logRaw) : [];

  // Working-tree diff
  const diffRaw = exec(["diff", "--unified=3", "HEAD"]);
  const workingTreeDiffs = parseWorkingTreeDiff(diffRaw)
    .map((d) => {
      const maxChars = maxDiffTokens * 4;
      return d.diff.length > maxChars
        ? { ...d, diff: d.diff.slice(0, maxChars) + "\n… (diff truncated)" }
        : d;
    });

  return {
    repoRoot,
    blame,
    recentChanges,
    workingTreeDiffs,
    currentBranch,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export interface GitContextFormatOptions {
  /** Show blame section (default: true if blame is present) */
  showBlame?: boolean;
  /** Show recent changes section (default: true) */
  showRecentChanges?: boolean;
  /** Show working-tree diff section (default: true) */
  showWorkingTreeDiff?: boolean;
  /** Max working-tree diff files to show (default: 5) */
  maxDiffFiles?: number;
}

/**
 * Format a GitContextSnapshot for injection into an AI system prompt.
 */
export function formatGitContextForPrompt(
  snapshot: GitContextSnapshot,
  opts: GitContextFormatOptions = {},
): string {
  const {
    showBlame = !!snapshot.blame,
    showRecentChanges = true,
    showWorkingTreeDiff = true,
    maxDiffFiles = 5,
  } = opts;

  const lines: string[] = ["## Git Context", `Branch: \`${snapshot.currentBranch}\``, ""];

  if (showBlame && snapshot.blame && snapshot.blame.length > 0) {
    lines.push("**Recent blame (last editors):**");
    const byAuthor = new Map<string, number>();
    for (const entry of snapshot.blame) {
      byAuthor.set(entry.author, (byAuthor.get(entry.author) ?? 0) + 1);
    }
    for (const [author, count] of [...byAuthor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      lines.push(`  ${author}: ${count} line${count === 1 ? "" : "s"}`);
    }
    lines.push("");
  }

  if (showRecentChanges && snapshot.recentChanges.length > 0) {
    lines.push("**Recent commits:**");
    for (const change of snapshot.recentChanges.slice(0, 5)) {
      const fileCount = change.files.length;
      const fileStr = fileCount > 0 ? ` (${fileCount} file${fileCount === 1 ? "" : "s"})` : "";
      lines.push(`  ${change.commit} — ${change.message}${fileStr}`);
    }
    lines.push("");
  }

  if (showWorkingTreeDiff && snapshot.workingTreeDiffs.length > 0) {
    const filesToShow = snapshot.workingTreeDiffs.slice(0, maxDiffFiles);
    lines.push("**Uncommitted changes:**");
    for (const d of filesToShow) {
      lines.push(`  ${d.file}: +${d.additions}/-${d.deletions}`);
    }
    if (snapshot.workingTreeDiffs.length > maxDiffFiles) {
      lines.push(`  … and ${snapshot.workingTreeDiffs.length - maxDiffFiles} more files`);
    }
    lines.push("");
  } else if (showWorkingTreeDiff) {
    lines.push("**Uncommitted changes:** none");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get recently modified files from git history (unique list, most-recent first).
 */
export function getRecentlyModifiedFiles(snapshot: GitContextSnapshot, n = 10): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const change of snapshot.recentChanges) {
    for (const file of change.files) {
      if (!seen.has(file)) {
        seen.add(file);
        result.push(file);
        if (result.length >= n) return result;
      }
    }
  }
  return result;
}
