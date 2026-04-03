/**
 * lint-parsers.ts
 *
 * Parse lint output from various tools (ESLint, Prettier, TSC)
 * into a normalized LintError format.
 */

export interface LintError {
  file: string;
  line: number;
  column: number;
  rule: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Parse ESLint JSON output
 *
 * ESLint JSON format:
 * [
 *   {
 *     filePath: "/path/to/file.ts",
 *     messages: [
 *       {
 *         ruleId: "no-unused-vars",
 *         severity: 2,
 *         message: "...",
 *         line: 10,
 *         column: 5
 *       }
 *     ]
 *   }
 * ]
 */
export function parseESLintOutput(output: string): LintError[] {
  const errors: LintError[] = [];

  // Handle empty output
  if (!output.trim()) {
    return errors;
  }

  try {
    // Try JSON format first
    const results = JSON.parse(output);

    if (!Array.isArray(results)) {
      return errors;
    }

    for (const result of results) {
      const filePath = result.filePath || "";
      const messages = result.messages || [];

      for (const msg of messages) {
        errors.push({
          file: filePath,
          line: msg.line || 0,
          column: msg.column || 0,
          rule: msg.ruleId || "unknown",
          message: msg.message || "",
          severity: msg.severity === 2 ? "error" : "warning",
        });
      }
    }
  } catch {
    // Fallback: parse text format
    // Example: /path/to/file.ts:10:5: error - 'foo' is declared but never used (@typescript-eslint/no-unused-vars)
    const lines = output.split("\n");

    for (const line of lines) {
      const match = line.match(
        /^(.+):(\d+):(\d+):\s*(error|warning)\s*-?\s*(.+?)(?:\s*\((.+?)\))?$/,
      );

      if (match) {
        const [, file, lineNum, col, severity, message, rule] = match;
        if (file && lineNum && col && severity && message) {
          errors.push({
            file: file.trim(),
            line: parseInt(lineNum, 10),
            column: parseInt(col, 10),
            rule: rule || "unknown",
            message: message.trim(),
            severity: severity === "error" ? "error" : "warning",
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Parse Prettier output
 *
 * Prettier format:
 * [error] src/file.ts: SyntaxError: Unexpected token (10:5)
 */
export function parsePrettierOutput(output: string): LintError[] {
  const errors: LintError[] = [];

  if (!output.trim()) {
    return errors;
  }

  const lines = output.split("\n");

  for (const line of lines) {
    // Match: [error] path/to/file.ts: message
    const errorMatch = line.match(/^\[error\]\s+(.+?):\s+(.+)/);
    if (errorMatch) {
      const [, file, message] = errorMatch;

      if (file && message) {
        // Try to extract line:column from message
        let lineNum = 0;
        let col = 0;
        const locationMatch = message.match(/\((\d+):(\d+)\)/);
        if (locationMatch && locationMatch[1] && locationMatch[2]) {
          lineNum = parseInt(locationMatch[1], 10);
          col = parseInt(locationMatch[2], 10);
        }

        errors.push({
          file: file.trim(),
          line: lineNum,
          column: col,
          rule: "prettier",
          message: message.trim(),
          severity: "error",
        });
      }
    }

    // Match: Code style issues found in the above file(s). Forgot to run Prettier?
    const warningMatch = line.match(/^\[warn\]\s+(.+?):\s+(.+)/);
    if (warningMatch) {
      const [, file, message] = warningMatch;

      if (file && message) {
        errors.push({
          file: file.trim(),
          line: 0,
          column: 0,
          rule: "prettier",
          message: message.trim(),
          severity: "warning",
        });
      }
    }
  }

  return errors;
}

/**
 * Parse TypeScript Compiler (tsc) output
 *
 * TSC format:
 * src/file.ts(10,5): error TS2304: Cannot find name 'foo'.
 */
export function parseTSCOutput(output: string): LintError[] {
  const errors: LintError[] = [];

  if (!output.trim()) {
    return errors;
  }

  const lines = output.split("\n");

  for (const line of lines) {
    // Match: path/to/file.ts(10,5): error TS2304: message
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)/);

    if (match) {
      const [, file, lineNum, col, severity, rule, message] = match;

      if (file && lineNum && col && severity && rule && message) {
        errors.push({
          file: file.trim(),
          line: parseInt(lineNum, 10),
          column: parseInt(col, 10),
          rule,
          message: message.trim(),
          severity: severity === "error" ? "error" : "warning",
        });
      }
    }
  }

  return errors;
}

/**
 * Auto-detect lint tool from output and parse accordingly
 */
export function parseLintOutput(output: string, tool?: "eslint" | "prettier" | "tsc"): LintError[] {
  if (!output.trim()) {
    return [];
  }

  // If tool specified, use that parser
  if (tool === "eslint") return parseESLintOutput(output);
  if (tool === "prettier") return parsePrettierOutput(output);
  if (tool === "tsc") return parseTSCOutput(output);

  // Auto-detect from output format
  if (output.includes("TS") && output.match(/\(\d+,\d+\):/)) {
    return parseTSCOutput(output);
  }

  if (output.includes("[error]") || output.includes("[warn]")) {
    return parsePrettierOutput(output);
  }

  // Default to ESLint (most common)
  return parseESLintOutput(output);
}
