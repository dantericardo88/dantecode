// ============================================================================
// @dantecode/cli — DanteReview command
// Automated PR review pipeline using DanteForge PDSE + constitutional scoring.
// ============================================================================

import { GitHubClient } from "@dantecode/core";
import type { GitHubIssue, PRFile } from "@dantecode/core";
import { parseDiffHunks } from "@dantecode/git-engine";
import { runDanteForge } from "../danteforge-pipeline.js";

// ────────────────────────────────────────────────────────
// ANSI helpers
// ────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export interface FileReview {
  path: string;
  pdseScore: number;
  findings: string[];
  stubViolation: boolean;
  constitutionViolation: boolean;
}

export interface BugFinding {
  file: string;
  line: number;
  description: string;
  severity: "critical" | "warning";
}

export interface ReviewResult {
  prNumber: number;
  overallScore: number;
  fileReviews: FileReview[];
  bugs: BugFinding[];
  stubViolations: number;
  summary: string;
  recommendation: "approve" | "request-changes" | "comment";
  postedToGitHub: boolean;
}

export interface ReviewOptions {
  postComments?: boolean;
  severity?: "strict" | "normal" | "lenient";
  token?: string;
  verbose?: boolean;
}

// ────────────────────────────────────────────────────────
// Lazy client cache (per projectRoot + token prefix)
// ────────────────────────────────────────────────────────

const _clientCache = new Map<string, GitHubClient>();

async function getGitHubClient(
  projectRoot: string,
  token?: string,
): Promise<GitHubClient> {
  const resolvedToken =
    token ??
    process.env["GITHUB_TOKEN"] ??
    process.env["GH_TOKEN"] ??
    "";
  const cacheKey = `${projectRoot}:${resolvedToken.slice(0, 8)}`;
  const cached = _clientCache.get(cacheKey);
  if (cached) return cached;
  const client = new GitHubClient({ token: resolvedToken });
  await client.inferFromGitRemote(projectRoot);
  _clientCache.set(cacheKey, client);
  return client;
}

// ────────────────────────────────────────────────────────
// PDSE score computation
// ────────────────────────────────────────────────────────

/**
 * Compute PDSE score from DanteForge result.
 * Pass → 90; fail → 60 minus violation penalty (min 10), giving continuous 10-60 range.
 */
function computePdseScore(passed: boolean, summary: string): number {
  if (passed) return 90;
  const clean = summary.replace(/\x1b\[[0-9;]*m/g, "");
  const criticals = (clean.match(/FAILED|VIOLATION|STUB|CONSTITUTION/gi) ?? []).length;
  const warnings = (clean.match(/WARNING|WARN|TODO|FIXME/gi) ?? []).length;
  return Math.max(10, 60 - criticals * 10 - warnings * 3);
}

// ────────────────────────────────────────────────────────
// Core review logic
// ────────────────────────────────────────────────────────

/**
 * Review a GitHub PR using DanteForge verification.
 * Analyzes each changed file's patch for stub violations, constitution failures,
 * and PDSE quality, then optionally posts the review to GitHub.
 */
export async function reviewPR(
  prNumber: number,
  projectRoot: string,
  options: ReviewOptions = {},
): Promise<ReviewResult> {
  const gh = await getGitHubClient(projectRoot, options.token);

  // 1. Fetch PR file list
  const files = await gh.listPRFiles(prNumber);
  const reviewableFiles = files.filter(
    (f): f is PRFile & { patch: string } =>
      typeof f.patch === "string" && f.patch.trim().length > 0,
  );

  // 2. Run DanteForge on each file patch
  const fileReviews: FileReview[] = [];
  const bugs: BugFinding[] = [];
  let stubViolations = 0;

  for (const file of reviewableFiles) {
    // Extract only added lines from the patch (lines starting with "+", not "+++")
    const addedLines = file.patch
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      .join("\n");

    if (!addedLines.trim()) continue;

    const { passed, summary } = await runDanteForge(
      addedLines,
      file.filename,
      projectRoot,
      options.verbose ?? false,
    );

    const pdseScore = computePdseScore(passed, summary);

    // Strip ANSI escape codes and split into findings
    const findings = summary
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const stubViolation = summary.includes("Anti-stub scan: FAILED");
    const constitutionViolation = summary.includes("Constitution check: FAILED");

    if (stubViolation) stubViolations++;

    // Parse hunk for line numbers
    if (!passed) {
      const hunks = parseDiffHunks(file.patch);
      const line = hunks[0]?.newStart ?? 1;
      const desc =
        findings.find((f) => f.includes("FAILED")) ??
        "DanteForge quality gate failed";
      bugs.push({
        file: file.filename,
        line,
        description: desc,
        severity: constitutionViolation ? "critical" : "warning",
      });
    }

    fileReviews.push({
      path: file.filename,
      pdseScore,
      findings,
      stubViolation,
      constitutionViolation,
    });
  }

  // 3. Aggregate score
  const overallScore =
    fileReviews.length > 0
      ? Math.round(
          fileReviews.reduce((s, f) => s + f.pdseScore, 0) /
            fileReviews.length,
        )
      : 100;

  // 4. Determine recommendation (severity-aware thresholds)
  const approveThreshold =
    options.severity === "strict"
      ? 90
      : options.severity === "lenient"
        ? 70
        : 80;
  const commentThreshold =
    options.severity === "strict"
      ? 70
      : options.severity === "lenient"
        ? 50
        : 60;

  const recommendation: ReviewResult["recommendation"] =
    overallScore >= approveThreshold
      ? "approve"
      : overallScore >= commentThreshold
        ? "comment"
        : "request-changes";

  // 5. Build summary
  const summary = formatReviewSummary(
    prNumber,
    fileReviews,
    bugs,
    overallScore,
    recommendation,
  );

  // 6. Post to GitHub if requested
  let postedToGitHub = false;
  if (options.postComments) {
    const event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" =
      recommendation === "approve"
        ? "APPROVE"
        : recommendation === "request-changes"
          ? "REQUEST_CHANGES"
          : "COMMENT";

    const reviewComments = bugs
      .filter((b) => b.severity === "critical")
      .map((b) => ({ path: b.file, line: b.line, body: b.description }));

    await gh.createReview(prNumber, {
      event,
      body: summary,
      comments: reviewComments,
    });
    postedToGitHub = true;
  }

  return {
    prNumber,
    overallScore,
    fileReviews,
    bugs,
    stubViolations,
    summary,
    recommendation,
    postedToGitHub,
  };
}

// ────────────────────────────────────────────────────────
// Formatters
// ────────────────────────────────────────────────────────

/** Markdown summary for GitHub PR review body. */
export function formatReviewSummary(
  prNumber: number,
  fileReviews: FileReview[],
  bugs: BugFinding[],
  overallScore: number,
  recommendation: ReviewResult["recommendation"],
): string {
  const lines: string[] = [
    `## DanteCode Review — PR #${prNumber}`,
    ``,
    `**Overall PDSE Score:** ${overallScore}/100`,
    `**Recommendation:** ${recommendation.toUpperCase()}`,
    ``,
  ];

  if (fileReviews.length > 0) {
    lines.push(`### Files Reviewed (${fileReviews.length})`);
    for (const fr of fileReviews) {
      const icon = fr.pdseScore >= 80 ? "PASS" : "FAIL";
      const extras: string[] = [];
      if (fr.stubViolation) extras.push("STUB-VIOLATION");
      if (fr.constitutionViolation) extras.push("CONSTITUTION-FAIL");
      lines.push(
        `- **${fr.path}** [${icon}] score=${fr.pdseScore}${extras.length > 0 ? ` — ${extras.join(", ")}` : ""}`,
      );
    }
    lines.push(``);
  }

  if (bugs.length > 0) {
    lines.push(`### Findings (${bugs.length})`);
    for (const b of bugs) {
      lines.push(
        `- **${b.severity.toUpperCase()}** \`${b.file}:${b.line}\` — ${b.description}`,
      );
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Generated by DanteCode DanteReview — DanteForge PDSE + Constitutional Verification*`);

  return lines.join("\n");
}

/** ANSI-colored CLI output for the review result. */
export function formatReviewOutput(result: ReviewResult): string {
  const recColor =
    result.recommendation === "approve"
      ? GREEN
      : result.recommendation === "comment"
        ? YELLOW
        : RED;

  const lines: string[] = [
    ``,
    `${BOLD}DanteCode Review — PR #${result.prNumber}${RESET}`,
    `  Score:           ${CYAN}${result.overallScore}/100${RESET}`,
    `  Recommendation:  ${recColor}${BOLD}${result.recommendation.toUpperCase()}${RESET}`,
    `  Files reviewed:  ${result.fileReviews.length}`,
    `  Bugs found:      ${result.bugs.length}`,
    `  Stub violations: ${result.stubViolations}`,
  ];

  if (result.fileReviews.length > 0) {
    lines.push(``, `${BOLD}File Reviews:${RESET}`);
    for (const fr of result.fileReviews) {
      const icon = fr.pdseScore >= 80 ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
      const extras =
        fr.stubViolation ? ` ${RED}[STUB]${RESET}` :
        fr.constitutionViolation ? ` ${RED}[CONST]${RESET}` : "";
      lines.push(`  ${icon} ${CYAN}${fr.path}${RESET} (${fr.pdseScore}/100)${extras}`);
    }
  }

  if (result.bugs.length > 0) {
    lines.push(``, `${BOLD}Findings:${RESET}`);
    for (const b of result.bugs) {
      const sev = b.severity === "critical" ? `${RED}CRITICAL${RESET}` : `${YELLOW}WARNING${RESET}`;
      lines.push(`  ${sev} ${CYAN}${b.file}:${b.line}${RESET} — ${b.description.slice(0, 100)}`);
    }
  }

  if (result.postedToGitHub) {
    lines.push(``, `${GREEN}Review posted to GitHub.${RESET}`);
  } else {
    lines.push(``, `${DIM}Use --post to submit review to GitHub.${RESET}`);
  }

  return lines.join("\n");
}

// ────────────────────────────────────────────────────────
// CLI entry point
// ────────────────────────────────────────────────────────

function printReviewHelp(): void {
  console.log(
    [
      ``,
      `${BOLD}dantecode review${RESET} — DanteForge-powered PR review`,
      ``,
      `  ${CYAN}dantecode review <PR#>${RESET}`,
      `      Analyze the PR without posting to GitHub`,
      ``,
      `  ${CYAN}dantecode review <PR#> --post${RESET}`,
      `      Analyze and post the review to GitHub`,
      ``,
      `  ${CYAN}dantecode review <PR#> --severity=strict|normal|lenient${RESET}`,
      `      Adjust scoring thresholds (default: normal)`,
      ``,
      `  ${CYAN}dantecode review <PR#> --verbose${RESET}`,
      `      Show detailed per-violation output`,
      ``,
      `  ${CYAN}dantecode review <PR#> --json${RESET}`,
      `      Output result as JSON`,
      ``,
      `  Requires ${CYAN}GITHUB_TOKEN${RESET} environment variable.`,
      ``,
    ].join("\n"),
  );
}

export async function runReviewCommand(
  args: string[],
  projectRoot: string,
): Promise<void> {
  const sub = args[0];

  if (!sub || sub === "--help" || sub === "-h") {
    printReviewHelp();
    return;
  }

  const prNumber = parseInt(sub, 10);
  if (isNaN(prNumber) || prNumber <= 0) {
    console.error(
      `${RED}Error: PR number must be a positive integer, got: "${sub}"${RESET}`,
    );
    console.error(`${DIM}Usage: dantecode review <PR#> [--post] [--severity=normal]${RESET}`);
    return;
  }

  const postComments = args.includes("--post");
  const jsonOutput = args.includes("--json");
  const severityArg = args.find((a) => a.startsWith("--severity="));
  const severity = (
    severityArg?.split("=")[1] ?? "normal"
  ) as ReviewOptions["severity"];
  const verbose = args.includes("--verbose") || args.includes("-v");

  console.log(`\n${DIM}Fetching PR #${prNumber} files...${RESET}`);

  try {
    const result = await reviewPR(prNumber, projectRoot, {
      postComments,
      severity,
      verbose,
    });
    if (jsonOutput) {
      console.log(
        JSON.stringify({
          prNumber: result.prNumber,
          overallScore: result.overallScore,
          recommendation: result.recommendation,
          bugs: result.bugs.length,
          stubViolations: result.stubViolations,
          postedToGitHub: result.postedToGitHub,
        }),
      );
    } else {
      console.log(formatReviewOutput(result));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}Review error: ${msg}${RESET}`);
  }
}

// Suppress unused import warning — GitHubIssue re-exported for consumer use
export type { GitHubIssue };
