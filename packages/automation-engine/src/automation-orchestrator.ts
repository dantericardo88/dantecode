import { randomUUID } from "node:crypto";
import { readFile as readFileFromFs } from "node:fs/promises";
import * as path from "node:path";
import type { PDSEScore } from "@dantecode/config-types";
import {
  appendAuditEvent,
  BackgroundAgentRunner,
  EventSourcedCheckpointer,
  RecoveryEngine,
  type AuditEventInput,
  type RepoRootVerificationResult,
} from "@dantecode/core";
import { runLocalPDSEScorer } from "@dantecode/danteforge";
import {
  createAutoPR,
  GitAutomationStore,
  type AutoPROptions,
  type PRResult,
  type StoredAutomationExecutionRecord,
  type StoredAutomationTrigger,
} from "@dantecode/git-engine";
import { getStatus, type GitStatusResult } from "@dantecode/git-engine";
import type { WorkflowOptions, WorkflowResult } from "@dantecode/git-engine";
import { runLocalWorkflow } from "@dantecode/git-engine";
import { runAutomationAgent, PDSE_GATE_THRESHOLD } from "./automation-agent-bridge.js";
import type { AgentBridgeConfig, AgentBridgeResult } from "./automation-agent-bridge.js";

export type AutomationTrigger = StoredAutomationTrigger;

export interface WorkflowBackgroundRequest {
  workflowPath: string;
  eventPayload?: Record<string, unknown>;
  options?: WorkflowOptions;
  trigger?: AutomationTrigger;
  /** When set, triggers a full agent session instead of a shell workflow. */
  agentMode?: {
    prompt: string;
    model?: string;
    sandboxMode?: string;
    verifyOutput?: boolean;
    maxRounds?: number;
  };
}

export interface AutoPullRequestRequest {
  title: string;
  body?: string;
  options?: AutoPROptions;
  changesetFiles?: string[];
  trigger?: AutomationTrigger;
}

export interface QueuedAutomationRun {
  executionId: string;
  backgroundTaskId: string;
}

export interface GitAutomationOrchestratorOptions {
  projectRoot: string;
  sessionId?: string;
  modelId?: string;
  maxConcurrent?: number;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  runWorkflow?: (request: WorkflowBackgroundRequest) => Promise<WorkflowResult>;
  createAutoPR?: (request: AutoPullRequestRequest) => Promise<PRResult>;
  readStatus?: (projectRoot: string) => GitStatusResult;
  readFile?: (filePath: string) => Promise<string>;
  scoreContent?: (content: string, projectRoot: string) => PDSEScore;
  verifyRepo?: (projectRoot: string) => RepoRootVerificationResult;
  auditLogger?: (projectRoot: string, event: AuditEventInput) => Promise<unknown>;
  runAgent?: (
    config: AgentBridgeConfig,
    triggerContext: Record<string, unknown>,
  ) => Promise<AgentBridgeResult>;
  /** Override the default PDSE + repo-verification gate. Useful for tests and custom policies. */
  gateEvaluator?: GateEvaluator;
}

interface WorkflowWorkItem {
  executionId: string;
  kind: "workflow";
  request: WorkflowBackgroundRequest;
}

interface AutoPRWorkItem {
  executionId: string;
  kind: "auto_pr";
  request: AutoPullRequestRequest;
}

type AutomationWorkItem = WorkflowWorkItem | AutoPRWorkItem;

export interface GateEvaluationResult {
  gateStatus: StoredAutomationExecutionRecord["gateStatus"];
  modifiedFiles: string[];
  pdseScore?: number;
  repoVerificationPassed?: boolean;
  error?: string;
}

/**
 * Injectable gate evaluator interface.
 *
 * Implement this to replace the default PDSE + repo-verification gate logic.
 * Useful for tests (instant deterministic responses) and for custom gate policies.
 */
export interface GateEvaluator {
  evaluate(
    executionId: string,
    modifiedFiles: string[],
    trigger: AutomationTrigger | undefined,
  ): Promise<GateEvaluationResult>;
}

const TERMINAL_EXECUTION_STATUSES = new Set<StoredAutomationExecutionRecord["status"]>([
  "completed",
  "failed",
  "blocked",
]);

export class GitAutomationOrchestrator {
  private readonly projectRoot: string;
  private readonly sessionId: string;
  private readonly modelId: string;
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly store: GitAutomationStore;
  private readonly runner: BackgroundAgentRunner;
  private readonly runWorkflowImpl: (request: WorkflowBackgroundRequest) => Promise<WorkflowResult>;
  private readonly createAutoPRImpl: (request: AutoPullRequestRequest) => Promise<PRResult>;
  private readonly readStatusImpl: (projectRoot: string) => GitStatusResult;
  private readonly readFileImpl: (filePath: string) => Promise<string>;
  private readonly scoreContentImpl: (content: string, projectRoot: string) => PDSEScore;
  private readonly verifyRepoImpl: (projectRoot: string) => RepoRootVerificationResult;
  private readonly auditLoggerImpl: (
    projectRoot: string,
    event: AuditEventInput,
  ) => Promise<unknown>;
  private readonly runAgentImpl: (
    config: AgentBridgeConfig,
    triggerContext: Record<string, unknown>,
  ) => Promise<AgentBridgeResult>;
  private readonly taskToExecutionId = new Map<string, string>();
  private readonly gateEvaluatorOverride: GateEvaluator | undefined;

  constructor(options: GitAutomationOrchestratorOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.sessionId = options.sessionId ?? "git-automation";
    this.modelId = options.modelId ?? "git-engine";
    this.waitTimeoutMs = options.waitTimeoutMs ?? 15_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 50;
    this.store = new GitAutomationStore(this.projectRoot);
    this.runner = new BackgroundAgentRunner(options.maxConcurrent ?? 4, this.projectRoot);
    this.runWorkflowImpl =
      options.runWorkflow ??
      ((request) =>
        runLocalWorkflow(request.workflowPath, request.eventPayload, {
          ...request.options,
          cwd: request.options?.cwd ?? this.projectRoot,
        }));
    this.createAutoPRImpl =
      options.createAutoPR ??
      ((request) =>
        createAutoPR(request.title, request.body, {
          ...request.options,
          cwd: request.options?.cwd ?? this.projectRoot,
          changesetFiles: request.changesetFiles,
        }));
    this.readStatusImpl = options.readStatus ?? getStatus;
    this.readFileImpl = options.readFile ?? ((filePath) => readFileFromFs(filePath, "utf-8"));
    this.scoreContentImpl = options.scoreContent ?? runLocalPDSEScorer;
    this.verifyRepoImpl =
      options.verifyRepo ??
      ((projectRoot) => new RecoveryEngine().runRepoRootVerification(projectRoot));
    this.auditLoggerImpl = options.auditLogger ?? appendAuditEvent;
    this.runAgentImpl = options.runAgent ?? runAutomationAgent;
    this.gateEvaluatorOverride = options.gateEvaluator;
    this.runner.setWorkFn(
      async (
        prompt: string,
        onProgress: (msg: string) => void,
        context: { task: { id: string } },
      ) => this.executeWorkItem(prompt, onProgress, context.task.id),
    );
  }

  async runWorkflowInBackground(request: WorkflowBackgroundRequest): Promise<QueuedAutomationRun> {
    return this.enqueueWorkItem({
      executionId: randomUUID().slice(0, 12),
      kind: "workflow",
      request,
    });
  }

  async runWorkflow(request: WorkflowBackgroundRequest): Promise<StoredAutomationExecutionRecord> {
    const queued = await this.runWorkflowInBackground(request);
    return this.waitForExecution(queued.executionId);
  }

  async runAutoPRInBackground(request: AutoPullRequestRequest): Promise<QueuedAutomationRun> {
    return this.enqueueWorkItem({
      executionId: randomUUID().slice(0, 12),
      kind: "auto_pr",
      request,
    });
  }

  async createPullRequest(
    request: AutoPullRequestRequest,
  ): Promise<StoredAutomationExecutionRecord> {
    const queued = await this.runAutoPRInBackground(request);
    return this.waitForExecution(queued.executionId);
  }

  async getExecution(executionId: string): Promise<StoredAutomationExecutionRecord | null> {
    const executions = await this.store.listAutomationExecutions();
    return executions.find((entry) => entry.id === executionId) ?? null;
  }

  async listExecutions(): Promise<StoredAutomationExecutionRecord[]> {
    return this.store.listAutomationExecutions();
  }

  async waitForExecution(executionId: string): Promise<StoredAutomationExecutionRecord> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < this.waitTimeoutMs) {
      const execution = await this.getExecution(executionId);
      if (execution && TERMINAL_EXECUTION_STATUSES.has(execution.status)) {
        const remainingMs = Math.max(0, this.waitTimeoutMs - (Date.now() - startedAt));
        const task =
          execution.backgroundTaskId && remainingMs > 0
            ? await this.runner.waitForTask(execution.backgroundTaskId, remainingMs)
            : execution.backgroundTaskId
              ? null
              : undefined;

        if (!execution.backgroundTaskId || task) {
          return execution;
        }
      }
      await delay(this.pollIntervalMs);
    }

    throw new Error(`Timed out waiting for automation execution ${executionId}`);
  }

  private async enqueueWorkItem(workItem: AutomationWorkItem): Promise<QueuedAutomationRun> {
    const now = new Date().toISOString();
    const backgroundTaskId = this.runner.enqueue(JSON.stringify(workItem), { longRunning: true });
    this.taskToExecutionId.set(backgroundTaskId, workItem.executionId);

    await this.store.upsertAutomationExecution({
      id: workItem.executionId,
      kind: workItem.kind,
      cwd: this.projectRoot,
      status: "queued",
      gateStatus: "pending",
      createdAt: now,
      updatedAt: now,
      backgroundTaskId,
      ...(workItem.kind === "workflow" ? { workflowPath: workItem.request.workflowPath } : {}),
      ...(workItem.kind === "auto_pr" ? { title: workItem.request.title } : {}),
      ...(workItem.request.trigger ? { trigger: workItem.request.trigger } : {}),
      modifiedFiles: [],
    });

    return {
      executionId: workItem.executionId,
      backgroundTaskId,
    };
  }

  private async executeWorkItem(
    prompt: string,
    onProgress: (message: string) => void,
    backgroundTaskId: string,
  ): Promise<{ output: string; touchedFiles: string[] }> {
    const workItem = JSON.parse(prompt) as AutomationWorkItem;
    const checkpointSessionId = `git-automation-${workItem.executionId}`;
    const checkpointer = new EventSourcedCheckpointer(this.projectRoot, checkpointSessionId);
    const startedAt = new Date().toISOString();

    await checkpointer.put(
      {
        executionId: workItem.executionId,
        kind: workItem.kind,
        status: "running",
      },
      {
        source: "input",
        step: 0,
        triggerCommand: workItem.kind === "workflow" ? "run_github_workflow" : "auto_pr_create",
      },
    );

    await this.updateExecution(workItem.executionId, {
      status: "running",
      updatedAt: startedAt,
      startedAt,
      backgroundTaskId,
      checkpointSessionId,
    });
    await this.appendAutomationAudit("git_automation_run", workItem.executionId, {
      kind: workItem.kind,
      status: "running",
      trigger: workItem.request.trigger,
    });

    try {
      if (workItem.kind === "workflow") {
        return await this.executeWorkflowRun(workItem, checkpointer, onProgress);
      }
      return await this.executeAutoPRRun(workItem, checkpointer, onProgress);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const completedAt = new Date().toISOString();

      await checkpointer.putWrite({
        taskId: workItem.executionId,
        channel: "error",
        value: message,
        timestamp: completedAt,
      });
      await checkpointer.put(
        {
          executionId: workItem.executionId,
          kind: workItem.kind,
          status: "failed",
          error: message,
        },
        {
          source: "update",
          step: 2,
        },
      );

      await this.updateExecution(workItem.executionId, {
        status: "failed",
        updatedAt: completedAt,
        completedAt,
        error: message,
        gateStatus: "failed",
      });
      await this.appendAutomationAudit("git_automation_run", workItem.executionId, {
        kind: workItem.kind,
        status: "failed",
        error: message,
      });

      return {
        output: message,
        touchedFiles: [],
      };
    }
  }

  private async executeWorkflowRun(
    workItem: WorkflowWorkItem,
    checkpointer: EventSourcedCheckpointer,
    onProgress: (message: string) => void,
  ): Promise<{ output: string; touchedFiles: string[] }> {
    // Agent-mode: delegate to agent bridge instead of shell workflow
    if (workItem.request.agentMode) {
      const ctx: Record<string, unknown> = {
        ...((workItem.request.eventPayload as Record<string, unknown>) ?? {}),
        projectRoot: this.projectRoot,
        workflowPath: workItem.request.workflowPath,
      };
      const bridgeResult = await this.runAgentImpl(
        {
          prompt: workItem.request.agentMode.prompt,
          model: workItem.request.agentMode.model,
          sandboxMode: workItem.request.agentMode.sandboxMode,
          verifyOutput: workItem.request.agentMode.verifyOutput ?? true,
          maxRounds: workItem.request.agentMode.maxRounds ?? 30,
          projectRoot: this.projectRoot,
        },
        ctx,
      );
      onProgress(
        `Agent ${bridgeResult.sessionId}: ${bridgeResult.success ? "completed" : "failed"}`,
      );
      const completedAt = new Date().toISOString();
      const status: StoredAutomationExecutionRecord["status"] = bridgeResult.success
        ? "completed"
        : "failed";
      const gateStatus: StoredAutomationExecutionRecord["gateStatus"] =
        bridgeResult.pdseScore !== undefined
          ? bridgeResult.pdseScore >= PDSE_GATE_THRESHOLD
            ? "passed"
            : "failed"
          : "skipped";
      await checkpointer.put(
        { executionId: workItem.executionId, kind: workItem.kind, status, gateStatus },
        { source: "update", step: 1 },
      );
      await this.updateExecution(workItem.executionId, {
        status,
        updatedAt: completedAt,
        completedAt,
        gateStatus,
        modifiedFiles: bridgeResult.filesChanged,
        ...(bridgeResult.pdseScore !== undefined ? { pdseScore: bridgeResult.pdseScore } : {}),
        summary: bridgeResult.output.slice(0, 200),
        ...(bridgeResult.error ? { error: bridgeResult.error } : {}),
      });
      await this.appendAutomationAudit("git_automation_run", workItem.executionId, {
        kind: workItem.kind,
        status,
        sessionId: bridgeResult.sessionId,
        filesChanged: bridgeResult.filesChanged,
      });
      return { output: bridgeResult.output, touchedFiles: bridgeResult.filesChanged };
    }

    const beforeStatus = this.readStatusImpl(this.projectRoot);
    onProgress(`Running workflow ${workItem.request.workflowPath}`);

    const workflowResult = await this.runWorkflowImpl(workItem.request);
    await checkpointer.putWrite({
      taskId: workItem.executionId,
      channel: "workflow_result",
      value: {
        workflowName: workflowResult.workflowName,
        success: workflowResult.success,
        totalDurationMs: workflowResult.totalDurationMs,
      },
      timestamp: new Date().toISOString(),
    });

    const afterStatus = this.readStatusImpl(this.projectRoot);
    const gate = await this.evaluateWorkflowGate(
      workItem.executionId,
      beforeStatus,
      afterStatus,
      workItem.request.trigger,
    );

    const completedAt = new Date().toISOString();
    const status: StoredAutomationExecutionRecord["status"] = workflowResult.success
      ? gate.gateStatus === "failed"
        ? "blocked"
        : "completed"
      : "failed";
    const summary = workflowResult.success
      ? `Workflow ${workflowResult.workflowName} finished`
      : `Workflow ${workflowResult.workflowName} failed`;

    await checkpointer.put(
      {
        executionId: workItem.executionId,
        kind: workItem.kind,
        status,
        workflowName: workflowResult.workflowName,
        gateStatus: gate.gateStatus,
        modifiedFiles: gate.modifiedFiles,
      },
      {
        source: "update",
        step: 1,
      },
    );

    await this.updateExecution(workItem.executionId, {
      status,
      updatedAt: completedAt,
      completedAt,
      workflowName: workflowResult.workflowName,
      gateStatus: gate.gateStatus,
      modifiedFiles: gate.modifiedFiles,
      ...(gate.pdseScore !== undefined ? { pdseScore: gate.pdseScore } : {}),
      ...(gate.repoVerificationPassed !== undefined
        ? { repoVerificationPassed: gate.repoVerificationPassed }
        : {}),
      summary,
      ...(workflowResult.success ? {} : { error: firstWorkflowError(workflowResult) }),
    });
    await this.appendAutomationAudit("git_automation_run", workItem.executionId, {
      kind: workItem.kind,
      status,
      workflowName: workflowResult.workflowName,
      gateStatus: gate.gateStatus,
      modifiedFiles: gate.modifiedFiles,
    });

    return {
      output: summary,
      touchedFiles: gate.modifiedFiles,
    };
  }

  private async executeAutoPRRun(
    workItem: AutoPRWorkItem,
    checkpointer: EventSourcedCheckpointer,
    onProgress: (message: string) => void,
  ): Promise<{ output: string; touchedFiles: string[] }> {
    const candidateFiles =
      workItem.request.changesetFiles && workItem.request.changesetFiles.length > 0
        ? workItem.request.changesetFiles
        : collectStatusFiles(this.readStatusImpl(this.projectRoot));
    const gate = await this.evaluateGateForFiles(
      workItem.executionId,
      candidateFiles,
      workItem.request.trigger,
    );

    if (gate.gateStatus === "failed") {
      const completedAt = new Date().toISOString();
      const blockedReason = gate.error ?? "Automated Git write blocked by verification gates.";
      await checkpointer.put(
        {
          executionId: workItem.executionId,
          kind: workItem.kind,
          status: "blocked",
          gateStatus: gate.gateStatus,
          modifiedFiles: gate.modifiedFiles,
        },
        {
          source: "update",
          step: 1,
        },
      );
      await this.updateExecution(workItem.executionId, {
        status: "blocked",
        updatedAt: completedAt,
        completedAt,
        gateStatus: gate.gateStatus,
        modifiedFiles: gate.modifiedFiles,
        ...(gate.pdseScore !== undefined ? { pdseScore: gate.pdseScore } : {}),
        ...(gate.repoVerificationPassed !== undefined
          ? { repoVerificationPassed: gate.repoVerificationPassed }
          : {}),
        error: blockedReason,
        summary: "Automated pull request blocked",
      });
      await this.appendAutomationAudit("git_automation_run", workItem.executionId, {
        kind: workItem.kind,
        status: "blocked",
        title: workItem.request.title,
        gateStatus: gate.gateStatus,
      });

      return {
        output: blockedReason,
        touchedFiles: gate.modifiedFiles,
      };
    }

    onProgress(`Creating pull request ${workItem.request.title}`);
    const result = await this.createAutoPRImpl(workItem.request);
    const completedAt = new Date().toISOString();
    const status: StoredAutomationExecutionRecord["status"] = result.success
      ? "completed"
      : "failed";
    const summary = result.success
      ? `Pull request automation finished for ${workItem.request.title}`
      : `Pull request automation failed for ${workItem.request.title}`;

    await checkpointer.putWrite({
      taskId: workItem.executionId,
      channel: "auto_pr_result",
      value: {
        success: result.success,
        prUrl: result.prUrl,
      },
      timestamp: completedAt,
    });
    await checkpointer.put(
      {
        executionId: workItem.executionId,
        kind: workItem.kind,
        status,
        title: workItem.request.title,
        gateStatus: gate.gateStatus,
        modifiedFiles: gate.modifiedFiles,
      },
      {
        source: "update",
        step: 1,
      },
    );
    await this.updateExecution(workItem.executionId, {
      status,
      updatedAt: completedAt,
      completedAt,
      title: workItem.request.title,
      ...(result.prUrl ? { prUrl: result.prUrl } : {}),
      gateStatus: gate.gateStatus,
      modifiedFiles: gate.modifiedFiles,
      ...(gate.pdseScore !== undefined ? { pdseScore: gate.pdseScore } : {}),
      ...(gate.repoVerificationPassed !== undefined
        ? { repoVerificationPassed: gate.repoVerificationPassed }
        : {}),
      summary,
      ...(result.success ? {} : { error: result.error ?? "Failed to create pull request" }),
    });
    await this.appendAutomationAudit("git_automation_run", workItem.executionId, {
      kind: workItem.kind,
      status,
      title: workItem.request.title,
      gateStatus: gate.gateStatus,
      modifiedFiles: gate.modifiedFiles,
    });

    return {
      output: summary,
      touchedFiles: gate.modifiedFiles,
    };
  }

  private async evaluateWorkflowGate(
    executionId: string,
    beforeStatus: GitStatusResult,
    afterStatus: GitStatusResult,
    trigger: AutomationTrigger | undefined,
  ): Promise<GateEvaluationResult> {
    const modifiedFiles = diffStatusFiles(beforeStatus, afterStatus);
    return await this.evaluateGateForFiles(executionId, modifiedFiles, trigger);
  }

  private async evaluateGateForFiles(
    executionId: string,
    modifiedFiles: string[],
    trigger: AutomationTrigger | undefined,
  ): Promise<GateEvaluationResult> {
    if (this.gateEvaluatorOverride) {
      return this.gateEvaluatorOverride.evaluate(executionId, modifiedFiles, trigger);
    }
    if (modifiedFiles.length === 0) {
      return {
        gateStatus: "skipped",
        modifiedFiles: [],
      };
    }

    const pdseScores: number[] = [];
    const pdsePassedFlags: boolean[] = [];

    for (const relativeFilePath of modifiedFiles) {
      const absoluteFilePath = path.resolve(this.projectRoot, relativeFilePath);
      try {
        const content = await this.readFileImpl(absoluteFilePath);
        const score = this.scoreContentImpl(content, this.projectRoot);
        const normalized = normalizePdseScore(score);
        pdseScores.push(normalized);
        pdsePassedFlags.push(score.passedGate);
      } catch {
        // Unreadable files are skipped but still remain in modifiedFiles.
      }
    }

    const averageScore =
      pdseScores.length > 0
        ? pdseScores.reduce((sum, value) => sum + value, 0) / pdseScores.length
        : undefined;
    const verification = this.verifyRepoImpl(this.projectRoot);
    const passed =
      (pdsePassedFlags.length === 0 || pdsePassedFlags.every(Boolean)) && verification.passed;

    const eventPayload = {
      executionId,
      modifiedFiles,
      ...(averageScore !== undefined ? { pdseScore: averageScore } : {}),
      verificationPassed: verification.passed,
      failedSteps: verification.failedSteps,
      trigger,
    };

    if (passed) {
      await this.appendAutomationAudit("git_automation_gate_pass", executionId, eventPayload);
      await this.appendAutomationAudit("pdse_gate_pass", executionId, {
        score: averageScore ?? 1,
        modifiedFiles,
      });
      return {
        gateStatus: "passed",
        modifiedFiles,
        ...(averageScore !== undefined ? { pdseScore: averageScore } : {}),
        repoVerificationPassed: true,
      };
    }

    const error = [
      pdsePassedFlags.some((entry) => entry === false)
        ? "PDSE gate failed for one or more modified files."
        : "",
      verification.failedSteps.length > 0
        ? `Repo verification failed: ${verification.failedSteps.join(", ")}`
        : "",
    ]
      .filter((entry) => entry.length > 0)
      .join(" ");

    await this.appendAutomationAudit("git_automation_gate_fail", executionId, {
      ...eventPayload,
      error,
    });
    await this.appendAutomationAudit("pdse_gate_fail", executionId, {
      score: averageScore ?? 0,
      modifiedFiles,
      failedSteps: verification.failedSteps,
    });
    return {
      gateStatus: "failed",
      modifiedFiles,
      ...(averageScore !== undefined ? { pdseScore: averageScore } : {}),
      repoVerificationPassed: verification.passed,
      error,
    };
  }

  private async updateExecution(
    executionId: string,
    patch: Partial<StoredAutomationExecutionRecord>,
  ): Promise<void> {
    const current =
      (await this.getExecution(executionId)) ??
      ({
        id: executionId,
        kind: "workflow",
        cwd: this.projectRoot,
        status: "queued",
        gateStatus: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        modifiedFiles: [],
      } satisfies StoredAutomationExecutionRecord);

    await this.store.upsertAutomationExecution({
      ...current,
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
      modifiedFiles: patch.modifiedFiles ?? current.modifiedFiles,
    });
  }

  private async appendAutomationAudit(
    type: AuditEventInput["type"],
    executionId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLoggerImpl(this.projectRoot, {
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      type,
      payload: {
        executionId,
        ...payload,
      },
      modelId: this.modelId,
      projectRoot: this.projectRoot,
    });
  }
}

function normalizePdseScore(score: PDSEScore): number {
  return score.overall > 1 ? score.overall / 100 : score.overall;
}

function collectStatusFiles(status: GitStatusResult): string[] {
  return uniquePaths([
    ...status.staged.map((entry) => entry.path),
    ...status.unstaged.map((entry) => entry.path),
    ...status.untracked.map((entry) => entry.path),
    ...status.conflicted.map((entry) => entry.path),
  ]);
}

function diffStatusFiles(before: GitStatusResult, after: GitStatusResult): string[] {
  const beforeFiles = new Set(collectStatusFiles(before));
  const afterFiles = collectStatusFiles(after);
  return uniquePaths(afterFiles.filter((filePath) => !beforeFiles.has(filePath)));
}

function uniquePaths(filePaths: string[]): string[] {
  return [...new Set(filePaths.map((filePath) => filePath.replace(/\\/g, "/")))];
}

function firstWorkflowError(result: WorkflowResult): string | undefined {
  for (const job of result.jobs) {
    const failedStep = job.steps.find((step) => step.success === false && step.error);
    if (failedStep?.error) {
      return failedStep.error;
    }
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
