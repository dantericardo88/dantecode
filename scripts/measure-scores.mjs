/**
 * Automated Score Measurement (SCORING.md dimensions)
 *
 * Measures the subset of scoring dimensions that can be objectively computed.
 * Run via: npm run measure:scores
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNpm } from "./npm-runner.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

let passed = 0;
let failed = 0;

function measure(id, name, fn) {
  try {
    const result = fn();
    console.log(`  PASS  ${id} ${name}: ${result.evidence} → score ${result.score}`);
    passed++;
    return result;
  } catch (err) {
    console.log(`  FAIL  ${id} ${name}: ${err.message}`);
    failed++;
    return null;
  }
}

console.log("DanteCode Score Measurement Report");
console.log("===================================\n");
console.log(`Generated: ${new Date().toISOString()}\n`);

// A-1: Test count
measure("A-1", "Test Suite", () => {
  const result = spawnNpm(["test"], repoRoot);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const matches = output.matchAll(/(\d+) passed/g);
  let total = 0;
  for (const m of matches) {
    total += parseInt(m[1], 10);
  }
  if (total === 0) throw new Error("No test results found in output");
  const failMatch = output.match(/(\d+) failed/);
  const failures = failMatch ? parseInt(failMatch[1], 10) : 0;
  const score =
    failures === 0 && total > 5000
      ? 10
      : failures === 0 && total > 3000
        ? 9
        : failures === 0
          ? 8
          : 4;
  return { score, evidence: `${total} tests, ${failures} failures` };
});

// A-2: Typecheck
measure("A-2", "Type Safety", () => {
  const result = spawnNpm(["run", "typecheck"], repoRoot);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const taskMatch = output.match(/Tasks:\s+(\d+)\s+successful,\s+(\d+)\s+total/);
  if (result.status !== 0) throw new Error(`Typecheck failed (exit ${result.status})`);
  const evidence = taskMatch
    ? `${taskMatch[1]}/${taskMatch[2]} packages clean`
    : "typecheck passed";
  return { score: 10, evidence };
});

// C-3: Tier-1 command count
measure("C-3", "Help Discoverability", () => {
  const slashCommandsPath = join(repoRoot, "packages", "cli", "src", "slash-commands.ts");
  const content = readFileSync(slashCommandsPath, "utf8");
  const tier1Count = (content.match(/tier:\s*1/g) ?? []).length;
  const tier2Count = (content.match(/tier:\s*2/g) ?? []).length;
  const total = tier1Count + tier2Count;
  const score = tier1Count >= 8 && tier1Count <= 15 ? 10 : tier1Count <= 25 ? 8 : 6;
  return { score, evidence: `${tier1Count} tier-1 commands shown by default (${total} total)` };
});

// C-6: Command surface ratio
measure("C-6", "Command Surface Ratio", () => {
  const slashCommandsPath = join(repoRoot, "packages", "cli", "src", "slash-commands.ts");
  const content = readFileSync(slashCommandsPath, "utf8");
  const tier1Count = (content.match(/tier:\s*1/g) ?? []).length;
  const tier2Count = (content.match(/tier:\s*2/g) ?? []).length;
  const total = tier1Count + tier2Count;
  const ratio = total > 0 ? tier1Count / total : 1;
  const score = ratio < 0.15 ? 10 : ratio < 0.25 ? 9 : ratio < 0.35 ? 8 : 6;
  return { score, evidence: `${tier1Count}/${total} = ${ratio.toFixed(3)} ratio` };
});

// D-1: Install success (smoke-install)
measure("D-1", "Install Success Rate", () => {
  const result = spawnNpm(["run", "smoke:install"], repoRoot);
  if (result.status !== 0) throw new Error("smoke:install failed");
  return { score: 10, evidence: "smoke-install passed" };
});

// D-4: CI integration
measure("D-4", "CI Integration", () => {
  const workflowDir = join(repoRoot, ".github", "workflows");
  let files;
  try {
    files = readdirSync(workflowDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  } catch {
    return { score: 0, evidence: "No .github/workflows/ directory found" };
  }
  const score = files.length >= 3 ? 10 : files.length === 2 ? 8 : files.length === 1 ? 6 : 0;
  return { score, evidence: `${files.length} workflow files: ${files.join(", ")}` };
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} measurements`);
if (failed > 0) {
  process.exitCode = 1;
}
