// ============================================================================
// @dantecode/core — Public API
// ============================================================================

// ─── Model Router ─────────────────────────────────────────────────────────────

export {
  ModelRouterImpl,
  shouldContinueLoop,
  getRouterMetrics,
  getRouterTraces,
} from "./model-router.js";
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
export type { InitializeStateOptions } from "./state.js";

// ─── Project Detection ────────────────────────────────────────────────────────

export { detectProjectStack, getGStackDefaults } from "./project-detector.js";
export type { ProjectLanguage, DetectedStack } from "./project-detector.js";

// ─── Multi-Agent ───────────────────────────────────────────────────────────────

export {
  MultiAgent,
  type MultiAgentConfig,
  type MultiAgentProgressCallback,
} from "./multi-agent.js";

// ─── Token Counter ───────────────────────────────────────────────────────────

export { estimateTokens, estimateMessageTokens, getContextUtilization } from "./token-counter.js";
export type { ContextUtilization } from "./token-counter.js";

// ─── Context Condenser ───────────────────────────────────────────────────────

export {
  calculatePressure,
  condenseContext,
  estimateMessageTokens as estimateMessageTokensFromMessage,
} from "./context-condenser.js";
export type { ContextPressure, CondenseOptions, CondenseResult } from "./context-condenser.js";

// ——— Execution Heuristics —————————————————————————————————————————————————————————

export {
  promptRequestsToolExecution,
  responseNeedsToolExecutionNudge,
  isQuestionPrompt,
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

export { RepoMapTreeSitter } from "./repo-map-tree-sitter.js";
export type { TreeSitterParser } from "./repo-map-tree-sitter.js";

export {
  extractTags,
  computeSymbolRanks,
  formatRepoMapContext,
  buildPageRankRepoMap,
  getRelevantContext,
} from "./repo-map-pagerank.js";
export type {
  SymbolTag,
  SymbolRank,
  PageRankRepoMapOptions,
  RepoMapContext,
} from "./repo-map-pagerank.js";

// Unified Repo Map API
export { buildUnifiedRepoMap, getRepoMapForQuery, invalidateRepoMapCache } from "./repo-map.js";
export type { UnifiedRepoMapOptions, RepoMapCache } from "./repo-map.js";

export { TypeScriptParser } from "./parsers/typescript-parser.js";
export { JavaScriptParser } from "./parsers/javascript-parser.js";
export { PythonParser } from "./parsers/python-parser.js";
export { GoParser } from "./parsers/go-parser.js";
export { RustParser } from "./parsers/rust-parser.js";

// ─── Architect Planner ──────────────────────────────────────────────────────

export { ArchitectPlanner, analyzeComplexity, parsePlanFromText } from "./architect-planner.js";
export type { ExecutionPlan, PlanStep, ArchitectPlannerOptions } from "./architect-planner.js";

export { PlanExecutor, areDependenciesMet, getNextExecutableSteps } from "./plan-executor.js";
export type {
  StepExecutionResult,
  PlanExecutionResult,
  PlanExecutorOptions,
} from "./plan-executor.js";

// ─── Plan Store ─────────────────────────────────────────────────────────────

export { PlanStore } from "./plan-store.js";
export type { StoredPlan, PlanStatus } from "./plan-store.js";

// ─── Plan Renderer ──────────────────────────────────────────────────────────

export { renderPlan, renderPlanStep, renderPlanSummary, complexityBadge } from "./plan-renderer.js";
export type { PlanRenderOptions } from "./plan-renderer.js";

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

// ─── Event Engine ────────────────────────────────────────────────────────────

export { EventEngine } from "./event-engine.js";
export type {
  DanteEvent,
  RuntimeBackedDanteEvent,
  DanteEventType,
  LegacyDanteEventType,
  WorkflowDefinition,
  EventQueueEntry,
  EventEngineOptions,
  ProcessNextResult,
} from "./event-engine.js";

// ─── Durable Event Store ─────────────────────────────────────────────────────

export { JsonlEventStore } from "./durable-event-store.js";
export type { DurableEventStore, EventFilter, StoredEvent } from "./durable-event-store.js";

// ─── Credential Vault ────────────────────────────────────────────────────────
export { CredentialVault } from "./credential-vault.js";
export type { CredentialVaultOptions } from "./credential-vault.js";

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

export {
  EventSourcedCheckpointer,
  hashCheckpointContent,
  resumeFromCheckpoint,
} from "./checkpointer.js";
export type {
  Checkpoint,
  CheckpointMetadata,
  PendingWrite,
  CheckpointTuple,
  CheckpointEvent,
  CheckpointListOptions,
  EventSourcedCheckpointerOptions,
  ResumeContext,
} from "./checkpointer.js";

// ─── Recovery Manager ───────────────────────────────────────────────────────

export {
  RecoveryManager,
  formatStaleSessionSummary,
  filterSessionsByStatus,
  sortSessionsByTime,
} from "./recovery-manager.js";
export type {
  SessionStatus,
  StaleSession,
  RecoveryOptions,
  SessionRecoveryResult,
} from "./recovery-manager.js";

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
  isValidWaveCompletion,
  deriveWaveExpectations,
  CLAUDE_WORKFLOW_MODE,
  WAVE_COMPLETE_RE,
  buildBridgeWarningPreamble,
  hasBridgeCapabilityGaps,
} from "./skill-wave-orchestrator.js";
export type {
  SkillWave,
  WaveOrchestratorState,
  BridgeActivationWarnings,
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

// ─── Semantic Index ────────────────────────────────────────────────────────

export { BackgroundSemanticIndex } from "./semantic-index.js";
export type {
  SemanticIndex,
  IndexReadiness,
  IndexEntry,
  BackgroundSemanticIndexOptions,
} from "./semantic-index.js";

// ─── Council Orchestrator ────────────────────────────────────────────────────

export {
  createCouncilRunState,
  newRunId,
  newLaneId,
  newHandoffId,
} from "./council/council-types.js";
export type {
  AgentKind,
  AdapterKind,
  AgentHealthStatus,
  CostClass,
  TaskCategory,
  OverlapLevel,
  MergeDecision,
  MergeConfidenceBucket,
  AgentTaskProfile,
  FileMandate,
  OverlapRecord,
  HandoffPacket,
  AgentSessionState,
  FinalSynthesisRecord,
  CouncilRunState,
  CouncilTaskPacket,
  CouncilConfig,
} from "./council/council-types.js";

export {
  saveCouncilRun,
  loadCouncilRun,
  tryLoadCouncilRun,
  listCouncilRuns,
  updateAgentSession,
  appendOverlapRecord,
  appendHandoffPacket,
  setRunStatus,
} from "./council/council-state-store.js";

export { UsageLedger } from "./council/usage-ledger.js";
export type { LedgerEntry, LedgerSnapshot } from "./council/usage-ledger.js";

export { OverlapDetector, classifyOverlapLevel } from "./council/overlap-detector.js";
export type { OverlapDetectionResult } from "./council/overlap-detector.js";

export { WorktreeObserver } from "./council/worktree-observer.js";
export type {
  WorktreeSnapshot,
  WorktreeDriftEvent,
  WorktreeObserverOptions,
} from "./council/worktree-observer.js";

export { CouncilRouter } from "./council/council-router.js";
export type {
  LaneAssignmentRequest,
  LaneAssignmentResult,
  ReassignmentRequest,
  ReassignmentResult,
} from "./council/council-router.js";

export { MergeConfidenceScorer } from "./council/merge-confidence.js";
export type {
  MergeCandidatePatch,
  ConfidenceFactors,
  MergeConfidenceScore,
} from "./council/merge-confidence.js";

export { MergeBrain } from "./council/merge-brain.js";
export type { MergeBrainInput, MergeBrainResult } from "./council/merge-brain.js";
export type { WorktreeHooks } from "@dantecode/runtime-spine"; // Re-export for convenience

export { HandoffEngine as CouncilHandoffEngine } from "./council/handoff-engine.js";
export type { HandoffCreationOptions, HandoffValidationResult } from "./council/handoff-engine.js";

export {
  createCouncilEvent,
  councilStartEvent,
  laneAssignedEvent,
  laneFrozenEvent,
  overlapDetectedEvent,
  handoffCreatedEvent,
  mergeCompletedEvent,
  mergeBlockedEvent,
} from "./council/council-events.js";
export type { CouncilEventType, CouncilEvent } from "./council/council-events.js";

export { CouncilOrchestrator } from "./council/council-orchestrator.js";
export type {
  CouncilLifecycleStatus,
  CouncilOrchestratorOptions,
  OrchestratorEvents,
  OrchestratorStartOptions,
} from "./council/council-orchestrator.js";

export { FleetBudget, DEFAULT_FLEET_BUDGET_CONFIG } from "./council/fleet-budget.js";
export type {
  FleetBudgetConfig,
  FleetBudgetState,
  FleetBudgetReport,
  AgentBudgetEntry,
  AgentBudgetRemaining,
} from "./council/fleet-budget.js";
export { TaskRedistributor } from "./council/task-redistributor.js";
export type {
  RedistributionCandidate,
  RedistributionResult,
  BusyLaneInfo,
} from "./council/task-redistributor.js";

export { DanteCodeAdapter } from "./council/agent-adapters/dantecode.js";
export type { SelfLaneExecutor } from "./council/agent-adapters/dantecode.js";
export { CodexAdapter } from "./council/agent-adapters/codex.js";
export { ClaudeCodeAdapter } from "./council/agent-adapters/claude-code.js";
export { AntigravityAdapter } from "./council/agent-adapters/antigravity.js";
export { FileBridgeAdapter } from "./council/agent-adapters/file-bridge.js";
export { BaseCouncilAdapter } from "./council/agent-adapters/base.js";
export type {
  AdapterAvailability,
  AdapterCapacity,
  AdapterSubmission,
  AdapterStatus,
  AdapterStatusKind,
  AdapterArtifacts,
  AdapterPatch,
  RateLimitSignal,
  CouncilAgentAdapter,
} from "./council/agent-adapters/base.js";

// ─── FIM Engine ───────────────────────────────────────────────────────────────

export { FIMEngine } from "./fim-engine.js";
export type { FIMEngineOptions, FIMContext } from "./fim-engine.js";

// ─── Persistent Memory ────────────────────────────────────────────────────────

export { PersistentMemory } from "./persistent-memory.js";

// ─── Durable Run Store ────────────────────────────────────────────────────────

export { DurableRunStore } from "./durable-run-store.js";

// ─── Workflow Runtime ─────────────────────────────────────────────────────────

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
} from "./workflow-runtime.js";

// ─── Reasoning Chain ──────────────────────────────────────────────────────────

export { ReasoningChain, getCostMultiplier } from "./reasoning-chain.js";
export type {
  ReasoningPhase,
  ReasoningTier,
  CritiqueResult,
  ChainStep,
  ReasoningChainOptions,
  ReasoningVerificationResult,
} from "./reasoning-chain.js";

// ─── Autonomy Engine ──────────────────────────────────────────────────────────

export { AutonomyEngine } from "./autonomy-engine.js";

// ─── Metrics Collector ────────────────────────────────────────────────────────

export { MetricsCollector } from "./metrics-collector.js";

// ─── Security Engine ──────────────────────────────────────────────────────────

export { SecurityEngine } from "./security-engine.js";

// ─── Secrets Scanner ──────────────────────────────────────────────────────────

export { SecretsScanner } from "./secrets-scanner.js";

// ─── Confidence Synthesizer ───────────────────────────────────────────────────

export { synthesizeConfidence } from "./confidence-synthesizer.js";
export type { ConfidenceSynthesisResult } from "./confidence-synthesizer.js";

// ─── UX Engine ────────────────────────────────────────────────────────────────

export { UXEngine, Spinner } from "./ux-engine.js";
export type { ThemeName, UXEngineOptions } from "./ux-engine.js";

// ─── Acquire Utilities ────────────────────────────────────────────────────────

export { acquireUrl } from "./tool-runtime/acquire-url.js";
export { acquireArchive } from "./tool-runtime/acquire-archive.js";

// ─── Git Hook Handler ─────────────────────────────────────────────────────────

export { GitHookHandler } from "./git-hook-handler.js";

// ─── Tool Adapters ────────────────────────────────────────────────────────────

export { adaptToolResult, formatEvidenceSummary } from "./tool-runtime/tool-adapters.js";

// ─── Artifact Store ───────────────────────────────────────────────────────────

export { globalArtifactStore } from "./tool-runtime/artifact-store.js";

// ─── Verification Suite Runner ────────────────────────────────────────────────

export { VerificationSuiteRunner } from "./verification-suite-runner.js";

// ─── Critic Debater ───────────────────────────────────────────────────────────

export { criticDebate } from "./critic-debater.js";
export type { CriticOpinion } from "./critic-debater.js";

// ─── Rails Enforcer ───────────────────────────────────────────────────────────

export { globalVerificationRailRegistry } from "./rails-enforcer.js";
export type {
  VerificationRail,
  VerificationRailMode,
  VerificationRailFinding,
} from "./rails-enforcer.js";

// ─── QA Harness ───────────────────────────────────────────────────────────────

export { runQaSuite, verifyOutput } from "./qa-harness.js";
export type { VerifyOutputInput, QaSuiteOutputInput } from "./qa-harness.js";

// ─── Tool Scheduler ───────────────────────────────────────────────────────────

export {
  ApprovalGateway,
  DEFAULT_APPROVAL_RULES,
  globalApprovalGateway,
} from "./tool-runtime/approval-gateway.js";
export type {
  ApprovalGatewayConfig,
  ApprovalRule,
  PermissionAwareCheckResult,
} from "./tool-runtime/approval-gateway.js";
export {
  buildApprovalGatewayProfile,
  getModeToolExclusions,
  isExecutionApprovalMode,
  normalizeApprovalMode,
} from "./approval-modes.js";
export type { ApprovalModeInput, CanonicalApprovalMode } from "./approval-modes.js";
export { assessMutationScope, summarizeMutationScope } from "./mutation-scope.js";
export type { MutationScopeAssessment, MutationScopeInput } from "./mutation-scope.js";
export { globalToolScheduler } from "./tool-runtime/tool-scheduler.js";

// ─── Verification Stores ──────────────────────────────────────────────────────

export { VerificationBenchmarkStore } from "./verification-benchmark-store.js";
export { VerificationHistoryStore } from "./verification-history-store.js";
export type { VerificationHistoryKind } from "./verification-history-store.js";

// ─── Bridge Listener ──────────────────────────────────────────────────────────

export { BridgeListener } from "./council/bridge-listener.js";
export type {
  AgentCommandConfig,
  BridgeListenerOptions,
  SpawnFn,
} from "./council/bridge-listener.js";

// ─── Contextual Suggestions ──────────────────────────────────────────────────

export { ContextualSuggestions, contextualSuggestions } from "./contextual-suggestions.js";
export type {
  SuggestionContext,
  ContextualSuggestionsOptions,
  Suggestion,
} from "./contextual-suggestions.js";

// ─── GitHub Client ───────────────────────────────────────────────────────────

export { GitHubClient } from "./github-client.js";
export type {
  GitHubClientConfig,
  PRDetails,
  PRFile,
  Issue as GitHubIssue,
  CheckRun,
  WorkflowRun,
} from "./github-client.js";

// ─── Run Report ─────────────────────────────────────────────────────────────

export {
  RunReportAccumulator,
  serializeRunReportToMarkdown,
  computeRunDuration,
  estimateRunCost,
} from "./run-report.js";
export type {
  RunReport,
  RunReportEntry,
  RunReportExecutionStage,
  RunReportStatus,
  RunReportVerification,
  RunReportTests,
  RunReportManifestEntry,
  RunReportAccumulatorOptions,
  RunReportSkillExecution,
} from "./run-report.js";
export { writeRunReport, reportFileName } from "./run-report-writer.js";
export type { WriteRunReportOptions } from "./run-report-writer.js";

// ─── Completion Verifier (D-12) ──────────────────────────────────────────────

export {
  verifyCompletion,
  deriveExpectations,
  summarizeVerification,
} from "./completion-verifier.js";
export type {
  CompletionExpectation,
  CompletionVerification,
  CompletionVerdict,
  ConfidenceLevel,
  CompletionCheckResult,
  PatternCheckResult,
} from "./completion-verifier.js";

// ─── Context Budget ─────────────────────────────────────────────────────────

export {
  createContextBudget,
  checkBudget,
  shouldTruncateToolOutput,
  getBudgetTier,
} from "./context-budget.js";
export type {
  ContextBudget,
  ContextBudgetState,
  BudgetTier,
  TruncationAdvice,
} from "./context-budget.js";

// ─── Model Adaptation (D-12 / D-12A) ────────────────────────────────────────

export { ModelAdaptationStore } from "./model-adaptation-store.js";
export type {
  QuirkClass,
  QuirkObservation,
  ModelAdaptationKey,
  CandidateOverride,
  ModelAdaptationSnapshot,
  QuirkKey,
} from "./model-adaptation-store.js";
export type { D12ADraftInput, LegacyDraftInput } from "./model-adaptation-store.js";
export {
  generateId as generateAdaptationId,
  migrateLegacyQuirkClass,
  ALL_QUIRK_KEYS,
  DEFAULT_EXPERIMENT_CONFIG,
  DEFAULT_ADAPTATION_CONFIG,
  VALID_ADAPTATION_MODES,
  isValidAdaptationMode,
} from "./model-adaptation-types.js";
export type {
  LegacyQuirkClass,
  OverridePatch,
  OverrideStatus,
  WorkflowType,
  AdaptationMode,
  AdaptationConfig,
  ExperimentResult,
  ExperimentConfig,
  ExperimentMetrics,
  RollbackTrigger,
  PromotionGateResult,
  AdaptationReportData,
  AdaptationEvent,
  AdaptationEventKind,
  AdaptationLogger,
} from "./model-adaptation-types.js";
export {
  detectQuirks,
  generateOverride,
  applyOverrides,
  observeAndAdapt,
  promoteOverride,
} from "./model-adaptation.js";
export type { QuirkDetectionContext } from "./model-adaptation.js";
export {
  ExperimentRateLimiter,
  runAdaptationExperiment,
  average as experimentAverage,
  createFixtureReplayRunner,
  createDetectionBasedRunner,
} from "./model-adaptation-experiment.js";
export type { ExperimentRunOptions } from "./model-adaptation-experiment.js";
export {
  evaluatePromotionGate,
  createRollbackOverride,
  shouldRollback,
} from "./model-adaptation-promotion.js";
export {
  processNewDrafts,
  getGlobalAdaptationRateLimiter,
  checkPromotedOverrides,
} from "./model-adaptation-pipeline.js";
export type {
  PipelineResult,
  PipelineOptions,
  RollbackCheckResult,
} from "./model-adaptation-pipeline.js";
export {
  generateAdaptationReport,
  serializeAdaptationReport,
  writeAdaptationReport,
} from "./model-adaptation-report.js";

// ─── Dimension Scorer Base ────────────────────────────────────────────────────

export { DimensionScorer } from "./dimension-scorer.js";
export type { DimensionScore, DimensionScorerOptions } from "./dimension-scorer.js";

// ─── Memory Quality ──────────────────────────────────────────────────────────

export { MemoryQualityScorer } from "./memory-quality-scorer.js";
export type { ScoredMemory, QualityScore } from "./memory-quality-scorer.js";

export { MemoryConsolidator } from "./memory-consolidator.js";
export type { MemoryItem, MemoryConsolidatorOptions } from "./memory-consolidator.js";

// ─── Search Quality ─────────────────────────────────────────────────────────

export { SearchQualityScorer } from "./search-quality-scorer.js";
export type { SearchQualityScore, ScoredSearchResult } from "./search-quality-scorer.js";

export { SearchFreshnessTracker } from "./search-freshness-tracker.js";
export type { FreshnessTrackerOptions } from "./search-freshness-tracker.js";
export type { ContentType as SearchContentType } from "./search-freshness-tracker.js";

// ─── Git Conflict Resolution ────────────────────────────────────────────────

export { GitConflictResolver } from "./git-conflict-resolver.js";
export type { ConflictRegion, Resolution, ConflictReport } from "./git-conflict-resolver.js";

// ─── PR Quality ─────────────────────────────────────────────────────────────

export { PRQualityChecker } from "./pr-quality-checker.js";
export type { CheckOptions, PRSizeAnalysis, PRQualityReport } from "./pr-quality-checker.js";

// ─── Update Rollback ────────────────────────────────────────────────────────

export { UpdateRollback } from "./update-rollback.js";
export type {
  UpdateSnapshot,
  UpdateHealthCheckConfig,
  UpdateHealthCheckResult,
  EvidenceRecord,
  UpdateRollbackIO,
} from "./update-rollback.js";

// ─── Migration Validator ────────────────────────────────────────────────────

export { MigrationValidator } from "./migration-validator.js";
export type {
  Migration,
  MigrationContext,
  SchemaDefinition,
  SchemaField,
  SchemaChange,
  SchemaCompatibility,
  DataLossRisk,
  DataLossRiskLevel,
  DryRunResult,
} from "./migration-validator.js";

// ─── Task Complexity Router ─────────────────────────────────────────────────

export { TaskComplexityRouter } from "./task-complexity-router.js";
export type {
  TaskComplexity,
  ComplexitySignals,
  ComplexityDecision,
  ComplexityRouterConfig,
} from "./task-complexity-router.js";

// ─── Council Resilience ─────────────────────────────────────────────────────

export { CouncilResilience } from "./council/index.js";
export type { RedistributionPlan, PartialRecoveryReport } from "./council/index.js";

// ─── Verification Trend Tracker ─────────────────────────────────────────────

export { VerificationTrendTracker } from "./verification-trend-tracker.js";
export type {
  TrendReport as VerificationTrendReport,
  HealthReport as VerificationHealthReport,
  VerificationDataPoint,
  PdseTrendReport,
  VerificationRegression,
} from "./verification-trend-tracker.js";

// ─── Run Intake ────────────────────────────────────────────────────────────

export {
  createRunIntake,
  classifyTask,
  extractScopeFromPrompt,
  TaskClassSchema,
} from "./run-intake.js";
export type { RunIntake, TaskClass, AllowedBoundary } from "./run-intake.js";

// ─── Boundary Tracker ─────────────────────────────────────────────────────

export { checkBoundaryDrift, formatDriftMessage, BoundaryTracker } from "./boundary-tracker.js";
export type { BoundaryState, BoundaryDriftOptions } from "./boundary-tracker.js";

// ─── Durable Execution ──────────────────────────────────────────────────────

export {
  DurableExecutionEngine,
  listCheckpoints,
  clearAllCheckpoints,
} from "./durable-execution.js";
export type { ExecutionCheckpoint, DurableExecutionOptions } from "./durable-execution.js";

// ─── Permission Engine ──────────────────────────────────────────────────────

export {
  PermissionDecisionSchema,
  SpecifierKindSchema,
  parseRule,
  parseRules,
  inferSpecifierKind,
  serializeRule,
  evaluatePermission,
  evaluatePermissionDecision,
  ruleMatches,
  matchGlob,
  globToRegex,
  loadPermissionConfig,
  savePermissionConfig,
  normalizeConfigFile,
  mergePermissionRules,
  DEFAULT_PERMISSION_CONFIG,
} from "./permission-engine/index.js";
export type {
  PermissionDecision,
  SpecifierKind,
  PermissionRule,
  PermissionCheck,
  PermissionConfig,
  PermissionEvaluationResult,
  PermissionConfigFile,
} from "./permission-engine/index.js";

// ─── Readiness Freshness Guard ───────────────────────────────────────────────

export {
  checkReadinessFreshness,
  warnStaleArtifacts,
  enforceFreshnessInCI,
  getCurrentCommit,
  calculateDuration,
} from "./readiness/freshness-guard.js";
export type { ReadinessArtifact, FreshnessCheckResult } from "./readiness/freshness-guard.js";

// ─── Repair Loop ──────────────────────────────────────────────────────────────

export { runLintRepair, formatLintErrors } from "./repair-loop/lint-repair.js";
export type { LintConfig, LintResult, RunLintRepairOptions } from "./repair-loop/lint-repair.js";

export {
  parseESLintOutput,
  parsePrettierOutput,
  parseTSCOutput,
  parseLintOutput,
} from "./repair-loop/lint-parsers.js";
export type { LintError } from "./repair-loop/lint-parsers.js";

export { runTestRepair, formatTestFailures } from "./repair-loop/test-repair.js";
export type { TestConfig, TestResult, RunTestRepairOptions } from "./repair-loop/test-repair.js";

export {
  parseVitestOutput,
  parseJestOutput,
  parsePytestOutput,
  parseGoTestOutput,
  parseTestOutput,
} from "./repair-loop/test-parsers.js";
export type { TestFailure } from "./repair-loop/test-parsers.js";

export { runFinalGate, formatFinalGateResult } from "./repair-loop/final-gate.js";
export type {
  FinalGateConfig,
  FinalGateResult,
  RunFinalGateOptions,
} from "./repair-loop/final-gate.js";

// ─── Doc-Code Drift ───────────────────────────────────────────────────────────

export {
  detectDrift,
  extractDocSignatures,
  extractCodeParameters,
  symbolToCodeSymbol,
  compareSignatures,
} from "./drift/doc-code-drift.js";
export type {
  DriftCheck,
  DocParameter,
  DocSymbol,
  CodeParameter,
  CodeSymbol,
} from "./drift/doc-code-drift.js";

// ─── Custom Modes ─────────────────────────────────────────────────────────────

export {
  checkPathAllowed,
  checkToolAllowed,
  validateModeSlug,
  validateCustomMode,
  getCustomModeToolExclusions,
  formatModeDisplay,
} from "./custom-modes.js";
export type { CustomMode, PathCheckResult, ToolCheckResult } from "./custom-modes.js";

// ─── Async Task Executor ──────────────────────────────────────────────────────

export { AsyncTaskExecutor, createAsyncTaskExecutor, createTask } from "./async-task-executor.js";
export type {
  Task,
  TaskResult,
  TaskHandle,
  TaskStatus,
  TaskStatusSnapshot,
  TaskPriority,
  TaskExecutor,
  AsyncTaskExecutorOptions,
  AsyncTaskExecutorEvents,
} from "./async-task-executor.js";

// ─── Async Queue ──────────────────────────────────────────────────────────────

export { AsyncQueue, work } from "./async-queue.js";

// ─── Retry with Backoff ───────────────────────────────────────────────────────

export { retryWithBackoff, RetryableErrors } from "./retry-with-backoff.js";
export type { RetryOptions } from "./retry-with-backoff.js";

// ─── Observability ────────────────────────────────────────────────────────────

export { MetricCounter, TraceRecorder, HealthSurface } from "@dantecode/observability";
export type {
  Metric,
  MetricValue,
  MetricType,
  Span,
  SpanAttributes,
  SpanStatus,
  TraceRecord,
  HealthStatus,
  HealthCheckResult as ObservabilityHealthCheckResult,
  HealthReport,
  HealthCheckFn,
} from "@dantecode/observability";

// ─── Trace Logger ─────────────────────────────────────────────────────────────

export {
  TraceLogger,
  getGlobalTraceLogger,
  setGlobalTraceLogger,
  hasGlobalTraceLogger,
} from "./trace-logger.js";
export type {
  TraceSpan,
  TraceEvent,
  TraceDecision,
  TraceSummary,
  TraceLevel,
  TraceStatus,
  TraceLoggerOptions,
} from "./trace-logger.js";

// ─── Enterprise Logger ────────────────────────────────────────────────────────

export { EnterpriseLogger, logger } from "./enterprise-logger.js";
export type { LogLevel, LogContext, LogEntry, LoggerConfig } from "./enterprise-logger.js";
