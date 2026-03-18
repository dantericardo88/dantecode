#!/usr/bin/env node
// ============================================================================
// Orchestrated publish: npm for all packages, vsce for VS Code extension.
// Usage: node scripts/publish-all.mjs [--dry-run] [--npm-only] [--vsce-only]
// ============================================================================

import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const npmOnly = args.includes("--npm-only");
const vsceOnly = args.includes("--vsce-only");

// Packages in dependency order (config-types first, cli last)
const npmPackages = [
  "packages/config-types",
  "packages/core",
  "packages/git-engine",
  "packages/sandbox",
  "packages/danteforge",
  "packages/skill-adapter",
  "packages/mcp",
  "packages/cli",
];

function run(cmd, cwd) {
  console.log(`  $ ${cmd}`);
  if (!dryRun) {
    execSync(cmd, { cwd, stdio: "inherit" });
  }
}

function publishNpm() {
  console.log("\n=== Publishing npm packages ===\n");

  for (const pkgPath of npmPackages) {
    const pkgDir = join(repoRoot, pkgPath);
    console.log(`\n--- ${pkgPath} ---`);

    // Build first
    run("npm run build", pkgDir);

    // Publish
    const publishCmd = dryRun
      ? "npm publish --dry-run --access public"
      : "npm publish --access public";
    run(publishCmd, pkgDir);
  }
}

function publishVSCE() {
  console.log("\n=== Publishing VS Code Extension ===\n");

  const vscodePath = join(repoRoot, "packages/vscode");

  // Build extension
  run("npm run build", vscodePath);

  // Package with vsce
  const vsceCmd = dryRun ? "npx vsce package" : "npx vsce publish";
  run(vsceCmd, vscodePath);
}

// Pre-flight checks
function preflight() {
  console.log("=== Pre-flight checks ===\n");

  // Verify clean git state
  try {
    const status = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf-8" });
    if (status.trim().length > 0 && !dryRun) {
      console.error("ERROR: Working directory is not clean. Commit or stash changes first.");
      process.exit(1);
    }
  } catch {
    console.warn("WARNING: Could not check git status.");
  }

  // Run full verification
  console.log("Running verification suite...");
  run("npm run typecheck", repoRoot);
  run("npm run lint", repoRoot);
  run("npm test", repoRoot);

  console.log("\nPre-flight checks passed.\n");
}

// Main
async function main() {
  console.log(`\nDanteCode Publish Pipeline${dryRun ? " (DRY RUN)" : ""}\n`);

  preflight();

  if (!vsceOnly) publishNpm();
  if (!npmOnly) publishVSCE();

  console.log(`\n=== Publish ${dryRun ? "dry run " : ""}complete ===\n`);
}

main().catch((error) => {
  console.error("Publish failed:", error.message);
  process.exit(1);
});
