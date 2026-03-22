// ============================================================================
// @dantecode/cli — Prompt Builder
// Extracted from agent-loop.ts: functions that assemble context and inject
// system messages into the conversation before and during the agent loop.
// ============================================================================

import type { AgentLoopConfig } from "./agent-loop.js";
import type { Session } from "@dantecode/config-types";
import {
  ApproachMemory,
  formatApproachesForPrompt,
  ReasoningChain,
  getCostMultiplier,
  AutonomyEngine,
  PersistentMemory,
  SecurityEngine,
  SecretsScanner,
  MetricsCollector,
  getContextUtilization,
} from "@dantecode/core";
import type { ReasoningTier } from "@dantecode/core";
import { createMemoryOrchestrator, type MemoryOrchestrator } from "@dantecode/memory-engine";
import { getGlobalLogger, type AuditLogger } from "@dantecode/debug-trail";
import { YELLOW, RED, DIM, RESET, PLANNING_INSTRUCTION } from "./agent-loop-constants.js";
import { compactMessages } from "./verification-pipeline.js";

// ---- Types ----

/** Message shape used by the agent loop. */
export interface LoopMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Result from pre-loop context assembly. */
export interface PreLoopContextResult {
  historicalFailures: string | undefined;
  reasoningChain: ReasoningChain;
  autonomyEngine: AutonomyEngine;
  sessionPersistentMemory: PersistentMemory;
  persistentApproachMemory: ApproachMemory;
  securityEngine: SecurityEngine;
  secretsScanner: SecretsScanner;
  memoryOrchestrator: MemoryOrchestrator;
  memoryInitialized: boolean;
  auditLogger: AuditLogger;
  metricsCollector: MetricsCollector;
}

/** Result from per-round context injection. */
export interface RoundContextResult {
  currentRoundTier: ReasoningTier;
  thinkingBudget: number | undefined;
}

// ---- Function 1: buildPreLoopContext ----

/**
 * Assembles all pre-loop context: approach memory, reasoning chain,
 * autonomy engine, persistent memory, security engine, DanteMemory
 * semantic recall, audit logger, and metrics collector.
 *
 * Pushes system messages into `messages` as a side effect.
 */
export async function buildPreLoopContext(
  durablePrompt: string,
  session: Session,
  config: AgentLoopConfig,
  messages: LoopMessage[],
): Promise<PreLoopContextResult> {
  // Persistent approach memory: load historical approaches for similar tasks
  const persistentApproachMemory = new ApproachMemory(session.projectRoot);
  let historicalFailures: string | undefined;
  try {
    const failed = await persistentApproachMemory.getFailedApproaches(durablePrompt, 5);
    if (failed.length > 0) {
      historicalFailures = formatApproachesForPrompt(failed);
    }
  } catch {
    // Non-fatal
  }

  // ---- Feature: ReasoningChain (tiered Think->Critique->Act) ----
  // Provides structured per-round thinking phases and PDSE-gated self-critique.
  const reasoningChain =
    config.replState?.reasoningChain ?? new ReasoningChain({ critiqueEveryNTurns: 5 });

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

  // ---- Security: per-session SecurityEngine + SecretsScanner ----
  // Instantiated once and reused across all rounds. SecurityEngine accumulates
  // action history for anomaly detection; SecretsScanner is stateless.
  const securityEngine = new SecurityEngine({ anomalyDetection: true });
  const secretsScanner = new SecretsScanner();

  // ---- DanteMemory: four-layer persistent memory ----
  // createMemoryOrchestrator is SYNCHRONOUS -- no await.
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

  // ---- Feature: Metrics collection ----
  // Per-session Prometheus-compatible metrics collector.
  // Records per-round latency for observability dashboards.
  const metricsCollector = new MetricsCollector();

  return {
    historicalFailures,
    reasoningChain,
    autonomyEngine,
    sessionPersistentMemory,
    persistentApproachMemory,
    securityEngine,
    secretsScanner,
    memoryOrchestrator,
    memoryInitialized,
    auditLogger,
    metricsCollector,
  };
}

// ---- Function 2: injectPlanningPhase ----

/**
 * Injects a planning instruction into messages when lexical complexity >= 0.7.
 * Also appends historical failures if available so the model avoids repeating them.
 */
export function injectPlanningPhase(
  messages: LoopMessage[],
  planningEnabled: boolean,
  lexicalComplexity: number,
  historicalFailures: string | undefined,
  silent: boolean,
): void {
  if (planningEnabled) {
    let planContent = `## Planning Required (complexity: ${lexicalComplexity.toFixed(2)})\n\n${PLANNING_INSTRUCTION}`;
    if (historicalFailures) {
      planContent += `\n\n## Previously Failed Approaches (from past sessions)\n${historicalFailures}\nAvoid repeating these failed strategies.`;
    }
    messages.push({
      role: "system" as const,
      content: planContent,
    });
    if (!silent) {
      process.stdout.write(
        `${DIM}[planning: enabled — complexity ${lexicalComplexity.toFixed(2)} >= 0.7]${RESET}\n`,
      );
    }
  }
}

// ---- Function 3: injectRoundContext ----

/**
 * Per-round context injection: compacts messages, reports context utilization,
 * triggers DanteMemory auto-compaction and auto-retain, runs ReasoningChain
 * tier decision with self-critique and auto-escalation, and runs AutonomyEngine
 * meta-reasoning.
 *
 * Returns the chosen reasoning tier and (possibly updated) thinking budget.
 */
export async function injectRoundContext(
  messages: LoopMessage[],
  ctx: {
    roundCounter: number;
    sameErrorCount: number;
    toolCallsThisTurn: number;
    filesModified: number;
    lastSuccessfulTool: string | undefined;
    lastConfirmedStep: string;
    durablePrompt: string;
    config: AgentLoopConfig;
    reasoningChain: ReasoningChain;
    autonomyEngine: AutonomyEngine;
    memoryOrchestrator: MemoryOrchestrator;
    memoryInitialized: boolean;
    secretsScanner: SecretsScanner;
    session: Session;
    thinkingBudget: number | undefined;
    lexicalComplexity: number;
  },
  emitOrWrite: (output: string) => void,
): Promise<RoundContextResult> {
  let thinkingBudget = ctx.thinkingBudget;

  // Context compaction (opencode/OpenHands pattern): condense old messages
  // when approaching the context window limit
  const compacted = compactMessages(messages, ctx.config.state.model.default.contextWindow);
  if (compacted.length < messages.length) {
    messages.splice(0, messages.length, ...compacted);
    if (ctx.config.verbose) {
      emitOrWrite(`${DIM}[context compacted: ${messages.length} messages remaining]${RESET}\n`);
    }
  }

  // Context utilization meter (WS5 Context Guardian)
  const ctxWindow = ctx.config.state.model.default.contextWindow;
  const utilization = getContextUtilization(
    messages.map((m) => ({ role: m.role, content: m.content })),
    ctxWindow,
  );
  if (!ctx.config.silent) {
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
  if (ctx.memoryInitialized && utilization.percent > 80) {
    try {
      const sumResult = await ctx.memoryOrchestrator.memorySummarize(ctx.session.id);
      if (sumResult.compressed && sumResult.summary) {
        const KEEP_RECENT = 8;
        const first = messages[0];
        const recent = messages.slice(-KEEP_RECENT);
        if (first && messages.length > KEEP_RECENT + 1) {
          const summaryMsg: LoopMessage = {
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
  if (ctx.memoryInitialized && ctx.roundCounter > 1) {
    try {
      const retainPayload: Record<string, unknown> = {
        round: ctx.roundCounter - 1,
        timestamp: new Date().toISOString(),
        filesModifiedTotal: ctx.filesModified,
        toolCallCount: ctx.toolCallsThisTurn,
      };
      if (ctx.lastSuccessfulTool) {
        retainPayload.lastTool = ctx.lastSuccessfulTool;
      }
      if (ctx.lastConfirmedStep) {
        retainPayload.lastStep = ctx.lastConfirmedStep;
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
      if (ctx.secretsScanner.scan(retainValue).clean) {
        await ctx.memoryOrchestrator.memoryStore(
          `round-${ctx.session.id}-${ctx.roundCounter - 1}`,
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
  let currentRoundTier: ReasoningTier;
  {
    let tier: ReasoningTier;
    const usedManualOverride = !!ctx.config.replState?.reasoningOverride;
    if (ctx.config.replState?.reasoningOverride) {
      tier = ctx.config.replState.reasoningOverride;
      if (!ctx.config.replState.reasoningOverrideSession) {
        ctx.config.replState.reasoningOverride = undefined;
      }
    } else {
      tier = ctx.reasoningChain.decideTier(ctx.lexicalComplexity, {
        errorCount: ctx.sameErrorCount,
        toolCalls: ctx.toolCallsThisTurn,
        costMultiplier: getCostMultiplier(ctx.config.state.model.default),
        // PRD S3.3: bias away from expensive tiers under sustained error pressure
        remainingBudget: ctx.sameErrorCount >= 4 ? 20000 : undefined,
      });
    }
    currentRoundTier = tier;
    if (ctx.config.replState) ctx.config.replState.reasoningChain = ctx.reasoningChain;
    // PRD S3.2: Override thinking budget when user manually set a tier
    if (usedManualOverride && thinkingBudget !== undefined) {
      const tierBudgets: Record<ReasoningTier, number> = {
        quick: 1024,
        deep: 4096,
        expert: 10240,
      };
      thinkingBudget = tierBudgets[tier];
      // PRD S3.2: sync lastThinkingBudget so /think shows the overridden budget
      if (ctx.config.replState) ctx.config.replState.lastThinkingBudget = thinkingBudget;
    }
    const thinkPhase = ctx.reasoningChain.think(ctx.durablePrompt, `round=${ctx.roundCounter}`, tier);
    ctx.reasoningChain.recordStep(thinkPhase);
    if (ctx.reasoningChain.shouldCritique()) {
      // P4-C1: Use same error-based PDSE proxy as recordTierOutcome (was hardcoded 0.8
      // which is always >= threshold 0.75, making shouldEscalate permanently false)
      const pdseProxy = ctx.sameErrorCount === 0 ? 0.9 : ctx.sameErrorCount <= 2 ? 0.75 : 0.6;
      const critiqueResult = ctx.reasoningChain.selfCritique(thinkPhase, pdseProxy);
      const critiquePhase = {
        type: "critique" as const,
        content: critiqueResult.recommendation,
        timestamp: new Date().toISOString(),
      };
      ctx.reasoningChain.recordStep(critiquePhase);
      // PRD S3.4: display auto-escalation event when score is below threshold
      if (critiqueResult.shouldEscalate) {
        const tierOrder: ReasoningTier[] = ["quick", "deep", "expert"];
        const currentIdx = tierOrder.indexOf(currentRoundTier);
        const escalateTo =
          currentIdx < tierOrder.length - 1 ? tierOrder[currentIdx + 1] : undefined;
        if (escalateTo) {
          process.stdout.write(
            `${DIM}[reasoning] Auto-escalated: ${currentRoundTier} → ${escalateTo} (PDSE: ${critiqueResult.score.toFixed(2)})${RESET}\n`,
          );
          currentRoundTier = escalateTo;
          tier = escalateTo;
          // P4-C2: sync thinkingBudget to escalated tier (was missing -- wrong budget after escalation)
          if (thinkingBudget !== undefined) {
            const tierBudgets: Record<ReasoningTier, number> = {
              quick: 1024,
              deep: 4096,
              expert: 10240,
            };
            thinkingBudget = tierBudgets[escalateTo];
            if (ctx.config.replState) ctx.config.replState.lastThinkingBudget = thinkingBudget;
          }
        }
      }
    }
    const chainText = ctx.reasoningChain.formatChainForPrompt(6);
    if (chainText) {
      messages.push({
        role: "system" as const,
        content: `## Reasoning Chain (ReasoningChain)\n${chainText}`,
      });
    }
  }

  // ---- AutonomyEngine: meta-reasoning pass (every 15 steps) ----
  ctx.autonomyEngine.incrementStep();
  if (ctx.autonomyEngine.shouldRunMetaReasoning()) {
    try {
      const metaResult = ctx.autonomyEngine.metaReason(
        `round=${ctx.roundCounter}, filesModified=${ctx.filesModified}`,
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

  return { currentRoundTier, thinkingBudget };
}
