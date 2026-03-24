// ============================================================================
// @dantecode/cli — DanteForge Quality Pipeline
// Runs anti-stub scan, constitution check, and PDSE scoring on generated code.
// ============================================================================

import {
  runAntiStubScanner,
  runLocalPDSEScorer,
  runConstitutionCheck,
} from "@dantecode/danteforge";
import { PRQualityChecker } from "@dantecode/core";

// ANSI Colors
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ---------------------------------------------------------------------------
// Human-Readable Verification Output (B5 / D-03)
// ---------------------------------------------------------------------------

export interface VerificationDetails {
  antiStubPassed: boolean;
  hardViolationCount: number;
  hardViolationMessages: string[];
  constitutionPassed: boolean;
  constitutionCriticalCount: number;
  constitutionWarningCount: number;
  constitutionMessages: string[];
  pdseScore: number;
  pdsePassedGate: boolean;
  pdseBreakdown?: { completeness: number; correctness: number; clarity: number; consistency: number };
  /** PR quality score from PRQualityChecker (advisory, non-blocking). */
  prQualityScore?: number;
}

export function formatVerificationVerdict(details: VerificationDetails, verbose: boolean): string {
  const allPassed = details.antiStubPassed && details.constitutionPassed && details.pdsePassedGate;
  const lines: string[] = [];

  if (allPassed && details.constitutionWarningCount === 0) {
    lines.push(`${GREEN}\u2713 Verified \u2014 no issues found${RESET}`);
  } else if (allPassed && details.constitutionWarningCount > 0) {
    lines.push(`${YELLOW}\u2713 Verified \u2014 ${details.constitutionWarningCount} warning(s)${RESET}`);
  } else if (!details.antiStubPassed) {
    const msgs = details.hardViolationMessages.slice(0, 2).join(", ");
    lines.push(`${RED}\u26A0 Verification failed \u2014 caught ${details.hardViolationCount} stub(s): ${msgs}${RESET}`);
  } else if (!details.constitutionPassed) {
    const msgs = details.constitutionMessages.slice(0, 2).join(", ");
    lines.push(`${RED}\u26A0 Verification failed \u2014 ${details.constitutionCriticalCount} policy violation(s): ${msgs}${RESET}`);
  } else {
    lines.push(`${RED}\u26A0 Could not fully verify \u2014 additional review needed${RESET}`);
  }

  if (verbose) {
    lines.push(`  ${DIM}Anti-stub scan: ${details.antiStubPassed ? "PASSED" : "FAILED"} (${details.hardViolationCount} hard violations)${RESET}`);
    lines.push(`  ${DIM}Constitution check: ${details.constitutionPassed ? "PASSED" : "FAILED"}${details.constitutionWarningCount > 0 ? ` (${details.constitutionWarningCount} warnings)` : ""}${RESET}`);
    lines.push(`  ${DIM}PDSE score: ${details.pdseScore}/100${RESET}`);
    if (details.pdseBreakdown) {
      lines.push(`  ${DIM}  Completeness: ${details.pdseBreakdown.completeness} | Correctness: ${details.pdseBreakdown.correctness} | Clarity: ${details.pdseBreakdown.clarity} | Consistency: ${details.pdseBreakdown.consistency}${RESET}`);
    }
    if (details.prQualityScore !== undefined) {
      const prColor = details.prQualityScore >= 70 ? GREEN : YELLOW;
      lines.push(`  ${DIM}PR quality: ${prColor}${details.prQualityScore}/100${RESET}`);
    }
  }

  return lines.join("\n");
}

/**
 * Runs the DanteForge quality pipeline on generated code.
 * Steps: anti-stub scan -> constitution check -> PDSE score
 * Returns a human-readable verdict via formatVerificationVerdict.
 */
export async function runDanteForge(
  code: string,
  filePath: string,
  projectRoot: string,
  verbose: boolean,
): Promise<{ passed: boolean; summary: string; pdseScore: number }> {
  let passed = true;

  // Step 1: Anti-stub scan
  const antiStub = runAntiStubScanner(code, projectRoot, filePath);
  if (!antiStub.passed) passed = false;

  // Step 2: Constitution check
  const constitution = runConstitutionCheck(code, filePath);
  const criticalViolations = constitution.violations.filter((v) => v.severity === "critical");
  if (criticalViolations.length > 0) passed = false;
  const warnings = constitution.violations.filter((v) => v.severity === "warning");

  // Step 3: PDSE local score
  const pdse = runLocalPDSEScorer(code, projectRoot);
  if (!pdse.passedGate) passed = false;

  const details: VerificationDetails = {
    antiStubPassed: antiStub.passed,
    hardViolationCount: antiStub.hardViolations.length,
    hardViolationMessages: (antiStub.hardViolations as Array<{ message: string }>).map((v) =>
      v.message.slice(0, 80),
    ),
    constitutionPassed: criticalViolations.length === 0,
    constitutionCriticalCount: criticalViolations.length,
    constitutionWarningCount: warnings.length,
    constitutionMessages: (criticalViolations as Array<{ message: string }>).map((v) =>
      v.message.slice(0, 80),
    ),
    pdseScore: pdse.overall,
    pdsePassedGate: pdse.passedGate,
    pdseBreakdown: {
      completeness: pdse.completeness,
      correctness: pdse.correctness,
      clarity: pdse.clarity,
      consistency: pdse.consistency,
    },
  };

  // Step 4: PR quality check (informational, non-blocking)
  try {
    const prChecker = new PRQualityChecker();
    const prReport = prChecker.check(code);
    details.prQualityScore = prReport.score;
  } catch {
    // Non-fatal: PR quality check is advisory
  }

  return { passed, summary: formatVerificationVerdict(details, verbose), pdseScore: pdse.overall };
}

/**
 * Checks if a tool call writes code to a file and returns the file path.
 */
export function getWrittenFilePath(
  toolName: string,
  toolInput: Record<string, unknown>,
): string | null {
  if (toolName === "Write" || toolName === "Edit") {
    const filePath = toolInput["file_path"] as string | undefined;
    if (filePath) {
      // Only run DanteForge on code files
      const codeExtensions = [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".py",
        ".rb",
        ".rs",
        ".go",
        ".java",
        ".c",
        ".cpp",
        ".h",
      ];
      const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
      if (codeExtensions.includes(ext)) {
        return filePath;
      }
    }
  }
  return null;
}
