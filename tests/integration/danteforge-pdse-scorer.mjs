#!/usr/bin/env node
/**
 * DanteForge PDSE Scorer — integration test
 * Tests runAntiStubScanner, runConstitutionCheck, runLocalPDSEScorer, and scanFile
 * from the compiled @dantecode/danteforge binary package.
 * Run via: node tests/integration/danteforge-pdse-scorer.mjs
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const pkgPath = resolve(repoRoot, "packages/danteforge/dist/index.js");
const {
  runAntiStubScanner,
  runConstitutionCheck,
  runLocalPDSEScorer,
  scanFile,
} = await import(pathToFileURL(pkgPath).href);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

// ─── Group 1: runAntiStubScanner ─────────────────────────────────────────────
console.log("\n[1] runAntiStubScanner");

try {
  // 1a — Clean code passes
  console.log("\n[1.1] Clean code should pass anti-stub scan");
  const cleanCode = `
    export function add(a, b) {
      return a + b;
    }
    export function multiply(a, b) {
      return a * b;
    }
  `;
  const cleanResult = runAntiStubScanner(cleanCode, repoRoot);
  assert(cleanResult.passed === true, "Clean code passes anti-stub scan");
  assert(cleanResult.hardViolations.length === 0, "Clean code has 0 hard violations");
  assert(typeof cleanResult.scannedLines === "number", "scannedLines is a number");
  assert(cleanResult.scannedLines > 0, "scannedLines > 0 for non-empty code");

  // 1b — Code with "TODO: implement" triggers hard violation
  console.log("\n[1.2] Stub code should fail anti-stub scan");
  const stubCode = `
    export function processPayment(amount) {
      // TODO: implement
      throw new Error("Not implemented");
    }
  `;
  const stubResult = runAntiStubScanner(stubCode, repoRoot, "payment.ts");
  assert(stubResult.passed === false, "Stub code fails anti-stub scan");
  assert(stubResult.hardViolations.length > 0, "Stub code has at least 1 hard violation");
  assert(
    stubResult.hardViolations.some(
      (v) => typeof v.message === "string" && v.message.length > 0,
    ),
    "Hard violation has a non-empty message",
  );

  // 1c — filePath is propagated
  console.log("\n[1.3] filePath propagation");
  const fpResult = runAntiStubScanner("const x = 1;", repoRoot, "src/test.ts");
  assert(fpResult.filePath === "src/test.ts", "filePath is preserved in result");
} catch (err) {
  console.error(`  ERROR in Group 1: ${err.message}`);
  failed++;
}

// ─── Group 2: runConstitutionCheck ──────────────────────────────────────────
console.log("\n[2] runConstitutionCheck");

try {
  // 2a — Clean code passes constitution check
  console.log("\n[2.1] Clean code should pass constitution check");
  const safeCode = `
    import { readFile } from "node:fs/promises";
    export async function loadConfig(path) {
      const data = await readFile(path, "utf-8");
      return JSON.parse(data);
    }
  `;
  const safeResult = runConstitutionCheck(safeCode);
  assert(safeResult.passed === true, "Safe code passes constitution check");
  assert(safeResult.violations.length === 0, "Safe code has 0 violations");
  assert(typeof safeResult.scannedLines === "number", "scannedLines is a number");

  // 2b — Code with eval(userInput) fails constitution check
  console.log("\n[2.2] Dangerous code should fail constitution check");
  const dangerousCode = `
    function processRequest(userInput) {
      const result = eval(userInput);
      return result;
    }
  `;
  const dangerResult = runConstitutionCheck(dangerousCode, "handler.ts");
  assert(dangerResult.passed === false, "eval(userInput) code fails constitution check");
  assert(dangerResult.violations.length > 0, "Dangerous code has at least 1 violation");
  assert(
    dangerResult.violations.some(
      (v) => typeof v.type === "string" && typeof v.severity === "string",
    ),
    "Violation has type and severity fields",
  );
  assert(
    dangerResult.violations.some(
      (v) => typeof v.message === "string" && v.message.length > 0,
    ),
    "Violation has a non-empty message",
  );
} catch (err) {
  console.error(`  ERROR in Group 2: ${err.message}`);
  failed++;
}

// ─── Group 3: runLocalPDSEScorer ────────────────────────────────────────────
console.log("\n[3] runLocalPDSEScorer");

try {
  // 3a — Clean, real code should produce a passing score
  console.log("\n[3.1] Clean code should score well");
  const goodCode = `
    import { createHash } from "node:crypto";

    export function sha256(input) {
      return createHash("sha256").update(input).digest("hex");
    }

    export function hashPair(left, right) {
      return sha256(left + right);
    }

    export function verifyHash(data, expectedHash) {
      return sha256(data) === expectedHash;
    }
  `;
  const goodScore = runLocalPDSEScorer(goodCode, repoRoot);
  assert(typeof goodScore.overall === "number", "PDSE overall score is a number");
  assert(goodScore.overall > 0, "Clean code has overall score > 0");
  assert(goodScore.passedGate === true, "Clean code passes PDSE gate");
  assert(Array.isArray(goodScore.violations), "PDSE result has violations array");
  assert(typeof goodScore.scoredBy === "string", "PDSE result has scoredBy field");
  assert(typeof goodScore.scoredAt === "string", "PDSE result has scoredAt timestamp");

  // 3b — Stub-heavy code should score lower or fail
  console.log("\n[3.2] Stub-heavy code should score lower");
  const badCode = `
    // TODO: implement
    export function authenticate(user, password) {
      throw new Error("Not implemented");
    }
    // TODO: implement
    export function authorize(user, role) {
      throw new Error("Not implemented");
    }
    // TODO: implement later
    export function validateToken(token) {
      throw new Error("Not implemented");
    }
  `;
  const badScore = runLocalPDSEScorer(badCode, repoRoot);
  assert(typeof badScore.overall === "number", "Stub-heavy code overall score is a number");
  assert(
    badScore.passedGate === false || badScore.overall < goodScore.overall,
    `Stub-heavy code scores lower (${badScore.overall}) than clean code (${goodScore.overall}) or fails gate`,
  );
  assert(badScore.violations.length > 0, "Stub-heavy code has PDSE violations");
} catch (err) {
  console.error(`  ERROR in Group 3: ${err.message}`);
  failed++;
}

// ─── Group 4: scanFile ──────────────────────────────────────────────────────
console.log("\n[4] scanFile");

try {
  // 4a — Scan a real built file from the project
  console.log("\n[4.1] Scan a real project file (evidence-chain dist)");
  const targetFile = resolve(repoRoot, "packages/evidence-chain/dist/index.js");
  const scanResult = scanFile(targetFile, repoRoot);
  assert(typeof scanResult.passed === "boolean", "scanFile result has boolean passed field");
  assert(typeof scanResult.scannedLines === "number", "scanFile result has scannedLines");
  assert(scanResult.scannedLines > 0, "scannedLines > 0 for real file");
  assert(Array.isArray(scanResult.hardViolations), "scanFile result has hardViolations array");
  assert(Array.isArray(scanResult.softViolations), "scanFile result has softViolations array");
} catch (err) {
  console.error(`  ERROR in Group 4: ${err.message}`);
  failed++;
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`danteforge PDSE scorer test: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("PASS — danteforge PDSE scorer works correctly");
}
