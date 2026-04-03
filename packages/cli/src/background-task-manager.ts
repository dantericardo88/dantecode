// ============================================================================
// @dantecode/cli — Background Task Manager
// Manages background task lifecycle, sub-agent execution, and durable run
// resume logic. Extracted from agent-loop.ts for maintainability.
// ============================================================================

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { BackgroundTaskStore } from "@dantecode/core";
import type { Session } from "@dantecode/config-types";
import type { SubAgentExecutor, SubAgentOptions, SubAgentResult } from "./tools.js";
import type { AgentLoopConfig } from "./agent-loop.js";
import {
  EXECUTION_CONTINUATION_PATTERN,
  EXECUTION_WORKFLOW_PATTERN,
} from "./agent-loop-constants.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type BackgroundTaskRegistry = {
  pending: Map<string, Promise<SubAgentResult>>;
  store: BackgroundTaskStore;
};

export type RunAgentLoopFn = (
  prompt: string,
  session: Session,
  config: AgentLoopConfig,
) => Promise<Session>;

// ----------------------------------------------------------------------------
// Module State
// ----------------------------------------------------------------------------

export const backgroundTaskRegistries = new Map<string, BackgroundTaskRegistry>();
export const autoResumingDurableRuns = new Set<string>();

/** Per-lane AsyncLocalStorage context: isolates backgroundTaskRegistries per concurrent runAgentLoop invocation. */
export const _laneCtx = new AsyncLocalStorage<{ sessionId: string }>();

// ----------------------------------------------------------------------------
// Background Task Helpers
// ----------------------------------------------------------------------------

export function getBackgroundTaskRegistry(projectRoot: string): BackgroundTaskRegistry {
  const ctx = _laneCtx.getStore();
  const key = ctx ? `${ctx.sessionId}:${projectRoot}` : projectRoot;
  const existing = backgroundTaskRegistries.get(key);
  if (existing) {
    return existing;
  }

  const registry: BackgroundTaskRegistry = {
    pending: new Map<string, Promise<SubAgentResult>>(),
    store: new BackgroundTaskStore(projectRoot),
  };
  backgroundTaskRegistries.set(key, registry);
  return registry;
}

export function cloneSessionForBackgroundResume(session: Session): Session {
  return {
    ...session,
    messages: [...session.messages],
    activeFiles: [...session.activeFiles],
    readOnlyFiles: [...session.readOnlyFiles],
    agentStack: [...session.agentStack],
    todoList: [...session.todoList],
    updatedAt: new Date().toISOString(),
  };
}

export async function maybeAutoResumeDurableRunAfterBackgroundTask(params: {
  durableRunId?: string;
  workflowName?: string;
  parentSession: Session;
  parentConfig: AgentLoopConfig;
  runAgentLoopImpl?: RunAgentLoopFn;
  /** Reference to the actual runAgentLoop function (injected to avoid circular imports). */
  runAgentLoopFallback: RunAgentLoopFn;
}): Promise<boolean> {
  if (!params.durableRunId) {
    return false;
  }

  const resumeKey = `${params.parentSession.projectRoot}:${params.durableRunId}`;
  if (autoResumingDurableRuns.has(resumeKey)) {
    return false;
  }

  autoResumingDurableRuns.add(resumeKey);
  try {
    const resumeConfig: AgentLoopConfig = {
      ...params.parentConfig,
      runId: params.durableRunId,
      resumeFrom: params.durableRunId,
      expectedWorkflow: params.workflowName ?? params.parentConfig.expectedWorkflow,
      silent: true,
      onToken: undefined,
    };

    const resumeSession = cloneSessionForBackgroundResume(params.parentSession);
    const runAgentLoopImpl = params.runAgentLoopImpl ?? params.runAgentLoopFallback;
    await runAgentLoopImpl("continue", resumeSession, resumeConfig);
    return true;
  } finally {
    autoResumingDurableRuns.delete(resumeKey);
  }
}

export function extractBackgroundTaskId(text?: string): string | null {
  if (!text) {
    return null;
  }

  const explicitStart = text.match(/Background task started:\s*([a-z0-9-]+)/i);
  if (explicitStart?.[1]) {
    return explicitStart[1];
  }

  const genericMention = text.match(/background task\s+([a-z0-9-]+)/i);
  if (genericMention?.[1]) {
    return genericMention[1];
  }

  const statusHint = text.match(/status\s+([a-z0-9-]+)/i);
  return statusHint?.[1] ?? null;
}

export function formatBackgroundWaitNotice(
  runId: string,
  taskId: string,
  progress?: string,
): string {
  const detail = progress?.trim() ? ` ${progress.trim()}.` : "";
  return (
    `Background task ${taskId} is still running.${detail} ` +
    `Type continue or /resume ${runId} after it finishes.`
  );
}

export function getBackgroundResumeNextAction(taskId: string): string {
  return `Wait for background task ${taskId} to finish, then continue the durable run.`;
}

export function estimateBackgroundTaskDurationMs(task: {
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}): number {
  const start = task.startedAt ?? task.createdAt;
  const end = task.completedAt ?? task.startedAt ?? task.createdAt;
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

// ----------------------------------------------------------------------------
// Workflow Helpers
// ----------------------------------------------------------------------------

export function inferWorkflowName(prompt: string, config: AgentLoopConfig): string {
  if (config.expectedWorkflow) {
    return config.expectedWorkflow;
  }

  const slashMatch = prompt.trim().match(/^\/([a-z0-9-]+)/i);
  if (slashMatch?.[1]) {
    return slashMatch[1].toLowerCase();
  }

  return config.skillActive ? "skill" : "agent-loop";
}

export function buildResumePrompt(
  runId: string,
  hint: {
    summary?: string;
    lastConfirmedStep?: string;
    lastSuccessfulTool?: string;
    nextAction?: string;
  } | null,
  originalPrompt: string,
): string {
  const lines = [`Resuming durable run ${runId}.`];

  if (hint?.summary) {
    lines.push(`Previous status: ${hint.summary}`);
  }
  if (hint?.lastConfirmedStep) {
    lines.push(`Last confirmed step: ${hint.lastConfirmedStep}`);
  }
  if (hint?.lastSuccessfulTool) {
    lines.push(`Last successful tool: ${hint.lastSuccessfulTool}`);
  }
  if (hint?.nextAction) {
    lines.push(`Next action: ${hint.nextAction}`);
  }
  lines.push(
    originalPrompt.trim().length > 0 && !/^continue$/i.test(originalPrompt.trim())
      ? `User follow-up: ${originalPrompt.trim()}`
      : "Continue from the last confirmed step.",
  );

  return lines.join("\n");
}

export function isExecutionContinuationPrompt(prompt: string, session: Session): boolean {
  if (!EXECUTION_CONTINUATION_PATTERN.test(prompt.trim())) {
    return false;
  }

  const priorMessages = session.messages.slice(0, -1);
  return priorMessages.some((message) => {
    if (message.toolUse || message.toolResult) {
      return true;
    }
    // Detect skill activation system messages — any activated skill means
    // "continue" should be treated as an execution continuation.
    if (
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.startsWith('Activated skill "')
    ) {
      return true;
    }
    return (
      message.role === "user" &&
      typeof message.content === "string" &&
      EXECUTION_WORKFLOW_PATTERN.test(message.content.trim())
    );
  });
}

// ----------------------------------------------------------------------------
// Sub-Agent Executor
// ----------------------------------------------------------------------------

/**
 * Creates a sub-agent executor function that can be passed to the tool
 * execution context. The executor clones the parent session and runs
 * a fresh agent loop with constrained rounds.
 *
 * @param parentSession - The parent session to clone for the sub-agent.
 * @param parentConfig - The parent agent loop configuration.
 * @param runtime - Optional durable run context.
 * @param runAgentLoopFn - The runAgentLoop function (injected to avoid circular imports).
 */
export function createSubAgentExecutor(
  parentSession: Session,
  parentConfig: AgentLoopConfig,
  runtime:
    | {
        durableRunId?: string;
        workflowName?: string;
      }
    | undefined,
  runAgentLoopFn: RunAgentLoopFn,
): SubAgentExecutor {
  const backgroundRegistry = getBackgroundTaskRegistry(parentSession.projectRoot);
  const backgroundTasks = backgroundRegistry.pending;
  const backgroundTaskStore = backgroundRegistry.store;

  async function executeSubAgent(
    prompt: string,
    options?: SubAgentOptions,
  ): Promise<SubAgentResult> {
    const subSession = cloneSessionForBackgroundResume(parentSession);
    subSession.id = randomUUID();

    const isBackground = options?.background === true;
    const worktreeIsolation = options?.worktreeIsolation === true;

    let subProjectRoot = subSession.projectRoot;

    // Worktree isolation: create a temporary worktree for the sub-agent
    if (worktreeIsolation) {
      try {
        const { createWorktree } = await import("@dantecode/git-engine");
        const sessionId = `sub-${subSession.id.slice(0, 8)}`;
        const worktreeResult = createWorktree({
          directory: subSession.projectRoot,
          branch: `agent-${sessionId}`,
          baseBranch: "HEAD",
          sessionId,
        });
        subProjectRoot = worktreeResult.directory;
        subSession.projectRoot = subProjectRoot;
      } catch {
        // Worktree creation failed — fall back to running in the same directory
      }
    }

    const subConfig: AgentLoopConfig = {
      ...parentConfig,
      verbose: false,
      silent: true,
      onToken: undefined,
      abortSignal: undefined,
      requiredRounds: options?.maxRounds ?? 10,
      skillActive: false,
      waveState: undefined,
      runId: isBackground
        ? `bg-${subSession.id.slice(0, 8)}`
        : parentConfig.runId
          ? `sub-${parentConfig.runId}`
          : undefined,
    };

    const startTime = Date.now();
    const taskPromise = (async (): Promise<SubAgentResult> => {
      try {
        const resultSession = await runAgentLoopFn(prompt, subSession, subConfig);
        const lastAssistant = resultSession.messages.filter((m) => m.role === "assistant").pop();

        const touchedFiles: string[] = [];
        for (const msg of resultSession.messages) {
          if (msg.role === "assistant" && typeof msg.content === "string") {
            const writeMatches = msg.content.matchAll(/Successfully (?:wrote|edited) ([^\s(]+)/g);
            for (const match of writeMatches) {
              if (match[1]) touchedFiles.push(match[1]);
            }
          }
        }

        return {
          success: true,
          output: typeof lastAssistant?.content === "string" ? lastAssistant.content : "",
          touchedFiles,
          durationMs: Date.now() - startTime,
        };
      } catch (error: unknown) {
        return {
          success: false,
          output: error instanceof Error ? error.message : String(error),
          touchedFiles: [],
          durationMs: Date.now() - startTime,
        };
      } finally {
        // Clean up worktree if we created one
        if (worktreeIsolation && subProjectRoot !== parentSession.projectRoot) {
          try {
            const { removeWorktree } = await import("@dantecode/git-engine");
            removeWorktree(subProjectRoot);
          } catch {
            // Non-fatal: worktree cleanup failure
          }
        }
      }
    })();

    if (isBackground) {
      const taskId = subSession.id.slice(0, 8);
      backgroundTasks.set(taskId, taskPromise);

      // Record in persistent store
      const createdAt = new Date().toISOString();
      await backgroundTaskStore.saveTask({
        id: taskId,
        prompt,
        status: "running",
        createdAt,
        progress: "Background sub-agent is running",
        touchedFiles: [],
      });

      // Auto-resume durable run when background task completes
      taskPromise
        .then(async (result) => {
          await backgroundTaskStore.saveTask({
            id: taskId,
            prompt,
            status: result.success ? "completed" : "failed",
            createdAt,
            completedAt: new Date().toISOString(),
            output: result.output.slice(0, 2000),
            touchedFiles: result.touchedFiles,
            progress: result.success
              ? "Background sub-agent completed"
              : "Background sub-agent failed",
          });

          // Try to auto-resume the parent durable run
          if (runtime?.durableRunId) {
            await maybeAutoResumeDurableRunAfterBackgroundTask({
              durableRunId: runtime.durableRunId,
              workflowName: runtime.workflowName,
              parentSession,
              parentConfig,
              runAgentLoopFallback: runAgentLoopFn,
            });
          }
        })
        .catch(() => {
          // Background task error handling is non-fatal
        });

      return {
        success: true,
        output: `Background task started: ${taskId}. Use SubAgent with prompt "status ${taskId}" to check progress.`,
        touchedFiles: [],
        durationMs: 0,
      };
    }

    return taskPromise;
  }

  return executeSubAgent;
}
