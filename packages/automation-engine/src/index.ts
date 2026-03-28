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
} from "./automation-orchestrator.js";

export { runAutomationAgent, substitutePromptVars, PDSE_GATE_THRESHOLD } from "./automation-agent-bridge.js";
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
