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
export type { SessionSummaryEntry, SessionListEntry } from "./session-store.js";
export { DurableRunStore } from "./durable-run-store.js";

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

export {
  WORKFLOW_CONTRACT_VERSION,
  loadWorkflowCommand,
  loadWorkflowCommands,
  parseWorkflowCommand,
  createWorkflowExecutionContext,
  buildWorkflowInvocationPrompt,
  summarizeWorkflowBlocked,
  summarizeWorkflowCompleted,
} from "./workflow-runtime.js";
export type {
  WorkflowContract,
  WorkflowCommand,
  WorkflowParseResult,
  WorkflowExecutionContext,
  WorkflowEvidenceEvent,
  WorkflowExecutionMode,
  WorkflowFailurePolicy,
  WorkflowRollbackPolicy,
  WorkflowWorktreePolicy,
  WorkflowRunStatus,
} from "./workflow-runtime.js";

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

// ─── Playbook Memory ──────────────────────────────────────────────────────

export { PlaybookMemory } from "./playbook-memory.js";
export type { PlaybookEntry, PlaybookQueryResult } from "./playbook-memory.js";

// ─── Verification Engine ──────────────────────────────────────────────────

export { VerificationEngine } from "./verification-engine.js";
export type {
  VerificationStage,
  VerificationStageResult,
  VerificationReport,
  TestRunnerInfo,
  VerificationEngineOptions,
} from "./verification-engine.js";

// ─── Patch Validator ────────────────────────────────────────────────────────

export { PatchValidator } from "./patch-validator.js";
export type {
  PatchValidationResult,
  DiffValidationResult,
  CommitGateResult,
  PatchValidatorOptions,
} from "./patch-validator.js";

// ─── Reasoning Chain ─────────────────────────────────────────────────────

export { ReasoningChain } from "./reasoning-chain.js";
export type {
  ReasoningPhase,
  ReasoningChainOptions,
  ChainStep,
  ReasoningTier,
  CritiqueResult,
} from "./reasoning-chain.js";

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

// ─── Persistent Memory ──────────────────────────────────────────────────────

export { PersistentMemory } from "./persistent-memory.js";
export type {
  MemoryEntry,
  MemorySearchOptions,
  MemoryDistillResult,
  PersistentMemoryOptions,
} from "./persistent-memory.js";

// ─── Memory Distiller ──────────────────────────────────────────────────────

export { distillEntries, extractPlaybook, scoreRelevance, findDuplicates } from "./memory-distiller.js";
export type {
  DistillableEntry,
  DistilledEntry,
  DistillationResult,
  DistillerOptions,
} from "./memory-distiller.js";

// ─── Security Engine ───────────────────────────────────────────────────────

export { SecurityEngine } from "./security-engine.js";
export type {
  SecurityLayer,
  RiskLevel,
  ActionDecision,
  SecurityAction,
  SecurityCheckResult,
  AnomalyDetectionResult,
  QuarantineEntry,
  SecurityRule,
  SecurityEngineOptions,
} from "./security-engine.js";

// ─── Secrets Scanner ───────────────────────────────────────────────────────

export { SecretsScanner } from "./secrets-scanner.js";
export type {
  SecretMatch,
  ScanResult,
  SecretsPattern,
  SecretsScannerOptions,
} from "./secrets-scanner.js";

// ─── SubAgent Manager ──────────────────────────────────────────────────────

export { SubAgentManager } from "./subagent-manager.js";
export type {
  SubAgentConfig,
  SubAgentTask,
  SpawnOptions,
  ParallelResult,
  MergedResult,
  SubAgentManagerOptions,
} from "./subagent-manager.js";

// ─── SubAgent Context ──────────────────────────────────────────────────────

export { SubAgentContext } from "./subagent-context.js";
export type {
  ContextSlice,
  ContextMemoryEntry,
  ContextMergeResult,
  IsolatedContextOptions,
} from "./subagent-context.js";

// ─── Sandbox Engine ────────────────────────────────────────────────────────

export { SandboxEngine } from "./sandbox-engine.js";
export type {
  SandboxMode,
  SandboxStatus,
  SandboxPolicy,
  SandboxInstance,
  ExecResult,
  SandboxEngineOptions,
} from "./sandbox-engine.js";

// ─── Policy Enforcer ───────────────────────────────────────────────────────

export { PolicyEnforcer } from "./policy-enforcer.js";
export type {
  PolicyEffect,
  PolicyResourceType,
  PolicyCondition,
  PolicyRule,
  PolicyRequest,
  PolicyDecision,
  PolicySet,
  PolicyEnforcerOptions,
} from "./policy-enforcer.js";

// ─── Hierarchical Planner ──────────────────────────────────────────────────

export { HierarchicalPlanner } from "./hierarchical-planner.js";
export type {
  WaveNode,
  WaveTree,
  ReDecomposeOptions,
  HierarchicalPlannerOptions,
} from "./hierarchical-planner.js";

// ─── Autonomy Engine ────────────────────────────────────────────────────────

export { AutonomyEngine } from "./autonomy-engine.js";
export type {
  AgentGoal,
  ReasoningMetaResult,
  GoalAdaptation,
  AutonomyEngineOptions,
} from "./autonomy-engine.js";

// ─── Event Engine ───────────────────────────────────────────────────────────

export { EventEngine } from "./event-engine.js";
export type {
  DanteEventType,
  DanteEvent,
  WorkflowDefinition,
  EventQueueEntry,
  EventEngineOptions,
} from "./event-engine.js";

// ─── Git Hook Handler ───────────────────────────────────────────────────────

export { GitHookHandler } from "./git-hook-handler.js";
export type {
  GitHookType,
  GitHookPayload,
  GitHookHandlerOptions,
} from "./git-hook-handler.js";

// ─── Capability Fingerprint ─────────────────────────────────────────────────

export { CapabilityFingerprint } from "./capability-fingerprint.js";
export type {
  ModelCapabilities,
  ModelSelectionCriteria,
  CapabilityFingerprintOptions,
} from "./capability-fingerprint.js";

// ─── Unified LLM Client ─────────────────────────────────────────────────────

export { UnifiedLLMClient } from "./unified-llm-client.js";
export type {
  LLMMessage,
  LLMCallOptions,
  LLMCallResult,
  FallbackChain,
  ClientTelemetry,
  LLMExecutorFn,
  UnifiedLLMClientOptions,
} from "./unified-llm-client.js";

// ─── GitHub CLI Engine ──────────────────────────────────────────────────────

export { GitHubCLIEngine } from "./github-cli-engine.js";
export type {
  GHAction,
  GHRequest,
  GHResult,
  PRCreateArgs,
  IssueCreateArgs,
  GitHubCLIEngineOptions,
} from "./github-cli-engine.js";

// ─── Web Fetch Engine ───────────────────────────────────────────────────────

export { WebFetchEngine } from "./web-fetch-engine.js";
export type {
  FetchMode,
  FetchOptions,
  FetchResult,
  FetchFn,
  WebFetchEngineOptions,
} from "./web-fetch-engine.js";

// ─── Wave 6: FIM Engine ─────────────────────────────────────────────────────

export { FIMEngine } from "./fim-engine.js";
export type {
  FIMModel,
  FIMContext,
  FIMPrompt,
  FIMCompletion,
  FIMEngineOptions,
} from "./fim-engine.js";

// ─── Wave 6: Production Engine ──────────────────────────────────────────────

export { ProductionEngine } from "./production-engine.js";
export type {
  ProductionMetric,
  MetricAggregates,
  ProductionEngineOptions,
} from "./production-engine.js";

// ─── Wave 6: Metrics Collector ──────────────────────────────────────────────

export { MetricsCollector } from "./metrics-collector.js";
export type {
  MetricType,
  MetricDefinition,
  MetricSample,
  HistogramBuckets,
} from "./metrics-collector.js";

// ─── Wave 6: UX Engine ──────────────────────────────────────────────────────

export { UXEngine } from "./ux-engine.js";
export type {
  ThemeName,
  Theme,
  ThemeIcons,
  ThemeColors,
  ProgressOptions,
  StatusLineOptions,
  UXEngineOptions,
} from "./ux-engine.js";

// ─── Wave 6: Command Palette ────────────────────────────────────────────────

export { CommandPalette } from "./command-palette.js";
export type {
  PaletteCommand,
  CommandMatch,
  CommandPaletteOptions,
} from "./command-palette.js";
