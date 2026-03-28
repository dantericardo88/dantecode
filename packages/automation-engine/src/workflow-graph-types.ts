// ============================================================================
// @dantecode/automation-engine — Workflow Graph Types
// LangGraph-inspired graph-based workflow execution with channels and edges
// ============================================================================

import type { EventEmitter } from "node:events";

// ----------------------------------------------------------------------------
// Core State Management
// ----------------------------------------------------------------------------

/**
 * State channel for data flow between nodes.
 * Channels can have reducers to aggregate multiple updates.
 */
export interface StateChannel<T = unknown> {
  /** Channel name/key. */
  readonly name: string;
  /** Current value. */
  value: T | undefined;
  /** Version number for conflict detection. */
  version: number;
  /** Reducer function to merge multiple updates. */
  readonly reducer?: (current: T, update: T) => T;
  /** Whether this is a managed channel (like barriers). */
  readonly managed?: boolean;
}

/**
 * Reducer functions for common aggregation patterns.
 */
export const ChannelReducers = {
  /** Always keep the last value (default). */
  lastValue: <T>(_current: T, update: T): T => update,

  /** Append to array. */
  append: <T>(current: T[], update: T | T[]): T[] => {
    const arr = Array.isArray(update) ? update : [update];
    return [...current, ...arr];
  },

  /** Merge objects (shallow). */
  merge: <T extends Record<string, unknown>>(current: T, update: Partial<T>): T => ({
    ...current,
    ...update,
  }),

  /** Sum numbers. */
  sum: (current: number, update: number): number => current + update,

  /** Set union. */
  union: <T>(current: Set<T>, update: Set<T> | T[]): Set<T> => {
    const result = new Set(current);
    const items = Array.isArray(update) ? update : update;
    for (const item of items) {
      result.add(item);
    }
    return result;
  },
} as const;

/**
 * Graph state - collection of named channels.
 */
export interface GraphState {
  readonly channels: Map<string, StateChannel>;
  /** Current execution step. */
  step: number;
  /** Checkpoint ID for resumption. */
  checkpointId?: string;
}

// ----------------------------------------------------------------------------
// Node Definition
// ----------------------------------------------------------------------------

/**
 * Node input context with state access.
 */
export interface NodeContext<TState = unknown> {
  /** Current state snapshot. */
  readonly state: TState;
  /** Node name. */
  readonly nodeName: string;
  /** Execution step. */
  readonly step: number;
  /** Get channel value by name. */
  getChannel<T>(name: string): T | undefined;
  /** Emit event for observability. */
  emit(event: string, data?: unknown): void;
}

/**
 * Node execution function signature.
 */
export type NodeFunction<TState = unknown, TOutput = Partial<TState>> = (
  context: NodeContext<TState>,
) => TOutput | Promise<TOutput>;

/**
 * Node definition.
 */
export interface WorkflowNode<TState = unknown> {
  /** Unique node name. */
  readonly name: string;
  /** Execution function. */
  readonly fn: NodeFunction<TState>;
  /** Node metadata. */
  readonly metadata?: {
    description?: string;
    tags?: string[];
    timeout?: number;
    retryPolicy?: {
      maxRetries: number;
      backoff?: "linear" | "exponential";
      delayMs?: number;
    };
  };
}

// ----------------------------------------------------------------------------
// Edge Definition
// ----------------------------------------------------------------------------

/**
 * Conditional edge evaluation function.
 */
export type EdgeCondition<TState = unknown> = (
  state: TState,
  nodeName: string,
) => string | string[] | null | Promise<string | string[] | null>;

/**
 * Edge types:
 * - "direct": Always follow this edge
 * - "conditional": Evaluate condition to determine next node(s)
 */
export interface WorkflowEdge<TState = unknown> {
  /** Source node name. */
  readonly from: string;
  /** Target node name (for direct edges). */
  readonly to?: string;
  /** Condition function (for conditional edges). */
  readonly condition?: EdgeCondition<TState>;
  /** Edge label for debugging. */
  readonly label?: string;
  /** Edge metadata. */
  readonly metadata?: {
    description?: string;
    weight?: number;
  };
}

// ----------------------------------------------------------------------------
// Graph Definition
// ----------------------------------------------------------------------------

/**
 * Special node names.
 */
export const START_NODE = "__start__";
export const END_NODE = "__end__";

/**
 * Graph configuration.
 */
export interface WorkflowGraphConfig<TState = unknown> {
  /** State schema - defines channels. */
  stateSchema: StateSchemaDefinition<TState>;
  /** Entry point node (defaults to START_NODE). */
  entryPoint?: string;
  /** Whether to checkpoint after each node. */
  checkpointAfterNode?: boolean;
  /** Maximum execution steps (cycle protection). */
  maxSteps?: number;
  /** Timeout per node (milliseconds). */
  nodeTimeout?: number;
  /** Event emitter for observability. */
  eventEmitter?: EventEmitter;
}

/**
 * State schema definition - maps channel names to their configuration.
 */
export type StateSchemaDefinition<TState = unknown> = {
  [K in keyof TState]: StateChannelConfig<TState[K]>;
};

/**
 * Configuration for a single state channel.
 */
export interface StateChannelConfig<T> {
  /** Default value. */
  default: T;
  /** Optional reducer for aggregating updates. */
  reducer?: (current: T, update: T) => T;
  /** Whether this is a managed channel. */
  managed?: boolean;
}

// ----------------------------------------------------------------------------
// Execution Types
// ----------------------------------------------------------------------------

/**
 * Node execution result.
 */
export interface NodeExecutionResult<TState = unknown> {
  /** Node that executed. */
  nodeName: string;
  /** State updates produced. */
  updates: Partial<TState>;
  /** Execution time (milliseconds). */
  durationMs: number;
  /** Error if execution failed. */
  error?: Error;
  /** Next node(s) to execute. */
  nextNodes: string[];
}

/**
 * Graph execution context.
 */
export interface GraphExecutionContext<TState = unknown> {
  /** Execution ID. */
  readonly executionId: string;
  /** Current state. */
  state: GraphState;
  /** Pending nodes to execute. */
  pendingNodes: string[];
  /** Execution history. */
  history: NodeExecutionResult<TState>[];
  /** Start time. */
  startTime: number;
  /** Checkpoint callback. */
  checkpoint?: (state: GraphState) => Promise<void>;
}

/**
 * Execution options.
 */
export interface ExecutionOptions<TState = unknown> {
  /** Initial state/input. */
  input?: Partial<TState>;
  /** Resume from checkpoint. */
  checkpointId?: string;
  /** Maximum steps. */
  maxSteps?: number;
  /** Timeout (milliseconds). */
  timeout?: number;
  /** Enable debug mode. */
  debug?: boolean;
}

/**
 * Execution result.
 */
export interface ExecutionResult<TState = unknown> {
  /** Execution ID. */
  executionId: string;
  /** Final state. */
  state: TState;
  /** Execution history. */
  history: NodeExecutionResult<TState>[];
  /** Total duration (milliseconds). */
  durationMs: number;
  /** Whether execution completed successfully. */
  success: boolean;
  /** Error if execution failed. */
  error?: Error;
  /** Checkpoint ID if saved. */
  checkpointId?: string;
}

// ----------------------------------------------------------------------------
// Events
// ----------------------------------------------------------------------------

/**
 * Workflow graph events for observability.
 */
export interface WorkflowGraphEvents<TState = unknown> {
  /** Graph compilation completed. */
  "graph:compiled": { nodeCount: number; edgeCount: number };
  /** Execution started. */
  "execution:started": { executionId: string; input: Partial<TState> };
  /** Node execution started. */
  "node:started": { nodeName: string; step: number };
  /** Node execution completed. */
  "node:completed": NodeExecutionResult<TState>;
  /** Node execution failed. */
  "node:failed": { nodeName: string; error: Error; step: number };
  /** Edge traversed. */
  "edge:traversed": { from: string; to: string; step: number };
  /** Conditional edge evaluated. */
  "edge:evaluated": { from: string; condition: string; result: string | string[] | null };
  /** State updated. */
  "state:updated": { channel: string; value: unknown; step: number };
  /** Checkpoint created. */
  "checkpoint:created": { checkpointId: string; step: number };
  /** Execution completed. */
  "execution:completed": ExecutionResult<TState>;
  /** Execution failed. */
  "execution:failed": { executionId: string; error: Error };
  /** Cycle detected. */
  "cycle:detected": { path: string[] };
}

// ----------------------------------------------------------------------------
// Subgraph Support
// ----------------------------------------------------------------------------

/**
 * Subgraph node - allows nesting workflows.
 */
export interface SubgraphNode<TState = unknown, TSubState = unknown> {
  type: "subgraph";
  name: string;
  /** Child workflow graph. */
  graph: CompiledWorkflowGraph<TSubState>;
  /** Map parent state to child input. */
  inputMapper: (parentState: TState) => Partial<TSubState>;
  /** Map child output to parent state updates. */
  outputMapper: (childState: TSubState, parentState: TState) => Partial<TState>;
}

// ----------------------------------------------------------------------------
// Compiled Graph
// ----------------------------------------------------------------------------

/**
 * Compiled workflow graph ready for execution.
 */
export interface CompiledWorkflowGraph<TState = unknown> {
  /** Execute the workflow. */
  execute(options?: ExecutionOptions<TState>): Promise<ExecutionResult<TState>>;
  /** Stream execution events. */
  stream(options?: ExecutionOptions<TState>): AsyncGenerator<WorkflowGraphEvents<TState>[keyof WorkflowGraphEvents<TState>]>;
  /** Get DOT representation for visualization. */
  toDot(): string;
  /** Get graph metadata. */
  getMetadata(): {
    nodeCount: number;
    edgeCount: number;
    channels: string[];
  };
}
