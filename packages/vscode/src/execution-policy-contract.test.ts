import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExecutionPolicyEngine,
  type CompletionVerificationContext,
  type ExecutionPolicyEvent,
  type NoToolResponseContext,
  type ToolCallLike,
  type ToolResultLike,
} from "@dantecode/core";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

function summarizeDecision(decision: ExecutionPolicyEvent | null) {
  if (!decision) {
    return null;
  }

  return {
    type: decision.type,
    severity: decision.severity,
    displayText: decision.displayText,
    followupPrompt: decision.followupPrompt,
  };
}

function buildNoToolContext(overrides: Partial<NoToolResponseContext> = {}): NoToolResponseContext {
  return {
    prompt: "/magic fix the execution policy parity gap",
    responseText:
      "Summary\n\nI will inspect the repo, update the shared engine, and then run typecheck to verify the changes.",
    isWorkflow: true,
    promptRequestsExecution: true,
    executedToolsThisTurn: 0,
    filesModified: 0,
    toolCallParseErrors: [],
    executionNudges: 0,
    maxExecutionNudges: 2,
    pipelineContinuationNudges: 0,
    maxPipelineContinuationNudges: 3,
    confabulationNudges: 0,
    maxConfabulationNudges: 4,
    roundNumber: 1,
    maxToolRounds: 8,
    ...overrides,
  };
}

function buildCompletionContext(
  projectRoot: string,
  overrides: Partial<CompletionVerificationContext> = {},
): CompletionVerificationContext {
  return {
    projectRoot,
    responseText: "Done. I created artifact.txt.",
    isWorkflow: true,
    touchedFiles: [join(projectRoot, "artifact.txt")],
    expectedFiles: ["artifact.txt"],
    phaseName: "artifact",
    intentDescription: "Create artifact",
    ...overrides,
  };
}

function createRetryTranscript(): Array<{ result: ToolResultLike }> {
  return [
    { result: { isError: true, content: "ENOENT: drizzle-kit not found" } },
    { result: { isError: true, content: "ENOENT: drizzle-kit not found" } },
    { result: { isError: true, content: "ENOENT: drizzle-kit not found" } },
    { result: { isError: true, content: "ENOENT: drizzle-kit not found" } },
    { result: { isError: true, content: "ENOENT: drizzle-kit not found" } },
  ];
}

describe("VS Code execution policy delegation contract", () => {
  const sidebarProviderSource = readFileSync(
    resolve(process.cwd(), "packages/vscode/src/sidebar-provider.ts"),
    "utf8",
  );

  it("delegates no-tool, completion, and retry handling to ExecutionPolicyEngine", () => {
    expect(sidebarProviderSource).toContain("ExecutionPolicyEngine");
    expect(sidebarProviderSource).toContain("executionPolicy.evaluateNoToolResponse(");
    expect(sidebarProviderSource).toContain("executionPolicy.verifyWorkflowCompletion(");
    expect(sidebarProviderSource).toContain("executionPolicy.assessToolCall(");
    expect(sidebarProviderSource).toContain("executionPolicy.recordToolResult(");
  });

  it("does not rely on legacy local nudge heuristics in the sidebar hot path", () => {
    expect(sidebarProviderSource).not.toContain("responseNeedsToolExecutionNudge(");
    expect(sidebarProviderSource).not.toContain("isQuestionPrompt(");
  });

  it("replays no-tool, completion, and retry transcripts through the same decision surface as the CLI path", async () => {
    const cliNoToolEngine = new ExecutionPolicyEngine();
    const vscodeNoToolEngine = new ExecutionPolicyEngine();

    const noToolCases: Array<{
      name: string;
      context: NoToolResponseContext;
      expectedType: ExecutionPolicyEvent["type"];
    }> = [
      {
        name: "execution nudge",
        context: buildNoToolContext(),
        expectedType: "execution_nudge",
      },
      {
        name: "pipeline continuation",
        context: buildNoToolContext({
          executedToolsThisTurn: 1,
          filesModified: 2,
          responseText: "Summary\n\nI updated packages/vscode/src/sidebar-provider.ts and ran checks.",
        }),
        expectedType: "pipeline_continuation",
      },
      {
        name: "confabulation block",
        context: buildNoToolContext({
          executedToolsThisTurn: 2,
          filesModified: 0,
          roundNumber: 3,
          responseText: "Done. I updated packages/cli/src/agent-loop.ts and verified typecheck: PASS.",
        }),
        expectedType: "confab_block",
      },
    ];

    for (const testCase of noToolCases) {
      const cliDecision = cliNoToolEngine.evaluateNoToolResponse(testCase.context);
      const vscodeDecision = vscodeNoToolEngine.evaluateNoToolResponse(testCase.context);

      expect(cliDecision?.type, testCase.name).toBe(testCase.expectedType);
      expect(vscodeDecision?.type, testCase.name).toBe(testCase.expectedType);
      expect(summarizeDecision(cliDecision)).toEqual(summarizeDecision(vscodeDecision));
    }

    const projectRoot = mkdtempSync(join(tmpdir(), "vscode-execution-policy-"));
    tempDirs.push(projectRoot);

    const completionBlockedCli = new ExecutionPolicyEngine({ projectRoot });
    const completionBlockedVscode = new ExecutionPolicyEngine({ projectRoot });
    const blockedContext = buildCompletionContext(projectRoot, {
      touchedFiles: [],
      expectedFiles: ["artifact.txt"],
    });
    const blockedCliDecision = await completionBlockedCli.verifyWorkflowCompletion(blockedContext);
    const blockedVscodeDecision = await completionBlockedVscode.verifyWorkflowCompletion(
      blockedContext,
    );
    expect(blockedCliDecision.type).toBe("completion_blocked");
    expect(blockedVscodeDecision.type).toBe("completion_blocked");
    expect(summarizeDecision(blockedCliDecision)).toEqual(summarizeDecision(blockedVscodeDecision));

    writeFileSync(join(projectRoot, "artifact.txt"), "done\n", "utf8");
    const completionAllowedCli = new ExecutionPolicyEngine({ projectRoot });
    const completionAllowedVscode = new ExecutionPolicyEngine({ projectRoot });
    const allowedContext = buildCompletionContext(projectRoot, {
      touchedFiles: [join(projectRoot, "artifact.txt")],
      expectedFiles: ["artifact.txt"],
    });
    const allowedCliDecision = await completionAllowedCli.verifyWorkflowCompletion(allowedContext);
    const allowedVscodeDecision = await completionAllowedVscode.verifyWorkflowCompletion(
      allowedContext,
    );
    expect(allowedCliDecision.type).toBe("completion_allowed");
    expect(allowedVscodeDecision.type).toBe("completion_allowed");
    expect(summarizeDecision(allowedCliDecision)).toEqual(summarizeDecision(allowedVscodeDecision));

    const toolCall: ToolCallLike = {
      name: "Bash",
      args: { command: "drizzle-kit generate" },
    };
    const retryTranscript = createRetryTranscript();
    const retryCliEngine = new ExecutionPolicyEngine();
    const retryVscodeEngine = new ExecutionPolicyEngine();

    const cliReplay = retryTranscript.map(({ result }) =>
      summarizeDecision(retryCliEngine.recordToolResult(toolCall, result)),
    );
    const vscodeReplay = retryTranscript.map(({ result }) =>
      summarizeDecision(retryVscodeEngine.recordToolResult(toolCall, result)),
    );

    expect(cliReplay).toEqual(vscodeReplay);
    expect(cliReplay[2]?.type).toBe("retry_warning");
    expect(cliReplay[4]?.type).toBe("retry_stuck");
    expect(summarizeDecision(retryCliEngine.assessToolCall(toolCall))).toEqual(
      summarizeDecision(retryVscodeEngine.assessToolCall(toolCall)),
    );
  });
});
