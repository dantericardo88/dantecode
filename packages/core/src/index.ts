// ============================================================================
// @dantecode/core — Public API
// ============================================================================

// ─── Model Router ─────────────────────────────────────────────────────────────

export { ModelRouterImpl, shouldContinueLoop } from "./model-router.js";
export type { GenerateOptions, LoopExitReason } from "./model-router.js";

// ─── Providers ────────────────────────────────────────────────────────────────

export {
  buildGrokProvider,
  buildAnthropicProvider,
  buildOpenAIProvider,
  buildOllamaProvider,
  PROVIDER_BUILDERS,
} from "./providers/index.js";
export type { ProviderBuilder } from "./providers/index.js";

// ----------------------------------------------------------------------------
// Runtime Catalog
// ----------------------------------------------------------------------------

export {
  DEFAULT_MODEL_ID,
  MODEL_CATALOG,
  PROVIDER_CATALOG,
  SURFACE_RELEASE_MATRIX,
  getDefaultModelCatalogEntry,
  getModelCatalogEntry,
  getModelsForProvider,
  getProviderCatalogEntry,
  groupCatalogModels,
  inferProviderFromModelId,
  parseModelReference,
} from "./runtime-catalog.js";
export type {
  ModelCatalogEntry,
  ProviderCatalogEntry,
  ProviderSupportTier,
  SurfaceReleaseEntry,
  SurfaceReleaseRing,
} from "./runtime-catalog.js";

// ─── Audit Logger ─────────────────────────────────────────────────────────────

export { appendAuditEvent, readAuditEvents, countAuditEvents } from "./audit.js";
export type { AuditEventInput, ReadAuditOptions } from "./audit.js";

// ─── State Management ─────────────────────────────────────────────────────────

export {
  readStateYaml,
  writeStateYaml,
  initializeState,
  stateYamlExists,
  readOrInitializeState,
  updateStateYaml,
  DanteCodeStateSchema,
} from "./state.js";

// ─── Multi-Agent ───────────────────────────────────────────────────────────────

export {
  MultiAgent,
  type MultiAgentConfig,
  type MultiAgentProgressCallback,
} from "./multi-agent.js";

// ─── Token Counter ───────────────────────────────────────────────────────────

export { estimateTokens, estimateMessageTokens, getContextUtilization } from "./token-counter.js";
export type { ContextUtilization } from "./token-counter.js";

// ——— Execution Heuristics —————————————————————————————————————————————————————————

export {
  promptRequestsToolExecution,
  responseNeedsToolExecutionNudge,
} from "./execution-heuristics.js";

// ─── Session Store ───────────────────────────────────────────────────────────

export { SessionStore } from "./session-store.js";

// ─── Background Agent ────────────────────────────────────────────────────────

export { BackgroundAgentRunner } from "./background-agent.js";
export type {
  BackgroundProgressCallback,
  AgentWorkFn,
  BackgroundTaskContext,
  EnqueueOptions,
} from "./background-agent.js";

// ─── Code Index ──────────────────────────────────────────────────────────────

export { createEmbeddingProvider } from "./embedding-provider.js";
export type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingProviderInfo,
  EmbeddingProviderName,
} from "./embedding-provider.js";

export { WebhookHandler } from "./webhook-handler.js";
export type { WebhookDispatchResult, WebhookTaskEnqueuer } from "./webhook-handler.js";

export { CodeIndex, chunkFile, tokenize } from "./code-index.js";

// ─── Vector Store ───────────────────────────────────────────────────────────

export { InMemoryVectorStore, LanceDBVectorStore, createVectorStore } from "./vector-store.js";
export type { VectorStore, VectorEntry, VectorMetadata, VectorSearchResult } from "./vector-store.js";

// ─── Repo Map ───────────────────────────────────────────────────────────────

export {
  buildRepoMap,
  extractSymbolDefinitions,
  extractImports,
  computeFileScores,
  formatRepoMap,
} from "./repo-map-ast.js";
export type { SymbolDefinition, ImportEdge, RankedFile, RepoMapOptions } from "./repo-map-ast.js";

// ─── Architect Planner ──────────────────────────────────────────────────────

export { ArchitectPlanner, analyzeComplexity, parsePlanFromText } from "./architect-planner.js";
export type { ExecutionPlan, PlanStep, ArchitectPlannerOptions } from "./architect-planner.js";

export { PlanExecutor, areDependenciesMet, getNextExecutableSteps } from "./plan-executor.js";
export type {
  StepExecutionResult,
  PlanExecutionResult,
  PlanExecutorOptions,
} from "./plan-executor.js";

// ─── Browser Agent ──────────────────────────────────────────────────────────

export { BrowserAgent } from "./browser-agent.js";
export type { BrowserAction, BrowserActionResult, BrowserAgentOptions } from "./browser-agent.js";

// ─── Vision Router ──────────────────────────────────────────────────────────

export {
  containsImageContent,
  isModelVisionCapable,
  selectVisionModel,
  describeImage,
  filterImageBlocks,
} from "./vision-router.js";
export type { ContentBlock, VisionCapability } from "./vision-router.js";

// ─── Cloud Dispatch ──────────────────────────────────────────────────────────

export { selectDispatchMode, dispatchAgentTask } from "./cloud-dispatch.js";
export type {
  DispatchMode,
  CloudAgentConfig,
  DispatchResult,
  DispatchOptions,
  CloudAgentResponse,
} from "./cloud-dispatch.js";

// ─── Docker Agent ──────────────────────────────────────────────────────────

export { DockerAgent } from "./docker-agent.js";
export type {
  DockerAgentOptions,
  DockerAgentResult,
  DockerCommandSpec,
} from "./docker-agent.js";

// ─── Issue-to-PR Pipeline ──────────────────────────────────────────────────

export { IssueToPRPipeline } from "./issue-to-pr.js";
export type {
  IssueToPRConfig,
  GitHubIssueInfo,
  IssueToPRResult,
  PipelineStage,
  PipelineProgress,
  AgentExecutor,
} from "./issue-to-pr.js";

// ─── Event Triggers ──────────────────────────────────────────────────────────

export { EventTriggerRegistry } from "./event-triggers.js";
export type {
  TriggerSource,
  AgentTask,
  TriggerConfig,
  CronSchedule,
  SlackTriggerPayload,
  TaskHandler,
} from "./event-triggers.js";

// ─── Webhook Server ─────────────────────────────────────────────────────────

export { createWebhookServer } from "./webhook-server.js";
export type { WebhookServerConfig, WebhookServerHandle } from "./webhook-server.js";

// ─── Enterprise SSO ──────────────────────────────────────────────────────────

export { EnterpriseSSOManager } from "./enterprise-sso.js";
export type {
  SSOConfig,
  SSOSession,
  SSOValidationResult,
} from "./enterprise-sso.js";

// ─── Team Dashboard ──────────────────────────────────────────────────────────

export { computeDashboardMetrics, formatDashboardReport, computeTrend } from "./team-dashboard.js";
export type { DashboardMetrics, DashboardFilter, TrendReport } from "./team-dashboard.js";

// ─── Compliance Export ──────────────────────────────────────────────────────

export { exportAuditLog, maskSensitiveFields, filterEvents, eventsToCSV, eventsToJSON, generateComplianceHeader } from "./compliance-export.js";
export type { ComplianceExportOptions, ComplianceExportResult } from "./compliance-export.js";

// ─── Error Parser ────────────────────────────────────────────────────────────

export {
  parseVerificationErrors,
  formatErrorsForFixPrompt,
  computeErrorSignature,
} from "./error-parser.js";
export type { ParsedError } from "./error-parser.js";
