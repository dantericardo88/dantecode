// ============================================================================
// @dantecode/cli — Agent Interaction Loop
// The core loop that sends user prompts to the model, processes tool calls,
// runs the DanteForge pipeline on generated code, and streams responses.
// ============================================================================

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ModelRouterImpl,
  DurableRunStore,
  MetricsCollector,
  getContextUtilization,
  detectSelfImprovementContext,
  promptRequestsToolExecution,
  responseNeedsToolExecutionNudge,
  parseVerificationErrors,
  formatErrorsForFixPrompt,
  computeErrorSignature,
  runStartupHealthCheck,
  getCurrentWave,
  advanceWave,
  isWaveComplete,
  ApproachMemory,
  formatApproachesForPrompt,
  ReasoningChain,
  getCostMultiplier,
  AutonomyEngine,
  PersistentMemory,
  globalToolScheduler,
  globalArtifactStore,
  adaptToolResult,
  formatEvidenceSummary,
  SecurityEngine,
  SecretsScanner,
  synthesizeConfidence,
} from "@dantecode/core";
import type { WorkflowExecutionContext, WaveOrchestratorState } from "@dantecode/core";
import { buildWavePrompt } from "@dantecode/core";
import {
  recordSuccessPattern,
  detectAndRecordPatterns,
} from "@dantecode/danteforge";
import { runDanteForge, getWrittenFilePath } from "./danteforge-pipeline.js";
import { DanteGaslightIntegration } from "@dantecode/dante-gaslight";
import type {
  ExecutionEvidence,
  Session,
  SessionMessage,
  DanteCodeState,
  SelfImprovementContext,
} from "@dantecode/config-types";
import {
  getStatus,
  autoCommit,
} from "@dantecode/git-engine";
import { executeTool } from "./tools.js";
import { normalizeAndCheckBash } from "./safety.js";
import { StreamRenderer } from "./stream-renderer.js";
import { getAISDKTools } from "./tool-schemas.js";
import { SandboxBridge } from "./sandbox-bridge.js";
import { confirmDestructive } from "./confirm-flow.js";
import { createMemoryOrchestrator, type MemoryOrchestrator } from "@dantecode/memory-engine";
import { getGlobalLogger, type AuditLogger } from "@dantecode/debug-trail";

// Extracted modules
import {
  CYAN, YELLOW, GREEN, RED, DIM, BOLD, RESET,
  PROGRESS_EMIT_INTERVAL,
  PLANNING_INSTRUCTION,
  PIVOT_INSTRUCTION,
  EXECUTION_CONTINUATION_PATTERN,
  EXECUTION_WORKFLOW_PATTERN,
  DESTRUCTIVE_GIT_RE,
  RM_SOURCE_RE,
  PREMATURE_SUMMARY_PATTERN,
  GROK_CONFAB_PATTERN,
  MAX_PIPELINE_CONTINUATION_NUDGES,
  PIPELINE_CONTINUATION_INSTRUCTION,
  MAX_CONSECUTIVE_EMPTY_ROUNDS,
  MAX_CONFABULATION_NUDGES,
  REFLECTION_CHECKPOINT_INTERVAL,
  REFLECTION_PROMPT,
  WRITE_SIZE_WARNING_THRESHOLD,
  EMPTY_RESPONSE_WARNING,
  CONFABULATION_WARNING,
} from "./agent-loop-constants.js";
import {
  type ExtractedToolCall,
  extractToolCalls,
  jaccardWordOverlap,
  adaptiveJaccardThreshold,
  checkBigramCoverage,
} from "./tool-call-parser.js";
import {
  getVerifyCommands,
  type MajorEditBatchGateResult,
  isMajorEditBatch,
  runMajorEditBatchGate,
  compactMessages,
  extractClaimedFiles,
  deriveThinkingBudget,
  isTimeoutError,
  buildExecutionEvidence,
} from "./verification-pipeline.js";
import { buildSystemPrompt } from "./context-manager.js";
import {
  _laneCtx,
  backgroundTaskRegistries,
  getBackgroundTaskRegistry,
  extractBackgroundTaskId,
  formatBackgroundWaitNotice,
  getBackgroundResumeNextAction,
  inferWorkflowName,
  buildResumePrompt,
  isExecutionContinuationPrompt,
  createSubAgentExecutor,
} from "./background-task-manager.js";

// Types re-exported from extracted modules are imported above.

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
  /** SSE emitter for serve mode. When set, stdout writes become SSE events. */
  eventEmitter?: import("./serve/session-emitter.js").SessionEventEmitter;
  /** Session ID routing key for eventEmitter. Required when eventEmitter is set. */
  eventSessionId?: string;
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
    } catch {
      // Health check failure is non-fatal — never block the agent loop
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
  const durableRunStore = new DurableRunStore(session.projectRoot);
  let durablePrompt = prompt;
  let replayToolCalls: ExtractedToolCall[] = [];
  let durableRunId = config.resumeFrom ?? config.runId;
  let workflowName = inferWorkflowName(prompt, config);
  const shouldCheckForResume =
    Boolean(config.resumeFrom) || EXECUTION_CONTINUATION_PATTERN.test(prompt.trim());

  if (shouldCheckForResume) {
    const resumeTarget = config.resumeFrom
      ? await durableRunStore.loadRun(config.resumeFrom)
      : await durableRunStore.getLatestWaitingUserRun();
    let resumeHint: {
      summary?: string;
      lastConfirmedStep?: string;
      lastSuccessfulTool?: string;
      nextAction?: string;
    } | null = null;
    let resumeBackgroundTaskId: string | null = null;

    if (resumeTarget) {
      durableRunId = resumeTarget.id;
      workflowName = resumeTarget.workflow || workflowName;
      const snapshot = await durableRunStore.loadSessionSnapshot(resumeTarget.id);
      const persistedToolCalls = await durableRunStore.loadToolCallRecords(resumeTarget.id);
      resumeHint = await durableRunStore.getResumeHint(resumeTarget.id);
      let shouldReplayPendingToolCalls = false;
      if (snapshot) {
        session = snapshot;
      }
      if (persistedToolCalls.length > 0) {
        const restoredToolCalls = globalToolScheduler.resumeToolCalls(persistedToolCalls);
        await durableRunStore.persistToolCallRecords(resumeTarget.id, restoredToolCalls);
      }
      durablePrompt = buildResumePrompt(resumeTarget.id, resumeHint, prompt);
      resumeBackgroundTaskId =
        extractBackgroundTaskId(resumeHint?.nextAction) ??
        extractBackgroundTaskId(resumeTarget.nextAction);
      shouldReplayPendingToolCalls = !resumeBackgroundTaskId;

      if (resumeBackgroundTaskId) {
        const backgroundTaskStore = getBackgroundTaskRegistry(session.projectRoot).store;
        const backgroundTask = await backgroundTaskStore.loadTask(resumeBackgroundTaskId);
        if (backgroundTask?.status === "queued" || backgroundTask?.status === "running") {
          let durableRun = await durableRunStore.loadRun(resumeTarget.id);
          if (!durableRun) {
            durableRun = await durableRunStore.initializeRun({
              runId: resumeTarget.id,
              session,
              prompt: durablePrompt,
              workflow: workflowName,
            });
          }

          session.messages.push({
            id: randomUUID(),
            role: "user",
            content: durablePrompt,
            timestamp: new Date().toISOString(),
          });

          const waitingNotice = formatBackgroundWaitNotice(
            durableRun.id,
            resumeBackgroundTaskId,
            backgroundTask.progress,
          );
          await durableRunStore.pauseRun(durableRun.id, {
            reason: "user_input_required",
            session,
            touchedFiles: [],
            lastConfirmedStep:
              resumeHint?.lastConfirmedStep ?? "Waiting for background sub-agent completion.",
            lastSuccessfulTool: resumeHint?.lastSuccessfulTool,
            nextAction: getBackgroundResumeNextAction(resumeBackgroundTaskId),
            message: waitingNotice,
            evidence: [],
          });

          session.messages.push({
            id: randomUUID(),
            role: "assistant",
            content: waitingNotice,
            timestamp: new Date().toISOString(),
          });

          return session;
        }

        if (backgroundTask?.status === "completed") {
          const completionLines = [
            durablePrompt,
            `Background task ${resumeBackgroundTaskId} completed.`,
          ];
          if (backgroundTask.touchedFiles.length > 0) {
            completionLines.push(`Touched files: ${backgroundTask.touchedFiles.join(", ")}`);
          }
          if (backgroundTask.output) {
            completionLines.push(`Background output:\n${backgroundTask.output}`);
          }
          durablePrompt = completionLines.join("\n");
          shouldReplayPendingToolCalls = true;
        } else if (backgroundTask?.status === "failed") {
          durablePrompt = [
            durablePrompt,
            `Background task ${resumeBackgroundTaskId} failed: ${backgroundTask.error ?? backgroundTask.progress}.`,
            backgroundTask.output ? `Background output:\n${backgroundTask.output}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        }
      }

      if (shouldReplayPendingToolCalls) {
        const pendingToolCalls = await durableRunStore.loadPendingToolCalls(resumeTarget.id);
        if (pendingToolCalls.length > 0) {
          replayToolCalls = pendingToolCalls.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input,
            dependsOn: toolCall.dependsOn,
          }));
          await durableRunStore.clearPendingToolCalls(resumeTarget.id);
        }
      }
    }
  }

  let durableRun = durableRunId ? await durableRunStore.loadRun(durableRunId) : null;
  if (!durableRun) {
    durableRun = await durableRunStore.initializeRun({
      runId: durableRunId,
      session,
      prompt: durablePrompt,
      workflow: workflowName,
    });
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
  const systemPrompt = await buildSystemPrompt(session, config);

  // Convert session messages to the format expected by the AI SDK
  const messages = session.messages.map((msg) => ({
    role: msg.role as "user" | "assistant" | "system",
    content:
      typeof msg.content === "string"
        ? msg.content
        : msg.content.map((b) => b.text || "").join("\n"),
  }));

  // Tool call loop: keep sending to the model until no more tool calls
  // Dynamic round budget: pipeline orchestrators can request more rounds via requiredRounds.
  // When a skill is active (skillActive), default to 50 rounds to ensure completion.
  let maxToolRounds = config.requiredRounds
    ? Math.max(config.requiredRounds, 15)
    : config.skillActive
      ? 50
      : 15;
  let totalTokensUsed = 0;
  const touchedFiles: string[] = [];
  // Stuck loop detection (from opencode/OpenHands): track recent tool call signatures
  const recentToolSignatures: string[] = [];
  const STUCK_LOOP_THRESHOLD = 3; // 3 identical consecutive calls = stuck
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
  let executedToolsThisTurn = 0;
  // ExecutionPolicy (DTR Phase 6): track completed tool names for dependency gating
  const completedToolsThisTurn = new Set<string>();
  // Pipeline continuation: prevent premature wrap-up during multi-step pipelines
  let pipelineContinuationNudges = 0;
  // CLI auto-continuation: refill round budget when exhausted mid-pipeline
  let autoContinuations = 0;
  const MAX_AUTO_CONTINUATIONS = 3;
  // Effective self-improvement policy: may be restricted when on a fallback model
  let effectiveSelfImprovement: SelfImprovementContext | null | undefined = config.selfImprovement;
  // Fallback pipeline guard: tracks consecutive rounds spent on a fallback model
  let fallbackPipelineRounds = 0;
  // Anti-confabulation guards
  let consecutiveEmptyRounds = 0;
  let confabulationNudges = 0;
  const isPipelineWorkflow =
    config.skillActive ||
    EXECUTION_WORKFLOW_PATTERN.test(durablePrompt) ||
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

  // Persistent approach memory: load historical approaches for similar tasks
  const persistentMemory = new ApproachMemory(session.projectRoot);
  let historicalFailures: string | undefined;
  try {
    const failed = await persistentMemory.getFailedApproaches(durablePrompt, 5);
    if (failed.length > 0) {
      historicalFailures = formatApproachesForPrompt(failed);
    }
  } catch {
    // Non-fatal
  }

  // ---- Feature: ReasoningChain (tiered Think→Critique→Act) ----
  // Provides structured per-round thinking phases and PDSE-gated self-critique.
  const reasoningChain =
    config.replState?.reasoningChain ?? new ReasoningChain({ critiqueEveryNTurns: 5 });
  let currentRoundTier: import("@dantecode/core").ReasoningTier = "quick";

  // ---- Feature: AutonomyEngine (persistent goal tracking + meta-reasoning) ----
  // Tracks goals across sessions; periodically runs meta-reasoning passes.
  const autonomyEngine = new AutonomyEngine(session.projectRoot);
  let autonomyResumeContext: string | undefined;
  try {
    autonomyResumeContext = await autonomyEngine.resume(session.id);
  } catch {
    // Non-fatal: goal state unavailable, continue without it
  }
  if (autonomyResumeContext) {
    messages.push({
      role: "system" as const,
      content: `## Active Goals (AutonomyEngine)\n${autonomyResumeContext}`,
    });
  }

  // ---- Feature: PersistentMemory (cross-session context recall) ----
  // Retrieves top relevant memories from past sessions and injects into context.
  const sessionPersistentMemory = new PersistentMemory(session.projectRoot);
  let recalledMemoryText: string | undefined;
  try {
    await sessionPersistentMemory.load();
    const recalled = sessionPersistentMemory.search(durablePrompt, { limit: 5 });
    if (recalled.length > 0) {
      const lines = recalled.map((r) => `- [${r.entry.category.toUpperCase()}] ${r.entry.content}`);
      recalledMemoryText = lines.join("\n");
    }
  } catch {
    // Non-fatal: memory recall failure should not block execution
  }
  if (recalledMemoryText) {
    messages.push({
      role: "system" as const,
      content: `## Relevant Past Context (PersistentMemory)\n${recalledMemoryText}`,
    });
  }

  // ---- Feature: Pivot logic ----
  // Track consecutive failures with similar error signatures for strategy change.
  // This is different from the existing tier escalation — it's about changing
  // strategy, not just using a better model.
  let consecutiveSameSignatureFailures = 0;
  let lastPivotErrorSignature = "";

  // ---- Feature: Progress tracking ----
  // Simple counters emitted to the session periodically
  let toolCallsThisTurn = 0;
  let filesModified = 0;
  let testsRun = 0;
  let roundCounter = 0;
  let lastMajorEditGatePassed = true;
  const readTracker = new Map<string, string>();
  const editAttempts = new Map<string, number>();

  // ---- Security: per-session SecurityEngine + SecretsScanner ----
  // Instantiated once and reused across all rounds. SecurityEngine accumulates
  // action history for anomaly detection; SecretsScanner is stateless.
  const securityEngine = new SecurityEngine({ anomalyDetection: true });
  const secretsScanner = new SecretsScanner();

  // ---- DanteMemory: four-layer persistent memory ----
  // createMemoryOrchestrator is SYNCHRONOUS — no await.
  const memoryOrchestrator: MemoryOrchestrator = createMemoryOrchestrator(session.projectRoot);
  let memoryInitialized = false;
  try {
    await memoryOrchestrator.initialize();
    memoryInitialized = true;
  } catch {
    // Non-fatal: memory init failure must not block the agent
  }
  // getGlobalLogger creates-if-absent: first call with sessionId initializes the singleton.
  // tools.ts dynamic import of debug-trail will pick up the same session-scoped instance.
  const auditLogger: AuditLogger = getGlobalLogger({ sessionId: session.id });

  // ---- DanteMemory: semantic recall injection ----
  // Injects semantically relevant memories from the full memory engine (cross-session).
  if (memoryInitialized) {
    try {
      const recallResult = await memoryOrchestrator.memoryRecall(durablePrompt, 10);
      if (recallResult.results.length > 0) {
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const memoryLines = recallResult.results.map((m) => {
          const storedAt = (m.meta?.storedAt as string | undefined) ?? m.createdAt;
          const isStale = now - new Date(storedAt).getTime() > THIRTY_DAYS_MS;
          const staleFlag = isStale ? " [STALE: >30 days old]" : "";
          const summary =
            m.summary ??
            (typeof m.value === "string"
              ? m.value.slice(0, 200)
              : JSON.stringify(m.value).slice(0, 200));
          return `- [${m.scope}] ${m.key}: ${summary}${staleFlag}`;
        });
        messages.push({
          role: "system" as const,
          content: `## DanteMemory (Semantic Recall)\n${memoryLines.join("\n")}`,
        });
      }
    } catch {
      // Non-fatal: recall failure must not block execution
    }
  }

  const evidenceLedger: ExecutionEvidence[] = [];
  let lastConfirmedStep = "Started execution.";
  let lastSuccessfulTool: string | undefined;
  let lastSuccessfulToolResult: string | undefined;
  let transientTimeoutRetries = 0;
  const maxTransientRetries = config.timeoutPolicy?.transientRetries ?? 1;

  // ---- Feature: Metrics collection ----
  // Per-session Prometheus-compatible metrics collector.
  // Records per-round latency for observability dashboards.
  const metricsCollector = new MetricsCollector();

  if (config.verbose && thinkingBudget) {
    process.stdout.write(
      `${DIM}[thinking: ${config.state.model.default.provider}/${config.state.model.default.modelId}, budget=${thinkingBudget}]${RESET}\n`,
    );
  }

  // Planning phase: for complex tasks, inject a planning instruction into messages
  // so the model creates a plan before diving into execution
  if (planningEnabled) {
    let planContent = `## Planning Required (complexity: ${lexicalComplexity.toFixed(2)})\n\n${PLANNING_INSTRUCTION}`;
    if (historicalFailures) {
      planContent += `\n\n## Previously Failed Approaches (from past sessions)\n${historicalFailures}\nAvoid repeating these failed strategies.`;
    }
    messages.push({
      role: "system" as const,
      content: planContent,
    });
    if (!config.silent) {
      process.stdout.write(
        `${DIM}[planning: enabled — complexity ${lexicalComplexity.toFixed(2)} >= 0.7]${RESET}\n`,
      );
    }
  }

  while (maxToolRounds > 0) {
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

    maxToolRounds--;
    roundCounter++;
    const _roundStartMs = Date.now();
    // Record previous round's outcome (skip round 1: tier not yet decided on first pass)
    if (roundCounter > 1) {
      reasoningChain.recordTierOutcome(
        currentRoundTier,
        sameErrorCount === 0 ? 0.9 : sameErrorCount <= 2 ? 0.75 : 0.6,
      );
    }

    // Context compaction (opencode/OpenHands pattern): condense old messages
    // when approaching the context window limit
    const compacted = compactMessages(messages, config.state.model.default.contextWindow);
    if (compacted.length < messages.length) {
      messages.splice(0, messages.length, ...compacted);
      if (config.verbose) {
        emitOrWrite(`${DIM}[context compacted: ${messages.length} messages remaining]${RESET}\n`);
      }
    }

    // Context utilization meter (WS5 Context Guardian)
    const ctxWindow = config.state.model.default.contextWindow;
    const utilization = getContextUtilization(
      messages.map((m) => ({ role: m.role, content: m.content })),
      ctxWindow,
    );
    if (!config.silent) {
      if (utilization.tier === "green") {
        emitOrWrite(
          `${DIM}[context: ${utilization.percent}% — ${Math.round(utilization.tokens / 1000)}K/${Math.round(utilization.maxTokens / 1000)}K tokens]${RESET}\n`,
        );
      } else if (utilization.tier === "yellow") {
        emitOrWrite(
          `${YELLOW}[context: ${utilization.percent}% — ${Math.round(utilization.tokens / 1000)}K/${Math.round(utilization.maxTokens / 1000)}K tokens — older messages will be summarized soon]${RESET}\n`,
        );
      } else {
        emitOrWrite(
          `${RED}[context: ${utilization.percent}% — ${Math.round(utilization.tokens / 1000)}K/${Math.round(utilization.maxTokens / 1000)}K tokens — use /compact or /new for fresh session]${RESET}\n`,
        );
      }
    }

    // ---- DanteMemory: auto-compaction at 80% context utilization ----
    if (memoryInitialized && utilization.percent > 80) {
      try {
        const sumResult = await memoryOrchestrator.memorySummarize(session.id);
        if (sumResult.compressed && sumResult.summary) {
          const KEEP_RECENT = 8;
          const first = messages[0];
          const recent = messages.slice(-KEEP_RECENT);
          if (first && messages.length > KEEP_RECENT + 1) {
            const summaryMsg = {
              role: "system" as const,
              content: `## Session Summary (DanteMemory auto-compact)\n${sumResult.summary}`,
            };
            messages.splice(0, messages.length, first, summaryMsg, ...recent);
          }
        }
      } catch {
        // Non-fatal: fall through to existing compaction behavior
      }
    }

    // ---- DanteMemory: auto-retain learnings from previous round ----
    // Captures tool outcomes and decisions from the previous round.
    // Runs at the start of round N to persist round N-1 context. Non-blocking.
    if (memoryInitialized && roundCounter > 1) {
      try {
        const retainPayload: Record<string, unknown> = {
          round: roundCounter - 1,
          timestamp: new Date().toISOString(),
          filesModifiedTotal: filesModified,
          toolCallCount: toolCallsThisTurn,
        };
        if (lastSuccessfulTool) {
          retainPayload.lastTool = lastSuccessfulTool;
        }
        if (lastConfirmedStep) {
          retainPayload.lastStep = lastConfirmedStep;
        }
        const lastAssistantMsg = messages.filter((m) => m.role === "assistant").at(-1);
        if (lastAssistantMsg) {
          const text =
            typeof lastAssistantMsg.content === "string"
              ? lastAssistantMsg.content.slice(0, 300)
              : "";
          if (text) retainPayload.assistantSummary = text;
        }
        const retainValue = JSON.stringify(retainPayload);
        if (secretsScanner.scan(retainValue).clean) {
          await memoryOrchestrator.memoryStore(
            `round-${session.id}-${roundCounter - 1}`,
            retainPayload,
            "session",
          );
        }
      } catch {
        // Non-fatal: memory retention failure must never block the agent loop
      }
    }

    // ---- ReasoningChain: per-round thinking phase ----
    // Decide reasoning tier from current complexity + error state, generate a
    // thinking phase, record it, and inject the chain history into messages.
    {
      let tier: import("@dantecode/core").ReasoningTier;
      const usedManualOverride = !!config.replState?.reasoningOverride;
      if (config.replState?.reasoningOverride) {
        tier = config.replState.reasoningOverride;
        if (!config.replState.reasoningOverrideSession) {
          config.replState.reasoningOverride = undefined;
        }
      } else {
        tier = reasoningChain.decideTier(lexicalComplexity, {
          errorCount: sameErrorCount,
          toolCalls: toolCallsThisTurn,
          costMultiplier: getCostMultiplier(config.state.model.default),
          // PRD §3.3: bias away from expensive tiers under sustained error pressure
          remainingBudget: sameErrorCount >= 4 ? 20000 : undefined,
        });
      }
      currentRoundTier = tier;
      if (config.replState) config.replState.reasoningChain = reasoningChain;
      // PRD §3.2: Override thinking budget when user manually set a tier
      if (usedManualOverride && thinkingBudget !== undefined) {
        const tierBudgets: Record<import("@dantecode/core").ReasoningTier, number> = {
          quick: 1024,
          deep: 4096,
          expert: 10240,
        };
        thinkingBudget = tierBudgets[tier];
        // PRD §3.2: sync lastThinkingBudget so /think shows the overridden budget
        if (config.replState) config.replState.lastThinkingBudget = thinkingBudget;
      }
      const thinkPhase = reasoningChain.think(durablePrompt, `round=${roundCounter}`, tier);
      reasoningChain.recordStep(thinkPhase);
      if (reasoningChain.shouldCritique()) {
        // P4-C1: Use same error-based PDSE proxy as recordTierOutcome (was hardcoded 0.8
        // which is always >= threshold 0.75, making shouldEscalate permanently false)
        const pdseProxy = sameErrorCount === 0 ? 0.9 : sameErrorCount <= 2 ? 0.75 : 0.6;
        const critiqueResult = reasoningChain.selfCritique(thinkPhase, pdseProxy);
        const critiquePhase = {
          type: "critique" as const,
          content: critiqueResult.recommendation,
          timestamp: new Date().toISOString(),
        };
        reasoningChain.recordStep(critiquePhase);
        // PRD §3.4: display auto-escalation event when score is below threshold
        if (critiqueResult.shouldEscalate) {
          const tierOrder: import("@dantecode/core").ReasoningTier[] = ["quick", "deep", "expert"];
          const currentIdx = tierOrder.indexOf(currentRoundTier);
          const escalateTo =
            currentIdx < tierOrder.length - 1 ? tierOrder[currentIdx + 1] : undefined;
          if (escalateTo) {
            process.stdout.write(
              `${DIM}[reasoning] Auto-escalated: ${currentRoundTier} → ${escalateTo} (PDSE: ${critiqueResult.score.toFixed(2)})${RESET}\n`,
            );
            currentRoundTier = escalateTo;
            tier = escalateTo;
            // P4-C2: sync thinkingBudget to escalated tier (was missing — wrong budget after escalation)
            if (thinkingBudget !== undefined) {
              const tierBudgets: Record<import("@dantecode/core").ReasoningTier, number> = {
                quick: 1024,
                deep: 4096,
                expert: 10240,
              };
              thinkingBudget = tierBudgets[escalateTo];
              if (config.replState) config.replState.lastThinkingBudget = thinkingBudget;
            }
          }
        }
      }
      const chainText = reasoningChain.formatChainForPrompt(6);
      if (chainText) {
        messages.push({
          role: "system" as const,
          content: `## Reasoning Chain (ReasoningChain)\n${chainText}`,
        });
      }
    }

    // ---- AutonomyEngine: meta-reasoning pass (every 15 steps) ----
    autonomyEngine.incrementStep();
    if (autonomyEngine.shouldRunMetaReasoning()) {
      try {
        const metaResult = autonomyEngine.metaReason(
          `round=${roundCounter}, filesModified=${filesModified}`,
        );
        if (metaResult.recommendation) {
          messages.push({
            role: "system" as const,
            content: `## Autonomy Meta-Reasoning\n${metaResult.recommendation}`,
          });
        }
      } catch {
        // Non-fatal
      }
    }

    // Generate response from model (streaming with tool calling support)
    let responseText = "";
    let toolCalls: ExtractedToolCall[] = [];
    let toolCallParseErrors: string[] = []; // malformed <tool_use> blocks from this round
    let cleanText = "";
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
        const useNativeTools = config.state.model.default.supportsToolCalls;
        let nativeSuccess = false;

        if (useNativeTools) {
          // Native AI SDK tool calling: stream with Zod-schema tools
          try {
            const aiSdkTools = getAISDKTools(config.mcpTools);
            const streamResult = await router.streamWithTools(messages, aiSdkTools, {
              system: systemPrompt,
              maxTokens: config.state.model.default.maxTokens,
              abortSignal: config.abortSignal,
              ...(thinkingBudget ? { thinkingBudget } : {}),
            });
            for await (const part of streamResult.fullStream) {
              if (part.type === "text-delta") {
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
              }
            }
            responseText = renderer.getFullText();
            renderer.finish();
            cleanText = responseText;
            nativeSuccess = true;
          } catch {
            // Native tool calling failed — fall through to XML fallback
            renderer.reset();
          }
        }

        if (!nativeSuccess) {
          // XML parsing fallback: stream text, then extract tool calls from response
          try {
            const streamResult = await router.stream(messages, {
              system: systemPrompt,
              maxTokens: config.state.model.default.maxTokens,
              abortSignal: config.abortSignal,
              ...(thinkingBudget ? { thinkingBudget } : {}),
            });
            for await (const chunk of streamResult.textStream) {
              renderer.write(chunk);
              config.onToken?.(chunk);
            }
            responseText = renderer.getFullText();
            renderer.finish();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (isTimeoutError(message)) {
              throw err;
            }
            // Fallback to blocking generate if streaming is not supported
            renderer.reset();
            if (!config.silent) {
              process.stdout.write(`${DIM}(thinking...)${RESET}\n`);
            }
            responseText = await router.generate(messages, {
              system: systemPrompt,
              maxTokens: config.state.model.default.maxTokens,
              ...(thinkingBudget ? { thinkingBudget } : {}),
            });
          }
          const extracted = extractToolCalls(responseText);
          cleanText = extracted.cleanText;
          toolCalls = extracted.toolCalls;
          toolCallParseErrors = extracted.parseErrors;
          if (extracted.parseErrors.length > 0 && !config.silent) {
            process.stdout.write(
              `${RED}[tool-parse-error] ${extracted.parseErrors.length} malformed <tool_use> block(s) — will report to model${RESET}\n`,
            );
          }
        }

        totalTokensUsed += responseText.length; // Approximate token count

        // Recompute effective self-improvement policy based on current fallback state
        effectiveSelfImprovement = router.isUsingFallback()
          ? detectSelfImprovementContext(durablePrompt, session.projectRoot, {
              usingFallbackModel: true,
            })
          : config.selfImprovement;

        // Fallback pipeline guard: abort if primary model unavailable for too many consecutive rounds
        if (router.isUsingFallback() && isPipelineWorkflow) {
          fallbackPipelineRounds++;
          if (fallbackPipelineRounds >= MAX_FALLBACK_PIPELINE_ROUNDS) {
            const fbModel = router.getFallbackModelId() ?? "unknown-fallback";
            if (!config.silent) {
              process.stdout.write(
                `${RED}\n⛔ Pipeline aborted: primary model unavailable ` +
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
      process.stdout.write(`\n${RED}Model error: ${errorMessage}${RESET}\n`);

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
      } catch {
        // Non-fatal: confidence-gate failure must never block the agent response
      }
    }

    // If no tool calls, we're done with this turn
    if (toolCalls.length === 0) {
      // Parse error nudge: if all <tool_use> blocks were malformed JSON, the model
      // thinks it ran tools but NOTHING executed. Report the errors so the model
      // can fix its JSON and retry — this prevents silent ENOENT in subsequent rounds.
      if (toolCallParseErrors.length > 0) {
        const errorSummary = toolCallParseErrors.map((e, i) => `  Block ${i + 1}: ${e}`).join("\n");
        messages.push({ role: "assistant" as const, content: responseText });
        messages.push({
          role: "user" as const,
          content:
            `SYSTEM ERROR: ${toolCallParseErrors.length} <tool_use> block(s) contained malformed JSON and were NOT executed:\n${errorSummary}\n\n` +
            `No files were written. No commands ran. REQUIRED: Fix the JSON and re-emit the tool call(s).\n` +
            `Common fixes:\n` +
            `  - Escape double quotes inside string values: " → \\"\n` +
            `  - Escape backslashes: \\ → \\\\\n` +
            `  - Escape newlines inside string values: use \\n not a real newline\n` +
            `  - Avoid unescaped special chars in JSON string values`,
        });
        if (!config.silent) {
          process.stdout.write(
            `\n${RED}[tool-parse-error] ${toolCallParseErrors.length} block(s) malformed — forcing retry${RESET}\n`,
          );
        }
        continue;
      }
      if (
        executedToolsThisTurn === 0 &&
        (promptRequestsToolExecution(durablePrompt) ||
          isExecutionContinuationPrompt(durablePrompt, session)) &&
        responseNeedsToolExecutionNudge(responseText) &&
        executionNudges < MAX_EXECUTION_NUDGES &&
        maxToolRounds > 0
      ) {
        executionNudges++;
        messages.push({
          role: "assistant",
          content: responseText,
        });
        messages.push({
          role: "user",
          content:
            "You described the intended work but did not use any tools. Stop narrating and actually execute the next step with Read, Write, Edit, Bash, Glob, Grep, GitCommit, GitPush, or TodoWrite. Only claim file changes after a successful tool result.",
        });
        if (!config.silent) {
          process.stdout.write(
            `\n${YELLOW}[nudge: execute with tools]${RESET} ${DIM}(no tool calls were emitted)${RESET}\n`,
          );
        }
        continue;
      }

      // Wave completion check: if the model signals [WAVE COMPLETE] and we have
      // wave orchestration active, advance to the next wave instead of stopping.
      if (
        config.waveState &&
        isWaveComplete(responseText) &&
        executedToolsThisTurn > 0 &&
        maxToolRounds > 0
      ) {
        const waveState = config.waveState;
        const completedWave = getCurrentWave(waveState);
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

      // Pipeline continuation nudge: if we're in a pipeline workflow (e.g., /magic,
      // /autoforge) and the model emitted a summary-like response with no tool calls
      // but has clearly done work (executedToolsThisTurn > 0), it may be wrapping up
      // prematurely. Force it to continue unless we've already nudged too many times.
      if (
        isPipelineWorkflow &&
        executedToolsThisTurn > 0 &&
        maxToolRounds > 0 &&
        pipelineContinuationNudges < MAX_PIPELINE_CONTINUATION_NUDGES &&
        PREMATURE_SUMMARY_PATTERN.test(responseText)
      ) {
        pipelineContinuationNudges++;
        messages.push({
          role: "assistant",
          content: responseText,
        });
        messages.push({
          role: "user",
          content: PIPELINE_CONTINUATION_INSTRUCTION,
        });
        if (!config.silent) {
          process.stdout.write(
            `\n${YELLOW}[pipeline continuation ${pipelineContinuationNudges}/${MAX_PIPELINE_CONTINUATION_NUDGES}]${RESET} ${DIM}(model stopped mid-pipeline — nudging to continue)${RESET}\n`,
          );
        }
        continue;
      }

      // Anti-confabulation gate v2: fires in two scenarios:
      // 1. Classic: model claims completion (regex match) but filesModified === 0
      // 2. Reads-only: model did only reads (executedToolsThisTurn > 0), filesModified === 0,
      //    AND either Grok-specific fake-verification text detected OR we're in round 3+.
      //    Grok's pattern: read files → narrate "turbo typecheck: PASS" → stop without writing.
      const isGrokConfab = GROK_CONFAB_PATTERN.test(responseText);
      const isClassicConfab = PREMATURE_SUMMARY_PATTERN.test(responseText) || isGrokConfab;
      const isReadsOnlyConfab = executedToolsThisTurn > 0 && (isGrokConfab || roundCounter >= 3);
      if (
        isPipelineWorkflow &&
        filesModified === 0 &&
        confabulationNudges < MAX_CONFABULATION_NUDGES &&
        (isClassicConfab || isReadsOnlyConfab)
      ) {
        confabulationNudges++;
        messages.push({ role: "assistant" as const, content: responseText });
        messages.push({ role: "user" as const, content: CONFABULATION_WARNING });
        if (!config.silent) {
          const reason =
            isReadsOnlyConfab && !isClassicConfab ? "reads-only pattern" : "fake completion";
          process.stdout.write(
            `\n${RED}[confab-guard v2] ${reason} — 0 files modified (${confabulationNudges}/${MAX_CONFABULATION_NUDGES})${RESET}\n`,
          );
        }
        continue;
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

    // Execute each tool call
    const toolResults: string[] = [];
    // If some <tool_use> blocks were valid but others were malformed, report the
    // malformed ones alongside valid tool results so the model can fix and retry.
    if (toolCallParseErrors.length > 0) {
      const errorSummary = toolCallParseErrors.map((e, i) => `  Block ${i + 1}: ${e}`).join("\n");
      toolResults.push(
        `SYSTEM ERROR: ${toolCallParseErrors.length} <tool_use> block(s) had malformed JSON — NOT executed:\n${errorSummary}\n` +
          `Fix JSON escaping and re-emit those tool calls in your next response.`,
      );
    }
    const roundWrittenFiles: string[] = [];
    let roundMajorEditGateResult: MajorEditBatchGateResult | null = null;
    let toolIndex = 0;

    for (const toolCall of toolCalls) {
      executedToolsThisTurn++;
      toolCallsThisTurn++;
      currentApproachToolCalls++;
      toolIndex++;
      // Stuck loop detection (opencode/OpenHands pattern): if the same tool call
      // signature appears 3 times consecutively, inject a warning to break the loop
      const toolSig = `${toolCall.name}:${JSON.stringify(toolCall.input)}`;
      recentToolSignatures.push(toolSig);
      if (recentToolSignatures.length > STUCK_LOOP_THRESHOLD) {
        recentToolSignatures.shift();
      }
      if (
        recentToolSignatures.length === STUCK_LOOP_THRESHOLD &&
        recentToolSignatures.every((sig) => sig === toolSig)
      ) {
        process.stdout.write(
          `\n${YELLOW}${BOLD}Stuck loop detected:${RESET} ${DIM}same tool call repeated ${STUCK_LOOP_THRESHOLD} times. Breaking loop.${RESET}\n`,
        );
        toolResults.push(
          `SYSTEM: Stuck loop detected — you have called ${toolCall.name} with identical arguments ${STUCK_LOOP_THRESHOLD} times. Stop repeating this action and try a different approach, or ask the user for help.`,
        );
        recentToolSignatures.length = 0;
        break;
      }

      // Pre-tool safety hook (Ruflo/ccswarm pattern): block dangerous Bash commands
      if (toolCall.name === "Bash") {
        const bashCmd = toolCall.input["command"] as string | undefined;
        if (bashCmd) {
          const blockReason = normalizeAndCheckBash(bashCmd);
          if (blockReason) {
            process.stdout.write(
              `\n${RED}${BOLD}BLOCKED:${RESET} ${RED}${blockReason}${RESET}\n${DIM}Command: ${bashCmd.slice(0, 100)}${RESET}\n`,
            );
            toolResults.push(
              `SAFETY HOOK: Bash command blocked — ${blockReason}. Use a safer approach.`,
            );
            continue;
          }

          // Destructive-git pipeline guard: block git clean, git checkout --, git reset --hard
          // during ANY pipeline or workflow execution (applies to ALL models — Grok, GPT, Claude).
          // These commands wipe untracked/unstaged work, destroying everything written this session.
          if (isPipelineWorkflow && DESTRUCTIVE_GIT_RE.test(bashCmd)) {
            if (!config.silent) {
              process.stdout.write(
                `\n${RED}[pipeline-guard] BLOCKED destructive git command — \`${bashCmd.slice(0, 80)}\`${RESET}\n`,
              );
            }
            toolResults.push(
              `[PIPELINE GUARD] Destructive git command BLOCKED: \`${bashCmd}\`\n` +
                `This command would undo all in-progress work. During a pipeline/workflow you MUST NOT run:\n` +
                `  - git clean (removes untracked files)\n` +
                `  - git checkout -- . (discards unstaged changes)\n` +
                `  - git reset --hard / --merge (discards ALL changes)\n` +
                `  - git stash --include-untracked (stashes new files out of existence)\n` +
                `Instead: use Edit/Write/Read tools to make file changes. ` +
                `Use GitCommit only AFTER real file edits (Edit or Write tool results).`,
            );
            continue;
          }

          // rm -rf source directory guard: block deletion of package/source dirs during pipelines.
          // When typecheck fails on a newly-created package, Grok often runs `rm -rf packages/<name>`
          // to "clean up" the broken package — destroying all in-progress work.
          if (isPipelineWorkflow && RM_SOURCE_RE.test(bashCmd)) {
            if (!config.silent) {
              process.stdout.write(
                `\n${RED}[pipeline-guard] BLOCKED rm on source directory — \`${bashCmd.slice(0, 80)}\`${RESET}\n`,
              );
            }
            toolResults.push(
              `[PIPELINE GUARD] Destructive rm BLOCKED: \`${bashCmd}\`\n` +
                `Deleting package/source directories during a pipeline destroys all in-progress work.\n` +
                `Instead: fix the TypeScript errors in the new package using Edit. ` +
                `Read the failing file, then Edit to correct the type issues.`,
            );
            continue;
          }

          // SecurityEngine: zero-trust multi-layer check for Bash commands.
          // Evaluates command against built-in rules (critical: curl|sh, dd, mkfs, fork bomb, etc.)
          // and anomaly detection. Runs AFTER existing destructive guards to avoid double-blocking.
          const secCheckResult = securityEngine.checkAction({
            layer: "tool",
            tool: "Bash",
            command: bashCmd,
          });
          if (secCheckResult.decision === "block" || secCheckResult.decision === "quarantine") {
            if (secCheckResult.decision === "quarantine") {
              securityEngine.quarantineAction(
                { layer: "tool", tool: "Bash", command: bashCmd },
                secCheckResult,
              );
            }
            if (!config.silent) {
              process.stdout.write(
                `\n${RED}[security-engine] BLOCKED Bash (${secCheckResult.riskLevel}): ${secCheckResult.reasons.join("; ")}${RESET}\n`,
              );
            }
            toolResults.push(
              `SECURITY ENGINE: Bash command BLOCKED (risk: ${secCheckResult.riskLevel}). ` +
                `Reasons: ${secCheckResult.reasons.join("; ")}. ` +
                `Use a safer approach to accomplish this task.`,
            );
            continue;
          }

          // SecurityEngine: scan bash command content for secrets (e.g. tokens passed as env vars).
          const bashSecretScan = secretsScanner.scan(bashCmd);
          if (!bashSecretScan.clean) {
            if (!config.silent) {
              process.stdout.write(
                `\n${RED}[secrets-scanner] WARNING: Bash command may contain secrets — ${bashSecretScan.summary}${RESET}\n`,
              );
            }
            toolResults.push(
              `SECRETS WARNING: Bash command may contain secrets: ${bashSecretScan.summary}. ` +
                `Avoid passing secrets directly in command arguments. Use environment variables or files.`,
            );
            // Warn but do not block — bash commands legitimately use env vars by name
          }
        }
      }

      // Write size guard: block large Write payloads on existing files (force Edit).
      // Grok models try to rewrite entire files (50K+ chars) instead of using Edit.
      if (toolCall.name === "Write") {
        const writeContent = toolCall.input["content"] as string | undefined;
        if (writeContent && writeContent.length > WRITE_SIZE_WARNING_THRESHOLD) {
          const writeFilePath = toolCall.input["file_path"] as string | undefined;
          const fileExists =
            writeFilePath && readTracker.has(resolve(session.projectRoot, writeFilePath));
          if (fileExists) {
            // Block: model is rewriting an existing file with a massive payload
            if (!config.silent) {
              process.stdout.write(
                `\n${RED}[confab-guard] BLOCKED Write (${Math.round(writeContent.length / 1000)}K chars) to existing file. Use Edit for surgical changes.${RESET}\n`,
              );
            }
            toolResults.push(
              `SYSTEM: Write BLOCKED — your payload is ${Math.round(writeContent.length / 1000)}K characters, which will truncate and corrupt the file. ` +
                `The file "${writeFilePath}" already exists. Use the Edit tool for surgical changes instead of rewriting the entire file. ` +
                `Break your changes into multiple small Edit calls targeting specific sections.`,
            );
            continue;
          }
          // New file: warn but allow
          if (!config.silent) {
            process.stdout.write(
              `\n${YELLOW}[confab-guard] Write payload is ${Math.round(writeContent.length / 1000)}K chars — large file.${RESET}\n`,
            );
          }
        }

        // SecretsScanner: block Write if content contains detected secrets.
        // Runs on ALL Write tool calls (before execution) to prevent accidentally
        // persisting API keys, tokens, private keys, or passwords to disk.
        const writeContentToScan = toolCall.input["content"] as string | undefined;
        if (writeContentToScan) {
          const scanResult = secretsScanner.scan(writeContentToScan);
          if (!scanResult.clean) {
            const writeFilePath = toolCall.input["file_path"] as string | undefined;
            if (!config.silent) {
              process.stdout.write(
                `\n${RED}[secrets-scanner] BLOCKED Write to "${writeFilePath ?? "unknown"}" — ${scanResult.summary}${RESET}\n`,
              );
            }
            toolResults.push(
              `SYSTEM: Write BLOCKED — secrets detected in content: ${scanResult.summary}. ` +
                `Do NOT hardcode secrets (API keys, tokens, private keys, passwords) in source files. ` +
                `Use environment variables or a secrets manager instead. ` +
                `Remove the sensitive values before retrying the Write.`,
            );
            continue;
          }
        }
      }

      // Silent mode (Ruflo pattern): compact progress counter
      if (config.silent) {
        process.stdout.write(
          `\r${DIM}[${toolIndex}/${toolCalls.length} tools] ${toolCall.name}${RESET}` +
            " ".repeat(20),
        );
      } else {
        process.stdout.write(`\n${DIM}[tool: ${toolCall.name}]${RESET} `);
      }

      if (config.verbose && !config.silent) {
        process.stdout.write(`${DIM}${JSON.stringify(toolCall.input).slice(0, 200)}${RESET}\n`);
      }

      // Dirty-commit-before-edit (aider pattern): if the agent is about to edit
      // a file that has uncommitted changes, commit those first so /undo works cleanly
      if (config.enableGit && (toolCall.name === "Write" || toolCall.name === "Edit")) {
        try {
          const targetPath = toolCall.input["file_path"] as string | undefined;
          if (targetPath) {
            const gitStatus = getStatus(session.projectRoot);
            const dirtyPaths = [
              ...gitStatus.unstaged.map((s: { path: string }) => s.path),
              ...gitStatus.staged.map((s: { path: string }) => s.path),
            ];
            const resolvedTarget = resolve(session.projectRoot, targetPath);
            const isDirty = dirtyPaths.some(
              (p) => resolve(session.projectRoot, p) === resolvedTarget,
            );
            if (isDirty) {
              autoCommit(
                {
                  message: `dantecode: snapshot before agent edit of ${targetPath}`,
                  footer: "",
                  files: [targetPath],
                  allowEmpty: false,
                },
                session.projectRoot,
              );
              if (config.verbose) {
                process.stdout.write(
                  `${DIM}[dirty-commit: saved pre-edit state of ${targetPath}]${RESET}\n`,
                );
              }
            }
          }
        } catch {
          // Non-fatal: if the dirty commit fails, continue with the edit anyway
        }
      }

      // DTR Phase 6: ExecutionPolicy dependency gate — block tools whose declared
      // dependsOn tools have not yet completed in this turn.
      // Premature commit blocker: block GitCommit/GitPush when no files have been
      // modified this session. Grok models confabulate file edits in their narrative
      // text, then try to commit non-existent changes.
      if (
        (toolCall.name === "GitCommit" || toolCall.name === "GitPush") &&
        filesModified === 0 &&
        isPipelineWorkflow
      ) {
        if (!config.silent) {
          process.stdout.write(
            `\n${RED}[confab-guard] BLOCKED ${toolCall.name} — 0 files modified this session. Write/Edit files first.${RESET}\n`,
          );
        }
        toolResults.push(
          `SYSTEM: ${toolCall.name} BLOCKED — you have not modified any files in this session (filesModified === 0). ` +
            `You cannot commit or push changes that do not exist. Use Edit or Write tools to make real file changes first, ` +
            `then commit. Do NOT claim you already made changes — only tool results count.`,
        );
        continue;
      }

      if (toolCall.name === "GitCommit" || toolCall.name === "GitPush") {
        if (isMajorEditBatch(roundWrittenFiles, session.projectRoot) && !roundMajorEditGateResult) {
          roundMajorEditGateResult = await runMajorEditBatchGate(
            session.id,
            session.projectRoot,
            roundCounter,
            config.selfImprovement,
            readTracker,
            editAttempts,
          );
          lastMajorEditGatePassed = roundMajorEditGateResult.passed;

          if (!roundMajorEditGateResult.passed) {
            const failedSteps = roundMajorEditGateResult.failedSteps.join(", ");
            toolResults.push(
              `SYSTEM: ${toolCall.name} blocked. Major edit batch verification failed at the repository root (${failedSteps}). Fix typecheck, lint, and test before committing or pushing.`,
            );
            if (!config.silent) {
              process.stdout.write(`\n${RED}[gstack: blocked commit â€” ${failedSteps}]${RESET}\n`);
            }
            continue;
          }
        }

        if (!lastMajorEditGatePassed) {
          toolResults.push(
            `SYSTEM: ${toolCall.name} blocked because the last major edit batch failed repository-root verification. Fix the failing checks before attempting ${toolCall.name} again.`,
          );
          continue;
        }
      }

      // Route MCP tool calls to the MCP client
      const isMCPTool = toolCall.name.startsWith("mcp_") && config.mcpClient;

      // Route Bash commands through sandbox when available
      if (
        toolCall.name === "Bash" &&
        config.enableSandbox &&
        !config.sandboxBridge &&
        !localSandboxBridge
      ) {
        localSandboxBridge = new SandboxBridge(session.projectRoot, config.verbose);
      }

      const activeSandboxBridge = config.sandboxBridge ?? localSandboxBridge ?? undefined;
      const useSandbox =
        toolCall.name === "Bash" &&
        activeSandboxBridge &&
        typeof toolCall.input["command"] === "string";

      const _toolStartMs = Date.now();
      const [schedulerResult] = await globalToolScheduler.executeBatch(
        [
          {
            id: toolCall.id,
            toolName: toolCall.name,
            input: toolCall.input,
            dependsOn: toolCall.dependsOn,
          },
        ],
        {
          requestId: `round-${roundCounter}`,
          projectRoot: session.projectRoot,
          completedTools: completedToolsThisTurn,
          execute: async (scheduledToolCall) => {
            if (isMCPTool) {
              try {
                const mcpResult = await config.mcpClient!.callToolByName(
                  scheduledToolCall.toolName,
                  scheduledToolCall.input,
                );
                return { content: mcpResult, isError: false };
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                return { content: `MCP tool error: ${msg}`, isError: true };
              }
            }

            if (useSandbox) {
              return activeSandboxBridge.runInSandbox(
                scheduledToolCall.input["command"] as string,
                (scheduledToolCall.input["timeout"] as number | undefined) ?? 120000,
              );
            }

            return executeTool(
              scheduledToolCall.toolName,
              scheduledToolCall.input,
              session.projectRoot,
              {
                sessionId: session.id,
                roundId: `round-${roundCounter}`,
                sandboxEnabled: false,
                selfImprovement: effectiveSelfImprovement ?? undefined,
                readTracker,
                editAttempts,
                subAgentExecutor: createSubAgentExecutor(session, config, {
                  durableRunId: durableRun.id,
                  workflowName,
                }, runAgentLoop),
                // Pass sandboxBridge into context so toolBash() can route through it
                // even when the tool scheduler doesn't take the useSandbox fast path.
                sandboxBridge: activeSandboxBridge,
              },
            );
          },
        },
      );

      if (schedulerResult?.record) {
        await durableRunStore.persistToolCallRecords(durableRun.id, [schedulerResult.record]);
      }

      if (!schedulerResult || !schedulerResult.executed || !schedulerResult.result) {
        const blockedReason = schedulerResult?.blockedReason ?? "Execution did not start.";
        if (schedulerResult?.record.status === "awaiting_approval") {
          await durableRunStore.persistPendingToolCalls(
            durableRun.id,
            toolCalls.slice(Math.max(toolIndex - 1, 0)).map((pendingToolCall) => ({
              id: pendingToolCall.id,
              name: pendingToolCall.name,
              input: pendingToolCall.input,
              dependsOn: pendingToolCall.dependsOn,
            })),
          );

          const approvalNotice =
            `Execution paused for durable run ${durableRun.id} because ${toolCall.name} requires approval. ` +
            `${blockedReason} Type continue or /resume ${durableRun.id} after approving the action.`;

          evidenceLedger.push({
            id: randomUUID(),
            kind: "blocked_action",
            success: false,
            label: `${toolCall.name} requires approval`,
            timestamp: new Date().toISOString(),
            command:
              typeof toolCall.input["command"] === "string" ? toolCall.input["command"] : undefined,
            filePath:
              typeof toolCall.input["file_path"] === "string"
                ? toolCall.input["file_path"]
                : undefined,
            sourceUrl:
              typeof toolCall.input["url"] === "string" ? toolCall.input["url"] : undefined,
            details: {
              reason: blockedReason,
              toolName: toolCall.name,
              toolCallId: toolCall.id,
            },
          });

          await durableRunStore.pauseRun(durableRun.id, {
            reason: "user_input_required",
            session,
            touchedFiles,
            lastConfirmedStep,
            lastSuccessfulTool,
            nextAction: "Approve the requested action and then continue the durable run.",
            message: approvalNotice,
            evidence: evidenceLedger,
          });

          session.messages.push({
            id: randomUUID(),
            role: "assistant",
            content: approvalNotice,
            timestamp: new Date().toISOString(),
          });

          if (localSandboxBridge) {
            await localSandboxBridge.shutdown();
          }

          return session;
        }
        if (!config.silent) {
          process.stdout.write(
            `\n${RED}[dtr] ${toolCall.name} blocked — ${blockedReason}${RESET}\n`,
          );
        }
        toolResults.push(`SYSTEM: ${toolCall.name} is blocked — ${blockedReason}.`);
        continue;
      }

      const result = schedulerResult.result;

      // Tool output truncation (opencode pattern): cap large outputs to avoid
      // blowing the context window. Truncate to 2000 lines / 50KB.
      const MAX_OUTPUT_LINES = 2000;
      const MAX_OUTPUT_BYTES = 50 * 1024;
      let outputContent = result.content;
      const outputLines = outputContent.split("\n");
      if (outputLines.length > MAX_OUTPUT_LINES) {
        outputContent =
          outputLines.slice(0, MAX_OUTPUT_LINES).join("\n") +
          `\n\n... (truncated, ${outputLines.length} total lines)`;
      }
      if (outputContent.length > MAX_OUTPUT_BYTES) {
        outputContent =
          outputContent.slice(0, MAX_OUTPUT_BYTES) +
          `\n\n... (truncated, ${result.content.length} total bytes)`;
      }

      // Track files written for DanteForge pipeline
      const writtenFile = getWrittenFilePath(toolCall.name, toolCall.input);
      if (writtenFile) {
        const resolvedPath = resolve(session.projectRoot, writtenFile);
        if (!touchedFiles.includes(resolvedPath)) {
          touchedFiles.push(resolvedPath);
        }
        if (!result.isError && (toolCall.name === "Write" || toolCall.name === "Edit")) {
          roundWrittenFiles.push(resolvedPath);
        }
        // Progress tracking: count files modified
        filesModified++;
      }

      // Progress tracking: count test runs (Bash commands that look like tests)
      if (toolCall.name === "Bash") {
        const cmd = (toolCall.input["command"] as string) || "";
        if (/\b(test|jest|vitest|mocha|pytest|cargo\s+test)\b/i.test(cmd)) {
          testsRun++;
        }
      }

      const evidence = buildExecutionEvidence(
        toolCall.name,
        toolCall.input,
        result,
        writtenFile ?? undefined,
      );
      evidenceLedger.push(evidence);
      if (!result.isError) {
        lastSuccessfulTool = toolCall.name;
        lastSuccessfulToolResult = outputContent.split("\n")[0] || undefined;
        lastConfirmedStep = writtenFile
          ? `Updated ${writtenFile}`
          : `Executed ${toolCall.name}${lastSuccessfulToolResult ? `: ${lastSuccessfulToolResult}` : ""}`;
      }

      // DTR Phase 2: Wrap raw result with structured evidence for verbose logging.
      const dtrResult = adaptToolResult(toolCall.name, toolCall.input, result, _toolStartMs);
      const evidenceSuffix = config.verbose ? formatEvidenceSummary(dtrResult) : "";

      // Show result summary (suppressed in silent mode)
      if (!config.silent) {
        if (result.isError) {
          process.stdout.write(`${RED}error${RESET}\n`);
          if (config.verbose) {
            process.stdout.write(`${DIM}${result.content.slice(0, 300)}${RESET}\n`);
          }
        } else {
          const preview = result.content.split("\n")[0] || "(success)";
          process.stdout.write(
            `${GREEN}ok${RESET} ${DIM}${preview.slice(0, 100)}${RESET}` +
              (evidenceSuffix ? ` ${DIM}${evidenceSuffix}${RESET}` : "") +
              "\n",
          );
        }
      }

      toolResults.push(`Tool "${toolCall.name}" result:\n${outputContent}`);

      if (schedulerResult.verificationMessage) {
        if (!config.silent) {
          process.stdout.write(
            `\n${RED}${schedulerResult.verificationMessage.split("\n")[0]}${RESET}\n`,
          );
        }
        toolResults.push(schedulerResult.verificationMessage);
      }

      // Record the tool call in the session
      const toolUseMessage: SessionMessage = {
        id: randomUUID(),
        role: "assistant",
        content: `Using tool: ${toolCall.name}`,
        timestamp: new Date().toISOString(),
        toolUse: {
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        },
      };
      session.messages.push(toolUseMessage);

      const toolResultMessage: SessionMessage = {
        id: randomUUID(),
        role: "tool",
        content: result.content,
        timestamp: new Date().toISOString(),
        toolResult: {
          toolUseId: toolCall.id,
          content: result.content,
          isError: result.isError,
        },
      };
      session.messages.push(toolResultMessage);

      const backgroundTaskId =
        !result.isError && toolCall.name === "SubAgent" && toolCall.input["background"] === true
          ? extractBackgroundTaskId(result.content)
          : null;

      if (backgroundTaskId) {
        lastConfirmedStep = `Launched background task ${backgroundTaskId}`;
        await durableRunStore.persistPendingToolCalls(
          durableRun.id,
          toolCalls.slice(toolIndex).map((pendingToolCall) => ({
            id: pendingToolCall.id,
            name: pendingToolCall.name,
            input: pendingToolCall.input,
            dependsOn: pendingToolCall.dependsOn,
          })),
        );
        const waitingNotice = formatBackgroundWaitNotice(durableRun.id, backgroundTaskId);
        await durableRunStore.pauseRun(durableRun.id, {
          reason: "user_input_required",
          session,
          touchedFiles,
          lastConfirmedStep,
          lastSuccessfulTool,
          nextAction: getBackgroundResumeNextAction(backgroundTaskId),
          message: waitingNotice,
          evidence: evidenceLedger,
        });

        session.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: waitingNotice,
          timestamp: new Date().toISOString(),
        });

        if (localSandboxBridge) {
          await localSandboxBridge.shutdown();
        }

        return session;
      }

      // Progress tracking: emit a progress line every PROGRESS_EMIT_INTERVAL tool calls
      if (toolCallsThisTurn > 0 && toolCallsThisTurn % PROGRESS_EMIT_INTERVAL === 0) {
        const progressLine = `[progress: ${toolCallsThisTurn} tool calls | ${filesModified} files modified | ${testsRun} tests run]`;
        process.stdout.write(`\n${DIM}${progressLine}${RESET}\n`);
        // Also inject a progress marker into the session for visibility
        session.messages.push({
          id: randomUUID(),
          role: "system" as "user",
          content: progressLine,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Reflection checkpoint: inject chain-of-thought reasoning prompt at intervals
    if (
      executedToolsThisTurn > 0 &&
      executedToolsThisTurn % REFLECTION_CHECKPOINT_INTERVAL === 0 &&
      maxToolRounds > 0
    ) {
      toolResults.push(`SYSTEM: ${REFLECTION_PROMPT}`);
      if (!config.silent) {
        process.stdout.write(
          `\n${DIM}[reflection checkpoint at ${executedToolsThisTurn} tool calls]${RESET}\n`,
        );
      }
    }

    // Clear silent mode progress line after tool loop
    if (config.silent && toolCalls.length > 0) {
      process.stdout.write(
        `\r${DIM}[${toolCalls.length}/${toolCalls.length} tools done]${RESET}\n`,
      );
    }

    if (isMajorEditBatch(roundWrittenFiles, session.projectRoot) && !roundMajorEditGateResult) {
      roundMajorEditGateResult = await runMajorEditBatchGate(
        session.id,
        session.projectRoot,
        roundCounter,
        config.selfImprovement,
        readTracker,
        editAttempts,
      );
      lastMajorEditGatePassed = roundMajorEditGateResult.passed;

      const summary = roundMajorEditGateResult.passed
        ? "SYSTEM: Repository-root verification passed for this major edit batch (typecheck, lint, test). Commits and merges may proceed."
        : `SYSTEM: Repository-root verification failed for this major edit batch (${roundMajorEditGateResult.failedSteps.join(", ")}). Do not commit or merge until those checks are green.`;
      toolResults.push(summary);

      if (!config.silent) {
        process.stdout.write(
          roundMajorEditGateResult.passed
            ? `\n${GREEN}[gstack: repo-root gate passed]${RESET}\n`
            : `\n${RED}[gstack: repo-root gate failed â€” ${roundMajorEditGateResult.failedSteps.join(", ")}]${RESET}\n`,
        );
      }
    }

    // Reflection loop (aider/Cursor pattern): after code edits, auto-run
    // the project's configured lint/test/build commands. If any fail,
    // parse the output into structured errors and inject a targeted fix
    // prompt so the model can fix specific issues instead of guessing.
    const wroteCode = toolCalls.some((tc) => tc.name === "Write" || tc.name === "Edit");
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

              if (consecutiveSameSignatureFailures >= 2) {
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
            process.stdout.write(`\n${GREEN}[verify: ${vc.name} OK]${RESET}\n`);
          }
        } catch {
          // Verification command failed to execute, skip
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
        });
        evidenceLedger.length = 0;
      }

      // Approach memory: record the outcome of this verification cycle
      if (verifyCommands.length > 0) {
        const approachDesc = currentApproachDescription || `approach-${approachLog.length + 1}`;
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
            .catch(() => {});
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
            .catch(() => {});

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
        } catch {
          // Synthesizer errors must not break the recovery loop
        }
      } else if (verificationPassed && config.verbose) {
        // Verification passed — emit a synthesizer "pass" signal in verbose mode
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
        } catch {
          // Ignore
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
    if (config.waveState && isWaveComplete(responseText) && maxToolRounds > 0) {
      const waveState = config.waveState;
      const completedWave = getCurrentWave(waveState);
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

    // ---- DanteMemory: retain tool round outcome for cross-session recall ----
    if (memoryInitialized && toolCalls.length > 0) {
      const touchedFilesList = touchedFiles
        .slice(0, 3)
        .map((f: string) => f.split("/").pop())
        .join(", ");
      const roundSummary = `Round ${roundCounter}: ${toolCalls.length} tool(s)${touchedFilesList ? ` | files: ${touchedFilesList}` : ""}`;
      if (secretsScanner.scan(roundSummary).clean) {
        memoryOrchestrator
          .memoryStore(`round-${roundCounter}-${session.id}`, roundSummary, "session", {
            source: session.id,
            summary: roundSummary,
            tags: ["round"],
          })
          .catch(() => {}); // fire-and-forget, non-fatal
      }
    }

    // Add tool results to messages for the next model call
    const assistantToolMessage = {
      role: "assistant" as const,
      content: responseText,
    };
    messages.push(assistantToolMessage);

    const toolResultsMessage = {
      role: "user" as const,
      content: `Tool execution results:\n\n${toolResults.join("\n\n---\n\n")}`,
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
      });
      evidenceLedger.length = 0;
    }

    // Record per-round latency metric
    metricsCollector.recordTiming("agent.round.latency", Date.now() - _roundStartMs);
  }

  // Diff-based anti-confabulation: compare claimed vs actual file changes (advisory)
  if (config.verbose && touchedFiles.length > 0) {
    const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
    if (lastAssistant) {
      const claimedFiles = extractClaimedFiles(lastAssistant.content);
      if (claimedFiles.length > 0) {
        const actualSet = new Set(touchedFiles.map((f) => f.replace(/\\/g, "/")));
        const unverified = claimedFiles.filter(
          (f: string) => !actualSet.has(f.replace(/\\/g, "/")),
        );
        if (unverified.length > 0) {
          process.stdout.write(
            `\n${YELLOW}[confab-diff] Model claimed changes to files not in actual write set: ${unverified.join(", ")}${RESET}\n`,
          );
        }
      }
    }
  }

  // Run DanteForge pipeline on touched files
  if (touchedFiles.length > 0) {
    process.stdout.write(`\n${CYAN}${BOLD}DanteForge Pipeline${RESET}\n`);

    for (const filePath of touchedFiles) {
      try {
        const content = await readFile(filePath, "utf-8");
        const { passed, summary } = await runDanteForge(
          content,
          filePath,
          session.projectRoot,
          config.verbose,
        );
        process.stdout.write(`\n${DIM}File: ${filePath}${RESET}\n${summary}\n`);

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
      } catch {
        process.stdout.write(`${DIM}Could not read ${filePath} for DanteForge analysis${RESET}\n`);
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
          typeof m.content === "string" ? m.content : m.content.map((b) => b.text || "").join("\n"),
      }));
    await detectAndRecordPatterns(conversationMessages, session.projectRoot);
  } catch {
    // Non-fatal: pattern detection failure should not break the session
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
    } catch {
      /* Non-fatal — artifact log is informational */
    }
  }

  await durableRunStore.completeRun(durableRun.id, {
    session,
    touchedFiles,
    lastConfirmedStep,
    lastSuccessfulTool,
    nextAction: "Run completed.",
    evidence: evidenceLedger,
  });

  if (localSandboxBridge) {
    await localSandboxBridge.shutdown();
  }

  // ---- PersistentMemory: store session summary for future recall ----
  if (filesModified > 0 || touchedFiles.length > 0) {
    try {
      const summary = `Session ${session.id}: ${durablePrompt.slice(0, 120)}. Files modified: ${filesModified}. Touched: ${touchedFiles.slice(0, 3).join(", ")}`;
      await sessionPersistentMemory.store(summary, "context", ["session"], session.id);
    } catch {
      // Non-fatal
    }
  }

  // ---- AutonomyEngine: persist goal state for next session ----
  try {
    await autonomyEngine.save();
  } catch {
    // Non-fatal
  }

  // ---- DanteGaslight: closed refinement loop + Skillbook bridge ----
  // When enabled (DANTECODE_GASLIGHT=1), detects trigger phrases in the user prompt,
  // runs a bounded critique→gate→rewrite loop using the current model router,
  // and persists sessions to disk. Lesson-eligible (PASS) sessions are surfaced
  // to the user for distillation via `dantecode gaslight bridge`.
  if (config.gaslight) {
    // Declared outside the gaslight try-block so the FearSet block below can read
    // the last iteration's gateScore as its verificationScore.
    let gaslightSession: Awaited<ReturnType<typeof config.gaslight.maybeGaslight>> = null;
    try {
      // Read draft from session.messages (durable), not local messages (LLM API array).
      // After a two-round loop the final response is pushed to session.messages then
      // the loop early-returns — local messages only has the first-round text.
      const lastSessionAssistant = session.messages.filter((m) => m.role === "assistant").pop();
      const lastDraft = !lastSessionAssistant
        ? undefined
        : typeof lastSessionAssistant.content === "string"
          ? lastSessionAssistant.content
          : lastSessionAssistant.content
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("");
      if (lastDraft) {
        // Fix 2: Closure variables capture the parsed critique from onCritique so the
        // gate can ask "does the rewrite address THIS critique?" rather than self-rating.
        let lastCritiqueSummary: string | undefined;
        // Fix B (structural pre-gate): capture the original draft at session start.
        // onGate receives each rewrite attempt; Jaccard overlap vs this baseline
        // is measured against an adaptive threshold derived from critique severity.
        const originalDraft = lastDraft;
        let lastCritiquePoints: string | undefined;
        // Fix 1+2: severity counts and full descriptions for adaptive threshold + bigram check.
        let lastCritiqueHighCount = 0;
        let lastCritiqueMedCount = 0;
        let lastCritiqueDescriptions: string[] = [];
        // Fix 5: low-severity tracking — previously bypassed all checks.
        let lastCritiqueLowCount = 0;
        let lastCritiqueLowDescriptions: string[] = [];

        gaslightSession = await config.gaslight.maybeGaslight({
          message: durablePrompt,
          draft: lastDraft,
          callbacks: {
            // Critique: ask the model to identify weaknesses in the draft.
            // Parses the JSON result and stashes summary + high/medium points for onGate.
            onCritique: async (sysPrompt: string, userPrompt: string) => {
              try {
                const raw = await router.generate(
                  [{ role: "user" as const, content: userPrompt }],
                  { maxTokens: 600, system: sysPrompt, taskType: "gaslight-critique" },
                );
                // Stash critique context for the gate (non-fatal if parse fails)
                try {
                  const jsonMatch = raw.match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]) as {
                      summary?: string;
                      points?: Array<{ severity?: string; description?: string }>;
                    };
                    if (typeof parsed.summary === "string") lastCritiqueSummary = parsed.summary;
                    if (Array.isArray(parsed.points)) {
                      lastCritiqueHighCount = parsed.points.filter(
                        (p) => p.severity === "high",
                      ).length;
                      lastCritiqueMedCount = parsed.points.filter(
                        (p) => p.severity === "medium",
                      ).length;
                      lastCritiqueLowCount = parsed.points.filter(
                        (p) => p.severity === "low",
                      ).length;
                      const highMedPoints = parsed.points.filter(
                        (p) => p.severity === "high" || p.severity === "medium",
                      );
                      lastCritiqueDescriptions = highMedPoints.map((p) => p.description ?? "");
                      lastCritiqueLowDescriptions = parsed.points
                        .filter((p) => p.severity === "low")
                        .map((p) => p.description ?? "");
                      const highMed = highMedPoints
                        .map((p) => `- ${p.description ?? ""}`)
                        .join("\n");
                      if (highMed) lastCritiquePoints = highMed;
                    }
                  }
                } catch {
                  /* non-fatal: gate falls back to self-rating prompt */
                }
                return raw;
              } catch {
                return null; // engine falls back to buildFallbackCritique
              }
            },
            // Critique-aware gate: deterministic structural checks then comparative LLM judgment.
            onGate: async (draft: string) => {
              try {
                // ── Structural pre-gate (deterministic — cannot be self-gamed) ──────────────
                // Four checks. Any failure → immediate "fail" (score: 0.2) with no LLM call.
                const structuralIssues: string[] = [];

                // Check 1 — Differentiation: rewrite must diverge meaningfully from original.
                // Threshold adapts to critique severity: more severe critique → lower threshold
                // (more divergence required). Range [0.72, 0.93].
                const jaccardThreshold = adaptiveJaccardThreshold(
                  lastCritiqueHighCount,
                  lastCritiqueMedCount,
                  lastCritiqueLowCount,
                );
                const overlap = jaccardWordOverlap(originalDraft, draft);
                if (overlap > jaccardThreshold) {
                  structuralIssues.push(
                    `Rewrite too similar to original (${(overlap * 100).toFixed(0)}% overlap > ${(jaccardThreshold * 100).toFixed(0)}% threshold)`,
                  );
                }

                // Check 2.5 — New vocabulary ratio (keyword stuffing detection).
                // Skipped for condensations (rewrite < 50% original token count) — condensing
                // a response is a valid improvement; the Jaccard check handles differentiation.
                {
                  const origTokensArr = originalDraft.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
                  const origTokenSet = new Set(origTokensArr);
                  const rewriteTokens = draft.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
                  if (rewriteTokens.length >= origTokensArr.length * 0.5) {
                    const newCount = rewriteTokens.filter((w) => !origTokenSet.has(w)).length;
                    const ratio = newCount / Math.max(1, rewriteTokens.length);
                    const minRatio = lastCritiqueHighCount > 0 ? 0.08 : 0.05;
                    if (ratio < minRatio) {
                      structuralIssues.push(
                        `Insufficient new vocabulary (${(ratio * 100).toFixed(1)}% new tokens < ${(minRatio * 100).toFixed(0)}% required)`,
                      );
                    }
                  }
                }

                // Check 3 — High/med bigram coverage (70% required).
                // Each critique point must have at least one 2-word phrase appear in the rewrite.
                if (lastCritiqueDescriptions.length > 0) {
                  const { covered, total } = checkBigramCoverage(lastCritiqueDescriptions, draft);
                  if (covered / total < 0.7) {
                    structuralIssues.push(
                      `Critique not addressed (${covered}/${total} points covered < 70% required)`,
                    );
                  }
                }

                // Check 4 — Low-severity bigram coverage (40% required).
                // Previously, all-low-severity critiques bypassed every structural check.
                // Advisory bar (40% vs 70%) reflects lower urgency of low-severity points.
                if (lastCritiqueLowDescriptions.length > 0) {
                  const { covered, total } = checkBigramCoverage(
                    lastCritiqueLowDescriptions,
                    draft,
                  );
                  if (covered / total < 0.4) {
                    structuralIssues.push(
                      `Low-severity critique ignored (${covered}/${total} low points covered < 40% required)`,
                    );
                  }
                }

                if (structuralIssues.length > 0) {
                  // Short-circuit: skip LLM gate entirely on structural failure.
                  return { decision: "fail" as const, score: 0.2 };
                }
                // ─────────────────────────────────────────────────────────────────────────────

                // ── ARCHITECTURAL LIMITATION ─────────────────────────────────────────────────
                // The gate evaluator is the same model family that wrote the original and the
                // rewrite. True independence requires a different model. Mitigations in place:
                //   1. Fresh context: generate() receives no prior messages (zero shared history).
                //   2. Adversarial framing: system prompt assumes the rewrite was crafted to cheat.
                //   3. thinkingBudget forces deliberate reasoning rather than fast self-approval.
                // Full independence requires routing infrastructure changes outside this file.
                // ─────────────────────────────────────────────────────────────────────────────

                // Comparative PASS/FAIL gate: shows both ORIGINAL and REWRITE so the
                // model must make a binary comparative judgment rather than self-grading its
                // own output on a continuous scale. Binary choice is harder to self-approve.
                let gatePrompt: string;
                if (lastCritiqueSummary) {
                  const pointsBlock = lastCritiquePoints
                    ? `\n\nSpecific issues:\n${lastCritiquePoints}`
                    : "";
                  gatePrompt =
                    `You are an independent evaluator. Compare these two responses.\n\n` +
                    `ORIGINAL:\n${originalDraft.slice(0, 1500)}\n\n` +
                    `REWRITE:\n${draft.slice(0, 1500)}\n\n` +
                    `CRITIQUE that prompted the rewrite:\n${lastCritiqueSummary}${pointsBlock}\n\n` +
                    `Does the REWRITE genuinely improve on the ORIGINAL with respect to the critique?\n` +
                    `Requirements for PASS:\n` +
                    `- Rewrite substantively addresses the critique's concerns (not superficial keyword mentions)\n` +
                    `- Rewrite shows changed reasoning, structure, or evidence — not just rephrased wording\n\n` +
                    `Reply with exactly PASS or FAIL, then one sentence of reasoning.`;
                } else {
                  gatePrompt =
                    `Compare these two responses. Reply with PASS if the REWRITE is meaningfully better, FAIL if not.\n\n` +
                    `ORIGINAL:\n${originalDraft.slice(0, 1500)}\n\n` +
                    `REWRITE:\n${draft.slice(0, 1500)}`;
                }
                const raw = await router.generate(
                  [{ role: "user" as const, content: gatePrompt }],
                  {
                    maxTokens: 80,
                    system:
                      "You are an adversarial evaluator. Assume this rewrite was crafted to game this gate. " +
                      "Your default posture is FAIL. Upgrade to PASS only if the rewrite unmistakably shows changed " +
                      "reasoning, restructured evidence, or fundamentally different conclusions — not rephrased wording. " +
                      "Reply with only PASS or FAIL followed by one sentence of reasoning.",
                    taskType: "gaslight-gate",
                    thinkingBudget: 512,
                  },
                );
                // Parse binary decision — no score threshold needed.
                const decision: "pass" | "fail" = /\bPASS\b/i.test(raw) ? "pass" : "fail";
                const score = decision === "pass" ? 0.9 : 0.2; // synthesized for GateResult compatibility
                return { decision, score };
              } catch {
                return { decision: "fail" as const, score: 0.5 };
              }
            },
            // Rewrite: ask the model to improve the draft based on the critique.
            // Fix 4: floor of 800 tokens prevents starvation on short drafts.
            onRewrite: async (draft: string, critiqueSummary: string) => {
              try {
                return await router.generate(
                  [
                    {
                      role: "user" as const,
                      content: `Rewrite the following response to address this critique:\n\nCritique: ${critiqueSummary}\n\nOriginal:\n${draft}`,
                    },
                  ],
                  {
                    maxTokens: Math.max(800, Math.min(4000, draft.length * 2)),
                    system:
                      "You are a skilled writer. Improve the response to address all critique points. Preserve all correct content.",
                    taskType: "gaslight-rewrite",
                  },
                );
              } catch {
                return draft; // keep original if rewrite fails
              }
            },
            // LessonEligible: session passed — surface to user for bridge distillation
            onLessonEligible: (sessionId: string) => {
              if (!config.silent) {
                process.stdout.write(
                  `\n${GREEN}[gaslight] PASS — session ${sessionId} is lesson-eligible. ` +
                    `Run ${BOLD}dantecode gaslight bridge${RESET}${GREEN} to distill to Skillbook.${RESET}\n`,
                );
              }
            },
          },
        });

        // Fix 1: Surface the rewrite when gaslight passes.
        // Injects the refined output back into session.messages so the conversation
        // continues from the improved version, and prints it to stdout.
        if (
          gaslightSession &&
          gaslightSession.stopReason === "pass" &&
          gaslightSession.finalOutput &&
          gaslightSession.finalOutput !== lastDraft
        ) {
          // Find last assistant SessionMessage using a backwards loop.
          // NOTE: findLastIndex is ES2023; tsconfig targets ES2022 — use for loop.
          let lastAssistantIdx = -1;
          for (let i = session.messages.length - 1; i >= 0; i--) {
            if (session.messages[i]?.role === "assistant") {
              lastAssistantIdx = i;
              break;
            }
          }
          if (lastAssistantIdx !== -1) {
            // Preserve id, timestamp, modelId etc — only replace the content.
            session.messages[lastAssistantIdx] = {
              ...session.messages[lastAssistantIdx]!,
              content: gaslightSession.finalOutput,
            };
          }
          if (!config.silent) {
            process.stdout.write(
              `\n${GREEN}${BOLD}[gaslight] Refined response:${RESET}\n` +
                gaslightSession.finalOutput +
                "\n",
            );
          }
        }

        if (gaslightSession && !config.silent) {
          process.stdout.write(
            `\n${CYAN}[gaslight] Session triggered (${gaslightSession.trigger.channel}): ` +
              `${gaslightSession.sessionId} — stop: ${gaslightSession.stopReason ?? "in-progress"}${RESET}\n`,
          );
        }
      }
    } catch {
      // Non-fatal: gaslight failure must never block the agent response
    }

    // ---- DanteFearSet: auto-trigger on high-risk tasks ----
    // Runs fear-setting (Define→Prevent→Repair+Benefits+Inaction) when the
    // message matches destructive/long-horizon/policy risk criteria.
    // Only fires when FearSet is explicitly enabled — disabled by default.
    try {
      if (config.gaslight.getFearSetConfig().enabled) {
        // verificationScore: gaslight gateScore when available (best signal, 0-1).
        // Falls back to retry-derived score so the weak-robustness channel fires
        // even when gaslight is disabled (the common case — disabled by default).
        // Formula: each verify retry reduces confidence below the 0.5 trigger threshold.
        //   1 retry → 0.35 (< 0.5, triggers weak-robustness channel)
        //   2 retries → 0.20
        //   3 retries → 0.05
        // Undefined only when gaslight off AND verification passed (no quality signal needed).
        const fearSetVerificationScore: number | undefined = gaslightSession?.iterations.length
          ? gaslightSession.iterations[gaslightSession.iterations.length - 1]?.gateScore
          : verifyRetries > 0
            ? Math.max(0, 0.5 - verifyRetries * 0.15)
            : undefined;

        // taskClass is intentionally not set here — the policy channel requires explicit
        // user configuration of policyTaskClasses in FearSet config. Agent-loop has no
        // reliable basis for inferring task classes that are only meaningful to
        // user-defined policy. The two-tier classifier handles destructive/long-horizon
        // patterns independently via its own channel logic.
        //
        // priorFailureCount: sessionFailureCount is the monotonic session-level failure count.
        // sameErrorCount resets on signature change — misses varied-error failure patterns.
        const fearSetPriorFailureCount = sessionFailureCount;

        const fearSetResult = await config.gaslight.maybeFearSet({
          message: durablePrompt,
          verificationScore: fearSetVerificationScore,
          priorFailureCount: fearSetPriorFailureCount,
          callbacks: {
            onClassify: async (message: string, rubricPrompt: string) => {
              try {
                return await router.generate(
                  [
                    {
                      role: "user" as const,
                      content: `${rubricPrompt}\n\nMessage to classify:\n${message}`,
                    },
                  ],
                  { maxTokens: 200, taskType: "fearset-classify" },
                );
              } catch {
                return null;
              }
            },
            onColumn: async (sysPrompt: string, userPrompt: string, _col: string) => {
              try {
                return await router.generate([{ role: "user" as const, content: userPrompt }], {
                  maxTokens: 1200,
                  system: sysPrompt,
                  taskType: "fearset-column",
                });
              } catch {
                return null;
              }
            },
            onGate: async (prompt: string) => {
              try {
                return await router.generate([{ role: "user" as const, content: prompt }], {
                  maxTokens: 400,
                  system: "Score this FearSet plan. Return JSON only.",
                  taskType: "fearset-gate",
                });
              } catch {
                return null;
              }
            },
            onSynthesize: async (columnsMarkdown: string) => {
              try {
                return await router.generate(
                  [
                    {
                      role: "user" as const,
                      content:
                        `Based on the following Fear-Setting analysis, produce a final go/no-go/conditional decision.\n\n` +
                        `Return ONLY this JSON (no markdown, no explanation):\n` +
                        `{"decision": "go"|"no-go"|"conditional", "reasoning": "2-3 sentences", "conditions": ["list", "of", "conditions"]}\n\n` +
                        columnsMarkdown,
                    },
                  ],
                  {
                    maxTokens: 400,
                    system:
                      "You are a decision synthesizer. Evaluate the Fear-Setting analysis and return a JSON go/no-go decision. Return JSON only.",
                    taskType: "fearset-synthesize",
                  },
                );
              } catch {
                return null;
              }
            },
            onComplete: (result) => {
              if (!config.silent && result.passed) {
                process.stdout.write(
                  `\n${GREEN}[fearset] PASS — run ${result.id} ready for distillation. ` +
                    `Run ${BOLD}dantecode fearset bridge${RESET}${GREEN} to write to Skillbook.${RESET}\n`,
                );
              } else if (!config.silent && !result.passed) {
                process.stdout.write(
                  `\n${RED}[fearset] FAIL — robustness ${result.robustnessScore?.overall.toFixed(2) ?? "n/a"} ` +
                    `(${result.robustnessScore?.gateDecision ?? "n/a"}). Review: dantecode fearset review${RESET}\n`,
                );
              }
            },
          },
        });

        // FearSet enforcement gate: when enabled, block on explicit user confirmation
        // if the analysis returns no-go. Default off — non-breaking for existing callers.
        // Non-TTY (CI/CD) is always non-blocking — guard prevents readline hangs.
        if (
          fearSetResult?.synthesizedRecommendation?.decision === "no-go" &&
          config.fearSetBlockOnNoGo === true &&
          !config.eventEmitter &&
          process.stdin.isTTY !== false
        ) {
          const reasoning = fearSetResult.synthesizedRecommendation.reasoning.slice(0, 120);
          const robustness = fearSetResult.robustnessScore?.overall.toFixed(2) ?? "n/a";
          const shouldProceed = await confirmDestructive(
            "Proceed despite FearSet NO-GO recommendation?",
            {
              operation: `FearSet analysis returned NO-GO (robustness: ${robustness})`,
              detail: reasoning,
            },
          );
          if (!shouldProceed) {
            if (!config.silent) {
              process.stdout.write(
                `\n${RED}[fearset] Aborted by user — FearSet NO-GO blocked this operation.${RESET}\n`,
              );
            }
            return session;
          }
        }

        if (fearSetResult && !config.silent) {
          process.stdout.write(
            `\n${CYAN}[fearset] Auto-triggered (${fearSetResult.trigger.channel}): ` +
              `${fearSetResult.id} — ${fearSetResult.passed ? "PASS" : "FAIL"}${RESET}\n`,
          );
        }
      }
    } catch {
      // Non-fatal: fearset failure must never block the agent response
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
    } catch {
      // Non-fatal
    }
  }
  // ---- debug-trail: flush session audit log ----
  try {
    await auditLogger.flush({ endSession: true });
  } catch {
    // Non-fatal
  }

  // Emit session-complete event for SSE clients in serve mode
  if (config.eventEmitter && config.eventSessionId) {
    const msgTokenEst = session.messages.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);
    config.eventEmitter.emitDone(config.eventSessionId, msgTokenEst, Date.now() - loopStartTime);
  }

  return session;
}
