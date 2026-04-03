// ============================================================================
// @dantecode/core — PR Quality Checker
// Evaluates pull request readiness by analyzing diff size, anti-stub
// violations, commit message conventions, and test status. Produces a
// 0-100 quality score with blocking threshold.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** Options for the quality checker. */
export interface CheckOptions {
  /** Whether tests passed (injected from CI). */
  testsPassed?: boolean;
  /** Commit messages to validate convention. */
  commitMessages?: string[];
  /** Custom blocking threshold (default: 70). */
  blockThreshold?: number;
}

/** Size analysis of the PR diff. */
export interface PRSizeAnalysis {
  /** Total lines added. */
  linesAdded: number;
  /** Total lines removed. */
  linesRemoved: number;
  /** True if the PR exceeds 500 lines changed. */
  isLarge: boolean;
}

/** Full quality report for a PR. */
export interface PRQualityReport {
  /** Diff size analysis. */
  size: PRSizeAnalysis;
  /** Anti-stub pattern violations found in added lines. */
  antiStubViolations: string[];
  /** Commit message convention violations. */
  conventionViolations: string[];
  /** Whether tests passed. */
  testsPassed: boolean;
  /** Aggregate quality score (0-100). */
  score: number;
  /** Whether the PR should be blocked based on threshold. */
  blocked: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Anti-stub patterns
// ────────────────────────────────────────────────────────────────────────────

/** Patterns that indicate stub/placeholder code in added lines. */
const ANTI_STUB_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bTODO\b/i, label: "TODO marker" },
  { pattern: /\bFIXME\b/i, label: "FIXME marker" },
  { pattern: /\bTBD\b/i, label: "TBD marker" },
  { pattern: /\bplaceholder\b/i, label: "placeholder reference" },
  { pattern: /\bstub\b/i, label: "stub reference" },
  { pattern: /\bHACK\b/, label: "HACK marker" },
  { pattern: /\bXXX\b/, label: "XXX marker" },
  { pattern: /throw new Error\(["']not implemented["']\)/i, label: "not-implemented throw" },
];

/** Conventional commit prefixes. */
const CONVENTIONAL_PREFIXES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

// ────────────────────────────────────────────────────────────────────────────
// Checker
// ────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates PR quality across multiple dimensions:
 *
 * - **Size** (20 points): Penalize large PRs (>500 lines).
 * - **Anti-stub** (25 points): Deduct for TODO/FIXME/placeholder in added lines.
 * - **Convention** (15 points): Commit message follows conventional commits.
 * - **Tests** (25 points): Whether tests pass.
 * - **Baseline** (15 points): Given for having any meaningful diff.
 */
export class PRQualityChecker {
  /**
   * Analyze a PR diff and produce a quality report.
   */
  check(diff: string, options?: CheckOptions): PRQualityReport {
    const size = this.analyzeDiffSize(diff);
    const antiStubViolations = this.scanAntiStub(diff);
    const conventionViolations = this.validateCommitConventions(options?.commitMessages ?? []);
    const testsPassed = options?.testsPassed ?? true;
    const blockThreshold = options?.blockThreshold ?? 70;

    const score = this.computeScore(size, antiStubViolations, conventionViolations, testsPassed);

    return {
      size,
      antiStubViolations,
      conventionViolations,
      testsPassed,
      score,
      blocked: score < blockThreshold,
    };
  }

  /** Compute the aggregate quality score (0-100). */
  score(report: PRQualityReport): number {
    return report.score;
  }

  /** Check if the PR should be blocked based on a threshold. */
  shouldBlock(scoreValue: number, threshold = 70): boolean {
    return scoreValue < threshold;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Analysis methods
  // ──────────────────────────────────────────────────────────────────────────

  /** Parse unified diff to count added/removed lines. */
  private analyzeDiffSize(diff: string): PRSizeAnalysis {
    const lines = diff.split("\n");
    let linesAdded = 0;
    let linesRemoved = 0;

    for (const line of lines) {
      // Skip diff headers and hunk headers
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("@@")) continue;
      if (line.startsWith("diff ")) continue;

      if (line.startsWith("+")) linesAdded++;
      else if (line.startsWith("-")) linesRemoved++;
    }

    return {
      linesAdded,
      linesRemoved,
      isLarge: linesAdded + linesRemoved > 500,
    };
  }

  /** Scan added lines in a diff for anti-stub patterns. */
  private scanAntiStub(diff: string): string[] {
    const violations: string[] = [];
    const lines = diff.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Only check added lines (not removal lines or headers)
      if (!line.startsWith("+") || line.startsWith("+++")) continue;

      // Skip comment-only lines that explain why a pattern exists
      const content = line.slice(1); // remove leading +
      if (content.trim().startsWith("//") && /anti.?stub|violation|pattern/i.test(content)) {
        continue;
      }

      for (const { pattern, label } of ANTI_STUB_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`Line ${i + 1}: ${label} — ${content.trim()}`);
        }
      }
    }

    return violations;
  }

  /** Validate commit messages against conventional commit format. */
  private validateCommitConventions(messages: string[]): string[] {
    const violations: string[] = [];

    for (const msg of messages) {
      const firstLine = msg.split("\n")[0] ?? "";
      if (firstLine.length === 0) {
        violations.push("Empty commit message");
        continue;
      }

      // Check conventional commit format: type(scope): description
      const conventionalRe = new RegExp(
        `^(${CONVENTIONAL_PREFIXES.join("|")})(\\([^)]+\\))?(!)?:\\s+.+`,
      );
      if (!conventionalRe.test(firstLine)) {
        violations.push(`Non-conventional commit: "${firstLine.slice(0, 72)}"`);
      }

      // Check for overly long subject line
      if (firstLine.length > 100) {
        violations.push(
          `Commit subject too long (${firstLine.length} chars): "${firstLine.slice(0, 50)}..."`,
        );
      }
    }

    return violations;
  }

  /** Compute aggregate score from analysis results. */
  private computeScore(
    size: PRSizeAnalysis,
    antiStubViolations: string[],
    conventionViolations: string[],
    testsPassed: boolean,
  ): number {
    let score = 15; // baseline for having a diff

    // Size dimension (0-20)
    if (!size.isLarge) {
      score += 20;
    } else {
      const totalLines = size.linesAdded + size.linesRemoved;
      // Gradual penalty: 500-1000 lines = partial, >1000 = minimal
      if (totalLines <= 1000) score += 10;
      else score += 5;
    }

    // Anti-stub dimension (0-25)
    const stubPenalty = Math.min(antiStubViolations.length * 5, 25);
    score += 25 - stubPenalty;

    // Convention dimension (0-15)
    const conventionPenalty = Math.min(conventionViolations.length * 5, 15);
    score += 15 - conventionPenalty;

    // Tests dimension (0-25)
    if (testsPassed) score += 25;

    return Math.max(0, Math.min(100, score));
  }
}
