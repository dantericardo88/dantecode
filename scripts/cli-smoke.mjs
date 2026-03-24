// ============================================================================
// CLI Smoke Test — Validates CLI build output and slash command registration
// Builds CLI first, then verifies --help, --version, and command availability.
// ============================================================================

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNpm } from "./npm-runner.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const cliEntry = join(repoRoot, "packages", "cli", "dist", "index.js");

const results = [];
let anyFailed = false;

function runNode(args, cwd = repoRoot) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    timeout: 30_000,
  });
}

function test(name, fn) {
  try {
    const ok = fn();
    if (!ok) anyFailed = true;
    results.push({ name, passed: ok });
  } catch (err) {
    anyFailed = true;
    results.push({ name, passed: false, error: err.message });
  }
}

// ── Step 1: Build CLI ────────────────────────────────────────────────────

console.log("Building CLI...");
const buildResult = spawnNpm(["run", "build", "--workspace=packages/cli"], repoRoot);
if (buildResult.status !== 0) {
  console.error("CLI build failed. Cannot proceed with smoke tests.");
  console.error(buildResult.stderr || buildResult.stdout);
  process.exit(1);
}

if (!existsSync(cliEntry)) {
  console.error(`Built CLI entry not found at ${cliEntry}`);
  process.exit(1);
}

// ── Step 2: Version check ────────────────────────────────────────────────

test("--version matches root package.json", () => {
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
  const r = runNode([cliEntry, "--version"]);
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  // Version might be embedded in a longer string
  return output.includes(rootPkg.version);
});

// ── Step 3: --help exits 0 ──────────────────────────────────────────────

test("--help exits 0", () => {
  const r = runNode([cliEntry, "--help"]);
  return r.status === 0;
});

// ── Step 4: Help output contains description ───────────────────────────

test("--help shows product description", () => {
  const r = runNode([cliEntry, "--help"]);
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // Should mention DanteCode or building software
  return output.toLowerCase().includes("dantecode") || output.toLowerCase().includes("build");
});

// ── Step 5: Known commands appear in help ───────────────────────────────

const expectedCommands = ["init", "config", "skills", "council"];

for (const cmd of expectedCommands) {
  test(`Command "${cmd}" appears in help output`, () => {
    const r = runNode([cliEntry, "--help"]);
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.toLowerCase();
    return output.includes(cmd);
  });
}

// ── Step 6: init command works in temp dir ─────────────────────────────

test("init creates STATE.yaml", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "dantecode-smoke-"));
  try {
    const r = runNode([cliEntry, "init"], tmpDir);
    const stateExists = existsSync(join(tmpDir, ".dantecode", "STATE.yaml"));
    return r.status === 0 && stateExists;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Output ────────────────────────────────────────────────────────────────

console.log("\nCLI Smoke Test Results");
console.log("=".repeat(50));

for (const r of results) {
  const icon = r.passed ? "\u2713" : "\u2717";
  console.log(`  [${icon}] ${r.name}${r.error ? ` (${r.error})` : ""}`);
}

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;

console.log(`\nPassed: ${passed}  Failed: ${failed}`);

if (anyFailed) {
  console.error("\nCLI smoke test FAILED.");
  process.exit(1);
} else {
  console.log("\nCLI smoke test PASSED.");
}
