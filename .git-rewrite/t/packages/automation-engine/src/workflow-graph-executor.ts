// ============================================================================
// @dantecode/automation-engine — Workflow Graph Executor
// Runtime execution engine for compiled workflows
// ============================================================================

import { randomUUID } from "node:crypto";
import type {
  WorkflowGraphConfig,
  WorkflowNode,
  WorkflowEdge,
  CompiledWorkflowGraph,
  ExecutionOptions,
  ExecutionResult,
  NodeExecutionResult,
  GraphExecutionContext,
  NodeContext,
  WorkflowGraphEvents,
} from "./workflow-graph-types.js";
import { START_NODE, END_NODE } from "./workflow-graph-types.js";
import {
  initializeGraphState,
  applyStateUpdates,
  getStateSnapshot,
  getChannelValue,
  cloneGraphState,
} from "./workflow-graph-state.js";

/**
 * Workflow graph executor - executes compiled graphs.
 */
export class WorkflowGraphExecutor<TState = unknown> implements CompiledWorkflowGraph<TState> {
  constructor(
    private readonly nodes: Map<string, WorkflowNode<TState>>,
    private readonly edges: WorkflowEdge<TState>[],
    private readonly config: WorkflowGraphConfig<TState>,
  ) {}

  /**
   * Execute the workflow.
   */
  async execute(options: ExecutionOptions<TState> = {}): Promise<ExecutionResult<TState>> {
    const executionId = randomUUID();
    const startTime = Date.now();

    // Initialize state
    let graphState = initializeGraphState(this.config.stateSchema);

    // Apply initial input
    if (options.input) {
      applyStateUpdates(graphState, options.input);
    }

    // Resume from checkpoint if provided
    if (options.checkpointId) {
      // Load checkpoint (implementation depends on checkpoint storage)
      // For now, we just mark it
      graphState.checkpointId = options.checkpointId;
    }

    const context: GraphExecutionContext<TState> = {
      executionId,
      state: graphState,
      pendingNodes: [START_NODE],
      history: [],
      startTime,
    };

    this.emit("execution:started", { executionId, input: options.input || {} });

    try {
      // Main execution loop
      const maxSteps = options.maxSteps ?? this.config.maxSteps ?? 1000;
      let stepCount = 0;

      while (context.pendingNodes.length > 0 && stepCount < maxSteps) {
        const nodeName = context.pendingNodes.shift()!;

        // Check if we've reached the end
        if (nodeName === END_NODE) {
          break;
        }

        // Execute node
        const result = await this.executeNode(nodeName, context, options.debug);

        context.history.push(result);
        stepCount++;

        // Handle execution error
        if (result.error) {
          this.emit("node:failed", {
            nodeName,
            error: result.error,
            step: context.state.step,
          });

          // Check if node has retry policy
          const node = this.nodes.get(nodeName);
          if (node?.metadata?.retryPolicy) {
            const shouldRetry = await this.handleRetry(nodeName, result, context);
            if (shouldRetry) {
              context.pendingNodes.unshift(nodeName);
              continue;
            }
          }

          throw result.error;
        }

        // Apply state updates
        if (Object.keys(result.updates).length > 0) {
          applyStateUpdates(context.state, result.updates);
        }

        this.emit("node:completed", result);

        // Checkpoint if configured
        if (this.config.checkpointAfterNode) {
          await this.createCheckpoint(context);
        }

        // Determine next nodes
        context.pendingNodes.push(...result.nextNodes);
      }

      // Check for cycle/max steps
      if (stepCount >= maxSteps) {
        this.emit("cycle:detected", {
          path: context.history.map((h) => h.nodeName),
        });
        throw new Error(`Maximum steps (${maxSteps}) exceeded - possible cycle detected`);
      }

      const finalState = getStateSnapshot<TState>(context.state);
      const durationMs = Date.now() - startTime;

      const result: ExecutionResult<TState> = {
        executionId,
        state: finalState,
        history: context.history,
        durationMs,
        success: true,
        checkpointId: context.state.checkpointId,
      };

      this.emit("execution:completed", result);

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      this.emit("execution:failed", { executionId, error: err });

      return {
        executionId,
        state: getStateSnapshot<TState>(context.state),
        history: context.history,
        durationMs: Date.now() - startTime,
        success: false,
        error: err,
      };
    }
  }

  /**
   * Execute a single node.
   */
  private async executeNode(
    nodeName: string,
    context: GraphExecutionContext<TState>,
    _debug?: boolean,
  ): Promise<NodeExecutionResult<TState>> {
    const node = this.nodes.get(nodeName);
    if (!node) {
      throw new Error(`Node '${nodeName}' not found`);
    }

    const startTime = Date.now();
    this.emit("node:started", { nodeName, step: context.state.step });

    try {
      // Create node context
      const nodeContext: NodeContext<TState> = {
        state: getStateSnapshot<TState>(context.state),
        nodeName,
        step: context.state.step,
        getChannel: <T>(name: string) => getChannelValue<T>(context.state, name),
        emit: (event: string, data?: unknown) => {
          this.config.eventEmitter?.emit(event, { nodeName, data });
        },
      };

      // Execute with timeout
      const timeout = node.metadata?.timeout ?? this.config.nodeTimeout ?? 30000;
      const result = node.fn(nodeContext);
      const updates = await this.executeWithTimeout(Promise.resolve(result), timeout);

      // Determine next nodes from edges
      const state = getStateSnapshot<TState>(context.state);
      const nextNodes = await this.resolveNextNodes(nodeName, state);

      const durationMs = Date.now() - startTime;

      return {
        nodeName,
        updates,
        durationMs,
        nextNodes,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startTime;

      return {
        nodeName,
        updates: {},
        durationMs,
        error: err,
        nextNodes: [],
      };
    }
  }

  /**
   * Execute function with timeout.
   */
  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Node execution timeout (${timeoutMs}ms)`)), timeoutMs),
      ),
    ]);
  }

  /**
   * Resolve next nodes from edges.
   */
  private async resolveNextNodes(nodeName: string, state: TState): Promise<string[]> {
    const nextNodes: string[] = [];

    for (const edge of this.edges) {
      if (edge.from !== nodeName) {
        continue;
      }

      if (edge.to) {
        // Direct edge
        nextNodes.push(edge.to);
        this.emit("edge:traversed", { from: nodeName, to: edge.to, step: 0 });
      } else if (edge.condition) {
        // Conditional edge
        const result = await edge.condition(state, nodeName);

        this.emit("edge:evaluated", {
          from: nodeName,
          condition: edge.label || "unnamed",
          result,
        });

        if (result) {
          const targets = Array.isArray(result) ? result : [result];
          nextNodes.push(...targets);

          for (const target of targets) {
            this.emit("edge:traversed", { from: nodeName, to: target, step: 0 });
          }
        }
      }
    }

    return nextNodes;
  }

  /**
   * Handle node retry logic.
   */
  private async handleRetry(
    nodeName: string,
    _result: NodeExecutionResult<TState>,
    context: GraphExecutionContext<TState>,
  ): Promise<boolean> {
    const node = this.nodes.get(nodeName);
    const retryPolicy = node?.metadata?.retryPolicy;

    if (!retryPolicy) {
      return false;
    }

    // Count previous retries
    const retries = context.history.filter((h) => h.nodeName === nodeName && h.error).length;

    if (retries >= retryPolicy.maxRetries) {
      return false;
    }

    // Calculate backoff delay
    const delay = retryPolicy.delayMs ?? 1000;
    const backoffDelay =
      retryPolicy.backoff === "exponential" ? delay * Math.pow(2, retries) : delay * (retries + 1);

    await new Promise((resolve) => setTimeout(resolve, backoffDelay));

    return true;
  }

  /**
   * Create checkpoint.
   */
  private async createCheckpoint(context: GraphExecutionContext<TState>): Promise<void> {
    const checkpointId = randomUUID();
    const clonedState = cloneGraphState(context.state);
    clonedState.checkpointId = checkpointId;

    this.emit("checkpoint:created", {
      checkpointId,
      step: context.state.step,
    });

    // Store checkpoint (if callback provided)
    if (context.checkpoint) {
      await context.checkpoint(clonedState);
    }

    context.state.checkpointId = checkpointId;
  }

  /**
   * Stream execution events.
   */
  async *stream(
    options: ExecutionOptions<TState> = {},
  ): AsyncGenerator<WorkflowGraphEvents<TState>[keyof WorkflowGraphEvents<TState>]> {
    const events: Array<WorkflowGraphEvents<TState>[keyof WorkflowGraphEvents<TState>]> = [];
    const emitter = this.config.eventEmitter;

    if (!emitter) {
      throw new Error("Event emitter not configured");
    }

    // Collect events
    const eventHandler = (_event: keyof WorkflowGraphEvents<TState>, data: unknown) => {
      events.push(data as WorkflowGraphEvents<TState>[keyof WorkflowGraphEvents<TState>]);
    };

    // Listen to all events
    const eventTypes: Array<keyof WorkflowGraphEvents<TState>> = [
      "execution:started",
      "node:started",
      "node:completed",
      "node:failed",
      "edge:traversed",
      "edge:evaluated",
      "state:updated",
      "checkpoint:created",
      "execution:completed",
      "execution:failed",
    ];

    for (const eventType of eventTypes) {
      emitter.on(eventType, (data) =>
        eventHandler(eventType as keyof WorkflowGraphEvents<TState>, data),
      );
    }

    // Execute in background
    const executionPromise = this.execute(options);

    // Yield events as they come
    while (
      events.length > 0 ||
      !(await Promise.race([executionPromise.then(() => true), Promise.resolve(false)]))
    ) {
      if (events.length > 0) {
        yield events.shift()!;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    // Clean up listeners
    for (const eventType of eventTypes) {
      emitter.removeAllListeners(eventType);
    }
  }

  /**
   * Get DOT representation for visualization.
   */
  toDot(): string {
    const lines: string[] = ["digraph workflow {"];
    lines.push("  rankdir=LR;");
    lines.push("  node [shape=box];");

    // Add nodes
    for (const [name, node] of this.nodes) {
      if (name === START_NODE || name === END_NODE) {
        lines.push(`  "${name}" [shape=circle];`);
      } else {
        const label = node.metadata?.description || name;
        lines.push(`  "${name}" [label="${label}"];`);
      }
    }

    // Add edges
    for (const edge of this.edges) {
      const label = edge.label ? ` [label="${edge.label}"]` : "";
      if (edge.to) {
        lines.push(`  "${edge.from}" -> "${edge.to}"${label};`);
      } else if (edge.condition) {
        lines.push(`  "${edge.from}" -> "?" [style=dashed${label.replace("]", ", color=blue]")}];`);
      }
    }

    lines.push("}");
    return lines.join("\n");
  }

  /**
   * Get graph metadata.
   */
  getMetadata(): {
    nodeCount: number;
    edgeCount: number;
    channels: string[];
  } {
    const state = initializeGraphState(this.config.stateSchema);

    return {
      nodeCount: this.nodes.size - 2, // Exclude START and END
      edgeCount: this.edges.length,
      channels: Array.from(state.channels.keys()),
    };
  }

  /**
   * Emit event via EventEmitter.
   */
  private emit<K extends keyof WorkflowGraphEvents<TState>>(
    event: K,
    data: WorkflowGraphEvents<TState>[K],
  ): void {
    this.config.eventEmitter?.emit(event, data);
  }
}
