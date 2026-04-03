import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExecutionPolicyEngine, isWorkflowExecutionPrompt } from "./execution-policy.js";

describe("ExecutionPolicyEngine", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("returns no nudge for an analysis question", () => {
    const engine = new ExecutionPolicyEngine();

    const decision = engine.evaluateNoToolResponse({
      prompt: "what do you think of this project?",
      responseText:
        "I think the project has a solid architecture overall. The boundaries are mostly clear, and the biggest risk is duplicated execution logic between surfaces.",
      isWorkflow: false,
      promptRequestsExecution: false,
      executedToolsThisTurn: 0,
      filesModified: 0,
      toolCallParseErrors: [],
      executionNudges: 0,
      maxExecutionNudges: 3,
      pipelineContinuationNudges: 0,
      maxPipelineContinuationNudges: 3,
      confabulationNudges: 0,
      maxConfabulationNudges: 3,
      roundNumber: 1,
      maxToolRounds: 8,
    });

    expect(decision).toBeNull();
  });

  it("returns an execution nudge for workflow narration without tools", () => {
    const engine = new ExecutionPolicyEngine();

    const decision = engine.evaluateNoToolResponse({
      prompt: "/inferno fix the execution engine drift",
      responseText:
        "Summary\n\nI will inspect the repo, update the shared engine, and then run typecheck to verify the changes.",
      isWorkflow: true,
      promptRequestsExecution: true,
      executedToolsThisTurn: 0,
      filesModified: 0,
      toolCallParseErrors: [],
      executionNudges: 0,
      maxExecutionNudges: 3,
      pipelineContinuationNudges: 0,
      maxPipelineContinuationNudges: 3,
      confabulationNudges: 0,
      maxConfabulationNudges: 3,
      roundNumber: 1,
      maxToolRounds: 8,
    });

    expect(decision?.type).toBe("execution_nudge");
  });

  it("treats plain action prompts as workflow execution prompts", () => {
    expect(isWorkflowExecutionPrompt("Fix src/index.ts")).toBe(true);
    expect(isWorkflowExecutionPrompt("Implement the benchmark profile")).toBe(true);
    expect(isWorkflowExecutionPrompt("what do you think of this project?")).toBe(false);
  });

  it("stops emitting pipeline continuation nudges after the configured max", () => {
    const engine = new ExecutionPolicyEngine();

    const decision = engine.evaluateNoToolResponse({
      prompt: "/magic finish the execution pipeline",
      responseText: "## Summary\n\nAll complete.",
      isWorkflow: true,
      promptRequestsExecution: true,
      executedToolsThisTurn: 2,
      filesModified: 2,
      toolCallParseErrors: [],
      executionNudges: 0,
      maxExecutionNudges: 2,
      pipelineContinuationNudges: 3,
      maxPipelineContinuationNudges: 3,
      confabulationNudges: 0,
      maxConfabulationNudges: 4,
      roundNumber: 4,
      maxToolRounds: 8,
    });

    expect(decision).toBeNull();
  });

  it("returns a confab block when a workflow claims completion with zero writes", () => {
    const engine = new ExecutionPolicyEngine();

    const decision = engine.evaluateNoToolResponse({
      prompt: "/magic implement the shared engine",
      responseText:
        "Done. I updated packages/cli/src/agent-loop.ts, ran typecheck: PASS, and verified the workflow is complete.",
      isWorkflow: true,
      promptRequestsExecution: true,
      executedToolsThisTurn: 2,
      filesModified: 0,
      toolCallParseErrors: [],
      executionNudges: 0,
      maxExecutionNudges: 3,
      pipelineContinuationNudges: 0,
      maxPipelineContinuationNudges: 3,
      confabulationNudges: 0,
      maxConfabulationNudges: 3,
      roundNumber: 3,
      maxToolRounds: 8,
    });

    expect(decision?.type).toBe("confab_block");
  });

  it("blocks workflow completion when expected deliverables are missing", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "execution-policy-missing-"));
    tempDirs.push(projectRoot);
    const engine = new ExecutionPolicyEngine({ projectRoot });

    const decision = await engine.verifyWorkflowCompletion({
      projectRoot,
      responseText: "Done. I created src/execution-policy.ts.",
      isWorkflow: true,
      touchedFiles: [],
      expectedFiles: ["src/execution-policy.ts"],
      phaseName: "shared-engine",
      intentDescription: "Create the canonical execution policy module",
    });

    expect(decision.type).toBe("completion_blocked");
    expect(String(decision.followupPrompt)).toContain("VERIFICATION FAILED");
  });

  it("escalates retry state from warning to stuck within a session", () => {
    const engine = new ExecutionPolicyEngine();
    const toolCall = { name: "Bash", args: { command: "drizzle-kit generate" } };

    const outcomes = [
      engine.recordToolResult(toolCall, {
        isError: true,
        content: "ENOENT: drizzle-kit not found",
      }),
      engine.recordToolResult(toolCall, {
        isError: true,
        content: "ENOENT: drizzle-kit not found",
      }),
      engine.recordToolResult(toolCall, {
        isError: true,
        content: "ENOENT: drizzle-kit not found",
      }),
      engine.recordToolResult(toolCall, {
        isError: true,
        content: "ENOENT: drizzle-kit not found",
      }),
      engine.recordToolResult(toolCall, {
        isError: true,
        content: "ENOENT: drizzle-kit not found",
      }),
    ];

    expect(outcomes[0]).toBeNull();
    expect(outcomes[1]).toBeNull();
    expect(outcomes[2]?.type).toBe("retry_warning");
    expect(outcomes[3]?.type).toBe("retry_warning");
    expect(outcomes[4]?.type).toBe("retry_stuck");
  });

  it("does not carry retry state across unrelated runs", () => {
    const firstRun = new ExecutionPolicyEngine();
    const secondRun = new ExecutionPolicyEngine();
    const toolCall = { name: "Bash", args: { command: "drizzle-kit generate" } };

    for (let index = 0; index < 5; index += 1) {
      firstRun.recordToolResult(toolCall, {
        isError: true,
        content: "ENOENT: drizzle-kit not found",
      });
    }

    const decision = secondRun.assessToolCall(toolCall);

    expect(decision).toBeNull();
  });

  it("allows workflow completion when deliverables exist", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "execution-policy-complete-"));
    tempDirs.push(projectRoot);
    const sourceFile = join(projectRoot, "artifact.txt");
    writeFileSync(sourceFile, "done");
    const engine = new ExecutionPolicyEngine({ projectRoot });

    const decision = await engine.verifyWorkflowCompletion({
      projectRoot,
      responseText: "Done. I created artifact.txt.",
      isWorkflow: true,
      touchedFiles: [sourceFile],
      expectedFiles: ["artifact.txt"],
      phaseName: "artifact",
      intentDescription: "Create artifact",
    });

    expect(decision.type).toBe("completion_allowed");
  });

  it("blocks workflow completion when typecheck fails even if build-style files exist", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "execution-policy-typecheck-"));
    tempDirs.push(projectRoot);

    writeFileSync(
      join(projectRoot, "package.json"),
      JSON.stringify(
        {
          name: "execution-policy-fixture",
          private: true,
          scripts: {
            build: "node -e \"process.exit(0)\"",
            typecheck: "node -e \"process.exit(1)\"",
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(projectRoot, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
          },
        },
        null,
        2,
      ),
    );

    mkdirSync(join(projectRoot, "src"), { recursive: true });
    const sourceFile = join(projectRoot, "src", "index.ts");
    writeFileSync(sourceFile, "export const ok = true;\n", { encoding: "utf8" });
    const engine = new ExecutionPolicyEngine({ projectRoot });

    const decision = await engine.verifyWorkflowCompletion({
      projectRoot,
      responseText: "Done. I created src/index.ts and the build is green.",
      isWorkflow: true,
      touchedFiles: [sourceFile],
      expectedFiles: ["src/index.ts"],
      phaseName: "typecheck-gate",
      intentDescription: "Create a TypeScript entrypoint",
      language: "typescript",
    });

    expect(decision.type).toBe("verification_failed");
    expect(String(decision.followupPrompt)).toContain("Typecheck must pass");
  });
});
