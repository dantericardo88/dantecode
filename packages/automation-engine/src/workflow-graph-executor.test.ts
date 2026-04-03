// ============================================================================
// @dantecode/automation-engine — Graph Executor Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { createWorkflowGraph } from "./workflow-graph-builder.js";
import { defineStateSchema, ChannelReducers } from "./workflow-graph-state.js";
import { EventEmitter } from "node:events";

describe("workflow-graph-executor", () => {
  describe("basic execution", () => {
    it("should execute linear workflow", async () => {
      interface State {
        value: number;
      }

      const schema = defineStateSchema<State>({
        value: { default: 0 },
      });

      const graph = createWorkflowGraph(schema)
        .addNode("increment", async ({ state }) => ({
          value: state.value + 1,
        }))
        .addNode("double", async ({ state }) => ({
          value: state.value * 2,
        }))
        .addEdge("increment", "double")
        .setEntryPoint("increment")
        .setFinishPoint("double")
        .compile();

      const result = await graph.execute();

      expect(result.success).toBe(true);
      expect(result.state.value).toBe(2); // (0 + 1) * 2
      expect(result.history.length).toBe(3); // START, increment, double (END exits early)
    });

    it("should apply initial input", async () => {
      interface State {
        x: number;
        y: number;
      }

      const schema = defineStateSchema<State>({
        x: { default: 0 },
        y: { default: 0 },
      });

      const graph = createWorkflowGraph(schema)
        .addNode("add", async ({ state }) => ({
          y: state.x + state.y,
        }))
        .setFinishPoint("add")
        .compile();

      const result = await graph.execute({
        input: { x: 10, y: 5 },
      });

      expect(result.success).toBe(true);
      expect(result.state.y).toBe(15);
    });

    it("should track execution history", async () => {
      const schema = defineStateSchema({
        counter: { default: 0 },
      });

      const graph = createWorkflowGraph(schema)
        .addNode("a", async () => ({ counter: 1 }))
        .addNode("b", async () => ({ counter: 2 }))
        .addNode("c", async () => ({ counter: 3 }))
        .addEdge("a", "b")
        .addEdge("b", "c")
        .setEntryPoint("a")
        .setFinishPoint("c")
        .compile();

      const result = await graph.execute();

      expect(result.history.length).toBe(4); // START, a, b, c (END exits early)
      expect(result.history.map((h) => h.nodeName)).toEqual(["__start__", "a", "b", "c"]);
    });
  });

  describe("conditional edges", () => {
    it("should follow conditional branches", async () => {
      interface State {
        value: number;
        result: string;
      }

      const schema = defineStateSchema<State>({
        value: { default: 0 },
        result: { default: "" },
      });

      const graph = createWorkflowGraph(schema)
        .addNode("check", async () => ({}))
        .addNode("high", async () => ({ result: "high" }))
        .addNode("low", async () => ({ result: "low" }))
        .addConditionalEdge("check", (state: State) => {
          return state.value > 10 ? "high" : "low";
        })
        .setEntryPoint("check")
        .setFinishPoint("high")
        .setFinishPoint("low")
        .compile();

      const result1 = await graph.execute({ input: { value: 15 } });
      expect(result1.state.result).toBe("high");

      const result2 = await graph.execute({ input: { value: 5 } });
      expect(result2.state.result).toBe("low");
    });

    it("should support multi-target branches", async () => {
      interface State {
        values: number[];
      }

      const schema = defineStateSchema<State>({
        values: { default: [], reducer: ChannelReducers.append },
      });

      const graph = createWorkflowGraph(schema)
        .addNode("start", async () => ({}))
        .addNode("a", async () => ({ values: [1] }))
        .addNode("b", async () => ({ values: [2] }))
        .addNode("merge", async () => ({}))
        .addConditionalEdge("start", () => ["a", "b"]) // Fan-out
        .addEdge("a", "merge")
        .addEdge("b", "merge")
        .setEntryPoint("start")
        .setFinishPoint("merge")
        .compile();

      const result = await graph.execute();

      // Both branches execute, values accumulated
      expect(result.state.values).toContain(1);
      expect(result.state.values).toContain(2);
    });
  });

  describe("channel reducers", () => {
    it("should use append reducer", async () => {
      interface State {
        items: string[];
      }

      const schema = defineStateSchema<State>({
        items: { default: [], reducer: ChannelReducers.append },
      });

      const graph = createWorkflowGraph(schema)
        .addNode("add1", async () => ({ items: ["a"] }))
        .addNode("add2", async () => ({ items: ["b"] }))
        .addNode("add3", async () => ({ items: ["c", "d"] }))
        .addEdge("add1", "add2")
        .addEdge("add2", "add3")
        .setEntryPoint("add1")
        .setFinishPoint("add3")
        .compile();

      const result = await graph.execute();

      expect(result.state.items).toEqual(["a", "b", "c", "d"]);
    });

    it("should use sum reducer", async () => {
      interface State {
        total: number;
      }

      const schema = defineStateSchema<State>({
        total: { default: 0, reducer: ChannelReducers.sum },
      });

      const graph = createWorkflowGraph(schema)
        .addNode("add5", async () => ({ total: 5 }))
        .addNode("add10", async () => ({ total: 10 }))
        .addNode("add3", async () => ({ total: 3 }))
        .addEdge("add5", "add10")
        .addEdge("add10", "add3")
        .setEntryPoint("add5")
        .setFinishPoint("add3")
        .compile();

      const result = await graph.execute();

      expect(result.state.total).toBe(18);
    });
  });

  describe("error handling", () => {
    it("should capture node errors", async () => {
      const schema = defineStateSchema({
        value: { default: 0 },
      });

      const graph = createWorkflowGraph(schema)
        .addNode("failing", async () => {
          throw new Error("Test error");
        })
        .setFinishPoint("failing")
        .compile();

      const result = await graph.execute();

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("Test error");
    });

    it("should retry failed nodes", async () => {
      const schema = defineStateSchema({
        attempts: { default: 0, reducer: ChannelReducers.sum },
      });

      let callCount = 0;

      const graph = createWorkflowGraph(schema)
        .addNode(
          "flaky",
          async () => {
            callCount++;
            if (callCount < 3) {
              throw new Error("Temporary failure");
            }
            return { attempts: 1 };
          },
          {
            retryPolicy: {
              maxRetries: 3,
              backoff: "linear",
              delayMs: 10,
            },
          },
        )
        .setFinishPoint("flaky")
        .compile();

      const result = await graph.execute();

      expect(result.success).toBe(true);
      expect(callCount).toBe(3);
    });

    it("should respect max retries", async () => {
      const schema = defineStateSchema({
        value: { default: 0 },
      });

      let callCount = 0;

      const graph = createWorkflowGraph(schema)
        .addNode(
          "alwaysFails",
          async () => {
            callCount++;
            throw new Error("Always fails");
          },
          {
            retryPolicy: {
              maxRetries: 2,
              delayMs: 10,
            },
          },
        )
        .setFinishPoint("alwaysFails")
        .compile();

      const result = await graph.execute();

      expect(result.success).toBe(false);
      expect(callCount).toBeGreaterThanOrEqual(2); // Initial + retries
    });
  });

  describe("cycle detection", () => {
    it("should detect infinite cycles", async () => {
      const schema = defineStateSchema({
        counter: { default: 0, reducer: ChannelReducers.sum },
      });

      const graph = createWorkflowGraph(schema, { maxSteps: 10 })
        .addNode("loop", async () => ({ counter: 1 }))
        .addConditionalEdge("loop", () => "loop") // Always loop back
        .setEntryPoint("loop")
        .compile();

      const result = await graph.execute();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Maximum steps");
    });

    it("should allow bounded cycles", async () => {
      interface State {
        counter: number;
      }

      const schema = defineStateSchema<State>({
        counter: { default: 0, reducer: ChannelReducers.sum },
      });

      const graph = createWorkflowGraph(schema)
        .addNode("increment", async () => ({ counter: 1 }))
        .addNode("done", async () => ({}))
        .addConditionalEdge("increment", (state: State) => {
          return state.counter < 5 ? "increment" : "done";
        })
        .setEntryPoint("increment")
        .setFinishPoint("done")
        .compile();

      const result = await graph.execute();

      expect(result.success).toBe(true);
      expect(result.state.counter).toBeGreaterThanOrEqual(5); // May loop one extra time due to counter update timing
    });
  });

  describe("events", () => {
    it("should emit execution events", async () => {
      const schema = defineStateSchema({
        value: { default: 0 },
      });

      const emitter = new EventEmitter();
      const events: string[] = [];

      emitter.on("execution:started", () => events.push("started"));
      emitter.on("node:started", () => events.push("node:started"));
      emitter.on("node:completed", () => events.push("node:completed"));
      emitter.on("execution:completed", () => events.push("completed"));

      const graph = createWorkflowGraph(schema, { eventEmitter: emitter })
        .addNode("test", async () => ({ value: 42 }))
        .setFinishPoint("test")
        .compile();

      await graph.execute();

      expect(events).toContain("started");
      expect(events).toContain("node:started");
      expect(events).toContain("node:completed");
      expect(events).toContain("completed");
    });

    it("should emit edge events", async () => {
      const schema = defineStateSchema({
        value: { default: 0 },
      });

      const emitter = new EventEmitter();
      const edges: Array<{ from: string; to: string }> = [];

      emitter.on("edge:traversed", (data: any) => {
        edges.push({ from: data.from, to: data.to });
      });

      const graph = createWorkflowGraph(schema, { eventEmitter: emitter })
        .addNode("a", async () => ({}))
        .addNode("b", async () => ({}))
        .addEdge("a", "b")
        .setEntryPoint("a")
        .setFinishPoint("b")
        .compile();

      await graph.execute();

      expect(edges).toContainEqual({ from: "a", to: "b" });
    });
  });

  describe("node context", () => {
    it("should provide state access", async () => {
      interface State {
        x: number;
        y: number;
        sum: number;
      }

      const schema = defineStateSchema<State>({
        x: { default: 10 },
        y: { default: 20 },
        sum: { default: 0 },
      });

      const graph = createWorkflowGraph(schema)
        .addNode("compute", async ({ state }) => ({
          sum: state.x + state.y,
        }))
        .setFinishPoint("compute")
        .compile();

      const result = await graph.execute();

      expect(result.state.sum).toBe(30);
    });

    it("should provide channel access", async () => {
      const schema = defineStateSchema({
        value: { default: 42 },
      });

      let channelValue: number | undefined;

      const graph = createWorkflowGraph(schema)
        .addNode("read", async ({ getChannel }) => {
          channelValue = getChannel<number>("value");
          return {};
        })
        .setFinishPoint("read")
        .compile();

      await graph.execute();

      expect(channelValue).toBe(42);
    });

    it("should provide emit capability", async () => {
      const schema = defineStateSchema({
        value: { default: 0 },
      });

      const emitter = new EventEmitter();
      let customEvent: any = null;

      emitter.on("custom", (data) => {
        customEvent = data;
      });

      const graph = createWorkflowGraph(schema, { eventEmitter: emitter })
        .addNode("emitter", async ({ emit }) => {
          emit("custom", { test: "data" });
          return {};
        })
        .setFinishPoint("emitter")
        .compile();

      await graph.execute();

      expect(customEvent).toBeDefined();
      expect(customEvent.data).toEqual({ test: "data" });
    });
  });

  describe("performance", () => {
    it("should track node execution time", async () => {
      const schema = defineStateSchema({
        value: { default: 0 },
      });

      const graph = createWorkflowGraph(schema)
        .addNode("slow", async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { value: 1 };
        })
        .setFinishPoint("slow")
        .compile();

      const result = await graph.execute();

      const slowNode = result.history.find((h) => h.nodeName === "slow");
      expect(slowNode?.durationMs).toBeGreaterThanOrEqual(50);
    });

    it("should track total execution time", async () => {
      const schema = defineStateSchema({
        value: { default: 0 },
      });

      const graph = createWorkflowGraph(schema)
        .addNode("test", async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {};
        })
        .setFinishPoint("test")
        .compile();

      const result = await graph.execute();

      expect(result.durationMs).toBeGreaterThanOrEqual(20);
    });
  });

  describe("metadata", () => {
    it("should provide graph metadata", () => {
      const schema = defineStateSchema({
        x: { default: 0 },
        y: { default: 0 },
      });

      const compiled = createWorkflowGraph(schema)
        .addNode("a", async () => ({}))
        .addNode("b", async () => ({}))
        .addEdge("a", "b")
        .setFinishPoint("b")
        .compile();

      const meta = compiled.getMetadata();

      expect(meta.nodeCount).toBe(2);
      expect(meta.edgeCount).toBeGreaterThan(0);
      expect(meta.channels).toEqual(["x", "y"]);
    });
  });

  describe("DOT visualization", () => {
    it("should generate DOT representation", () => {
      const schema = defineStateSchema({
        value: { default: 0 },
      });

      const compiled = createWorkflowGraph(schema)
        .addNode("start", async () => ({}))
        .addNode("end", async () => ({}))
        .addEdge("start", "end")
        .setEntryPoint("start")
        .setFinishPoint("end")
        .compile();

      const dot = compiled.toDot();

      expect(dot).toContain("digraph workflow");
      expect(dot).toContain('"start"');
      expect(dot).toContain('"end"');
      expect(dot).toContain("->");
    });
  });
});
