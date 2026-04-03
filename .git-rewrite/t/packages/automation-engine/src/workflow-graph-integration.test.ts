// ============================================================================
// @dantecode/automation-engine — Workflow Graph Integration Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  defineWorkflowAutomation,
  executeWorkflowAutomation,
  toAutomationExecutionRecord,
} from "./workflow-graph-integration.js";
import { createWorkflowGraph } from "./workflow-graph-builder.js";
import { defineStateSchema, ChannelReducers } from "./workflow-graph-state.js";

describe("workflow-graph-integration", () => {
  describe("defineWorkflowAutomation", () => {
    it("should define workflow automation", () => {
      const automation = defineWorkflowAutomation({
        name: "test-workflow",
        schema: defineStateSchema({
          value: { default: 0 },
        }),
        build: (config) => {
          const graph = createWorkflowGraph(config.stateSchema);
          return graph
            .addNode("process", async () => ({ value: 42 }))
            .setFinishPoint("process")
            .compile();
        },
      });

      expect(automation.name).toBe("test-workflow");
      expect(automation.schema).toBeDefined();
      expect(automation.build).toBeDefined();
    });

    it("should include trigger configuration", () => {
      const automation = defineWorkflowAutomation({
        name: "pr-workflow",
        schema: defineStateSchema({
          prNumber: { default: 0 },
        }),
        build: (config) => {
          const graph = createWorkflowGraph(config.stateSchema);
          return graph
            .addNode("review", async () => ({}))
            .setFinishPoint("review")
            .compile();
        },
        trigger: {
          event: "pull_request",
        },
      });

      expect(automation.trigger?.event).toBe("pull_request");
    });
  });

  describe("executeWorkflowAutomation", () => {
    it("should execute workflow automation", async () => {
      interface State {
        input: number;
        output: number;
      }

      const automation = defineWorkflowAutomation({
        name: "double-workflow",
        schema: defineStateSchema<State>({
          input: { default: 0 },
          output: { default: 0 },
        }),
        build: (config) => {
          const graph = createWorkflowGraph(config.stateSchema);
          return graph
            .addNode("double", async ({ state }) => ({
              output: state.input * 2,
            }))
            .setFinishPoint("double")
            .compile();
        },
      });

      const result = await executeWorkflowAutomation(automation, {
        input: 21,
      });

      expect(result.success).toBe(true);
      expect(result.state.output).toBe(42);
    });

    it("should support session-based checkpointing", async () => {
      const automation = defineWorkflowAutomation({
        name: "checkpoint-workflow",
        schema: defineStateSchema({
          value: { default: 0 },
        }),
        build: (config) => {
          const graph = createWorkflowGraph(config.stateSchema);
          return graph
            .addNode("process", async () => ({ value: 100 }))
            .setFinishPoint("process")
            .compile();
        },
      });

      const sessionId = randomUUID();

      const result = await executeWorkflowAutomation(
        automation,
        { value: 0 },
        {
          sessionId,
          projectRoot: process.cwd(),
        },
      );

      expect(result.success).toBe(true);
      expect(result.checkpointId).toBeDefined();
    });

    it("should handle complex multi-step workflows", async () => {
      interface State {
        steps: string[];
        result: string;
      }

      const automation = defineWorkflowAutomation({
        name: "multi-step",
        schema: defineStateSchema<State>({
          steps: { default: [], reducer: ChannelReducers.append },
          result: { default: "" },
        }),
        build: (config) => {
          const graph = createWorkflowGraph(config.stateSchema);
          return graph
            .addNode("step1", async () => ({
              steps: ["fetch"],
            }))
            .addNode("step2", async () => ({
              steps: ["process"],
            }))
            .addNode("step3", async () => ({
              steps: ["validate"],
              result: "complete",
            }))
            .addEdge("step1", "step2")
            .addEdge("step2", "step3")
            .setEntryPoint("step1")
            .setFinishPoint("step3")
            .compile();
        },
      });

      const result = await executeWorkflowAutomation(automation, {});

      expect(result.success).toBe(true);
      expect(result.state.steps).toEqual(["fetch", "process", "validate"]);
      expect(result.state.result).toBe("complete");
    });

    it("should handle conditional workflows", async () => {
      interface State {
        mode: "fast" | "slow";
        method: string;
      }

      const automation = defineWorkflowAutomation({
        name: "conditional",
        schema: defineStateSchema<State>({
          mode: { default: "fast" as const },
          method: { default: "" },
        }),
        build: (config) => {
          const graph = createWorkflowGraph(config.stateSchema);
          return graph
            .addNode("route", async () => ({}))
            .addNode("fast", async () => ({
              method: "quick-path",
            }))
            .addNode("slow", async () => ({
              method: "thorough-path",
            }))
            .addConditionalEdge("route", (state: State) => {
              return state.mode === "fast" ? "fast" : "slow";
            })
            .setEntryPoint("route")
            .setFinishPoint("fast")
            .setFinishPoint("slow")
            .compile();
        },
      });

      const fastResult = await executeWorkflowAutomation(automation, {
        mode: "fast",
      });
      expect(fastResult.state.method).toBe("quick-path");

      const slowResult = await executeWorkflowAutomation(automation, {
        mode: "slow",
      });
      expect(slowResult.state.method).toBe("thorough-path");
    });

    it("should propagate errors", async () => {
      const automation = defineWorkflowAutomation({
        name: "failing",
        schema: defineStateSchema({
          value: { default: 0 },
        }),
        build: (config) => {
          const graph = createWorkflowGraph(config.stateSchema);
          return graph
            .addNode("fail", async () => {
              throw new Error("Intentional failure");
            })
            .setFinishPoint("fail")
            .compile();
        },
      });

      const result = await executeWorkflowAutomation(automation, {});

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("Intentional failure");
    });
  });

  describe("toAutomationExecutionRecord", () => {
    it("should convert successful execution result", () => {
      const result = {
        executionId: "exec-123",
        state: { value: 42 },
        history: [],
        durationMs: 1234,
        success: true,
        checkpointId: "cp-456",
      };

      const record = toAutomationExecutionRecord(result, "test-workflow");

      expect(record.status).toBe("completed");
      expect(record.gateStatus).toBe("passed");
      expect(record.checkpointSessionId).toBe("cp-456");
    });

    it("should convert failed execution result", () => {
      const result = {
        executionId: "exec-789",
        state: { value: 0 },
        history: [],
        durationMs: 500,
        success: false,
        error: new Error("Test error"),
      };

      const record = toAutomationExecutionRecord(result, "failing-workflow");

      expect(record.status).toBe("failed");
      expect(record.gateStatus).toBe("failed");
      expect(record.error).toBe("Test error");
    });

    it("should include step count", () => {
      const result = {
        executionId: "exec-999",
        state: {},
        history: [
          { nodeName: "a", updates: {}, durationMs: 10, nextNodes: [] },
          { nodeName: "b", updates: {}, durationMs: 20, nextNodes: [] },
          { nodeName: "c", updates: {}, durationMs: 30, nextNodes: [] },
        ],
        durationMs: 60,
        success: true,
      };

      const record = toAutomationExecutionRecord(result, "multi-step");

      expect(record.summary).toContain("3 steps");
    });
  });

  describe("real-world scenarios", () => {
    it("should support PR review workflow", async () => {
      interface PRState {
        prNumber: number;
        files: string[];
        comments: Array<{ file: string; comment: string }>;
        approved: boolean;
      }

      const automation = defineWorkflowAutomation({
        name: "pr-review",
        schema: defineStateSchema<PRState>({
          prNumber: { default: 0 },
          files: { default: [] },
          comments: {
            default: [],
            reducer: ChannelReducers.append,
          },
          approved: { default: false },
        }),
        build: (config) => {
          const graph = createWorkflowGraph(config.stateSchema);
          return graph
            .addNode("fetch-files", async ({ state }) => ({
              files: [`pr-${state.prNumber}-file1.ts`, `pr-${state.prNumber}-file2.ts`],
            }))
            .addNode("analyze", async ({ state }) => ({
              comments: state.files.map((file) => ({
                file,
                comment: `Reviewed ${file}`,
              })),
            }))
            .addNode("approve", async ({ state }) => ({
              approved: state.comments.length > 0,
            }))
            .addEdge("fetch-files", "analyze")
            .addEdge("analyze", "approve")
            .setEntryPoint("fetch-files")
            .setFinishPoint("approve")
            .compile();
        },
        trigger: {
          event: "pull_request",
        },
      });

      const result = await executeWorkflowAutomation(automation, {
        prNumber: 123,
      });

      expect(result.success).toBe(true);
      expect(result.state.files.length).toBe(2);
      expect(result.state.comments.length).toBe(2);
      expect(result.state.approved).toBe(true);
    });

    it("should support test-on-change workflow", async () => {
      interface TestState {
        changedFiles: string[];
        testFiles: string[];
        testResults: Array<{ file: string; passed: boolean }>;
        allPassed: boolean;
      }

      const automation = defineWorkflowAutomation({
        name: "test-on-change",
        schema: defineStateSchema<TestState>({
          changedFiles: { default: [] },
          testFiles: { default: [] },
          testResults: {
            default: [],
            reducer: ChannelReducers.append,
          },
          allPassed: { default: false },
        }),
        build: (config) => {
          const graph = createWorkflowGraph(config.stateSchema);
          return graph
            .addNode("find-tests", async ({ state }) => ({
              testFiles: state.changedFiles.map((f) => f.replace(".ts", ".test.ts")),
            }))
            .addNode("run-tests", async ({ state }) => ({
              testResults: state.testFiles.map((file) => ({
                file,
                passed: Math.random() > 0.1, // 90% pass rate
              })),
            }))
            .addNode("check-results", async ({ state }) => ({
              allPassed: state.testResults.every((r) => r.passed),
            }))
            .addEdge("find-tests", "run-tests")
            .addEdge("run-tests", "check-results")
            .setEntryPoint("find-tests")
            .setFinishPoint("check-results")
            .compile();
        },
        trigger: {
          filePattern: "**/*.ts",
        },
      });

      const result = await executeWorkflowAutomation(automation, {
        changedFiles: ["src/foo.ts", "src/bar.ts"],
      });

      expect(result.success).toBe(true);
      expect(result.state.testFiles).toEqual(["src/foo.test.ts", "src/bar.test.ts"]);
      expect(result.state.testResults.length).toBe(2);
    });
  });
});
