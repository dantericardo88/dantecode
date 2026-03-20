/**
 * tool-scheduler.ts — DTR Phase 1: ToolScheduler state machine
 *
 * Phase 1 scope (additive — does NOT yet replace agent-loop.ts for-loop):
 * - Tracks per-tool-call lifecycle state
 * - Exposes isRunning() to check if a tool is active
 * - Records state transitions with timestamps
 * - Runs post-Bash verification and emits verification messages
 * - Integrates with ArtifactStore
 *
 * Phase 2 will delegate full execution FROM agent-loop.ts → scheduler.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  ArtifactRecord,
  ToolCallRecord,
  ToolCallStatus,
  ToolExecutionResult,
  ToolSchedulerConfig,
  VerificationResult,
} from './tool-call-types.js';
import { TERMINAL_STATES, VALID_TRANSITIONS } from './tool-call-types.js';
import { ArtifactStore } from './artifact-store.js';
import { DependencyGraph } from './dependency-graph.js';
import {
  buildFileWriteChecks,
  formatVerificationMessage,
  inferVerificationChecks,
  runVerificationChecks,
} from './verification-checks.js';
import { ApprovalGateway, globalApprovalGateway } from './approval-gateway.js';
import {
  ExecutionPolicyRegistry,
  type ToolExecutionPolicy,
} from './execution-policy.js';

export interface SchedulerEvents {
  stateChange: (record: ToolCallRecord, previousStatus: ToolCallStatus) => void;
  verificationPassed: (record: ToolCallRecord, result: VerificationResult) => void;
  verificationFailed: (record: ToolCallRecord, result: VerificationResult, message: string) => void;
  artifactRecorded: (artifact: ArtifactRecord) => void;
}

export interface ToolSchedulerExecutionRequest {
  id?: string;
  toolName: string;
  input: Record<string, unknown>;
  dependsOn?: string[];
}

export interface ToolSchedulerExecutionContext {
  requestId: string;
  projectRoot?: string;
  completedTools?: Set<string>;
  execute: (
    request: Required<ToolSchedulerExecutionRequest>,
    record: ToolCallRecord,
  ) => Promise<ToolExecutionResult>;
}

export interface ToolSchedulerExecutionResult {
  request: Required<ToolSchedulerExecutionRequest>;
  record: ToolCallRecord;
  result?: ToolExecutionResult;
  executed: boolean;
  blockedReason?: string;
  verificationMessage?: string;
}

export interface ToolSchedulerRuntimeConfig {
  approvalGateway?: ApprovalGateway;
  executionPolicy?: ExecutionPolicyRegistry;
  policies?: ToolExecutionPolicy[];
}

export class ToolScheduler extends EventEmitter {
  private readonly _calls = new Map<string, ToolCallRecord>();
  private readonly _artifacts: ArtifactStore;
  private readonly _config: Required<ToolSchedulerConfig>;
  private readonly _approvalGateway: ApprovalGateway;
  private readonly _executionPolicy: ExecutionPolicyRegistry;
  private _activeCallId: string | null = null;

  constructor(
    artifactStore?: ArtifactStore,
    config: ToolSchedulerConfig = {},
    runtime: ToolSchedulerRuntimeConfig = {},
  ) {
    super();
    this._artifacts = artifactStore ?? new ArtifactStore();
    this._config = {
      requireApprovalFor: config.requireApprovalFor ?? [],
      requireApprovalForDomains: config.requireApprovalForDomains ?? [],
      maxConcurrency: config.maxConcurrency ?? 1,
      defaultTimeoutMs: config.defaultTimeoutMs ?? 120_000,
      verifyAfterExecution: config.verifyAfterExecution ?? true,
    };
    this._approvalGateway = runtime.approvalGateway ?? globalApprovalGateway;
    this._executionPolicy = runtime.executionPolicy ?? new ExecutionPolicyRegistry(runtime.policies);
  }

  // ─── State Query ────────────────────────────────────────────────────────────

  /** True if any tool call is currently in an active (non-terminal) state */
  isRunning(): boolean {
    return this._activeCallId !== null;
  }

  /** Get a tool call record by id */
  get(id: string): ToolCallRecord | undefined {
    return this._calls.get(id);
  }

  /** Get all records */
  all(): ToolCallRecord[] {
    return [...this._calls.values()];
  }

  /** Get records in a given status */
  inStatus(status: ToolCallStatus): ToolCallRecord[] {
    return [...this._calls.values()].filter((r) => r.status === status);
  }

  get artifacts(): ArtifactStore {
    return this._artifacts;
  }

  resumeToolCalls(records: ToolCallRecord[]): ToolCallRecord[] {
    const restoredRecords = records.map((record) => this._normalizeResumedRecord(record));

    for (const record of restoredRecords) {
      this._calls.set(record.id, record);
    }

    const activeRecord = [...this._calls.values()]
      .filter((record) =>
        record.status === 'awaiting_approval' ||
        record.status === 'verifying',
      )
      .sort((left, right) => {
        const leftTs = left.statusHistory[left.statusHistory.length - 1]?.ts ?? left.createdAt;
        const rightTs = right.statusHistory[right.statusHistory.length - 1]?.ts ?? right.createdAt;
        return rightTs - leftTs;
      })[0];

    this._activeCallId = activeRecord?.id ?? null;
    return restoredRecords;
  }

  // ─── Lifecycle Management ───────────────────────────────────────────────────

  /** Create a new tool call record and transition to 'validating' */
  submit(
    toolName: string,
    input: Record<string, unknown>,
    requestId: string,
    options?: { id?: string; dependsOn?: string[] },
  ): ToolCallRecord {
    const id = options?.id ?? randomUUID();
    const now = Date.now();
    const record: ToolCallRecord = {
      id,
      toolName,
      input,
      requestId,
      dependsOn: options?.dependsOn,
      status: 'created',
      statusHistory: [{ status: 'created', ts: now }],
      createdAt: now,
    };
    this._calls.set(id, record);
    this._transition(record, 'validating');
    return record;
  }

  async executeBatch(
    toolCalls: ToolSchedulerExecutionRequest[],
    context: ToolSchedulerExecutionContext,
  ): Promise<ToolSchedulerExecutionResult[]> {
    const results = new Map<string, ToolSchedulerExecutionResult>();
    const completedTools = context.completedTools ?? new Set<string>();
    const dependencyGraph = new DependencyGraph();
    const prepared = toolCalls.map((toolCall) => {
      const request: Required<ToolSchedulerExecutionRequest> = {
        id: toolCall.id ?? randomUUID(),
        toolName: toolCall.toolName,
        input: toolCall.input,
        dependsOn: toolCall.dependsOn ?? [],
      };
      const record = this.submit(request.toolName, request.input, context.requestId, {
        id: request.id,
        dependsOn: request.dependsOn,
      });
      dependencyGraph.register(request.id, request.dependsOn);
      return { request, record };
    });

    for (const { request } of prepared) {
      for (const dependencyId of request.dependsOn) {
        if (dependencyGraph.has(dependencyId)) {
          continue;
        }

        const existing = this._calls.get(dependencyId);
        if (!existing) {
          continue;
        }

        dependencyGraph.register(dependencyId, existing.dependsOn ?? []);
        dependencyGraph.setState(dependencyId, this._dependencyStateFromRecord(existing));
      }
    }

    const pending = [...prepared];
    while (pending.length > 0) {
      let progressed = false;

      for (let index = 0; index < pending.length; ) {
        const current = pending[index]!;
        const { request, record } = current;

        const explicitDependencies = dependencyGraph.inspect(request.id);
        if (!explicitDependencies.ready) {
          if (explicitDependencies.pending.length > 0) {
            index += 1;
            continue;
          }

          const blockedReason = this._formatExplicitDependencyReason(request, explicitDependencies);
          this._transition(record, 'blocked_by_dependency', blockedReason);
          dependencyGraph.setState(request.id, 'failed');
          results.set(request.id, {
            request,
            record,
            executed: false,
            blockedReason,
          });
          pending.splice(index, 1);
          progressed = true;
          continue;
        }

        const dependencyState = this._executionPolicy.dependenciesSatisfied(
          request.toolName,
          completedTools,
        );
        if (!dependencyState.satisfied) {
          const pendingToolDependencies = (dependencyState.missing ?? []).filter((dependencyTool) =>
            pending.some((candidate) =>
              candidate.request.id !== request.id && candidate.request.toolName === dependencyTool
            ),
          );
          if (pendingToolDependencies.length > 0) {
            index += 1;
            continue;
          }

          const blockedReason =
            `Missing required tools: ${dependencyState.missing?.join(', ') ?? 'unknown'}`;
          this._transition(record, 'blocked_by_dependency', blockedReason);
          dependencyGraph.setState(request.id, 'failed');
          results.set(request.id, {
            request,
            record,
            executed: false,
            blockedReason,
          });
          pending.splice(index, 1);
          progressed = true;
          continue;
        }

        const approval = this._approvalGateway.check(request.toolName, request.input);
        if (approval.decision === 'auto_deny') {
          const deniedReason = approval.reason ?? 'Approval denied.';
          record.errorMessage = deniedReason;
          this._transition(record, 'error', deniedReason);
          dependencyGraph.setState(request.id, 'failed');
          results.set(request.id, {
            request,
            record,
            executed: false,
            blockedReason: deniedReason,
          });
          pending.splice(index, 1);
          progressed = true;
          continue;
        }

        if (approval.decision === 'requires_approval') {
          const approvalReason = approval.reason ?? 'Approval required.';
          this._transition(record, 'awaiting_approval', approvalReason);
          results.set(request.id, {
            request,
            record,
            executed: false,
            blockedReason: approvalReason,
          });
          pending.splice(index, 1);
          this._flushPausedRequests(pending, results, `${request.toolName} is awaiting approval.`);
          return prepared.map(({ request: preparedRequest }) => results.get(preparedRequest.id)!);
        }

        this.schedule(record.id);
        if (record.status !== 'executing') {
          const blockedReason = record.status === 'awaiting_approval'
            ? 'Approval required.'
            : `Tool did not enter executing state (status=${record.status}).`;
          results.set(request.id, {
            request,
            record,
            executed: false,
            blockedReason,
          });
          pending.splice(index, 1);
          progressed = true;
          continue;
        }

        try {
          const result = await context.execute(request, record);
          record.result = result;

          if (result.isError) {
            this.error(record.id, result.content);
            dependencyGraph.setState(request.id, 'failed');
            results.set(request.id, {
              request,
              record,
              result,
              executed: true,
            });
            pending.splice(index, 1);
            progressed = true;
            continue;
          }

          const completion = await this.complete(record.id, result, {
            bashCommand: request.toolName === 'Bash'
              ? String(request.input['command'] ?? '')
              : undefined,
            writtenFile: request.toolName === 'Write' || request.toolName === 'Edit'
              ? String(request.input['file_path'] ?? '')
              : undefined,
            projectRoot: context.projectRoot,
          });
          if (this._shouldCountAsCompleted(request, result)) {
            completedTools.add(request.toolName);
            dependencyGraph.setState(request.id, 'satisfied');
          } else {
            dependencyGraph.setState(request.id, 'pending');
          }
          results.set(request.id, {
            request,
            record,
            result,
            executed: true,
            verificationMessage: completion.verificationMessage,
          });
          pending.splice(index, 1);
          progressed = true;
          continue;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.error(record.id, message);
          dependencyGraph.setState(request.id, 'failed');
          results.set(request.id, {
            request,
            record,
            result: {
              content: message,
              isError: true,
            },
            executed: true,
          });
          pending.splice(index, 1);
          progressed = true;
          continue;
        }
      }

      if (!progressed) {
        this._flushBlockedRequests(pending, dependencyGraph, completedTools, results);
        break;
      }
    }

    return prepared.map(({ request }) => results.get(request.id)!);
  }

  /** Transition a call through: validating → scheduled → executing */
  schedule(id: string): void {
    const record = this._calls.get(id);
    if (!record) throw new Error(`ToolScheduler: unknown call id ${id}`);
    if (record.status === 'validating') {
      // Check approval requirement
      if (this._requiresApproval(record)) {
        this._transition(record, 'awaiting_approval');
        return;
      }
      this._transition(record, 'scheduled');
    }
    if (record.status === 'scheduled') {
      this._transition(record, 'executing');
      this._activeCallId = id;
      record.startedAt = Date.now();
    }
  }

  /** Approve a call that is awaiting_approval */
  approve(id: string): void {
    const record = this._calls.get(id);
    if (!record || record.status !== 'awaiting_approval') return;
    this._transition(record, 'scheduled');
    this.schedule(id);
  }

  /** Cancel a call (can cancel from any non-terminal state) */
  cancel(id: string, reason?: string): void {
    const record = this._calls.get(id);
    if (!record || TERMINAL_STATES.has(record.status)) return;
    this._transition(record, 'cancelled', reason);
    if (this._activeCallId === id) this._activeCallId = null;
  }

  /**
   * Mark a call as complete.
   * If verifyAfterExecution is true and bashCommand is provided,
   * runs post-execution verification and returns the message (if any).
   */
  async complete(
    id: string,
    result: ToolExecutionResult,
    options?: {
      bashCommand?: string;
      writtenFile?: string;
      projectRoot?: string;
    },
  ): Promise<{ verificationMessage?: string }> {
    const record = this._calls.get(id);
    if (!record || record.status !== 'executing') return {};

    record.result = result;

    if (this._config.verifyAfterExecution && options) {
      this._transition(record, 'verifying');

      const verificationMessage = await this._runPostExecutionVerification(record, options);

      if (verificationMessage) {
        // Verification failed — mark as success anyway (the message goes to model as warning)
        // We don't block execution in Phase 1; we only inject the warning message
        this._transition(record, 'success');
        if (this._activeCallId === id) this._activeCallId = null;
        record.completedAt = Date.now();
        return { verificationMessage };
      }
    }

    this._transition(record, 'success');
    if (this._activeCallId === id) this._activeCallId = null;
    record.completedAt = Date.now();
    return {};
  }

  /** Mark a call as errored */
  error(id: string, errorMessage: string): void {
    const record = this._calls.get(id);
    if (!record) return;
    if (!TERMINAL_STATES.has(record.status)) {
      record.errorMessage = errorMessage;
      this._transition(record, 'error', errorMessage);
      if (this._activeCallId === id) this._activeCallId = null;
      record.completedAt = Date.now();
    }
  }

  /** Clear all records (test utility) */
  reset(): void {
    this._calls.clear();
    this._activeCallId = null;
    this._artifacts.clear();
  }

  // ─── Convenience: Bash-Specific Post-Execution Verification ────────────────

  /**
   * Run verification for a completed Bash tool call.
   * Returns a warning string to inject into toolResults, or null if all good.
   */
  async verifyBashArtifacts(
    bashCommand: string,
    projectRoot: string,
  ): Promise<string | null> {
    const inferred = inferVerificationChecks(bashCommand);
    if (inferred.length === 0) return null;

    const allResults: VerificationResult[] = [];
    const allRecorded: ArtifactRecord[] = [];

    for (const { artifact, target, checks } of inferred) {
      const result = await runVerificationChecks(checks, projectRoot);
      allResults.push(result);

      if (result.passed) {
        const rec = this._artifacts.record({
          kind: artifact,
          path: target,
          toolCallId: 'bash',
          sourceUrl: undefined,
        });
        this._artifacts.markVerified(rec.id);
        allRecorded.push(rec);
        this.emit('artifactRecorded', rec);
      }
    }

    const failed = allResults.filter((r) => !r.passed);
    if (failed.length === 0) {
      return null; // All passed, no warning needed
    }

    return allResults
      .filter((r) => !r.passed)
      .map((r) => formatVerificationMessage(r, bashCommand))
      .join('\n');
  }

  /**
   * Run verification for a completed Write tool call.
   * Returns a warning string to inject into toolResults, or null if all good.
   */
  async verifyWriteArtifact(
    filePath: string,
    projectRoot: string,
  ): Promise<string | null> {
    const checks = buildFileWriteChecks(filePath);
    const result = await runVerificationChecks(checks, projectRoot);

    if (result.passed) {
      const rec = this._artifacts.record({
        kind: 'file_write',
        path: filePath,
        toolCallId: 'write',
      });
      this._artifacts.markVerified(rec.id);
      this.emit('artifactRecorded', rec);
      return null;
    }

    return formatVerificationMessage(result, `Write(${filePath})`);
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private _requiresApproval(record: ToolCallRecord): boolean {
    return this._config.requireApprovalFor.includes(record.toolName);
  }

  private _normalizeResumedRecord(record: ToolCallRecord): ToolCallRecord {
    const restored: ToolCallRecord = {
      ...record,
      input: { ...record.input },
      dependsOn: record.dependsOn ? [...record.dependsOn] : undefined,
      statusHistory: [...record.statusHistory],
      artifacts: record.artifacts ? [...record.artifacts] : undefined,
      result: record.result
        ? {
          ...record.result,
          evidence: record.result.evidence ? { ...record.result.evidence } : undefined,
        }
        : undefined,
      verificationResult: record.verificationResult
        ? {
          passed: record.verificationResult.passed,
          checks: [...record.verificationResult.checks],
          failedChecks: [...record.verificationResult.failedChecks],
        }
        : undefined,
    };

    if (restored.status === 'executing') {
      if (restored.result?.isError) {
        this._resumeWithError(
          restored,
          restored.result.content || 'Tool execution failed before resume.',
        );
      } else if (restored.result) {
        this._resumeTransition(
          restored,
          'verifying',
          'Resumed from persisted execution evidence.',
        );
      } else {
        this._resumeWithError(
          restored,
          'Tool was executing when interrupted but no persisted execution evidence was available.',
        );
      }
    } else if (restored.status === 'verifying') {
      if (restored.verificationResult?.passed === true) {
        this._resumeTransition(
          restored,
          'success',
          'Verification completed before resume.',
        );
        restored.completedAt ??= Date.now();
      } else if (restored.verificationResult?.passed === false) {
        this._resumeWithError(restored, 'Tool verification failed before resume.');
      } else if (restored.result?.isError) {
        this._resumeWithError(
          restored,
          restored.result.content || 'Tool execution failed before verification completed.',
        );
      }
    }

    return restored;
  }

  private _dependencyStateFromRecord(record: ToolCallRecord): 'pending' | 'satisfied' | 'failed' {
    if (record.status === 'success') {
      if (record.toolName === 'SubAgent' && record.input['background'] === true) {
        return 'pending';
      }
      return 'satisfied';
    }

    if (
      record.status === 'error' ||
      record.status === 'blocked_by_dependency' ||
      record.status === 'cancelled' ||
      record.status === 'timed_out'
    ) {
      return 'failed';
    }

    return 'pending';
  }

  private _formatExplicitDependencyReason(
    request: Required<ToolSchedulerExecutionRequest>,
    readiness: ReturnType<DependencyGraph['inspect']>,
  ): string {
    if (readiness.cycle) {
      return `Dependency cycle detected: ${readiness.cycle.join(' -> ')}`;
    }

    const parts: string[] = [];
    if (readiness.missing.length > 0) {
      parts.push(`missing tool calls: ${readiness.missing.join(', ')}`);
    }
    if (readiness.failed.length > 0) {
      parts.push(`failed prerequisites: ${readiness.failed.join(', ')}`);
    }
    if (readiness.pending.length > 0) {
      parts.push(`pending prerequisites: ${readiness.pending.join(', ')}`);
    }

    return `${request.toolName} is blocked by dependency state (${parts.join('; ')})`;
  }

  private _flushPausedRequests(
    pending: Array<{
      request: Required<ToolSchedulerExecutionRequest>;
      record: ToolCallRecord;
    }>,
    results: Map<string, ToolSchedulerExecutionResult>,
    reason: string,
  ): void {
    for (const { request, record } of pending) {
      this._transition(record, 'blocked_by_dependency', reason);
      results.set(request.id, {
        request,
        record,
        executed: false,
        blockedReason: reason,
      });
    }
  }

  private _flushBlockedRequests(
    pending: Array<{
      request: Required<ToolSchedulerExecutionRequest>;
      record: ToolCallRecord;
    }>,
    dependencyGraph: DependencyGraph,
    completedTools: Set<string>,
    results: Map<string, ToolSchedulerExecutionResult>,
  ): void {
    for (const { request, record } of pending) {
      const explicitDependencies = dependencyGraph.inspect(request.id);
      const policyDependencies = this._executionPolicy.dependenciesSatisfied(
        request.toolName,
        completedTools,
      );
      const blockedReason = explicitDependencies.ready
        ? `Missing required tools: ${policyDependencies.missing?.join(', ') ?? 'unknown'}`
        : this._formatExplicitDependencyReason(request, explicitDependencies);
      this._transition(record, 'blocked_by_dependency', blockedReason);
      results.set(request.id, {
        request,
        record,
        executed: false,
        blockedReason,
      });
    }
  }

  private _shouldCountAsCompleted(
    request: Required<ToolSchedulerExecutionRequest>,
    result: ToolExecutionResult,
  ): boolean {
    if (result.isError) {
      return false;
    }

    if (request.toolName === 'SubAgent' && request.input['background'] === true) {
      return false;
    }

    return true;
  }

  private _transition(record: ToolCallRecord, to: ToolCallStatus, reason?: string): void {
    const from = record.status;
    const valid = VALID_TRANSITIONS[from];
    if (!valid.includes(to)) {
      // Invalid transition — log but don't throw (graceful degradation)
      // This can happen if the scheduler is used outside full pipeline mode
      return;
    }
    const previous = record.status;
    record.status = to;
    record.statusHistory.push({ status: to, ts: Date.now(), reason });
    this.emit('stateChange', record, previous);
  }

  private _resumeTransition(
    record: ToolCallRecord,
    to: ToolCallStatus,
    reason: string,
  ): void {
    if (record.status === to) {
      return;
    }

    if (!VALID_TRANSITIONS[record.status].includes(to)) {
      return;
    }

    record.status = to;
    record.statusHistory.push({ status: to, ts: Date.now(), reason });
  }

  private _resumeWithError(record: ToolCallRecord, message: string): void {
    record.errorMessage = message;
    this._resumeTransition(record, 'error', message);
    record.completedAt ??= Date.now();
  }

  private async _runPostExecutionVerification(
    record: ToolCallRecord,
    options: { bashCommand?: string; writtenFile?: string; projectRoot?: string },
  ): Promise<string | undefined> {
    const projectRoot = options.projectRoot ?? process.cwd();

    if (options.bashCommand) {
      const msg = await this.verifyBashArtifacts(options.bashCommand, projectRoot);
      if (msg) {
        const vResult: VerificationResult = {
          passed: false,
          checks: [],
          failedChecks: [],
        };
        this.emit('verificationFailed', record, vResult, msg);
        return msg;
      }
    }

    if (options.writtenFile) {
      const msg = await this.verifyWriteArtifact(options.writtenFile, projectRoot);
      if (msg) {
        const vResult: VerificationResult = {
          passed: false,
          checks: [],
          failedChecks: [],
        };
        this.emit('verificationFailed', record, vResult, msg);
        return msg;
      }
    }

    return undefined;
  }
}

/** Module-level singleton — shared within a CLI or VSCode session */
export const globalToolScheduler = new ToolScheduler();
