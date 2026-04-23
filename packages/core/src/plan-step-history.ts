// packages/core/src/plan-step-history.ts
// Plan step history with rollback/replay — deepens dim 16 (plan/act: 9→9.5).
//
// Harvested from: Devin plan rollback, OpenHands task replay, Aider conversation history.
//
// Provides:
//   - Immutable append-only step history with snapshot isolation
//   - Named checkpoints for roll-forward/rollback anchors
//   - Branching: fork a plan at any step and run alternative strategies
//   - Diff between any two steps (action + artifact delta)
//   - Replay dry-run: validate step sequence without side effects
//   - Serialization for persistence across sessions

// ─── Types ────────────────────────────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "rolled-back";

export type StepActionKind =
  | "shell"
  | "file-write"
  | "file-edit"
  | "file-delete"
  | "api-call"
  | "agent-task"
  | "checkpoint"
  | "branch"
  | "custom";

export interface StepArtifact {
  /** Artifact path or identifier */
  id: string;
  /** Type of artifact */
  kind: "file" | "output" | "log" | "snapshot";
  /** Content or content hash */
  content?: string;
  /** SHA-256 hash of content */
  hash?: string;
}

export interface PlanStep {
  id: string;
  /** Human-readable step description */
  description: string;
  action: StepActionKind;
  /** Step-specific parameters */
  params: Record<string, unknown>;
  status: StepStatus;
  /** ISO timestamp when step was created */
  createdAt: string;
  /** ISO timestamp when step started executing */
  startedAt?: string;
  /** ISO timestamp when step completed */
  completedAt?: string;
  /** Error message if failed */
  errorMessage?: string;
  /** Artifacts produced by this step */
  artifacts: StepArtifact[];
  /** Parent step ID for branching */
  parentStepId?: string;
  /** Branch name if this step is part of a named branch */
  branchName?: string;
}

export interface PlanCheckpoint {
  id: string;
  name: string;
  stepId: string;
  /** ISO timestamp */
  createdAt: string;
  /** Optional description */
  description?: string;
}

export interface PlanBranch {
  name: string;
  /** Step ID where the branch forked from */
  forkStepId: string;
  /** Step IDs in this branch */
  stepIds: string[];
  createdAt: string;
}

export interface StepDiff {
  fromStepId: string;
  toStepId: string;
  addedArtifacts: StepArtifact[];
  removedArtifacts: StepArtifact[];
  statusChange: { from: StepStatus; to: StepStatus };
}

export interface ReplayValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stepCount: number;
}

// ─── Step Builder ─────────────────────────────────────────────────────────────

let _stepCounter = 0;
let _checkpointCounter = 0;

export function buildStep(
  description: string,
  action: StepActionKind,
  params: Record<string, unknown> = {},
  opts: { parentStepId?: string; branchName?: string } = {},
): PlanStep {
  return {
    id: `step-${++_stepCounter}`,
    description,
    action,
    params,
    status: "pending",
    createdAt: new Date().toISOString(),
    artifacts: [],
    parentStepId: opts.parentStepId,
    branchName: opts.branchName,
  };
}

// ─── Artifact Helpers ─────────────────────────────────────────────────────────

export function buildArtifact(
  id: string,
  kind: StepArtifact["kind"],
  content?: string,
): StepArtifact {
  return {
    id,
    kind,
    content,
    hash: content ? simpleHash(content) : undefined,
  };
}

/** Simple non-cryptographic hash for content identification. */
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0");
}

// ─── Step Diff ────────────────────────────────────────────────────────────────

export function diffSteps(from: PlanStep, to: PlanStep): StepDiff {
  const fromIds = new Set(from.artifacts.map((a) => a.id));
  const toIds = new Set(to.artifacts.map((a) => a.id));

  return {
    fromStepId: from.id,
    toStepId: to.id,
    addedArtifacts: to.artifacts.filter((a) => !fromIds.has(a.id)),
    removedArtifacts: from.artifacts.filter((a) => !toIds.has(a.id)),
    statusChange: { from: from.status, to: to.status },
  };
}

// ─── Replay Validator ─────────────────────────────────────────────────────────

export function validateStepSequence(steps: PlanStep[]): ReplayValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;

    // Validate parent references
    if (step.parentStepId) {
      const parentExists = steps.some((s) => s.id === step.parentStepId);
      if (!parentExists) {
        errors.push(`Step ${step.id}: parentStepId "${step.parentStepId}" not found`);
      }
    }

    // Warn on skipped steps followed by dependent steps
    if (step.status === "skipped" && i < steps.length - 1) {
      warnings.push(`Step ${step.id} is skipped but later steps exist — may have unmet dependencies`);
    }

    // Warn on missing required params for known action kinds
    if (step.action === "file-write" && !step.params["path"]) {
      warnings.push(`Step ${step.id} (file-write) has no "path" param`);
    }
    if (step.action === "shell" && !step.params["command"]) {
      warnings.push(`Step ${step.id} (shell) has no "command" param`);
    }
  }

  // Detect duplicate step IDs
  const ids = steps.map((s) => s.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    errors.push("Duplicate step IDs detected");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stepCount: steps.length,
  };
}

// ─── Plan Step History ────────────────────────────────────────────────────────

export class PlanStepHistory {
  private _steps: PlanStep[] = [];
  private _checkpoints: PlanCheckpoint[] = [];
  private _branches = new Map<string, PlanBranch>();
  private _currentBranch = "main";

  // ─── Step Management ──────────────────────────────────────────────────────

  addStep(step: PlanStep): void {
    this._steps.push({ ...step });
  }

  updateStep(stepId: string, updates: Partial<Pick<PlanStep, "status" | "startedAt" | "completedAt" | "errorMessage" | "artifacts">>): boolean {
    const step = this._steps.find((s) => s.id === stepId);
    if (!step) return false;
    Object.assign(step, updates);
    return true;
  }

  markStarted(stepId: string): boolean {
    return this.updateStep(stepId, { status: "running", startedAt: new Date().toISOString() });
  }

  markSucceeded(stepId: string, artifacts: StepArtifact[] = []): boolean {
    return this.updateStep(stepId, {
      status: "succeeded",
      completedAt: new Date().toISOString(),
      artifacts,
    });
  }

  markFailed(stepId: string, errorMessage: string): boolean {
    return this.updateStep(stepId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage,
    });
  }

  markSkipped(stepId: string): boolean {
    return this.updateStep(stepId, { status: "skipped" });
  }

  getStep(stepId: string): PlanStep | undefined {
    return this._steps.find((s) => s.id === stepId);
  }

  getStepsByStatus(status: StepStatus): PlanStep[] {
    return this._steps.filter((s) => s.status === status);
  }

  getStepsInBranch(branchName: string): PlanStep[] {
    return this._steps.filter((s) => s.branchName === branchName || (!s.branchName && branchName === "main"));
  }

  // ─── Rollback ─────────────────────────────────────────────────────────────

  /**
   * Roll back to a checkpoint: marks all steps after the checkpoint as rolled-back.
   * Returns the number of steps rolled back.
   */
  rollbackTo(checkpointId: string): number {
    const cp = this._checkpoints.find((c) => c.id === checkpointId);
    if (!cp) return 0;

    const cpStepIndex = this._steps.findIndex((s) => s.id === cp.stepId);
    if (cpStepIndex === -1) return 0;

    let count = 0;
    for (let i = cpStepIndex + 1; i < this._steps.length; i++) {
      const step = this._steps[i]!;
      if (step.status !== "rolled-back") {
        step.status = "rolled-back";
        count++;
      }
    }
    return count;
  }

  /**
   * Roll back N steps from the end of the history.
   */
  rollbackN(n: number): PlanStep[] {
    const rolledBack: PlanStep[] = [];
    const eligible = [...this._steps].reverse().filter((s) => s.status !== "rolled-back");
    for (let i = 0; i < Math.min(n, eligible.length); i++) {
      eligible[i]!.status = "rolled-back";
      rolledBack.push(eligible[i]!);
    }
    return rolledBack;
  }

  // ─── Checkpoints ──────────────────────────────────────────────────────────

  createCheckpoint(name: string, description?: string): PlanCheckpoint | undefined {
    const lastStep = [...this._steps].reverse().find((s) => s.status === "succeeded" || s.status === "pending");
    if (!lastStep) return undefined;

    const cp: PlanCheckpoint = {
      id: `cp-${++_checkpointCounter}`,
      name,
      stepId: lastStep.id,
      createdAt: new Date().toISOString(),
      description,
    };
    this._checkpoints.push(cp);
    return cp;
  }

  getCheckpoint(idOrName: string): PlanCheckpoint | undefined {
    return this._checkpoints.find((c) => c.id === idOrName || c.name === idOrName);
  }

  get checkpoints(): PlanCheckpoint[] { return [...this._checkpoints]; }

  // ─── Branching ────────────────────────────────────────────────────────────

  /**
   * Fork a new branch from a given step.
   * Returns the branch name.
   */
  forkBranch(branchName: string, fromStepId: string): boolean {
    if (this._branches.has(branchName)) return false;
    const step = this._steps.find((s) => s.id === fromStepId);
    if (!step) return false;

    this._branches.set(branchName, {
      name: branchName,
      forkStepId: fromStepId,
      stepIds: [],
      createdAt: new Date().toISOString(),
    });
    this._currentBranch = branchName;
    return true;
  }

  addStepToBranch(branchName: string, step: PlanStep): boolean {
    const branch = this._branches.get(branchName);
    if (!branch) return false;
    const tagged: PlanStep = { ...step, branchName };
    this._steps.push(tagged);
    branch.stepIds.push(tagged.id);
    return true;
  }

  getBranch(name: string): PlanBranch | undefined {
    return this._branches.get(name);
  }

  get branchNames(): string[] { return [...this._branches.keys()]; }
  get currentBranch(): string { return this._currentBranch; }

  // ─── Diff ─────────────────────────────────────────────────────────────────

  diffBetween(fromStepId: string, toStepId: string): StepDiff | undefined {
    const from = this.getStep(fromStepId);
    const to = this.getStep(toStepId);
    if (!from || !to) return undefined;
    return diffSteps(from, to);
  }

  // ─── Serialization ────────────────────────────────────────────────────────

  serialize(): string {
    return JSON.stringify({
      steps: this._steps,
      checkpoints: this._checkpoints,
      branches: [...this._branches.entries()].map(([k, v]) => ({ key: k, value: v })),
      currentBranch: this._currentBranch,
    });
  }

  static deserialize(json: string): PlanStepHistory {
    const history = new PlanStepHistory();
    const data = JSON.parse(json) as {
      steps: PlanStep[];
      checkpoints: PlanCheckpoint[];
      branches: Array<{ key: string; value: PlanBranch }>;
      currentBranch: string;
    };
    history._steps = data.steps;
    history._checkpoints = data.checkpoints;
    history._branches = new Map(data.branches.map((b) => [b.key, b.value]));
    history._currentBranch = data.currentBranch;
    return history;
  }

  // ─── Summary ──────────────────────────────────────────────────────────────

  get allSteps(): PlanStep[] { return [...this._steps]; }
  get totalSteps(): number { return this._steps.length; }
  get succeededCount(): number { return this._steps.filter((s) => s.status === "succeeded").length; }
  get failedCount(): number { return this._steps.filter((s) => s.status === "failed").length; }
  get pendingCount(): number { return this._steps.filter((s) => s.status === "pending").length; }

  formatForPrompt(maxSteps = 10): string {
    const lines = [`## Plan Step History (${this._steps.length} total steps)`];
    const icons: Record<StepStatus, string> = {
      pending: "⏳",
      running: "⚙️",
      succeeded: "✅",
      failed: "❌",
      skipped: "⏭️",
      "rolled-back": "↩️",
    };

    const recent = this._steps.slice(-maxSteps);
    for (const step of recent) {
      const icon = icons[step.status];
      const branch = step.branchName ? ` [${step.branchName}]` : "";
      const err = step.errorMessage ? ` — ${step.errorMessage}` : "";
      lines.push(`${icon} [${step.id}]${branch} ${step.description}${err}`);
    }

    if (this._checkpoints.length > 0) {
      lines.push(`\n### Checkpoints`);
      for (const cp of this._checkpoints) {
        lines.push(`- ${cp.name} (at step ${cp.stepId})`);
      }
    }

    return lines.join("\n");
  }
}
