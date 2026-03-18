// ============================================================================
// @dantecode/core — Verification Error Parser
// Parses output from TypeScript, ESLint, Vitest, Jest, and generic error
// formats into structured error objects for targeted fix prompts.
// ============================================================================

export interface ParsedError {
  file: string;
  line: number | null;
  column: number | null;
  message: string;
  errorType: string; // "typescript" | "eslint" | "vitest" | "jest" | "generic"
  code: string | null; // e.g., "TS2345", "no-unused-vars"
}

/**
 * Parse verification command output into structured errors.
 * Supports TypeScript, ESLint, Vitest/Jest, and generic error formats.
 */
export function parseVerificationErrors(output: string): ParsedError[] {
  const errors: ParsedError[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    // TypeScript: src/foo.ts(12,5): error TS2345: Argument of type...
    const tsMatch = line.match(
      /(\S+\.tsx?)\((\d+),(\d+)\):\s*error\s*(TS\d+):\s*(.+)/,
    );
    if (tsMatch) {
      errors.push({
        file: tsMatch[1]!,
        line: parseInt(tsMatch[2]!, 10),
        column: parseInt(tsMatch[3]!, 10),
        message: tsMatch[5]!,
        errorType: "typescript",
        code: tsMatch[4]!,
      });
      continue;
    }

    // TypeScript (colon format): src/foo.ts:12:5 - error TS2345: Argument of type...
    const tsColonMatch = line.match(
      /(\S+\.tsx?):(\d+):(\d+)\s*-\s*error\s*(TS\d+):\s*(.+)/,
    );
    if (tsColonMatch) {
      errors.push({
        file: tsColonMatch[1]!,
        line: parseInt(tsColonMatch[2]!, 10),
        column: parseInt(tsColonMatch[3]!, 10),
        message: tsColonMatch[5]!,
        errorType: "typescript",
        code: tsColonMatch[4]!,
      });
      continue;
    }

    // ESLint: src/foo.ts:12:5  error  No unused vars  no-unused-vars
    const eslintMatch = line.match(
      /(\S+):(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)$/,
    );
    if (eslintMatch) {
      errors.push({
        file: eslintMatch[1]!,
        line: parseInt(eslintMatch[2]!, 10),
        column: parseInt(eslintMatch[3]!, 10),
        message: eslintMatch[5]!,
        errorType: "eslint",
        code: eslintMatch[6]!,
      });
      continue;
    }

    // Vitest/Jest FAIL line: FAIL  src/foo.test.ts
    // (capture the file, look for subsequent Expected/Received)
    const vitestFailMatch = line.match(/FAIL\s+(\S+)/);
    if (vitestFailMatch) {
      errors.push({
        file: vitestFailMatch[1]!,
        line: null,
        column: null,
        message: `Test suite failed: ${vitestFailMatch[1]!}`,
        errorType: "vitest",
        code: null,
      });
      continue;
    }

    // Jest-style assertion: at Object.<anonymous> (src/foo.test.ts:42:10)
    const jestStackMatch = line.match(
      /at\s+\S+\s+\((\S+\.(?:test|spec)\.tsx?):(\d+):(\d+)\)/,
    );
    if (jestStackMatch) {
      errors.push({
        file: jestStackMatch[1]!,
        line: parseInt(jestStackMatch[2]!, 10),
        column: parseInt(jestStackMatch[3]!, 10),
        message: `Test failure at ${jestStackMatch[1]!}:${jestStackMatch[2]!}`,
        errorType: "jest",
        code: null,
      });
      continue;
    }
  }

  // Deduplicate by file+line+message
  const seen = new Set<string>();
  return errors.filter((e) => {
    const key = `${e.file}:${e.line}:${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Format parsed errors into a targeted fix prompt for the LLM.
 */
export function formatErrorsForFixPrompt(errors: ParsedError[]): string {
  if (errors.length === 0) return "";

  const lines = errors.map((e) => {
    const loc = e.line ? `${e.file}:${e.line}` : e.file;
    const code = e.code ? ` [${e.code}]` : "";
    return `- ${loc}${code} — ${e.message}`;
  });

  return [
    "Fix these specific errors:",
    ...lines,
    "",
    "Read each affected file first, then apply minimal edits to fix only these errors.",
    "Do NOT rewrite entire files — fix only the specific issues listed above.",
  ].join("\n");
}

/**
 * Compute a signature for a set of errors to detect repeated failures.
 * The signature is deterministic: sorting ensures order-independence.
 */
export function computeErrorSignature(errors: ParsedError[]): string {
  return errors
    .map(
      (e) => `${e.file}:${e.line}:${e.code ?? e.message.slice(0, 50)}`,
    )
    .sort()
    .join("|");
}
