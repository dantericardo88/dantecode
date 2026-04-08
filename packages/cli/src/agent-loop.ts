// ============================================================================
// @dantecode/cli — Agent Interaction Loop
// The core loop that sends user prompts to the model, processes tool calls,
// runs the DanteForge pipeline on generated code, and streams responses.
// ============================================================================

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { MCPMemoryBridge } from "@dantecode/core";
import {
  ModelRouterImpl,
  detectSelfImprovementContext,
  promptRequestsToolExecution,
  parseVerificationErrors,
  formatErrorsForFixPrompt,
  computeErrorSignature,
  runStartupHealthCheck,
  classifyError,
  isRetryable,
  isTerminal,
  getRetryDelayMs,
  DanteErrorType,
  errorHelper,
  getCurrentWave,
  advanceWave,
  globalArtifactStore,
  synthesizeConfidence,
  StreamRecovery,
  MemoryConsolidator,
  checkBudget,
  createContextBudget,
  shouldTruncateToolOutput,
  observeAndAdapt,
  applyOverrides,
  TaskComplexityRouter,
  verifyCompletion,
  deriveWaveExpectations,
  isValidWaveCompletion,
  createRunIntake,
  BoundaryTracker,
  formatDriftMessage,
  calculatePressure,
  condenseContext,
  getGlobalTraceLogger,
  ExecutionPolicyEngine,
  isWorkflowExecutionPrompt,
  responseLooksComplete,
  runPostEditLint,
  buildLintFixPrompt,
  AgentStateMachine,
  createAccumulatedUsage,
  addLanguageModelUsage,
  swallowError,
  runFinalGate,
  runLintRepair,
  runTestRepair,
  LoopDetector,
  RecoveryEngine,
  TaskCircuitBreaker,
  sanitizeUserPrompt,
  completionGate,
  ConvergenceMetrics,
  globalTokenCache,
  AutonomyOrchestrator,
  ConvergenceController,
  runStartupCrashRecovery,
  createSelfHealingLoop,
  HealingAgent,
} from "@dantecode/core";
import type { HealingToolCall, VerificationStage } from "@dantecode/core";
import type { WorkflowExecutionContext, WaveOrchestratorState, RunIntake, AccumulatedUsage, TestFailure } from "@dantecode/core";
import { buildWavePrompt } from "@dantecode/core";
import { recordSuccessPattern } from "@dantecode/danteforge";
// detectAndRecordPatterns is optional — not present in all danteforge binary versions
let detectAndRecordPatterns: ((messages: unknown[], projectRoot: string) => Promise<void>) | undefined;
import("@dantecode/danteforge").then((m) => {
  if (typeof (m as Record<string, unknown>)["detectAndRecordPatterns"] === "function") {
    detectAndRecordPatterns = (m as Record<string, unknown>)["detectAndRecordPatterns"] as typeof detectAndRecordPatterns;
  }
}).catch(() => {});

import { runDanteForge } from "./danteforge-pipeline.js";
import { executeToolBatch } from "./tool-executor.js";
import { DanteGaslightIntegration } from "@dantecode/dante-gaslight";
import { DanteSkillbookIntegration } from "@dantecode/dante-skillbook";
import type {
  ExecutionEvidence,
  Session,
  SessionMessage,
  DanteCodeState,
  SelfImprovementContext,
} from "@dantecode/config-types";
import { executeTool } from "./tools.js";
import { StreamRenderer } from "./stream-renderer.js";
import { getAISDKTools } from "./tool-schemas.js";
import { SandboxBridge } from "./sandbox-bridge.js";
import { confirmDestructive } from "./confirm-flow.js";
import { runGaslightBridge } from "./gaslight-bridge.js";
import { buildPreLoopContext, injectPlanningPhase, injectRoundContext } from "./prompt-builder.js";

// Extracted modules
import {
  CYAN,
  YELLOW,
  GREEN,
  RED,
  DIM,
  BOLD,
  RESET,
  PIVOT_INSTRUCTION,
  DEEP_REFLECTION_INSTRUCTION,
  MAX_PIPELINE_CONTINUATION_NUDGES,
  NUDGE_MIN_REMAINING_BUDGET_PCT,
  MAX_CONSECUTIVE_EMPTY_ROUNDS,
  MAX_CONFABULATION_NUDGES,
  EMPTY_RESPONSE_WARNING,
  displayThinking,
  estimatePromptComplexity,
} from "./agent-loop-constants.js";
import { type ExtractedToolCall, extractToolCalls, extractEditBlocks, applyEditBlock } from "./tool-call-parser.js";
import { autoCommitIfEnabled, runArchitectPhase, getGlobalHookRunner, ContextPruner } from "@dantecode/core";
import { generateRepoMap, formatRepoMapForContext } from "@dantecode/git-engine";
import {
  getVerifyCommands,
  extractClaimedFiles,
  deriveThinkingBudget,
  isTimeoutError,
  buildExecutionEvidence,
} from "./verification-pipeline.js";
import { buildSystemPrompt } from "./context-manager.js";
import {
  _laneCtx,
  backgroundTaskRegistries,
  isExecutionContinuationPrompt,
} from "./background-task-manager.js";
import { resolveSessionResume, persistSessionEnd } from "./session-manager.js";
import {
  createSessionEvidenceTracker,
  type SessionEvidenceTracker,
} from "./evidence-chain-bridge.js";
import { discoverSkills, SkillRegistry } from "@dantecode/skills-registry";
import { MetricCounter, TraceRecorder } from "@dantecode/core";

// Types re-exported from extracted modules are imported above.

// ─── Observability ──────────────────────────────────────────────────────────

/** Module-level metrics collector for agent loop telemetry */
const agentMetrics = new MetricCounter();

/** Module-level trace recorder for distributed tracing */
const agentTracer = new TraceRecorder();

/** Export metrics for CLI commands */
export function getAgentMetrics() {
  return agentMetrics.getMetricsDetailed();
}

/** Export traces for CLI commands */
export function getAgentTraces() {
  return agentTracer.getTraces();
}

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Configuration passed to the agent loop. */
export interface AgentLoopConfig {
  state: DanteCodeState;
  verbose: boolean;
  enableGit: boolean;
  enableSandbox: boolean;
  selfImprovement?: SelfImprovementContext;
  /** Silent mode (Ruflo pattern): suppress per-tool output, show only compact progress. */
  silent?: boolean;
  /** Called for each streaming token chunk, enabling real-time UI updates. */
  onToken?: (token: string) => void;
  /** Signal to abort the current generation (e.g., on Ctrl+C). */
  abortSignal?: AbortSignal;
  /** Sandbox bridge for isolated command execution (when --sandbox is set). */
  sandboxBridge?: SandboxBridge;
  /** MCP tools converted to AI SDK schema (from MCPClientManager). */
  mcpTools?: Record<string, { description: string; parameters: import("zod").ZodTypeAny }>;
  /** MCP client for dispatching tool calls to external MCP servers. */
  mcpClient?: { callToolByName: (name: string, args: Record<string, unknown>) => Promise<string> };
  /**
   * Minimum number of tool rounds required to complete the task.
   * Set by pipeline orchestrators (e.g., /magic, /autoforge) to override the
   * default maxToolRounds=15 when more rounds are needed.
   */
  requiredRounds?: number;
  /**
   * Whether a skill is currently active. When true, pipeline continuation
   * protections (nudge, elevated round budget) activate regardless of the
   * prompt text — ensuring ALL skills run to completion.
   */
  skillActive?: boolean;
  /**
   * Wave orchestrator state for step-by-step skill execution.
   * When present, the agent loop feeds one wave at a time and enforces
   * verification gates between waves (Claude Workflow Mode).
   */
  waveState?: WaveOrchestratorState;
  /** Durable run identifier for this execution. */
  runId?: string;
  /** Explicit durable run ID to resume from. */
  resumeFrom?: string;
  /** Checkpoint behavior overrides for durable runs. */
  checkpointPolicy?: {
    afterToolBatch?: boolean;
    afterVerification?: boolean;
  };
  /** Timeout retry policy for durable runs. */
  timeoutPolicy?: {
    transientRetries?: number;
  };
  /** Expected workflow name queued by the slash command router. */
  expectedWorkflow?: string;
  /**
   * Full workflow execution context from workflow-runtime.ts.
   * When present, the system prompt is augmented with the contract preamble
   * (stages, failure policy, rollback policy) from the loaded WorkflowCommand.
   * This gives non-Claude models structured guidance instead of raw markdown text.
   */
  workflowContext?: WorkflowExecutionContext;
  /**
   * DanteGaslight integration for the Gaslight→Skillbook closed loop.
   * When provided, each agent turn is checked for gaslight triggers. Sessions
   * are persisted to disk and can be distilled into the Skillbook via
   * `dantecode gaslight bridge`.
   */
  gaslight?: DanteGaslightIntegration;
  /**
   * When true, prompt the user for explicit confirmation before proceeding
   * if FearSet analysis returns a no-go decision.
   * Default false — non-blocking/advisory mode for all existing callers.
   * Non-TTY environments (CI/CD) are always non-blocking regardless of this flag.
   */
  fearSetBlockOnNoGo?: boolean;
  /**
   * Confidence-gated escalation: when enabled (mode: "on-request"), the agent
   * loop scans each model response for a structured low-confidence signal.
   * If detected (confidence < threshold, default 0.5), execution pauses and the
   * user is prompted before continuing. Non-TTY environments always skip the gate.
   *
   * Signal format recognized in model output:
   *   <!-- DANTE_CONFIDENCE: 0.3 reason="..." -->
   *   or: [CONFIDENCE:0.3 reason="..."]
   *
   * Default: disabled.
   */
  confidenceGating?: {
    /** "on-request" = pause and ask user when confidence is low; "log-only" = emit warning only */
    mode: "on-request" | "log-only";
    /** Confidence threshold below which escalation fires. Default: 0.5 */
    threshold?: number;
  };
  /**
   * Reference to the REPL state for /think override and feedback loop wiring.
   * When provided, per-round tier selection respects the reasoningOverride field,
   * and tier outcomes are recorded back via recordTierOutcome.
   */
  replState?: import("./slash-commands.js").ReplState;
  eventEmitter?: import("./serve/session-emitter.js").SessionEventEmitter;
  eventSessionId?: string;
  planModeActive?: boolean;
  taskMode?: string;
  /** Explicit runtime profile for deterministic automation and benchmark runs. */
  executionProfile?: "default" | "benchmark";
  /**
   * When true, enables Aider-style two-stage architect/editor execution for
   * complex tasks. The architect phase produces guidance; the editor phase
   * applies targeted SEARCH/REPLACE edits.
   * Default: false.
   */
  architectEditorMode?: boolean;
  /**
   * When true, auto-commits modified files after each write batch using an
   * LLM-generated conventional commit message (Aider pattern).
   * Default: false (opt-in). Requires git.autoCommit in project state.
   */
  autoCommit?: boolean;
  /**
   * When false, disables the automatic post-edit lint loop.
   * When true (default), the agent loop runs lint after each write batch and
   * injects a targeted fix prompt if errors are found (up to 3 retries).
   * Default: true.
   */
  postEditLint?: boolean;
  /**
   * Inference-time scaling: run N variants of the prompt in parallel isolated
   * worktrees and auto-select the best result by PDSE score.
   * Based on OpenHands' multi-attempt scaling pattern.
   * Default: disabled.
   */
  inferenceScaling?: {
    /** Whether inference-time scaling is active. */
    enabled: boolean;
    /** Number of parallel variants to run (default 3, clamped 2-8). */
    n: number;
  };
}

/** Entry in the approach memory log, tracking tried strategies and outcomes. */
export interface ApproachLogEntry {
  description: string;
  outcome: "success" | "failed" | "partial";
  toolCalls: number;
}

// Constants, tool call parser, verification pipeline, context manager, and
// background task manager are now imported from extracted modules above.

// buildSystemPrompt is now imported from context-manager.ts

// Tool call extraction is now imported from tool-call-parser.ts

// Reflection loop helpers, context compaction, background task management, and
// sub-agent executor are now imported from extracted modules above.

// ----------------------------------------------------------------------------
// Main Agent Loop
// ----------------------------------------------------------------------------

// Module-level flag: run startup health check only once per process.
let _healthCheckCompleted = false;

/**
 * Public wrapper — creates an isolated AsyncLocalStorage context via `run()` (not
 * `enterWith()`). Using `run()` ensures recursive invocations from
 * maybeAutoResumeDurableRunAfterBackgroundTask receive their own nested context and
 * cannot corrupt the parent lane's backgroundTaskRegistries key. The try/finally covers
 * ALL exit paths of `_runAgentLoopCore` (including early returns) with a single cleanup.
 */
export async function runAgentLoop(
  prompt: string,
  session: Session,
  config: AgentLoopConfig,
): Promise<Session> {
  return _laneCtx.run({ sessionId: session.id }, async () => {
    try {
      return await _runAgentLoopCore(prompt, session, config);
    } finally {
      // Fires on every exit path — normal completion and all early returns.
      const _exitCtx = _laneCtx.getStore();
      backgroundTaskRegistries.delete(
        _exitCtx ? `${_exitCtx.sessionId}:${session.projectRoot}` : session.projectRoot,
      );
    }
  });
}

async function _runAgentLoopCore(
  prompt: string,
  session: Session,
  config: AgentLoopConfig,
): Promise<Session> {
  const benchmarkProfileActive = config.executionProfile === "benchmark";

  // Run startup health check on first invocation only
  if (!_healthCheckCompleted) {
    _healthCheckCompleted = true;
    try {
      const healthResult = await runStartupHealthCheck({ projectRoot: session.projectRoot });
      if (!healthResult.healthy) {
        process.stdout.write(
          `${YELLOW}[health] Some checks failed — see warnings above. Proceeding anyway.${RESET}\n`,
        );
      }
    } catch (err: unknown) {
      swallowError(err, "health-check");
    }

    // Crash recovery: scan for interrupted sessions and surface them to the user.
    // Uses policy="none" so we surface but never auto-resume mid-conversation.
    try {
      const recoveryState = await runStartupCrashRecovery(session.projectRoot, {
        autoResumePolicy: "none",
      });
      for (const line of recoveryState.bannerLines) {
        process.stdout.write(`${YELLOW}${line}${RESET}\n`);
      }
    } catch (_recErr) {
      // Best-effort: never block startup for recovery scan failures
    }
  }

  /**
   * Output adapter for serve mode. In REPL mode (default), writes to stdout.
   * In serve mode (eventEmitter set), routes output to SSE clients instead.
   */
  function emitOrWrite(
    output: string,
    type: import("./serve/session-emitter.js").SSEEventType = "status",
  ): void {
    if (config.eventEmitter && config.eventSessionId) {
      config.eventEmitter.emitEvent(config.eventSessionId, {
        type,
        data: { content: output },
        timestamp: new Date().toISOString(),
      });
    } else {
      process.stdout.write(output);
    }
  }

  const loopStartTime = Date.now();

  // ---- Trace Logger: observable execution traces for explainability ----
  const traceLogger = getGlobalTraceLogger({
    projectRoot: session.projectRoot,
    enabled: true,
    logToFile: true,
    logToConsole: false,
  });
  const rootSpan = traceLogger.startSpan("agent-loop", "agent", {
    input: { prompt, sessionId: session.id },
    metadata: {
      model: config.state.model.default,
      projectRoot: session.projectRoot,
    },
  });

  try {
    // ---- Session resume / continuation (extracted to session-manager.ts) ----
    const resumeResult = await resolveSessionResume(prompt, session, config);
    if (resumeResult.earlyReturn) {
      return resumeResult.session;
    }
    const { durableRunStore } = resumeResult;
    const workflowName = resumeResult.workflowName ?? "agent-loop";
    const durablePrompt = resumeResult.durablePrompt;
    let { replayToolCalls } = resumeResult;
    session = resumeResult.session;

    let durableRun = resumeResult.durableRunId
      ? await durableRunStore.loadRun(resumeResult.durableRunId)
      : null;
    if (!durableRun) {
      durableRun = await durableRunStore.initializeRun({
        runId: resumeResult.durableRunId,
        session,
        prompt: durablePrompt,
        workflow: workflowName,
      });
    }

    const executionPolicy = new ExecutionPolicyEngine({
      projectRoot: session.projectRoot,
      failClosedWorkflows: true,
    });
    const persistedExecutionPolicyState = (
      durableRun as typeof durableRun & {
        executionPolicyState?: Parameters<ExecutionPolicyEngine["hydrate"]>[0];
      }
    ).executionPolicyState;
    if (persistedExecutionPolicyState) {
      executionPolicy.hydrate(persistedExecutionPolicyState);
    }

    // ---- Evidence Chain: session-scoped cryptographic audit trail ----
    const evidenceTracker: SessionEvidenceTracker = createSessionEvidenceTracker(session.id);

    // ---- Agent State Machine: lifecycle tracking (OpenHands agent_controller pattern) ----
    const agentStateMachine = new AgentStateMachine({
      onStateChange: config.verbose
        ? (from, to, trigger) => {
            process.stdout.write(
              `${DIM}[state-machine] ${from} → ${to} (${trigger})${RESET}\n`,
            );
          }
        : undefined,
    });
    agentStateMachine.transition("loading", "session_start");

    // Audit user message for suspicious patterns (detection-only, no modification)
    const sanitizeAudit = sanitizeUserPrompt(durablePrompt);
    if (sanitizeAudit.warnings.length > 0) {
      process.stderr.write(`[PromptSanitizer] ${sanitizeAudit.warnings.join("; ")}\n`);
    }

    // Append user message
    const userMessage: SessionMessage = {
      id: randomUUID(),
      role: "user",
      content: durablePrompt,
      timestamp: new Date().toISOString(),
    };
    session.messages.push(userMessage);

    // Build the model router
    const routerConfig = {
      default: config.state.model.default,
      fallback: config.state.model.fallback,
      overrides: config.state.model.taskOverrides,
    };
    const router = new ModelRouterImpl(routerConfig, session.projectRoot, session.id);
    const lexicalComplexity = router.analyzeComplexity(durablePrompt);
    let thinkingBudget = deriveThinkingBudget(config.state.model.default, lexicalComplexity);
    if (config.replState && thinkingBudget !== undefined) {
      config.replState.lastThinkingBudget = thinkingBudget;
    }
    let localSandboxBridge: SandboxBridge | null = null;

    // Build system prompt
    let systemPrompt = await buildSystemPrompt(session, config);

    // D-12A: Apply model adaptation overrides (only in "active" mode)
    let adaptationMode = process.env.DANTE_MODEL_ADAPTATION_MODE ?? "observe-only";
    const adaptationDisabled = process.env.DANTE_DISABLE_MODEL_ADAPTATION === "1";
    // Validate mode — fall back to observe-only on invalid value
    if (!adaptationDisabled && !["observe-only", "staged", "active"].includes(adaptationMode)) {
      process.stderr.write(
        `[D-12A] WARNING: Invalid DANTE_MODEL_ADAPTATION_MODE="${adaptationMode}". ` +
          `Valid values: observe-only, staged, active. Defaulting to observe-only.\n`,
      );
      adaptationMode = "observe-only";
    }
    if (
      !adaptationDisabled &&
      adaptationMode === "active" &&
      config.replState?.modelAdaptationStore
    ) {
      // Reload to pick up CLI approve/reject changes between rounds
      await config.replState.modelAdaptationStore.reload();
      const modelKey = {
        provider: config.state.model.default.provider,
        modelId: config.state.model.default.modelId,
      };
      const activeOverrides = config.replState.modelAdaptationStore.getActiveOverrides(modelKey);
      if (activeOverrides.length > 0) {
        systemPrompt = applyOverrides(systemPrompt, activeOverrides);
      }
    }

    // Convert session messages to the format expected by the AI SDK
    let messages = session.messages.map((msg) => ({
      role: msg.role as "user" | "assistant" | "system",
      content:
        typeof msg.content === "string"
          ? msg.content
          : msg.content.map((b) => b.text || "").join("\n"),
    }));

    // Tool call loop: keep sending to the model until no more tool calls
    // Dynamic round budget: pipeline orchestrators can request more rounds via requiredRounds.
    // When a skill is active (skillActive), default to 50 rounds to ensure completion.
    // Workflow commands (/inferno, /blaze, /forge, etc.) get 75 rounds to prevent premature exit.
    // Otherwise, estimate complexity from prompt characteristics (5/10/20 rounds).
    const isWorkflowPrompt = isWorkflowExecutionPrompt(durablePrompt, config.skillActive);
    let maxToolRounds = config.requiredRounds
      ? Math.max(config.requiredRounds, 15)
      : config.skillActive
        ? 50
        : isWorkflowPrompt
          ? 75
          : estimatePromptComplexity(durablePrompt);
    let totalTokensUsed = 0;
    // Vercel AI SDK LanguageModelUsage shape — tracks cache-read/reasoning tokens separately
    let accumulatedUsage: AccumulatedUsage = createAccumulatedUsage();
    const touchedFiles: string[] = [];
    // Stuck loop detection (from opencode/OpenHands): track recent tool call signatures
    const recentToolSignatures: string[] = [];
    const MAX_FALLBACK_PIPELINE_ROUNDS = 2;
    // Reflection loop (aider/Cursor pattern): auto-retry verification after code edits
    const MAX_VERIFY_RETRIES = 3;
    let verifyRetries = 0;
    // Self-healing loop: track error signatures to detect repeated identical failures
    let lastErrorSignature = "";
    let sameErrorCount = 0;
    // sessionFailureCount: monotonically increasing failure counter — never resets.
    // Unlike sameErrorCount (which resets on signature change), this accumulates ALL
    // verification failures regardless of whether the error signature changes.
    // Feeds the FearSet repeated-failure channel which needs total failure count.
    let sessionFailureCount = 0;
    let executionNudges = 0;
    const MAX_EXECUTION_NUDGES = 2;
    // Test-repair loop: tracks how many times we've injected failing test messages.
    // Capped at MAX_TEST_REPAIR_RETRIES to avoid runaway loops on unfixable failures.
    let testRetries = 0;
    const MAX_TEST_REPAIR_RETRIES = 3;
    let executedToolsThisTurn = 0;
    // ExecutionPolicy (DTR Phase 6): track completed tool names for dependency gating
    const completedToolsThisTurn = new Set<string>();
    // Pipeline continuation: prevent premature wrap-up during multi-step pipelines
    let pipelineContinuationNudges = 0;
    // CLI auto-continuation: refill round budget when exhausted mid-pipeline
    let autoContinuations = 0;
    const MAX_AUTO_CONTINUATIONS = isWorkflowPrompt ? 5 : 3;
    // Effective self-improvement policy: may be restricted when on a fallback model
    let effectiveSelfImprovement: SelfImprovementContext | null | undefined =
      config.selfImprovement;
    // Fallback pipeline guard: tracks consecutive rounds spent on a fallback model
    let fallbackPipelineRounds = 0;
    // Anti-confabulation guards
    let consecutiveEmptyRounds = 0;
    let confabulationNudges = 0;
    // FIXED: Track rounds without writes for false positive prevention
    let roundsWithoutWrites = 0;
    let consecutiveReadOnlyRounds = 0;
    // Wave deliverables verification: max retries per wave before force-advancing
    const MAX_WAVE_VERIFY_RETRIES = 2;
    let waveVerifyRetries = 0;
      const isPipelineWorkflow =
        config.executionProfile === "benchmark" ||
        config.requiredRounds !== undefined ||
        isWorkflowPrompt ||
        isExecutionContinuationPrompt(durablePrompt, session);

    // ---- Feature: Planning phase (for complex tasks) ----
    // Inject planning instruction before first model call when complexity >= 0.7
    const planningEnabled = lexicalComplexity >= 0.7;
    let planGenerated = false;

    // ---- Feature: Approach memory ----
    // Track what approaches were tried and their outcomes within this session
    const approachLog: ApproachLogEntry[] = [];
    let currentApproachDescription = "";
    let currentApproachToolCalls = 0;

    // ---- Pre-loop context assembly (extracted to prompt-builder.ts) ----
    const {
      historicalFailures,
      reasoningChain,
      autonomyEngine,
      sessionPersistentMemory,
      persistentApproachMemory: persistentMemory,
      securityEngine,
      secretsScanner,
      memoryOrchestrator,
      memoryInitialized,
      auditLogger,
      metricsCollector,
    } = await buildPreLoopContext(durablePrompt, session, config, messages);
    let currentRoundTier: import("@dantecode/core").ReasoningTier = "quick";
    // Tracks whether the early-checkpoint project-scope memory write has fired this session.
    // Set to true after the first file modification so we only fire it once.
    let memoryEarlyCheckpointFired = false;

    // ---- Autonomy: capture baseline test failures before any mutations ----
    // runTestRepair can distinguish OLD failures from NEW ones introduced by the agent,
    // but only if baselineFailures is provided. Without this snapshot, every pre-existing
    // failure would look like a regression the agent caused.
    let baselineTestFailures: TestFailure[] = [];
    let testCommandAvailable = false;
    try {
      const baselineResult = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: session.projectRoot,
        baselineFailures: [],
      });
      baselineTestFailures = baselineResult.failures;
      testCommandAvailable = true;
      if (config.verbose && !config.silent && baselineTestFailures.length > 0) {
        emitOrWrite(
          `${DIM}[autonomy] baseline: ${baselineTestFailures.length} pre-existing test failure(s) noted (will be excluded from repair loop)${RESET}\n`,
        );
      }
    } catch (err: unknown) {
      swallowError(err, "baseline-test-detection");
      // No test infrastructure in this project — test-repair will be skipped entirely.
      testCommandAvailable = false;
    }

    // ---- Feature: Task complexity classification (informational) ----
    const taskComplexityRouter = new TaskComplexityRouter();
    const taskSignals = {
      promptTokens: Math.ceil(durablePrompt.length / 4),
      fileCount: session.activeFiles?.length ?? 0,
      hasReasoning: (reasoningChain?.getStepCount() ?? 0) > 0,
      hasSecurity: false,
      hasMultiFile: (session.activeFiles?.length ?? 0) > 1,
      estimatedOutputTokens: Math.ceil(durablePrompt.length / 8),
    };
    const complexityDecision = taskComplexityRouter.classify(taskSignals);
    const complexityTier = complexityDecision.complexity;
    if (config.verbose) {
      emitOrWrite(
        `${DIM}[complexity] tier=${complexityTier} confidence=${complexityDecision.confidence.toFixed(2)}${RESET}\n`,
      );
    }

    // ---- Wave 1a: Wire TaskComplexityRouter to actual model selection ----
    // Only downgrade to haiku for simple tasks — never upgrade to opus (cost-safety).
    // We inject a haiku override into routerConfig.overrides under key "haiku-simple"
    // and pass that taskType to the generation calls when complexity === "simple".
    const HAIKU_MODEL_ID = "claude-haiku-4-5-20251001";
    let effectiveTaskType: string | undefined;
    if (
      complexityDecision.complexity === "simple" &&
      complexityDecision.recommendedModel === HAIKU_MODEL_ID &&
      config.state.model.default.modelId !== HAIKU_MODEL_ID
    ) {
      routerConfig.overrides["haiku-simple"] = {
        ...config.state.model.default,
        modelId: HAIKU_MODEL_ID,
        // Haiku does not support extended thinking — disable to avoid provider errors
        supportsExtendedThinking: false,
        reasoningEffort: undefined,
      };
      effectiveTaskType = "haiku-simple";
      emitOrWrite(`${DIM}[routing: haiku (simple task)]${RESET}\n`);
    }

    // ---- Wave 5a: Prior Lessons injection from Skillbook ----
    // Hoist ref + injected IDs so recordSessionOutcome can be called at session end.
    let _skillbookRef: DanteSkillbookIntegration | null = null;
    const _injectedSkillIds: string[] = [];
    try {
      const skillbookIntegration = new DanteSkillbookIntegration({ cwd: session.projectRoot });
      _skillbookRef = skillbookIntegration;
      const taskKeywords = durablePrompt.toLowerCase().split(/\W+/).filter((t) => t.length >= 3).slice(0, 20);
      const candidateLessons = skillbookIntegration.getRelevantSkills(
        { keywords: taskKeywords, taskType: "general" },
        5,
      );
      // Wave 4b: Filter to skills with >=50% effectiveness and cap at ~300 tokens (~1200 chars)
      const priorLessons = candidateLessons.filter((s) => (s.winRate ?? 0) >= 0.5);
      if (priorLessons.length > 0) {
        const lessonLines = priorLessons.map((s, i) => `${i + 1}. **${s.title}** (${s.section})\n   ${s.content.slice(0, 200)}`);
        const lessonBlock = lessonLines.join("\n\n").slice(0, 1200);
        messages.push({
          role: "system" as const,
          content: `## Prior Lessons (from Skillbook)\n\nThe following lessons from past sessions are relevant to this task:\n\n${lessonBlock}`,
        });
        // Track IDs for effectiveness reporting at session end
        for (const s of priorLessons) {
          if (s.id) _injectedSkillIds.push(s.id as string);
        }
        if (config.verbose) {
          emitOrWrite(`${DIM}[Skillbook] Injecting ${priorLessons.length} lessons (effectiveness threshold: 50%)${RESET}\n`);
        }
      }
    } catch (err) {
      swallowError(err, "skillbook-prior-lessons");
    }

    // ---- Feature: Skill Discovery ----
    try {
      const discoveredEntries = await discoverSkills({ projectRoot: session.projectRoot });
      if (discoveredEntries.length > 0) {
        const reg = new SkillRegistry();
        reg.register(discoveredEntries);
        for (const col of reg.getCollisions()) {
          const scopes = col.entries.map((e) => e.scope).join(", ");
          process.stderr.write(
            `[SKILL-WARN] Skill collision: "${col.name}" in scopes: ${scopes}\n`,
          );
        }
        if (config.verbose) {
          process.stdout.write(
            `${DIM}[skills] Discovered ${discoveredEntries.length} skill(s), ${reg.list().length} active${RESET}\n`,
          );
        }
        const activeSkills = reg.list();
        if (activeSkills.length > 0) {
          const skillLines = activeSkills.map((s) => {
            const tag = s.scope === "project" ? "[PRJ]" : s.scope === "user" ? "[USR]" : "[LIB]";
            return `- ${tag} **${s.name}** (${s.slug})`;
          });
          messages.push({
            role: "system" as const,
            content: [
              "## Available Skills",
              "",
              "The following skills are installed and active in this project:",
              ...skillLines,
              "",
              "To execute a skill, reference it by name or use `/skills run <name>`.",
            ].join("\n"),
          });
        }
      }
    } catch (err: unknown) {
      swallowError(err, "skill-discovery");
    }

    // ---- Wave 2b: LoopDetector — stuck-loop detection ----
    const loopDetector = new LoopDetector({ maxIterations: 25, identicalThreshold: 3 });
    let stuckRoundCount = 0;

    // ---- Wave 2 (new): ConvergenceMetrics — session-level convergence telemetry ----
    const convergenceMetrics = new ConvergenceMetrics();

    // ---- Wave 2c: RecoveryEngine + TaskCircuitBreaker ----
    const recoveryEngine = new RecoveryEngine();
    const taskCircuitBreaker = new TaskCircuitBreaker({ identicalFailureThreshold: 5, maxRecoveryAttempts: 2 });

    // ---- Autonomy Sprint: AutonomyOrchestrator + ConvergenceController ----
    // AutonomyOrchestrator: wires circuit-breaker → RecoveryEngine → context injection
    // ConvergenceController: tracks PDSE score trend → decides continue/scope-reduce/escalate
    const autonomyOrchestrator = new AutonomyOrchestrator({ recoveryEngine, maxRecoveryAttempts: 4, maxScopeReductions: 2 });
    const convergenceController = new ConvergenceController({ windowSize: 5, flatRoundsBeforeScopeReduce: 3, decliningRoundsBeforeEscalate: 2 });

    // ---- Feature: Pivot logic ----
    // Track consecutive failures with similar error signatures for strategy change.
    // This is different from the existing tier escalation — it's about changing
    // strategy, not just using a better model.
    let consecutiveSameSignatureFailures = 0;
    let lastPivotErrorSignature = "";

    // Per-tool error tracking: prevents infinite retries of failing tools
    const toolErrorCounts = new Map<string, number>();

    // ---- Feature: Progress tracking ----
    // Simple counters emitted to the session periodically
    let toolCallsThisTurn = 0;
    let filesModified = 0;
    let testsRun = 0;
    let bashSucceeded = 0;
    let roundCounter = 0;
    // Post-edit lint retries counter (max 3 per session)
    let lintRetries = 0;
    let lastMajorEditGatePassed = true;
    const readTracker = new Map<string, string>();
    const editAttempts = new Map<string, number>();

    const evidenceLedger: ExecutionEvidence[] = [];
    let lastConfirmedStep = "Started execution.";
    let lastSuccessfulTool: string | undefined;
    let lastSuccessfulToolResult: string | undefined;
    let transientTimeoutRetries = 0;
    const maxTransientRetries = config.timeoutPolicy?.transientRetries ?? 1;

    if (config.verbose && thinkingBudget) {
      process.stdout.write(
        `${DIM}[thinking: ${config.state.model.default.provider}/${config.state.model.default.modelId}, budget=${thinkingBudget}]${RESET}\n`,
      );
    }

    // Planning phase (extracted to prompt-builder.ts)
    injectPlanningPhase(
      messages,
      planningEnabled,
      lexicalComplexity,
      historicalFailures,
      !!config.silent,
    );

    // ---- RunIntake: capture intent boundary before any model call ----
    const runIntake: RunIntake = createRunIntake(durablePrompt, session.id, config.runId);
    if (config.verbose) {
      emitOrWrite(
        `${DIM}[run-intake] id=${runIntake.runId} class=${runIntake.classification} scope=${runIntake.requestedScope.length} paths${RESET}\n`,
      );
    }

    // ---- Boundary Tracker: detect scope drift across tool rounds ----
    const boundaryTracker = new BoundaryTracker(runIntake);

    // Hook: SessionStart
    void getGlobalHookRunner().run("SessionStart", { eventType: "SessionStart", metadata: { sessionId: session.id, projectRoot: session.projectRoot } });

    // Pieces MCP: inject cross-tool memories if configured
    const piecesMemory = MCPMemoryBridge.fromEnv();
    if (piecesMemory && await piecesMemory.isAvailable().catch(() => false)) {
      const memories = await piecesMemory.recallContext(durablePrompt.slice(0, 200)).catch(() => []);
      if (memories.length > 0 && !config.silent) {
        emitOrWrite(`${DIM}[pieces-memory] ${memories.length} relevant memories injected${RESET}\n`);
        // Prepend to messages
        messages.unshift({
          role: "user" as const,
          content: `## Long-term memory (from Pieces):\n${memories.map((m: string) => `• ${m}`).join("\n")}`,
        });
      }
    }

    // Architect phase (Aider pattern): if enabled, run a planning phase FIRST
    // then let the editor phase handle targeted SEARCH/REPLACE edits
    let architectGuidance = "";
    if (config.architectEditorMode && roundCounter === 0) {
      try {
        if (!config.silent) {
          emitOrWrite(`${DIM}[architect] running planning phase...${RESET}\n`);
        }
        // Collect repo map as code context for architect phase (was empty string before)
        let architectCodeContext = "";
        try {
          const repoEntries = generateRepoMap(session.projectRoot, { maxFiles: 30 });
          architectCodeContext = formatRepoMapForContext(repoEntries).slice(0, 8000);
        } catch (err: unknown) {
          swallowError(err, "repo-map");
        }
        architectGuidance = await runArchitectPhase(durablePrompt, architectCodeContext, router, messages);
        if (architectGuidance) {
          messages.push({ role: "user" as const, content: `Architectural guidance:\n${architectGuidance}\n\nNow implement using SEARCH/REPLACE blocks only.` });
        }
      } catch (err: unknown) {
        swallowError(err, "architect-guidance");
      }
    }

    agentStateMachine.transition("running", "loop_start");

    // Inference-time scaling (OpenHands pattern): run N variants in parallel, pick best PDSE
    // Only runs on first prompt, opt-in via config.inferenceScaling.enabled
    let inferenceScalingDone = false;
    if (config.inferenceScaling?.enabled) {
      try {
        const { runInferenceScaling } = await import("@dantecode/core");
        if (!config.silent) {
          emitOrWrite(`${DIM}[inference-scaling] running ${config.inferenceScaling.n ?? 3} variants...${RESET}\n`);
        }
        const scalingResult = await runInferenceScaling(
          {
            n: config.inferenceScaling.n ?? 3,
            prompt: durablePrompt,
            projectRoot: session.projectRoot,
            sessionId: session.id,
          },
          router,
        );
        if (scalingResult.appliedToMain) {
          if (!config.silent) {
            emitOrWrite(
              `${GREEN}[inference-scaling] best variant applied (PDSE: ${scalingResult.bestVariant.pdseScore?.toFixed(1) ?? "N/A"})${RESET}\n`,
            );
          }
          filesModified = scalingResult.bestVariant.modifiedFiles.length;
          touchedFiles.push(...scalingResult.bestVariant.modifiedFiles);
          inferenceScalingDone = true;
        }
      } catch (err) {
        if (!config.silent) {
          emitOrWrite(`${YELLOW}[inference-scaling] failed, continuing normally: ${String(err)}${RESET}\n`);
        }
      }
    }

    while (maxToolRounds > 0) {
      if (inferenceScalingDone) break;
      // CLI auto-continuation: when rounds just hit 0 mid-pipeline, refill budget
      if (
        maxToolRounds <= 1 &&
        isPipelineWorkflow &&
        autoContinuations < MAX_AUTO_CONTINUATIONS &&
        filesModified > 0
      ) {
        autoContinuations++;
        maxToolRounds += config.skillActive ? 50 : 15;
        messages.push({
          role: "user" as const,
          content: "Continue executing remaining steps. Do not summarize — keep working.",
        });
        if (!config.silent) {
          emitOrWrite(
            `\n${YELLOW}[auto-continue ${autoContinuations}/${MAX_AUTO_CONTINUATIONS}]${RESET} ${DIM}(rounds low mid-pipeline — refilling budget)${RESET}\n`,
          );
        }
      }

      // Autonomy Wave 4: extend rounds when test-repair is actively cycling.
      // The agent may need more rounds than estimated to fix test failures it introduced.
      // Cap at 2 extensions (20 extra rounds) to prevent infinite loops on unfixable failures.
      if (
        maxToolRounds <= 3 &&
        testCommandAvailable &&
        testRetries > 0 &&
        testRetries < MAX_TEST_REPAIR_RETRIES &&
        autoContinuations < MAX_AUTO_CONTINUATIONS
      ) {
        autoContinuations++;
        maxToolRounds += 10;
        if (!config.silent) {
          emitOrWrite(
            `${CYAN}[adaptive] +10 rounds: test-repair in progress (${testRetries}/${MAX_TEST_REPAIR_RETRIES} iterations)${RESET}\n`,
          );
        }
      }

      maxToolRounds--;
      roundCounter++;
      convergenceMetrics.increment("iterations");
      const _roundStartMs = Date.now();

      // ─── Observability: Start round span ───
      const roundSpan = agentTracer.startSpan("agent.round", {
        roundNumber: roundCounter,
        sessionId: session.id,
        model: config.state.model.default.modelId,
        provider: config.state.model.default.provider,
      });
      agentMetrics.increment("agent.rounds.total");
      // Record previous round's outcome (skip round 1: tier not yet decided on first pass)
      if (roundCounter > 1) {
        reasoningChain.recordTierOutcome(
          currentRoundTier,
          sameErrorCount === 0 ? 0.9 : sameErrorCount <= 2 ? 0.75 : 0.6,
        );
      }

      // Per-round context injection (extracted to prompt-builder.ts)
      const roundCtx = await injectRoundContext(
        messages,
        {
          roundCounter,
          sameErrorCount,
          toolCallsThisTurn,
          filesModified,
          lastSuccessfulTool,
          lastConfirmedStep,
          durablePrompt,
          config,
          reasoningChain,
          autonomyEngine,
          memoryOrchestrator,
          memoryInitialized,
          secretsScanner,
          session,
          thinkingBudget,
          lexicalComplexity,
        },
        emitOrWrite,
      );
      currentRoundTier = roundCtx.currentRoundTier;
      thinkingBudget = roundCtx.thinkingBudget;

      // Context condensing: check pressure and condense if needed
      const contextWindow = config.state.model.default.contextWindow ?? 200000;
      const pressure = calculatePressure(messages, contextWindow);

      if (pressure.status === "red" && messages.length > 10) {
        if (!config.silent) {
          emitOrWrite(
            `\n${YELLOW}[context-pressure: ${pressure.percent}%]${RESET} ${DIM}Condensing context to reduce token usage...${RESET}\n`,
          );
        }

        const condensed = await condenseContext(messages, contextWindow, {
          preserveRecentRounds: 3,
          targetPercent: 50,
        });

        messages = condensed.messages as {
          role: "user" | "assistant" | "system";
          content: string;
        }[];

        if (!config.silent) {
          const reduction = Math.round(
            ((condensed.beforeTokens - condensed.afterTokens) / condensed.beforeTokens) * 100,
          );
          emitOrWrite(
            `${GREEN}[condensed]${RESET} ${DIM}${condensed.roundsCondensed} rounds → reduced ${reduction}% (${condensed.beforeTokens} → ${condensed.afterTokens} tokens)${RESET}\n`,
          );
        }
      }

      // Context pruning (OpenCode DCP pattern) — prune messages when context grows large
      if (messages.length > 20) {
        const pruner = new ContextPruner();
        if (pruner.shouldPrune(messages, config.state.model.default.contextWindow)) {
          const pruned = pruner.prune(messages, []);
          if (pruned.droppedCount > 0) {
            messages = pruned.pruned as typeof messages;
            if (!config.silent) {
              emitOrWrite(`${DIM}[context-prune] dropped ${pruned.droppedCount} messages, kept last ${messages.length - 2}${RESET}\n`);
            }
          }
        }
      }

      // AI-driven context selection (Bolt.DIY pattern) — round 1 only, reduces irrelevant context
      if (roundCounter === 1 && session.projectRoot) {
        try {
          const { selectContextFiles } = await import("@dantecode/core");
          // Only run if we have enough context to be worth selecting from
          if (messages.length >= 3) {
            const recentContent = messages.slice(-3).map(m => m.content).join(" ").slice(0, 500);
            const request = {
              availableFiles: (() => {
                try {
                  const repoMap = generateRepoMap(session.projectRoot, { maxFiles: 100 });
                  return repoMap.map((e) => e.path).slice(0, 80);
                } catch (_err: unknown) {
                  return touchedFiles.slice(0, 50);
                }
              })(),
              currentContext: touchedFiles.slice(0, 10),
              conversationSummary: recentContent,
              userQuery: durablePrompt.slice(0, 300),
              maxContextFiles: 8,
              projectRoot: session.projectRoot,
            };
            if (request.availableFiles.length > 0) {
              const candidates = request.availableFiles.map((p) => ({
                path: p,
                relevanceScore: 0.5,
                reason: "candidate",
              }));
              const selected = selectContextFiles(candidates, request.projectRoot, {
                maxFiles: request.maxContextFiles,
              });
              if (selected.length > 0 && !config.silent) {
                emitOrWrite(`${DIM}[context-select] narrowed to ${selected.length} files${RESET}\n`);
              }
            }
          }
        } catch (err: unknown) {
          swallowError(err, "ai-context-selection");
        }
      }

      // Generate response from model (streaming with tool calling support)
      let responseText = "";
      let toolCalls: ExtractedToolCall[] = [];
      let toolCallParseErrors: string[] = []; // malformed <tool_use> blocks from this round
      let cleanText = "";
      // Cline pattern: track whether the first streaming chunk has been received.
      // If an error occurs AFTER the first chunk, retrying is unsafe — partial tool
      // executions may have already happened and a retry would duplicate them.
      let streamingStarted = false;
      try {
        if (replayToolCalls.length > 0) {
          responseText = "Replaying pending durable tool calls after background task completion.";
          cleanText = responseText;
          toolCalls = replayToolCalls;
          replayToolCalls = [];
        } else {
          const renderer = new StreamRenderer({
            silent: !!config.silent,
            modelLabel: `${config.state.model.default.provider}/${config.state.model.default.modelId}`,
            reasoningTier: currentRoundTier,
            thinkingBudget: thinkingBudget,
          });
          renderer.printHeader();
          renderer.startThinkingSpinner();
          if (!config.silent && config.state.thinkingDisplayMode !== "disabled") {
            displayThinking(config.state.thinkingDisplayMode, thinkingBudget);
          }
          // ---- Wave 6b: Complexity-tiered token routing ----
          let effectiveMaxTokens = config.state.model.default.maxTokens;
          try {
            const complexityRouter = new TaskComplexityRouter();
            const roundSignals = complexityRouter.extractSignals(durablePrompt, {
              files: session.activeFiles,
            });
            const roundDecision = complexityRouter.classify(roundSignals);
            if (roundDecision.complexity === "simple" && typeof effectiveMaxTokens === "number" && effectiveMaxTokens > 4096) {
              effectiveMaxTokens = 4096;
              if (config.verbose) {
                emitOrWrite(`${DIM}[complexity-router] simple task — capping maxTokens to 4096${RESET}\n`);
              }
            } else if (roundDecision.complexity === "complex") {
              // Keep full budget for complex tasks (no cap)
              if (config.verbose) {
                emitOrWrite(`${DIM}[complexity-router] complex task — using full token budget${RESET}\n`);
              }
            }
            // "medium"/"standard": keep current behavior
          } catch (err: unknown) {
            swallowError(err, "complexity-router");
          }

          // ---- Wave 5b: Cache hit rate tracking — mark each round's messages ----
          try {
            for (const msg of messages) {
              const messageContent = typeof msg.content === "string"
                ? msg.content
                : Array.isArray(msg.content)
                  ? (msg.content as Array<{text?: string}>).map((b) => b.text ?? "").join("")
                  : String(msg.content);
              if (messageContent.length > 0) {
                const hash = Buffer.from(messageContent.slice(0, 200)).toString("base64").slice(0, 32);
                const tokenEstimate = Math.ceil(messageContent.length / 4);
                globalTokenCache.markSeen(hash, messageContent.slice(0, tokenEstimate));
              }
            }
          } catch (err: unknown) {
            swallowError(err, "token-cache-tracking");
          }

          const useNativeTools = config.state.model.default.supportsToolCalls;
          let nativeSuccess = false;

          if (useNativeTools) {
            // Native AI SDK tool calling: stream with Zod-schema tools
            try {
              traceLogger.logEvent(
                rootSpan.spanId,
                "info",
                "Starting model inference with native tools",
                { round: roundCounter, messageCount: messages.length },
              );
              const streamRecovery = new StreamRecovery({ timeoutMs: 5000, maxRetries: 2 });
              const aiSdkTools = getAISDKTools(config.mcpTools, config.replState?.approvalMode);
              const streamResult = await router.streamWithTools(messages, aiSdkTools, {
                system: systemPrompt,
                maxTokens: effectiveMaxTokens,
                abortSignal: config.abortSignal,
                // cache_control: ephemeral caches the system prompt prefix for ~5 min,
                // cutting token costs 70-90% on the cached portion across all rounds.
                cacheSystemPrompt: true,
                ...(thinkingBudget ? { thinkingBudget } : {}),
                ...(effectiveTaskType ? { taskType: effectiveTaskType } : {}),
              });
              for await (const part of streamResult.fullStream) {
                streamRecovery.updateActivity();
                if (part.type === "text-delta") {
                  streamingStarted = true;
                  renderer.write(part.textDelta);
                  config.onToken?.(part.textDelta);
                  config.eventEmitter?.emitToken(config.eventSessionId ?? "", part.textDelta);
                } else if (part.type === "reasoning") {
                  if (config.verbose) {
                    process.stdout.write(`${DIM}[reasoning] ${part.textDelta}${RESET}\n`);
                  }
                } else if (part.type === "tool-call") {
                  toolCalls.push({
                    id: part.toolCallId,
                    name: part.toolName,
                    input: part.args as Record<string, unknown>,
                  });
                } else if (part.type === "step-finish") {
                  // Vercel AI SDK LanguageModelUsage — accumulate per-step token usage.
                  // SDK uses promptTokens/completionTokens; our shape uses inputTokens/outputTokens.
                  const sdkUsage = part.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number };
                  accumulatedUsage = addLanguageModelUsage(accumulatedUsage, {
                    inputTokens: sdkUsage.promptTokens ?? 0,
                    outputTokens: sdkUsage.completionTokens ?? 0,
                    totalTokens: sdkUsage.totalTokens ?? 0,
                  });
                }
              }
              responseText = renderer.getFullText();
              renderer.finish();
              cleanText = responseText;
              nativeSuccess = true;
            } catch (err: unknown) {
              swallowError(err, "native-tool-calling");
              // Native tool calling failed — fall through to XML fallback
              renderer.reset();
            }
          }

          if (!nativeSuccess) {
            // XML parsing fallback: stream text, then extract tool calls from response
            try {
              const streamResult = await router.stream(messages, {
                system: systemPrompt,
                maxTokens: effectiveMaxTokens,
                abortSignal: config.abortSignal,
                ...(thinkingBudget ? { thinkingBudget } : {}),
                ...(effectiveTaskType ? { taskType: effectiveTaskType } : {}),
              });
              for await (const chunk of streamResult.textStream) {
                streamingStarted = true;
                renderer.write(chunk);
                config.onToken?.(chunk);
              }
              // StreamRecovery: XML fallback streaming tracked via native path
              responseText = renderer.getFullText();
              renderer.finish();
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              if (isTimeoutError(message)) {
                throw err;
              }
              // Fallback to blocking generate if streaming is not supported
              renderer.reset();
              if (!config.silent && config.state.thinkingDisplayMode !== "disabled") {
                displayThinking(config.state.thinkingDisplayMode, thinkingBudget);
              }
              responseText = await router.generate(messages, {
                system: systemPrompt,
                maxTokens: config.state.model.default.maxTokens,
                ...(thinkingBudget ? { thinkingBudget } : {}),
                ...(effectiveTaskType ? { taskType: effectiveTaskType } : {}),
              });
            }
            const extracted = extractToolCalls(responseText);
            cleanText = extracted.cleanText;
            toolCalls = extracted.toolCalls;
            toolCallParseErrors = extracted.parseErrors.map((e) => e.rawPayload); // Backward compat

            // Wire SEARCH/REPLACE blocks (Aider pattern) — parse blocks model emitted as text
            const editBlocks = extractEditBlocks(responseText);
            if (editBlocks.length > 0 && !config.silent) {
              emitOrWrite(`${DIM}[edit-blocks] ${editBlocks.length} SEARCH/REPLACE block(s) detected${RESET}\n`);
            }
            for (const block of editBlocks) {
              try {
                const editResult = await applyEditBlock(
                  block.filePath,
                  block.searchContent,
                  block.replaceContent,
                  session.projectRoot,
                );
                if (editResult.success) {
                  touchedFiles.push(block.filePath);
                  filesModified++;
                  if (!config.silent) {
                    emitOrWrite(`${GREEN}[edit-block] applied ${editResult.strategy} edit → ${block.filePath}${RESET}\n`);
                  }
                } else if (!config.silent) {
                  emitOrWrite(`${YELLOW}[edit-block] failed: ${editResult.error ?? "unknown"}${RESET}\n`);
                }
              } catch (err: unknown) {
                swallowError(err, "edit-block-parsing");
              }
            }

            // XML artifact parsing (Bolt.DIY <danteArtifact> protocol)
            // Convert <danteArtifact>/<danteAction> blocks to tool calls
            try {
              const { parseArtifacts, XmlArtifactParser } = await import("@dantecode/core");
              const artifacts = parseArtifacts(responseText);
              if (artifacts.length > 0) {
                const additionalToolCalls = XmlArtifactParser.toToolCalls(artifacts);
                if (additionalToolCalls.length > 0 && !config.silent) {
                  emitOrWrite(`${DIM}[xml-artifact] ${additionalToolCalls.length} action(s) from ${artifacts.length} artifact(s)${RESET}\n`);
                }
                // Prepend artifact tool calls to existing toolCalls (they run first)
                for (const atc of additionalToolCalls) {
                  toolCalls.unshift({
                    id: randomUUID(),
                    name: atc.name,
                    input: atc.input,
                  });
                }
              }
            } catch (err: unknown) {
              swallowError(err, "artifact-parsing");
            }

            // Enhanced: Immediate feedback with diagnostic details
            if (extracted.parseErrors.length > 0) {
              if (!config.silent) {
                process.stdout.write(
                  `${RED}[tool-parse-error] ${extracted.parseErrors.length} malformed <tool_use> block(s)${RESET}\n`,
                );
              }

              // Provide detailed error feedback to model immediately
              const errorDetails = extracted.parseErrors
                .map(
                  (err, i) =>
                    `Parse Error ${i + 1}:\n` +
                    `  JSON Error: ${err.error}\n` +
                    `  Context: ${err.context}...\n` +
                    `  Full Payload: ${err.rawPayload.slice(0, 150)}...`,
                )
                .join("\n\n");

              const feedbackMessage = {
                role: "user" as const,
                content:
                  `❌ Tool call parsing failed for ${extracted.parseErrors.length} block(s).\n\n` +
                  `${errorDetails}\n\n` +
                  `Common JSON syntax errors:\n` +
                  `• Unescaped quotes: use \\" inside strings (e.g., "don\\"t" not "don't")\n` +
                  `• Unescaped backslashes: use \\\\ for Windows paths (e.g., "C:\\\\Users")\n` +
                  `• Missing commas between fields\n` +
                  `• Unescaped newlines: use \\n instead of literal newlines\n` +
                  `• Template literals: escape $ as \\$\n\n` +
                  `Fix the JSON syntax in your <tool_use> blocks and retry.`,
              };

              messages.push(feedbackMessage);
              session.messages.push({
                id: randomUUID(),
                ...feedbackMessage,
                timestamp: new Date().toISOString(),
              });

              // Continue loop to let model fix the errors
              roundCounter++;
              continue;
            }
          }

          // Use accurate accumulated token count if available; fall back to char estimate
          totalTokensUsed = accumulatedUsage.totalTokens > 0
            ? accumulatedUsage.totalTokens
            : totalTokensUsed + Math.ceil(responseText.length / 4);

          // Recompute effective self-improvement policy based on current fallback state
          effectiveSelfImprovement = router.isUsingFallback()
            ? detectSelfImprovementContext(durablePrompt, session.projectRoot, {
                usingFallbackModel: true,
              })
            : config.selfImprovement;

          // Fallback pipeline guard + no-fallback enforcement for taskMode (observe-only)
          if (
            router.isUsingFallback() &&
            (isPipelineWorkflow ||
              (config.taskMode &&
                (config.taskMode === "observe-only" || config.taskMode === "diagnose-only")))
          ) {
            fallbackPipelineRounds++;
            if (fallbackPipelineRounds >= MAX_FALLBACK_PIPELINE_ROUNDS) {
              const fbModel = router.getFallbackModelId() ?? "unknown-fallback";
              if (!config.silent) {
                process.stdout.write(
                  `${RED}\n⛔ ${config.taskMode ? config.taskMode.toUpperCase() : "Pipeline"} aborted: primary model unavailable ` +
                    `(${fbModel} fallback used for ${fallbackPipelineRounds} consecutive rounds). ` +
                    `Please retry when the primary model recovers.\n${RESET}`,
                );
              }
              break;
            }
          } else if (!router.isUsingFallback()) {
            fallbackPipelineRounds = 0;
          }
        }

        // Model-assisted complexity scoring: extract on first response
        if (!router.getModelRatedComplexity()) {
          const modelScore = router.extractModelComplexityRating(responseText, durablePrompt);
          if (config.verbose && modelScore !== null) {
            process.stdout.write(`${DIM}[complexity: model=${modelScore.toFixed(2)}]${RESET}\n`);
          }
        }

        // D-12A: Model adaptation — observe quirks (all modes except disabled)
        if (!adaptationDisabled && config.replState?.modelAdaptationStore) {
          const modelKey = {
            provider: config.state.model.default.provider,
            modelId: config.state.model.default.modelId,
          };
          const promptType =
            toolCalls.length > 0 ? ("tool-call" as const) : ("implementation" as const);
          const workflow =
            config.replState.activeSkill ?? config.replState.pendingExpectedWorkflow ?? "repl";
          const adaptStore = config.replState.modelAdaptationStore;
          try {
            const newDrafts = await observeAndAdapt(
              adaptStore,
              responseText,
              {
                modelKey,
                promptType,
                toolCallsInRound: toolCalls.length,
                hadToolCalls: toolCalls.length > 0,
                sessionId: session.id,
                workflow: workflow as import("@dantecode/core").WorkflowType,
                commandName: config.replState.activeSkill ?? undefined,
                promptTemplateVersion: "1.3.0",
              },
              (event) => {
                if (process.env.DANTECODE_DEBUG) {
                  process.stderr.write(
                    `[D-12A] ${event.kind}${event.reason ? `: ${event.reason}` : ""}\n`,
                  );
                }
              },
            );

            if (newDrafts.length > 0 && adaptationMode === "staged") {
              const { processNewDrafts, getGlobalAdaptationRateLimiter } =
                await import("@dantecode/core");
              await processNewDrafts(adaptStore, newDrafts, {
                rateLimiter: getGlobalAdaptationRateLimiter(),
                logger: (event) => {
                  if (process.env.DANTECODE_DEBUG) {
                    process.stderr.write(
                      `[D-12A] ${event.kind}${event.quirkKey ? ` [${event.quirkKey}]` : ""}${event.decision ? ` → ${event.decision}` : ""}\n`,
                    );
                  }
                },
              });
            }
          } catch (err) {
            if (process.env.DANTECODE_DEBUG) {
              process.stderr.write(
                `[D-12A] pipeline error: ${err instanceof Error ? err.message : String(err)}\n`,
              );
            }
          }

          // D-12A Gap 2: Periodic rollback check for promoted overrides (active mode only)
          const rollbackInterval =
            parseInt(process.env.DANTE_ADAPTATION_ROLLBACK_CHECK_INTERVAL ?? "10", 10) || 10;
          if (
            adaptationMode === "active" &&
            roundCounter > 0 &&
            roundCounter % rollbackInterval === 0
          ) {
            import("@dantecode/core")
              .then(
                async ({
                  checkPromotedOverrides,
                  getGlobalAdaptationRateLimiter,
                  detectQuirks,
                }) => {
                  const results = await checkPromotedOverrides(
                    adaptStore,
                    {
                      rateLimiter: getGlobalAdaptationRateLimiter(),
                      logger: (event) => {
                        if (process.env.DANTECODE_DEBUG) {
                          process.stderr.write(
                            `[D-12A rollback] ${event.kind} ${event.quirkKey ?? ""} ${event.reason ?? ""}\n`,
                          );
                        }
                      },
                    },
                    (response, context) =>
                      detectQuirks(response, { ...context, sessionId: session.id } as Parameters<
                        typeof detectQuirks
                      >[1]),
                  );
                  if (results.length > 0 && process.env.DANTECODE_DEBUG) {
                    process.stderr.write(`[D-12A] rolled back ${results.length} override(s)\n`);
                  }
                },
              )
              .catch(() => {
                /* non-fatal */
              });
          }
        }

        // Planning phase: track whether the first response contains a plan
        if (planningEnabled && !planGenerated) {
          planGenerated = true;
          // Capture the plan description from the first response for approach memory
          const planMatch = responseText.match(/(?:plan|approach|strategy)[:\s]*([\s\S]{10,200})/i);
          if (planMatch) {
            currentApproachDescription = planMatch[1]!.trim().slice(0, 150);
          } else {
            currentApproachDescription = responseText.slice(0, 150).trim();
          }
        }

        transientTimeoutRetries = 0;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorType = classifyError(err);
        process.stdout.write(`\n${RED}Model error: ${errorMessage}${RESET}\n`);

        // ---- Autonomy Sprint: TaskCircuitBreaker → AutonomyOrchestrator → real recovery ----
        // Don't record auth/balance errors — those are terminal and need no recovery plan
        if (errorType !== DanteErrorType.Auth && errorType !== DanteErrorType.Balance) {
          try {
            const breakerAction = taskCircuitBreaker.recordFailure(errorMessage, roundCounter);
            if (breakerAction.action === "pause_and_recover" || breakerAction.action === "escalate") {
              try {
                const primaryTarget = touchedFiles[touchedFiles.length - 1];
                const decision = await autonomyOrchestrator.decide({
                  breakerAction,
                  errorMessage,
                  touchedFiles: [...touchedFiles],
                  projectRoot: session.projectRoot,
                  primaryTargetFile: primaryTarget,
                  round: roundCounter,
                });

                if (!config.silent) {
                  process.stdout.write(
                    `${YELLOW}[AutonomyOrchestrator] ${decision.type.toUpperCase()}: ${decision.reason}${RESET}\n`,
                  );
                }

                // Inject recovery messages into the conversation
                for (const msg of decision.injectedMessages) {
                  messages.push({ role: "user" as const, content: msg });
                }

                // If we got fresh file context, inject it as a system hint
                if (decision.freshContext?.recovered && decision.freshContext.targetContent && primaryTarget) {
                  const freshMsg = `[AutonomyOrchestrator] Fresh file content for ${primaryTarget} (re-read from disk):\n\`\`\`\n${decision.freshContext.targetContent.slice(0, 3000)}\n\`\`\`\n${decision.freshContext.contextFiles.length} context files also re-loaded.`;
                  messages.push({ role: "user" as const, content: freshMsg });
                }

                // Apply backoff if recommended
                if (decision.backoffMs > 0) {
                  await new Promise<void>((resolve) => setTimeout(resolve, decision.backoffMs));
                }

                if (decision.type === "escalate") {
                  // Escalation is a terminal state — log diagnostics but let the outer
                  // error handler decide whether to abort or continue
                  process.stdout.write(
                    `${RED}[AutonomyOrchestrator] Escalating — all recovery attempts exhausted after ${roundCounter} rounds${RESET}\n`,
                  );
                }
              } catch (orchErr: unknown) {
                swallowError(orchErr, "autonomy-orchestrator");
                // Fallback: at minimum run repo diagnostics (previous behavior)
                try {
                  const repoVerify = recoveryEngine.runRepoRootVerification(session.projectRoot);
                  const failedSteps = repoVerify.failedSteps;
                  if (failedSteps.length > 0 && !config.silent) {
                    process.stdout.write(
                      `${YELLOW}[RecoveryEngine] Repo diagnostics — failed steps: ${failedSteps.join(", ")}${RESET}\n`,
                    );
                  }
                } catch (diagErr: unknown) {
                  swallowError(diagErr, "recovery-engine-diagnostics");
                }
              }
            }
          } catch (err: unknown) {
            swallowError(err, "circuit-breaker-record");
          }
        }

        // Terminal errors (bad key, empty wallet) — abort immediately, no retry
        if (isTerminal(errorType)) {
          const terminalHint =
            errorType === DanteErrorType.Auth
              ? "Check your API key in settings."
              : "Add credits to your API account to continue.";
          process.stdout.write(`${RED}[${errorType}] ${terminalHint}${RESET}\n`);
          agentStateMachine.transition("error", "model_error");
          session.messages.push({
            id: randomUUID(),
            role: "assistant",
            content: `Model error (${errorType}): ${errorMessage} — ${terminalHint}`,
            timestamp: new Date().toISOString(),
          });
          await durableRunStore.failRun(durableRun.id, {
            session,
            touchedFiles,
            lastConfirmedStep,
            lastSuccessfulTool,
            nextAction: terminalHint,
            message: errorMessage,
            evidence: evidenceLedger,
            executionPolicyState: executionPolicy.snapshot(),
          });
          if (localSandboxBridge) await localSandboxBridge.shutdown();
          return session;
        }

        // Retryable errors (rate-limit, network, unknown) — exponential backoff.
        // Cline pattern: if streaming already started, partial tool executions may have
        // already occurred — retrying would duplicate them. Pause for safe resume instead.
        if (isRetryable(errorType) && !isTimeoutError(errorMessage)) {
          if (streamingStarted) {
            const pauseNotice =
              `Execution paused for durable run ${durableRun.id} after mid-stream error (${errorType}). ` +
              `Partial tool output was already emitted — retrying would risk duplicate tool calls. ` +
              `Type /resume ${durableRun.id} to continue from the last confirmed step.`;
            if (!config.silent) {
              process.stdout.write(`${YELLOW}[${errorType}] Mid-stream error — pausing for safe resume.${RESET}\n`);
            }
            await durableRunStore.pauseRun(durableRun.id, {
              reason: "recoverable_error",
              session,
              touchedFiles,
              lastConfirmedStep,
              lastSuccessfulTool,
              nextAction: `Resume with /resume ${durableRun.id}`,
              message: pauseNotice,
              evidence: evidenceLedger,
              executionPolicyState: executionPolicy.snapshot(),
            });
            session.messages.push({
              id: randomUUID(),
              role: "assistant",
              content: pauseNotice,
              timestamp: new Date().toISOString(),
            });
            if (localSandboxBridge) await localSandboxBridge.shutdown();
            return session;
          }

          if (transientTimeoutRetries < maxTransientRetries) {
            transientTimeoutRetries++;
            const delayMs = getRetryDelayMs(errorType, transientTimeoutRetries);
            if (!config.silent) {
              process.stdout.write(
                `${YELLOW}[${errorType}] Retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${transientTimeoutRetries}/${maxTransientRetries})${RESET}\n`,
              );
            }
            if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
            messages.push({
              role: "user" as const,
              content: `SYSTEM: The last model call failed (${errorType}: ${errorMessage}). Please retry from the last confirmed step.`,
            });
            continue;
          }
        }

        if (isTimeoutError(errorMessage)) {
          if (transientTimeoutRetries < maxTransientRetries) {
            transientTimeoutRetries++;
            messages.push({
              role: "user" as const,
              content:
                "SYSTEM: The last model call timed out. Retry from the last confirmed step and continue executing without summarizing.",
            });
            continue;
          }

          const pauseNotice =
            `Execution paused for durable run ${durableRun.id} after repeated model timeout. ` +
            `Type continue or /resume ${durableRun.id} to keep going.`;

          await durableRunStore.pauseRun(durableRun.id, {
            reason: "model_timeout",
            session,
            touchedFiles,
            lastConfirmedStep,
            lastSuccessfulTool,
            nextAction: "Retry from the last confirmed step.",
            message: pauseNotice,
            evidence: evidenceLedger,
            executionPolicyState: executionPolicy.snapshot(),
          });

          session.messages.push({
            id: randomUUID(),
            role: "assistant",
            content: pauseNotice,
            timestamp: new Date().toISOString(),
          });

          if (localSandboxBridge) {
            await localSandboxBridge.shutdown();
          }

          return session;
        }

        agentStateMachine.transition("error", "model_error");
        const errorMsg: SessionMessage = {
          id: randomUUID(),
          role: "assistant",
          content: `I encountered an error communicating with the model: ${errorMessage}`,
          timestamp: new Date().toISOString(),
        };
        session.messages.push(errorMsg);
        await durableRunStore.failRun(durableRun.id, {
          session,
          touchedFiles,
          lastConfirmedStep,
          lastSuccessfulTool,
          nextAction: "Resolve the model error before retrying.",
          message: errorMessage,
          evidence: evidenceLedger,
          executionPolicyState: executionPolicy.snapshot(),
        });
        if (localSandboxBridge) {
          await localSandboxBridge.shutdown();
        }
        return session;
      }

      // ---- Anti-confabulation: empty response circuit breaker ----
      // If the model returned no text and no tool calls, track consecutive empties
      // and abort after MAX_CONSECUTIVE_EMPTY_ROUNDS (Grok empty-response fix).
      if (responseText.trim().length === 0 && toolCalls.length === 0) {
        consecutiveEmptyRounds++;
        if (!config.silent) {
          process.stdout.write(
            `\n${YELLOW}[confab-guard] empty response (${consecutiveEmptyRounds}/${MAX_CONSECUTIVE_EMPTY_ROUNDS})${RESET}\n`,
          );
        }
        if (consecutiveEmptyRounds >= MAX_CONSECUTIVE_EMPTY_ROUNDS) {
          process.stdout.write(
            `\n${RED}${BOLD}[confab-guard] ${MAX_CONSECUTIVE_EMPTY_ROUNDS} consecutive empty responses — aborting${RESET}\n`,
          );
          session.messages.push({
            id: randomUUID(),
            role: "assistant",
            content: `The model returned ${MAX_CONSECUTIVE_EMPTY_ROUNDS} consecutive empty responses. This typically indicates a model compatibility issue. Try a different model or simplify your request.`,
            timestamp: new Date().toISOString(),
          });
          break;
        }
        messages.push({ role: "assistant" as const, content: "(empty response)" });
        messages.push({ role: "user" as const, content: EMPTY_RESPONSE_WARNING });
        continue;
      }
      if (toolCalls.length > 0) {
        consecutiveEmptyRounds = 0;
      }

      // Display the assistant's text response (suppressed in silent mode)
      if (cleanText.length > 0 && !config.silent) {
        emitOrWrite(`${cleanText}\n`, "token");
      }

      // ---- Confidence-gated escalation ----
      // When confidenceGating is enabled, scan the model output for a structured
      // low-confidence signal. If confidence < threshold, pause and ask the user
      // whether to continue. Non-TTY environments skip the gate (CI/CD safety).
      //
      // Recognized signal formats (either format in response text triggers detection):
      //   <!-- DANTE_CONFIDENCE: 0.3 reason="..." -->
      //   [CONFIDENCE:0.3 reason="..."]
      if (config.confidenceGating && cleanText.length > 0) {
        try {
          const cgThreshold = config.confidenceGating.threshold ?? 0.5;
          // Match HTML comment style: <!-- DANTE_CONFIDENCE: 0.35 reason="..." -->
          const htmlMatch = cleanText.match(
            /<!--\s*DANTE_CONFIDENCE\s*:\s*([0-9.]+)(?:\s+reason="([^"]*)")?\s*-->/i,
          );
          // Match bracket style: [CONFIDENCE:0.35 reason="..."]
          const bracketMatch = cleanText.match(
            /\[CONFIDENCE\s*:\s*([0-9.]+)(?:\s+reason="([^"]*)")?\]/i,
          );
          const match = htmlMatch ?? bracketMatch;
          if (match) {
            const parsedScore = parseFloat(match[1] ?? "1");
            const reason = match[2] ?? "unspecified";
            if (Number.isFinite(parsedScore) && parsedScore < cgThreshold) {
              if (!config.silent) {
                process.stdout.write(
                  `\n${YELLOW}[confidence-gate] Low confidence signal detected: ${parsedScore.toFixed(2)} < ${cgThreshold} (reason: ${reason})${RESET}\n`,
                );
              }
              if (
                config.confidenceGating.mode === "on-request" &&
                !benchmarkProfileActive &&
                !config.eventEmitter &&
                process.stdin.isTTY !== false
              ) {
                const shouldContinue = await confirmDestructive(
                  "Agent expressed low confidence — continue anyway?",
                  {
                    operation: `Confidence: ${parsedScore.toFixed(2)} (threshold: ${cgThreshold})`,
                    detail: `Reason: ${reason}`,
                  },
                );
                if (!shouldContinue) {
                  if (!config.silent) {
                    process.stdout.write(
                      `\n${RED}[confidence-gate] Escalation: user chose not to continue (confidence ${parsedScore.toFixed(2)}).${RESET}\n`,
                    );
                  }
                  const escalationMsg: SessionMessage = {
                    id: randomUUID(),
                    role: "assistant",
                    content: `Execution paused: agent expressed low confidence (${parsedScore.toFixed(2)}) and user declined to continue. Reason: ${reason}`,
                    timestamp: new Date().toISOString(),
                  };
                  session.messages.push(escalationMsg);
                  return session;
                }
              }
            }
          }
        } catch (err: unknown) {
          swallowError(err, "confidence-gate");
        }
      }

      // If no tool calls, we're done with this turn. Detect mode for observe-only.
      if (toolCalls.length === 0) {
        const completionPattern =
          /(?:completed?|finished|observed|diagnosed|report(?:ed)?|findings|results only|stop)/i;
        if (
          config.taskMode &&
          (config.taskMode === "observe-only" || config.taskMode === "diagnose-only") &&
          completionPattern.test(cleanText)
        ) {
          // stop after requested command completes, report only, no follow-up or exploration
          if (!config.silent)
            process.stdout.write(
              `${GREEN}[${config.taskMode}] Task complete - reporting only, stopping.${RESET}\n`,
            );
          const assistantMessage: SessionMessage = {
            id: randomUUID(),
            role: "assistant",
            content: responseText,
            timestamp: new Date().toISOString(),
            modelId: `${config.state.model.default.provider}/${config.state.model.default.modelId}`,
            tokensUsed: totalTokensUsed,
          };
          session.messages.push(assistantMessage);
          break;
        }
        const promptRequestsExecution =
          promptRequestsToolExecution(durablePrompt) ||
          isExecutionContinuationPrompt(durablePrompt, session);
        const earlyNoToolDecision = executionPolicy.evaluateNoToolResponse({
          prompt: durablePrompt,
          responseText,
          isWorkflow: isPipelineWorkflow,
          promptRequestsExecution,
          executedToolsThisTurn,
          filesModified,
          toolCallParseErrors,
          executionNudges,
          maxExecutionNudges: MAX_EXECUTION_NUDGES,
          pipelineContinuationNudges,
          maxPipelineContinuationNudges: MAX_PIPELINE_CONTINUATION_NUDGES,
          confabulationNudges,
          maxConfabulationNudges: MAX_CONFABULATION_NUDGES,
          roundNumber: roundCounter,
          maxToolRounds,
        });
        if (
          earlyNoToolDecision &&
          (earlyNoToolDecision.type === "tool_parse_error" ||
            earlyNoToolDecision.type === "execution_nudge")
        ) {
          if (earlyNoToolDecision.type === "execution_nudge") {
            executionNudges++;
          }
          messages.push({ role: "assistant" as const, content: responseText });
          messages.push({
            role: "user" as const,
            content: earlyNoToolDecision.followupPrompt ?? earlyNoToolDecision.displayText,
          });
          if (!config.silent) {
            process.stdout.write(
              `\n${earlyNoToolDecision.severity === "error" ? RED : YELLOW}${earlyNoToolDecision.displayText}${RESET}\n`,
            );
          }
          continue;
        }

        // Wave completion check: if the model signals [WAVE COMPLETE] and we have
        // wave orchestration active, advance to the next wave instead of stopping.
        // Gate: require meaningful work (file writes or successful Bash commands),
        // not just read-only tool calls which don't constitute wave completion.
        if (
          config.waveState &&
          isValidWaveCompletion(responseText) &&
          (filesModified > 0 || bashSucceeded > 0) &&
          maxToolRounds > 0
        ) {
          const waveState = config.waveState;
          const completedWave = getCurrentWave(waveState);

          // Verify wave deliverables before advancing
          if (completedWave) {
            try {
              const waveExpectations = deriveWaveExpectations(completedWave);
              if (waveExpectations.expectedFiles && waveExpectations.expectedFiles.length > 0) {
                const waveVerification = await verifyCompletion(
                  session.projectRoot,
                  waveExpectations,
                );
                if (waveVerification.verdict === "failed") {
                  waveVerifyRetries++;
                  if (waveVerifyRetries <= MAX_WAVE_VERIFY_RETRIES) {
                    if (!config.silent) {
                      process.stdout.write(
                        `\n${RED}[wave-verify] Wave ${completedWave.number} failed (${waveVerifyRetries}/${MAX_WAVE_VERIFY_RETRIES}): ${waveVerification.summary}${RESET}\n`,
                      );
                    }
                    messages.push({ role: "assistant" as const, content: responseText });
                    messages.push({
                      role: "user" as const,
                      content: `WAVE VERIFICATION FAILED: ${waveVerification.summary}\n\nExpected files not found: ${waveVerification.failed.join(", ")}\nFix these issues before claiming [WAVE COMPLETE].`,
                    });
                    continue;
                  }
                  // Max retries exceeded — force-advance with warning
                  if (!config.silent) {
                    process.stdout.write(
                      `\n${YELLOW}[wave-verify] Max retries exceeded — force-advancing past wave ${completedWave.number}${RESET}\n`,
                    );
                  }
                }
              }
            } catch (err: unknown) {
              swallowError(err, "wave-advancement");
            }
          }

          // Reset wave verify retries on successful advancement
          waveVerifyRetries = 0;
          const hasMore = advanceWave(waveState);
          if (!config.silent && completedWave) {
            process.stdout.write(
              `\n${GREEN}[wave ${completedWave.number}/${waveState.waves.length} complete: ${completedWave.title}]${RESET}\n`,
            );
          }
          if (hasMore) {
            // Inject next wave prompt and continue
            const nextWavePrompt = buildWavePrompt(waveState);
            messages.push({ role: "assistant" as const, content: responseText });
            messages.push({ role: "user" as const, content: nextWavePrompt });
            if (!config.silent) {
              const next = getCurrentWave(waveState);
              process.stdout.write(
                `${CYAN}[advancing to wave ${next?.number}/${waveState.waves.length}: ${next?.title}]${RESET}\n`,
              );
            }
            // Reset per-wave counters
            pipelineContinuationNudges = 0;
            confabulationNudges = 0;
            continue;
          }
          // All waves complete — fall through to normal break
          if (!config.silent) {
            process.stdout.write(
              `\n${GREEN}${BOLD}[all ${waveState.waves.length} waves complete]${RESET}\n`,
            );
          }
        }

        const lateNoToolDecision = executionPolicy.evaluateNoToolResponse({
          prompt: durablePrompt,
          responseText,
          isWorkflow: isPipelineWorkflow,
          promptRequestsExecution,
          executedToolsThisTurn,
          filesModified,
          toolCallParseErrors,
          executionNudges,
          maxExecutionNudges: MAX_EXECUTION_NUDGES,
          pipelineContinuationNudges,
          maxPipelineContinuationNudges: MAX_PIPELINE_CONTINUATION_NUDGES,
          confabulationNudges,
          maxConfabulationNudges: MAX_CONFABULATION_NUDGES,
          roundNumber: roundCounter,
          maxToolRounds,
        });
        // Budget-aware nudge gate: suppress pipeline continuation nudges when
        // the remaining round budget is critically low (< 15%) to avoid
        // burning the last rounds on nudges instead of actual work.
        const initialMaxToolRounds = config.requiredRounds
          ? Math.max(config.requiredRounds, 15)
          : config.skillActive
            ? 50
            : isWorkflowPrompt
              ? 75
              : estimatePromptComplexity(durablePrompt);
        const budgetRemaining = maxToolRounds / initialMaxToolRounds;
        const budgetExhausted =
          lateNoToolDecision?.type === "pipeline_continuation" &&
          budgetRemaining < NUDGE_MIN_REMAINING_BUDGET_PCT;

        if (
          lateNoToolDecision &&
          !budgetExhausted &&
          (lateNoToolDecision.type === "pipeline_continuation" ||
            lateNoToolDecision.type === "confab_block")
        ) {
          if (lateNoToolDecision.type === "pipeline_continuation") {
            pipelineContinuationNudges++;
          } else if (lateNoToolDecision.type === "confab_block") {
            confabulationNudges++;
          }
          messages.push({ role: "assistant" as const, content: responseText });
          messages.push({
            role: "user" as const,
            content: lateNoToolDecision.followupPrompt ?? lateNoToolDecision.displayText,
          });
          if (!config.silent) {
            process.stdout.write(
              `\n${lateNoToolDecision.severity === "error" ? RED : YELLOW}${lateNoToolDecision.displayText}${RESET}\n`,
            );
          }
          continue;
        }

        if (isPipelineWorkflow && responseLooksComplete(responseText)) {
          const workflowExpectedFiles = config.waveState
            ? config.waveState.waves.flatMap(
                (wave) => deriveWaveExpectations(wave).expectedFiles ?? [],
              )
            : undefined;
          const completionDecision = await executionPolicy.verifyWorkflowCompletion({
            projectRoot: session.projectRoot,
            responseText,
            isWorkflow: true,
            touchedFiles,
            expectedFiles: workflowExpectedFiles,
            phaseName: workflowName,
            intentDescription: durablePrompt,
            language: config.state.project.language,
            testCommand: config.state.project.testCommand,
          });
          if (
            completionDecision.type === "completion_blocked" ||
            completionDecision.type === "verification_failed"
          ) {
            messages.push({ role: "assistant" as const, content: responseText });
            messages.push({
              role: "user" as const,
              content: completionDecision.followupPrompt ?? completionDecision.displayText,
            });
            if (!config.silent) {
              process.stdout.write(`\n${RED}${completionDecision.displayText}${RESET}\n`);
            }
            continue;
          }
        }

        // ---- CompletionGate: prevent premature exits and stub responses ----
        // Only apply when there are remaining rounds (don't block on last round)
        // and not in observe/diagnose-only mode (already handled above).
        if (
          maxToolRounds > 0 &&
          !config.taskMode &&
          !config.silent // skip in silent/serve mode to avoid injecting noise
        ) {
          const cgVerdict = completionGate.evaluate(responseText, executedToolsThisTurn + filesModified);
          if (!cgVerdict.shouldExit) {
            convergenceMetrics.increment("completionGateRejections");
            const gateMsg = `\n[CompletionGate] Response incomplete (confidence: ${cgVerdict.confidence.toFixed(2)}) — ${cgVerdict.reason}. Please provide actual verification output.`;
            messages.push({ role: "assistant" as const, content: responseText });
            messages.push({ role: "user" as const, content: gateMsg });
            if (!config.silent) {
              process.stdout.write(`${YELLOW}${gateMsg}${RESET}\n`);
            }
            continue;
          }
        }

        // ---- Autonomy Wave 2: Tests-as-exit-criterion ----
        // Before accepting the CompletionGate exit, run a final test verification.
        // If the agent introduced new test failures, block the exit and inject them.
        // This changes "done" from "model stops producing tool calls" to "tests confirm done."
        if (
          testCommandAvailable &&
          touchedFiles.length > 0 &&
          testRetries < MAX_TEST_REPAIR_RETRIES
        ) {
          try {
            const exitVerification = await runTestRepair({
              config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
              projectRoot: session.projectRoot,
              baselineFailures: baselineTestFailures,
            });
            if (!exitVerification.success && exitVerification.newFailures.length > 0) {
              // Do NOT exit — inject failures and continue the loop
              testRetries++;
              convergenceMetrics.increment("completionGateRejections");
              const failureSummary = exitVerification.newFailures
                .slice(0, 3)
                .map(
                  (f) =>
                    `  ${f.testFile ?? "unknown"}::${f.testName ?? "?"} — ${(f.error ?? "").slice(0, 120)}`,
                )
                .join("\n");
              messages.push({
                role: "user" as const,
                content: `[exit-verification] Cannot complete — ${exitVerification.newFailures.length} test(s) still failing:\n${failureSummary}\nFix these before finishing.`,
              });
              if (!config.silent) {
                emitOrWrite(
                  `${YELLOW}[exit-verification] Blocking exit — ${exitVerification.newFailures.length} test failure(s) remain${RESET}\n`,
                );
              }
              continue; // Stay in the loop
            }
          } catch (err: unknown) {
            swallowError(err, "exit-verification");
          }
        }

        const assistantMessage: SessionMessage = {
          id: randomUUID(),
          role: "assistant",
          content: responseText,
          timestamp: new Date().toISOString(),
          modelId: `${config.state.model.default.provider}/${config.state.model.default.modelId}`,
          tokensUsed: totalTokensUsed,
        };
        session.messages.push(assistantMessage);
        break;
      }

      // Execute tool batch (extracted to tool-executor.ts)
      const toolBatchSpan = traceLogger.startSpan("tool-batch", "tool", {
        traceId: rootSpan.traceId,
        parentSpanId: rootSpan.spanId,
        input: { toolCount: toolCalls.length, round: roundCounter },
      });
      // Hook: PreToolUse — fire for each tool call
      for (const tc of toolCalls) {
        void getGlobalHookRunner().run("PreToolUse", { eventType: "PreToolUse", toolName: tc.name, toolInput: tc.input as Record<string, unknown> });
      }
      const execResult = await executeToolBatch(
        toolCalls,
        toolCallParseErrors,
        {
          session,
          config,
          roundCounter,
          maxToolRounds,
          durableRun,
          durableRunStore,
          workflowName,
          isPipelineWorkflow,
          touchedFiles,
          evidenceLedger,
          lastConfirmedStep,
          lastSuccessfulTool,
          lastSuccessfulToolResult,
          filesModified,
          toolCallsThisTurn,
          executedToolsThisTurn,
          completedToolsThisTurn,
          recentToolSignatures,
          readTracker,
          editAttempts,
          lastMajorEditGatePassed,
          effectiveSelfImprovement,
          executionPolicy,
          securityEngine,
          secretsScanner,
          localSandboxBridge,
          testsRun,
          bashSucceeded,
          currentApproachToolCalls,
          toolErrorCounts,
        },
        runAgentLoop,
      );
      // Write back updated state
      filesModified = execResult.filesModified;
      toolCallsThisTurn = execResult.toolCallsThisTurn;
      executedToolsThisTurn = execResult.executedToolsThisTurn;

      // FIXED: Track rounds without writes for anti-confabulation false positive prevention
      const hasWriteTools = toolCalls.some(
        (tc) => tc.name === "Write" || tc.name === "Edit" || tc.name === "GitCommit",
      );
      if (hasWriteTools && filesModified > 0) {
        // Reset counters when actual writes occur
        roundsWithoutWrites = 0;
        consecutiveReadOnlyRounds = 0;
      } else if (toolCalls.length > 0) {
        // Increment if tools executed but no writes
        roundsWithoutWrites++;
        consecutiveReadOnlyRounds++;
      }
      currentApproachToolCalls = execResult.currentApproachToolCalls;
      lastConfirmedStep = execResult.lastConfirmedStep;
      lastSuccessfulTool = execResult.lastSuccessfulTool;
      lastSuccessfulToolResult = execResult.lastSuccessfulToolResult;
      lastMajorEditGatePassed = execResult.lastMajorEditGatePassed;
      localSandboxBridge = execResult.localSandboxBridge;
      testsRun = execResult.testsRun;
      bashSucceeded = execResult.bashSucceeded;
      const toolResults = execResult.toolResults;

      // ---- Autonomy Sprint: LoopDetector → AutonomyOrchestrator scope reduction ----
      if (toolResults.length > 0) {
        const toolResultHash = toolResults.join("|").slice(0, 1000);
        const loopResult = loopDetector.recordAction("tool_results", toolResultHash);
        if (loopResult.stuck) {
          stuckRoundCount++;
          convergenceMetrics.increment("loopDetectorHits");
          try {
            // Ask AutonomyOrchestrator for scope reduction decision
            const decision = await autonomyOrchestrator.decide({
              loopResult,
              touchedFiles: [...touchedFiles],
              projectRoot: session.projectRoot,
              primaryTargetFile: touchedFiles[touchedFiles.length - 1],
              round: roundCounter,
            });

            if (!config.silent) {
              emitOrWrite(`${YELLOW}[AutonomyOrchestrator] Loop detected (${loopResult.reason}) → ${decision.type}: ${decision.reason}${RESET}\n`);
            }

            // Inject scope-reduction or recovery messages
            for (const msg of decision.injectedMessages) {
              toolResults.push(msg);
            }

            // After 3 stuck rounds with no scope reduction: trigger gaslight
            if (stuckRoundCount >= 3 && decision.type === "continue") {
              const nextUserMsg = messages.findIndex((m, i) => i === messages.length - 1 && m.role === "user");
              if (nextUserMsg >= 0) {
                messages[nextUserMsg]!.content = `[verification-gaslight-trigger] ${messages[nextUserMsg]!.content}`;
              } else {
                toolResults.push("[verification-gaslight-trigger] Stuck loop detected — try a fundamentally different approach.");
              }
              stuckRoundCount = 0;
            }
          } catch (err: unknown) {
            swallowError(err, "loop-detector-recovery-diagnostics");
            // Fallback: inject basic stuck message
            toolResults.push(`[LoopDetector] Stuck pattern detected (${loopResult.reason}). Please try a different approach.`);
          }
        }
      }

      // ---- Repair loop: post-execution final gate + lint repair (Wave 1) ----
      // After Write/Edit/Bash tool results, run FinalGate verification and
      // optionally trigger LintRepair for auto-fixable issues. Non-blocking —
      // errors are injected as messages rather than thrown.
      const hasMutatingTools = toolCalls.some(
        (tc) => tc.name === "Write" || tc.name === "Edit" || tc.name === "Bash",
      );
      if (hasMutatingTools && touchedFiles.length > 0) {
        try {
          const fgResult = await runFinalGate({
            mutatedFiles: [...new Set(touchedFiles)],
            config: {
              enabled: true,
              pdseThreshold: 70,
              requireAntiStub: true,
              requireEvidence: false,
            },
            projectRoot: session.projectRoot,
          });

          if (!fgResult.passed && fgResult.failureReasons.length > 0) {
            // Check if lint repair can help (anti-stub violations not lint-fixable)
            const hasLintableErrors = fgResult.failureReasons.some(
              (r) => r.includes("PDSE") || r.includes("lint"),
            );
            if (hasLintableErrors && lintRetries < 3) {
              lintRetries++;
              convergenceMetrics.increment("repairTriggers");
              const lintRepairResult = await runLintRepair({
                changedFiles: [...new Set(touchedFiles)],
                config: {
                  command: "npm run lint",
                  maxRetries: 3,
                  autoCommitFixes: false,
                },
                projectRoot: session.projectRoot,
              });
              if (!lintRepairResult.success && lintRepairResult.errors.length > 0) {
                const errorSummary = lintRepairResult.errors
                  .slice(0, 5)
                  .map((e) => `  ${e.file}:${e.line} — ${e.message}`)
                  .join("\n");
                const repairMsg = `[repair-loop] Lint errors remain after auto-fix (iteration ${lintRepairResult.iteration}):\n${errorSummary}\nPlease fix these lint errors.`;
                messages.push({ role: "user" as const, content: repairMsg });
                if (config.verbose && !config.silent) {
                  emitOrWrite(`${YELLOW}[repair-loop] ${lintRepairResult.errors.length} lint error(s) remain — injecting fix prompt${RESET}\n`);
                }
              }
            } else if (!hasLintableErrors) {
              // Permanent gate failure (anti-stub etc.): inject structured error message
              const failSummary = fgResult.failureReasons.slice(0, 3).join("; ");
              const permanentFailMsg = `[repair-loop] Final gate failed permanently: ${failSummary}. Please address these issues in your next edit.`;
              messages.push({ role: "user" as const, content: permanentFailMsg });
              if (!config.silent) {
                emitOrWrite(`${RED}[repair-loop] Gate failed: ${failSummary}${RESET}\n`);
              }
            }
          }
        } catch (err: unknown) {
          swallowError(err, "lint-repair-hot-path");
        }

        // ---- Repair loop: test verification (Autonomy Wave 1) ----
        // Runs only when file mutations occurred AND test infrastructure detected.
        // Compares against baselineTestFailures to surface ONLY new failures introduced
        // by this agent session — pre-existing failures are not the agent's responsibility.
        if (testCommandAvailable && testRetries < MAX_TEST_REPAIR_RETRIES) {
          try {
            const testRepairResult = await runTestRepair({
              config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
              projectRoot: session.projectRoot,
              baselineFailures: baselineTestFailures,
            });
            if (!testRepairResult.success && testRepairResult.newFailures.length > 0) {
              testRetries++;
              convergenceMetrics.increment("repairTriggers");
              const failureSummary = testRepairResult.newFailures
                .slice(0, 5)
                .map(
                  (f) =>
                    `  ${f.testFile ?? "unknown"}::${f.testName ?? "?"} — ${(f.error ?? "unknown error").slice(0, 120)}`,
                )
                .join("\n");
              const testFailMsg = `[repair-loop] ${testRepairResult.newFailures.length} NEW test failure(s) introduced by your changes (iteration ${testRetries}/${MAX_TEST_REPAIR_RETRIES}):\n${failureSummary}\nPlease fix these failing tests before continuing.`;
              messages.push({ role: "user" as const, content: testFailMsg });
              if (!config.silent) {
                emitOrWrite(
                  `${YELLOW}[repair-loop] ${testRepairResult.newFailures.length} new test failure(s) — injecting fix prompt (attempt ${testRetries}/${MAX_TEST_REPAIR_RETRIES})${RESET}\n`,
                );
              }
            } else if (testRepairResult.success && testRetries > 0 && !config.silent) {
              emitOrWrite(
                `${GREEN}[repair-loop] All tests pass after ${testRetries} repair iteration(s)${RESET}\n`,
              );
            }
          } catch (err: unknown) {
            swallowError(err, "test-repair-hot-path");
          }
        }

        // TestRulesEngine: check if written file is a test
        if (touchedFiles.some((f) => f.endsWith(".test.ts"))) {
          const { testRulesEngine } = await import("@dantecode/core");
          const { basename } = await import("node:path");
          for (const file of touchedFiles.filter((f) => f.endsWith(".test.ts"))) {
            try {
              const content = await readFile(file, "utf-8").catch(() => "");
              const violations = testRulesEngine.checkFile(file, content);
              if (violations.length > 0) {
                const hints = violations
                  .map((v) => `  [${v.severity.toUpperCase()}] ${v.message}`)
                  .join("\n");
                toolResults.push(
                  `[TestRules] ${violations.length} rule violation(s) in ${basename(file)}:\n${hints}`,
                );
              }
            } catch (err: unknown) {
              swallowError(err, "test-rules-engine");
            }
          }
        }
      }

      // Hook: PostToolUse — fire for completed tools
      void getGlobalHookRunner().run("PostToolUse", { eventType: "PostToolUse", metadata: { toolCount: toolCalls.length, filesModified: execResult.filesModified } });

      traceLogger.endSpan(toolBatchSpan.spanId, {
        status: execResult.action === "return" ? "success" : "success",
        output: { toolResults: toolResults.length, filesModified, action: execResult.action },
      });

      // ─── Observability: Track tool execution metrics ───
      agentMetrics.increment("agent.tool_calls.total", toolCalls.length);
      for (const toolCall of toolCalls) {
        agentMetrics.increment(`agent.tool_calls.${toolCall.name}`);
      }
      // Track context usage (gauge metrics for current state)
      const contextWindowSize = config.state.model.default.contextWindow ?? 200000;
      agentMetrics.gauge("agent.context_tokens.used", totalTokensUsed);
      agentMetrics.gauge("agent.context_tokens.remaining", contextWindowSize - totalTokensUsed);

      if (execResult.action === "return") {
        agentMetrics.increment("agent.rounds.success");
        agentTracer.endSpan(roundSpan.id);
        return session;
      }

      // ---- Boundary drift check: detect scope expansion after file mutations ----
      const wroteCode = toolCalls.some((tc) => tc.name === "Write" || tc.name === "Edit");
      if (wroteCode && touchedFiles.length > 0) {
        boundaryTracker.recordMutations(touchedFiles);
        const boundaryState = boundaryTracker.check();
        if (boundaryState.driftDetected) {
          if (!config.silent) {
            emitOrWrite(
              `\n${YELLOW}[boundary-drift] ${boundaryState.expansionPercent.toFixed(0)}% expansion — ` +
                `${boundaryState.outOfScopeFiles.length} file(s) outside original scope${RESET}\n`,
            );
          }
          // In interactive TTY mode (non-serve, non-silent), prompt for approval
          if (!benchmarkProfileActive && !config.eventEmitter && process.stdin.isTTY !== false) {
            const shouldContinue = await confirmDestructive(formatDriftMessage(boundaryState), {
              operation: "Boundary Drift",
              detail: `${boundaryState.outOfScopeFiles.length} file(s) mutated outside declared scope`,
            });
            if (!shouldContinue) {
              if (!config.silent) {
                emitOrWrite(
                  `\n${RED}[boundary-drift] User declined expanded scope — halting execution.${RESET}\n`,
                );
              }
              const driftMsg: SessionMessage = {
                id: randomUUID(),
                role: "assistant",
                content:
                  `Execution paused: boundary drift detected (${boundaryState.expansionPercent.toFixed(0)}% expansion). ` +
                  `Out-of-scope files: ${boundaryState.outOfScopeFiles.join(", ")}. User declined to continue.`,
                timestamp: new Date().toISOString(),
              };
              session.messages.push(driftMsg);
              return session;
            }
          }
        }
      }

      // ---- Post-edit lint loop (Wave 2: Aider pattern) ----
      // After each file-write batch, run the project's linters and inject a
      // targeted fix prompt when errors are found (max 3 retries).
      // Disabled by passing `postEditLint: false` in AgentLoopConfig.
      if (wroteCode && filesModified > 0 && config.postEditLint !== false && lintRetries < 3) {
        try {
          const lintResult = await runPostEditLint(session.projectRoot, touchedFiles);
          // Augment with LSP diagnostics when available (more precise than CLI linting)
          try {
            const { readLspConfig, LspClient } = await import("@dantecode/core");
            const lspConfig = await readLspConfig(session.projectRoot);
            if (lspConfig.enabled && lspConfig.servers.length > 0 && touchedFiles.length > 0) {
              const server = lspConfig.servers[0]!;
              const lspClient = new LspClient(server);
              await lspClient.connect();
              for (const file of touchedFiles.slice(0, 3)) { // Max 3 files
                try {
                  const { readFileSync } = await import("node:fs");
                  const content = readFileSync(file, "utf-8");
                  const lspDiags = await lspClient.getDiagnostics(file, content);
                  const errors = lspDiags.filter(d => d.severity === "error");
                  if (errors.length > 0) {
                    lintResult.errors.push(...errors.map(d => ({
                      file: d.file,
                      line: d.line,
                      message: `[LSP] ${d.message}`,
                      code: d.code,
                    })));
                    lintResult.passed = false;
                  }
                } catch (err: unknown) { swallowError(err, "lsp-file-diagnostic"); }
              }
              await lspClient.disconnect();
            }
          } catch (err: unknown) { swallowError(err, "lsp-augmentation"); }
          if (!lintResult.passed && lintResult.errors.length > 0) {
            lintRetries++;
            const fixPrompt = await buildLintFixPrompt(lintResult);
            if (fixPrompt) {
              messages.push({ role: "user" as const, content: fixPrompt });
              session.messages.push({
                id: randomUUID(),
                role: "user",
                content: fixPrompt,
                timestamp: new Date().toISOString(),
              });
              if (config.verbose && !config.silent) {
                emitOrWrite(
                  `${YELLOW}[post-edit-lint] ${lintResult.errors.length} error(s) — injecting fix prompt (retry ${lintRetries}/3)${RESET}\n`,
                );
              }
              // Skip the normal reflection loop this round — lint loop drives recovery
              maxToolRounds = Math.max(maxToolRounds, 3);
            }
          }
        } catch (err: unknown) {
          swallowError(err, "post-edit-linting");
        }
      }

      // Auto-commit after writes (Aider pattern) — opt-in via STATE.yaml git.autoCommit
      if (config.autoCommit && filesModified > 0 && touchedFiles.length > 0) {
        try {
          await autoCommitIfEnabled(
            session.projectRoot,
            [...new Set(touchedFiles)],
            { enabled: true, includeCoAuthoredBy: true },
            router,
            config.state.model.default.modelId,
          );
        } catch (err: unknown) {
          swallowError(err, "auto-commit");
        }
      }

      // Reflection loop (aider/Cursor pattern): after code edits, auto-run
      // the project's configured lint/test/build commands. If any fail,
      // parse the output into structured errors and inject a targeted fix
      // prompt so the model can fix specific issues instead of guessing.
      if (wroteCode && verifyRetries < MAX_VERIFY_RETRIES) {
        const verifyCommands = getVerifyCommands(config.state);
        let verificationPassed = true;
        let verificationErrorSig = "";
        let verificationRetriesExhausted = false;

        for (const vc of verifyCommands) {
          try {
            const vcResult = await executeTool(
              "Bash",
              { command: vc.command },
              session.projectRoot,
              session.id,
            );
            evidenceLedger.push(buildExecutionEvidence("Bash", { command: vc.command }, vcResult));
            if (vcResult.isError) {
              verifyRetries++;
              verificationPassed = false;
              verificationRetriesExhausted = verifyRetries >= MAX_VERIFY_RETRIES;

              // Evidence Chain: record verification failure receipt
              try {
                evidenceTracker.recordVerificationFailure(
                  vc.name,
                  vc.command,
                  "", // errorSig computed below; basic receipt captures the failure event
                  verifyRetries,
                  MAX_VERIFY_RETRIES,
                );
              } catch (err: unknown) {
                swallowError(err, "evidence-record-failure");
              }

              // Self-healing: parse errors into structured format for targeted fixes
              const parsedErrors = parseVerificationErrors(vcResult.content);
              let retryMessage: string;

              if (parsedErrors.length > 0) {
                // Targeted fix prompt: tell the model exactly which errors to fix
                const fixPrompt = formatErrorsForFixPrompt(parsedErrors);
                retryMessage = `AUTO-VERIFY (${vc.name}) FAILED — ${parsedErrors.length} structured error(s) detected:\n\n${fixPrompt}\n\n(attempt ${verifyRetries}/${MAX_VERIFY_RETRIES})`;

                // Track error signature to detect repeated identical failures
                const errorSig = computeErrorSignature(parsedErrors);
                verificationErrorSig = errorSig;
                if (errorSig === lastErrorSignature) {
                  sameErrorCount++;
                  sessionFailureCount++;
                  if (sameErrorCount >= 2) {
                    // Same errors persisting across retries — escalate model tier
                    const reason = `Persistent verification signature ${errorSig} repeated ${sameErrorCount + 1} times`;
                    if ("escalateTier" in router && typeof router.escalateTier === "function") {
                      router.escalateTier(reason);
                    } else {
                      router.forceCapable();
                    }
                    retryMessage += `\n\nWARNING: These same errors have persisted for ${sameErrorCount + 1} consecutive retries. The model tier has been escalated. Previous attempts failed with signature ${errorSig}. Try a fundamentally different approach to fix these issues.`;
                    if (config.verbose) {
                      process.stdout.write(
                        `\n${YELLOW}[self-heal: tier escalated to capable — same errors ${sameErrorCount + 1}x]${RESET}\n`,
                      );
                    }
                  }
                } else {
                  sameErrorCount = 0;
                  sessionFailureCount++; // different sig = still a failure
                }
                lastErrorSignature = errorSig;

                // Pivot logic: track consecutive failures with the same error signature
                // for strategy change (different from tier escalation — this is about
                // fundamentally changing the approach, not just using a better model)
                if (verificationErrorSig === lastPivotErrorSignature) {
                  consecutiveSameSignatureFailures++;
                } else {
                  consecutiveSameSignatureFailures = 1;
                  lastPivotErrorSignature = verificationErrorSig;
                }

                if (consecutiveSameSignatureFailures >= 4) {
                  // Deep reflection: force full task re-assessment after prolonged stuck state
                  retryMessage += `\n\n${DEEP_REFLECTION_INSTRUCTION}`;
                  if (!config.silent) {
                    process.stdout.write(
                      `\n${RED}[deep-reflect: same error ${consecutiveSameSignatureFailures}x — forcing full re-assessment]${RESET}\n`,
                    );
                  }
                } else if (consecutiveSameSignatureFailures >= 2) {
                  retryMessage += `\n\n${PIVOT_INSTRUCTION}`;
                  if (!config.silent) {
                    process.stdout.write(
                      `\n${YELLOW}[pivot: same error signature ${consecutiveSameSignatureFailures}x — requesting strategy change]${RESET}\n`,
                    );
                  }
                  // Include approach memory in the pivot prompt
                  if (approachLog.length > 0) {
                    const failedApproaches = approachLog
                      .filter((a) => a.outcome === "failed")
                      .map((a) => `  - ${a.description} (${a.toolCalls} tool calls)`)
                      .join("\n");
                    if (failedApproaches) {
                      retryMessage += `\n\nPreviously failed approaches:\n${failedApproaches}`;
                    }
                  }
                }

                if (config.verbose) {
                  process.stdout.write(
                    `${DIM}[self-heal: parsed ${parsedErrors.length} error(s) from ${vc.name} output]${RESET}\n`,
                  );
                }
              } else {
                // Fallback: parser found nothing structured, inject raw output as before
                retryMessage = `AUTO-VERIFY (${vc.name}) FAILED:\n${vcResult.content}\n\nFix the errors above. (attempt ${verifyRetries}/${MAX_VERIFY_RETRIES})`;
              }

              toolResults.push(retryMessage);
              process.stdout.write(
                `\n${YELLOW}[verify: ${vc.name} FAILED]${RESET} ${DIM}(retry ${verifyRetries}/${MAX_VERIFY_RETRIES})${RESET}\n`,
              );
            } else {
              // Verification passed — reset error signature tracking
              lastErrorSignature = "";
              sameErrorCount = 0;
              lastConfirmedStep = `Verified ${vc.name}`;

              // Evidence Chain: record verification pass receipt
              try {
                evidenceTracker.recordVerificationPass(vc.name, vc.command);
              } catch (err: unknown) {
                swallowError(err, "evidence-record-pass");
              }

              process.stdout.write(`\n${GREEN}[verify: ${vc.name} OK]${RESET}\n`);
            }
          } catch (err: unknown) {
            swallowError(err, "verify-command-execution");
          }
        }

        const checkpointAfterVerification = config.checkpointPolicy?.afterVerification ?? true;
        if (checkpointAfterVerification) {
          await durableRunStore.checkpoint(durableRun.id, {
            session,
            touchedFiles,
            lastConfirmedStep,
            lastSuccessfulTool,
            nextAction: verificationPassed
              ? "Proceed to the next implementation step."
              : "Fix the reported verification issues before continuing.",
            evidence: evidenceLedger,
            executionPolicyState: executionPolicy.snapshot(),
          });
          evidenceLedger.length = 0;
        }

        // Approach memory: record the outcome of this verification cycle
        if (verifyCommands.length > 0) {
          const approachDesc = currentApproachDescription || `approach-${approachLog.length + 1}`;

          // Trace decision: verification outcome
          traceLogger.logDecision(
            rootSpan.spanId,
            "verification",
            [
              {
                name: "pass",
                score: verificationPassed ? 1.0 : 0.0,
                reason: "All verification checks passed",
              },
              {
                name: "fail",
                score: verificationPassed ? 0.0 : 1.0,
                reason: "One or more verification checks failed",
              },
            ],
            verificationPassed ? "pass" : "fail",
            verificationPassed
              ? "Verification successful, proceeding"
              : "Verification failed, needs fixes",
            verificationPassed ? 1.0 : 0.0,
          );

          if (verificationPassed) {
            approachLog.push({
              description: approachDesc,
              outcome: "success",
              toolCalls: currentApproachToolCalls,
            });
            // Persist success to cross-session memory
            persistentMemory
              .record({
                description: approachDesc,
                outcome: "success",
                toolCalls: currentApproachToolCalls,
                sessionId: session.id,
              })
              .catch((err) => swallowError(err, "memory-record-success"));
            // Reset pivot tracking on success
            consecutiveSameSignatureFailures = 0;
            lastPivotErrorSignature = "";
          } else {
            approachLog.push({
              description: approachDesc,
              outcome: "failed",
              toolCalls: currentApproachToolCalls,
            });
            // Persist failure to cross-session memory
            persistentMemory
              .record({
                description: approachDesc,
                outcome: "failed",
                errorSignature: lastErrorSignature || undefined,
                toolCalls: currentApproachToolCalls,
                sessionId: session.id,
              })
              .catch((err) => swallowError(err, "memory-record-failure"));

            // Inject approach memory into the retry prompt so the model knows what was tried
            if (approachLog.length > 1) {
              const lastFailed = approachLog[approachLog.length - 1]!;
              toolResults.push(
                `Previously tried: ${lastFailed.description} — failed. Try a different approach.`,
              );
            }
          }
          // Reset for the next approach
          currentApproachDescription = "";
          currentApproachToolCalls = 0;
        }

        // ConfidenceSynthesizer: after the verification cycle, synthesize a
        // structured confidence decision. If the decision is "block" and the
        // same error has persisted across 2+ retries, escalate immediately and
        // exhaust retries rather than burning more rounds on an unrecoverable state.
        if (!verificationPassed) {
          try {
            const synthesis = synthesizeConfidence({
              pdseScore: 0, // score unknown at CLI level; use sameErrorCount as signal
              metrics: [],
              railFindings: [],
              critiqueTrace: [],
            });
            // Only block when the same error signature has repeated enough times
            // to indicate a genuinely unrecoverable state.
            if (synthesis.decision === "block" && sameErrorCount >= 2) {
              const blockMsg =
                `[ConfidenceSynthesizer] Decision: BLOCK — same failure signature repeated ` +
                `${sameErrorCount + 1} times with no recovery. Escalating and stopping retries.`;
              process.stdout.write(`\n${RED}${blockMsg}${RESET}\n`);
              toolResults.push(blockMsg);
              verificationRetriesExhausted = true;
            }
          } catch (err: unknown) {
            swallowError(err, "confidence-synthesizer");
          }
        } else if (verificationPassed && config.verbose) {
          // Verification passed — emit a synthesizer "pass" signal in verbose mode
  // Consolidate session memories if accumulated entry count is high
  try {
    const consolidator = new MemoryConsolidator({ consolidationThreshold: 50, maxAgeDays: 90 });
    const memoryEntries = session.messages
      .filter((m) => m.role === "assistant")
      .map((m) => ({
        key: m.id,
        value: typeof m.content === "string" ? m.content.slice(0, 200) : "",
        timestamp: m.timestamp,
      }));
    consolidator.addEntries(memoryEntries);
    consolidator.consolidateIfNeeded();
  } catch (err: unknown) {
    swallowError(err, "memory-consolidation");
  }

          try {
            const synthesis = synthesizeConfidence({
              pdseScore: 1.0,
              metrics: [],
              railFindings: [],
              critiqueTrace: [],
            });
            process.stdout.write(
              `${DIM}[ConfidenceSynthesizer] Decision: ${synthesis.decision} — continuing normally${RESET}\n`,
            );
          } catch (err: unknown) {
            swallowError(err, "confidence-synthesizer-pass");
          }
        }

        if (!verificationPassed && verificationRetriesExhausted) {
          const verificationPauseNotice =
            `Execution paused for durable run ${durableRun.id} because verification failed ${MAX_VERIFY_RETRIES} times. ` +
            `Type continue or /resume ${durableRun.id} after addressing the reported verification issues.`;

          await durableRunStore.pauseRun(durableRun.id, {
            reason: "verification_failed",
            session,
            touchedFiles,
            lastConfirmedStep,
            lastSuccessfulTool,
            nextAction: "Fix the verification issues and then continue the durable run.",
            message: verificationPauseNotice,
            evidence: checkpointAfterVerification ? [] : evidenceLedger,
            executionPolicyState: executionPolicy.snapshot(),
          });
          if (!checkpointAfterVerification) {
            evidenceLedger.length = 0;
          }

          session.messages.push({
            id: randomUUID(),
            role: "assistant",
            content: verificationPauseNotice,
            timestamp: new Date().toISOString(),
          });

          if (localSandboxBridge) {
            await localSandboxBridge.shutdown();
          }

          return session;
        }
      } else if (wroteCode && verifyRetries >= MAX_VERIFY_RETRIES) {
        toolResults.push(
          `SYSTEM: Verification has failed ${MAX_VERIFY_RETRIES} times. Stop retrying and ask the user for guidance.`,
        );
      }

      // Wave advancement (after tool execution): if the model signaled [WAVE COMPLETE]
      // in a response that also had tool calls, advance to the next wave now.
      // Gate: require meaningful work (file writes or successful Bash commands).
      if (
        config.waveState &&
        isValidWaveCompletion(responseText) &&
        (filesModified > 0 || bashSucceeded > 0) &&
        maxToolRounds > 0
      ) {
        const waveState = config.waveState;
        const completedWave = getCurrentWave(waveState);

        // Verify wave deliverables before advancing
        let waveVerifyPassed = true;
        if (completedWave) {
          try {
            const waveExpectations = deriveWaveExpectations(completedWave);
            if (waveExpectations.expectedFiles && waveExpectations.expectedFiles.length > 0) {
              const waveVerification = await verifyCompletion(
                session.projectRoot,
                waveExpectations,
              );
              if (waveVerification.verdict === "failed") {
                waveVerifyRetries++;
                if (waveVerifyRetries <= MAX_WAVE_VERIFY_RETRIES) {
                  waveVerifyPassed = false;
                  if (!config.silent) {
                    process.stdout.write(
                      `\n${RED}[wave-verify] Wave ${completedWave.number} failed (${waveVerifyRetries}/${MAX_WAVE_VERIFY_RETRIES}): ${waveVerification.summary}${RESET}\n`,
                    );
                  }
                  toolResults.push(
                    `WAVE VERIFICATION FAILED: ${waveVerification.summary}\nExpected files not found: ${waveVerification.failed.join(", ")}\nFix these issues before claiming [WAVE COMPLETE].`,
                  );
                } else if (!config.silent) {
                  // Max retries exceeded — force-advance with warning
                  process.stdout.write(
                    `\n${YELLOW}[wave-verify] Max retries exceeded — force-advancing past wave ${completedWave.number}${RESET}\n`,
                  );
                }
              }
            }
          } catch (err: unknown) {
            swallowError(err, "wave-verify-advancement");
          }
        }

        if (waveVerifyPassed) {
          waveVerifyRetries = 0;
          const hasMore = advanceWave(waveState);
          if (!config.silent && completedWave) {
            process.stdout.write(
              `\n${GREEN}[wave ${completedWave.number}/${waveState.waves.length} complete: ${completedWave.title}]${RESET}\n`,
            );
          }
          if (hasMore) {
            const nextWavePrompt = buildWavePrompt(waveState);
            toolResults.push(`SYSTEM: Wave complete. Next wave instructions:\n\n${nextWavePrompt}`);
            if (!config.silent) {
              const next = getCurrentWave(waveState);
              process.stdout.write(
                `${CYAN}[advancing to wave ${next?.number}/${waveState.waves.length}: ${next?.title}]${RESET}\n`,
              );
            }
            // Reset per-wave counters
            pipelineContinuationNudges = 0;
            confabulationNudges = 0;
          } else if (!config.silent) {
            process.stdout.write(
              `\n${GREEN}${BOLD}[all ${waveState.waves.length} waves complete]${RESET}\n`,
            );
          }
        }
      }

      // ---- DanteMemory: retain tool round outcome for cross-session recall ----
      // Scope: "project" + layer: "semantic" so facts persist across session restarts.
      if (memoryInitialized && toolCalls.length > 0) {
        const touchedFilesList = touchedFiles
          .slice(0, 3)
          .map((f: string) => f.split("/").pop())
          .join(", ");
        const roundSummary = `Round ${roundCounter}: ${toolCalls.length} tool(s)${touchedFilesList ? ` | files: ${touchedFilesList}` : ""}`;
        if (secretsScanner.scan(roundSummary).clean) {
          // Use last PDSE score if available (set by DanteForge on prior round)
          const lastPdse = config.replState?.lastSessionPdseResults?.slice(-1)[0]?.pdseScore;
          memoryOrchestrator
            .memoryStore(`round-${roundCounter}-${session.id}`, roundSummary, "project", {
              layer: "semantic",
              source: session.id,
              summary: roundSummary,
              tags: ["round"],
              round: roundCounter,
              filesModified: touchedFiles.slice(0, 10),
              ...(lastPdse !== undefined ? { pdseScore: lastPdse } : {}),
            })
            .catch((err) => swallowError(err, "memory-store")); // fire-and-forget, non-fatal
        }
      }

      // ---- DanteMemory: early-checkpoint write after first file modification ----
      // Fires once per session the first time a file is actually written/edited.
      // Ensures SOME project-scope fact survives even if the process is killed mid-session.
      if (
        memoryInitialized &&
        !memoryEarlyCheckpointFired &&
        touchedFiles.length > 0
      ) {
        memoryEarlyCheckpointFired = true;
        const firstFile = touchedFiles[0] ?? "unknown";
        memoryOrchestrator
          .memoryStore(
            `session::${session.id}::first-write`,
            `Modified ${firstFile} in session ${session.id}`,
            "project",
            { layer: "semantic", tags: ["early-checkpoint"], sessionId: session.id },
          )
          .catch((err) => swallowError(err, "memory-early-checkpoint")); // fire-and-forget
      }

      // Add tool results to messages for the next model call
      const assistantToolMessage = {
        role: "assistant" as const,
        content: responseText,
      };
      messages.push(assistantToolMessage);

      // Budget-aware tool output truncation: prevent large tool results from
      // bloating context when we're already under pressure. Uses context-budget.ts
      // dynamic limits: green=50KB, yellow=10KB, red=5KB, critical=2KB.
      const _budgetState = checkBudget(
        messages,
        createContextBudget({ maxTokens: config.state.model.default.contextWindow ?? 200_000 }),
      );
      // Inject PDSE hints for tool results that contain actionable errors
      // (TypeScript errors, test failures, lint errors, git conflicts).
      // ErrorHelper surfaces next-step suggestions to guide the model toward a fix.
      const annotatedResults = toolResults.map((result) => {
        if (result.length < 20) return result;
        const analysis = errorHelper.classify(result);
        if (analysis.kind !== "unknown" && analysis.suggestions.length > 0) {
          const hint = `\n[ErrorHelper: ${analysis.kind} — ${analysis.suggestions.slice(0, 2).join("; ")}]`;
          return result + hint;
        }
        return result;
      });

      const truncatedResults = annotatedResults.map((result) => {
        const advice = shouldTruncateToolOutput(result, _budgetState);
        if (advice.truncate) {
          return (
            result.slice(0, advice.maxChars) +
            `\n[truncated: output exceeded ${advice.maxChars} char budget limit (context ${_budgetState.tier} — ${Math.round(_budgetState.percent)}% used)]`
          );
        }
        return result;
      });

      if (!config.silent && _budgetState.tier !== "green") {
        emitOrWrite(
          `${DIM}[budget: ${_budgetState.tier} ${Math.round(_budgetState.percent)}% — ${Math.round(_budgetState.remainingBudget() / 1000)}K tokens remaining]${RESET}\n`,
        );
      }

      const toolResultsMessage = {
        role: "user" as const,
        content: `Tool execution results:\n\n${truncatedResults.join("\n\n---\n\n")}`,
      };
      messages.push(toolResultsMessage);

      if ((config.checkpointPolicy?.afterToolBatch ?? true) && toolCalls.length > 0) {
        await durableRunStore.checkpoint(durableRun.id, {
          session,
          touchedFiles,
          lastConfirmedStep,
          lastSuccessfulTool,
          nextAction: "Continue executing the next planned step.",
          evidence: evidenceLedger,
          executionPolicyState: executionPolicy.snapshot(),
        });
        evidenceLedger.length = 0;
      }

      // Record per-round latency metric
      metricsCollector.recordTiming("agent.round.latency", Date.now() - _roundStartMs);

      // ─── Observability: End round span (normal completion) ───
      agentMetrics.increment("agent.rounds.success");
      agentTracer.endSpan(roundSpan.id);
    }

    // FIXED: Enhanced anti-confabulation with false positive prevention
    // Distinguishes planning/exploration from actual confabulation using:
    // 1. Action-verb filtering (past-tense completion claims only)
    // 2. Time window (grace period for read-heavy planning phases)
    if (touchedFiles.length > 0) {
      const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
      if (lastAssistant) {
        // Use action-verb-only mode to extract COMPLETION CLAIMS (not planning)
        const claimedFiles = extractClaimedFiles(lastAssistant.content, {
          actionVerbsOnly: true,
        });

        if (claimedFiles.length > 0) {
          const actualSet = new Set(touchedFiles.map((f) => f.replace(/\\/g, "/")));
          const unverified = claimedFiles.filter(
            (f: string) => !actualSet.has(f.replace(/\\/g, "/")),
          );

          // Only flag if BOTH conditions met:
          // 1. Model made false completion claims (unverified files)
          // 2. Multiple rounds without writes (not just planning)
          const shouldFlag =
            unverified.length > 0 &&
            roundsWithoutWrites >= 3 && // Grace period: 3 rounds
            consecutiveReadOnlyRounds >= 2; // At least 2 consecutive read-only rounds

          if (shouldFlag) {
            const color = isPipelineWorkflow ? RED : YELLOW;
            const tag = isPipelineWorkflow ? "confab-block" : "confab-diff";

            if (!config.silent) {
              process.stdout.write(
                `\n${color}[${tag}] Confabulation detected after ${roundsWithoutWrites} rounds without writes.\n` +
                  `  Claimed: ${unverified.join(", ")}\n` +
                  `  Actual writes: 0${RESET}\n`,
              );
            }

            // In pipeline mode, nudge the model with confabulation warning
            if (isPipelineWorkflow) {
              confabulationNudges++;
              session.messages.push({
                id: randomUUID(),
                role: "user",
                content:
                  `⚠️ Confabulation detected: You claimed to have modified ${unverified.join(", ")}, ` +
                  `but no Write/Edit tools were executed in the last ${roundsWithoutWrites} rounds.\n\n` +
                  `You must use Write or Edit tools to actually modify files. ` +
                  `Do NOT claim completion without executing the corresponding tools.`,
                timestamp: new Date().toISOString(),
              });
            }
          } else if (unverified.length > 0 && !config.silent) {
            // Log false claims but don't block (likely planning/explanation)
            process.stdout.write(
              `${DIM}[confab-note] Model mentioned files not yet modified (planning phase): ${unverified.join(", ")}${RESET}\n`,
            );
          }
        }
      }
    }

    // Legacy post-loop deliverables verification remains below but is disabled.
    // ExecutionPolicyEngine now performs authoritative completion gating earlier.
    // verify files claimed by the model. Non-fatal — logs result, does not crash.
    if (touchedFiles.length > 0 && false) {
      try {
        let deliverableExpectedFiles: string[] = [];
        if (config.waveState) {
          // Aggregate expectations from all waves
          for (const wave of config.waveState?.waves ?? []) {
            const waveExp = deriveWaveExpectations(wave);
            const expectedFiles = waveExp.expectedFiles ?? [];
            if (expectedFiles.length > 0) {
              deliverableExpectedFiles.push(...expectedFiles);
            }
          }
        } else if (isPipelineWorkflow) {
          // Use claimed files from last assistant message
          const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
          const lastAssistantContent = lastAssistant?.content;
          if (lastAssistantContent) {
            deliverableExpectedFiles = extractClaimedFiles(String(lastAssistantContent));
          }
        }
        if (deliverableExpectedFiles.length > 0) {
          const uniqueExpected = [...new Set(deliverableExpectedFiles)];
          const finalVerification = await verifyCompletion(session.projectRoot, {
            expectedFiles: uniqueExpected,
            intentDescription: "Session deliverables",
          });
          if (!config.silent) {
            const vIcon =
              finalVerification.verdict === "complete"
                ? GREEN
                : finalVerification.verdict === "partial"
                  ? YELLOW
                  : RED;
            process.stdout.write(`\n${vIcon}[deliverables] ${finalVerification.summary}${RESET}\n`);
          }
        }
      } catch (err: unknown) {
        swallowError(err, "deliverables-verification");
      }
    }

    // Run DanteForge pipeline on touched files (if enabled)
    if (touchedFiles.length > 0 && config.state.autoforge.autoRunOnWrite) {
      process.stdout.write(`\n${CYAN}${BOLD}DanteForge Pipeline${RESET}\n`);

      for (const filePath of touchedFiles) {
        try {
          const content = await readFile(filePath, "utf-8");
          agentMetrics.increment("agent.forge.invocations");
          const { passed, summary, pdseScore } = await runDanteForge(
            content,
            filePath,
            session.projectRoot,
            config.verbose,
          );
          process.stdout.write(`\n${DIM}File: ${filePath}${RESET}\n${summary}\n`);

          // Evidence Chain: record PDSE score receipt for each DanteForge verification
          try {
            evidenceTracker.recordPdseScore(filePath, passed, summary);
          } catch (err: unknown) {
            swallowError(err, "evidence-record-pdse");
          }

          // Trend tracker: record PDSE score for regression detection
          if (config.replState?.verificationTrendTracker) {
            config.replState.verificationTrendTracker.record("pdse", pdseScore);
          }

          // ---- Autonomy Sprint: ConvergenceController — feed PDSE score for trend analysis ----
          try {
            convergenceController.record(pdseScore, roundCounter, passed);
            const convergenceDecision = convergenceController.evaluate();
            if (convergenceDecision.action !== "continue" && !config.silent) {
              process.stdout.write(
                `${YELLOW}[ConvergenceController] ${convergenceDecision.action.toUpperCase()}: ${convergenceDecision.reason}${RESET}\n`,
              );
            }
            // If convergence says scope-reduce or escalate, surface to orchestrator
            if (convergenceDecision.action === "reduce_scope" || convergenceDecision.action === "escalate") {
              const convergenceMsg = `[ConvergenceController] Score trend: ${convergenceDecision.trend} (slope=${convergenceDecision.slope.toFixed(1)}/round, current=${convergenceDecision.currentScore}, best=${convergenceDecision.bestScore}). ${convergenceDecision.reason}. Recommended: ${convergenceDecision.recommendedStrategy} strategy.`;
              messages.push({ role: "user" as const, content: convergenceMsg });
            }
          } catch (err: unknown) {
            swallowError(err, "convergence-controller-record");
          }

          // Session run report: accumulate per-file PDSE results so the REPL
          // session report surfaces verification truth, not just mutation counts.
          if (config.replState) {
            config.replState.lastSessionPdseResults.push({ file: filePath, pdseScore, passed });
          }

          if (passed) {
            await recordSuccessPattern(
              {
                pattern: `DanteForge pass: ${filePath}`,
                correction:
                  "Preserve the verified structure that passed anti-stub, constitution, and PDSE checks.",
                filePattern: filePath,
                language: config.state.project.language || undefined,
                framework: config.state.project.framework,
                occurrences: 1,
                lastSeen: new Date().toISOString(),
              },
              session.projectRoot,
            );
          }

          // Track file in session active files
          if (!session.activeFiles.includes(filePath)) {
            session.activeFiles.push(filePath);
          }
        } catch (err: unknown) {
          swallowError(err, "danteforge-file-analysis");
          process.stdout.write(
            `${DIM}Could not read ${filePath} for DanteForge analysis${RESET}\n`,
          );
        }
      }
    }

    // Record patterns from this conversation for future lesson injection
    try {
      const conversationMessages = session.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content:
            typeof m.content === "string"
              ? m.content
              : m.content.map((b) => b.text || "").join("\n"),
        }));
      await detectAndRecordPatterns?.(conversationMessages, session.projectRoot);
    } catch (err: unknown) {
      swallowError(err, "pattern-detection");
    }

    // Update session timestamp
    session.updatedAt = new Date().toISOString();

    // Persist acquired artifacts (downloads, archives) alongside the durable run record
    const acquiredArtifacts = globalArtifactStore
      .getByKind("download")
      .concat(globalArtifactStore.getByKind("archive_extract"));
    if (acquiredArtifacts.length > 0) {
      try {
        await durableRunStore.persistArtifacts(durableRun.id, acquiredArtifacts);
      } catch (err: unknown) {
        swallowError(err, "artifact-persist");
      }
    }

    // ---- Session-end persistence (extracted to session-manager.ts) ----
    await persistSessionEnd({
      durableRunStore,
      durableRun,
      session,
      touchedFiles,
      lastConfirmedStep,
      lastSuccessfulTool,
      evidenceLedger,
      localSandboxBridge,
      filesModified,
      durablePrompt,
      sessionPersistentMemory,
      autonomyEngine,
    });

    // ---- DanteGaslight + DanteFearSet: post-loop refinement ----
    if (config.gaslight) {
      agentMetrics.increment("agent.gaslight.triggered");
      const gaslightResult = await runGaslightBridge({
        config,
        session,
        durablePrompt,
        router,
        verifyRetries,
        sessionFailureCount,
        silent: !!config.silent,
      });
      if (gaslightResult.aborted) {
        return session;
      }
    }

    // ---- DanteMemory: session-end persist + prune ----
    if (memoryInitialized) {
      try {
        const sessionSummaryValue = `${durablePrompt.slice(0, 120)} | files: ${filesModified}`;
        if (secretsScanner.scan(sessionSummaryValue).clean) {
          await memoryOrchestrator.memoryStore(
            `session::${session.id}`,
            sessionSummaryValue,
            "project", // project scope persists cross-session
            {
              source: session.id,
              summary: sessionSummaryValue,
              tags: ["session-summary"],
            },
          );
        }
        await memoryOrchestrator.memoryPrune();
      } catch (err: unknown) {
        swallowError(err, "memory-session-store");
      }
    }
    // ---- debug-trail: flush session audit log ----
    try {
      await auditLogger.flush({ endSession: true });
    } catch (err: unknown) {
      swallowError(err, "audit-log-flush");
    }

    // ---- Observability: Session-end telemetry ----
    try {
      const sessionMetrics = agentMetrics.getMetricsDetailed();
      const sessionTraces = agentTracer.getTraces();

      // Log to audit trail
      await auditLogger.log(
        "workflow_event",
        "agent-loop",
        "Session observability telemetry collected",
        {
          eventType: "session.observability",
          metrics: sessionMetrics,
          traceCount: sessionTraces.length,
          totalDuration: sessionTraces.reduce((sum, t) => {
            const traceDuration = t.spans.reduce((s, span) => s + (span.duration || 0), 0);
            return sum + traceDuration;
          }, 0),
        },
      );

      // Optional: Export for external analysis
      if (process.env.DANTECODE_EXPORT_TELEMETRY === "1") {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const telemetryDir = path.join(session.projectRoot, ".dantecode", "telemetry");
        await fs.mkdir(telemetryDir, { recursive: true });
        const telemetryPath = path.join(telemetryDir, `session-${session.id}.json`);
        await fs.writeFile(
          telemetryPath,
          JSON.stringify({ metrics: sessionMetrics, traces: sessionTraces }, null, 2),
          "utf-8",
        );
      }
    } catch (err: unknown) {
      swallowError(err, "session-telemetry-export");
    }

    // ---- Wave 6a: Session cost tracking ----
    try {
      // Sonnet pricing: input $3/MTok, output $15/MTok
      const SONNET_INPUT_COST_PER_MTOK = 3.0;
      const SONNET_OUTPUT_COST_PER_MTOK = 15.0;
      if (accumulatedUsage.totalInputTokens > 0 || accumulatedUsage.totalOutputTokens > 0) {
        const inputCost = (accumulatedUsage.totalInputTokens / 1_000_000) * SONNET_INPUT_COST_PER_MTOK;
        const outputCost = (accumulatedUsage.totalOutputTokens / 1_000_000) * SONNET_OUTPUT_COST_PER_MTOK;
        const totalCost = inputCost + outputCost;
        const costMsg = `Session cost: ~$${totalCost.toFixed(4)} (input: ${accumulatedUsage.totalInputTokens}t, output: ${accumulatedUsage.totalOutputTokens}t)`;
        if (!config.silent) {
          process.stdout.write(`${DIM}${costMsg}${RESET}\n`);
        }
        // Store on session for downstream consumers
        (session as unknown as Record<string, unknown>)._sessionCost = {
          inputTokens: accumulatedUsage.totalInputTokens,
          outputTokens: accumulatedUsage.totalOutputTokens,
          totalCostUsd: totalCost,
          rounds: accumulatedUsage.rounds,
        };
      }
    } catch (err: unknown) {
      swallowError(err, "session-cost-tracking");
    }

    // ---- Wave 2c: Post-exec typecheck verification ----
    // Runs tsc --noEmit on modified packages to catch regressions before returning.
    // Non-blocking — errors are logged but do not throw.
    if (touchedFiles.length > 0 && !config.silent) {
      try {
        // Derive unique package roots from touched files (look for packages/<name>/ pattern)
        const modifiedPackageRoots = new Set<string>();
        for (const f of touchedFiles) {
          const normalized = f.replace(/\\/g, "/");
          const match = normalized.match(/^(.+\/packages\/[^/]+)\//);
          if (match?.[1]) {
            modifiedPackageRoots.add(match[1]);
          }
        }
        for (const pkgRoot of modifiedPackageRoots) {
          try {
            execFileSync("npx", ["tsc", "--noEmit"], { cwd: pkgRoot, stdio: "pipe" });
            convergenceMetrics.setVerificationPassed(true);
            if (config.verbose) {
              process.stdout.write(`${DIM}[PostVerify] ✓ typecheck passed (${pkgRoot})${RESET}\n`);
            }
          } catch (err: unknown) {
            swallowError(err, "post-verify-typecheck");
            convergenceMetrics.setVerificationPassed(false);
            process.stdout.write(`${YELLOW}[PostVerify] typecheck FAILED — 1 repair attempt remaining (${pkgRoot})${RESET}\n`);
          }
        }
      } catch (err: unknown) {
        swallowError(err, "post-verify-package-loop");
      }
    }

    // ---- Autonomy Sprint: ConvergenceMetrics + ConvergenceController — session-end summary ----
    if (!config.silent) {
      try {
        const convergenceSummary = convergenceMetrics.formatSummary();
        if (convergenceSummary) {
          process.stdout.write(`${DIM}[convergence] ${convergenceSummary}${RESET}\n`);
        }
        const observations = convergenceController.getObservations();
        if (observations.length > 0) {
          const best = convergenceController.getBestScore();
          const current = convergenceController.getCurrentScore();
          const decision = convergenceController.evaluate();
          process.stdout.write(
            `${DIM}[convergence] PDSE trend: ${decision.trend} — best=${best}, final=${current}, ${observations.length} observation(s), strategy=${autonomyOrchestrator.getStrategy()}${RESET}\n`,
          );
        }
        const recoveryAttempts = autonomyOrchestrator.getRecoveryAttempts();
        if (recoveryAttempts > 0) {
          process.stdout.write(
            `${DIM}[convergence] ${recoveryAttempts} recovery attempt(s) this session${RESET}\n`,
          );
        }
      } catch (err: unknown) {
        swallowError(err, "convergence-summary");
      }
    }

    // ---- Skillbook: record session outcome for effectiveness tracking ----
    // This closes the Gaslight→Skillbook→agent-loop feedback loop.
    // A session is "succeeded" when ALL of:
    //   1. Verification explicitly passed (not undefined — we need positive signal)
    //   2. CompletionGate was never rejected
    //   3. At least 1 file was modified (zero-work sessions must not teach lessons)
    // This prevents permissive undefined-passes-as-success poisoning the skillbook.
    if (_skillbookRef !== null && _injectedSkillIds.length > 0) {
      try {
        const snap = convergenceMetrics.snapshot();
        const sessionSucceeded =
          snap.verificationPassed === true &&
          snap.completionGateRejections === 0 &&
          filesModified > 0;
        _skillbookRef.recordSessionOutcome(_injectedSkillIds, sessionSucceeded);
        if (config.verbose) {
          emitOrWrite(
            `${DIM}[Skillbook] Recorded outcome for ${_injectedSkillIds.length} lessons — succeeded=${sessionSucceeded}${RESET}\n`,
          );
        }
      } catch (err) {
        swallowError(err, "skillbook-record-outcome");
      }
    }

    // ---- Evidence Chain: seal session and surface sealHash ----
    try {
      const sealConfig: Record<string, unknown> = {
        sessionId: session.id,
        modelId: config.state.model.default.modelId,
        provider: config.state.model.default.provider,
      };
      const seal = evidenceTracker.seal(sealConfig, filesModified, roundCounter);
      (session as unknown as Record<string, unknown>)._sealHash = seal.sealHash;
    } catch (err: unknown) {
      swallowError(err, "evidence-seal");
    }

    // ---- Post-completion self-healing pass ----
    // If autoforge ran (roundCounter > 0) and the session modified files,
    // attempt a quick verify→repair cycle to catch any leftover failures
    // before returning to the user.
    if (config.state.autoforge.autoRunOnWrite && roundCounter > 0 && filesModified > 0) {
      try {
        const healLoop = createSelfHealingLoop(session.projectRoot, {
          stages: ["typecheck", "lint", "unit"],
          maxAttemptsPerStage: 2,
          maxTotalAttempts: 4,
        });

        const agentHealingExecutor = async (calls: HealingToolCall[]) => {
          let modified = 0;
          const outputs: string[] = [];
          for (const call of calls) {
            try {
              const r = await executeTool(call.name, call.input, session.projectRoot, session.id);
              outputs.push(r.content);
              if (["Edit", "Write"].includes(call.name) && !r.isError) modified++;
            } catch (err) {
              outputs.push(String(err));
            }
          }
          return { filesModified: modified, outputs, summary: `${calls.length} call(s)` };
        };

        const healingAgent = new HealingAgent(router, agentHealingExecutor, {
          maxTokens: 4096,
          maxLlmRounds: 2,
          streamOutput: false,
        });

        await healLoop.run(async (stage: string, prompt: string, attempt: number) => {
          await healingAgent.run(stage as VerificationStage, prompt, attempt, "");
        });
      } catch (err) {
        swallowError(err, "post-loop-self-heal");
      }
    }

    // Hook: SessionEnd
    void getGlobalHookRunner().run("SessionEnd", { eventType: "SessionEnd", metadata: { sessionId: session.id, filesModified, roundsUsed: roundCounter } });

    // State machine: mark session as finished on normal completion
    agentStateMachine.transition("finished", "loop_complete");

    // Emit session-complete event for SSE clients in serve mode
    if (config.eventEmitter && config.eventSessionId) {
      const msgTokenEst = session.messages.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);
      config.eventEmitter.emitDone(config.eventSessionId, msgTokenEst, Date.now() - loopStartTime);
    }

    return session;
  } finally {
    // End trace span on all exit paths
    const loopEndTime = Date.now();
    traceLogger.endSpan(rootSpan.spanId, {
      status: "success",
      output: { sessionId: session.id, messageCount: session.messages.length },
      metadata: { durationMs: loopEndTime - loopStartTime },
    });
    await traceLogger.flush();
  }
}
