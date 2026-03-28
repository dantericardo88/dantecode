// ============================================================================
// @dantecode/automation-engine — Workflow Graph Checkpointing
// Integration with DanteCode's EventSourcedCheckpointer
// ============================================================================

import { EventSourcedCheckpointer } from "@dantecode/core";
import type { GraphState } from "./workflow-graph-types.js";
import { serializeGraphState, deserializeGraphState } from "./workflow-graph-state.js";
import type { StateSchemaDefinition } from "./workflow-graph-types.js";

/**
 * Checkpoint adapter for workflow graphs.
 */
export class WorkflowGraphCheckpointer<TState = unknown> {
  private readonly projectRoot: string;
  private readonly schema: StateSchemaDefinition<TState>;
  private readonly baseDir?: string;
  private readonly maxEventsBeforeCompaction?: number;

  constructor(
    projectRoot: string,
    schema: StateSchemaDefinition<TState>,
    options?: {
      baseDir?: string;
      maxEventsBeforeCompaction?: number;
    },
  ) {
    this.projectRoot = projectRoot;
    this.schema = schema;
    this.baseDir = options?.baseDir;
    this.maxEventsBeforeCompaction = options?.maxEventsBeforeCompaction;
  }

  /**
   * Get or create checkpointer for a session.
   */
  private getCheckpointer(sessionId: string): EventSourcedCheckpointer {
    return new EventSourcedCheckpointer(this.projectRoot, sessionId, {
      baseDir: this.baseDir,
      maxEventsBeforeCompaction: this.maxEventsBeforeCompaction,
    });
  }

  /**
   * Save workflow graph state as checkpoint.
   */
  async save(
    sessionId: string,
    graphState: GraphState,
    metadata?: {
      workflowName?: string;
      executionId?: string;
      nodeName?: string;
    },
  ): Promise<string> {
    const checkpointer = this.getCheckpointer(sessionId);
    const serialized = serializeGraphState(graphState);
    const channelValues = JSON.parse(serialized);

    const checkpointId = await checkpointer.put(
      channelValues,
      {
        source: "loop",
        step: graphState.step,
        extra: metadata,
      },
      this.extractChannelVersions(graphState),
    );

    return checkpointId;
  }

  /**
   * Load workflow graph state from checkpoint.
   */
  async load(sessionId: string, checkpointId?: string): Promise<GraphState | null> {
    const checkpointer = this.getCheckpointer(sessionId);
    const tuple = await checkpointer.getTuple();
    if (!tuple) {
      return null;
    }

    // Use checkpointId if provided (future enhancement)
    void checkpointId;

    const serialized = JSON.stringify(tuple.checkpoint.channelValues);
    return deserializeGraphState(serialized, this.schema);
  }

  /**
   * List checkpoints for a session.
   * Note: EventSourcedCheckpointer keeps only the latest checkpoint per session.
   * This returns at most one checkpoint.
   */
  async list(
    sessionId: string,
    _limit = 10,
  ): Promise<
    Array<{
      checkpointId: string;
      step: number;
      timestamp: string;
      metadata?: Record<string, unknown>;
    }>
  > {
    const checkpointer = this.getCheckpointer(sessionId);
    const tuple = await checkpointer.getTuple();

    if (!tuple) {
      return [];
    }

    return [
      {
        checkpointId: tuple.checkpoint.id,
        step: tuple.checkpoint.step,
        timestamp: tuple.checkpoint.ts,
        metadata: tuple.metadata.extra,
      },
    ];
  }

  /**
   * Delete checkpoints for a session.
   */
  async delete(_sessionId: string): Promise<void> {
    // EventSourcedCheckpointer doesn't have explicit delete,
    // but we can implement cleanup if needed
    // For now, this is a no-op
  }

  /**
   * Extract channel versions from graph state.
   */
  private extractChannelVersions(graphState: GraphState): Record<string, number> {
    const versions: Record<string, number> = {};
    for (const [name, channel] of graphState.channels) {
      versions[name] = channel.version;
    }
    return versions;
  }

  /**
   * Create a checkpoint callback for execution context.
   */
  createCheckpointCallback(
    sessionId: string,
    metadata?: Record<string, unknown>,
  ): (state: GraphState) => Promise<void> {
    return async (state: GraphState) => {
      await this.save(sessionId, state, metadata);
    };
  }
}
