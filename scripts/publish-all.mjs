#!/usr/bin/env node
// ============================================================================
// Orchestrated publish: npm for all catalog-backed packages, vsce for preview.
// Usage: node scripts/publish-all.mjs [--dry-run] [--npm-only] [--vsce-only]
// ============================================================================

import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNpm } from "./npm-runner.mjs";
import { ensureBuildArtifacts, getCatalogPackagesForPurpose } from "./release/catalog.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const npmOnly = args.includes("--npm-only");
const vsceOnly = args.includes("--vsce-only");

const npmPackages = getCatalogPackagesForPurpose(repoRoot, "npmPublish");

function runNpmLogged(args, cwd) {
  console.log(`  $ npm ${args.join(" ")}`);
  const result = spawnNpm(args, cwd);
  const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (combinedOutput.trim().length > 0) {
    process.stdout.write(combinedOutput);
    if (!combinedOutput.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed in ${cwd}`);
  }
}

function publishNpm() {
  console.log("\n=== Publishing npm packages ===\n");

  ensureBuildArtifacts(repoRoot, npmPackages);

  for (const packageEntry of npmPackages) {
    const pkgDir = join(repoRoot, packageEntry.workspace);
    console.log(`\n--- ${packageEntry.workspace} ---`);
    runNpmLogged(
      ["publish", ...(dryRun ? ["--dry-run"] : []), "--access", "public", "--provenance"],
      pkgDir,
    );
  }
}

function publishVSCE() {
  console.log("\n=== Publishing VS Code Extension ===\n");

  const vscodePath = join(repoRoot, "packages/vscode");

  runNpmLogged(["run", "build"], vscodePath);
  const vsceCmd = dryRun ? "npx --yes @vscode/vsce package" : "npx --yes @vscode/vsce publish";
  console.log(`  $ ${vsceCmd}`);
  if (!dryRun) {
    execSync(vsceCmd, { cwd: vscodePath, stdio: "inherit" });
  }
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
  runNpmLogged(["run", "typecheck"], repoRoot);
  runNpmLogged(["run", "lint"], repoRoot);
  runNpmLogged(["test"], repoRoot);

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
