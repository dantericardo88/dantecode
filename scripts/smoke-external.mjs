/**
 * External Project Smoke Test (D-08)
 *
 * Validates DanteCode init + GStack detection against inline project fixtures
 * (no git clones, no API keys needed). Mirrors smoke-cli.mjs patterns.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuildArtifacts, getCatalogPackageById } from "./release/catalog.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const cliEntry = join(repoRoot, "packages", "cli", "dist", "index.js");

let passed = 0;
let failed = 0;

function runNode(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, DANTECODE_NONINTERACTIVE: "1" },
    timeout: 15000,
  });

  if (result.status !== 0) {
    throw new Error(
      [`Command failed: node ${args.join(" ")}`, result.stdout?.trim(), result.stderr?.trim()]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function assertStateContains(dir, key, expected, label) {
  const statePath = join(dir, ".dantecode", "STATE.yaml");
  if (!existsSync(statePath)) {
    throw new Error(`${label}: STATE.yaml not found at ${statePath}`);
  }
  const content = readFileSync(statePath, "utf8");
  const match = content.match(new RegExp(`${key}:\\s*(.*)`));
  const value = match ? match[1].trim() : null;
  if (expected && value !== expected) {
    throw new Error(`${label}: expected ${key}="${expected}", got "${value}"`);
  }
  return value;
}

function test(name, fn) {
  const dir = mkdtempSync(join(tmpdir(), `dantecode-smoke-ext-${name}-`));
  try {
    fn(dir);
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Pre-flight ───────────────────────────────────────────────────────────────

ensureBuildArtifacts(repoRoot, [getCatalogPackageById(repoRoot, "cli")]);

console.log("External project smoke tests\n");

// ─── Fixture 1: Node/TypeScript project ───────────────────────────────────────

test("node-ts-project", (dir) => {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-ts", version: "1.0.0" }));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "index.ts"), 'export const hello = "world";\n');

  runNode([cliEntry, "init", "--force"], dir);

  assertStateContains(dir, "language", "typescript", "TS project");
});

// ─── Fixture 2: Python project ────────────────────────────────────────────────

test("python-project", (dir) => {
  writeFileSync(join(dir, "requirements.txt"), "flask>=2.0\nrequests\n");
  writeFileSync(join(dir, "app.py"), 'print("hello")\n');

  runNode([cliEntry, "init", "--force"], dir);

  assertStateContains(dir, "language", "python", "Python project");
});

// ─── Fixture 3: Rust project ─────────────────────────────────────────────────

test("rust-project", (dir) => {
  writeFileSync(
    join(dir, "Cargo.toml"),
    '[package]\nname = "test-rs"\nversion = "0.1.0"\nedition = "2021"\n',
  );
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "main.rs"), 'fn main() { println!("hello"); }\n');

  runNode([cliEntry, "init", "--force"], dir);

  assertStateContains(dir, "language", "rust", "Rust project");
});

// ─── Fixture 4: Go project ───────────────────────────────────────────────────

test("go-project", (dir) => {
  writeFileSync(join(dir, "go.mod"), "module example.com/test\n\ngo 1.21\n");
  writeFileSync(join(dir, "main.go"), "package main\n\nfunc main() {}\n");

  runNode([cliEntry, "init", "--force"], dir);

  assertStateContains(dir, "language", "go", "Go project");
});

// ─── Fixture 5: Plain JavaScript project ──────────────────────────────────────

test("js-project", (dir) => {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-js", version: "1.0.0" }));
  writeFileSync(join(dir, "index.js"), 'console.log("hello");\n');

  runNode([cliEntry, "init", "--force"], dir);

  assertStateContains(dir, "language", "javascript", "JS project");
});

// ─── Fixture 6: Empty directory (unknown language) ────────────────────────────

test("empty-project", (dir) => {
  runNode([cliEntry, "init", "--force"], dir);

  // Should still create STATE.yaml even with unknown language
  const lang = assertStateContains(dir, "language", null, "Empty project");
  if (!lang) {
    throw new Error("Empty project: language field not found in STATE.yaml");
  }
});

// ─── Fixture 7: Init is idempotent ───────────────────────────────────────────

test("idempotent-init", (dir) => {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-idem", version: "1.0.0" }));

  runNode([cliEntry, "init", "--force"], dir);
  runNode([cliEntry, "init", "--force"], dir);

  assertStateContains(dir, "language", "javascript", "Idempotent init");
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);

if (failed > 0) {
  process.exit(1);
}

console.log("External project smoke check passed.");
