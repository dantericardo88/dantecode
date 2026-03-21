import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultToolHandlers } from "./default-tool-handlers.js";
import { globalVerificationRailRegistry } from "@dantecode/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { GitAutomationStore } from "@dantecode/git-engine";

describe("createDefaultToolHandlers", () => {
  beforeEach(() => {
    globalVerificationRailRegistry.clear();
  });

  it("verify_output returns a structured QA report", async () => {
    const handlers = createDefaultToolHandlers();
    const verifyOutput = handlers["verify_output"]!;
    const raw = await verifyOutput({
      task: "Provide deploy and rollback guidance",
      output: "Deploy steps:\n1. Build\n2. Deploy\nRollback if checks fail.",
      criteria: {
        requiredKeywords: ["deploy", "rollback"],
        minLength: 40,
      },
    });
    const result = JSON.parse(raw) as { overallPassed: boolean; pdseScore: number };

    expect(result.overallPassed).toBe(true);
    expect(result.pdseScore).toBeGreaterThan(0.8);
  });

  it("add_verification_rail registers rails used by subsequent verification", async () => {
    const handlers = createDefaultToolHandlers();
    const addVerificationRail = handlers["add_verification_rail"]!;
    const verifyOutput = handlers["verify_output"]!;

    await addVerificationRail({
      rule: {
        id: "rail-steps",
        name: "Steps required",
        requiredSubstrings: ["Steps"],
      },
    });

    const raw = await verifyOutput({
      task: "Describe the release",
      output: "Release notes only",
    });
    const result = JSON.parse(raw) as {
      overallPassed: boolean;
      railFindings: Array<{ passed: boolean }>;
    };

    expect(result.overallPassed).toBe(false);
    expect(result.railFindings.some((finding) => finding.passed === false)).toBe(true);
  });

  it("schedule_git_task can start, list, and stop durable tasks", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "dantecode-mcp-schedule-"));

    try {
      const handlers = createDefaultToolHandlers();
      const scheduleGitTask = handlers["schedule_git_task"]!;
      const startRaw = await scheduleGitTask({
        taskName: "Nightly refresh",
        intervalMs: 60_000,
        projectRoot,
      });
      const startResult = JSON.parse(startRaw) as { taskId: string };
      await new Promise((resolve) => setTimeout(resolve, 25));
      const listRaw = await scheduleGitTask({
        action: "list",
        projectRoot,
      });
      const listResult = JSON.parse(listRaw) as {
        tasks: Array<{ id: string; taskName: string }>;
      };

      expect(startResult.taskId).toBeDefined();
      expect(listResult.tasks.some((task) => task.id === startResult.taskId)).toBe(true);

      const stopRaw = await scheduleGitTask({
        action: "stop",
        taskId: startResult.taskId,
        projectRoot,
      });
      const stopResult = JSON.parse(stopRaw) as { stopped: boolean };
      expect(stopResult.stopped).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("run_github_workflow can queue durable background executions", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "dantecode-mcp-workflow-"));

    try {
      await writeFile(
        join(projectRoot, "workflow.yml"),
        [
          "name: MCP Workflow",
          "jobs:",
          "  build:",
          "    steps:",
          "      - name: Echo",
          "        run: node -e \"console.log('workflow-ok')\"",
          "",
        ].join("\n"),
        "utf-8",
      );

      const handlers = createDefaultToolHandlers();
      const runWorkflow = handlers["run_github_workflow"]!;
      const raw = await runWorkflow({
        workflowPath: "workflow.yml",
        projectRoot,
        background: true,
      });
      const result = JSON.parse(raw) as { executionId: string };

      expect(result.executionId).toBeDefined();

      let executions = await new GitAutomationStore(projectRoot).listAutomationExecutions();
      for (let attempt = 0; attempt < 20; attempt++) {
        if (
          executions.some(
            (entry) =>
              entry.id === result.executionId &&
              (entry.status === "completed" ||
                entry.status === "failed" ||
                entry.status === "blocked"),
          )
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
        executions = await new GitAutomationStore(projectRoot).listAutomationExecutions();
      }

      expect(executions.length).toBeGreaterThanOrEqual(1);
      expect(executions[0]?.kind).toBe("workflow");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("auto_pr_create blocks when automation verification gates fail", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "dantecode-mcp-auto-pr-"));

    try {
      const handlers = createDefaultToolHandlers();
      const autoPrCreate = handlers["auto_pr_create"]!;
      const raw = await autoPrCreate({
        title: "Release prep",
        projectRoot,
        generateChangeset: true,
        bumpType: "patch",
        packages: ["pkg-a"],
      });
      const result = JSON.parse(raw) as { status: string; changesetFiles: string[] };

      expect(result.status).toBe("blocked");
      expect(result.changesetFiles).toHaveLength(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
