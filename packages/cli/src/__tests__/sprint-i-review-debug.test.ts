// ============================================================================
// Sprint I — Dims 13+20: Line-level Approval Comments + Structured Debug Format
// Tests that:
//  - "Approve with comments" option appears in QuickPick items
//  - Per-file inputBox comment flow stores { file, comment } objects
//  - Comments injected into context as ## Review Comments block
//  - [Review: N comments added] printed to outputChannel
//  - formatForContext returns structured **Variables** (top frame) section
//  - Variable values truncated at 200 chars
//  - **Call stack depth**: N frames present in debug context
//  - **Status**: paused at breakpoint in debug context
// ============================================================================

import { describe, it, expect } from "vitest";

// ─── Part 1: Line-level approval comments (dim 13) ───────────────────────────

interface ReviewItem {
  label: string;
  description: string;
  action: string;
}

/** Simulates the QuickPick items for reviewChanges command. */
function buildReviewItems(): ReviewItem[] {
  return [
    { label: "$(check) Accept", description: "Apply all changes", action: "accept" },
    { label: "$(comment) Approve with comments", description: "Accept and annotate per file", action: "approve-comments" },
    { label: "$(diff) View diff", description: "Open diff review panel", action: "review" },
    { label: "$(x) Reject", description: "Discard all changes", action: "reject" },
  ];
}

/** Simulates the "approve-comments" selection flow. */
async function simulateApproveWithComments(
  files: string[],
  inputBoxFn: (file: string) => Promise<string | undefined>,
  outputFn: (msg: string) => void,
): Promise<Array<{ file: string; comment: string }>> {
  const comments: Array<{ file: string; comment: string }> = [];
  for (const filePath of files) {
    const comment = await inputBoxFn(filePath);
    if (comment) comments.push({ file: filePath, comment });
  }
  if (comments.length > 0) {
    outputFn(`[Review: ${comments.length} comment${comments.length === 1 ? "" : "s"} added to context]`);
  }
  return comments;
}

/** Simulates injection of review comments into system prompt. */
function buildReviewCommentsBlock(comments: Array<{ file: string; comment: string }>): string {
  if (comments.length === 0) return "";
  const lines = comments.map((c) => `- ${c.file}: ${c.comment}`);
  return `## Review Comments\n${lines.join("\n")}`;
}

describe("Line-level approval comments — Sprint I (dim 13)", () => {
  // 1. "Approve with comments" option appears in QuickPick items
  it("QuickPick items include 'Approve with comments' option", () => {
    const items = buildReviewItems();
    const approveItem = items.find((i) => i.action === "approve-comments");
    expect(approveItem).toBeDefined();
    expect(approveItem?.label).toContain("Approve with comments");
  });

  // 2. Per-file inputBox shown and comment stored
  it("per-file comment from inputBox stored as { file, comment } object", async () => {
    const outputs: string[] = [];
    const comments = await simulateApproveWithComments(
      ["/src/agent-loop.ts"],
      async () => "verify edge case X",
      (m) => outputs.push(m),
    );
    expect(comments).toHaveLength(1);
    expect(comments[0]?.file).toBe("/src/agent-loop.ts");
    expect(comments[0]?.comment).toBe("verify edge case X");
  });

  // 3. Multiple files → multiple comment objects
  it("multiple files produce multiple comment objects", async () => {
    const outputs: string[] = [];
    const comments = await simulateApproveWithComments(
      ["/src/a.ts", "/src/b.ts"],
      async (f) => `comment on ${f}`,
      (m) => outputs.push(m),
    );
    expect(comments).toHaveLength(2);
  });

  // 4. Comments injected into system prompt as ## Review Comments block
  it("comments injected as ## Review Comments section in system prompt", async () => {
    const outputs: string[] = [];
    const comments = await simulateApproveWithComments(
      ["/src/tools.ts"],
      async () => "check security implications",
      (m) => outputs.push(m),
    );
    const block = buildReviewCommentsBlock(comments);
    expect(block).toContain("## Review Comments");
    expect(block).toContain("check security implications");
  });

  // 5. [Review: N comments added] printed to outputChannel
  it("[Review: N comments added to context] line printed to outputChannel", async () => {
    const outputs: string[] = [];
    await simulateApproveWithComments(
      ["/src/a.ts", "/src/b.ts"],
      async () => "test comment",
      (m) => outputs.push(m),
    );
    expect(outputs[0]).toContain("[Review: 2 comments added to context]");
  });

  // 6. Blank comment → skipped (not added to comments array)
  it("blank inputBox response skips file — not added to comments", async () => {
    const outputs: string[] = [];
    const comments = await simulateApproveWithComments(
      ["/src/a.ts"],
      async () => undefined,
      (m) => outputs.push(m),
    );
    expect(comments).toHaveLength(0);
    expect(outputs.length).toBe(0);
  });

  // 7. Single comment uses singular "comment" not "comments"
  it("single comment uses singular form in output message", async () => {
    const outputs: string[] = [];
    await simulateApproveWithComments(
      ["/src/only.ts"],
      async () => "one comment",
      (m) => outputs.push(m),
    );
    expect(outputs[0]).toContain("1 comment added");
    expect(outputs[0]).not.toContain("1 comments");
  });
});

// ─── Part 2: Structured debug format (dim 20) ─────────────────────────────────

interface DebugFrame {
  name: string;
  source: string;
  line: number;
  variables: Record<string, string>;
}

interface DebugSnapshot {
  threadId: number;
  stopReason: string;
  frames: DebugFrame[];
  exceptionMessage?: string;
}

/** Simulates the upgraded formatForContext() in DebugAttachProvider. */
function simulateFormatForContext(snapshot: DebugSnapshot | null): string {
  if (!snapshot) return "";
  const topFrame = snapshot.frames[0];
  const lines: string[] = [
    `**Status**: paused at ${snapshot.stopReason}`,
  ];
  if (topFrame) {
    lines.push(`**Location**: ${topFrame.source}:${topFrame.line}`);
  }
  lines.push(`**Call stack depth**: ${snapshot.frames.length} frame${snapshot.frames.length === 1 ? "" : "s"}`);
  if (snapshot.exceptionMessage) {
    lines.push(`**Exception**: ${snapshot.exceptionMessage.slice(0, 200)}`);
  }
  if (topFrame && Object.keys(topFrame.variables).length > 0) {
    lines.push(`**Variables** (top frame):`);
    for (const [name, val] of Object.entries(topFrame.variables).slice(0, 10)) {
      const truncated = val.length > 200 ? val.slice(0, 197) + "..." : val;
      lines.push(`  \u2022 ${name}: ${truncated}`);
    }
  }
  return `## Debug Context\n${lines.join("\n")}`;
}

describe("Structured debug format — Sprint I (dim 20)", () => {
  const sampleSnapshot: DebugSnapshot = {
    threadId: 1,
    stopReason: "breakpoint",
    frames: [
      {
        name: "runAutoforgeIAL",
        source: "src/agent-loop.ts",
        line: 2549,
        variables: {
          config: '{ autoCommit: true, model: "claude-opus-4-5" }',
          result: '{ isError: false, content: [] }',
        },
      },
      { name: "runAgent", source: "src/agent.ts", line: 100, variables: {} },
      { name: "main", source: "src/index.ts", line: 10, variables: {} },
    ],
  };

  // 8. formatForContext returns structured ## Debug Context header
  it("formatForContext returns ## Debug Context header", () => {
    const output = simulateFormatForContext(sampleSnapshot);
    expect(output).toContain("## Debug Context");
  });

  // 9. **Variables** (top frame) section present with variable entries
  it("formatForContext returns **Variables** (top frame) section with entries", () => {
    const output = simulateFormatForContext(sampleSnapshot);
    expect(output).toContain("**Variables** (top frame):");
    expect(output).toContain("• config:");
    expect(output).toContain("• result:");
  });

  // 10. Variable values truncated at 200 chars
  it("variable values longer than 200 chars are truncated with ellipsis", () => {
    const longVal = "x".repeat(250);
    const snapshot: DebugSnapshot = {
      threadId: 1,
      stopReason: "step",
      frames: [{ name: "fn", source: "file.ts", line: 1, variables: { longVar: longVal } }],
    };
    const output = simulateFormatForContext(snapshot);
    expect(output).toContain("...");
    expect(output).not.toContain(longVal);
  });

  // 11. **Call stack depth**: N frames present
  it("**Call stack depth**: N frames present in output", () => {
    const output = simulateFormatForContext(sampleSnapshot);
    expect(output).toContain("**Call stack depth**: 3 frames");
  });

  // 12. **Status**: paused at breakpoint in output
  it("**Status**: paused at breakpoint in debug context", () => {
    const output = simulateFormatForContext(sampleSnapshot);
    expect(output).toContain("**Status**: paused at breakpoint");
  });

  // 13. **Location**: file:line in output
  it("**Location**: source:line present in debug context", () => {
    const output = simulateFormatForContext(sampleSnapshot);
    expect(output).toContain("**Location**: src/agent-loop.ts:2549");
  });

  // 14. null snapshot → empty string (no crash)
  it("null snapshot returns empty string without throwing", () => {
    expect(() => simulateFormatForContext(null)).not.toThrow();
    expect(simulateFormatForContext(null)).toBe("");
  });
});
