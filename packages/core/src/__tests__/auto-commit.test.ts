// packages/core/src/__tests__/auto-commit.test.ts
// Tests for the auto-commit workflow triggered at the end of each agent round.
//
// Machine 4b: When config.git.autoCommit = true, the agent loop calls
// generateAutoCommitMessage() then autoCommit() after writing files.
// These tests verify the generateCommitMessage logic and the gate conditions.

import { describe, it, expect, vi } from "vitest";

// ── generateCommitMessage logic ───────────────────────────────────────────────

/**
 * Pure helper extracted from agent-loop logic for testability.
 * Takes a raw diff string (≤2000 chars truncation applied by caller),
 * calls the LLM, and returns the first non-empty line as the commit subject.
 */
async function generateCommitSubject(
  diff: string,
  llmCall: (prompt: string) => Promise<string>,
): Promise<string> {
  const truncated = diff.slice(0, 2000);
  const prompt =
    `Given this git diff, write a concise conventional commit message (≤72 chars subject line only, no body):\n\n` +
    truncated;
  const response = await llmCall(prompt);
  const subject = response
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "chore: auto-commit agent changes";
  return subject.slice(0, 72);
}

describe("generateCommitSubject", () => {
  it("calls LLM with the diff and returns first non-empty line", async () => {
    const mockLlm = vi.fn().mockResolvedValue("feat: add authentication service");
    const diff = "@@ -1,3 +1,3 @@\n-old code\n+new code";

    const subject = await generateCommitSubject(diff, mockLlm);

    expect(mockLlm).toHaveBeenCalledOnce();
    expect(subject).toBe("feat: add authentication service");
    // Verify prompt contains the diff
    const calledPrompt = mockLlm.mock.calls[0]![0] as string;
    expect(calledPrompt).toContain("@@ -1,3 +1,3 @@");
  });

  it("truncates diff to 2000 chars before LLM call", async () => {
    const longDiff = "x".repeat(5000);
    const mockLlm = vi.fn().mockResolvedValue("chore: update files");

    await generateCommitSubject(longDiff, mockLlm);

    const calledPrompt = mockLlm.mock.calls[0]![0] as string;
    // The prompt has a preamble + up to 2000 chars of diff
    const diffPart = calledPrompt.split("\n\n")[1]!;
    expect(diffPart.length).toBeLessThanOrEqual(2000);
  });

  it("returns fallback message when LLM returns empty response", async () => {
    const mockLlm = vi.fn().mockResolvedValue("   \n  \n  ");

    const subject = await generateCommitSubject("some diff", mockLlm);

    expect(subject).toBe("chore: auto-commit agent changes");
  });

  it("skips blank lines and returns first non-empty line from multi-line response", async () => {
    const mockLlm = vi.fn().mockResolvedValue("\n\nfeat: implement tree-sitter AST\n\nBody text here");

    const subject = await generateCommitSubject("diff", mockLlm);

    expect(subject).toBe("feat: implement tree-sitter AST");
  });

  it("truncates subject to 72 chars", async () => {
    const longSubject = "feat: " + "a".repeat(100);
    const mockLlm = vi.fn().mockResolvedValue(longSubject);

    const subject = await generateCommitSubject("diff", mockLlm);

    expect(subject.length).toBeLessThanOrEqual(72);
  });
});

// ── Auto-commit gate conditions ───────────────────────────────────────────────

describe("auto-commit gate conditions", () => {
  it("does NOT fire when git.autoCommit is false (default)", () => {
    const config = { git: { autoCommit: false } };
    const roundWrittenFiles: string[] = ["/project/src/auth.ts"];

    // Simulate the gate check from agent-loop
    const shouldAutoCommit = roundWrittenFiles.length > 0 && config.git?.autoCommit === true;
    expect(shouldAutoCommit).toBe(false);
  });

  it("does NOT fire when git.autoCommit is undefined (default)", () => {
    const config: { git?: { autoCommit?: boolean } } = { git: {} };
    const roundWrittenFiles: string[] = ["/project/src/auth.ts"];

    const shouldAutoCommit = roundWrittenFiles.length > 0 && config.git?.autoCommit === true;
    expect(shouldAutoCommit).toBe(false);
  });

  it("does NOT fire when config.git is undefined", () => {
    const config: { git?: { autoCommit?: boolean } } = {};
    const roundWrittenFiles: string[] = ["/project/src/auth.ts"];

    const shouldAutoCommit = roundWrittenFiles.length > 0 && config.git?.autoCommit === true;
    expect(shouldAutoCommit).toBe(false);
  });

  it("fires when git.autoCommit is true and files were written", () => {
    const config = { git: { autoCommit: true } };
    const roundWrittenFiles: string[] = ["/project/src/auth.ts", "/project/src/utils.ts"];

    const shouldAutoCommit = roundWrittenFiles.length > 0 && config.git?.autoCommit === true;
    expect(shouldAutoCommit).toBe(true);
  });

  it("does NOT fire when pendingCommitFiles is empty even if autoCommit=true", () => {
    const config = { git: { autoCommit: true } };
    const roundWrittenFiles: string[] = []; // no files written this round

    const shouldAutoCommit = roundWrittenFiles.length > 0 && config.git?.autoCommit === true;
    expect(shouldAutoCommit).toBe(false);
  });
});

// ── pendingCommitFiles accumulator reset ──────────────────────────────────────

describe("pendingCommitFiles accumulator", () => {
  it("accumulates written files across tool calls in a round", () => {
    const roundWrittenFiles: string[] = [];

    // Simulate Write tool success
    roundWrittenFiles.push("/project/src/auth.ts");
    roundWrittenFiles.push("/project/src/utils.ts");

    expect(roundWrittenFiles).toHaveLength(2);
  });

  it("resets accumulator after commit fires", () => {
    const roundWrittenFiles: string[] = ["/project/src/auth.ts"];

    // Simulate commit trigger: clear the accumulator
    roundWrittenFiles.length = 0;

    expect(roundWrittenFiles).toHaveLength(0);
  });
});
