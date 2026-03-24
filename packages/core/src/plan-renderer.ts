// ============================================================================
// @dantecode/core — Plan Renderer
// ASCII/ANSI rendering of ExecutionPlan for terminal display.
// ============================================================================

import type { ExecutionPlan, PlanStep } from "./architect-planner.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlanRenderOptions {
  colors?: boolean;
  showDeps?: boolean;
  showVerify?: boolean;
  compact?: boolean;
}

// ─── ANSI Helpers ───────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";

function c(text: string, code: string, colors: boolean): string {
  return colors ? `${code}${text}${RESET}` : text;
}

// ─── Status Icons ───────────────────────────────────────────────────────────

function statusIcon(status: PlanStep["status"], colors: boolean): string {
  switch (status) {
    case "pending":
      return c("[ ]", DIM, colors);
    case "in_progress":
      return c("[>]", YELLOW, colors);
    case "completed":
      return c("[x]", GREEN, colors);
    case "failed":
      return c("[!]", RED, colors);
    default:
      return c("[ ]", DIM, colors);
  }
}

// ─── Complexity Badge ───────────────────────────────────────────────────────

export function complexityBadge(score: number, colors = true): string {
  if (score >= 0.8) return c("[CRITICAL]", RED + BOLD, colors);
  if (score >= 0.5) return c("[HIGH]", YELLOW + BOLD, colors);
  if (score >= 0.3) return c("[MED]", CYAN, colors);
  return c("[LOW]", GREEN, colors);
}

// ─── Render Plan ────────────────────────────────────────────────────────────

export function renderPlan(plan: ExecutionPlan, options?: PlanRenderOptions): string {
  const colors = options?.colors ?? true;
  const showDeps = options?.showDeps ?? true;
  const showVerify = options?.showVerify ?? true;
  const compact = options?.compact ?? false;

  const lines: string[] = [];

  // Header
  lines.push(c("Execution Plan", BOLD + CYAN, colors));
  lines.push(`Goal: ${plan.goal}`);
  lines.push(
    `Steps: ${plan.steps.length} | Complexity: ${complexityBadge(plan.estimatedComplexity, colors)} (${plan.estimatedComplexity.toFixed(2)})`,
  );
  lines.push("");

  // Steps
  for (let i = 0; i < plan.steps.length; i++) {
    lines.push(renderPlanStep(plan.steps[i]!, i, { colors, showDeps, showVerify, compact }));
    if (!compact) lines.push("");
  }

  return lines.join("\n");
}

// ─── Render Step ────────────────────────────────────────────────────────────

export function renderPlanStep(step: PlanStep, index: number, options?: PlanRenderOptions): string {
  const colors = options?.colors ?? true;
  const showDeps = options?.showDeps ?? true;
  const showVerify = options?.showVerify ?? true;

  const lines: string[] = [];
  const icon = statusIcon(step.status, colors);
  lines.push(`${icon} ${c(`${index + 1}.`, BOLD, colors)} ${step.description}`);

  if (step.files.length > 0) {
    lines.push(`   Files: ${c(step.files.join(", "), DIM, colors)}`);
  }

  if (showDeps && step.dependencies && step.dependencies.length > 0) {
    lines.push(`   Depends: ${c(step.dependencies.join(", "), DIM, colors)}`);
  }

  if (showVerify && step.verifyCommand) {
    lines.push(`   Verify: ${c(step.verifyCommand, DIM, colors)}`);
  }

  if (step.error) {
    lines.push(`   ${c(`Error: ${step.error}`, RED, colors)}`);
  }

  return lines.join("\n");
}

// ─── Render Summary ─────────────────────────────────────────────────────────

export function renderPlanSummary(plan: ExecutionPlan): string {
  const completed = plan.steps.filter((s) => s.status === "completed").length;
  const inProgress = plan.steps.filter((s) => s.status === "in_progress").length;
  const failed = plan.steps.filter((s) => s.status === "failed").length;
  const pending = plan.steps.filter((s) => s.status === "pending").length;

  const parts: string[] = [`${plan.steps.length} steps`];
  if (completed > 0) parts.push(`${completed} done`);
  if (inProgress > 0) parts.push(`${inProgress} running`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (pending > 0) parts.push(`${pending} pending`);
  parts.push(`complexity: ${plan.estimatedComplexity.toFixed(2)}`);

  return `Plan: ${parts.join(" | ")}`;
}
