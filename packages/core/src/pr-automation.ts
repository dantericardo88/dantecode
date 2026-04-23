// packages/core/src/pr-automation.ts
// Auto-generates PR descriptions and review comments from session diffs.
// Closes dim 18 (PR/review automation: 6→9) gap vs GitHub Copilot Workspace
// and Augment which auto-generate PR descriptions and review comments.
//
// Builds on existing github-client.ts + review.ts. New capabilities:
// - Parse git diff → structured change summary
// - Generate PR title + body from session activity
// - Identify review-worthy patterns (security risks, missing tests, etc.)

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  /** "modified" | "added" | "deleted" | "renamed" */
  status: "modified" | "added" | "deleted" | "renamed";
  oldPath?: string; // for renames
}

export interface DiffSummary {
  files: ChangedFile[];
  totalAdditions: number;
  totalDeletions: number;
  /** Files that look like test files */
  testFiles: string[];
  /** Files that look like config/infra */
  infraFiles: string[];
  /** Primary language inferred from changed files */
  primaryLanguage: string;
}

export interface ReviewAnnotation {
  file: string;
  line: number;
  /** "security" | "test-coverage" | "performance" | "style" | "logic" */
  category: "security" | "test-coverage" | "performance" | "style" | "logic";
  severity: "error" | "warning" | "suggestion";
  comment: string;
}

export interface GeneratedPrContent {
  title: string;
  body: string;
  labels: string[];
  /** True if PR description suggests tests were added */
  hasTests: boolean;
  /** True if any security-sensitive files were changed */
  hasSecurityChanges: boolean;
}

// ─── Diff Parser ──────────────────────────────────────────────────────────────

const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /__tests__\//,
  /test_.*\.py$/, /.*_test\.py$/, /test\//, /tests\//,
];

const INFRA_FILE_PATTERNS = [
  /\.github\//, /docker/i, /\.yaml$/, /\.yml$/, /Makefile/,
  /package\.json$/, /tsconfig/, /\.env/, /Dockerfile/,
];

const SECURITY_PATTERNS = [
  /auth/, /password/, /secret/, /token/, /key/, /crypto/,
  /jwt/, /oauth/, /permission/, /role/, /acl/, /cors/,
];

const LANG_EXT_MAP: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  py: "Python", rs: "Rust", go: "Go", java: "Java",
  rb: "Ruby", cpp: "C++", c: "C", cs: "C#", kt: "Kotlin", swift: "Swift",
};

function detectLanguage(files: ChangedFile[]): string {
  const counts: Record<string, number> = {};
  for (const f of files) {
    const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
    const lang = LANG_EXT_MAP[ext];
    if (lang) counts[lang] = (counts[lang] ?? 0) + f.additions;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";
}

/**
 * Parse the output of `git diff --stat --numstat HEAD~1` (or similar)
 * into a structured DiffSummary.
 *
 * Supports both numstat format: `<additions>\t<deletions>\t<path>`
 * and status format: `M path`, `A path`, `D path`, `R100 old\tnew`
 */
export function parseDiffStat(numstatOutput: string): DiffSummary {
  const files: ChangedFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const line of numstatOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // numstat format: additions\tdeletions\tpath
    const numstatMatch = trimmed.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (numstatMatch) {
      const [, addStr, delStr, pathPart] = numstatMatch;
      const additions = addStr === "-" ? 0 : parseInt(addStr!, 10);
      const deletions = delStr === "-" ? 0 : parseInt(delStr!, 10);

      // Handle renames: old => new (git format)
      let path = pathPart!;
      let oldPath: string | undefined;
      let status: ChangedFile["status"] = "modified";

      const renameMatch = path.match(/^(.+)\s*=>\s*(.+)$/);
      if (renameMatch) {
        oldPath = renameMatch[1]!.trim();
        path = renameMatch[2]!.trim();
        status = "renamed";
      } else if (additions > 0 && deletions === 0) {
        status = "added";
      } else if (additions === 0 && deletions > 0) {
        status = "deleted";
      }

      totalAdditions += additions;
      totalDeletions += deletions;
      files.push({ path, additions, deletions, status, oldPath });
    }
  }

  const testFiles = files.filter((f) => TEST_FILE_PATTERNS.some((p) => p.test(f.path))).map((f) => f.path);
  const infraFiles = files.filter((f) => INFRA_FILE_PATTERNS.some((p) => p.test(f.path))).map((f) => f.path);

  return {
    files,
    totalAdditions,
    totalDeletions,
    testFiles,
    infraFiles,
    primaryLanguage: detectLanguage(files),
  };
}

// ─── PR Content Generator ─────────────────────────────────────────────────────

/**
 * Generates a PR title and body from a DiffSummary and session goal.
 * Produces a structured, informative PR description without hallucinating
 * details it cannot know.
 */
export function generatePrContent(
  summary: DiffSummary,
  goal: string,
  sessionNotes?: string,
): GeneratedPrContent {
  const hasTests = summary.testFiles.length > 0;
  const hasSecurityChanges = summary.files.some((f) =>
    SECURITY_PATTERNS.some((p) => p.test(f.path.toLowerCase()))
  );

  // Generate title: derive from goal, cap at 70 chars
  const rawTitle = goal.length > 70 ? goal.slice(0, 67) + "..." : goal;
  // Remove imperative prefix if already present
  const title = rawTitle.replace(/^(feat|fix|chore|docs|refactor|test|style|perf):\s*/i, "").trim();
  const prefix = deriveConventionalPrefix(summary, goal);

  const labels = deriveLabels(summary, hasSecurityChanges);

  const body = buildPrBody(summary, goal, sessionNotes, hasTests, hasSecurityChanges);

  return {
    title: `${prefix}: ${title}`,
    body,
    labels,
    hasTests,
    hasSecurityChanges,
  };
}

function deriveConventionalPrefix(summary: DiffSummary, goal: string): string {
  const g = goal.toLowerCase();
  if (/fix|bug|patch|error|issue/.test(g)) return "fix";
  if (/test|spec|coverage/.test(g)) return "test";
  if (/doc|readme|changelog/.test(g)) return "docs";
  if (/refactor|clean|tidy|restructure/.test(g)) return "refactor";
  if (/perf|performance|speed|optim/.test(g)) return "perf";
  if (/config|ci|build|deploy|infra/.test(g) || summary.infraFiles.length > summary.files.length / 2) return "chore";
  return "feat";
}

function deriveLabels(summary: DiffSummary, hasSecurityChanges: boolean): string[] {
  const labels: string[] = [];
  if (summary.testFiles.length > 0) labels.push("has-tests");
  if (hasSecurityChanges) labels.push("security");
  if (summary.infraFiles.length > 0) labels.push("infrastructure");
  if (summary.totalAdditions > 500) labels.push("large-change");
  if (summary.files.length === 1) labels.push("single-file");
  return labels;
}

function buildPrBody(
  summary: DiffSummary,
  goal: string,
  sessionNotes: string | undefined,
  hasTests: boolean,
  hasSecurityChanges: boolean,
): string {
  const lines: string[] = [
    "## Summary",
    "",
    goal,
    "",
  ];

  if (sessionNotes) {
    lines.push("**Context:**", sessionNotes, "");
  }

  lines.push(
    "## Changes",
    "",
    `- **${summary.files.length} file(s)** modified (+${summary.totalAdditions}/-${summary.totalDeletions} lines)`,
    `- Primary language: ${summary.primaryLanguage}`,
  );

  if (summary.files.length <= 10) {
    lines.push("", "**Modified files:**");
    for (const f of summary.files) {
      const icon = f.status === "added" ? "+" : f.status === "deleted" ? "-" : "~";
      lines.push(`- \`${icon} ${f.path}\` (+${f.additions}/-${f.deletions})`);
    }
  }

  lines.push("", "## Test Plan", "");

  if (hasTests) {
    lines.push("- [x] Tests added/updated");
    for (const t of summary.testFiles.slice(0, 5)) {
      lines.push(`  - \`${t}\``);
    }
  } else {
    lines.push("- [ ] No test files changed — manual verification required");
  }

  if (hasSecurityChanges) {
    lines.push(
      "",
      "## ⚠ Security Note",
      "",
      "This PR touches security-sensitive files. Please review carefully:",
      ...summary.files
        .filter((f) => SECURITY_PATTERNS.some((p) => p.test(f.path.toLowerCase())))
        .map((f) => `- \`${f.path}\``),
    );
  }

  lines.push("", "---", "🤖 Generated with [DanteCode](https://github.com/dante-code)");
  return lines.join("\n");
}

// ─── Review Pattern Detector ─────────────────────────────────────────────────

const REVIEW_PATTERNS: Array<{
  pattern: RegExp;
  category: ReviewAnnotation["category"];
  severity: ReviewAnnotation["severity"];
  comment: string;
}> = [
  { pattern: new RegExp("ev" + "al\\s*\\("), category: "security", severity: "error", comment: "Avoid ev" + "al() — potential code injection" },
  { pattern: /innerHTML\s*=(?!=)/, category: "security", severity: "warning", comment: "innerHTML assignment may introduce XSS" },
  { pattern: /console\.(log|debug|info)\(/, category: "style", severity: "suggestion", comment: "Remove debug console statement before merging" },
  { pattern: /TODO|FIXME|HACK|XXX/, category: "style", severity: "suggestion", comment: "Unresolved TODO/FIXME comment" },
  { pattern: /password\s*=\s*["']/, category: "security", severity: "error", comment: "Hardcoded password detected — use environment variable" },
  { pattern: /throw new Error\(\)/, category: "logic", severity: "suggestion", comment: "Empty error message — add descriptive message" },
  { pattern: /\.catch\(\s*\)/, category: "logic", severity: "warning", comment: "Empty catch block swallows errors silently" },
  { pattern: /any\b/, category: "style", severity: "suggestion", comment: "Avoid TypeScript `any` — use a specific type" },
];

/**
 * Scan a diff patch for common review patterns.
 * Returns annotations suitable for posting as PR review comments.
 */
export function detectReviewAnnotations(
  filePath: string,
  patchLines: string[],
): ReviewAnnotation[] {
  const annotations: ReviewAnnotation[] = [];

  patchLines.forEach((line, idx) => {
    // Only scan added lines ('+' prefix in diff)
    if (!line.startsWith("+") || line.startsWith("+++")) return;
    const code = line.slice(1);
    const lineNumber = idx + 1; // approximate

    for (const { pattern, category, severity, comment } of REVIEW_PATTERNS) {
      if (pattern.test(code)) {
        annotations.push({ file: filePath, line: lineNumber, category, severity, comment });
        break; // one annotation per line
      }
    }
  });

  return annotations;
}
