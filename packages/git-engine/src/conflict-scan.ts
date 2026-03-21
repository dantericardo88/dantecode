// ============================================================================
// @dantecode/git-engine — Conflict Scanner
// Scans git repositories for conflicted files, hunks, and symbols.
// Used by the Council Overlap Detector and Merge Brain.
// ============================================================================

import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A single conflicted hunk within a file. */
export interface ConflictHunk {
  /** Zero-based start line of the conflict block (<<<<<<< marker). */
  startLine: number;
  /** Zero-based end line of the conflict block (>>>>>>> marker). */
  endLine: number;
  /** Content of the "ours" side. */
  oursContent: string;
  /** Content of the "theirs" side. */
  theirsContent: string;
}

/** All conflict information for one file. */
export interface FileConflictInfo {
  filePath: string;
  hunks: ConflictHunk[];
  hasConflict: boolean;
}

/** Summary of all conflicts found in a repository. */
export interface ConflictScanResult {
  repoRoot: string;
  conflictedFiles: FileConflictInfo[];
  totalConflictCount: number;
  scannedAt: string;
}

/** Result of a symbol/function name diff between two branches. */
export interface SymbolDiffEntry {
  filePath: string;
  addedSymbols: string[];
  removedSymbols: string[];
  modifiedSymbols: string[];
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function git(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    const msg = (e.stderr ?? e.message ?? "git error").trim();
    throw new Error(msg);
  }
}

/**
 * Parse conflict hunks from file content.
 * A hunk starts with `<<<<<<< ` and ends with `>>>>>>> `.
 */
function parseConflictHunks(content: string): ConflictHunk[] {
  const lines = content.split("\n");
  const hunks: ConflictHunk[] = [];

  let inConflict = false;
  let startLine = 0;
  let oursLines: string[] = [];
  let theirsLines: string[] = [];
  let inOurs = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("<<<<<<<")) {
      inConflict = true;
      inOurs = true;
      startLine = i;
      oursLines = [];
      theirsLines = [];
    } else if (line.startsWith("=======") && inConflict) {
      inOurs = false;
    } else if (line.startsWith(">>>>>>>") && inConflict) {
      hunks.push({
        startLine,
        endLine: i,
        oursContent: oursLines.join("\n"),
        theirsContent: theirsLines.join("\n"),
      });
      inConflict = false;
      inOurs = false;
    } else if (inConflict) {
      if (inOurs) {
        oursLines.push(line);
      } else {
        theirsLines.push(line);
      }
    }
  }

  return hunks;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * List all files with unresolved merge conflicts in a git repository.
 * Uses `git diff --name-only --diff-filter=U` to find conflicted files.
 */
export function listConflictedFiles(repoRoot: string): string[] {
  try {
    const raw = git("diff --name-only --diff-filter=U", repoRoot);
    return raw ? raw.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Parse conflict markers in a single file and return structured conflict hunks.
 */
export async function scanFileConflicts(
  repoRoot: string,
  filePath: string,
): Promise<FileConflictInfo> {
  const absPath = join(repoRoot, filePath);
  try {
    const content = await readFile(absPath, "utf-8");
    const hunks = parseConflictHunks(content);
    return { filePath, hunks, hasConflict: hunks.length > 0 };
  } catch {
    return { filePath, hunks: [], hasConflict: false };
  }
}

/**
 * Scan all conflicted files in a repository.
 */
export async function scanAllConflicts(repoRoot: string): Promise<ConflictScanResult> {
  const conflictedPaths = listConflictedFiles(repoRoot);
  const conflictedFiles = await Promise.all(
    conflictedPaths.map((p) => scanFileConflicts(repoRoot, p)),
  );

  return {
    repoRoot,
    conflictedFiles,
    totalConflictCount: conflictedFiles.reduce((sum, f) => sum + f.hunks.length, 0),
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Compute a simple symbol diff between two branches by comparing
 * `function`, `class`, `interface`, `type`, `const`, and `export` declarations.
 *
 * @param repoRoot  - Repository root.
 * @param branchA   - Left branch (e.g., "main").
 * @param branchB   - Right branch (e.g., "feature/council").
 * @param filePaths - Subset of files to check (all changed files if omitted).
 */
export function diffSymbols(
  repoRoot: string,
  branchA: string,
  branchB: string,
  filePaths?: string[],
): SymbolDiffEntry[] {
  let files = filePaths;
  if (!files) {
    try {
      const raw = git(`diff --name-only ${branchA}...${branchB}`, repoRoot);
      files = raw ? raw.split("\n").filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  const SYMBOL_RE =
    /^\s*(?:export\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

  const results: SymbolDiffEntry[] = [];

  for (const filePath of files) {
    try {
      const diffRaw = git(`diff ${branchA}...${branchB} -- "${filePath}"`, repoRoot);
      const added: string[] = [];
      const removed: string[] = [];

      for (const line of diffRaw.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          const match = line.slice(1).match(SYMBOL_RE);
          if (match?.[1]) added.push(match[1]);
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          const match = line.slice(1).match(SYMBOL_RE);
          if (match?.[1]) removed.push(match[1]);
        }
      }

      // Symbols in both added and removed = modified
      const addedSet = new Set(added);
      const removedSet = new Set(removed);
      const modified = [...addedSet].filter((s) => removedSet.has(s));
      const pureAdded = added.filter((s) => !removedSet.has(s));
      const pureRemoved = removed.filter((s) => !addedSet.has(s));

      if (pureAdded.length > 0 || pureRemoved.length > 0 || modified.length > 0) {
        results.push({
          filePath,
          addedSymbols: pureAdded,
          removedSymbols: pureRemoved,
          modifiedSymbols: modified,
        });
      }
    } catch {
      // Skip files that cannot be diffed
    }
  }

  return results;
}

/**
 * Check whether a merge between two branches would produce conflicts
 * without actually performing the merge (dry-run via `git merge-tree`).
 *
 * Returns an array of files that would conflict.
 */
export function predictConflicts(repoRoot: string, branchA: string, branchB: string): string[] {
  try {
    // Find merge base
    const base = git(`merge-base ${branchA} ${branchB}`, repoRoot);
    const raw = git(`merge-tree ${base} ${branchA} ${branchB}`, repoRoot);

    // merge-tree outputs conflict markers if there are conflicts
    const conflictFiles: string[] = [];
    const lines = raw.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // merge-tree conflict header format: "changed in both"
      if (line.includes("changed in both")) {
        // Next non-empty line after base/our/their is typically the filename
        for (let k = i + 1; k < Math.min(i + 10, lines.length); k++) {
          const candidate = lines[k]!.trim();
          if (candidate && !candidate.startsWith("@") && !candidate.match(/^\d/)) {
            conflictFiles.push(candidate);
            break;
          }
        }
      }
    }

    return [...new Set(conflictFiles)];
  } catch {
    return [];
  }
}
