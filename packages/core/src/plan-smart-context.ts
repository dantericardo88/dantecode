// ============================================================================
// Sprint BD — Dim 16: Smart Per-Step Plan Context
// Harvested from Plandex's tell_context.go:
//   During plan implementation, only inject context for files the current
//   step actually uses — detected from backtick-wrapped paths and .ext patterns.
//   Prevents context overload and keeps each step focused.
// ============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const LOG_FILE = ".danteforge/plan-smart-context-log.json";

// ─── detectStepFilePaths ──────────────────────────────────────────────────────

/**
 * Detect file paths mentioned in step text (backtick-wrapped or .ext patterns).
 * Only returns paths that actually exist in the project (checked against projectPaths set).
 * Results are deduplicated and sorted.
 */
export function detectStepFilePaths(stepText: string, projectPaths: Set<string>): string[] {
  const candidates = new Set<string>();

  // 1. Find all `backtick-wrapped` tokens
  const backtickRe = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = backtickRe.exec(stepText)) !== null) {
    const token = (m[1] ?? "").trim();
    if (token.length > 0) candidates.add(token);
  }

  // 2. Find all word.ext patterns (e.g. auth.ts, models/user.py)
  // Matches: optional path segments, filename, common code extensions
  const extRe = /(?:[\w/\\-]+\/)*[\w-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|cs|cpp|c|h|rb|php|swift|kt|sh|json|yaml|yml|toml|md|sql|css|scss|html|vue|svelte)/g;
  while ((m = extRe.exec(stepText)) !== null) {
    const raw = m[0] ?? "";
    candidates.add(raw.trim());
  }

  // 3. Filter to only those present in projectPaths
  const matched: string[] = [];
  for (const candidate of candidates) {
    if (projectPaths.has(candidate)) {
      matched.push(candidate);
    }
  }

  // 4. Deduplicate (Set already deduplicates), sort
  return Array.from(new Set(matched)).sort();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StepContextEntry {
  filePath: string;
  content: string;
  /** content.length / 4 (rough chars-to-tokens) */
  tokenEstimate: number;
  /** true if found via backtick/ext detection, false if explicitly provided */
  autoDetected: boolean;
}

export interface StepContextBudget {
  entries: StepContextEntry[];
  totalTokens: number;
  maxTokens: number;
  /** true if some files were dropped to stay under budget */
  truncated: boolean;
  /** files that were dropped due to budget */
  droppedFiles: string[];
}

// ─── buildStepContextBudget ───────────────────────────────────────────────────

/**
 * Build context budget for a single plan step.
 *
 * @param stepText      The natural-language step description.
 * @param priorityFiles Files explicitly requested (loaded first).
 * @param projectFileMap path → content for files to potentially include.
 * @param maxTokens     Token budget (default 8000).
 */
export function buildStepContextBudget(
  stepText: string,
  priorityFiles: string[],
  projectFileMap: Map<string, string>,
  maxTokens = 8000,
): StepContextBudget {
  const entries: StepContextEntry[] = [];
  let totalTokens = 0;
  const droppedFiles: string[] = [];

  function tryAdd(filePath: string, autoDetected: boolean): boolean {
    // Skip already loaded
    if (entries.some((e) => e.filePath === filePath)) return true;

    const content = projectFileMap.get(filePath);
    if (content === undefined) return false;

    const tokenEstimate = Math.ceil(content.length / 4);
    if (totalTokens + tokenEstimate > maxTokens) {
      droppedFiles.push(filePath);
      return false;
    }

    entries.push({ filePath, content, tokenEstimate, autoDetected });
    totalTokens += tokenEstimate;
    return true;
  }

  // Step 1: Load all priorityFiles first
  for (const filePath of priorityFiles) {
    if (!tryAdd(filePath, false)) {
      // If we can't fit a priority file, it's still dropped (budget exceeded)
    }
  }

  // Step 2: Auto-detect additional files from stepText
  const projectPaths = new Set(projectFileMap.keys());
  const detected = detectStepFilePaths(stepText, projectPaths);

  for (const filePath of detected) {
    tryAdd(filePath, true);
  }

  const truncated = droppedFiles.length > 0;

  return { entries, totalTokens, maxTokens, truncated, droppedFiles };
}

// ─── formatStepContext ────────────────────────────────────────────────────────

/**
 * Format context budget as a string block suitable for model injection.
 *
 * Format:
 *   ### Step Context
 *
 *   - filepath:
 *
 *   ```
 *   content
 *   ```
 *
 * If truncated, adds a note about omitted files.
 */
export function formatStepContext(budget: StepContextBudget): string {
  if (budget.entries.length === 0 && !budget.truncated) {
    return "### Step Context\n\n(no relevant files detected)";
  }

  const parts: string[] = ["### Step Context\n"];

  for (const entry of budget.entries) {
    // Detect language from extension for fenced code block
    const ext = entry.filePath.split(".").pop() ?? "";
    const lang = ext || "";
    parts.push(`- ${entry.filePath}:\n\n\`\`\`${lang}\n${entry.content}\n\`\`\``);
  }

  if (budget.truncated) {
    parts.push(
      `Note: ${budget.droppedFiles.length} additional file${budget.droppedFiles.length === 1 ? "" : "s"} were omitted due to context budget.`,
    );
  }

  return parts.join("\n\n");
}

// ─── Logging ──────────────────────────────────────────────────────────────────

export interface PlanStepContextLog {
  planId: string;
  stepId: string;
  stepDescription: string;
  filesLoaded: string[];
  fileCount: number;
  totalTokens: number;
  truncated: boolean;
  timestamp: string;
}

/**
 * Appends a JSONL entry to .danteforge/plan-smart-context-log.json
 */
export function recordStepContextUsage(
  entry: Omit<PlanStepContextLog, "timestamp">,
  projectRoot?: string,
): void {
  try {
    const root = resolve(projectRoot ?? process.cwd());
    const dir = join(root, ".danteforge");
    mkdirSync(dir, { recursive: true });
    const record: PlanStepContextLog = { ...entry, timestamp: new Date().toISOString() };
    appendFileSync(join(dir, "plan-smart-context-log.json"), JSON.stringify(record) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function loadStepContextLog(projectRoot?: string): PlanStepContextLog[] {
  try {
    const root = resolve(projectRoot ?? process.cwd());
    const path = join(root, LOG_FILE);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as PlanStepContextLog);
  } catch { return []; }
}

// ─── PlanSmartContext class (Sprint BJ — dim 16) ─────────────────────────────

/**
 * Per-step budget allocation result returned by `PlanSmartContext.getStepBudget`.
 */
export interface StepBudgetAllocation {
  /** Token budget allocated to this specific step. */
  stepTokenBudget: number;
  /** Human-readable budget description for logging. */
  budgetLabel: string;
  /** True if this step is allocated more budget than average (e.g. early steps). */
  isPriorityStep: boolean;
}

/**
 * PlanSmartContext — Sprint BJ (dim 16).
 *
 * Computes per-step token budgets during plan execution.
 * Early steps receive a larger share (warm-up phase); later steps share the
 * remaining budget equally. This prevents context overload on complex plans
 * while ensuring every step has sufficient context to execute correctly.
 *
 * Budget strategy:
 *   - Step 0 (first step): 40% of totalBudget, regardless of plan length.
 *   - Remaining steps: remaining budget divided equally.
 *   - Steps beyond `remainingSteps+1` reuse the last computed allocation.
 */
export class PlanSmartContext {
  private readonly _totalBudget: number;

  constructor(totalBudget = 8000) {
    this._totalBudget = totalBudget;
  }

  /**
   * Compute the token budget for a specific step.
   *
   * @param step            The step object (must have `id` and `description`).
   * @param stepIndex       0-based index of the current step.
   * @param remainingSteps  Number of steps after the current one (0 = last step).
   * @param totalBudget     Override total budget for this call (uses instance default if omitted).
   * @returns StepBudgetAllocation with the computed budget and a human-readable label.
   */
  getStepBudget(
    step: { id: string; description: string },
    stepIndex: number,
    remainingSteps: number,
    totalBudget?: number,
  ): StepBudgetAllocation {
    const budget = totalBudget ?? this._totalBudget;
    const totalSteps = stepIndex + remainingSteps + 1;

    let stepTokenBudget: number;
    let isPriorityStep = false;

    if (stepIndex === 0 && totalSteps > 1) {
      // First step of a multi-step plan: allocate 40% (warm-up phase)
      stepTokenBudget = Math.floor(budget * 0.4);
      isPriorityStep = true;
    } else if (remainingSteps <= 0) {
      // Last step: allocate all remaining budget (no sharing needed)
      stepTokenBudget = budget;
      isPriorityStep = false;
    } else {
      // Middle steps: equal share of what's left after first-step allocation
      const remainingBudget = stepIndex === 0 ? budget : budget - Math.floor(budget * 0.4);
      const stepsAfterFirst = Math.max(1, totalSteps - 1);
      stepTokenBudget = Math.floor(remainingBudget / stepsAfterFirst);
      isPriorityStep = false;
    }

    // Always clamp to at least 500 tokens so steps are never starved
    stepTokenBudget = Math.max(500, stepTokenBudget);

    const budgetLabel =
      `step[${step.id}] budget=${stepTokenBudget} tokens ` +
      `(${stepIndex + 1}/${totalSteps}, remaining=${remainingSteps})` +
      (isPriorityStep ? " [priority]" : "");

    return { stepTokenBudget, budgetLabel, isPriorityStep };
  }
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export function getContextEfficiency(entries: PlanStepContextLog[]): {
  avgFilesPerStep: number;
  avgTokensPerStep: number;
  truncationRate: number;
} {
  if (entries.length === 0) {
    return { avgFilesPerStep: 0, avgTokensPerStep: 0, truncationRate: 0 };
  }

  const avgFilesPerStep = entries.reduce((s, e) => s + e.fileCount, 0) / entries.length;
  const avgTokensPerStep = entries.reduce((s, e) => s + e.totalTokens, 0) / entries.length;
  const truncationRate = entries.filter((e) => e.truncated).length / entries.length;

  return { avgFilesPerStep, avgTokensPerStep, truncationRate };
}
