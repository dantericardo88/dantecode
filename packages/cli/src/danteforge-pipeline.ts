// ============================================================================
// @dantecode/cli — DanteForge Quality Pipeline
// Runs anti-stub scan, constitution check, and PDSE scoring on generated code.
// ============================================================================

import {
  runAntiStubScanner,
  runLocalPDSEScorer,
  runConstitutionCheck,
} from "@dantecode/danteforge";

// ANSI Colors
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/**
 * Runs the DanteForge quality pipeline on generated code.
 * Steps: anti-stub scan -> constitution check -> PDSE score
 * Returns a summary of results.
 */
export async function runDanteForge(
  code: string,
  filePath: string,
  projectRoot: string,
  verbose: boolean,
): Promise<{ passed: boolean; summary: string }> {
  const summaryLines: string[] = [];
  let passed = true;

  // Step 1: Anti-stub scan
  const antiStub = runAntiStubScanner(code, projectRoot, filePath);
  if (!antiStub.passed) {
    passed = false;
    summaryLines.push(
      `${RED}Anti-stub scan: FAILED${RESET} (${antiStub.hardViolations.length} hard violations)`,
    );
    if (verbose) {
      for (const v of antiStub.hardViolations.slice(0, 5) as Array<{
        line?: number;
        message: string;
      }>) {
        summaryLines.push(`  ${DIM}Line ${v.line ?? "?"}: ${v.message}${RESET}`);
      }
    }
  } else {
    summaryLines.push(`${GREEN}Anti-stub scan: PASSED${RESET}`);
  }

  // Step 2: Constitution check
  const constitution = runConstitutionCheck(code, filePath);
  const criticalViolations = constitution.violations.filter((v) => v.severity === "critical");
  if (criticalViolations.length > 0) {
    passed = false;
    summaryLines.push(
      `${RED}Constitution check: FAILED${RESET} (${criticalViolations.length} critical violations)`,
    );
    if (verbose) {
      for (const v of criticalViolations.slice(0, 5) as Array<{ line?: number; message: string }>) {
        summaryLines.push(`  ${DIM}Line ${v.line ?? "?"}: ${v.message}${RESET}`);
      }
    }
  } else {
    const warnings = constitution.violations.filter((v) => v.severity === "warning");
    if (warnings.length > 0) {
      summaryLines.push(
        `${YELLOW}Constitution check: PASSED with ${warnings.length} warning(s)${RESET}`,
      );
    } else {
      summaryLines.push(`${GREEN}Constitution check: PASSED${RESET}`);
    }
  }

  // Step 3: PDSE local score (model-based scoring deferred for speed)
  const pdse = runLocalPDSEScorer(code, projectRoot);
  if (!pdse.passedGate) {
    passed = false;
    summaryLines.push(`${RED}PDSE score: ${pdse.overall}/100 (BELOW threshold)${RESET}`);
  } else {
    summaryLines.push(`${GREEN}PDSE score: ${pdse.overall}/100${RESET}`);
  }

  if (verbose) {
    summaryLines.push(
      `  ${DIM}Completeness: ${pdse.completeness} | Correctness: ${pdse.correctness} | Clarity: ${pdse.clarity} | Consistency: ${pdse.consistency}${RESET}`,
    );
  }

  return { passed, summary: summaryLines.join("\n") };
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
