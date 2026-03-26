// ============================================================================
// @dantecode/cli — Agent Interaction Loop
// The core loop that sends user prompts to the model, processes tool calls,
// runs the DanteForge pipeline on generated code, and streams responses.
// ============================================================================

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  ModelRouterImpl,
  detectSelfImprovementContext,
  promptRequestsToolExecution,
  responseNeedsToolExecutionNudge,
  parseVerificationErrors,
  formatErrorsForFixPrompt,
  computeErrorSignature,
  runStartupHealthCheck,
  getCurrentWave,
  advanceWave,
  globalArtifactStore,
  synthesizeConfidence,
  observeAndAdapt,
  applyOverrides,
  TaskComplexityRouter,
  verifyCompletion,
  deriveWaveExpectations,
  isValidWaveCompletion,
} from "@dantecode/core";
import type { WorkflowExecutionContext, WaveOrchestratorState } from "@dantecode/core";
import { buildWavePrompt } from "@dantecode/core";
import { recordSuccessPattern, detectAndRecordPatterns } from "@dantecode/danteforge";
import { runDanteForge } from "./danteforge-pipeline.js";
import { executeToolBatch } from "./tool-executor.js";
import { DanteGaslightIntegration } from "@dantecode/dante-gaslight";
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
  EXECUTION_WORKFLOW_PATTERN,
  PREMATURE_SUMMARY_PATTERN,
  GROK_CONFAB_PATTERN,
  MAX_PIPELINE_CONTINUATION_NUDGES,
  PIPELINE_CONTINUATION_INSTRUCTION,
  MAX_CONSECUTIVE_EMPTY_ROUNDS,
  MAX_CONFABULATION_NUDGES,
  EMPTY_RESPONSE_WARNING,
  CONFABULATION_WARNING,
} from "./agent-loop-constants.js";
import { type ExtractedToolCall, extractToolCalls } from "./tool-call-parser.js";
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
  /**
   * When true, write tools are actively gated (plan mode is in effect but
   * the plan has not yet been approved). Set by repl.ts from ReplState.
   */
  planModeActive?: boolean;
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

  // ---- Evidence Chain: session-scoped cryptographic audit trail ----
  const evidenceTracker: SessionEvidenceTracker = createSessionEvidenceTracker(session.id);

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
  // Wave deliverables verification: max retries per wave before force-advancing
  const MAX_WAVE_VERIFY_RETRIES = 2;
  let waveVerifyRetries = 0;
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

  // ---- Feature: Skill Discovery ----
  try {
    const discoveredEntries = await discoverSkills({ projectRoot: session.projectRoot });
    if (discoveredEntries.length > 0) {
      const reg = new SkillRegistry();
      reg.register(discoveredEntries);
      for (const col of reg.getCollisions()) {
        const scopes = col.entries.map((e) => e.scope).join(", ");
        process.stderr.write(`[SKILL-WARN] Skill collision: "${col.name}" in scopes: ${scopes}\n`);
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
  } catch {
    // Non-fatal — skill discovery never blocks a session
  }

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
              async ({ checkPromotedOverrides, getGlobalAdaptationRateLimiter, detectQuirks }) => {
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
          } catch {
            // Non-fatal — proceed with wave advancement
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

    // Execute tool batch (extracted to tool-executor.ts)
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
    currentApproachToolCalls = execResult.currentApproachToolCalls;
    lastConfirmedStep = execResult.lastConfirmedStep;
    lastSuccessfulTool = execResult.lastSuccessfulTool;
    lastSuccessfulToolResult = execResult.lastSuccessfulToolResult;
    lastMajorEditGatePassed = execResult.lastMajorEditGatePassed;
    localSandboxBridge = execResult.localSandboxBridge;
    testsRun = execResult.testsRun;
    bashSucceeded = execResult.bashSucceeded;
    const toolResults = execResult.toolResults;

    if (execResult.action === "return") {
      return session;
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

            // Evidence Chain: record verification failure receipt
            try {
              evidenceTracker.recordVerificationFailure(
                vc.name,
                vc.command,
                "", // errorSig computed below; basic receipt captures the failure event
                verifyRetries,
                MAX_VERIFY_RETRIES,
              );
            } catch {
              // Evidence recording is non-fatal
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

            // Evidence Chain: record verification pass receipt
            try {
              evidenceTracker.recordVerificationPass(vc.name, vc.command);
            } catch {
              // Evidence recording is non-fatal
            }

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
            const waveVerification = await verifyCompletion(session.projectRoot, waveExpectations);
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
        } catch {
          // Non-fatal — proceed with wave advancement
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

  // Diff-based anti-confabulation: compare claimed vs actual file changes.
  // Always runs (not verbose-only) — in pipeline mode, logs a red warning.
  if (touchedFiles.length > 0) {
    const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
    if (lastAssistant) {
      const claimedFiles = extractClaimedFiles(lastAssistant.content);
      if (claimedFiles.length > 0) {
        const actualSet = new Set(touchedFiles.map((f) => f.replace(/\\/g, "/")));
        const unverified = claimedFiles.filter(
          (f: string) => !actualSet.has(f.replace(/\\/g, "/")),
        );
        if (unverified.length > 0) {
          const color = isPipelineWorkflow ? RED : YELLOW;
          const tag = isPipelineWorkflow ? "confab-block" : "confab-diff";
          process.stdout.write(
            `\n${color}[${tag}] Model claimed changes to files not in actual write set: ${unverified.join(", ")}${RESET}\n`,
          );
          // In pipeline mode, append a retraction to the session transcript
          // so the model's false claims are corrected in the conversation history.
          if (isPipelineWorkflow) {
            session.messages.push({
              id: randomUUID(),
              role: "assistant",
              content: `WARNING: I claimed changes to ${unverified.length} file(s) that were not actually written: ${unverified.join(", ")}. These claims are retracted.`,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }
  }

  // Post-loop deliverables verification: verify expected files exist on disk.
  // For wave sessions, aggregate all wave expectations. For non-wave pipelines,
  // verify files claimed by the model. Non-fatal — logs result, does not crash.
  if (touchedFiles.length > 0) {
    try {
      let deliverableExpectedFiles: string[] = [];
      if (config.waveState) {
        // Aggregate expectations from all waves
        for (const wave of config.waveState.waves) {
          const waveExp = deriveWaveExpectations(wave);
          if (waveExp.expectedFiles) deliverableExpectedFiles.push(...waveExp.expectedFiles);
        }
      } else if (isPipelineWorkflow) {
        // Use claimed files from last assistant message
        const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
        if (lastAssistant) {
          deliverableExpectedFiles = extractClaimedFiles(lastAssistant.content);
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
    } catch {
      // Non-fatal
    }
  }

  // Run DanteForge pipeline on touched files
  if (touchedFiles.length > 0) {
    process.stdout.write(`\n${CYAN}${BOLD}DanteForge Pipeline${RESET}\n`);

    for (const filePath of touchedFiles) {
      try {
        const content = await readFile(filePath, "utf-8");
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
        } catch {
          // Evidence recording is non-fatal
        }

        // Trend tracker: record PDSE score for regression detection
        if (config.replState?.verificationTrendTracker) {
          config.replState.verificationTrendTracker.record("pdse", pdseScore);
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

  // ---- Evidence Chain: seal session and surface sealHash ----
  try {
    const sealConfig: Record<string, unknown> = {
      sessionId: session.id,
      modelId: config.state.model.default.modelId,
      provider: config.state.model.default.provider,
    };
    const seal = evidenceTracker.seal(sealConfig, filesModified, roundCounter);
    (session as unknown as Record<string, unknown>)._sealHash = seal.sealHash;
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
