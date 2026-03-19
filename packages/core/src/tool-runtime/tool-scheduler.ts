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
import {
  buildFileWriteChecks,
  formatVerificationMessage,
  inferVerificationChecks,
  runVerificationChecks,
} from './verification-checks.js';

export interface SchedulerEvents {
  stateChange: (record: ToolCallRecord, previousStatus: ToolCallStatus) => void;
  verificationPassed: (record: ToolCallRecord, result: VerificationResult) => void;
  verificationFailed: (record: ToolCallRecord, result: VerificationResult, message: string) => void;
  artifactRecorded: (artifact: ArtifactRecord) => void;
}

export class ToolScheduler extends EventEmitter {
  private readonly _calls = new Map<string, ToolCallRecord>();
  private readonly _artifacts: ArtifactStore;
  private readonly _config: Required<ToolSchedulerConfig>;
  private _activeCallId: string | null = null;

  constructor(artifactStore?: ArtifactStore, config: ToolSchedulerConfig = {}) {
    super();
    this._artifacts = artifactStore ?? new ArtifactStore();
    this._config = {
      requireApprovalFor: config.requireApprovalFor ?? [],
      requireApprovalForDomains: config.requireApprovalForDomains ?? [],
      maxConcurrency: config.maxConcurrency ?? 1,
      defaultTimeoutMs: config.defaultTimeoutMs ?? 120_000,
      verifyAfterExecution: config.verifyAfterExecution ?? true,
    };
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

  // ─── Lifecycle Management ───────────────────────────────────────────────────

  /** Create a new tool call record and transition to 'validating' */
  submit(toolName: string, input: Record<string, unknown>, requestId: string): ToolCallRecord {
    const id = randomUUID();
    const now = Date.now();
    const record: ToolCallRecord = {
      id,
      toolName,
      input,
      requestId,
      status: 'created',
      statusHistory: [{ status: 'created', ts: now }],
      createdAt: now,
    };
    this._calls.set(id, record);
    this._transition(record, 'validating');
    return record;
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
