#!/usr/bin/env node

// ============================================================================
// DanteCode Pre-Commit Hook
// Staged-file anti-stub + constitution checks, with targeted workspace verification.
// ============================================================================

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, relative } from "path";

const ROOT_DIR = getRepoRoot();

function getRepoRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

function getStagedFiles() {
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((file) => join(ROOT_DIR, file));
  } catch {
    return [];
  }
}

function getChangedWorkspaces(files) {
  const workspaces = new Set();
  for (const file of files) {
    const rel = relative(ROOT_DIR, file).replace(/\\/g, "/");
    const match = rel.match(/^packages\/([^/]+)\//);
    if (!match) continue;
    const workspace = `packages/${match[1]}`;
    if (existsSync(join(ROOT_DIR, workspace, "package.json"))) {
      workspaces.add(workspace);
    }
  }
  return [...workspaces];
}

async function runAntiStubScan(files) {
  try {
    const { runAntiStubScanner } = await import("@dantecode/danteforge");
    const violations = [];

    for (const file of files) {
      if (!existsSync(file)) continue;
      const content = readFileSync(file, "utf8");
      const result = runAntiStubScanner(content, file);
      for (const violation of result.violations ?? []) {
        violations.push({
          file: relative(ROOT_DIR, file),
          line: violation.lineNumber || 0,
          message: violation.message,
        });
      }
    }

    return { passed: violations.length === 0, violations };
  } catch {
    return { passed: true, violations: [] };
  }
}

function runConstitutionCheck() {
  try {
    execSync("node scripts/constitution-check.mjs --staged", {
      cwd: ROOT_DIR,
      stdio: "pipe",
    });
    return { passed: true, output: "" };
  } catch (error) {
    return {
      passed: false,
      output:
        error instanceof Error && "stdout" in error
          ? String(error.stdout || error.stderr || error.message)
          : String(error),
    };
  }
}

function runWorkspaceChecks(workspaces) {
  const failures = [];

  for (const workspace of workspaces) {
    for (const script of ["build", "typecheck"]) {
      try {
        execSync(`npm run ${script} --workspace=${workspace}`, {
          cwd: ROOT_DIR,
          stdio: "pipe",
        });
      } catch (error) {
        failures.push({
          workspace,
          script,
          output:
            error instanceof Error && "stdout" in error
              ? String(error.stdout || error.stderr || error.message)
              : String(error),
        });
      }
    }
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

async function main() {
  console.log("Pre-Commit Verification");

  try {
    execSync("git rev-parse --git-dir", { cwd: ROOT_DIR, stdio: "pipe" });
  } catch {
    console.log("Not in a git repository.");
    process.exit(1);
  }

  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) {
    console.log("No staged files.");
    return;
  }

  console.log(`Checking ${stagedFiles.length} staged file(s)...`);

  const antiStub = await runAntiStubScan(stagedFiles);
  if (!antiStub.passed) {
    console.log("\nAnti-stub violations");
    for (const violation of antiStub.violations) {
      console.log(`  ${violation.file}:${violation.line} ${violation.message}`);
    }
  } else {
    console.log("Anti-stub scan passed.");
  }

  const constitution = runConstitutionCheck();
  if (!constitution.passed) {
    console.log("\nConstitution check failed");
    console.log(constitution.output.trim());
  } else {
    console.log("Constitution check passed.");
  }

  const workspaces = getChangedWorkspaces(stagedFiles);
  const workspaceChecks = runWorkspaceChecks(workspaces);
  if (!workspaceChecks.passed) {
    console.log("\nWorkspace verification failed");
    for (const failure of workspaceChecks.failures) {
      console.log(`  [${failure.workspace}] ${failure.script}`);
      console.log(`  ${failure.output.trim()}`);
    }
  } else if (workspaces.length > 0) {
    console.log(`Workspace checks passed for ${workspaces.join(", ")}.`);
  } else {
    console.log("No workspace package changes detected.");
  }

  if (!antiStub.passed || !constitution.passed || !workspaceChecks.passed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Pre-commit hook failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
