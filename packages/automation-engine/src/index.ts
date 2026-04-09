// ============================================================================
// @dantecode/automation-engine — High-Level Automation Orchestration
// Combines git-engine and core to provide event-driven automation workflows
// ============================================================================

export { GitAutomationOrchestrator } from "./automation-orchestrator.js";
export type {
  AutomationTrigger,
  WorkflowBackgroundRequest,
  AutoPullRequestRequest,
  QueuedAutomationRun,
  GitAutomationOrchestratorOptions,
  GateEvaluator,
  GateEvaluationResult,
  AutomationMemoryRecord,
} from "./automation-orchestrator.js";

export {
  runAutomationAgent,
  substitutePromptVars,
  PDSE_GATE_THRESHOLD,
} from "./automation-agent-bridge.js";
export type { AgentBridgeConfig, AgentBridgeResult } from "./automation-agent-bridge.js";

export { getTemplate, listTemplates, BUILT_IN_TEMPLATES } from "./automation-templates.js";
export type { AutomationDefinition, AutomationTemplate } from "./automation-templates.js";

// Re-export from git-engine for convenience
export {
  GitAutomationStore,
  createAutoPR,
  type StoredAutomationTrigger,
  type StoredAutomationExecutionRecord,
  type AutoPROptions,
  type PRResult,
} from "@dantecode/git-engine";

export { FilePatternWatcher, matchGlob } from "./file-pattern-watcher.js";
export type { FileChangeEvent } from "./file-pattern-watcher.js";

export { SlackWebhookProvider, LinearWebhookProvider } from "./webhook-providers.js";
export type { AutomationTriggerEvent } from "./webhook-providers.js";

// ============================================================================
// Workflow Graph Execution (LangGraph-inspired)
// ============================================================================

export { WorkflowGraph, createWorkflowGraph } from "./workflow-graph-builder.js";
export { WorkflowGraphExecutor } from "./workflow-graph-executor.js";
export { WorkflowGraphCheckpointer } from "./workflow-graph-checkpoint.js";
export {
  defineWorkflowAutomation,
  registerWorkflowAutomation,
  executeWorkflowAutomation,
  toAutomationExecutionRecord,
} from "./workflow-graph-integration.js";

export {
  initializeGraphState,
  applyStateUpdates,
  getStateSnapshot,
  getChannelValue,
  cloneGraphState,
  serializeGraphState,
  deserializeGraphState,
  validateStateUpdates,
  mergeStateUpdates,
  defineStateSchema,
  ChannelReducers,
} from "./workflow-graph-state.js";

export type {
  StateChannel,
  GraphState,
  NodeContext,
  NodeFunction,
  WorkflowNode,
  EdgeCondition,
  WorkflowEdge,
  WorkflowGraphConfig,
  StateSchemaDefinition,
  StateChannelConfig,
  NodeExecutionResult,
  GraphExecutionContext,
  ExecutionOptions,
  ExecutionResult,
  WorkflowGraphEvents,
  SubgraphNode,
  CompiledWorkflowGraph,
} from "./workflow-graph-types.js";

export { START_NODE, END_NODE } from "./workflow-graph-types.js";

export type { WorkflowGraphAutomation } from "./workflow-graph-integration.js";
