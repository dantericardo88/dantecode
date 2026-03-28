// ============================================================================
// DanteCode Release Gate - comprehensive pre-release validation
// Exit 1 if any check fails.
// ============================================================================

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNpm } from "./npm-runner.mjs";
import { getCatalogPackagesForPurpose } from "./release/catalog.mjs";
import {
  buildReadinessArtifact,
  mapReleaseCheckResultsToGates,
  mergeGateSources,
  readExternalGateEvidence,
  readPersistedGateEvidence,
  readQuickstartProofEvidence,
  readReleaseDoctorEvidence,
  resolveCommitSha,
  writeLocalGateEvidence,
  writeReadinessArtifact,
} from "./release/readiness-lib.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const versionAlignmentPackages = getCatalogPackagesForPurpose(repoRoot, "versionAlignment");
const dependencyCyclePackages = getCatalogPackagesForPurpose(repoRoot, "dependencyCycles");
const exportCheckPackages = getCatalogPackagesForPurpose(repoRoot, "exportShape");
const docsAndLicensePackages = getCatalogPackagesForPurpose(repoRoot, "docsAndLicense");

const results = [];
let anyFailed = false;
let artifactStatus = null;

function check(num, name, fn) {
  try {
    const result = fn();
    const passed = result.passed;
    if (!passed) anyFailed = true;
    results.push({ num, name, passed, detail: result.detail });
  } catch (err) {
    anyFailed = true;
    results.push({ num, name, passed: false, detail: err.message });
  }
}

function runCmd(cmd, args, cwd = repoRoot) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", env: process.env, timeout: 300_000 });
}

check(1, "Build (turbo)", () => {
  const r = spawnNpm(["run", "build"], repoRoot);
  const ok = r.status === 0;
  return { passed: ok, detail: ok ? "turbo build passed" : `exit ${r.status}` };
});

check(2, "Tests (turbo)", () => {
  const r = spawnNpm(["test"], repoRoot);
  const ok = r.status === 0;
  return { passed: ok, detail: ok ? "all tests passed" : `exit ${r.status}` };
});

check(3, "Typecheck (turbo)", () => {
  const r = spawnNpm(["run", "typecheck"], repoRoot);
  const ok = r.status === 0;
  return { passed: ok, detail: ok ? "typecheck passed" : `exit ${r.status}` };
});

check(4, "Anti-stub scan", () => {
  const scanScript = join(scriptsDir, "anti-stub-scan.mjs");
  const r = runCmd(process.execPath, [scanScript]);
  const ok = r.status === 0;
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  const match = output.match(/(\d+)\s+violation/);
  const detail = ok ? "no stubs found" : match ? `${match[1]} violation(s)` : `exit ${r.status}`;
  return { passed: ok, detail };
});

check(5, "Version alignment", () => {
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
  const rootVersion = rootPkg.version;
  const mismatched = [];

  for (const packageEntry of versionAlignmentPackages) {
    const pkgPath = join(repoRoot, packageEntry.workspace, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (!pkg.version) continue;
    if (pkg.version !== rootVersion) {
      mismatched.push(`${packageEntry.id}: ${pkg.version}`);
    }
  }

  return {
    passed: mismatched.length === 0,
    detail:
      mismatched.length === 0 ? `all at ${rootVersion}` : `mismatched: ${mismatched.join(", ")}`,
  };
});

check(6, "CLI smoke (--help)", () => {
  const cliEntry = join(repoRoot, "packages", "cli", "dist", "index.js");
  if (!existsSync(cliEntry)) return { passed: false, detail: "CLI not built" };
  const r = spawnSync(process.execPath, [cliEntry, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  return { passed: r.status === 0, detail: r.status === 0 ? "exits 0" : `exit ${r.status}` };
});

check(7, "CLI commands registered (10+)", () => {
  const cliEntry = join(repoRoot, "packages", "cli", "dist", "index.js");
  if (!existsSync(cliEntry)) return { passed: false, detail: "CLI not built" };
  const r = spawnSync(process.execPath, [cliEntry, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const commandLines = output
    .split("\n")
    .filter((line) => line.trim().startsWith("/") || /^\s{2,}\w[\w-]+\s/.test(line));
  const count = commandLines.length;
  return { passed: count >= 10, detail: `${count} command(s) detected` };
});

check(8, "No circular dependencies", () => {
  const pkgNames = new Map();

  for (const packageEntry of dependencyCyclePackages) {
    const pkgPath = join(repoRoot, packageEntry.workspace, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = Object.keys(pkg.dependencies ?? {}).filter((dep) => dep.startsWith("@dantecode/"));
    pkgNames.set(pkg.name, deps);
  }

  const cycles = [];
  for (const [name] of pkgNames) {
    const visited = new Set();
    const path = [];

    function dfs(current) {
      if (visited.has(current)) return;
      if (path.includes(current)) {
        cycles.push([...path.slice(path.indexOf(current)), current].join(" -> "));
        return;
      }

      path.push(current);
      for (const dep of pkgNames.get(current) ?? []) {
        dfs(dep);
      }
      path.pop();
      visited.add(current);
    }

    dfs(name);
  }

  return {
    passed: cycles.length === 0,
    detail: cycles.length === 0 ? "no cycles" : cycles.join("; "),
  };
});

check(9, "Export verification (index.ts)", () => {
  const missing = [];

  for (const packageEntry of exportCheckPackages) {
    const indexPath = join(repoRoot, packageEntry.workspace, "src", "index.ts");
    if (!existsSync(indexPath)) continue;
    const content = readFileSync(indexPath, "utf-8");
    const hasExport = /\bexport\b/.test(content);
    const isPureEntryPoint = !hasExport && /\bmain\s*\(/.test(content);
    if (!hasExport && !isPureEntryPoint) {
      missing.push(packageEntry.id);
    }
  }

  return {
    passed: missing.length === 0,
    detail: missing.length === 0 ? "all packages export" : `no exports: ${missing.join(", ")}`,
  };
});

check(10, "License + README present", () => {
  const missingLicense = [];
  const missingReadme = [];

  for (const packageEntry of docsAndLicensePackages) {
    const pkgPath = join(repoRoot, packageEntry.workspace, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (pkg.private) continue;
    if (!pkg.name) continue;

    const dir = join(repoRoot, packageEntry.workspace);
    const hasLicenseFile = existsSync(join(dir, "LICENSE")) || existsSync(join(dir, "LICENSE.md"));
    const hasLicenseField = typeof pkg.license === "string" && pkg.license.length > 0;
    if (!hasLicenseFile && !hasLicenseField) {
      missingLicense.push(packageEntry.id);
    }

    const hasReadmeFile = existsSync(join(dir, "README.md"));
    const hasDescription = typeof pkg.description === "string" && pkg.description.length > 0;
    if (!hasReadmeFile && !hasDescription) {
      missingReadme.push(packageEntry.id);
    }
  }

  const allPresent = missingLicense.length === 0 && missingReadme.length === 0;
  const details = [];
  if (missingLicense.length > 0) details.push(`missing LICENSE: ${missingLicense.join(", ")}`);
  if (missingReadme.length > 0) details.push(`missing README: ${missingReadme.join(", ")}`);

  return { passed: allPresent, detail: allPresent ? "all present" : details.join("; ") };
});

check(11, "Lint (turbo)", () => {
  const r = spawnNpm(["run", "lint"], repoRoot);
  const ok = r.status === 0;
  return { passed: ok, detail: ok ? "0 errors" : `exit ${r.status}` };
});

console.log("\nDanteCode Release Gate");
console.log("=".repeat(50));

for (const result of results) {
  const icon = result.passed ? "\u2713" : "\u2717";
  console.log(
    `  ${result.num.toString().padStart(2, " ")}. [${icon}] ${result.name} - ${result.detail}`,
  );
}

const passed = results.filter((result) => result.passed).length;
const failed = results.filter((result) => !result.passed).length;

console.log("\n" + "=".repeat(50));
console.log(`Passed: ${passed}  Failed: ${failed}`);

try {
  const commitSha = resolveCommitSha(repoRoot, process.env);
  const externalEvidence = readExternalGateEvidence(repoRoot, { currentCommitSha: commitSha });
  const persistedEvidence = readPersistedGateEvidence(repoRoot, { currentCommitSha: commitSha });
  const releaseDoctorEvidence = readReleaseDoctorEvidence(repoRoot, {
    currentCommitSha: commitSha,
  });
  const quickstartProofEvidence = readQuickstartProofEvidence(repoRoot, {
    currentCommitSha: commitSha,
  });
  const generatedAt = new Date().toISOString();
  const gates = mergeGateSources(
    mapReleaseCheckResultsToGates(results),
    externalEvidence.gates,
    persistedEvidence.gates,
  );
  const localReceipt = writeLocalGateEvidence(repoRoot, {
    source: "release-check",
    commitSha,
    generatedAt,
    gates,
  });
  const artifact = buildReadinessArtifact({
    commitSha,
    gates,
    releaseDoctorReceipt: releaseDoctorEvidence.receipt,
    quickstartProofReceipt: quickstartProofEvidence.receipt,
    generatedAt,
    unknownMessage:
      "Some gates are still unknown for the current commit. Run the remaining external checks or CI jobs to resolve them.",
  });
  const outputPaths = writeReadinessArtifact(repoRoot, artifact);
  artifactStatus = artifact.status;

  console.log(`\nReadiness receipt updated: ${localReceipt.filePath}`);
  console.log(`Readiness artifact updated: ${outputPaths.jsonPath}`);
  console.log(`  Status: ${artifact.status}`);
  console.log(`  Commit: ${commitSha.slice(0, 12)}`);
} catch (err) {
  console.log(`\nNote: Could not update readiness artifact - ${err.message}`);
}

if (anyFailed) {
  console.log("\nRelease gate FAILED. Fix the above issues before release.");
} else if (artifactStatus === "public-ready") {
  console.log("\nRelease gate PASSED. Same-commit public release proof is green.");
} else if (artifactStatus === "private-ready") {
  console.log(
    "\nRelease gate PASSED locally. Private-ready proof is satisfied, but public release proof is still pending.",
  );
} else {
  console.log(
    "\nRelease gate PASSED locally. External same-commit proof is still pending before a public-ready claim.",
  );
}

if (anyFailed) process.exit(1);
