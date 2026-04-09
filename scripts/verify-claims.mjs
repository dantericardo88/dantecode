#!/usr/bin/env node

// ============================================================================
// DanteCode Claim Verification Runner
// Lightweight verification for the evidence-based claim system.
// ============================================================================

import { runProviderProofTests, validateClaim } from "@dantecode/core";
import { execSync } from "child_process";

function makeEvidence({
  claim,
  compiles,
  testsPass,
  antiStubClean,
  constitutionViolations,
  filesChanged,
  riskLevel = "low",
}) {
  return {
    claim,
    timestamp: new Date().toISOString(),
    evidence: {
      compiles,
      testsPass,
      antiStubClean,
      constitutionViolations,
      filesChanged,
      runtimeVerified: compiles && testsPass,
    },
    meta: {
      agentId: "verify-claims",
      sessionId: `verify-${Date.now()}`,
      riskLevel,
    },
  };
}

function runConstitutionCheck() {
  execSync("npm run constitution-check", {
    cwd: process.cwd(),
    stdio: "pipe",
  });
}

async function main() {
  console.log("Claim Verification");

  const providerResults = await runProviderProofTests();
  console.log(
    `Provider proof tests: ${providerResults.passedProviders}/${providerResults.totalProviders} passed`,
  );
  if (providerResults.failedProviders > 0) {
    for (const result of providerResults.results.filter((entry) => !entry.passed)) {
      console.log(`  [provider-fail] ${result.provider}: ${result.error}`);
    }
  }

  const validClaim = "Implemented execution-integrity ledger metadata";
  const validEvidence = makeEvidence({
    claim: validClaim,
    compiles: true,
    testsPass: true,
    antiStubClean: true,
    constitutionViolations: 0,
    filesChanged: ["packages/core/src/execution-integrity.ts"],
  });
  const validValidation = validateClaim(validClaim, validEvidence);
  if (!validValidation.valid) {
    console.error("Expected a valid claim to pass verification.");
    console.error(validValidation);
    process.exit(1);
  }
  console.log(`Valid claim accepted at ${validValidation.confidence}% confidence.`);

  const invalidClaim = "Implemented a working time machine";
  const invalidEvidence = makeEvidence({
    claim: invalidClaim,
    compiles: false,
    testsPass: false,
    antiStubClean: false,
    constitutionViolations: 2,
    filesChanged: [],
    riskLevel: "critical",
  });
  const invalidValidation = validateClaim(invalidClaim, invalidEvidence);
  if (invalidValidation.valid) {
    console.error("Expected an invalid claim to be rejected.");
    console.error(invalidValidation);
    process.exit(1);
  }
  console.log(`Invalid claim rejected at ${invalidValidation.confidence}% confidence.`);

  runConstitutionCheck();
  console.log("Constitution check passed.");
}

main().catch((error) => {
  console.error("Claim verification failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
