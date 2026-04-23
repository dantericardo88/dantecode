// ============================================================================
// Sprint P — Dims 18+15: PR review wired to stored artifacts + failure classification
// Tests that:
//  - generateLLMReview prompt includes past review comment patterns when projectRoot given
//  - past comments section omitted when no review-comments.json exists
//  - works without projectRoot (backward compat)
//  - past comments limited to last 10 entries
//  - classifyAgentFailure correctly identifies TypeScript errors
//  - classifyAgentFailure identifies test assertion failures
//  - classifyAgentFailure identifies import errors
//  - classifyAgentFailure identifies compile errors
//  - classifyAgentFailure identifies timeouts
//  - buildFailureModeHint returns targeted message per mode
//  - buildFailureModeHint covers all known modes without throwing
// ============================================================================

import { describe, it, expect } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { classifyAgentFailure, buildFailureModeHint } from "../swe-bench-runner.js";
import { PrReviewOrchestrator } from "@dantecode/core";

// ─── Part 1: PR review wired to stored artifacts (dim 18) ────────────────────

describe("generateLLMReview past context injection — Sprint P (dim 18)", () => {
  // 1. Prompt includes past comments when review-comments.json exists
  it("prompt includes past review comment patterns when projectRoot has review-comments.json", async () => {
    const projectRoot = join(tmpdir(), `test-pr-${randomUUID()}`);
    await mkdir(join(projectRoot, ".danteforge"), { recursive: true });
    const pastComments = [
      { file: "src/auth.ts", comment: "Verify JWT expiry handling", timestamp: "2026-04-01T00:00:00Z", commitSha: "abc123" },
      { file: "src/api.ts", comment: "Check for SQL injection risk", timestamp: "2026-04-02T00:00:00Z", commitSha: "def456" },
    ];
    await writeFile(
      join(projectRoot, ".danteforge", "review-comments.json"),
      JSON.stringify(pastComments),
      "utf-8",
    );

    const orchestrator = new PrReviewOrchestrator();
    const review = orchestrator.createReview("test PR", ["src/auth.ts"], 10, 2);

    let capturedPrompt = "";
    await orchestrator.generateLLMReview(
      review.id,
      "diff --git a/src/auth.ts\n+ some code",
      async (prompt: string) => { capturedPrompt = prompt; return "OK"; },
      projectRoot,
    );

    expect(capturedPrompt).toContain("Past review patterns");
    expect(capturedPrompt).toContain("Verify JWT expiry handling");
    expect(capturedPrompt).toContain("Check for SQL injection risk");
  });

  // 2. Prompt omits past section when no review-comments.json
  it("prompt omits past patterns section when no review-comments.json exists", async () => {
    const projectRoot = join(tmpdir(), `test-pr-${randomUUID()}`);
    await mkdir(projectRoot, { recursive: true });

    const orchestrator = new PrReviewOrchestrator();
    const review = orchestrator.createReview("clean PR", ["b.ts"], 5, 0);

    let capturedPrompt = "";
    await orchestrator.generateLLMReview(
      review.id,
      "diff --git a/b.ts\n+ code",
      async (prompt: string) => { capturedPrompt = prompt; return "OK"; },
      projectRoot,
    );

    expect(capturedPrompt).not.toContain("Past review patterns");
  });

  // 3. Works without projectRoot (backward compat)
  it("generateLLMReview works without projectRoot parameter (no past context)", async () => {
    const orchestrator = new PrReviewOrchestrator();
    const review = orchestrator.createReview("compat PR", ["c.ts"], 3, 1);
    const result = await orchestrator.generateLLMReview(
      review.id,
      "diff text",
      async (_prompt: string) => "analysis result",
    );
    expect(result).toBe("analysis result");
  });

  // 4. Past comments limited to last 10 entries
  it("injects at most 10 past comments into prompt", async () => {
    const projectRoot = join(tmpdir(), `test-pr-${randomUUID()}`);
    await mkdir(join(projectRoot, ".danteforge"), { recursive: true });
    const comments = Array.from({ length: 15 }, (_, i) => ({
      file: `src/file${i}.ts`, comment: `comment ${i}`, timestamp: "", commitSha: "",
    }));
    await writeFile(join(projectRoot, ".danteforge", "review-comments.json"), JSON.stringify(comments), "utf-8");

    const orchestrator = new PrReviewOrchestrator();
    const review = orchestrator.createReview("limit PR", ["d.ts"], 1, 0);
    let capturedPrompt = "";
    await orchestrator.generateLLMReview(
      review.id, "diff", async (p: string) => { capturedPrompt = p; return "ok"; }, projectRoot,
    );
    const occurrences = (capturedPrompt.match(/src\/file/g) ?? []).length;
    expect(occurrences).toBeLessThanOrEqual(10);
  });
});

// ─── Part 2: Outcome-aware recovery with failure classification (dim 15) ──────

describe("classifyAgentFailure + buildFailureModeHint — Sprint P (dim 15)", () => {
  // 5. TypeScript error detection
  it("classifies TypeScript type error output correctly", () => {
    const output = "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'";
    expect(classifyAgentFailure(output)).toBe("type_error");
  });

  // 6. Test assertion failure
  it("classifies jest/vitest assertion failure output", () => {
    const output = "● my-test › should pass\n  AssertionError: expected 5 to equal 6";
    expect(classifyAgentFailure(output)).toBe("test_assertion");
  });

  // 7. Import/module error
  it("classifies module not found error", () => {
    const output = "Error: Cannot find module './missing-file'";
    expect(classifyAgentFailure(output)).toBe("import_error");
  });

  // 8. Compile/syntax error
  it("classifies syntax error in output", () => {
    const output = "SyntaxError: Unexpected token ')'";
    expect(classifyAgentFailure(output)).toBe("compile_error");
  });

  // 9. Timeout
  it("classifies timeout output", () => {
    const output = "Error: Timeout - Async function exceeded timeout of 5000ms";
    expect(classifyAgentFailure(output)).toBe("timeout");
  });

  // 10. Empty output
  it("classifies empty output as no_output", () => {
    expect(classifyAgentFailure("")).toBe("no_output");
    expect(classifyAgentFailure("   \n  ")).toBe("no_output");
  });

  // 11. buildFailureModeHint returns targeted message
  it("buildFailureModeHint for type_error contains TypeScript guidance", () => {
    const hint = buildFailureModeHint("type_error");
    expect(hint).toContain("TypeScript");
    expect(hint).toContain("Recovery hint");
  });

  // 12. buildFailureModeHint covers all known modes
  it("buildFailureModeHint returns a non-empty string for every mode", () => {
    const modes = ["type_error", "test_assertion", "import_error", "compile_error", "timeout", "lint_error", "runtime_error", "no_output", "unknown"] as const;
    for (const mode of modes) {
      const hint = buildFailureModeHint(mode);
      expect(hint.length).toBeGreaterThan(10);
      expect(hint).toContain("[Recovery hint");
    }
  });
});
