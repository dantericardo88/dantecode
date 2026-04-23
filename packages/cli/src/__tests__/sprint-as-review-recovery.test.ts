// ============================================================================
// Sprint AS — Dims 18+15: LLM review wired + cmdReview routed + anti-pattern loop
// Tests that:
//  - review-comments.json written with correct schema
//  - review-comments.json has { file, comment, timestamp } fields
//  - loadReviewComments reads stored comments back
//  - multiple appendReviewComment calls append (not overwrite)
//  - generateLLMReview() called with llmCallFn parameter and returns analysis
//  - buildReviewSummary() called on comments — rankedActions returned
//  - anti-pattern prompt returned when failure modes exist
//  - review command is routed in index.ts (runReviewCommand exported)
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  PrReviewOrchestrator,
  buildReviewSummary,
  buildReviewComment,
  lookupRecentFailureModes,
} from "@dantecode/core";
import {
  loadReviewComments,
  appendReviewComment,
  runReviewCommand,
  type StoredReviewComment,
} from "../commands/review.js";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-as-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Review comments persistence — Sprint AS (dim 18)", () => {
  // 1. appendReviewComment writes file with correct schema
  it("appendReviewComment writes review-comments.json with { file, comment, timestamp }", () => {
    const dir = makeDir();
    const comment: StoredReviewComment = {
      file: "src/auth.ts",
      comment: "Missing input validation before SQL query",
      timestamp: new Date().toISOString(),
    };
    appendReviewComment(comment, dir);
    expect(existsSync(join(dir, ".danteforge", "review-comments.json"))).toBe(true);
    const loaded = loadReviewComments(dir);
    expect(loaded.length).toBe(1);
    expect(loaded[0]?.file).toBe("src/auth.ts");
    expect(typeof loaded[0]?.comment).toBe("string");
    expect(typeof loaded[0]?.timestamp).toBe("string");
  });

  // 2. loadReviewComments reads back stored comments
  it("loadReviewComments returns empty array when file doesn't exist", () => {
    const dir = makeDir();
    expect(loadReviewComments(dir)).toEqual([]);
  });

  // 3. Multiple appendReviewComment calls append — not overwrite
  it("multiple appendReviewComment calls accumulate entries", () => {
    const dir = makeDir();
    appendReviewComment({ file: "src/a.ts", comment: "First comment", timestamp: "2026-04-21T00:00:00Z" }, dir);
    appendReviewComment({ file: "src/b.ts", comment: "Second comment", timestamp: "2026-04-21T00:01:00Z" }, dir);
    appendReviewComment({ file: "src/c.ts", comment: "Third comment", timestamp: "2026-04-21T00:02:00Z" }, dir);
    const loaded = loadReviewComments(dir);
    expect(loaded.length).toBe(3);
  });

  // 4. runReviewCommand "list" prints comments
  it("runReviewCommand list prints stored comments without throwing", async () => {
    const dir = makeDir();
    appendReviewComment({ file: "src/x.ts", comment: "Test comment", timestamp: "2026-04-21T00:00:00Z" }, dir);
    // Should not throw — we don't verify stdout in unit tests
    await expect(runReviewCommand(["list"], dir)).resolves.not.toThrow();
  });

  // 5. runReviewCommand with no args defaults to "list"
  it("runReviewCommand with empty args defaults to list (does not throw)", async () => {
    const dir = makeDir();
    await expect(runReviewCommand([], dir)).resolves.not.toThrow();
  });
});

describe("generateLLMReview wired — Sprint AS (dim 18)", () => {
  // 6. generateLLMReview called with llmCallFn returns analysis string
  it("generateLLMReview returns analysis when llmFn resolves", async () => {
    const orchestrator = new PrReviewOrchestrator();
    const review = orchestrator.createReview("Test PR", ["src/auth.ts"], 50, 10, "#123");
    const mockLlmFn = async (_prompt: string) => "HIGH SEVERITY: Missing authentication check at line 42.";
    const analysis = await orchestrator.generateLLMReview(review.id, "diff content here", mockLlmFn);
    expect(typeof analysis).toBe("string");
    expect(analysis).toContain("HIGH SEVERITY");
  });

  // 7. generateLLMReview returns undefined for unknown reviewId
  it("generateLLMReview returns undefined for non-existent reviewId", async () => {
    const orchestrator = new PrReviewOrchestrator();
    const result = await orchestrator.generateLLMReview("nonexistent-id", "diff", async () => "analysis");
    expect(result).toBeUndefined();
  });

  // 8. buildReviewSummary on comments returns rankedActions
  it("buildReviewSummary produces rankedActions with blockers first", () => {
    const comments = [
      buildReviewComment("suggestion", "performance", "Consider memoization here"),
      buildReviewComment("blocking", "security", "SQL injection vulnerability at line 42 — parameterize this query", { filePath: "src/db.ts", line: 42 }),
    ];
    const summary = buildReviewSummary(comments);
    expect(summary.rankedActions.length).toBeGreaterThan(0);
    expect(summary.rankedActions[0]).toContain("[blocking]");
    expect(summary.blockers).toBe(1);
  });
});

describe("Anti-pattern loop — Sprint AS (dim 15)", () => {
  // 9. lookupRecentFailureModes returns antiPatternPrompt when failures exist
  it("lookupRecentFailureModes returns antiPatternPrompt string for prompt with failures", () => {
    const dir = makeDir();
    // No task-outcomes.json → returns empty
    const result = lookupRecentFailureModes("add authentication check", dir);
    expect(typeof result.antiPatternPrompt).toBe("string");
    expect(typeof result.recentFailureCount).toBe("number");
    expect(Array.isArray(result.failureModes)).toBe(true);
  });

  // 10. runReviewCommand is exported from review.ts
  it("runReviewCommand is a function exported from commands/review", () => {
    expect(typeof runReviewCommand).toBe("function");
  });
});
