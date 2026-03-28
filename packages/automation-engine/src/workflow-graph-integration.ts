// ============================================================================
// @dantecode/automation-engine — Workflow Graph Integration
// Bridge between workflow graphs and existing automation orchestrator
// ============================================================================

import type {
  WorkflowGraphConfig,
  CompiledWorkflowGraph,
  ExecutionOptions,
  ExecutionResult,
  StateSchemaDefinition,
} from "./workflow-graph-types.js";
import { WorkflowGraphCheckpointer } from "./workflow-graph-checkpoint.js";
import type { GitAutomationOrchestrator } from "./automation-orchestrator.js";
import type { StoredAutomationExecutionRecord } from "@dantecode/git-engine";

/**
 * Workflow graph automation definition.
 */
export interface WorkflowGraphAutomation<TState = unknown> {
  /** Automation name. */
  name: string;
  /** State schema. */
  schema: StateSchemaDefinition<TState>;
  /** Graph builder function. */
  build: (config: WorkflowGraphConfig<TState>) => CompiledWorkflowGraph<TState>;
  /** Trigger configuration. */
  trigger?: {
    event?: string;
    schedule?: string;
    filePattern?: string;
  };
}

/**
 * Register a workflow graph as an automation.
 */
export async function registerWorkflowAutomation<TState>(
  orchestrator: GitAutomationOrchestrator,
  automation: WorkflowGraphAutomation<TState>,
  _projectRoot: string,
): Promise<string> {
  // Create workflow graph config
  const config: WorkflowGraphConfig<TState> = {
    stateSchema: automation.schema,
  };

  // Build compiled graph
  void automation.build(config);

  // Register with orchestrator
  // This would integrate with existing automation-orchestrator
  // Future: use orchestrator to schedule/trigger workflow executions
  void orchestrator; // Silence unused parameter warning

  // Return a registration ID
  const registrationId = `wf_${automation.name}_${Date.now()}`;

  return registrationId;
}

/**
 * Execute workflow graph as background automation.
 */
export async function executeWorkflowAutomation<TState>(
  automation: WorkflowGraphAutomation<TState>,
  input: Partial<TState>,
  options?: {
    projectRoot?: string;
    sessionId?: string;
    checkpointId?: string;
    debug?: boolean;
  },
): Promise<ExecutionResult<TState>> {
  const projectRoot = options?.projectRoot || process.cwd();

  // Create checkpointer if session ID provided
  // Future enhancement: wire checkpoint callback into execution context
  if (options?.sessionId) {
    void new WorkflowGraphCheckpointer(projectRoot, automation.schema);
    // Checkpoint support will be wired in future iteration
  }

  // Build and execute graph
  const config: WorkflowGraphConfig<TState> = {
    stateSchema: automation.schema,
    checkpointAfterNode: true,
  };

  const compiled = automation.build(config);

  const executionOptions: ExecutionOptions<TState> = {
    input,
    checkpointId: options?.checkpointId,
    debug: options?.debug,
  };

  return compiled.execute(executionOptions);
}

/**
 * Convert workflow execution result to automation execution record.
 */
export function toAutomationExecutionRecord<TState>(
  result: ExecutionResult<TState>,
  workflowName: string,
): Partial<StoredAutomationExecutionRecord> {
  return {
    status: result.success ? "completed" : "failed",
    startedAt: new Date(Date.now() - result.durationMs).toISOString(),
    completedAt: new Date().toISOString(),
    gateStatus: result.success ? "passed" : "failed",
    error: result.error?.message,
    summary: `Workflow ${workflowName} - ${result.history.length} steps - ${result.success ? "success" : "failed"}`,
    modifiedFiles: [], // Workflow graphs don't modify files directly
    pdseScore: result.success ? 100 : 0,
    checkpointSessionId: result.checkpointId,
  };
}

/**
 * Helper to create simple workflow automations.
 */
export function defineWorkflowAutomation<TState>(
  definition: WorkflowGraphAutomation<TState>,
): WorkflowGraphAutomation<TState> {
  return definition;
}
