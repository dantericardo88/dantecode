/**
 * assert-readiness.mjs
 *
 * Reads artifacts/readiness/current-readiness.json and exits non-zero
 * if the status is "blocked". Used as a CI gate step.
 *
 * Usage: node scripts/release/assert-readiness.mjs [--private | --public]
 *   --private  Require at least "private-ready" (default)
 *   --public   Require "public-ready"
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactPath = resolve(repoRoot, "artifacts/readiness/current-readiness.json");

const requirePublic = process.argv.includes("--public");

// ── Read artifact ──────────────────────────────────────────────────────────

if (!existsSync(artifactPath)) {
  console.error("Readiness artifact not found. Run: npm run release:generate");
  process.exitCode = 1;
  process.exit(1);
}

let artifact;
try {
  artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
} catch {
  console.error(`Failed to parse readiness artifact at: ${artifactPath}`);
  process.exitCode = 1;
  process.exit(1);
}

// ── Evaluate ───────────────────────────────────────────────────────────────

const { status, commitSha, generatedAt, gates, blockers } = artifact;

const ORDER = ["blocked", "local-green-external-pending", "private-ready", "public-ready"];
const currentLevel = ORDER.indexOf(status);
const requiredLevel = requirePublic ? ORDER.indexOf("public-ready") : ORDER.indexOf("private-ready");

const GATE_ICON = { pass: "✓", fail: "✗", unknown: "?" };
console.log(`\nDanteCode Readiness Check`);
console.log(`Commit:    ${String(commitSha).slice(0, 12)}`);
console.log(`Generated: ${generatedAt}`);
console.log(`Status:    ${status}\n`);

for (const [name, value] of Object.entries(gates ?? {})) {
  console.log(`  ${GATE_ICON[value] ?? "?"} ${name.padEnd(14)} ${value}`);
}

if (currentLevel < requiredLevel) {
  const required = ORDER[requiredLevel];
  console.error(`\n✗ Readiness check failed — required: ${required}, got: ${status}`);
  if (blockers?.length > 0) {
    console.error("Blockers:");
    for (const b of blockers) console.error(`  • ${b}`);
  }
  process.exitCode = 1;
} else {
  console.log(`\n✓ Readiness check passed (${status})`);
}
