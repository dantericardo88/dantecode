/**
 * generate-readiness.mjs
 *
 * Reads gate results from environment variables set by CI jobs, then writes
 * artifacts/readiness/current-readiness.json with a machine-readable status.
 *
 * CI jobs set gates like:
 *   GATE_TYPECHECK=pass GATE_LINT=pass ... node scripts/release/generate-readiness.mjs
 *
 * Gate values: "pass" | "fail" | "unknown" (default when env var not set)
 *
 * Status rules:
 *   blocked                   → any gate is "fail"
 *   local-green-external-pending → local gates all pass, external gates unknown
 *   private-ready             → all gates except liveProvider and publishDryRun pass
 *   public-ready              → all gates pass
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outPath = resolve(repoRoot, "artifacts/readiness/current-readiness.json");

// ── Read gate status from environment ──────────────────────────────────────

function readGate(name) {
  const val = process.env[name];
  if (val === "pass") return "pass";
  if (val === "fail") return "fail";
  return "unknown";
}

const gates = {
  typecheck:    readGate("GATE_TYPECHECK"),
  lint:         readGate("GATE_LINT"),
  test:         readGate("GATE_TEST"),
  build:        readGate("GATE_BUILD"),
  windowsSmoke: readGate("GATE_WINDOWS_SMOKE"),
  antiStub:     readGate("GATE_ANTI_STUB"),
  liveProvider: readGate("GATE_LIVE_PROVIDER"),
  publishDryRun: readGate("GATE_PUBLISH_DRY_RUN"),
};

// ── Resolve commit SHA ──────────────────────────────────────────────────────

let commitSha = process.env["GITHUB_SHA"] ?? "unknown";
if (commitSha === "unknown") {
  try {
    commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    // Not in a git repo or git not available — leave as "unknown"
  }
}

// ── Compute status ─────────────────────────────────────────────────────────

const localGates = ["typecheck", "lint", "test", "build", "antiStub"];
const externalGates = ["windowsSmoke", "liveProvider", "publishDryRun"];
const blockers = [];

for (const [name, value] of Object.entries(gates)) {
  if (value === "fail") {
    blockers.push(`Gate "${name}" failed`);
  }
}

let status;
if (blockers.length > 0) {
  status = "blocked";
} else if (localGates.every((g) => gates[g] === "pass") &&
           externalGates.every((g) => gates[g] === "unknown")) {
  status = "local-green-external-pending";
} else if (
  localGates.every((g) => gates[g] === "pass") &&
  gates.windowsSmoke === "pass" &&
  gates.antiStub === "pass" &&
  gates.liveProvider !== "fail" &&
  gates.publishDryRun !== "fail"
) {
  if (gates.liveProvider === "pass" && gates.publishDryRun === "pass") {
    status = "public-ready";
  } else {
    status = "private-ready";
  }
} else {
  // Some gates unknown, none failed
  status = "blocked";
  blockers.push("CI gates have not been run. Execute: npm run release:generate with GATE_* env vars set");
}

// ── Write artifact ─────────────────────────────────────────────────────────

const artifact = {
  status,
  commitSha,
  generatedAt: new Date().toISOString(),
  gates,
  blockers,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");

// ── Write markdown companion ────────────────────────────────────────────────

const mdPath = resolve(repoRoot, "artifacts/readiness/current-readiness.md");
const gateRows = Object.entries(gates)
  .map(([name, val]) => `| ${name} | ${val} |`)
  .join("\n");
const blockerSection = blockers.length > 0
  ? `\n## Blockers\n\n${blockers.map((b) => `- ${b}`).join("\n")}\n`
  : "";
const mdContent =
  `# DanteCode Readiness\n\n` +
  `**Status:** ${status}  \n` +
  `**Commit:** \`${commitSha.slice(0, 12)}\`  \n` +
  `**Generated:** ${new Date().toISOString()}\n\n` +
  `## Gates\n\n` +
  `| Gate | Status |\n` +
  `|------|--------|\n` +
  gateRows + "\n" +
  blockerSection;
writeFileSync(mdPath, mdContent);

// ── Print summary ─────────────────────────────────────────────────────────

const STATUS_LABEL = {
  "blocked": "\x1b[31mBLOCKED\x1b[0m",
  "local-green-external-pending": "\x1b[33mLOCAL-GREEN / EXTERNAL-PENDING\x1b[0m",
  "private-ready": "\x1b[32mPRIVATE-READY\x1b[0m",
  "public-ready": "\x1b[32mPUBLIC-READY\x1b[0m",
};

console.log(`\nDanteCode Readiness — ${new Date().toISOString()}`);
console.log(`Commit: ${commitSha.slice(0, 12)}`);
console.log(`Status: ${STATUS_LABEL[status] ?? status}\n`);

const GATE_ICON = { pass: "\x1b[32m✓\x1b[0m", fail: "\x1b[31m✗\x1b[0m", unknown: "\x1b[2m?\x1b[0m" };
for (const [name, value] of Object.entries(gates)) {
  console.log(`  ${GATE_ICON[value] ?? "?"} ${name.padEnd(14)} ${value}`);
}

if (blockers.length > 0) {
  console.log("\nBlockers:");
  for (const b of blockers) console.log(`  • ${b}`);
}

console.log(`\nWritten: ${outPath}\n`);

if (status === "blocked") process.exitCode = 1;
