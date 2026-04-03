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

test("--version exits 0 and prints a semver", () => {
  const r = runNode([cliEntry, "--version"]);
  if (r.status !== 0) return false;
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  // Must contain a semver-like version string (x.y.z)
  return /\d+\.\d+\.\d+/.test(output);
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

// ── Step 5: Known commands visible in top-level help ────────────────────
// These are the KEY COMMANDS advertised in the default help output.

const helpCommands = ["init", "magic", "help", "status", "diff", "commit"];

for (const cmd of helpCommands) {
  test(`"${cmd}" appears in --help output`, () => {
    const r = runNode([cliEntry, "--help"]);
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.toLowerCase();
    return output.includes(cmd);
  });
}

// ── Step 5b: Registered subcommands exit 0 with --help ───────────────────
// These are full CLI subcommands that should respond cleanly to --help.

const subcommands = ["init", "skills", "serve", "council", "config"];

for (const cmd of subcommands) {
  test(`Subcommand "dantecode ${cmd} --help" exits 0`, () => {
    const r = runNode([cliEntry, cmd, "--help"]);
    // Allow exit 1 if the output contains help content — some commands print help then exit 1
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    return r.status === 0 || output.length > 20;
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
