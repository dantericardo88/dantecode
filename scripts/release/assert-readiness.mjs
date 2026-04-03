/**
 * assert-readiness.mjs
 *
 * Reads artifacts/readiness/current-readiness.json and exits non-zero
 * when the required readiness level has not been proven.
 *
 * Usage: node scripts/release/assert-readiness.mjs [--private | --public]
 *   --private  Require at least "private-ready" (default)
 *   --public   Require "public-ready"
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactPath = resolve(repoRoot, "artifacts/readiness/current-readiness.json");
const requirePublic = process.argv.includes("--public");

if (!existsSync(artifactPath)) {
  console.error("Readiness artifact not found. Run: npm run release:generate");
  process.exit(1);
}

let artifact;
try {
  artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
} catch {
  console.error(`Failed to parse readiness artifact at: ${artifactPath}`);
  process.exit(1);
}

const { status, commitSha, generatedAt, gates, blockers, openRequirements } = artifact;
const ORDER = ["blocked", "local-green-external-pending", "private-ready", "public-ready"];
const currentLevel = ORDER.indexOf(status);
const requiredStatus = requirePublic ? "public-ready" : "private-ready";
const requiredLevel = ORDER.indexOf(requiredStatus);

const gateIcon = { pass: "✓", fail: "✗", unknown: "?" };
console.log("\nDanteCode Readiness Check");
console.log(`Commit:    ${String(commitSha).slice(0, 12)}`);
console.log(`Generated: ${generatedAt}`);
console.log(`Status:    ${status}\n`);

for (const [name, value] of Object.entries(gates ?? {})) {
  console.log(`  ${gateIcon[value] ?? "?"} ${name.padEnd(14)} ${value}`);
}

if (currentLevel < requiredLevel) {
  console.error(`\n✗ Readiness check failed — required: ${requiredStatus}, got: ${status}`);

  if (Array.isArray(blockers) && blockers.length > 0) {
    console.error("Blockers:");
    for (const blocker of blockers) {
      console.error(`  • ${blocker}`);
    }
  }

  const targetRequirements = openRequirements?.[requirePublic ? "publicReady" : "privateReady"];
  if (Array.isArray(targetRequirements) && targetRequirements.length > 0) {
    console.error("Open requirements:");
    for (const requirement of targetRequirements) {
      console.error(`  • ${requirement}`);
    }
  }

  process.exitCode = 1;
} else {
  console.log(`\n✓ Readiness check passed (${status})`);
}
