// ============================================================================
// @dantecode/cli — Session Manager
// Extracted from agent-loop.ts to handle session resume logic and session-end
// persistence. Keeps the agent loop focused on the core interaction cycle.
// ============================================================================

import { randomUUID } from "node:crypto";
import {
  DurableRunStore,
  globalToolScheduler,
} from "@dantecode/core";
import type { PersistentMemory, AutonomyEngine } from "@dantecode/core";
import type {
  ExecutionEvidence,
  Session,
} from "@dantecode/config-types";
import type { ExtractedToolCall } from "./tool-call-parser.js";
import type { AgentLoopConfig } from "./agent-loop.js";
import type { SandboxBridge } from "./sandbox-bridge.js";
import {
  inferWorkflowName,
  buildResumePrompt,
  extractBackgroundTaskId,
  formatBackgroundWaitNotice,
  getBackgroundResumeNextAction,
  getBackgroundTaskRegistry,
} from "./background-task-manager.js";
import { EXECUTION_CONTINUATION_PATTERN } from "./agent-loop-constants.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Result of resolving a session resume attempt. */
export interface SessionResumeResult {
  /** The prompt to feed into the agent loop (may be rewritten for resume). */
  durablePrompt: string;
  /** Tool calls to replay from a prior paused run. */
  replayToolCalls: ExtractedToolCall[];
  /** Durable run ID (resolved from config or resume target). */
  durableRunId: string | undefined;
  /** Inferred or restored workflow name. */
  workflowName: string | undefined;
  /** The session — may be replaced by a snapshot from the durable store. */
  session: Session;
  /** When true, the caller should `return session` immediately (background task still running). */
  earlyReturn: boolean;
  /** The DurableRunStore instance for the remainder of the loop. */
  durableRunStore: DurableRunStore;
}

/** Context required to persist session-end state. */
export interface PersistSessionEndContext {
  durableRunStore: DurableRunStore;
  durableRun: { id: string };
  session: Session;
  touchedFiles: string[];
  lastConfirmedStep: string;
  lastSuccessfulTool: string | undefined;
  evidenceLedger: ExecutionEvidence[];
  localSandboxBridge: SandboxBridge | null;
  filesModified: number;
  durablePrompt: string;
  sessionPersistentMemory: PersistentMemory;
  autonomyEngine: AutonomyEngine;
}

// ----------------------------------------------------------------------------
// Function 1: resolveSessionResume
// ----------------------------------------------------------------------------

/**
 * Resolves whether the current prompt is a session resume / continuation,
 * loads the prior durable run snapshot and pending tool calls when applicable,
 * and handles the "background task still running" early-return path.
 */
export async function resolveSessionResume(
  prompt: string,
  session: Session,
  config: AgentLoopConfig,
): Promise<SessionResumeResult> {
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

          return {
            durablePrompt,
            replayToolCalls,
            durableRunId,
            workflowName,
            session,
            earlyReturn: true,
            durableRunStore,
          };
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

  return {
    durablePrompt,
    replayToolCalls,
    durableRunId,
    workflowName,
    session,
    earlyReturn: false,
    durableRunStore,
  };
}

// ----------------------------------------------------------------------------
// Function 2: persistSessionEnd
// ----------------------------------------------------------------------------

/**
 * Persists session-end state: completes the durable run, shuts down the
 * sandbox bridge, stores a PersistentMemory summary, and saves AutonomyEngine
 * goal state for the next session.
 */
export async function persistSessionEnd(ctx: PersistSessionEndContext): Promise<void> {
  await ctx.durableRunStore.completeRun(ctx.durableRun.id, {
    session: ctx.session,
    touchedFiles: ctx.touchedFiles,
    lastConfirmedStep: ctx.lastConfirmedStep,
    lastSuccessfulTool: ctx.lastSuccessfulTool,
    nextAction: "Run completed.",
    evidence: ctx.evidenceLedger,
  });

  if (ctx.localSandboxBridge) {
    await ctx.localSandboxBridge.shutdown();
  }

  // ---- PersistentMemory: store session summary for future recall ----
  if (ctx.filesModified > 0 || ctx.touchedFiles.length > 0) {
    try {
      const summary = `Session ${ctx.session.id}: ${ctx.durablePrompt.slice(0, 120)}. Files modified: ${ctx.filesModified}. Touched: ${ctx.touchedFiles.slice(0, 3).join(", ")}`;
      await ctx.sessionPersistentMemory.store(summary, "context", ["session"], ctx.session.id);
    } catch {
      // Non-fatal
    }
  }

  // ---- AutonomyEngine: persist goal state for next session ----
  try {
    await ctx.autonomyEngine.save();
  } catch {
    // Non-fatal
  }
}
