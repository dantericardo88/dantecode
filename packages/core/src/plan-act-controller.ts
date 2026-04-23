// packages/core/src/plan-act-controller.ts
// Structured Plan/Act mode separation — enforces a planning phase before
// code execution, with explicit user approval gate.
//
// Closes dim 16 (Plan/Act separation: 7→9) gap vs Cursor/Opus which have
// explicit plan-first modes. DanteCode already has wave-based orchestration;
// this adds a lightweight "show plan → await approval → execute" gate
// that works for single-session tasks without requiring full wave state.
//
// Plandex-harvested: plan stream + explicit apply step pattern.

export type PlanActPhase = "planning" | "awaiting_approval" | "executing" | "complete" | "rejected";

/** Execution status for a single plan step. */
export type ExecutionStepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export interface PlanStep {
  id: string;
  description: string;
  /** Estimated risk: low = read-only, medium = creates files, high = destructive ops */
  risk: "low" | "medium" | "high";
  /** Files that will be modified (may be empty if unknown at plan time) */
  affectedFiles?: string[];
  /** Whether this step requires a tool call */
  requiresTool?: boolean;
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  estimatedChangedFiles: number;
  hasDestructiveSteps: boolean;
  createdAt: string;
}

export interface PlanApprovalResult {
  approved: boolean;
  modifiedPlan?: ExecutionPlan;
  rejectionReason?: string;
}

// ─── Plan Parser ─────────────────────────────────────────────────────────────

const STEP_PATTERN = /^\s*(?:\d+\.|[-*])\s+(.+)/;
const HIGH_RISK_KEYWORDS = /\bdelete\b|\bremove\b|\bdrop\b|\btruncate\b|\brm\b|\buninstall\b|\bforce\b/i;
const MEDIUM_RISK_KEYWORDS = /\bcreate\b|\bwrite\b|\bmodify\b|\bupdate\b|\badd\b|\binstall\b|\bnpm\b|\bpip\b/i;
const FILE_PATH_PATTERN = /`([^`]+\.[a-z]{1,10})`|"([^"]+\.[a-z]{1,10})"/g;

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function extractStepRisk(description: string): PlanStep["risk"] {
  if (HIGH_RISK_KEYWORDS.test(description)) return "high";
  if (MEDIUM_RISK_KEYWORDS.test(description)) return "medium";
  return "low";
}

function extractAffectedFiles(description: string): string[] {
  const files: string[] = [];
  let match: RegExpExecArray | null;
  FILE_PATH_PATTERN.lastIndex = 0;
  while ((match = FILE_PATH_PATTERN.exec(description)) !== null) {
    files.push(match[1] ?? match[2] ?? "");
  }
  return [...new Set(files)].filter(Boolean);
}

/**
 * Parse a model response into a structured ExecutionPlan.
 * Strategy: JSON-first (structured output from buildPlanModeSystemPromptStructured),
 * then falls back to regex parsing of free-text numbered/bullet lists.
 */
export function parsePlan(text: string, goal: string): ExecutionPlan {
  // --- JSON-first path ---
  const jsonPlan = tryParseJsonPlan(text, goal);
  if (jsonPlan) return jsonPlan;

  // --- Regex fallback path ---
  const lines = text.split("\n");
  const steps: PlanStep[] = [];

  for (const line of lines) {
    const match = line.match(STEP_PATTERN);
    if (!match) continue;
    const description = (match[1] ?? "").trim();
    if (description.length < 5) continue;

    steps.push({
      id: generateId(),
      description,
      risk: extractStepRisk(description),
      affectedFiles: extractAffectedFiles(description),
      requiresTool: /\btool\b|\brun\b|\bexecute\b|\bbash\b/i.test(description),
    });
  }

  const affectedFiles = new Set(steps.flatMap((s) => s.affectedFiles ?? []));
  const hasDestructiveSteps = steps.some((s) => s.risk === "high");

  return {
    id: generateId(),
    goal,
    steps,
    estimatedChangedFiles: affectedFiles.size,
    hasDestructiveSteps,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Attempt to parse a JSON plan from the model response.
 * Accepts raw JSON or a ```json fenced block.
 * Returns null if parsing fails or the result doesn't have a steps array.
 */
function tryParseJsonPlan(text: string, goal: string): ExecutionPlan | null {
  // Extract from ```json ... ``` fenced block
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenceMatch ? fenceMatch[1]! : text.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>)["steps"])) {
    return null;
  }

  const raw = parsed as {
    goal?: string;
    steps: Array<{ description?: string; risk?: string; affectedFiles?: string[]; requiresTool?: boolean }>;
  };

  const steps: PlanStep[] = raw.steps
    .filter((s) => s.description && String(s.description).trim().length >= 5)
    .map((s) => ({
      id: generateId(),
      description: String(s.description ?? ""),
      risk: (["low", "medium", "high"].includes(s.risk ?? "") ? s.risk : extractStepRisk(String(s.description ?? ""))) as PlanStep["risk"],
      affectedFiles: Array.isArray(s.affectedFiles) ? (s.affectedFiles as string[]) : extractAffectedFiles(String(s.description ?? "")),
      requiresTool: Boolean(s.requiresTool),
    }));

  const affectedFiles = new Set(steps.flatMap((s) => s.affectedFiles ?? []));
  return {
    id: generateId(),
    goal: raw.goal ?? goal,
    steps,
    estimatedChangedFiles: affectedFiles.size,
    hasDestructiveSteps: steps.some((s) => s.risk === "high"),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Format a plan for display to the user (Markdown output).
 */
export function formatPlanForDisplay(plan: ExecutionPlan): string {
  const riskIcon = (r: PlanStep["risk"]) => ({ low: "🟢", medium: "🟡", high: "🔴" }[r]);
  const lines: string[] = [
    `## Plan: ${plan.goal}`,
    "",
    `**Steps:** ${plan.steps.length}  |  **Files:** ~${plan.estimatedChangedFiles}${plan.hasDestructiveSteps ? "  |  ⚠ Contains destructive operations" : ""}`,
    "",
  ];

  plan.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${riskIcon(step.risk)} ${step.description}`);
    if (step.affectedFiles && step.affectedFiles.length > 0) {
      lines.push(`   _Files: ${step.affectedFiles.join(", ")}_`);
    }
  });

  lines.push("", "---", "Reply **yes** to execute, **no** to cancel, or describe changes to the plan.");
  return lines.join("\n");
}

// ─── Plan/Act Controller ──────────────────────────────────────────────────────

export interface PlanActOptions {
  /** Automatically approve plans with no destructive steps and ≤ N files */
  autoApproveThreshold?: number;
  /** If true, always require explicit approval (even for safe plans) */
  alwaysRequireApproval?: boolean;
  /** Called whenever a step's status changes */
  onStepChange?: (stepId: string, status: ExecutionStepStatus, error?: string) => void;
}

/** Serialized snapshot for checkpoint/resume. */
export interface PlanActSnapshot {
  phase: PlanActPhase;
  plan: ExecutionPlan | null;
  stepStatuses: Array<{ stepId: string; status: ExecutionStepStatus; error?: string }>;
  currentStepIndex: number;
}

/**
 * Manages the Plan → Approve → Execute lifecycle for a single task.
 *
 * Usage:
 *   const controller = new PlanActController();
 *   controller.setPlan(parsePlan(modelResponse, goal));
 *   if (controller.requiresApproval()) {
 *     // show plan to user, await their response
 *     const approved = controller.processApproval(userInput);
 *   }
 *   if (controller.canExecute()) {
 *     // run the execution phase
 *   }
 */
export class PlanActController {
  private _phase: PlanActPhase = "planning";
  private _plan: ExecutionPlan | null = null;
  private readonly _opts: Required<Omit<PlanActOptions, "onStepChange">> & Pick<PlanActOptions, "onStepChange">;
  /** step id → status */
  private _stepStatuses = new Map<string, ExecutionStepStatus>();
  /** step id → error message */
  private _stepErrors = new Map<string, string>();
  /** Index into plan.steps of the currently running step (-1 = not started) */
  private _currentStepIndex = -1;

  constructor(options: PlanActOptions = {}) {
    this._opts = {
      autoApproveThreshold: options.autoApproveThreshold ?? 3,
      alwaysRequireApproval: options.alwaysRequireApproval ?? false,
      onStepChange: options.onStepChange,
    };
  }

  get phase(): PlanActPhase { return this._phase; }
  get plan(): ExecutionPlan | null { return this._plan; }

  /** 0-based index of the currently executing step, -1 if none started. */
  get currentStepIndex(): number { return this._currentStepIndex; }

  /** The PlanStep currently executing (or null). */
  get currentStep(): PlanStep | null {
    if (!this._plan || this._currentStepIndex < 0) return null;
    return this._plan.steps[this._currentStepIndex] ?? null;
  }

  /** Snapshot of step statuses (step id → status). */
  get stepStatuses(): ReadonlyMap<string, ExecutionStepStatus> {
    return this._stepStatuses;
  }

  /** Steps not yet complete or skipped. */
  remainingSteps(): PlanStep[] {
    if (!this._plan) return [];
    return this._plan.steps.filter((s) => {
      const st = this._stepStatuses.get(s.id) ?? "pending";
      return st !== "complete" && st !== "skipped";
    });
  }

  /** Set the plan produced by the model's planning response. */
  setPlan(plan: ExecutionPlan): void {
    this._plan = plan;
    this._stepStatuses.clear();
    this._stepErrors.clear();
    this._currentStepIndex = -1;
    for (const step of plan.steps) {
      this._stepStatuses.set(step.id, "pending");
    }
    this._phase = "awaiting_approval";

    // Auto-approve safe plans below the threshold
    if (!this._opts.alwaysRequireApproval && this.isSafeForAutoApproval()) {
      this._phase = "executing";
    }
  }

  /** Whether the user needs to explicitly approve before execution. */
  requiresApproval(): boolean {
    return this._phase === "awaiting_approval";
  }

  /** Whether execution can proceed (plan approved or auto-approved). */
  canExecute(): boolean {
    return this._phase === "executing";
  }

  /**
   * Process the user's approval response.
   * Returns true if execution should proceed.
   */
  processApproval(userInput: string): boolean {
    const trimmed = userInput.trim().toLowerCase();
    const isApproval = /^(yes|y|ok|approve|go|proceed|execute|confirm|sure|yep|yup)/.test(trimmed);
    const isRejection = /^(no|n|cancel|stop|reject|abort|nope)/.test(trimmed);

    if (isRejection) {
      this._phase = "rejected";
      return false;
    }

    if (isApproval) {
      this._phase = "executing";
      return true;
    }

    // Non-yes/no: treat as plan modification request, stay in awaiting_approval
    return false;
  }

  /**
   * Advance to the next pending step.
   * Marks the current step complete (if running), then sets the next step to running.
   * Returns the new current step, or null if all steps are done.
   */
  advanceToNextStep(): PlanStep | null {
    if (!this._plan) return null;

    // Mark current step complete
    if (this._currentStepIndex >= 0) {
      const current = this._plan.steps[this._currentStepIndex];
      if (current && this._stepStatuses.get(current.id) === "running") {
        this._setStepStatus(current.id, "complete");
      }
    }

    // Find next pending step
    const nextIdx = this._plan.steps.findIndex((s, i) => {
      if (i <= this._currentStepIndex) return false;
      const st = this._stepStatuses.get(s.id) ?? "pending";
      return st === "pending";
    });

    if (nextIdx === -1) {
      // All steps done
      this._currentStepIndex = this._plan.steps.length;
      this._phase = "complete";
      return null;
    }

    this._currentStepIndex = nextIdx;
    const next = this._plan.steps[nextIdx]!;
    this._setStepStatus(next.id, "running");
    return next;
  }

  /** Mark a specific step as complete by id. */
  markStepComplete(stepId: string): void {
    this._setStepStatus(stepId, "complete");
  }

  /** Mark a specific step as failed by id, with optional error message. */
  markStepFailed(stepId: string, error?: string): void {
    this._setStepStatus(stepId, "failed", error);
    if (error) this._stepErrors.set(stepId, error);
  }

  /** Mark a specific step as skipped by id. */
  markStepSkipped(stepId: string): void {
    this._setStepStatus(stepId, "skipped");
  }

  /** Get the error message for a failed step (undefined if not failed). */
  getStepError(stepId: string): string | undefined {
    return this._stepErrors.get(stepId);
  }

  /**
   * Rewind the plan to a specific step: reset that step and all subsequent
   * steps back to "pending", and set currentStepIndex to that step - 1.
   *
   * Allows re-running from a particular step when an earlier fix is needed.
   */
  rewindToStep(stepId: string): boolean {
    if (!this._plan) return false;
    const idx = this._plan.steps.findIndex((s) => s.id === stepId);
    if (idx === -1) return false;

    for (let i = idx; i < this._plan.steps.length; i++) {
      const step = this._plan.steps[i]!;
      this._stepStatuses.set(step.id, "pending");
      this._stepErrors.delete(step.id);
    }
    this._currentStepIndex = idx - 1;
    if (this._phase === "complete") this._phase = "executing";
    return true;
  }

  /**
   * Serialize current state to a JSON string for checkpoint persistence.
   */
  serializeState(): string {
    const snapshot: PlanActSnapshot = {
      phase: this._phase,
      plan: this._plan,
      stepStatuses: [...this._stepStatuses.entries()].map(([stepId, status]) => ({
        stepId,
        status,
        error: this._stepErrors.get(stepId),
      })),
      currentStepIndex: this._currentStepIndex,
    };
    return JSON.stringify(snapshot);
  }

  /**
   * Restore state from a previously serialized snapshot.
   * Returns true on success, false if the JSON is invalid.
   */
  restoreState(json: string): boolean {
    try {
      const snap = JSON.parse(json) as PlanActSnapshot;
      this._phase = snap.phase;
      this._plan = snap.plan;
      this._currentStepIndex = snap.currentStepIndex;
      this._stepStatuses.clear();
      this._stepErrors.clear();
      for (const { stepId, status, error } of snap.stepStatuses) {
        this._stepStatuses.set(stepId, status);
        if (error) this._stepErrors.set(stepId, error);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Mark the plan as complete. */
  complete(): void {
    this._phase = "complete";
  }

  /** Reset for a new task. */
  reset(): void {
    this._phase = "planning";
    this._plan = null;
    this._stepStatuses.clear();
    this._stepErrors.clear();
    this._currentStepIndex = -1;
  }

  /** Formats the plan as a string for the model's display. */
  formatPlan(): string {
    if (!this._plan) return "";
    return formatPlanForDisplay(this._plan);
  }

  /**
   * Format execution progress for display (shows ✓/✗/⏵/⏸ per step).
   */
  formatProgress(): string {
    if (!this._plan) return "";
    const icon = (status: ExecutionStepStatus) =>
      ({ pending: "⏸", running: "⏵", complete: "✓", failed: "✗", skipped: "⊘" })[status];

    const lines = [`## Plan Progress: ${this._plan.goal}`, ""];
    for (const step of this._plan.steps) {
      const status = this._stepStatuses.get(step.id) ?? "pending";
      const err = this._stepErrors.get(step.id);
      lines.push(`${icon(status)} ${step.description}${err ? ` — ⚠ ${err}` : ""}`);
    }
    const done = [...this._stepStatuses.values()].filter((s) => s === "complete").length;
    lines.push("", `**Progress:** ${done}/${this._plan.steps.length} steps complete`);
    return lines.join("\n");
  }

  private _setStepStatus(stepId: string, status: ExecutionStepStatus, error?: string): void {
    this._stepStatuses.set(stepId, status);
    this._opts.onStepChange?.(stepId, status, error);
  }

  private isSafeForAutoApproval(): boolean {
    if (!this._plan) return false;
    if (this._plan.hasDestructiveSteps) return false;
    if (this._plan.estimatedChangedFiles > this._opts.autoApproveThreshold) return false;
    return true;
  }
}

/** Build the system prompt injection for plan mode. */
export function buildPlanModeSystemPrompt(goal: string): string {
  return [
    "## Plan Mode Active",
    "",
    `You are in **Plan mode** for the following goal: ${goal}`,
    "",
    "**Instructions:**",
    "1. First, produce a numbered list of ALL steps you will take to complete this goal.",
    "2. For each step, specify which files will be modified.",
    "3. Flag any step that involves deleting files, running destructive commands, or making irreversible changes.",
    "4. Do NOT start executing yet — produce the plan only.",
    "5. End your response with: `Ready to execute. Awaiting approval.`",
  ].join("\n");
}

/**
 * Structured plan mode system prompt — requests JSON output for reliable parsing.
 * Use this in place of buildPlanModeSystemPrompt when the model supports structured output.
 * The parser in parsePlan() automatically detects JSON and falls back to regex.
 */
export function buildPlanModeSystemPromptStructured(goal: string): string {
  return [
    "## Plan Mode Active — Structured Output",
    "",
    `You are in **Plan mode** for the following goal: ${goal}`,
    "",
    "**Output format (required):** Respond with a JSON object in a ```json block:",
    "```json",
    JSON.stringify(
      {
        goal: "<restate the goal>",
        steps: [
          {
            description: "<what this step does>",
            risk: "low | medium | high",
            affectedFiles: ["path/to/file.ts"],
            requiresTool: false,
          },
        ],
      },
      null,
      2,
    ),
    "```",
    "",
    "risk levels: low = read-only, medium = creates/modifies files, high = destructive/irreversible",
    "Do NOT start executing — produce the plan only.",
  ].join("\n");
}
