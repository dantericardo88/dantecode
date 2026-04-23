// ============================================================================
// packages/cli/src/commands/review.ts
//
// Sprint 14 / Wave 1 — Dim 18: PR review automation wiring.
// The CLI now delegates to the shared core review runner so the terminal and
// VS Code sidebar use the same real GitHub-backed review path.
// ============================================================================

import {
  fetchPrDiff,
  fetchPrMeta,
  reviewPullRequest,
  trackReviewOutcome,
  PrReviewOrchestrator,
  buildReviewSummary,
  parseArchitectIssues,
  architectToReviewComments,
  type ReviewOutcomeEntry,
} from "@dantecode/core";
import { resolve, join } from "node:path";
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";

export interface ReviewCommandOptions {
  prNumber: number;
  repo?: string;
  json?: boolean;
  maxDiffChars?: number;
}

export type ReviewCommandResult = Awaited<ReturnType<typeof reviewPullRequest>>;

export async function cmdReview(opts: ReviewCommandOptions): Promise<ReviewCommandResult> {
  const result = await reviewPullRequest(opts);
  // Sprint CG — Dim 18: second-pass architectural analysis of review output
  try {
    const analysisText = result.summary + (result.rawPrompt ?? "");
    const architectIssues = parseArchitectIssues(analysisText);
    if (architectIssues.length > 0) {
      const architectComments = architectToReviewComments({
        issues: architectIssues,
        rawPlanText: result.summary,
        filesReviewed: [],
        issueCount: architectIssues.length,
        timestamp: new Date().toISOString(),
      });
      const blocking = architectComments.filter((c) => c.type === "blocking");
      if (blocking.length > 0) {
        process.stdout.write(
          `\n[architect-review] ${blocking.length} blocking architectural issue(s) detected:\n` +
          blocking.map((c) => `  • ${c.body}`).join("\n") + "\n",
        );
      }
    }
  } catch { /* non-fatal */ }
  try {
    const danteforge = (await import("@dantecode/danteforge")) as unknown as {
      recordReviewOutcome: (
        input: {
          prNumber: number;
          repo?: string;
          verdict: string;
          score: number;
          summary: string;
          checklistPassed: number;
          checklistTotal: number;
          comments: Array<{ type: string; category: string; resolved?: boolean }>;
          rawPrompt?: string;
        },
        projectRoot: string,
      ) => Promise<void>;
    };
    await danteforge.recordReviewOutcome(
      {
        prNumber: result.prNumber,
        repo: opts.repo,
        verdict: result.verdict,
        score: result.score,
        summary: result.summary,
        checklistPassed: result.checklistPassed,
        checklistTotal: result.checklistTotal,
        comments: result.comments,
        rawPrompt: result.rawPrompt,
      },
      resolve(process.cwd()),
    );
  } catch {
    // Non-fatal: review persistence should not block the command.
  }
  return result;
}

export { fetchPrDiff, fetchPrMeta };

// ─── review close subcommand (dim 18) ────────────────────────────────────────

export interface ReviewCloseOptions {
  reviewId: string;
  resolved: number;
  total: number;
  prTitle?: string;
  projectRoot?: string;
}

/**
 * Records that a review session is closed, tracking how many comments were
 * resolved. Appends to .danteforge/review-history.json as JSONL.
 * Called via: dantecode review close <reviewId> --resolved <n> --total <m>
 */
export function cmdReviewClose(opts: ReviewCloseOptions): ReviewOutcomeEntry {
  const projectRoot = opts.projectRoot ?? resolve(process.cwd());
  const entry = trackReviewOutcome(opts.reviewId, opts.resolved, opts.total, opts.prTitle, projectRoot);
  process.stdout.write(
    `[review close] ${opts.reviewId}: ${opts.resolved}/${opts.total} resolved (${(entry.resolutionRate * 100).toFixed(0)}%)\n`,
  );
  return entry;
}

// ─── review list + review pr (Sprint AS — dim 18) ────────────────────────────

const REVIEW_COMMENTS_FILE = ".danteforge/review-comments.json";

export interface StoredReviewComment {
  file: string;
  comment: string;
  timestamp: string;
  commitSha?: string;
}

/** Load persisted review comments from .danteforge/review-comments.json */
export function loadReviewComments(projectRoot: string): StoredReviewComment[] {
  const path = join(projectRoot, REVIEW_COMMENTS_FILE);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as StoredReviewComment[];
  } catch { return []; }
}

/** Append a review comment to .danteforge/review-comments.json (array format). */
export function appendReviewComment(comment: StoredReviewComment, projectRoot: string): void {
  const dir = join(projectRoot, ".danteforge");
  mkdirSync(dir, { recursive: true });
  const path = join(projectRoot, REVIEW_COMMENTS_FILE);
  const existing = loadReviewComments(projectRoot);
  existing.push(comment);
  appendFileSync(path, "", "utf-8"); // ensure file exists
  const { writeFileSync } = require("node:fs") as typeof import("node:fs");
  writeFileSync(path, JSON.stringify(existing, null, 2), "utf-8");
}

/**
 * Run the `dantecode review` CLI subcommand.
 * Subcommands:
 *   review list           — print stored review comments
 *   review pr <number>    — run LLM review on a PR and persist comments
 */
export async function runReviewCommand(subArgs: string[], projectRoot: string): Promise<void> {
  const sub = subArgs[0] ?? "list";

  if (sub === "list") {
    const comments = loadReviewComments(projectRoot);
    if (comments.length === 0) {
      process.stdout.write("[review list] No stored review comments.\n");
      return;
    }
    for (const c of comments) {
      process.stdout.write(`[${c.timestamp}] ${c.file}: ${c.comment}\n`);
    }
    return;
  }

  if (sub === "pr") {
    const prNum = parseInt(subArgs[1] ?? "", 10);
    if (Number.isNaN(prNum)) {
      process.stderr.write("Usage: dantecode review pr <number>\n");
      return;
    }

    // Fetch PR diff
    let diff = "";
    try {
      diff = fetchPrDiff(prNum);
    } catch (e) {
      process.stderr.write(`[review pr] Could not fetch diff: ${e instanceof Error ? e.message : String(e)}\n`);
      return;
    }

    // Use PrReviewOrchestrator to call generateLLMReview with real Anthropic SDK
    const orchestrator = new PrReviewOrchestrator();
    const review = orchestrator.createReview(`PR #${prNum}`, [], 0, 0, `#${prNum}`);

    let analysis: string | undefined;
    try {
      type MinimalAnthropicClient = { messages: { create: (opts: unknown) => Promise<{ content: Array<{ type: string; text: string }> }> } };
      type AnthropicSdkModule = { default: new () => MinimalAnthropicClient };
      const sdkMod = (await import("@anthropic-ai/sdk" as string)) as AnthropicSdkModule;
      const client: MinimalAnthropicClient = new sdkMod.default();
      const llmFn = async (prompt: string): Promise<string> => {
        const msg = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        });
        const block = msg.content[0];
        return block && block.type === "text" ? block.text : "";
      };
      analysis = await orchestrator.generateLLMReview(review.id, diff, llmFn, projectRoot);
    } catch (e) {
      process.stderr.write(`[review pr] LLM review failed (non-fatal): ${e instanceof Error ? e.message : String(e)}\n`);
    }

    if (analysis) {
      // Build summary from analysis
      const summary = buildReviewSummary(review.comments);
      process.stdout.write(`[review pr] PR #${prNum} analysis:\n${analysis}\n`);
      if (summary.rankedActions.length > 0) {
        process.stdout.write(`[review pr] Ranked actions:\n${summary.rankedActions.slice(0, 5).map((a) => `  • ${a}`).join("\n")}\n`);
      }

      // Persist first line of analysis as a review comment
      const firstLine = analysis.split("\n").find((l) => l.trim().length > 0) ?? analysis.slice(0, 200);
      appendReviewComment(
        { file: `PR #${prNum}`, comment: firstLine, timestamp: new Date().toISOString() },
        projectRoot,
      );
      process.stdout.write(`[review pr] Comment persisted to ${REVIEW_COMMENTS_FILE}\n`);
    } else {
      process.stdout.write(`[review pr] PR #${prNum} reviewed (rule-based only — LLM unavailable)\n`);
    }
  }
}
