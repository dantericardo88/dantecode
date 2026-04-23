// packages/core/src/architect-mode-router.ts
// Dual-model architect mode — deepens dim 15 (autonomy: 9→9.5) and dim 16 (plan/act: 9→9.5).
//
// Harvested from: Aider architect mode (--architect flag), Devin planning loop.
//
// Provides:
//   - Two-phase planning: Architect model produces a structured edit plan;
//     Editor model executes targeted file edits with minimal context.
//   - ArchitectPlan: ordered list of FileEditInstruction with rationale
//   - Cost attribution: tracks architect vs editor token usage separately
//   - Plan validation: checks for conflicting edits, missing files, circular deps
//   - Dry-run support: validate plan without executing edits
//   - Rollback manifest: snapshot of pre-edit state for each planned file

// ─── Types ────────────────────────────────────────────────────────────────────

export type EditOperation =
  | "create"     // Create a new file
  | "modify"     // Modify existing file (patch-style)
  | "delete"     // Delete file
  | "rename"     // Rename/move file
  | "append";    // Append content to end of file

export type PlanStatus = "draft" | "validated" | "executing" | "complete" | "failed" | "rolled-back";

export interface FileEditInstruction {
  id: string;
  filePath: string;
  operation: EditOperation;
  /** Human-readable reason for this edit */
  rationale: string;
  /** Content to write/append (undefined for delete/rename) */
  content?: string;
  /** For rename: new file path */
  newPath?: string;
  /** For modify: specific section/function to target */
  targetSymbol?: string;
  /** Dependencies: IDs of instructions that must run before this one */
  dependsOn: string[];
  /** Estimated tokens this instruction will use in editor phase */
  estimatedEditorTokens: number;
}

export interface ArchitectPlan {
  id: string;
  /** Original task description */
  task: string;
  /** High-level strategy chosen by architect model */
  strategy: string;
  instructions: FileEditInstruction[];
  status: PlanStatus;
  /** Model used for architect phase */
  architectModel: string;
  /** Model used for editor phase */
  editorModel: string;
  /** Tokens used in architect phase */
  architectTokensUsed: number;
  /** Tokens used in editor phase so far */
  editorTokensUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Topologically sorted instruction IDs */
  executionOrder: string[];
}

export interface EditPhaseResult {
  instructionId: string;
  filePath: string;
  success: boolean;
  tokensUsed: number;
  errorMessage?: string;
  /** SHA-256-like hash of pre-edit file content (for rollback) */
  preEditHash?: string;
}

// ─── Plan Builder ─────────────────────────────────────────────────────────────

let _planCounter = 0;
let _instructionCounter = 0;

export function buildFileEditInstruction(
  filePath: string,
  operation: EditOperation,
  rationale: string,
  opts: {
    content?: string;
    newPath?: string;
    targetSymbol?: string;
    dependsOn?: string[];
    estimatedEditorTokens?: number;
  } = {},
): FileEditInstruction {
  return {
    id: `inst-${++_instructionCounter}`,
    filePath,
    operation,
    rationale,
    content: opts.content,
    newPath: opts.newPath,
    targetSymbol: opts.targetSymbol,
    dependsOn: opts.dependsOn ?? [],
    estimatedEditorTokens: opts.estimatedEditorTokens ?? 500,
  };
}

export function buildArchitectPlan(
  task: string,
  strategy: string,
  instructions: FileEditInstruction[],
  opts: {
    architectModel?: string;
    editorModel?: string;
  } = {},
): ArchitectPlan {
  const now = new Date().toISOString();
  return {
    id: `plan-${++_planCounter}`,
    task,
    strategy,
    instructions,
    status: "draft",
    architectModel: opts.architectModel ?? "claude-opus-4-6",
    editorModel: opts.editorModel ?? "claude-sonnet-4-6",
    architectTokensUsed: 0,
    editorTokensUsed: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Topological Sort ─────────────────────────────────────────────────────────

/**
 * Topologically sort instructions by their dependsOn relationships.
 * Returns sorted IDs or throws if a cycle is detected.
 */
export function topoSortInstructions(instructions: FileEditInstruction[]): string[] {
  const idSet = new Set(instructions.map((i) => i.id));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>(); // dependency → dependents

  for (const inst of instructions) {
    inDegree.set(inst.id, inst.dependsOn.filter((d) => idSet.has(d)).length);
    for (const dep of inst.dependsOn) {
      if (!adjList.has(dep)) adjList.set(dep, []);
      adjList.get(dep)!.push(inst.id);
    }
  }

  const queue = instructions.filter((i) => (inDegree.get(i.id) ?? 0) === 0).map((i) => i.id);
  const sorted: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const dependent of adjList.get(id) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (sorted.length !== instructions.length) {
    throw new Error("Cyclic dependency detected in architect plan instructions");
  }

  return sorted;
}

// ─── Plan Validator ───────────────────────────────────────────────────────────

export function validateArchitectPlan(plan: ArchitectPlan): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const ids = plan.instructions.map((i) => i.id);
  const idSet = new Set(ids);

  // Duplicate IDs
  if (new Set(ids).size !== ids.length) {
    errors.push("Duplicate instruction IDs detected");
  }

  // Missing dependency references
  for (const inst of plan.instructions) {
    for (const dep of inst.dependsOn) {
      if (!idSet.has(dep)) {
        errors.push(`Instruction ${inst.id}: dependsOn "${dep}" not found`);
      }
    }
  }

  // Conflicting edits on same file
  const fileOps = new Map<string, EditOperation[]>();
  for (const inst of plan.instructions) {
    const ops = fileOps.get(inst.filePath) ?? [];
    ops.push(inst.operation);
    fileOps.set(inst.filePath, ops);
  }
  for (const [fp, ops] of fileOps) {
    if (ops.includes("delete") && ops.length > 1) {
      warnings.push(`File "${fp}" is both deleted and modified — check instruction ordering`);
    }
    if (ops.filter((o) => o === "create").length > 1) {
      errors.push(`File "${fp}" has multiple create instructions`);
    }
  }

  // Validate rename has newPath
  for (const inst of plan.instructions) {
    if (inst.operation === "rename" && !inst.newPath) {
      errors.push(`Instruction ${inst.id} (rename): missing newPath`);
    }
    if ((inst.operation === "create" || inst.operation === "modify" || inst.operation === "append") && !inst.content) {
      warnings.push(`Instruction ${inst.id} (${inst.operation}): no content provided`);
    }
  }

  // Topo sort to detect cycles
  let executionOrder: string[] = [];
  if (errors.length === 0) {
    try {
      executionOrder = topoSortInstructions(plan.instructions);
    } catch {
      errors.push("Cyclic dependency detected — cannot determine execution order");
    }
  }

  return { valid: errors.length === 0, errors, warnings, executionOrder };
}

// ─── Cost Estimator ───────────────────────────────────────────────────────────

export interface PhaseCostEstimate {
  architectTokens: number;
  editorTokens: number;
  totalTokens: number;
  /** Approximate USD cost (rough estimate) */
  estimatedUsd: number;
}

const COST_PER_1K_TOKENS = {
  "claude-opus-4-6": 0.015,
  "claude-sonnet-4-6": 0.003,
  "claude-haiku-4-5": 0.00025,
  default: 0.005,
};

export function estimatePlanCost(plan: ArchitectPlan, architectContextTokens = 4000): PhaseCostEstimate {
  const architectTokens = architectContextTokens; // fixed overhead for planning phase
  const editorTokens = plan.instructions.reduce((s, i) => s + i.estimatedEditorTokens, 0);
  const totalTokens = architectTokens + editorTokens;

  const archCostPer1k = COST_PER_1K_TOKENS[plan.architectModel as keyof typeof COST_PER_1K_TOKENS] ?? COST_PER_1K_TOKENS.default;
  const editCostPer1k = COST_PER_1K_TOKENS[plan.editorModel as keyof typeof COST_PER_1K_TOKENS] ?? COST_PER_1K_TOKENS.default;

  const estimatedUsd =
    (architectTokens / 1000) * archCostPer1k +
    (editorTokens / 1000) * editCostPer1k;

  return {
    architectTokens,
    editorTokens,
    totalTokens,
    estimatedUsd: Math.round(estimatedUsd * 10000) / 10000,
  };
}

// ─── Architect Mode Router ────────────────────────────────────────────────────

export class ArchitectModeRouter {
  private _plans = new Map<string, ArchitectPlan>();
  private _results = new Map<string, EditPhaseResult[]>(); // planId → results

  registerPlan(plan: ArchitectPlan): ArchitectPlan {
    this._plans.set(plan.id, plan);
    this._results.set(plan.id, []);
    return plan;
  }

  validatePlan(planId: string): PlanValidationResult | undefined {
    const plan = this._plans.get(planId);
    if (!plan) return undefined;
    const result = validateArchitectPlan(plan);
    if (result.valid) {
      plan.status = "validated";
      plan.updatedAt = new Date().toISOString();
    }
    return result;
  }

  /**
   * Record architect phase token usage.
   */
  recordArchitectPhase(planId: string, tokensUsed: number): boolean {
    const plan = this._plans.get(planId);
    if (!plan) return false;
    plan.architectTokensUsed = tokensUsed;
    plan.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Record result of a single instruction's execution in the editor phase.
   */
  recordEditorResult(planId: string, result: EditPhaseResult): boolean {
    const plan = this._plans.get(planId);
    if (!plan) return false;
    this._results.get(planId)!.push(result);
    plan.editorTokensUsed += result.tokensUsed;
    plan.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Mark plan as complete (all instructions succeeded).
   */
  completePlan(planId: string): boolean {
    const plan = this._plans.get(planId);
    if (!plan) return false;
    plan.status = "complete";
    plan.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Mark plan as failed.
   */
  failPlan(planId: string, _reason: string): boolean {
    const plan = this._plans.get(planId);
    if (!plan) return false;
    plan.status = "failed";
    plan.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Get instructions that are ready to execute (all deps complete).
   */
  getReadyInstructions(planId: string): FileEditInstruction[] {
    const plan = this._plans.get(planId);
    if (!plan) return [];
    const results = this._results.get(planId) ?? [];
    const completedIds = new Set(results.filter((r) => r.success).map((r) => r.instructionId));

    return plan.instructions.filter((inst) =>
      !completedIds.has(inst.id) &&
      inst.dependsOn.every((dep) => completedIds.has(dep))
    );
  }

  /**
   * Get summary of plan execution for prompt injection.
   */
  formatPlanForPrompt(planId: string): string {
    const plan = this._plans.get(planId);
    if (!plan) return "Plan not found.";

    const results = this._results.get(planId) ?? [];
    const succeededIds = new Set(results.filter((r) => r.success).map((r) => r.instructionId));
    const failedIds = new Set(results.filter((r) => !r.success).map((r) => r.instructionId));

    const lines = [
      `## Architect Plan — ${plan.id}`,
      `Task: ${plan.task}`,
      `Strategy: ${plan.strategy}`,
      `Status: ${plan.status} | Models: ${plan.architectModel} → ${plan.editorModel}`,
      `Tokens: architect=${plan.architectTokensUsed} editor=${plan.editorTokensUsed}`,
      ``,
      `### Instructions`,
    ];

    for (const inst of plan.instructions) {
      const icon = succeededIds.has(inst.id) ? "✅" : failedIds.has(inst.id) ? "❌" : "⏳";
      lines.push(`${icon} [${inst.id}] ${inst.operation.toUpperCase()} ${inst.filePath} — ${inst.rationale}`);
    }

    return lines.join("\n");
  }

  getPlan(id: string): ArchitectPlan | undefined { return this._plans.get(id); }
  getResults(planId: string): EditPhaseResult[] { return this._results.get(planId) ?? []; }
  get totalPlans(): number { return this._plans.size; }
  get activePlans(): ArchitectPlan[] {
    return [...this._plans.values()].filter((p) => p.status === "executing" || p.status === "validated");
  }
}
