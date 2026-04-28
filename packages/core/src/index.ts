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

export {
  classifyTaskComplexity,
  routeByComplexity,
  detectAvailableProviders,
  detectAvailableProvidersAsync,
  probeOllamaAvailability,
  resetProviderCache,
} from "./task-complexity-router.js";
export type { TaskComplexity, TaskSignals, RoutedModel } from "./task-complexity-router.js";

export { ProjectKnowledgeStore } from "./project-knowledge-store.js";
export type {
  KnowledgeFact,
  KnowledgeCategory,
  ProjectKnowledgeSnapshot,
} from "./project-knowledge-store.js";

export { OllamaHealthProbe, OfflineGuard, globalOfflineGuard } from "./offline-guard.js";
export type {
  OllamaModel,
  OllamaHealthResult,
  OfflineRoute,
  OfflineGuardOptions,
  OfflineRouteReason,
} from "./offline-guard.js";

export {
  PlanActController,
  parsePlan,
  formatPlanForDisplay,
  buildPlanModeSystemPrompt,
  buildPlanModeSystemPromptStructured,
} from "./plan-act-controller.js";
export type {
  PlanActPhase,
  PlanApprovalResult,
  PlanActOptions,
  ExecutionStepStatus,
  PlanActSnapshot,
} from "./plan-act-controller.js";

export { parseDiffStat, generatePrContent, detectReviewAnnotations } from "./pr-automation.js";
export { fetchPrDiff, fetchPrMeta, reviewPullRequest } from "./pr-review-runner.js";
export type {
  PullRequestMeta,
  PullRequestReviewOptions,
  PullRequestReviewResult,
} from "./pr-review-runner.js";
export type {
  ChangedFile,
  DiffSummary,
  ReviewAnnotation,
  GeneratedPrContent,
} from "./pr-automation.js";

export { analyzeIssue, formatAnalyzedIssueForPrompt } from "./issue-analyzer.js";
export type {
  IssueSignal,
  AnalyzedIssue,
  FileHint,
  ErrorSignature,
  ReproductionStep,
} from "./issue-analyzer.js";

export { scaffold, inferTemplate, formatScaffoldSummary } from "./scaffold-engine.js";
export type {
  ScaffoldSpec,
  ScaffoldResult,
  ScaffoldFile,
  ProjectTemplate,
  ScaffoldFeature,
} from "./scaffold-engine.js";

export {
  levenshtein,
  editSimilarity,
  classifyEditSize,
  selectEditPresentation,
  formatInlineDiff,
  scoreEditQuality,
  PartialAcceptController,
  globalPartialAcceptController,
} from "./inline-edit-scorer.js";
export type {
  EditSize,
  EditPresentation,
  EditQualityResult,
  PartialAcceptResult,
} from "./inline-edit-scorer.js";

export {
  AgentMessageBus,
  AgentChannel,
  globalAgentBus,
  createAgentChannel,
} from "./agent-message-bus.js";
export type {
  AgentMessage,
  MessageKind,
  MessagePriority,
  MessageHandler,
} from "./agent-message-bus.js";

export {
  scoreMessage,
  assignTier,
  compressMessageContent,
  evictToFitBudget,
  assessContextBudget,
} from "./context-eviction-policy.js";
export type {
  ScoredMessage,
  EvictionResult,
  EvictionOptions,
  EvictionTier,
  ContextBudgetStatus,
  ContextPressure,
} from "./context-eviction-policy.js";

export { filterContextByRelevance } from "./context-filter-pipeline.js";
export type {
  FilterableMessage,
  FilterPipelineOptions,
  FilterPipelineResult,
} from "./context-filter-pipeline.js";

export {
  CacheMetricsTracker,
  globalCacheMetrics,
  estimateCachingSavings,
  isCacheLikelyValid,
} from "./cache-metrics.js";
export type { CacheUsageRecord, CacheMetricsSummary, CostModel } from "./cache-metrics.js";

// ─── Audit Logger ─────────────────────────────────────────────────────────────

export {
  appendAuditEvent,
  readAuditEvents,
  countAuditEvents,
  recordToolCall,
  recordMutation,
  recordValidation,
  recordCompletionGate,
} from "./audit.js";
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
  type AgentOutput,
} from "./multi-agent.js";

// ─── Task Decomposer ────────────────────────────────────────────────────────

export { decomposeTask, buildParallelGroups, hasFileConflict } from "./task-decomposer.js";
export type { SubTask, DecompositionResult, SandboxGroupingStrategy } from "./task-decomposer.js";

// ─── Autonomy Orchestrator ───────────────────────────────────────────────────

export {
  AutonomyOrchestrator,
  buildTestOutputContext,
  makeVerifyFn,
} from "./autonomy-orchestrator.js";
export type {
  VerifyResult,
  VerifyFn,
  WaveResult,
  AutonomyRunOptions,
  AutonomyRunResult,
} from "./autonomy-orchestrator.js";

// ─── Token Counter ───────────────────────────────────────────────────────────

export { estimateTokens, estimateMessageTokens, getContextUtilization } from "./token-counter.js";
export type { ContextUtilization } from "./token-counter.js";

// ─── Context Compactor ───────────────────────────────────────────────────────

export { pruneToolOutputs, compactContext, wouldOverflow } from "./context-compactor.js";
export type { CompactorMessage } from "./context-compactor.js";

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
export type { ProviderExecutionProfile, ProviderOptions } from "./provider-execution-profile.js";

export { compactTextTranscript } from "./transcript-compaction.js";
export type { TextTranscriptMessage, TranscriptCompactionResult } from "./transcript-compaction.js";

// ─── Evidence & Execution Proof Types ────────────────────────────────────────

export type {
  ExecutionLedger,
  ToolCallRecord,
  MutationRecord,
  ValidationRecord,
  CompletionGateResult,
  ChangedFileRecord,
  RequestClass,
} from "@dantecode/config-types";

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
export type { ExactEditResult, FileSnapshot, LineEndingStyle } from "./tool-runtime.js";

export {
  getProviderPromptSupplement,
  getProviderSystemPreamble,
  getStrictModeAddition,
} from "./provider-prompt-supplements.js";

export { FabricationTracker } from "./fabrication-tracker.js";
export type {
  FabricationEvent,
  FabricationEventType,
  FabricationSnapshot,
} from "./fabrication-tracker.js";
export { detectUnverifiedScoreClaims } from "./score-claim-validator.js";

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
  renderToTree,
  extractSymbolTags,
  buildRepoMapTags,
} from "./repo-map-ast.js";
export type {
  SymbolDefinition,
  ImportEdge,
  RankedFile,
  RepoMapOptions,
  ComputeFileScoresOptions,
  SymbolTag,
} from "./repo-map-ast.js";

// ─── Tree-sitter AST Engine ─────────────────────────────────────────────────

export {
  extractTagsAST,
  detectTreeSitterLanguage,
  getParser,
  resetParserPool,
  SCM_QUERIES,
} from "./tree-sitter/index.js";
export type { ASTTag, SupportedLanguage } from "./tree-sitter/index.js";

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

export {
  BrowserAgent,
  runBrowserLoop,
  detectPlaywright,
  detectChromeCdp,
  detectBrowserCapabilities,
} from "./browser-agent.js";
export type {
  BrowserAction,
  BrowserActionResult,
  BrowserAgentOptions,
  BrowserLoopStep,
  PlaywrightCapability,
  CdpCapability,
  BrowserCapabilities,
} from "./browser-agent.js";

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
export type {
  CircuitBreakerState,
  CircuitBreakerOptions,
  ProviderHealthEvent,
} from "./circuit-breaker.js";

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
export type { SkillWave, WaveOrchestratorState } from "./skill-wave-orchestrator.js";

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
export type { WebSearchOptions, OrchestratedSearchResult } from "./web-search-orchestrator.js";

// ─── Search Synthesizer ────────────────────────────────────────────────────

export {
  synthesizeResults,
  buildSynthesisPrompt,
  formatCitationBlock,
  formatSynthesizedResult,
} from "./search-synthesizer.js";
export type { Citation, SynthesizedResult, SynthesizerOptions } from "./search-synthesizer.js";

// ─── Search Reranker ───────────────────────────────────────────────────────

export { rerankResults } from "./search-reranker.js";
export type { RerankContext, RankedSearchResult, RerankOptions } from "./search-reranker.js";

// ─── Search Cache ──────────────────────────────────────────────────────────

export { SemanticSearchCache } from "./search-cache.js";
export type { SearchCacheEntry, SearchCacheOptions } from "./search-cache.js";

// ─── Repo Brain ─────────────────────────────────────────────────────────────

export { generateRepoMemory, loadRepoMemory, getCoChangeFiles } from "./repo-brain.js";
export type { FileNode, SymbolNode, TestRelevance, Hotspot, RepoMemory } from "./repo-brain.js";

// ─── Bounded Repair Loop ─────────────────────────────────────────────────────

export {
  BoundedRepairLoop,
  classifyFailure,
  planRepair,
  executeRepair,
  shouldRollback,
  rollbackChanges,
  verifyAfterRepair,
} from "./bounded-repair.js";
export type {
  FailureClassification,
  RepairPlan,
  RepairAttempt,
  BoundedRepairContext,
} from "./bounded-repair.js";

// ─── ACP Adapter Layer ────────────────────────────────────────────────────────

export {
  ACPAdapter,
  ExternalToolAgent,
  DanteForgeACPVerifier,
  globalACPAdapter,
} from "./acp-adapter.js";
export type { ACPTool, ACPAgent, ACPResult } from "./acp-adapter.js";

// ─── Evaluation Lab ────────────────────────────────────────────────────────────

export { evaluationLab } from "./evaluation-lab.js";
export type { GoldenTask, EvaluationResult, BenchmarkSuite } from "./evaluation-lab.js";

// ─── Security & Chaos ──────────────────────────────────────────────────────────

export { runSecurityAudit, chaosTester } from "./security-chaos.js";
export type { SecurityAudit, Vulnerability as SecurityVulnerability } from "./security-chaos.js";

// ─── Diff Engine ──────────────────────────────────────────────────────────────

export {
  parseSearchReplaceBlocks,
  applySearchReplaceBlock,
  findNearestLines,
  FUZZY_THRESHOLD,
  MultiFileDiffSession,
} from "./diff-engine/index.js";
export type {
  SearchReplaceBlock,
  ParseSearchReplaceResult,
  ApplySearchReplaceResult,
  MatchQuality,
  SessionBlock,
  BlockState,
} from "./diff-engine/index.js";

// ─── Completion Telemetry ──────────────────────────────────────────────────────

export {
  CompletionTelemetryService,
  CompletionTelemetryStore,
} from "./completion-telemetry/index.js";
export type {
  CompletionEvent,
  CompletionEventType,
  CompletionStats,
  LanguageStat,
  ModelStat,
} from "./completion-telemetry/index.js";

// ─── Context Provider System ─────────────────────────────────────────────────
export type {
  ContextItem,
  ContextItemUri,
  ContextProviderExtras,
  IContextProvider,
} from "./context-provider-types.js";
export { ContextProviderRegistry, globalCoreRegistry } from "./context-provider-registry.js";

// ─── Repo Map Builder ────────────────────────────────────────────────────────

export {
  buildRepoMap as buildRepoMapScored,
  formatRepoMapForPrompt,
  getTopFiles,
} from "./repo-map-builder.js";
export type {
  RepoFileEntry,
  RepoDependencyEdge,
  RepoMap as ScoredRepoMap,
  RepoMapFormatOptions,
} from "./repo-map-builder.js";

// ─── Git Context Provider ────────────────────────────────────────────────────

export {
  parsePorcelainBlame,
  parseGitLog,
  parseWorkingTreeDiff,
  captureGitContext,
  formatGitContextForPrompt,
  getRecentlyModifiedFiles,
} from "./git-context-provider.js";
export type {
  BlameEntry,
  RecentChange,
  WorkingTreeDiff,
  GitContextSnapshot,
  GitContextOptions,
  GitContextFormatOptions,
} from "./git-context-provider.js";

// ─── Test Runner Watcher ─────────────────────────────────────────────────────

export {
  detectTestRunner,
  parseVitestOutput,
  parsePytestOutput,
  parseCargoTestOutput,
  runTests,
  formatTestResultForPrompt,
  getTestStatusLine,
  getFailedTestNames,
} from "./test-runner-watcher.js";
export type {
  TestRunner,
  TestStatus,
  TestCase,
  TestRunResult,
  RunTestsOptions,
  TestResultFormatOptions,
} from "./test-runner-watcher.js";

// ─── Search Query Expander ────────────────────────────────────────────────────

export {
  splitIdentifier,
  tokenizeQuery,
  expandQuery,
  rerankCodeResults,
  extractPrimarySymbol,
  formatSearchResultsForPrompt,
} from "./search-query-expander.js";
export type {
  ExpandedQuery,
  CodeSearchResult,
  RerankOptions as CodeRerankOptions,
  SymbolContext,
} from "./search-query-expander.js";

// ─── Test Scaffold Generator ──────────────────────────────────────────────────

export {
  detectFrameworkFromIssue,
  generateTestNames,
  extractReproductionCode,
  generateTestScaffold,
  generateTestScaffolds,
  formatScaffoldSummary as formatTestScaffoldSummary,
} from "./test-scaffold-generator.js";
export type { TestScaffold, ScaffoldGeneratorOptions } from "./test-scaffold-generator.js";

// ─── App Scaffolder (Sprint 30) ───────────────────────────────────────────────

export {
  detectProjectType,
  deriveProjectName,
  generateScaffold,
  formatScaffoldSummary as formatAppScaffoldSummary,
} from "./app-scaffolder.js";
export type {
  ProjectType,
  ScaffoldFile as AppScaffoldFile,
  ScaffoldPlan,
  ScaffoldOptions as AppScaffoldOptions,
} from "./app-scaffolder.js";

// ─── Built-in Context Providers ───────────────────────────────────────────────

export {
  ProblemsContextProvider,
  TerminalContextProvider,
  GitContextProvider as GitBuiltinContextProvider,
  TestsContextProvider,
  UrlContextProvider,
  FilesContextProvider,
  registerBuiltinProviders,
} from "./builtin-context-providers.js";
export type {
  DiagnosticEntry,
  TerminalRecord,
  GitContextData,
  TestResultData,
  UrlFetcher,
  FileTreeGetter,
  BuiltinProviderOptions,
} from "./builtin-context-providers.js";

// ─── LSP Context Aggregator ───────────────────────────────────────────────────

export {
  groupDiagnosticsByFile,
  countDiagnosticsBySeverity,
  getErrorFiles,
  formatHoverInfo,
  formatReferences,
  formatFileSymbols,
  buildLspSnapshot,
  formatLspContextForPrompt,
  filterDiagnosticsBySeverity,
  getHighestSeverityDiagnostic,
  hasBlockingErrors,
} from "./lsp-context-aggregator.js";
export type {
  DiagnosticSeverity,
  LspDiagnostic,
  HoverInfo,
  SymbolReference,
  SymbolDefinition as LspSymbolDefinition,
  SemanticToken,
  LspContextSnapshot,
  LspContextAggregatorOptions,
} from "./lsp-context-aggregator.js";

// ─── Approval Workflow ────────────────────────────────────────────────────────

export {
  classifyRisk,
  isOperationReversible,
  buildApprovalRequest,
  formatApprovalPrompt,
  canAutoApprove,
  partitionForAutoApproval,
  UndoStack,
  ApprovalWorkflow,
} from "./approval-workflow.js";
export type {
  RiskLevel,
  ApprovalStatus,
  OperationType,
  ApprovalRequest,
  ApprovalResponse,
  UndoEntry,
  ApprovalWorkflowOptions,
} from "./approval-workflow.js";

// ─── Inline Edit Manager ──────────────────────────────────────────────────────

export {
  lcs,
  generateDiffHunks,
  formatUnifiedDiff,
  applyHunkSelections,
  applyRangeEdit,
  extractLineRange,
  detectEditConflicts,
  buildInlineEdit,
  acceptAllHunks,
  rejectAllHunks,
  EditSuggestionQueue,
} from "./inline-edit-manager.js";
export type {
  EditLineType,
  DiffLine,
  DiffHunk,
  InlineEdit,
  RangeEdit,
  EditSuggestion,
  EditConflict,
} from "./inline-edit-manager.js";

// ─── Multi-File Diff Reviewer ─────────────────────────────────────────────────

export {
  parseMultiFileDiff,
  buildMultiFileDiff,
  sortFilesByChangeSize,
  filterFilesByStatus,
  addAnnotation,
  getAnnotationsForFile,
  getBlockingAnnotations,
  formatDiffForPrompt,
  formatDiffSummary,
} from "./multi-file-diff-reviewer.js";
export type {
  DiffStatus,
  FileDiff,
  FileDiffHunk,
  FileDiffLine,
  ReviewAnnotation as DiffReviewAnnotation,
  MultiFileDiff,
  DiffPromptOptions,
} from "./multi-file-diff-reviewer.js";

// ─── MCP Tool Registry ────────────────────────────────────────────────────────

export {
  validateToolSchema,
  buildCapabilityGraph,
  scoreTool,
  routeByIntent,
  McpToolRegistry,
  globalMcpRegistry,
} from "./mcp-tool-registry.js";
export type {
  McpToolParameterType,
  McpToolParameter,
  McpToolSchema,
  McpToolEntry,
  ToolMatchScore,
  SchemaValidationResult,
  CapabilityGraph,
} from "./mcp-tool-registry.js";

// ─── Security Scanner ─────────────────────────────────────────────────────────

export {
  scanFileContent,
  scanFileContentAsync,
  filterFindingsBySeverity as filterSecurityFindingsBySeverity,
  sortFindingsBySeverity,
  groupFindingsByCategory,
  formatSecurityFindings,
  isSecretExposure,
  scanWithSemgrep,
  mergeSecurityFindings,
  SECURITY_RULES,
  toSarif,
  scanPackageJson,
  parseNpmAuditOutput,
  runNpmAudit,
} from "./security-scanner.js";
export type {
  SecuritySeverity,
  SecurityCategory,
  SecurityFinding,
  SecurityScanResult,
  SecurityRule,
  SarifDocument,
  PackageVulnerability,
} from "./security-scanner.js";

// ─── Task Outcome Tracker (Sprint Z) ─────────────────────────────────────────

export {
  trackTaskOutcome,
  summarizeTaskOutcomes,
  type TaskOutcome,
  type TaskOutcomeStatus,
} from "./task-outcome-tracker.js";

// ─── Cost Routing Evidence + Diff Quality (dims 27+13) ───────────────────────

export { emitCostRoutingLog, type CostRoutingLogEntry } from "./model-router.js";
export {
  scoreDiff,
  emitDiffQualityLog,
  analyzeDiffHunks,
  scoreDiffQuality,
  recordDiffQualityReport,
  loadDiffQualityReports,
  type DiffQualityScore,
  type DiffQualityLogEntry,
  type DiffHunkAnalysis,
  type DiffQualityReport,
} from "./diff-quality.js";

// ─── Autonomy Session Report (dim 7) ─────────────────────────────────────────

export {
  buildAutonomySessionSummary,
  recordAutonomyReport,
  loadAutonomyReports,
  getAutonomyStats,
  type AutonomySessionSummary,
  type AutonomyReportEntry,
} from "./autonomy-session-report.js";

// ─── App Template Engine ──────────────────────────────────────────────────────

export {
  resolveDependencies,
  generateApp,
  formatFileTree,
  findDependencyConflicts,
  formatAppSummaryForPrompt,
} from "./app-template-engine.js";
export type {
  Framework,
  Database,
  AuthProvider,
  DeployTarget,
  TestFramework,
  AppFeatureSet,
  AppStackConfig,
  GeneratedFile,
  GeneratedApp,
} from "./app-template-engine.js";

// ─── Browser Use Manager ──────────────────────────────────────────────────────

export {
  resolveSelector,
  formatSelector,
  buildNavigateAction,
  buildClickAction,
  buildTypeAction,
  buildScrollAction,
  buildScreenshotAction,
  buildEvaluateAction,
  buildKeyPressAction,
  classifyBrowserError,
  buildSuccessResult,
  buildErrorResult,
  buildDomSnapshot,
  formatDomSnapshotForPrompt,
  BrowserSessionManager,
  globalBrowserManager,
} from "./browser-use-manager.js";
export type {
  BrowserActionType,
  BrowserErrorType,
  SelectorStrategy,
  BrowserSelector,
  BrowserAction as BrowserUseAction,
  BrowserActionResult as BrowserUseActionResult,
  DomSnapshot,
  DomElement,
  BrowserSession,
  BrowserSessionSummary,
} from "./browser-use-manager.js";

// ─── Debug Context Manager ────────────────────────────────────────────────────

export {
  inferVariableType,
  formatVariableValue,
  buildVariable,
  isUserCodeFrame,
  filterUserFrames,
  formatCallStack,
  BreakpointRegistry,
  WatchRegistry,
  DebugContextManager,
} from "./debug-context-manager.js";
export type {
  DebugEventType,
  VariableType,
  BreakpointState,
  StackFrame,
  Variable,
  Breakpoint,
  ExceptionInfo,
  DebugEvent,
  WatchExpression,
  DebugContextSnapshot,
} from "./debug-context-manager.js";

// ─── Completion Quality Scorer ────────────────────────────────────────────────

export {
  isEmptyCompletion,
  isRepetitiveCompletion,
  getIndentLevel,
  scoreIndentCoherence,
  scoreSyntacticBalance,
  scoreTokenCompletion,
  scoreLengthQuality,
  scoreCompletion,
  filterCompletions,
  buildCacheKey,
  CompletionDedupeCache,
  globalCompletionCache,
  applyLanguageRules,
  classifyCompletionType,
} from "./completion-quality-scorer.js";
export type {
  CompletionLanguage,
  CompletionCandidate,
  CompletionScore,
  CompletionSignals,
  ScorerOptions,
} from "./completion-quality-scorer.js";

// ─── Hybrid Search Engine ─────────────────────────────────────────────────────

export {
  splitCamelCase,
  splitSnakeCase,
  expandTerm,
  tokenize as tokenizeForSearch,
  expandQuery as hybridExpandQuery,
  BM25Index,
  TFIDFIndex,
  reciprocalRankFusion,
  extractSnippet,
  findMatchedTerms,
  HybridSearchEngine,
  cosineSimilarity,
} from "./hybrid-search-engine.js";
export type {
  SearchDocument,
  SearchResult as HybridSearchResult,
  HybridSearchOptions,
  SearchEmbeddingFn,
} from "./hybrid-search-engine.js";

// ─── PR Review Orchestrator ───────────────────────────────────────────────────

export {
  generateReviewChecklist,
  classifyChangedFiles,
  classifyRisk as classifyPrRisk,
  buildChangeImpact,
  buildReviewComment,
  scoreReview,
  computeVerdict,
  findStaleComments,
  generateReviewSummary,
  PrReviewOrchestrator,
  trackReviewOutcome,
  scoreReviewActionability,
  filterLowActionabilityComments,
} from "./pr-review-orchestrator.js";
export type {
  ReviewCommentType,
  ReviewCategory,
  ReviewVerdict,
  ChangeRisk,
  ReviewComment,
  PrReviewChecklistItem,
  PrReviewScore,
  ChangeImpact,
  PrReview,
  ReviewOutcomeEntry,
} from "./pr-review-orchestrator.js";

// ─── Speculative Edit Preview ─────────────────────────────────────────────────

export {
  buildEditHunk,
  parseUnifiedDiffToHunks,
  scoreHunkConfidence,
  generatePreview,
  detectEditConflicts as detectSpeculativeEditConflicts,
  describeHunk,
  formatPreviewForPrompt,
  SpeculativeEditManager,
} from "./speculative-edit-preview.js";
export type {
  EditHunkStatus,
  EditConflictType,
  EditHunk,
  SpeculativeEditSession,
  EditPreviewResult,
  EditChainEntry,
} from "./speculative-edit-preview.js";

// ─── Workspace LSP Aggregator ─────────────────────────────────────────────────

export {
  makeSymbolDefinition,
  WorkspaceSymbolIndex,
  HoverAggregator,
  WorkspaceDiagnosticStore,
  severityRank,
  parseImports,
  WorkspaceLspAggregator,
} from "./workspace-lsp-aggregator.js";
export type {
  SymbolKind,
  DiagnosticSeverity as WspDiagnosticSeverity,
  LspPosition,
  LspRange,
  SymbolDefinition as WspSymbolDefinition,
  SymbolReference as WspSymbolReference,
  HoverContext,
  WorkspaceDiagnostic,
  ImportEdge as WspImportEdge,
  WorkspaceSymbolGraph,
  LspContextBundle,
} from "./workspace-lsp-aggregator.js";

// ─── Plan Step History ────────────────────────────────────────────────────────

export {
  buildStep,
  buildArtifact,
  diffSteps,
  validateStepSequence,
  PlanStepHistory,
} from "./plan-step-history.js";
export type {
  StepStatus,
  StepActionKind,
  StepArtifact,
  PlanStep as HistoryPlanStep,
  PlanCheckpoint,
  PlanBranch,
  StepDiff,
  ReplayValidationResult,
} from "./plan-step-history.js";

// ─── Sliding Context Window ───────────────────────────────────────────────────

export {
  estimateTokens as estimateTurnTokens,
  classifyTurnContent,
  scoreContextTurn,
  compressTurns,
  SlidingContextWindow,
  ContextWindowRegistry,
  globalContextWindowRegistry,
} from "./sliding-context-window.js";
export type {
  TurnRole,
  TurnContentType,
  ContextTurn,
  ContextWindowOptions,
  EvictionResult as WindowEvictionResult,
} from "./sliding-context-window.js";

// ─── Streaming Tool Call Buffer ───────────────────────────────────────────────

export {
  tryParsePartialJson,
  StreamingToolCallBuffer,
  computeSseTimeout,
  clampSseTimeout,
} from "./streaming-tool-call-buffer.js";
export type {
  ToolCallStatus,
  ToolCallDelta,
  ToolCallRecord as StreamingToolCallRecord,
  EmissionEvent,
  EmissionCallback,
  StreamingBufferOptions,
} from "./streaming-tool-call-buffer.js";

export { XmlToolCallParser, XmlParserState } from "./xml-tool-call-parser.js";
export type { XmlToolBlock, XmlParserEvent } from "./xml-tool-call-parser.js";

// ─── Architect Mode Router ────────────────────────────────────────────────────

export {
  buildFileEditInstruction,
  buildArchitectPlan,
  topoSortInstructions,
  validateArchitectPlan,
  estimatePlanCost,
  ArchitectModeRouter,
} from "./architect-mode-router.js";
export type {
  EditOperation,
  PlanStatus,
  FileEditInstruction,
  ArchitectPlan,
  PlanValidationResult,
  PhaseCostEstimate,
  EditPhaseResult,
} from "./architect-mode-router.js";

// ─── Thought-Act-Observe Loop ─────────────────────────────────────────────────

export {
  detectCompletionSignal,
  detectFailureSignal,
  classifyObservationStatus,
  adaptStrategy,
  isStuck,
  buildTaoCycle,
  TaoLoopManager,
} from "./thought-act-observe.js";
export type {
  ActionKind,
  ObservationStatus,
  TerminationReason,
  TaoStrategy,
  ThoughtStep,
  ActionStep,
  ObservationStep,
  TaoCycle,
  TaoLoopResult,
} from "./thought-act-observe.js";

// ─── File Change Event Bus ────────────────────────────────────────────────────

export {
  globToRegex,
  matchesGlob,
  matchesPolicy,
  clearGlobCache,
  FileChangeEventBus,
  TriggerRouter,
  buildTriggerRule,
  DEFAULT_TRIGGER_RULES,
  globalFileChangeBus,
} from "./file-change-event-bus.js";
export type {
  ChangeKind,
  FileChangeEvent,
  FileChangeBatch,
  FileChangeHandler,
  WatchPolicy,
  TriggerRegistration,
  TriggerAction,
  TriggerRule,
  RoutedTrigger,
} from "./file-change-event-bus.js";

// ─── Requirements Interview ───────────────────────────────────────────────────

export {
  validateAnswer as validateInterviewAnswer,
  InterviewSession,
  buildRequirementsDocument,
  formatRequirementsForPrompt,
  createInterviewSession,
  WEB_APP_QUESTIONS,
  CLI_TOOL_QUESTIONS,
  QUESTION_BANKS,
} from "./requirements-interview.js";
export type {
  QuestionKind,
  ProjectKind,
  InterviewQuestion,
  InterviewAnswer,
  RequirementsDocument,
  InterviewStatus,
} from "./requirements-interview.js";

// ─── Error Recovery Router ────────────────────────────────────────────────────

export {
  classifyError,
  getRecoveryStrategy,
  ErrorRecoveryRouter,
  globalErrorRecoveryRouter,
} from "./error-recovery-router.js";
export type {
  ErrorClass,
  RecoveryAction,
  RecoveryStrategy,
  ErrorFingerprint,
  RecoveryAttempt,
  RecoverySession as ErrorRecoverySession,
} from "./error-recovery-router.js";

// ─── FIM Prompt Builder ───────────────────────────────────────────────────────

export { buildFimPrompt, detectFimModel, isFimCapable } from "./fim-prompt-builder.js";
export type { FimModel } from "./fim-prompt-builder.js";

// ─── Context Mention Resolver ─────────────────────────────────────────────────

export { resolveMention, classifyMention } from "./context-mention-resolver.js";
export type {
  MentionType,
  ContextChunk as MentionContextChunk,
  ResolveMentionOptions,
} from "./context-mention-resolver.js";

// ─── Outcome-Aware Retry (Sprint AE — dim 15) ────────────────────────────────

export { lookupRecentFailureModes } from "./outcome-aware-retry.js";
export type { PastFailureContext } from "./outcome-aware-retry.js";

// ─── FIM Acceptance Tracker (Sprint AF — dim 1) ───────────────────────────────

export {
  recordFimAcceptance,
  getLanguageAcceptanceRate,
  loadFimAcceptanceHistory,
} from "./fim-acceptance-tracker.js";
export type { FimAcceptanceEntry, LanguageAcceptanceStats } from "./fim-acceptance-tracker.js";

// ─── Approval Thread Tracker (Sprint AF — dim 13) ────────────────────────────

export { ApprovalThreadTracker, loadApprovalThreads } from "./approval-thread-tracker.js";
export type { ApprovalThread, ApprovalThreadRecord } from "./approval-thread-tracker.js";

// ─── Inline Edit Log (Sprint AG — dim 6) ─────────────────────────────────────

export { emitInlineEditLog, loadInlineEditLog, summarizeInlineEdits } from "./inline-edit-log.js";
export type { EditType, InlineEditLogEntry, InlineEditSummary } from "./inline-edit-log.js";

// ─── Plugin Outcome Tracker (Sprint AH — dim 22) ─────────────────────────────

export {
  PluginOutcomeTracker,
  recordPluginOutcome,
  loadPluginOutcomes,
  summarizePluginOutcomes,
} from "./plugin-outcome-tracker.js";
export type {
  PluginOutcomeStatus,
  PluginOutcomeEntry,
  PluginOutcomeSummary,
} from "./plugin-outcome-tracker.js";

// ─── Git Lifecycle Manager (Sprint AA — dim 8) ────────────────────────────────

export { GitLifecycleManager, emitGitLifecycleEvent } from "./git-lifecycle-manager.js";
export type {
  GitLifecycleStage,
  GitLifecycleEvent,
  GitLifecycleSummary,
} from "./git-lifecycle-manager.js";

// ─── Memory Recall Quality (Sprint AC — dim 21) ───────────────────────────────

export {
  recordMemoryRecall,
  summarizeRecallQuality,
  loadRecallQualityLog,
} from "./memory-recall-quality.js";
export type { MemoryRecallRecord, RecallQualitySummary } from "./memory-recall-quality.js";

// ─── Cost Savings Report (Sprint AD — dim 27) ─────────────────────────────────

export {
  computeSessionSavings,
  loadCostSavingsReport,
  summarizeCostSavings,
} from "./cost-savings-report.js";
export type { CostSavingsEntry, CostSavingsSummary } from "./cost-savings-report.js";

// Sprint AI/BL — Dim 20: Debug-guided repair advisor
export {
  suggestDebugFix,
  emitDebugRepairHint,
  generateRepairSuggestions,
  formatRepairSuggestionsForPrompt,
} from "./debug-repair-advisor.js";
export type {
  DebugRepairHint,
  DebugRepairLogEntry,
  RepairSuggestion,
  SnapLike,
} from "./debug-repair-advisor.js";

// Sprint Dim20 — Debug context assembler + outcome delta
export {
  hasStackTrace,
  assembleDebugContext,
  formatDebugContextForPrompt,
  recordDebugRepairOutcome,
  loadDebugRepairOutcomes,
  computeDebugRepairImpact,
  getDebugRepairSuccessRate,
} from "./debug-context-assembler.js";
export type {
  ParsedStackFrame,
  DebugRepairContext,
  DebugRepairOutcome,
  DebugRepairImpactReport,
} from "./debug-context-assembler.js";

// Sprint Dim18 — Diff risk clustering
export {
  clusterDiffByRisk,
  buildDiffRiskReport,
  getHighRiskFiles,
  formatRiskClustersForPrompt,
} from "./diff-risk-clusterer.js";
export type { RiskSurface, DiffRiskCluster, DiffRiskReport } from "./diff-risk-clusterer.js";

// Sprint Dim18 — Review severity ranker
export {
  rankReviewComments,
  getSeverityHistogram,
  getTopPriorityComments,
  buildSeverityRankingReport,
  formatSeverityRankingForPrompt,
} from "./review-severity-ranker.js";
export type {
  RankedReviewComment,
  SeverityHistogram,
  SeverityRankingReport,
} from "./review-severity-ranker.js";

// Sprint Dim18 — False-positive suppressor
export {
  shouldSuppressComment,
  filterSuppressedComments,
  recordFalsePositive,
  loadFalsePositives,
  getFalsePositiveRate,
  getFalsePositiveStats,
} from "./false-positive-suppressor.js";
export type { FalsePositiveEntry, FalsePositiveStats } from "./false-positive-suppressor.js";

// Sprint Dim18 — Review defect correlator
export {
  recordReviewDefectOutcome,
  loadReviewDefectOutcomes,
  computeReviewDefectCorrelation,
  getReviewDefectCorrelation,
  formatDefectCorrelationWarning,
} from "./review-defect-correlator.js";
export type { ReviewDefectOutcome, ReviewDefectCorrelation } from "./review-defect-correlator.js";

// Sprint AI — Dim 24: Provider health router
export { ProviderHealthRouter } from "./provider-health-router.js";
export type { ProviderHealthStatus, HealthRouteLogEntry } from "./provider-health-router.js";

// Sprint AJ — Dim 16: Plan edit tracker
export { recordPlanEdit, summarizePlanEdits, computePlanDiff } from "./plan-edit-tracker.js";
export type { PlanEditEntry, PlanEditSummary } from "./plan-edit-tracker.js";

// Sprint AK — Dim 6: Edit quality output hook
export { setEditQualityOutputHook } from "./inline-edit-log.js";

// Sprint AL — Dim 17: Browser session persistence
export {
  saveBrowserSession,
  loadBrowserSessions,
  getLastSessionForUrl,
  summarizeBrowserSessions,
} from "./browser-session-store.js";
export type {
  BrowserSessionRecord,
  BrowserSessionStep,
  BrowserSessionStoreSummary,
} from "./browser-session-store.js";

// Sprint AM — Dim 15: Task recovery log
export {
  recordTaskRecovery,
  loadTaskRecoveryLog,
  getTopRecoveryPatterns,
  buildRecoveryBrief,
} from "./task-recovery-log.js";
export type { TaskRecoveryEntry, RecoveryPattern } from "./task-recovery-log.js";

// Sprint AM — Dim 7: Autonomy convergence metrics
export { AutonomyMetricsTracker, summarizeAutonomyMetrics } from "./autonomy-metrics.js";
export type { AutonomyConvergenceEntry, AutonomyConvergenceSummary } from "./autonomy-metrics.js";

// Sprint AN — Dim 21: Lesson brief
export {
  buildLessonBrief,
  emitLessonBrief,
  loadLessons,
  seedLessonsIfEmpty,
} from "./lesson-brief.js";
export type { LessonRecord, LessonBriefEntry } from "./lesson-brief.js";

// Sprint AN — Dim 18: Review summary + coverage
export { buildReviewSummary, computeReviewCoverage } from "./pr-review-orchestrator.js";
export type { ReviewSummaryResult } from "./pr-review-orchestrator.js";

// Sprint AO — Dim 3: Code quality gate
export { scoreGeneratedCode, CodeQualityGate } from "./code-quality-gate.js";
export type { CodeQualityScore, CodeQualityLogEntry } from "./code-quality-gate.js";

// Sprint AO — Dim 9: Cross-file consistency checker
export {
  checkExportImportMatch,
  extractExports,
  extractNamedImports,
  readFilesForCheck,
} from "./cross-file-checker.js";
export type { ConsistencyIssue, ConsistencyReport, FileContent } from "./cross-file-checker.js";

// Sprint AP — Dim 2: Context coverage tracker
export {
  recordContextHit,
  loadContextCoverage,
  summarizeContextCoverage,
} from "./context-coverage-tracker.js";
export type {
  ContextHitEntry,
  ContextCoverageSummary,
  ContextSource,
} from "./context-coverage-tracker.js";

// Sprint AP — Dim 4: File dependency context
export { buildFileContextMap } from "./file-dependency-context.js";
export type { FileDependencyMap, FileContextMap } from "./file-dependency-context.js";

// Sprint AU — Dim 15: Hard-task finish-rate tracker
export {
  classifyTaskDifficulty,
  recordFinishRate,
  loadFinishRates,
  getFinishRateStats,
} from "./finish-rate-tracker.js";
export type { TaskDifficulty, FinishRateEntry, FinishRateStats } from "./finish-rate-tracker.js";

// Sprint AV — Dim 18: PR review quality benchmark
export { benchmarkReviewQuality, ReviewQualityBenchmark } from "./pr-review-orchestrator.js";
export type { ReviewQualityResult } from "./pr-review-orchestrator.js";

// Sprint AV — Dim 21: Memory-to-outcome correlation
export {
  recordMemoryOutcomeCorrelation,
  loadMemoryOutcomes,
  getMemoryImpactScore,
} from "./context-coverage-tracker.js";
export type { MemoryOutcomeEntry } from "./context-coverage-tracker.js";

// Sprint Memory — Dim 21: Memory influence → outcome correlation + stale fact detection
export {
  joinMemoryToOutcomes,
  computeMemoryOutcomeCorrelation,
  recordMemoryOutcomeCorrelation as recordMemoryCorrelation,
  loadMemoryOutcomeCorrelation,
  detectStaleMemoryFacts,
} from "./memory-outcome-correlator.js";
export type {
  JoinedMemoryOutcome,
  MemoryOutcomeCorrelation,
  StaleMemoryReport,
} from "./memory-outcome-correlator.js";

// Sprint Dim3 — Retrieval relevance eval + task-outcome impact
export {
  evaluateRetrievalRelevance,
  loadRetrievalRelevanceLog,
  getRetrievalQualityStats,
  getRetrievalImpactOnCompletion,
  recordRetrievalImpact,
} from "./retrieval-relevance-eval.js";
export type {
  RetrievalEvalEntry,
  RetrievalQualityStats,
  RetrievalImpactReport,
  RetrievalTaskOutcome,
} from "./retrieval-relevance-eval.js";

// Sprint AT/AW/BB — Dim 10: AppGenerationGate + runGenerationWithGate + repairAndRetry
// + incrementalVerifyGate + detectProjectStack (generate.ts wiring)
export {
  AppGenerationGate,
  runGenerationWithGate,
  repairAndRetry,
  incrementalVerifyGate,
  detectProjectStack,
} from "./generation-gate.js";
export type {
  GenerationFileSpec,
  GenerationWithGateResult,
  AppGenerationReport,
  AppGenerationFileResult,
  RepairResult,
  StackTemplate,
  ExecFn,
  IncrementalExecFn,
  IncrementalVerifyResult,
} from "./generation-gate.js";

// Sprint AW — Dim 17: Browser task outcome tracker
export { BrowserTaskOutcomeTracker } from "./browser-session-store.js";
export type { BrowserTaskOutcome } from "./browser-session-store.js";

// Sprint AX — Dim 6: Inline edit acceptance store
export { InlineEditAcceptanceStore } from "./inline-edit-log.js";
export type { EditAcceptanceEntry } from "./inline-edit-log.js";

// Sprint AX — Dim 27: Cost-per-success metric
export {
  recordCostPerTaskOutcome,
  loadCostPerTaskOutcomes,
  getCostPerSuccessRatio,
} from "./cost-routing-log.js";
export type { CostPerTaskEntry, CostPerSuccessRatio } from "./cost-routing-log.js";

// Sprint AY — Dim 15: Task ambiguity detector
export {
  detectTaskAmbiguity,
  recordAmbiguityDetection,
  loadAmbiguityLog,
  getAmbiguityStats,
} from "./task-ambiguity-detector.js";
export type {
  AmbiguitySignalType,
  AmbiguitySignal,
  AmbiguityResult,
  AmbiguityLogEntry,
} from "./task-ambiguity-detector.js";

// Sprint AZ/BK — Dim 2: Retrieval citation tracker
export {
  beginRetrievalSession,
  bufferRetrievedFact,
  computeCitationScore,
  recordCitationResult,
  loadCitationResults,
  getOverallCitationRate,
  jaccardSimilarity as citationJaccardSimilarity,
} from "./retrieval-citation-tracker.js";
export type { RetrievedFactBuffer, CitationResult } from "./retrieval-citation-tracker.js";

// Sprint AZ/BM — Dim 21: Memory decision influence
export {
  computeMemoryDecisionInfluence,
  recordMemoryDecisionInfluence,
  loadMemoryDecisionLog,
  getMemoryInfluenceStats,
  getMemoryInfluenceSummary,
} from "./context-coverage-tracker.js";
export type { MemoryDecisionEntry } from "./context-coverage-tracker.js";

// Sprint BA — Dim 1: FIM Levenshtein acceptance stats
export {
  recordLevenshteinAcceptance,
  loadLevenshteinStats,
  getLevenshteinAcceptanceThreshold,
  levenshteinDistance,
  // Sprint Dim1: stale suppressor + cancellation rate
  trackSuggestionShown,
  shouldSuppressSuggestion,
  resetSuggestionShown,
  clearSuggestionSuppressCache,
  recordFimCancellation,
  getFimCancellationRate,
} from "./fim-acceptance-tracker.js";
export type { FimLevenshteinStat } from "./fim-acceptance-tracker.js";

// Sprint Dim1: FIM latency histogram
export {
  recordFimLatency,
  loadFimLatencyLog,
  buildFimLatencyHistogram,
  getFimLatencyStats,
} from "./fim-latency-tracker.js";
export type { FimLatencyEntry, FimLatencyHistogram } from "./fim-latency-tracker.js";

// Sprint BA — Dim 16: Plan step verifier
export {
  verifyStepCompletion,
  recordStepVerification,
  loadStepVerifications,
  getPlanVerificationRate,
} from "./plan-step-verifier.js";
export type {
  PlanStep as VerifierPlanStep,
  StepVerificationResult,
  StepVerificationReason,
} from "./plan-step-verifier.js";

// Sprint BB — Dim 3: Code quality trend tracker
export {
  computeQualityTrend,
  recordQualityTrend,
  loadQualityTrendLog,
  getQualityTrendStats,
} from "./code-quality-gate.js";
export type { QualityTrendResult } from "./code-quality-gate.js";

// Sprint BC — Dim 18: Two-pass Architect PR Review
export {
  parseArchitectIssues,
  architectToReviewComments,
  buildArchitectReviewPrompt,
  buildEditorReviewPrompt,
  recordArchitectReviewPlan,
  loadArchitectReviewLog,
  getArchitectReviewStats,
  computeReviewDepth,
  buildArchitectReviewResult,
} from "./pr-review-architect.js";
export type {
  ArchitectIssueSeverity,
  ArchitectReviewIssue,
  ArchitectReviewPlan,
  ArchitectReviewStats,
  ArchitectReviewResult,
} from "./pr-review-architect.js";

// Sprint BD — Dim 16: Smart Per-Step Plan Context
export {
  detectStepFilePaths,
  buildStepContextBudget,
  formatStepContext,
  recordStepContextUsage,
  loadStepContextLog,
  getContextEfficiency,
  PlanSmartContext,
} from "./plan-smart-context.js";
export type {
  StepContextEntry,
  StepContextBudget,
  PlanStepContextLog,
  StepBudgetAllocation,
} from "./plan-smart-context.js";

// Sprint BF — Dim 1: FIM candidate ranker
export {
  scoreFimCandidate,
  rankFimCandidates,
  rankCandidates,
  pickBestFimCandidate,
  recordFimRankingSession,
  loadFimRankingLog,
  getFimRankingStats,
} from "./fim-candidate-ranker.js";
export type { FimCandidate, FimRankingContext, FimRankingSession } from "./fim-candidate-ranker.js";

// Sprint BO — Dim 7: Autonomy report
export { getAutonomyReport } from "./autonomy-metrics-tracker.js";
export type { AutonomyMetric, AutonomyReport } from "./autonomy-metrics-tracker.js";

// Sprint BP — Dim 17: Browser session summary
export { getSessionSummary, getMostRecentSessions } from "./browser-session-store.js";
export type { BrowserStoreSummaryRecord } from "./browser-session-store.js";

// Sprint BQ — Dim 15: Recovery stats + failure-mode grouping
export { getRecoveryStats, groupByFailureMode } from "./task-recovery-log.js";
export type { RecoveryStats } from "./task-recovery-log.js";

// Sprint BQ — Dim 17: Browser outcome logger
export {
  recordBrowserOutcome,
  loadBrowserOutcomes,
  getBrowserOutcomeSummary,
} from "./browser-session-store.js";
export type { BrowserOutcomeRecord, BrowserOutcomeSummary } from "./browser-session-store.js";

// Sprint BR — Dim 15: Task recovery reporter
export {
  getTaskRecoveryStats,
  recordTaskRecoveryStats,
  loadTaskRecoveryStats,
} from "./task-recovery-log.js";
export type { TaskRecoveryStats } from "./task-recovery-log.js";

// Sprint BR — Dim 13: Diff quality enhanced with changeComplexity + hasBreakingChange
// (scoreDiff + DiffQualityScore already exported above from "./diff-quality.js" at line ~923)

// Sprint BS — Dim 11: SessionProofSynthesizer
export {
  synthesizeSessionProof,
  recordSessionProof,
  loadSessionProofs,
  getSessionProofStats,
} from "./session-proof-synthesizer.js";
export type {
  SessionArtifact,
  SessionProof,
  SessionProofStats,
} from "./session-proof-synthesizer.js";

// Sprint BT — Dim 22: Plugin Ecosystem Report
export {
  buildPluginOutcomeSummaries,
  buildPluginEcosystemReport,
  recordPluginEcosystemReport,
  loadPluginEcosystemReports,
} from "./plugin-outcome-tracker.js";
export type {
  PluginOutcomeSummaryByPlugin,
  PluginEcosystemReport,
} from "./plugin-outcome-tracker.js";

// Sprint BU — Dim 19: Test generation quality
export {
  analyzeTestSuite,
  scoreTestQuality,
  recordTestQualityScore,
  loadTestQualityScores,
  getTestQualityReport,
} from "./test-generation-quality.js";
export type { GeneratedTestSuite, TestQualityScore } from "./test-generation-quality.js";

// Sprint BV — Dim 27: Cost optimization report
export {
  buildCostOptimizationReport,
  recordCostOptimizationReport,
  loadCostOptimizationReports,
  getCostOptimizationStats,
} from "./cost-optimization-report.js";
export type {
  CostOptimizationOpportunity,
  CostOptimizationReport,
} from "./cost-optimization-report.js";

// Sprint BY — Dim 23: Security scan report
export {
  buildSecurityScanReport,
  scanContentForFindings,
  recordSecurityScanReport,
  loadSecurityScanReports,
  getSecurityTrendStats,
} from "./security-scan-report.js";
export type {
  SecurityFinding as SecurityScanFinding,
  SecurityScanReport,
} from "./security-scan-report.js";

// Sprint BZ — Dim 24: Provider health report
export {
  buildProviderHealthSnapshot,
  buildProviderHealthReport,
  recordProviderHealthReport,
  loadProviderHealthReports,
} from "./provider-health-report.js";
export type { ProviderHealthSnapshot, ProviderHealthReport } from "./provider-health-report.js";

// Sprint BW — Dim 4: Repo context ranker
export {
  scoreChunkRelevance,
  rankContextChunks,
  recordContextRankingEvent,
  loadContextRankingLog,
  getContextRankingStats,
} from "./repo-context-ranker.js";
export type {
  ContextChunk,
  RankedContextResult,
  ContextRankingLogEntry,
} from "./repo-context-ranker.js";

// Sprint BX — Dim 6: Inline edit quality report
export {
  buildInlineEditMetrics,
  buildInlineEditQualityReport,
  recordInlineEditReport,
  loadInlineEditReports,
} from "./inline-edit-quality-report.js";
export type {
  InlineEditQualityMetrics,
  InlineEditQualityReport,
} from "./inline-edit-quality-report.js";

// Sprint CA — Dim 25: Compliance Audit Trail Builder
export {
  createAuditEvent,
  recordAuditEvent,
  loadAuditTrail,
  buildAuditTrailSummary,
  exportAuditTrailCSV,
} from "./compliance-audit-trail.js";
export type {
  AuditEventType,
  AuditEvent as ComplianceAuditEvent,
  AuditTrailSummary,
} from "./compliance-audit-trail.js";

// Sprint CB — Dim 9: Collaborative Context Snapshot
export {
  buildCollaborativeSnapshot,
  formatSnapshotForPrompt,
  recordCollaborativeSnapshot,
  loadCollaborativeSnapshots,
  getCollaborationStats,
} from "./collaborative-context.js";
export type { DeveloperContext, CollaborativeSnapshot } from "./collaborative-context.js";

// Sprint CC — Dim 14: Explanation Quality Meter
export {
  analyzeExplanationQuality,
  recordExplanationQuality,
  loadExplanationQualityLog,
  getExplanationQualityStats,
} from "./explanation-quality-meter.js";
export type {
  ExplanationQualitySignals,
  ExplanationQualityScore,
} from "./explanation-quality-meter.js";

// Sprint CD — Dim 26: Offline Capability Report
export {
  classifyOllamaModel,
  buildOfflineCapabilityReport,
  recordOfflineCapabilityReport,
  loadOfflineCapabilityReports,
} from "./offline-capability-report.js";
export type { OllamaModelInfo, OfflineCapabilityReport } from "./offline-capability-report.js";

// Sprint CH2 — Dim 15: Task triage + completion verdict
export {
  classifyTask,
  computeTaskCompletionVerdict,
  recordTaskCompletion,
  loadTaskCompletionLog,
} from "./task-triage.js";
export type {
  TaskClassification,
  TaskCompletionVerdict,
  TaskCompletionEntry,
} from "./task-triage.js";

// Sprint Dims 9+14+35 — Screenshot-to-code pipeline
export {
  analyzeScreenshotLayout,
  generateCodeFromScreenshot,
  refineCodeFromScreenshot,
  decomposeIntoComponents,
  scoreVisualFidelity,
  recordScreenshotCodeOutcome,
  loadScreenshotCodeOutcomes,
  getScreenshotCodeAcceptanceRate,
} from "./screenshot-to-code-pipeline.js";
export type {
  LayoutAnalysis,
  ScreenshotCodeResult,
  ScreenshotCodeOutcome,
  ComponentDecomposition,
  VisualFidelityScore,
} from "./screenshot-to-code-pipeline.js";

// Sprint Dim 35 — Onboarding metrics + repo readiness
export {
  recordOnboardingStep,
  loadOnboardingLog,
  getOnboardingStats,
  checkRepoReadiness,
} from "./onboarding-metrics.js";
export type {
  OnboardingStep,
  OnboardingEntry,
  OnboardingStats,
  RepoReadinessResult,
} from "./onboarding-metrics.js";

// Sprint Dim 28 — Enterprise Auth (SSO/OIDC/SAML)
export { validateSsoConfig, buildSsoAuthUrl, parseSsoCallback } from "./enterprise-auth.js";
export type {
  SsoProtocol,
  AuthenticatorAssuranceLevel,
  CredentialType,
  OidcProviderConfig,
  SamlProviderConfig,
  SsoProviderConfig,
  SsoConfig,
  OrgIdentity,
  WorkspaceIdentity,
  WorkspaceMember,
  SsoValidationResult,
  SsoAuthUrlResult,
  SsoCallbackResult,
} from "./enterprise-auth.js";

// Sprint Dim 28 — RBAC Engine
export {
  checkPermission,
  evaluatePolicy,
  getPrincipalRoles,
  generatePolicyReport as generateRbacPolicyReport,
  registerPolicy,
  addRelationTuple,
  clearPolicies,
} from "./rbac-engine.js";
export type {
  PolicyEffect,
  ConsistencyLevel,
  Principal,
  Resource,
  PolicyRule,
  PolicyCondition,
  ResourcePolicy,
  PolicyCheckRequest,
  TraceComponentKind,
  TraceComponent,
  PolicyCheckResult,
  PolicyCheckResponse,
  PolicyReport as RbacPolicyReport,
  RelationTuple,
} from "./rbac-engine.js";

// Sprint Dim 28 — Enterprise Audit
export {
  recordAuditEvent as recordEnterpriseAuditEvent,
  loadAuditLog as loadEnterpriseAuditLog,
  queryAuditLog as queryEnterpriseAuditLog,
  exportAuditLog as exportEnterpriseAuditLog,
  writeAuditExport,
} from "./enterprise-audit.js";
export type {
  AuditAction as EnterpriseAuditAction,
  AuditEvent as EnterpriseAuditEvent,
  AuditQueryFilter as EnterpriseAuditQueryFilter,
  AuditExportFormat as EnterpriseAuditExportFormat,
  AuditExportResult as EnterpriseAuditExportResult,
} from "./enterprise-audit.js";

// Sprint Dim 28 — Admin Policy
export {
  loadAdminPolicy,
  saveAdminPolicy,
  validateAdminPolicy,
  generatePolicyReport,
} from "./admin-policy.js";
export type {
  PolicyEnforcementMode,
  ScopeRule,
  RoleDefinition,
  AdminPolicy,
  PolicyValidationResult,
  PolicyReportSection,
  PolicyReport,
} from "./admin-policy.js";

// Sprint Dim 14 (extended) — Browser capture tracker
export {
  classifyConsoleMessage,
  classifyNetworkError,
  isBlockingError,
  buildCaptureSummary,
  extractErrorsFromDevOutput,
  buildRepairPrompt,
  recordPreviewFailure,
  loadPreviewFailures,
  getPreviewRepairSuccessRate,
  getPreviewSessionStats,
} from "./browser-capture-tracker.js";
export type {
  BrowserErrorSeverity,
  BrowserErrorSource,
  BrowserRuntimeError,
  NetworkFailure,
  BrowserCaptureSummary,
  PreviewFailureRecord,
  RepairPrompt,
  PreviewSessionStats,
} from "./browser-capture-tracker.js";

// Sprint Dim 48 — Accessibility / Inclusive UX
export {
  runAccessibilityAudit,
  generateA11yReport,
  recordA11yAudit,
  loadA11yAuditLog,
  getA11yTrendScore,
} from "./accessibility-auditor.js";
export type {
  A11yImpact,
  A11yWcagLevel,
  A11yViolation,
  AccessibilityAuditResult,
  A11yAuditLogEntry,
} from "./accessibility-auditor.js";

// Sprint Dim 40 — Configuration ergonomics
export {
  validateDantecodeConfig,
  applyConfigDefaults,
  migrateConfig,
  DEFAULT_DANTECODE_CONFIG,
} from "./config-validator.js";
export type {
  DantecodeConfig,
  ConfigValidationResult,
  ConfigValidationError,
  ConfigValidationWarning,
} from "./config-validator.js";

// Sprint Dim 38 — Latency / Responsiveness
export {
  LatencyTracker,
  globalLatencyTracker,
  recordLatencySnapshot,
  loadLatencyLog,
} from "./latency-tracker.js";
export type {
  LatencyCategory,
  LatencyRecord,
  LatencyStats,
  LatencySnapshot,
} from "./latency-tracker.js";

// Sprint Dim 43 — Documentation quality
export {
  checkDocsQuality,
  generateDocsReport,
  recordDocsQuality,
  loadDocsQualityLog,
} from "./docs-quality.js";
export type { DocsQualityResult, DocsCheckConfig } from "./docs-quality.js";
export { generateConfigReference, renderConfigReferenceMarkdown } from "./config-doc-generator.js";
export type { ConfigFieldDoc } from "./config-doc-generator.js";

// Structured error hierarchy — replaces ad-hoc `throw new Error(...)` calls so
// catch sites can pattern-match on type instead of regex-ing message strings.
export {
  DanteCodeError,
  ConfigInvalidError,
  ConfigMissingKeyError,
  ToolExecutionError,
  ToolInputInvalidError,
  ProtectedFileWriteError,
  StaleSnapshotError,
  FileNotFoundError,
  FileReadError,
  FileWriteError,
  ProviderUnavailableError,
  ProviderRateLimitError,
  ProviderAuthError,
  ContextOverflowError,
  ParseError,
  WorkflowGateError,
  ValidationError,
  TimeoutError,
  IntegrityError,
  isDanteCodeError,
  wrapAsDanteCodeError,
} from "./errors.js";
export type { DanteErrorCode, DanteErrorOptions, DanteRecoveryStrategy } from "./errors.js";

// Resilience primitives — retry/timeout/parallel-with-limit, integrated with
// the DanteCodeError recovery hints. Use at boundary points (provider calls,
// tool spawns, network requests).
export {
  retry,
  withTimeout,
  retryWithTimeout,
  isRetryable,
  parallelWithLimit,
} from "./resilience.js";
export type { RetryOptions } from "./resilience.js";

// Sprint Dim 30 — UX trust / explainability
export {
  labelConfidence,
  narrateDecision,
  rateActionRisk,
  renderActionBadge,
  renderContextAttribution,
  renderSessionSummary,
  recordDecisionNarrative,
  loadDecisionNarratives,
} from "./decision-narrator.js";
export type {
  ConfidenceLabel,
  ActionRisk,
  DecisionNarrative,
  SessionSummaryInput,
} from "./decision-narrator.js";
