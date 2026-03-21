/**
 * verification-checks.ts — DTR Phase 1: Post-execution verification
 *
 * After git clone, Write, mkdir, or download via Bash:
 * 1. Detect what artifact the command was supposed to create
 * 2. Verify the artifact actually exists on disk
 * 3. Return VerificationResult so the scheduler can block or retry
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ArtifactKind,
  VerificationCheck,
  VerificationCheckOutcome,
  VerificationResult,
} from "./tool-call-types.js";

// ─── Pattern Detectors ────────────────────────────────────────────────────────

/**
 * Detect a `git clone <url> <dir>` pattern and return the target directory.
 * Handles: `git clone URL dir`, `git clone URL` (extracts last path segment as dir),
 * `git clone --depth 1 URL dir`, `git clone --branch X URL dir`
 */
export function detectGitCloneTarget(command: string): string | null {
  // Normalize whitespace
  const cmd = command.replace(/\s+/g, " ").trim();

  // Must start with git clone
  if (!/^git\s+clone\b/.test(cmd)) return null;

  // Strip flags: --, --depth N, --branch X, --single-branch, --no-tags, --shallow, --quiet, -q
  const stripped = cmd
    .replace(/git\s+clone\s+/, "")
    .replace(/--depth\s+\d+\s*/g, "")
    .replace(/--branch\s+\S+\s*/g, "")
    .replace(/--single-branch\s*/g, "")
    .replace(/--no-tags\s*/g, "")
    .replace(/--shallow-since\s+\S+\s*/g, "")
    .replace(/--quiet\s*/g, "")
    .replace(/-q\s*/g, "")
    .trim();

  const parts = stripped.split(/\s+/);

  if (parts.length === 0) return null;

  if (parts.length >= 2) {
    // Last part after the URL is the target dir
    return parts[parts.length - 1]!;
  }

  // Only URL provided — infer dir from last path segment (strip .git suffix)
  const url = parts[0]!;
  const lastSegment = url.split("/").pop() ?? "";
  return lastSegment.replace(/\.git$/, "") || null;
}

/**
 * Detect `mkdir -p <dir>` or `mkdir <dir>` patterns.
 * Returns the first directory argument.
 */
export function detectMkdirTarget(command: string): string | null {
  const match = command.match(/\bmkdir\s+(?:-[a-z]*\s+)*([^\s|;&]+)/);
  return match?.[1] ?? null;
}

/**
 * Detect `curl -o <file> URL` or `wget -O <file> URL` patterns.
 * Returns the output file path.
 */
export function detectDownloadTarget(command: string): string | null {
  // curl -o file url OR curl --output file url
  const curlO = command.match(/\bcurl\b[^\n]*(?:-o|--output)\s+([^\s]+)/);
  if (curlO) return curlO[1] ?? null;

  // wget -O file url
  const wgetO = command.match(/\bwget\b[^\n]*(?:-O|--output-document)\s+([^\s]+)/);
  if (wgetO) return wgetO[1] ?? null;

  return null;
}

// ─── Verification Functions ───────────────────────────────────────────────────

/** Run a list of verification checks and return aggregated VerificationResult */
export async function runVerificationChecks(
  checks: VerificationCheck[],
  projectRoot: string,
): Promise<VerificationResult> {
  const outcomes: VerificationCheckOutcome[] = await Promise.all(
    checks.map((check) => runSingleCheck(check, projectRoot)),
  );

  const failedChecks = outcomes.filter((o) => !o.passed);
  return {
    passed: failedChecks.length === 0,
    checks: outcomes,
    failedChecks,
  };
}

async function runSingleCheck(
  check: VerificationCheck,
  projectRoot: string,
): Promise<VerificationCheckOutcome> {
  const absPath = path.isAbsolute(check.path) ? check.path : path.join(projectRoot, check.path);

  try {
    switch (check.kind) {
      case "directory_exists": {
        const stat = fs.statSync(absPath);
        const exists = stat.isDirectory();
        return {
          check,
          passed: exists,
          actualValue: exists,
          errorMessage: exists ? undefined : `Directory not found: ${absPath}`,
        };
      }

      case "file_exists": {
        const stat = fs.statSync(absPath);
        const exists = stat.isFile();
        return {
          check,
          passed: exists,
          actualValue: exists,
          errorMessage: exists ? undefined : `File not found: ${absPath}`,
        };
      }

      case "file_size_nonzero": {
        const stat = fs.statSync(absPath);
        const size = stat.size;
        const minSize = check.minSizeBytes ?? 1;
        const passed = size >= minSize;
        return {
          check,
          passed,
          actualValue: size,
          errorMessage: passed ? undefined : `File size ${size} < minimum ${minSize}: ${absPath}`,
        };
      }

      case "git_repo_valid": {
        const gitDir = path.join(absPath, ".git");
        let passed = false;
        try {
          const stat = fs.statSync(gitDir);
          passed = stat.isDirectory() || stat.isFile(); // .git can be a file in worktrees
        } catch {
          passed = false;
        }
        return {
          check,
          passed,
          actualValue: passed,
          errorMessage: passed ? undefined : `Not a git repo: ${absPath} (missing .git)`,
        };
      }

      case "archive_extracted": {
        // Verify the directory exists and has at least one file
        let fileCount = 0;
        try {
          const entries = fs.readdirSync(absPath);
          fileCount = entries.length;
        } catch {
          fileCount = 0;
        }
        const passed = fileCount > 0;
        return {
          check,
          passed,
          actualValue: fileCount,
          errorMessage: passed
            ? undefined
            : `Archive extraction target empty or missing: ${absPath}`,
        };
      }

      default: {
        const _exhaustive: never = check.kind;
        return {
          check,
          passed: false,
          errorMessage: `Unknown check kind: ${String(_exhaustive)}`,
        };
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      check,
      passed: false,
      errorMessage: message,
    };
  }
}

// ─── High-Level Verification Builders ────────────────────────────────────────

/**
 * Build verification checks for a git clone command.
 * Returns checks for: directory_exists + git_repo_valid
 */
export function buildGitCloneChecks(targetDir: string): VerificationCheck[] {
  return [
    { kind: "directory_exists", path: targetDir },
    { kind: "git_repo_valid", path: targetDir },
  ];
}

/**
 * Build verification checks for a Write or file-creating Bash command.
 * Returns checks for: file_exists + file_size_nonzero
 */
export function buildFileWriteChecks(filePath: string): VerificationCheck[] {
  return [
    { kind: "file_exists", path: filePath },
    { kind: "file_size_nonzero", path: filePath },
  ];
}

/**
 * Build verification checks for a download (curl/wget).
 * Returns checks for: file_exists + file_size_nonzero (min 64 bytes — detect empty/error pages)
 */
export function buildDownloadChecks(filePath: string): VerificationCheck[] {
  return [
    { kind: "file_exists", path: filePath },
    { kind: "file_size_nonzero", path: filePath, minSizeBytes: 64 },
  ];
}

/**
 * Build verification checks for a mkdir command.
 * Returns checks for: directory_exists
 */
export function buildMkdirChecks(dirPath: string): VerificationCheck[] {
  return [{ kind: "directory_exists", path: dirPath }];
}

// ─── Auto-Detect + Build ──────────────────────────────────────────────────────

/**
 * Given a Bash command string, auto-detect what artifact it creates
 * and return the appropriate verification checks.
 * Returns [] if no verifiable artifact detected.
 */
export function inferVerificationChecks(
  bashCommand: string,
): Array<{ artifact: ArtifactKind; target: string; checks: VerificationCheck[] }> {
  const results: Array<{ artifact: ArtifactKind; target: string; checks: VerificationCheck[] }> =
    [];

  // Split multi-command strings (&&, ;) and check each part
  const parts = bashCommand.split(/\s*(?:&&|;)\s*/);

  for (const part of parts) {
    const cmd = part.trim();

    const cloneTarget = detectGitCloneTarget(cmd);
    if (cloneTarget) {
      results.push({
        artifact: "git_clone",
        target: cloneTarget,
        checks: buildGitCloneChecks(cloneTarget),
      });
      continue;
    }

    const downloadTarget = detectDownloadTarget(cmd);
    if (downloadTarget) {
      results.push({
        artifact: "download",
        target: downloadTarget,
        checks: buildDownloadChecks(downloadTarget),
      });
      continue;
    }

    const mkdirTarget = detectMkdirTarget(cmd);
    if (mkdirTarget) {
      results.push({
        artifact: "directory_create",
        target: mkdirTarget,
        checks: buildMkdirChecks(mkdirTarget),
      });
    }
  }

  return results;
}

/** Format a VerificationResult as a human-readable message for the model */
export function formatVerificationMessage(result: VerificationResult, command: string): string {
  if (result.passed) {
    const paths = result.checks.map((o) => o.check.path).join(", ");
    return `[DTR-VERIFY] ✓ All checks passed for: ${paths}`;
  }

  const failures = result.failedChecks
    .map((o) => `  • ${o.check.kind} → ${o.errorMessage ?? "failed"}`)
    .join("\n");

  return (
    `[DTR-VERIFY] VERIFICATION FAILED after: ${command.slice(0, 120)}\n` +
    `The following artifacts were NOT found or invalid:\n${failures}\n` +
    `Do NOT proceed to the next step. Re-run the command or use Read/Glob to diagnose what went wrong.`
  );
}
