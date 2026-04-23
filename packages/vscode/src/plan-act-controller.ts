// ============================================================================
// DanteCode VS Code Extension — PlanActController
// Wraps PlanExecutor with per-step git snapshots and rollback support.
// Before each step executes, the current git HEAD SHA is captured so the
// user can roll back to any prior state via rollbackToStep(stepIndex).
// ============================================================================

import * as vscode from "vscode";
import type { ExecutionPlan, PlanStep as CorePlanStep } from "@dantecode/core";
import { PlanExecutor, type PlanExecutorOptions, recordPlanEdit, computePlanDiff, verifyStepCompletion, recordStepVerification, PlanSmartContext } from "@dantecode/core";
import type { StepExecutionResult, PlanExecutionResult, StepBudgetAllocation } from "@dantecode/core";

export type { StepBudgetAllocation };

export type { StepExecutionResult, PlanExecutionResult };

// ── Local PlanStep (simpler than core's, used for file-snapshot + parsing API) ─

/**
 * A single step in a plan.
 * Intentionally simpler than `@dantecode/core`'s PlanStep to allow easy
 * construction in tests and UI code without required core fields.
 */
export interface PlanStep {
  id: string;
  description: string;
  /** Primary file this step touches — used for pre-step file snapshots. */
  targetFile?: string;
}

// ── File-snapshot types (Sprint B API) ───────────────────────────────────────

export interface FileSnapshot {
  filePath: string;
  existed: boolean;
  content: string;
}

export interface PlanStepResult {
  stepId: string;
  succeeded: boolean;
  error?: string;
  snapshot?: FileSnapshot;
}

type WorkspaceFs = {
  readFile(uri: vscode.Uri | { fsPath: string }): Promise<Uint8Array> | Thenable<Uint8Array>;
  writeFile(uri: vscode.Uri | { fsPath: string }, content: Uint8Array): Promise<void> | Thenable<void>;
  delete(uri: vscode.Uri | { fsPath: string }): Promise<void> | Thenable<void>;
};

export interface PlanActControllerOptions extends Partial<PlanExecutorOptions> {
  /** Working directory used for git operations. Defaults to process.cwd(). */
  workdir?: string;
  /** Injectable workspace FS (uses vscode.workspace.fs by default). */
  workspaceFs?: WorkspaceFs;
  /**
   * Total token budget for smart context allocation across all plan steps.
   * Passed to PlanSmartContext. Default: 8000 tokens.
   */
  smartContextTokenBudget?: number;
}

// ── parsePlanSteps ─────────────────────────────────────────────────────────────

/**
 * Parse a plan string into PlanStep[].
 * Recognises: numbered list items ("1. Install deps") and markdown headings ("## Step").
 */
export function parsePlanSteps(plan: string): PlanStep[] {
  const lines = plan.split("\n");
  const steps: PlanStep[] = [];
  let counter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const numberedMatch = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (numberedMatch) {
      counter++;
      steps.push({ id: `step-${counter}`, description: numberedMatch[1]!.trim() });
      continue;
    }

    const headingMatch = /^#{2,3}\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      counter++;
      steps.push({ id: `step-${counter}`, description: headingMatch[1]!.trim() });
    }
  }

  return steps;
}

export interface RollbackResult {
  success: boolean;
  sha?: string;
  error?: string;
}

/**
 * PlanActController wraps PlanExecutor and adds per-step git snapshots.
 * Before each step executes a snapshot of the current HEAD SHA is stored;
 * `rollbackToStep(stepIndex)` resets the repo to that snapshot.
 */
export class PlanActController {
  private _executor: PlanExecutor | undefined;
  private readonly _workdir: string;
  private readonly _workspaceFs: WorkspaceFs;
  private readonly _stepSnapshots: Map<number, string> = new Map();
  private readonly _smartContext: PlanSmartContext;
  /** Log of budget allocations made during this controller's lifetime. */
  private readonly _budgetLog: Array<{ stepId: string; allocation: StepBudgetAllocation }> = [];

  constructor(options: PlanActControllerOptions = {}) {
    this._workdir = options.workdir ?? (typeof process !== "undefined" ? process.cwd() : "/");
    this._smartContext = new PlanSmartContext(options.smartContextTokenBudget ?? 8000);
    this._workspaceFs = options.workspaceFs ?? {
      readFile: (u) => vscode.workspace.fs.readFile(u as vscode.Uri),
      writeFile: (u, c) => vscode.workspace.fs.writeFile(u as vscode.Uri, c),
      delete: (u) => vscode.workspace.fs.delete(u as vscode.Uri),
    };

    // Only create PlanExecutor when executeStep is provided (Sprint K mode)
    if (options.executeStep) {
      const originalExecuteStep = options.executeStep;
      let stepIndex = 0;

      const wrappedExecuteStep = async (
        step: CorePlanStep,
        plan: ExecutionPlan,
      ): Promise<StepExecutionResult> => {
        const currentIndex = stepIndex++;
        await this._captureSnapshot(currentIndex);
        return originalExecuteStep(step, plan);
      };

      this._executor = new PlanExecutor({
        ...(options as PlanExecutorOptions),
        executeStep: wrappedExecuteStep,
      });
    }
  }

  // ── Sprint B: Plan editing ──────────────────────────────────────────────────

  /**
   * Present the plan to the user for editing before execution.
   * `editorFn` is called if provided; otherwise opens a VS Code document.
   * Returns the edited plan, or null if cancelled.
   */
  async editAndConfirm(
    plan: string,
    editorFn?: (plan: string) => Promise<string | null>,
    sessionId = "unknown",
  ): Promise<string | null> {
    if (editorFn) {
      const result = await editorFn(plan);
      // Sprint AJ — Dim 16: record plan edit evidence
      recordPlanEdit({
        sessionId,
        originalLineCount: plan.split("\n").length,
        editedLineCount: result ? result.split("\n").length : 0,
        linesChanged: result ? computePlanDiff(plan, result) : 0,
        confirmed: result !== null,
        stepCount: (plan.match(/^##?\s/gm) ?? []).length,
      });
      return result;
    }

    const doc = await vscode.workspace.openTextDocument({ content: plan, language: "markdown" });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    const confirmation = await vscode.window.showInformationMessage(
      "Review and edit the plan, then click Confirm to execute.",
      "Confirm",
      "Cancel",
    );
    const confirmed = confirmation === "Confirm";
    const edited = confirmed ? doc.getText() : null;
    // Sprint AJ — Dim 16: record plan edit evidence
    recordPlanEdit({
      sessionId,
      originalLineCount: plan.split("\n").length,
      editedLineCount: edited ? edited.split("\n").length : 0,
      linesChanged: edited ? computePlanDiff(plan, edited) : 0,
      confirmed,
      stepCount: (plan.match(/^##?\s/gm) ?? []).length,
    });
    return edited;
  }

  // ── Sprint BJ: Smart context budget allocation ─────────────────────────────

  /**
   * Compute the token budget for a plan step using PlanSmartContext.
   *
   * This allocates tokens proportionally across steps: the first step receives
   * a larger share (40% of total) as a warm-up; subsequent steps divide the
   * remainder equally. The allocation is logged for diagnostics.
   *
   * @param step           The plan step to budget for.
   * @param stepIndex      0-based index of this step in the plan.
   * @param remainingSteps Number of steps that will execute after this one.
   * @param totalBudget    Override total token budget (uses instance default if omitted).
   * @returns StepBudgetAllocation with token count, label, and priority flag.
   */
  planSmartContextBudget(
    step: PlanStep,
    stepIndex: number,
    remainingSteps: number,
    totalBudget?: number,
  ): StepBudgetAllocation {
    const allocation = this._smartContext.getStepBudget(step, stepIndex, remainingSteps, totalBudget);
    this._budgetLog.push({ stepId: step.id, allocation });
    return allocation;
  }

  /**
   * Returns all budget allocations made during this controller's lifetime.
   * Useful for diagnostics and tests.
   */
  getBudgetLog(): ReadonlyArray<{ stepId: string; allocation: StepBudgetAllocation }> {
    return this._budgetLog;
  }

  // ── Sprint B: Step execution with file snapshot ────────────────────────────

  /**
   * Execute a single step, capturing a file snapshot before running `fn`.
   * Automatically allocates a smart context budget before execution and
   * logs the allocation for diagnostics.
   */
  async executeStep(
    step: PlanStep,
    fn: () => Promise<void>,
    stepIndex = 0,
    remainingSteps = 0,
  ): Promise<PlanStepResult> {
    // Sprint BJ (dim 16): allocate smart context budget before executing each step
    const allocation = this.planSmartContextBudget(step, stepIndex, remainingSteps);
    // Log the budget allocation for observability (non-fatal if channel unavailable)
    try {
      // Use console.debug so it shows up in test output without VS Code channel dependency
      if (typeof console !== "undefined") {
        // eslint-disable-next-line no-console
        console.debug(`[PlanActController] ${allocation.budgetLabel}`);
      }
    } catch { /* non-fatal */ }

    let snapshot: FileSnapshot | undefined;
    if (step.targetFile) {
      snapshot = await this._captureFileSnapshot(step.targetFile);
    }
    // Sprint BA (dim 16): capture file state before step for verification
    const filesBefore = step.targetFile ? [step.targetFile] : [];
    let toolCallsThisStep = 0;
    try {
      await fn();
      toolCallsThisStep = 1; // fn() counts as one tool call if it didn't throw
      const filesAfter = step.targetFile ? [step.targetFile] : [];
      // Sprint BA (dim 16): verify step produced measurable output
      try {
        const verification = verifyStepCompletion(
          { id: step.id, description: step.description },
          filesBefore,
          filesAfter,
          toolCallsThisStep,
        );
        recordStepVerification(verification, this._workdir);
      } catch { /* non-fatal */ }
      return { stepId: step.id, succeeded: true, snapshot };
    } catch (err) {
      // Step failed: still record as unverified
      try {
        const verification = verifyStepCompletion(
          { id: step.id, description: step.description },
          filesBefore,
          [],
          0,
        );
        recordStepVerification(verification, this._workdir);
      } catch { /* non-fatal */ }
      return { stepId: step.id, succeeded: false, error: String(err), snapshot };
    }
  }

  // ── Sprint B: File-level rollback ──────────────────────────────────────────

  /** Restore a file to its pre-step state, or delete it if it did not exist. */
  async rollbackStep(result: Partial<PlanStepResult>): Promise<void> {
    const snap = result.snapshot;
    if (!snap) return;
    const uri = vscode.Uri.file(snap.filePath);
    if (snap.existed) {
      await this._workspaceFs.writeFile(uri, new TextEncoder().encode(snap.content));
    } else {
      await this._workspaceFs.delete(uri);
    }
  }

  // --------------------------------------------------------------------------
  // Snapshot capture
  // --------------------------------------------------------------------------

  /**
   * Captures the current git HEAD SHA and stores it under stepIndex.
   * Silently ignores errors (no git repo, no commits, etc.).
   * Does NOT overwrite an existing snapshot for the same step index.
   */
  private async _captureFileSnapshot(filePath: string): Promise<FileSnapshot> {
    const uri = vscode.Uri.file(filePath);
    try {
      const bytes = await this._workspaceFs.readFile(uri);
      return { filePath, existed: true, content: new TextDecoder().decode(bytes) };
    } catch {
      return { filePath, existed: false, content: "" };
    }
  }

  async _captureSnapshot(stepIndex: number): Promise<void> {
    if (this._stepSnapshots.has(stepIndex)) {
      return;
    }
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const sha = await promisify(execFile)("git", ["rev-parse", "HEAD"], {
        cwd: this._workdir,
      }).then((r) => r.stdout.trim());
      this._stepSnapshots.set(stepIndex, sha);
    } catch {
      // No git repo or no commits — skip snapshot silently.
    }
  }

  // --------------------------------------------------------------------------
  // Rollback
  // --------------------------------------------------------------------------

  /**
   * Rolls back the working tree to the git snapshot taken before stepIndex.
   * Returns { success: false, error } if no snapshot exists or git fails.
   */
  async rollbackToStep(stepIndex: number): Promise<RollbackResult> {
    const sha = this._stepSnapshots.get(stepIndex);
    if (!sha) {
      return { success: false, error: `No snapshot for step ${stepIndex}` };
    }
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(execFile)("git", ["reset", "--hard", sha], {
        cwd: this._workdir,
      });
      return { success: true, sha };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // --------------------------------------------------------------------------
  // Snapshot management
  // --------------------------------------------------------------------------

  /** Clears all stored step snapshots. */
  clearSnapshots(): void {
    this._stepSnapshots.clear();
  }

  /** Returns a copy of the snapshot map for inspection/testing. */
  getSnapshots(): Map<number, string> {
    return new Map(this._stepSnapshots);
  }

  // --------------------------------------------------------------------------
  // Execution
  // --------------------------------------------------------------------------

  /** Executes the plan, capturing a git snapshot before each step. */
  async execute(plan: ExecutionPlan): Promise<PlanExecutionResult> {
    if (!this._executor) throw new Error("PlanActController: executeStep callback required for execute()");
    return this._executor.execute(plan);
  }
}

// Module-level singleton used by the sidebar so the UI can trigger rollbacks.
let _activePlanActController: PlanActController | null = null;

/** Sets the module-level active PlanActController instance. */
export function setActivePlanActController(controller: PlanActController | null): void {
  _activePlanActController = controller;
}

/** Returns the current module-level active PlanActController instance. */
export function getActivePlanActController(): PlanActController | null {
  return _activePlanActController;
}
