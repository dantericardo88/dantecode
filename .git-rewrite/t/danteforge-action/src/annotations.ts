// ============================================================================
// @dantecode/danteforge-action - Annotation Builders
// Converts PDSE failures and anti-stub violations into GitHub Check Run
// annotation format and PR review comment format for inline feedback.
// ============================================================================

export interface PdseFileResult {
  filePath: string;
  overall: number;
  passed: boolean;
  line?: number;
}

export interface AntiStubResult {
  passed: boolean;
  output: string;
  violations?: AntiStubViolation[];
}

export interface AntiStubViolation {
  filePath: string;
  line: number;
  message: string;
}

export interface CheckRunAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "notice" | "warning" | "failure";
  message: string;
  title: string;
}

export interface PRReviewComment {
  path: string;
  position: number;
  body: string;
}

/**
 * Build GitHub Check Run annotations from PDSE and anti-stub results.
 *
 * PDSE failures become "warning" annotations at the file level (line 1 unless
 * a specific line is provided). Anti-stub violations become "failure"
 * annotations at the specific lines where stubs were detected.
 */
export function buildCheckRunAnnotations(
  pdseResults: { files: PdseFileResult[]; skipped: boolean },
  antiStubResult: AntiStubResult,
): CheckRunAnnotation[] {
  const annotations: CheckRunAnnotation[] = [];

  if (!pdseResults.skipped) {
    for (const file of pdseResults.files) {
      if (!file.passed) {
        const line = file.line ?? 1;
        annotations.push({
          path: file.filePath,
          start_line: line,
          end_line: line,
          annotation_level: "warning",
          message: `PDSE score ${file.overall} is below the required threshold. Improve code quality metrics (depth, cohesion, documentation) to raise the score.`,
          title: `PDSE: ${file.overall}/100`,
        });
      }
    }
  }

  if (!antiStubResult.passed && antiStubResult.violations) {
    for (const violation of antiStubResult.violations) {
      annotations.push({
        path: violation.filePath,
        start_line: violation.line,
        end_line: violation.line,
        annotation_level: "failure",
        message: violation.message,
        title: "Anti-Stub Violation",
      });
    }
  }

  // If anti-stub failed but no structured violations were parsed, add a
  // top-level annotation so the developer still sees the failure inline.
  if (!antiStubResult.passed && (!antiStubResult.violations || antiStubResult.violations.length === 0)) {
    annotations.push({
      path: ".",
      start_line: 1,
      end_line: 1,
      annotation_level: "failure",
      message: `Anti-stub check failed:\n${truncateOutput(antiStubResult.output, 500)}`,
      title: "Anti-Stub Failure",
    });
  }

  return annotations;
}

/**
 * Build PR review comments for PDSE failures. These appear as inline
 * comments on the pull request diff at the relevant file positions.
 */
export function buildPRReviewComments(
  pdseResults: { files: PdseFileResult[]; skipped: boolean },
): PRReviewComment[] {
  if (pdseResults.skipped) {
    return [];
  }

  const comments: PRReviewComment[] = [];

  for (const file of pdseResults.files) {
    if (!file.passed) {
      comments.push({
        path: file.filePath,
        position: file.line ?? 1,
        body: [
          `**DanteForge PDSE:** Score ${file.overall}/100 (below threshold)`,
          "",
          "Suggestions to improve:",
          "- Reduce nesting depth and cyclomatic complexity",
          "- Improve function cohesion (single responsibility)",
          "- Add or improve documentation and type annotations",
        ].join("\n"),
      });
    }
  }

  return comments;
}

/**
 * Parse anti-stub checker output into structured violations.
 * The anti-stub checker emits lines in the format:
 *   path/to/file.ts:42: stub detected - function body is empty
 */
export function parseAntiStubViolations(output: string): AntiStubViolation[] {
  if (!output.trim()) {
    return [];
  }

  const violations: AntiStubViolation[] = [];
  const violationPattern = /^(.+?):(\d+):\s*(.+)$/;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = violationPattern.exec(line);
    if (match) {
      const [, filePath, lineStr, message] = match;
      if (filePath && lineStr && message) {
        violations.push({
          filePath,
          line: Number(lineStr),
          message,
        });
      }
    }
  }

  return violations;
}

function truncateOutput(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
