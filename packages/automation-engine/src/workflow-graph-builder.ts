// ============================================================================
// @dantecode/automation-engine — Workflow Graph Builder
// Declarative DSL for building graph-based workflows
// ============================================================================

import { EventEmitter } from "node:events";
import type {
  WorkflowGraphConfig,
  WorkflowNode,
  WorkflowEdge,
  NodeFunction,
  EdgeCondition,
  StateSchemaDefinition,
  CompiledWorkflowGraph,
} from "./workflow-graph-types.js";
import { START_NODE, END_NODE } from "./workflow-graph-types.js";
import { WorkflowGraphExecutor } from "./workflow-graph-executor.js";

/**
 * Workflow graph builder - declarative API for constructing workflows.
 */
export class WorkflowGraph<TState = unknown> {
  private nodes = new Map<string, WorkflowNode<TState>>();
  private edges: WorkflowEdge<TState>[] = [];
  private entryPoint: string = START_NODE;
  private readonly config: WorkflowGraphConfig<TState>;
  private compiled = false;

  constructor(config: WorkflowGraphConfig<TState>) {
    this.config = {
      ...config,
      eventEmitter: config.eventEmitter || new EventEmitter(),
      maxSteps: config.maxSteps ?? 1000,
      nodeTimeout: config.nodeTimeout ?? 30000,
      checkpointAfterNode: config.checkpointAfterNode ?? true,
    };

    // Add implicit start and end nodes
    this.addNode(START_NODE, async () => ({}) as Partial<TState>);
    this.addNode(END_NODE, async () => ({}) as Partial<TState>);
  }

  /**
   * Add a node to the graph.
   */
  addNode(
    name: string,
    fn: NodeFunction<TState>,
    metadata?: WorkflowNode<TState>["metadata"],
  ): this {
    if (this.compiled) {
      throw new Error("Cannot modify graph after compilation");
    }

    if (this.nodes.has(name)) {
      throw new Error(`Node '${name}' already exists`);
    }

    this.nodes.set(name, { name, fn, metadata });
    return this;
  }

  /**
   * Add a direct edge between two nodes.
   */
  addEdge(from: string, to: string, label?: string): this {
    if (this.compiled) {
      throw new Error("Cannot modify graph after compilation");
    }

    this.edges.push({
      from,
      to,
      label,
    });

    return this;
  }

  /**
   * Add a conditional edge that branches based on state.
   */
  addConditionalEdge(from: string, condition: EdgeCondition<TState>, label?: string): this {
    if (this.compiled) {
      throw new Error("Cannot modify graph after compilation");
    }

    this.edges.push({
      from,
      condition,
      label,
    });

    return this;
  }

  /**
   * Set the entry point node.
   */
  setEntryPoint(name: string): this {
    if (this.compiled) {
      throw new Error("Cannot modify graph after compilation");
    }

    if (!this.nodes.has(name) && name !== START_NODE) {
      throw new Error(`Entry point node '${name}' does not exist`);
    }

    this.entryPoint = name;
    return this;
  }

  /**
   * Add an edge from a node to the end.
   */
  setFinishPoint(from: string): this {
    return this.addEdge(from, END_NODE);
  }

  /**
   * Compile the graph into an executable workflow.
   */
  compile(): CompiledWorkflowGraph<TState> {
    if (this.compiled) {
      throw new Error("Graph already compiled");
    }

    // Ensure entry point connects to graph BEFORE validation
    if (this.entryPoint === START_NODE) {
      const firstNode = Array.from(this.nodes.keys()).find(
        (name) => name !== START_NODE && name !== END_NODE,
      );
      if (firstNode) {
        this.addEdge(START_NODE, firstNode);
      }
    } else {
      this.addEdge(START_NODE, this.entryPoint);
    }

    // Validate graph structure AFTER connecting START
    this.validate();

    this.compiled = true;

    const executor = new WorkflowGraphExecutor<TState>(this.nodes, this.edges, this.config);

    this.config.eventEmitter?.emit("graph:compiled", {
      nodeCount: this.nodes.size - 2, // Exclude START and END
      edgeCount: this.edges.length,
    });

    return executor;
  }

  /**
   * Validate graph structure.
   */
  private validate(): void {
    const errors: string[] = [];

    // Check all edges reference existing nodes
    for (const edge of this.edges) {
      if (!this.nodes.has(edge.from)) {
        errors.push(`Edge source '${edge.from}' does not exist`);
      }
      if (edge.to && !this.nodes.has(edge.to)) {
        errors.push(`Edge target '${edge.to}' does not exist`);
      }
    }

    // Check for unreachable nodes
    const reachable = this.findReachableNodes();
    for (const nodeName of this.nodes.keys()) {
      if (nodeName !== START_NODE && !reachable.has(nodeName)) {
        errors.push(`Node '${nodeName}' is unreachable from entry point`);
      }
    }

    // Check END node is reachable
    if (!reachable.has(END_NODE)) {
      errors.push("END node is not reachable - no finish point set");
    }

    if (errors.length > 0) {
      throw new Error(`Graph validation failed:\n${errors.join("\n")}`);
    }
  }

  /**
   * Find all nodes reachable from the entry point.
   */
  private findReachableNodes(): Set<string> {
    const reachable = new Set<string>();
    const queue = [START_NODE];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) {
        continue;
      }

      reachable.add(current);

      // Find outgoing edges
      for (const edge of this.edges) {
        if (edge.from === current) {
          if (edge.to) {
            queue.push(edge.to);
          }
          // Conditional edges can lead anywhere, mark as reachable
          if (edge.condition) {
            for (const nodeName of this.nodes.keys()) {
              if (!reachable.has(nodeName)) {
                queue.push(nodeName);
              }
            }
          }
        }
      }
    }

    return reachable;
  }

  /**
   * Get graph metadata (for debugging).
   */
  getMetadata(): {
    nodeCount: number;
    edgeCount: number;
    entryPoint: string;
    nodes: string[];
    compiled: boolean;
  } {
    return {
      nodeCount: this.nodes.size - 2,
      edgeCount: this.edges.length,
      entryPoint: this.entryPoint,
      nodes: Array.from(this.nodes.keys()).filter(
        (name) => name !== START_NODE && name !== END_NODE,
      ),
      compiled: this.compiled,
    };
  }
}

/**
 * Helper function to create a workflow graph.
 */
export function createWorkflowGraph<TState>(
  stateSchema: StateSchemaDefinition<TState>,
  options?: Partial<Omit<WorkflowGraphConfig<TState>, "stateSchema">>,
): WorkflowGraph<TState> {
  return new WorkflowGraph<TState>({
    stateSchema,
    ...options,
  });
}
