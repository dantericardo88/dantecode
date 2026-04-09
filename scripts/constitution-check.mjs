#!/usr/bin/env node

// ============================================================================
// DanteCode Constitution Checker
// Repo-local constitutional checks for production-oriented source files.
// ============================================================================

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { glob } from "glob";
import { join, relative, resolve } from "path";

const ROOT_DIR = resolve(process.cwd());
const RAW_ARGS = process.argv.slice(2);
const INCLUDE_TESTS = RAW_ARGS.includes("--include-tests");
const STAGED_ONLY = RAW_ARGS.includes("--staged");
const ALL_FILES = RAW_ARGS.includes("--all");
const EXPLICIT_FILES = RAW_ARGS.filter((arg) => !arg.startsWith("--"));

const DEFAULT_PATTERNS = [
  "packages/*/src/**/*.{ts,tsx,js,jsx}",
  "scripts/**/*.{js,mjs,ts,tsx}",
  "!packages/*/dist/**",
  "!packages/*/build/**",
  "!packages/*/node_modules/**",
  "!**/coverage/**",
  "!**/.turbo/**",
  "!**/.danteforge/oss-repos/**",
];

function loadConstitution() {
  const constitutionPath = join(ROOT_DIR, ".dantecode", "constitution.json");
  if (!existsSync(constitutionPath)) {
    return null;
  }
  return JSON.parse(readFileSync(constitutionPath, "utf8"));
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
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getChangedFiles() {
  try {
    const output = execSync("git diff --name-only --diff-filter=ACMR HEAD", {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isTestLike(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    normalized.includes("/__tests__/") ||
    normalized.includes("/fixtures/") ||
    normalized.includes("/__fixtures__/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".test.js") ||
    normalized.endsWith(".test.jsx") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.tsx") ||
    normalized.endsWith(".spec.js") ||
    normalized.endsWith(".spec.jsx")
  );
}

function isCandidateFile(filePath) {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/");
  if (!INCLUDE_TESTS && isTestLike(normalized)) {
    return false;
  }
  if (
    normalized.includes("/dist/") ||
    normalized.includes("/build/") ||
    normalized.includes("/node_modules/") ||
    normalized.includes("/coverage/") ||
    normalized.includes("/.turbo/") ||
    normalized.includes("/.danteforge/oss-repos/")
  ) {
    return false;
  }
  return /\.(ts|tsx|js|jsx|mjs)$/.test(normalized);
}

async function discoverFiles() {
  let files;
  if (EXPLICIT_FILES.length > 0) {
    files = EXPLICIT_FILES.map((file) => relative(ROOT_DIR, resolve(ROOT_DIR, file)));
  } else if (STAGED_ONLY) {
    files = getStagedFiles();
  } else if (!ALL_FILES) {
    const stagedFiles = getStagedFiles();
    if (stagedFiles.length > 0) {
      files = stagedFiles;
    } else {
      const changedFiles = getChangedFiles();
      files = changedFiles.length > 0 ? changedFiles : await glob(DEFAULT_PATTERNS, { cwd: ROOT_DIR, nodir: true });
    }
  } else {
    files = await glob(DEFAULT_PATTERNS, { cwd: ROOT_DIR, nodir: true });
  }

  return [...new Set(files.filter(isCandidateFile))].sort();
}

function checkRule(content, rule, isTestFile) {
  const lowerRule = rule.toLowerCase();

  if (lowerRule.includes("no todo markers")) {
    return !/\bTODO\b/i.test(content);
  }
  if (lowerRule.includes("no fixme markers")) {
    return !/\bFIXME\b/i.test(content);
  }
  if (lowerRule.includes("not implemented")) {
    return !/throw\s+new\s+Error\s*\(\s*["'`]not implemented["'`]\s*\)/i.test(content);
  }
  if (lowerRule.includes("all functions implemented")) {
    return !/\bplaceholder\b/i.test(content) && !/\bnotImplemented\b/.test(content);
  }
  if (lowerRule.includes("no console.log")) {
    return !/\bconsole\.log\s*\(/.test(content);
  }
  if (lowerRule.includes("typescript strict")) {
    return !/:\s*any\b/.test(content);
  }
  if (lowerRule.includes("all tests have assertions")) {
    if (!isTestFile) return true;
    return /\b(expect|assert)\s*\(/.test(content);
  }
  if (lowerRule.includes("no skipped tests")) {
    if (!isTestFile) return true;
    return !/\b(it|test|describe)\.skip\s*\(/.test(content);
  }

  return true;
}

function evaluateFile(content, filePath, constitution) {
  const violations = [];
  const isTestFile = isTestLike(filePath);

  for (const rule of constitution?.critical ?? []) {
    if (!checkRule(content, rule, isTestFile)) {
      violations.push({
        severity: "critical",
        message: `Violates critical rule: ${rule}`,
      });
    }
  }

  for (const rule of constitution?.warning ?? []) {
    if (!checkRule(content, rule, isTestFile)) {
      violations.push({
        severity: "warning",
        message: `Violates warning rule: ${rule}`,
      });
    }
  }

  return violations;
}

async function main() {
  console.log("Constitution Check");
  const constitution = loadConstitution();
  if (!constitution) {
    console.log("No constitution file found at .dantecode/constitution.json");
    process.exit(0);
  }

  const files = await discoverFiles();
  console.log(`Checking ${files.length} file(s)${STAGED_ONLY ? " from staged changes" : ""}...`);

  let criticalCount = 0;
  let warningCount = 0;
  let filesWithViolations = 0;

  for (const file of files) {
    const fullPath = resolve(ROOT_DIR, file);
    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, "utf8");
    const violations = evaluateFile(content, file, constitution);
    if (violations.length === 0) {
      continue;
    }

    filesWithViolations += 1;
    console.log(`\n${file}`);
    for (const violation of violations) {
      if (violation.severity === "critical") {
        criticalCount += 1;
      } else {
        warningCount += 1;
      }
      console.log(`  [${violation.severity}] ${violation.message}`);
    }
  }

  console.log("\nSummary");
  console.log(`  Files checked: ${files.length}`);
  console.log(`  Files with violations: ${filesWithViolations}`);
  console.log(`  Critical violations: ${criticalCount}`);
  console.log(`  Warning violations: ${warningCount}`);

  if (criticalCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Constitution check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
