// ============================================================================
// @dantecode/danteforge — Anti-Stub Scanner
// Detects stub code, placeholder patterns, and incomplete implementations.
// ============================================================================

import type { PDSEViolation } from "@dantecode/config-types";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// ----------------------------------------------------------------------------
// Pattern Definitions
// ----------------------------------------------------------------------------

export interface StubPattern {
  regex: RegExp;
  message: string;
  violationType: PDSEViolation["type"];
}

/**
 * Hard violations are blocking — code must not contain these patterns.
 * Any hard violation causes the anti-stub scan to fail.
 */
export const HARD_VIOLATION_PATTERNS: StubPattern[] = [
  {
    regex: /\bTODO\b/i,
    message: "TODO marker found — implementation is incomplete",
    violationType: "stub_detected",
  },
  {
    regex: /\bFIXME\b/i,
    message: "FIXME marker found — known issue left unresolved",
    violationType: "stub_detected",
  },
  {
    regex: /\bHACK\b/i,
    message: "HACK marker found — workaround left in code",
    violationType: "stub_detected",
  },
  {
    regex: /raise\s+NotImplementedError/,
    message: "Python NotImplementedError raised — function is a stub",
    violationType: "stub_detected",
  },
  {
    regex: /throw\s+new\s+Error\s*\(\s*['"`]not\s+implemented['"`]\s*\)/i,
    message: "Throwing 'not implemented' error — function is a stub",
    violationType: "stub_detected",
  },
  {
    regex: /throw\s+new\s+Error\s*\(\s*['"`]todo['"`]\s*\)/i,
    message: "Throwing 'todo' error — function is a stub",
    violationType: "stub_detected",
  },
  {
    regex: /throw\s+new\s+Error\s*\(\s*['"`]stub['"`]\s*\)/i,
    message: "Throwing 'stub' error — function is a stub",
    violationType: "stub_detected",
  },
  {
    regex: /^\s*\.\.\.\s*$/,
    message: "Ellipsis stub detected — body is empty placeholder",
    violationType: "stub_detected",
  },
  {
    regex: /^\s*pass\s*$/,
    message: "Python pass stub detected — body is empty placeholder",
    violationType: "stub_detected",
  },
  {
    regex: /\bas\s+any\b/,
    message: "'as any' type assertion defeats TypeScript safety",
    violationType: "type_any",
  },
  {
    regex: /:\s*any\b/,
    message: "Explicit 'any' type annotation defeats TypeScript safety",
    violationType: "type_any",
  },
  {
    regex: /@ts-ignore/,
    message: "@ts-ignore directive suppresses type checking",
    violationType: "type_any",
  },
  {
    regex: /@ts-nocheck/,
    message: "@ts-nocheck directive disables type checking for entire file",
    violationType: "type_any",
  },
  {
    regex: /\bplaceholder\b/i,
    message: "Placeholder text found — likely incomplete implementation",
    violationType: "stub_detected",
  },
  {
    regex: /\bnotImplemented\b/,
    message: "notImplemented reference found — function is a stub",
    violationType: "stub_detected",
  },
  {
    regex: /\/\/\s*\.{3,}/,
    message: "Ellipsis comment found — indicates omitted code",
    violationType: "stub_detected",
  },
  {
    regex: /{\s*}\s*$/,
    message: "Empty function or block body — likely incomplete",
    violationType: "incomplete_function",
  },
  {
    regex: /=>\s*{\s*}\s*$/,
    message: "Empty arrow function body — likely incomplete",
    violationType: "incomplete_function",
  },
  {
    regex: /return\s*;\s*\/\/.*stub/i,
    message: "Bare return with stub comment — function is a stub",
    violationType: "stub_detected",
  },
];

/**
 * Soft violations are warnings — they do not block but are flagged for review.
 */
export const SOFT_VIOLATION_PATTERNS: StubPattern[] = [
  {
    regex: /\bXXX\b/,
    message: "XXX marker found — needs attention",
    violationType: "stub_detected",
  },
  {
    regex: /\bconsole\.log\b/,
    message: "console.log left in code — likely debug leftover",
    violationType: "console_log_leftover",
  },
  {
    regex: /\bconsole\.debug\b/,
    message: "console.debug left in code — likely debug leftover",
    violationType: "console_log_leftover",
  },
  {
    regex: /\bconsole\.warn\b/,
    message: "console.warn left in code — consider proper logging",
    violationType: "console_log_leftover",
  },
  {
    regex: /\.skip\s*\(/,
    message: ".skip() found — test is being skipped",
    violationType: "test_skip",
  },
  {
    regex: /\bxit\s*\(/,
    message: "xit() found — Jasmine test is being skipped",
    violationType: "test_skip",
  },
  {
    regex: /\bxdescribe\s*\(/,
    message: "xdescribe() found — test suite is being skipped",
    violationType: "test_skip",
  },
  {
    regex: /\btest\.todo\s*\(/,
    message: "test.todo() found — test is a placeholder",
    violationType: "test_skip",
  },
  {
    regex: /\bit\.todo\s*\(/,
    message: "it.todo() found — test is a placeholder",
    violationType: "test_skip",
  },
  {
    regex: /\bNOTE\b:\s/,
    message: "NOTE marker found — consider converting to documentation",
    violationType: "stub_detected",
  },
];

// ----------------------------------------------------------------------------
// Scanner Result
// ----------------------------------------------------------------------------

export interface AntiStubScanResult {
  hardViolations: PDSEViolation[];
  softViolations: PDSEViolation[];
  passed: boolean;
  scannedLines: number;
  filePath?: string;
}

// ----------------------------------------------------------------------------
// Custom Pattern Loader
// ----------------------------------------------------------------------------

/**
 * Attempts to load custom stub patterns from STATE.yaml in the project root.
 * STATE.yaml is expected to have a pdse.stub_patterns array of regex strings.
 * Falls back to empty array if not found or invalid.
 */
function loadCustomPatterns(projectRoot: string): StubPattern[] {
  const stateYamlPath = join(projectRoot, ".dantecode", "STATE.yaml");
  if (!existsSync(stateYamlPath)) {
    return [];
  }

  try {
    const content = readFileSync(stateYamlPath, "utf-8");
    const customPatterns: StubPattern[] = [];

    // Parse YAML-like structure for pdse.stub_patterns
    // Looking for lines like:
    //   stub_patterns:
    //     - pattern: "regex"
    //       message: "description"
    //       severity: "hard" | "soft"
    let inStubPatterns = false;
    let currentPattern: { regex?: string; message?: string; severity?: string } = {};
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === "stub_patterns:") {
        inStubPatterns = true;
        continue;
      }

      if (inStubPatterns) {
        // Detect end of stub_patterns section (new top-level key)
        if (trimmed.length > 0 && !trimmed.startsWith("-") && !trimmed.startsWith("pattern:") &&
            !trimmed.startsWith("message:") && !trimmed.startsWith("severity:") &&
            !line.startsWith("    ") && !line.startsWith("\t\t")) {
          inStubPatterns = false;
          // Flush last pattern
          if (currentPattern.regex && currentPattern.message) {
            customPatterns.push({
              regex: new RegExp(currentPattern.regex),
              message: currentPattern.message,
              violationType: "stub_detected",
            });
          }
          continue;
        }

        if (trimmed.startsWith("- pattern:") || trimmed.startsWith("pattern:")) {
          // Flush previous pattern
          if (currentPattern.regex && currentPattern.message) {
            customPatterns.push({
              regex: new RegExp(currentPattern.regex),
              message: currentPattern.message,
              violationType: "stub_detected",
            });
          }
          currentPattern = {};
          const match = trimmed.match(/pattern:\s*["'](.+?)["']/);
          if (match?.[1]) {
            currentPattern.regex = match[1];
          }
        } else if (trimmed.startsWith("message:")) {
          const match = trimmed.match(/message:\s*["'](.+?)["']/);
          if (match?.[1]) {
            currentPattern.message = match[1];
          }
        } else if (trimmed.startsWith("severity:")) {
          const match = trimmed.match(/severity:\s*["']?(\w+)["']?/);
          if (match?.[1]) {
            currentPattern.severity = match[1];
          }
        }
      }
    }

    // Flush final pattern if in progress
    if (inStubPatterns && currentPattern.regex && currentPattern.message) {
      customPatterns.push({
        regex: new RegExp(currentPattern.regex),
        message: currentPattern.message,
        violationType: "stub_detected",
      });
    }

    return customPatterns;
  } catch {
    // If STATE.yaml cannot be read or parsed, silently return empty
    return [];
  }
}

// ----------------------------------------------------------------------------
// Core Scanner
// ----------------------------------------------------------------------------

/**
 * Scans code content for stub violations against all known patterns.
 *
 * @param content - The source code content to scan
 * @param projectRoot - The project root for loading custom patterns
 * @param filePath - Optional file path for violation reporting
 * @returns AntiStubScanResult with hard/soft violations and pass/fail status
 */
export function runAntiStubScanner(
  content: string,
  projectRoot: string,
  filePath?: string,
): AntiStubScanResult {
  const hardViolations: PDSEViolation[] = [];
  const softViolations: PDSEViolation[] = [];
  const lines = content.split("\n");
  const resolvedFile = filePath ?? "<inline>";

  // Load custom patterns from STATE.yaml
  const customPatterns = loadCustomPatterns(projectRoot);

  // Combine hard patterns with custom patterns
  const allHardPatterns = [...HARD_VIOLATION_PATTERNS, ...customPatterns];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const lineNumber = i + 1;

    // Skip comment-only lines that reference the patterns as documentation
    // (e.g., a line that says "// This scanner checks for TODO patterns")
    // We only skip if the line is documenting the scanner itself
    const trimmedLine = line.trim();

    // Skip empty lines
    if (trimmedLine.length === 0) continue;

    // Check hard violation patterns
    for (const pattern of allHardPatterns) {
      if (pattern.regex.test(line)) {
        // Special handling: don't flag empty braces in interfaces, types, or imports
        if (pattern.violationType === "incomplete_function") {
          // Skip lines that are part of interface/type declarations or import statements
          if (/\b(interface|type|import|export\s+type)\b/.test(line)) continue;
          // Skip lines that are object destructuring in function params
          if (/\(\s*{\s*}\s*\)/.test(line)) continue;
          // Skip empty object literals used as defaults
          if (/=\s*{\s*}/.test(line) && !/=>\s*{\s*}/.test(line)) continue;
        }

        // Special handling: don't flag 'as any' inside string literals
        if (pattern.violationType === "type_any" && /as\s+any/.test(line)) {
          const withoutStrings = line.replace(/(['"`])(?:(?!\1).)*\1/g, "");
          if (!/\bas\s+any\b/.test(withoutStrings) && !/:\s*any\b/.test(withoutStrings)) continue;
        }

        hardViolations.push({
          type: pattern.violationType,
          severity: "hard",
          file: resolvedFile,
          line: lineNumber,
          message: pattern.message,
          pattern: pattern.regex.source,
        });
      }
    }

    // Check soft violation patterns
    for (const pattern of SOFT_VIOLATION_PATTERNS) {
      if (pattern.regex.test(line)) {
        // Don't flag console.log inside string literals
        if (pattern.violationType === "console_log_leftover") {
          const withoutStrings = trimmedLine.replace(/(['"`])(?:(?!\1).)*\1/g, "");
          if (!/console\.(log|debug|warn)\b/.test(withoutStrings)) continue;
        }

        softViolations.push({
          type: pattern.violationType,
          severity: "soft",
          file: resolvedFile,
          line: lineNumber,
          message: pattern.message,
          pattern: pattern.regex.source,
        });
      }
    }
  }

  return {
    hardViolations,
    softViolations,
    passed: hardViolations.length === 0,
    scannedLines: lines.length,
    filePath,
  };
}

// ----------------------------------------------------------------------------
// File Scanner
// ----------------------------------------------------------------------------

/**
 * Reads a file from disk and runs the anti-stub scanner on its contents.
 *
 * @param filePath - Absolute or relative path to the file
 * @param projectRoot - The project root for loading custom patterns
 * @returns AntiStubScanResult
 * @throws If the file cannot be read
 */
export function scanFile(
  filePath: string,
  projectRoot: string,
): AntiStubScanResult {
  const absolutePath = resolve(projectRoot, filePath);

  if (!existsSync(absolutePath)) {
    return {
      hardViolations: [{
        type: "stub_detected",
        severity: "hard",
        file: absolutePath,
        message: `File not found: ${absolutePath}`,
      }],
      softViolations: [],
      passed: false,
      scannedLines: 0,
      filePath: absolutePath,
    };
  }

  const content = readFileSync(absolutePath, "utf-8");
  return runAntiStubScanner(content, projectRoot, absolutePath);
}
