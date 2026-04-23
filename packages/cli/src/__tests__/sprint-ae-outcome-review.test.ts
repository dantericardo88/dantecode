// ============================================================================
// Sprint AE — Dims 15+18: OutcomeAwareRetry + ReviewActionability
// Tests that:
//  - lookupRecentFailureModes returns empty when no log
//  - lookupRecentFailureModes finds failure modes for similar task
//  - lookupRecentFailureModes ignores dissimilar tasks
//  - lookupRecentFailureModes antiPatternPrompt includes failure modes
//  - scoreReviewActionability gives high score for comment with line+suggestion
//  - scoreReviewActionability gives low score for vague comment
//  - filterLowActionabilityComments removes low-score comments
//  - filterLowActionabilityComments keeps high-score comments
// ============================================================================

import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  lookupRecentFailureModes,
  scoreReviewActionability,
  filterLowActionabilityComments,
  buildReviewComment,
} from "@dantecode/core";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-ae-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function seedOutcomes(dir: string, entries: object[]): void {
  mkdirSync(join(dir, ".danteforge"), { recursive: true });
  writeFileSync(
    join(dir, ".danteforge", "task-outcomes.json"),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf-8",
  );
}

// ─── Part 1: lookupRecentFailureModes ────────────────────────────────────────

describe("lookupRecentFailureModes — Sprint AE (dim 15)", () => {
  // 1. Returns empty context when no log exists
  it("returns empty failureModes when task-outcomes.json does not exist", () => {
    const dir = makeDir();
    const ctx = lookupRecentFailureModes("add auth module", dir);
    expect(ctx.failureModes).toEqual([]);
    expect(ctx.antiPatternPrompt).toBe("");
  });

  // 2. Finds failure modes for a similar task
  it("returns failure modes for a similar task description", () => {
    const dir = makeDir();
    seedOutcomes(dir, [
      { timestamp: "t", taskId: "t1", description: "add authentication module with jwt", status: "failure", durationMs: 5000, toolCallCount: 10, iterationCount: 1, failureMode: "typecheck" },
    ]);
    const ctx = lookupRecentFailureModes("add authentication module jwt", dir);
    expect(ctx.failureModes).toContain("typecheck");
  });

  // 3. Ignores dissimilar tasks
  it("ignores tasks with dissimilar descriptions", () => {
    const dir = makeDir();
    seedOutcomes(dir, [
      { timestamp: "t", taskId: "t1", description: "rewrite database migrations completely", status: "failure", durationMs: 5000, toolCallCount: 5, iterationCount: 1, failureMode: "timeout" },
    ]);
    const ctx = lookupRecentFailureModes("add authentication module jwt", dir, { similarityThreshold: 0.5 });
    expect(ctx.failureModes).toEqual([]);
  });

  // 4. antiPatternPrompt includes failure mode names
  it("antiPatternPrompt includes the failure mode names", () => {
    const dir = makeDir();
    seedOutcomes(dir, [
      { timestamp: "t", taskId: "t1", description: "refactor user module auth", status: "failure", durationMs: 5000, toolCallCount: 5, iterationCount: 1, failureMode: "type_error" },
    ]);
    const ctx = lookupRecentFailureModes("refactor user module", dir);
    expect(ctx.antiPatternPrompt).toContain("type_error");
  });

  // 5. successRate 1.0 when all similar tasks succeeded
  it("successRate is 1.0 when similar tasks all succeeded", () => {
    const dir = makeDir();
    seedOutcomes(dir, [
      { timestamp: "t", taskId: "t1", description: "add unit tests for auth module", status: "success", durationMs: 3000, toolCallCount: 5, iterationCount: 1 },
    ]);
    const ctx = lookupRecentFailureModes("add unit tests for auth module", dir);
    expect(ctx.successRate).toBe(1);
  });
});

// ─── Part 2: scoreReviewActionability / filterLowActionabilityComments ────────

describe("scoreReviewActionability + filterLowActionabilityComments — Sprint AE (dim 18)", () => {
  // 6. High-score comment with line reference + code suggestion
  it("scoreReviewActionability gives high score (>= 0.7) for comment with line ref + code suggestion", () => {
    const comment = buildReviewComment(
      "blocking",
      "security",
      "Consider replacing `eval()` with `JSON.parse()` here — eval is dangerous",
      { filePath: "src/parser.ts", line: 42 },
    );
    const score = scoreReviewActionability(comment);
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  // 7. Low score for vague comment
  it("scoreReviewActionability gives low score (< 0.4) for very short vague comment", () => {
    const comment = buildReviewComment("nitpick", "style", "fix this");
    const score = scoreReviewActionability(comment);
    expect(score).toBeLessThan(0.4);
  });

  // 8. filterLowActionabilityComments removes vague, keeps specific
  it("filterLowActionabilityComments removes low-actionability, keeps high-actionability", () => {
    const good = buildReviewComment(
      "blocking",
      "logic",
      "Use `const` instead of `let` for the `userId` variable at line 12 — it is never reassigned",
      { filePath: "src/auth.ts", line: 12 },
    );
    const bad = buildReviewComment("nitpick", "style", "ok");
    const filtered = filterLowActionabilityComments([good, bad], 0.4);
    expect(filtered).toContainEqual(good);
    expect(filtered).not.toContainEqual(bad);
  });

  // 9. All high-actionability comments pass threshold
  it("all good comments pass default threshold of 0.4", () => {
    const comments = [
      buildReviewComment("suggestion", "security", "Validate the `redirectUrl` parameter against an allowlist before calling `res.redirect()`", { filePath: "routes.ts", line: 88 }),
      buildReviewComment("blocking", "security", "The `findById(req.params.id)` call has no authorization check — verify ownership first", { filePath: "user.ts", line: 55 }),
    ];
    const filtered = filterLowActionabilityComments(comments);
    expect(filtered).toHaveLength(2);
  });
});
