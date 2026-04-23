import { execFileSync } from "node:child_process";
import {
  PrReviewOrchestrator,
  buildChangeImpact,
  classifyChangedFiles,
  buildReviewComment,
  generateReviewSummary,
  type ReviewCategory,
  type ReviewCommentType,
  type ReviewComment,
} from "./pr-review-orchestrator.js";
import { detectReviewAnnotations } from "./pr-automation.js";

export interface PullRequestMeta {
  title: string;
  additions: number;
  deletions: number;
  files: string[];
  url: string;
}

export interface PullRequestReviewOptions {
  prNumber: number;
  repo?: string;
  maxDiffChars?: number;
}

export interface PullRequestReviewResult {
  prNumber: number;
  verdict: string;
  score: number;
  summary: string;
  checklistPassed: number;
  checklistTotal: number;
  rawPrompt: string;
  comments: ReviewComment[];
}

interface ParsedPatchFile {
  filePath: string;
  patchLines: string[];
}

const ANNOTATION_TO_COMMENT_TYPE: Record<"error" | "warning" | "suggestion", ReviewCommentType> = {
  error: "blocking",
  warning: "suggestion",
  suggestion: "suggestion",
};

function parsePatchFiles(diff: string): ParsedPatchFile[] {
  const files: ParsedPatchFile[] = [];
  let current: ParsedPatchFile | null = null;

  for (const line of diff.split("\n")) {
    const fileMatch = line.match(/^\+\+\+\s+b\/(.+)$/);
    if (fileMatch) {
      current = { filePath: fileMatch[1]!, patchLines: [] };
      files.push(current);
      continue;
    }

    if (current) {
      current.patchLines.push(line);
    }
  }

  return files;
}

export function fetchPrDiff(prNumber: number, repo?: string, maxChars = 32_000): string {
  const args = ["pr", "diff", String(prNumber), "--patch"];
  if (repo) args.push("--repo", repo);

  try {
    const raw = execFileSync("gh", args, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return raw.length > maxChars ? raw.slice(0, maxChars) : raw;
  } catch {
    return "";
  }
}

export function fetchPrMeta(prNumber: number, repo?: string): PullRequestMeta {
  const args = [
    "pr", "view", String(prNumber),
    "--json", "title,additions,deletions,files,url",
  ];
  if (repo) args.push("--repo", repo);

  try {
    const raw = execFileSync("gh", args, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const parsed = JSON.parse(raw) as {
      title?: string;
      additions?: number;
      deletions?: number;
      files?: Array<{ path: string }>;
      url?: string;
    };
    return {
      title: parsed.title ?? `PR #${prNumber}`,
      additions: parsed.additions ?? 0,
      deletions: parsed.deletions ?? 0,
      files: (parsed.files ?? []).map((f) => f.path),
      url: parsed.url ?? "",
    };
  } catch {
    return { title: `PR #${prNumber}`, additions: 0, deletions: 0, files: [], url: "" };
  }
}

export async function reviewPullRequest(
  opts: PullRequestReviewOptions,
): Promise<PullRequestReviewResult> {
  const { prNumber, repo, maxDiffChars } = opts;
  const meta = fetchPrMeta(prNumber, repo);
  const diff = fetchPrDiff(prNumber, repo, maxDiffChars);

  const { touchesPublicApi, hasTestChanges, hasMigrations, touchesSecurityCode } =
    classifyChangedFiles(meta.files);

  void buildChangeImpact(meta.files, meta.additions, meta.deletions);
  void touchesPublicApi;
  void hasMigrations;

  const orchestrator = new PrReviewOrchestrator();
  const review = orchestrator.createReview(
    meta.title,
    meta.files,
    meta.additions,
    meta.deletions,
    meta.url,
  );

  if (touchesSecurityCode && meta.files.length > 0) {
    orchestrator.addComment(
      review.id,
      buildReviewComment(
        "blocking",
        "security",
        "This PR touches security-sensitive files. Ensure credentials are not hardcoded and all inputs are validated.",
        { filePath: meta.files.find((f) => /auth|token|password|secret/i.test(f)) },
      ),
    );
  }

  if (!hasTestChanges && meta.files.length > 0) {
    orchestrator.addComment(
      review.id,
      buildReviewComment(
        "suggestion",
        "tests",
        "No test files were modified. Consider adding or updating tests for the changed code.",
      ),
    );
  }

  for (const file of parsePatchFiles(diff)) {
    for (const annotation of detectReviewAnnotations(file.filePath, file.patchLines).slice(0, 3)) {
      orchestrator.addComment(
        review.id,
        buildReviewComment(
          ANNOTATION_TO_COMMENT_TYPE[annotation.severity],
          annotation.category as ReviewCategory,
          annotation.comment,
          { filePath: annotation.file, line: annotation.line },
        ),
      );
    }
  }

  const finalReview = orchestrator.getReview(review.id)!;
  const checklistPassed = finalReview.checklist.filter((c) => c.passed === true).length;
  const checklistTotal = finalReview.checklist.length;

  const diffEvidence = diff
    ? `\n\n## PR Diff Evidence\n\n\`\`\`diff\n${diff.slice(0, maxDiffChars ?? 32_000)}\n\`\`\``
    : "\n\n## PR Diff Evidence\n\nGitHub CLI diff was unavailable for this review.";

  return {
    prNumber,
    verdict: finalReview.verdict,
    score: finalReview.score.overall,
    summary: generateReviewSummary(finalReview),
    checklistPassed,
    checklistTotal,
    rawPrompt: `${orchestrator.formatForPrompt(review.id)}${diffEvidence}`,
    comments: finalReview.comments,
  };
}
