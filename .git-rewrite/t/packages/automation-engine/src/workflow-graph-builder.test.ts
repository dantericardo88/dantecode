// ============================================================================
// @dantecode/automation-engine — Graph Builder Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { WorkflowGraph, createWorkflowGraph } from "./workflow-graph-builder.js";
import { defineStateSchema } from "./workflow-graph-state.js";

describe("workflow-graph-builder", () => {
  describe("WorkflowGraph", () => {
    it("should create graph with state schema", () => {
      const schema = defineStateSchema({
        counter: { default: 0 },
      });

      const graph = new WorkflowGraph({ stateSchema: schema });

      expect(graph).toBeDefined();
      expect(graph.getMetadata().compiled).toBe(false);
    });

    it("should add nodes", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("nodeA", async () => ({ value: 1 }));
      graph.addNode("nodeB", async () => ({ value: 2 }));

      const meta = graph.getMetadata();
      expect(meta.nodes).toContain("nodeA");
      expect(meta.nodes).toContain("nodeB");
      expect(meta.nodeCount).toBe(2);
    });

    it("should reject duplicate node names", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("duplicate", async () => ({}));

      expect(() => {
        graph.addNode("duplicate", async () => ({}));
      }).toThrow("Node 'duplicate' already exists");
    });

    it("should add direct edges", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("nodeA", async () => ({ value: 1 }));
      graph.addNode("nodeB", async () => ({ value: 2 }));
      graph.addEdge("nodeA", "nodeB");

      expect(graph.getMetadata().edgeCount).toBe(1);
    });

    it("should add conditional edges", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("nodeA", async () => ({ value: 1 }));
      graph.addNode("nodeB", async () => ({ value: 2 }));
      graph.addNode("nodeC", async () => ({ value: 3 }));

      graph.addConditionalEdge("nodeA", (state: any) => {
        return state.value > 5 ? "nodeB" : "nodeC";
      });

      expect(graph.getMetadata().edgeCount).toBe(1);
    });

    it("should set entry point", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("start", async () => ({ value: 1 }));
      graph.setEntryPoint("start");

      expect(graph.getMetadata().entryPoint).toBe("start");
    });

    it("should reject non-existent entry point", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      expect(() => {
        graph.setEntryPoint("nonexistent");
      }).toThrow("Entry point node 'nonexistent' does not exist");
    });

    it("should set finish point", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("final", async () => ({ value: 100 }));
      graph.setFinishPoint("final");

      const meta = graph.getMetadata();
      expect(meta.edgeCount).toBe(1); // final -> END
    });

    it("should compile graph", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("nodeA", async () => ({ value: 1 }));
      graph.setEntryPoint("nodeA");
      graph.setFinishPoint("nodeA");

      const compiled = graph.compile();

      expect(compiled).toBeDefined();
      expect(compiled.execute).toBeDefined();
    });

    it("should reject modifications after compilation", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("nodeA", async () => ({ value: 1 }));
      graph.setFinishPoint("nodeA");
      graph.compile();

      expect(() => {
        graph.addNode("nodeB", async () => ({ value: 2 }));
      }).toThrow("Cannot modify graph after compilation");
    });

    it("should validate edge references", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("nodeA", async () => ({ value: 1 }));
      graph.addEdge("nodeA", "nonexistent");

      expect(() => {
        graph.compile();
      }).toThrow(/Edge target 'nonexistent' does not exist/);
    });

    it("should detect unreachable nodes", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("nodeA", async () => ({ value: 1 }));
      graph.addNode("isolated", async () => ({ value: 2 }));
      graph.setEntryPoint("nodeA");
      graph.setFinishPoint("nodeA");

      expect(() => {
        graph.compile();
      }).toThrow(/Node 'isolated' is unreachable/);
    });

    it("should require END node to be reachable", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("nodeA", async () => ({ value: 1 }));
      graph.setEntryPoint("nodeA");
      // No finish point set

      expect(() => {
        graph.compile();
      }).toThrow(/END node is not reachable/);
    });

    it("should support method chaining", () => {
      const schema = defineStateSchema({ value: { default: 0 } });

      const compiled = new WorkflowGraph({ stateSchema: schema })
        .addNode("a", async () => ({ value: 1 }))
        .addNode("b", async () => ({ value: 2 }))
        .addEdge("a", "b")
        .setEntryPoint("a")
        .setFinishPoint("b")
        .compile();

      expect(compiled).toBeDefined();
    });
  });

  describe("createWorkflowGraph", () => {
    it("should create graph with helper function", () => {
      const schema = defineStateSchema({ value: { default: 0 } });

      const graph = createWorkflowGraph(schema, {
        maxSteps: 500,
        nodeTimeout: 5000,
      });

      expect(graph).toBeInstanceOf(WorkflowGraph);
    });
  });

  describe("graph metadata", () => {
    it("should provide accurate metadata", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("a", async () => ({ value: 1 }));
      graph.addNode("b", async () => ({ value: 2 }));
      graph.addNode("c", async () => ({ value: 3 }));
      graph.addEdge("a", "b");
      graph.addEdge("b", "c");

      const meta = graph.getMetadata();

      expect(meta.nodeCount).toBe(3);
      expect(meta.edgeCount).toBe(2);
      expect(meta.nodes).toEqual(["a", "b", "c"]);
      expect(meta.compiled).toBe(false);
    });
  });

  describe("node metadata", () => {
    it("should store node metadata", () => {
      const schema = defineStateSchema({ value: { default: 0 } });
      const graph = new WorkflowGraph({ stateSchema: schema });

      graph.addNode("nodeA", async () => ({ value: 1 }), {
        description: "Test node",
        tags: ["test"],
        timeout: 5000,
        retryPolicy: {
          maxRetries: 3,
          backoff: "exponential",
          delayMs: 1000,
        },
      });

      // Metadata is stored internally, verify compilation succeeds
      graph.setFinishPoint("nodeA");
      const compiled = graph.compile();
      expect(compiled).toBeDefined();
    });
  });
});
