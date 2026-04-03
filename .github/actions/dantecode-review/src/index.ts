// ============================================================================
// DanteCode PR Review — GitHub Action entrypoint
// ============================================================================

import * as core from "@actions/core";
import * as github from "@actions/github";

// Note: @dantecode/cli is a workspace dependency — bundled by ncc at build time
type ReviewResult = {
  prNumber: number;
  overallScore: number;
  fileReviews: Array<{ path: string; pdseScore: number; stubViolation: boolean }>;
  bugs: Array<{ file: string; line: number; description: string; severity: string }>;
  stubViolations: number;
  summary: string;
  recommendation: "approve" | "request-changes" | "comment";
  postedToGitHub: boolean;
};

async function run(): Promise<void> {
  const githubToken = core.getInput("github-token", { required: true });
  const severity = (core.getInput("severity") || "normal") as "strict" | "normal" | "lenient";
  const postComments = core.getInput("post-comments") !== "false";
  const failBelow = parseInt(core.getInput("fail-below") || "60", 10);

  const context = github.context;
  const prNumber =
    context.payload.pull_request?.number ??
    (context.payload.number as number | undefined);

  if (!prNumber) {
    core.setFailed("Could not determine PR number from event context.");
    return;
  }

  core.info(`Running DanteCode review on PR #${prNumber}...`);

  let result: ReviewResult;
  try {
    // Dynamic import allows ncc to bundle @dantecode/cli correctly
    const { reviewPR } = await import("@dantecode/cli/commands/review");
    result = await (reviewPR as (...args: unknown[]) => Promise<ReviewResult>)(
      prNumber,
      process.cwd(),
      {
        postComments,
        severity,
        token: githubToken,
        verbose: core.isDebug(),
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    core.debug(`Stack: ${err instanceof Error ? (err.stack ?? "") : ""}`);
    core.setFailed(`DanteCode review failed: ${msg}`);
    return;
  }

  // Set outputs
  core.setOutput("pdse-score", result.overallScore.toString());
  core.setOutput("recommendation", result.recommendation);
  core.setOutput("bug-count", result.bugs.length.toString());
  core.setOutput("stub-violations", result.stubViolations.toString());
  core.setOutput("posted", result.postedToGitHub.toString());

  // Write job summary
  try {
    await core.summary.addRaw(result.summary).write();
  } catch {
    // Summary is best-effort
  }

  if (result.overallScore < failBelow) {
    core.setFailed(
      `DanteCode review score ${result.overallScore} is below threshold ${failBelow}. Recommendation: ${result.recommendation}.`,
    );
  } else {
    core.info(
      `DanteCode review complete. Score: ${result.overallScore}/100. Recommendation: ${result.recommendation}.`,
    );
  }
}

// Allow tests to import without running
if (!process.env["VITEST"]) {
  run().catch((err: unknown) => {
    core.setFailed(err instanceof Error ? err.message : String(err));
  });
}

export { run };
