// ============================================================================
// @dantecode/core — Public API
// ============================================================================

// ─── Model Router ─────────────────────────────────────────────────────────────

export { BudgetExceededError, ModelRouterImpl, shouldContinueLoop } from "./model-router.js";
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

export { classifyApiError, parseRetryAfterMs } from "./api-error-classifier.js";
export type { ParsedApiError, ParsedApiErrorCategory } from "./api-error-classifier.js";

export {
  DEFAULT_RETRY_POLICY,
  computeRetryDelayMs,
  retryWithBackoff,
  sleepWithAbort,
} from "./retry-policy.js";
export type { RetryContext, RetryPolicy } from "./retry-policy.js";

export {
  getProviderExecutionProfile,
  inferReasoningCapability,
} from "./provider-execution-profile.js";
export type {
  ProviderExecutionProfile,
  ProviderOptions,
} from "./provider-execution-profile.js";

export { compactTextTranscript } from "./transcript-compaction.js";
export type {
  TextTranscriptMessage,
  TranscriptCompactionResult,
} from "./transcript-compaction.js";

export {
  applyExactEdit,
  createFileSnapshot,
  detectLineEnding,
  formatStaleSnapshotMessage,
  isSnapshotStale,
  normalizeLineEndings,
  preserveLineEndingsForWrite,
  truncateToolOutput,
} from "./tool-runtime.js";
export type {
  ExactEditResult,
  FileSnapshot,
  LineEndingStyle,
} from "./tool-runtime.js";

export { getProviderPromptSupplement } from "./provider-prompt-supplements.js";

// ——— Execution Heuristics —————————————————————————————————————————————————————————

export {
  promptRequestsToolExecution,
  responseNeedsToolExecutionNudge,
} from "./execution-heuristics.js";

// ─── Session Store ───────────────────────────────────────────────────────────

export { SessionStore } from "./session-store.js";
export type { SessionSummaryEntry, SessionListEntry } from "./session-store.js";

// ─── Background Agent ────────────────────────────────────────────────────────

export { BackgroundAgentRunner } from "./background-agent.js";
export type {
  BackgroundProgressCallback,
  AgentWorkFn,
  BackgroundTaskContext,
  EnqueueOptions,
} from "./background-agent.js";
export { BackgroundTaskStore } from "./background-task-store.js";

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
export type {
  VectorStore,
  VectorEntry,
  VectorMetadata,
  VectorSearchResult,
} from "./vector-store.js";

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
export type { DockerAgentOptions, DockerAgentResult, DockerCommandSpec } from "./docker-agent.js";

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
  EventTriggerOptions,
} from "./event-triggers.js";
export { slugifyTitle } from "./event-triggers.js";

// ─── Webhook Server ─────────────────────────────────────────────────────────

export { createWebhookServer } from "./webhook-server.js";
export type { WebhookServerConfig, WebhookServerHandle } from "./webhook-server.js";

// ─── Enterprise SSO ──────────────────────────────────────────────────────────

export { EnterpriseSSOManager } from "./enterprise-sso.js";
export type { SSOConfig, SSOSession, SSOValidationResult } from "./enterprise-sso.js";

// ─── Team Dashboard ──────────────────────────────────────────────────────────

export { computeDashboardMetrics, formatDashboardReport, computeTrend } from "./team-dashboard.js";
export type { DashboardMetrics, DashboardFilter, TrendReport } from "./team-dashboard.js";

// ─── Compliance Export ──────────────────────────────────────────────────────

export {
  exportAuditLog,
  maskSensitiveFields,
  filterEvents,
  eventsToCSV,
  eventsToJSON,
  generateComplianceHeader,
} from "./compliance-export.js";
export type { ComplianceExportOptions, ComplianceExportResult } from "./compliance-export.js";

// ─── Error Parser ────────────────────────────────────────────────────────────

export {
  parseVerificationErrors,
  formatErrorsForFixPrompt,
  computeErrorSignature,
} from "./error-parser.js";
export type { ParsedError } from "./error-parser.js";

// ─── Health Check ───────────────────────────────────────────────────────────

export { runStartupHealthCheck } from "./health-check.js";
export type { HealthCheck, HealthCheckResult, HealthCheckConfig } from "./health-check.js";

// ─── Circuit Breaker ────────────────────────────────────────────────────────

export { CircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";
export type { CircuitBreakerState, CircuitBreakerOptions } from "./circuit-breaker.js";

export {
  createSelfImprovementContext,
  detectSelfImprovementContext,
  getProtectedRoots,
  isProtectedWriteTarget,
  isRepoInternalCdChain,
  isSelfImprovementWriteAllowed,
} from "./self-improvement-policy.js";

// ─── Autoforge Checkpoint ────────────────────────────────────────────────────

export { AutoforgeCheckpointManager, hashContent } from "./autoforge-checkpoint.js";
export type {
  AutoforgeSessionSnapshot,
  AutoforgeCheckpointFile,
  AutoforgeCheckpointManagerOptions,
  CreateAutoforgeCheckpointOptions,
  PdseCheckpointEntry,
} from "./autoforge-checkpoint.js";

// ─── Task Circuit Breaker ────────────────────────────────────────────────────

export { TaskCircuitBreaker } from "./task-circuit-breaker.js";
export type {
  TaskBreakerState,
  TaskFailureRecord,
  EscalationEvent,
  TaskCircuitBreakerOptions,
  FailureAction,
  BackoffRecommendation,
} from "./task-circuit-breaker.js";

// ─── Recovery Engine ─────────────────────────────────────────────────────────

export { RecoveryEngine } from "./recovery-engine.js";
export type {
  RecoveryResult,
  ContextFile,
  HashAuditRecord,
  RepoRootVerificationResult,
  RepoVerificationStep,
  RecoveryEngineOptions,
} from "./recovery-engine.js";

// ─── Event-Sourced Checkpointer ─────────────────────────────────────────────

export { EventSourcedCheckpointer, hashCheckpointContent } from "./checkpointer.js";
export type {
  Checkpoint,
  CheckpointMetadata,
  PendingWrite,
  CheckpointTuple,
  CheckpointEvent,
  CheckpointListOptions,
  EventSourcedCheckpointerOptions,
} from "./checkpointer.js";

// ─── Loop Detector ──────────────────────────────────────────────────────────

export { LoopDetector, fingerprintAction } from "./loop-detector.js";
export type { ActionRecord, LoopDetectionResult, LoopDetectorOptions } from "./loop-detector.js";

// ─── Magic Pipeline State ────────────────────────────────────────────────────

export {
  saveMagicPipelineState,
  loadMagicPipelineState,
  clearMagicPipelineState,
  createMagicPipelineState,
  advancePipelineStep,
  recordStepRetry,
  remainingSteps,
  estimateRequiredRounds,
  formatPipelineProgress,
  getMagicStatePath,
} from "./magic-pipeline-state.js";
export type { MagicPipelineState, MagicStepResult } from "./magic-pipeline-state.js";

export { detectInstallContext, resolvePreferredShell } from "./runtime-update.js";
export type {
  InstallContextKind,
  DetectedInstallContext,
  DetectInstallContextOptions,
  SelfUpdatePlan,
  ResolvePreferredShellOptions,
} from "./runtime-update.js";

// ─── Version Migration ──────────────────────────────────────────────────────

export {
  runMigrations,
  detectConfigVersion,
  v0_to_v1,
  LATEST_CONFIG_VERSION,
} from "./version-migration.js";
export type { MigrationResult, MigrationRunResult } from "./version-migration.js";

// ─── Skill Wave Orchestrator ────────────────────────────────────────────────

export {
  parseSkillWaves,
  createWaveState,
  getCurrentWave,
  advanceWave,
  recordWaveFailure,
  buildWavePrompt,
  isWaveComplete,
  CLAUDE_WORKFLOW_MODE,
  WAVE_COMPLETE_RE,
} from "./skill-wave-orchestrator.js";
export type {
  SkillWave,
  WaveOrchestratorState,
} from "./skill-wave-orchestrator.js";

// ─── Approach Memory ────────────────────────────────────────────────────────

export {
  ApproachMemory,
  tokenize as approachTokenize,
  jaccardSimilarity,
  formatApproachesForPrompt,
} from "./approach-memory.js";
export type { ApproachRecord, ApproachQueryOptions } from "./approach-memory.js";

// ─── Prompt Cache ───────────────────────────────────────────────────────────

export {
  shouldUsePromptCache,
  buildCacheablePrompt,
  toCacheControlBlocks,
  estimateCacheSavings,
} from "./prompt-cache.js";
export type { CacheableSection } from "./prompt-cache.js";

// ─── Git Snapshot Recovery ──────────────────────────────────────────────────

export { GitSnapshotRecovery } from "./git-snapshot-recovery.js";
export type { GitSnapshot, GitSnapshotOptions } from "./git-snapshot-recovery.js";

// ─── Search Providers ──────────────────────────────────────────────────────

export {
  TavilyProvider,
  ExaProvider,
  SerperProvider,
  GoogleCSEProvider,
  BraveProvider,
  DuckDuckGoProvider,
  createSearchProviders,
  loadSearchConfig,
  DEFAULT_PROVIDER_ORDER,
} from "./search-providers.js";
export type {
  SearchResult,
  SearchProvider,
  SearchProviderOptions,
  SearchProviderConfig,
} from "./search-providers.js";

// ─── Search HTML Utils ─────────────────────────────────────────────────────

export { htmlToReadableText as searchHtmlToText } from "./search-html-utils.js";

// ─── Web Search Orchestrator ───────────────────────────────────────────────

export {
  WebSearchOrchestrator,
  createWebSearchOrchestrator,
  clearOrchestratorCache,
} from "./web-search-orchestrator.js";
export type {
  WebSearchOptions,
  OrchestratedSearchResult,
} from "./web-search-orchestrator.js";

// ─── Search Synthesizer ────────────────────────────────────────────────────

export {
  synthesizeResults,
  buildSynthesisPrompt,
  formatCitationBlock,
  formatSynthesizedResult,
} from "./search-synthesizer.js";
export type {
  Citation,
  SynthesizedResult,
  SynthesizerOptions,
} from "./search-synthesizer.js";

// ─── Search Reranker ───────────────────────────────────────────────────────

export { rerankResults } from "./search-reranker.js";
export type {
  RerankContext,
  RankedSearchResult,
  RerankOptions,
} from "./search-reranker.js";

// ─── Search Cache ──────────────────────────────────────────────────────────

export { SemanticSearchCache } from "./search-cache.js";
export type {
  SearchCacheEntry,
  SearchCacheOptions,
} from "./search-cache.js";
