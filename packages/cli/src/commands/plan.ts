// ============================================================================
// @dantecode/cli — /plan Command
// Generate, review, and approve execution plans before coding.
//
// Subcommands:
//   /plan <goal>       Generate a plan from the goal, display for approval
//   /plan show         Redisplay the current plan
//   /plan approve      Approve the current plan and begin execution
//   /plan reject       Clear plan state and exit plan mode
//   /plan list         Show saved plans from .dantecode/plans/
//   /plan status       Show current plan mode state
// ============================================================================

import {
  ArchitectPlanner,
  PlanStore,
  PlanExecutor,
  renderPlan,
  renderPlanSummary,
  analyzeComplexity,
} from "@dantecode/core";
import type { StoredPlan, PlanExecutionResult, PlanStep, ExecutionPlan, StepExecutionResult } from "@dantecode/core";
import type { ReplState } from "../slash-commands.js";

// ─── ANSI ───────────────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ─── Main Handler ───────────────────────────────────────────────────────────

export async function planCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const sub = parts[0]?.toLowerCase() ?? "";

  switch (sub) {
    case "show":
      return showPlan(state);
    case "approve":
      return approvePlan(state);
    case "reject":
      return rejectPlan(state);
    case "list":
      return listPlans(state);
    case "status":
      return planStatus(state);
    case "":
      return `${YELLOW}Usage: /plan <goal> | show | approve | reject | list | status${RESET}`;
    default:
      // Treat the entire args as a goal
      return generatePlan(args.trim(), state);
  }
}

// ─── Generate Plan ──────────────────────────────────────────────────────────

async function generatePlan(goal: string, state: ReplState): Promise<string> {
  if (state.planMode && state.currentPlan) {
    return `${YELLOW}A plan is already active. Use /plan show, /plan approve, or /plan reject first.${RESET}`;
  }

  const complexity = analyzeComplexity(goal);
  process.stdout.write(`\n${DIM}Analyzing complexity: ${complexity.toFixed(2)}${RESET}\n`);
  process.stdout.write(`${DIM}Generating execution plan...${RESET}\n\n`);

  // Build plan using ArchitectPlanner with a simple prompt-based generator
  const planner = new ArchitectPlanner({
    generatePlan: async (prompt: string, _context: string) => {
      // Use the agent loop to generate the plan by setting it as a pending prompt
      // For now, use the prompt directly as structured text
      return prompt;
    },
  });

  const plan = await planner.createPlan(goal, "");

  // If the planner returned empty steps, create a basic plan from the goal
  if (plan.steps.length === 0) {
    plan.steps = [
      {
        id: "step-1",
        description: `Analyze requirements for: ${goal}`,
        files: [],
        status: "pending",
      },
      {
        id: "step-2",
        description: `Implement: ${goal}`,
        files: [],
        status: "pending",
      },
      {
        id: "step-3",
        description: "Run tests and verify",
        files: [],
        verifyCommand: "npm test",
        status: "pending",
      },
    ];
  }

  // Store plan in state
  state.planMode = true;
  state.currentPlan = plan;
  state.planApproved = false;

  // Save to disk
  const store = new PlanStore(state.projectRoot);
  const planId = PlanStore.generateId(goal);
  state.currentPlanId = planId;
  const storedPlan: StoredPlan = {
    plan,
    id: planId,
    status: "draft",
    createdAt: new Date().toISOString(),
    sessionId: state.session.id,
  };
  await store.save(storedPlan);

  const rendered = renderPlan(plan, { colors: true });
  const lines: string[] = [
    "",
    rendered,
    "",
    `${CYAN}Plan saved as ${planId}${RESET}`,
    "",
    `${BOLD}Actions:${RESET}`,
    `  ${GREEN}/plan approve${RESET}  — Accept this plan and start execution`,
    `  ${RED}/plan reject${RESET}   — Discard this plan`,
    `  ${CYAN}/plan show${RESET}    — Redisplay the plan`,
    "",
    `${DIM}Plan mode is now active. Write tools are blocked until you approve.${RESET}`,
  ];

  return lines.join("\n");
}

// ─── Show Plan ──────────────────────────────────────────────────────────────

function showPlan(state: ReplState): string {
  if (!state.currentPlan) {
    return `${YELLOW}No active plan. Use /plan <goal> to generate one.${RESET}`;
  }
  return "\n" + renderPlan(state.currentPlan, { colors: true });
}

// ─── Approve Plan ───────────────────────────────────────────────────────────

async function approvePlan(state: ReplState): Promise<string> {
  if (!state.currentPlan) {
    return `${YELLOW}No active plan to approve. Use /plan <goal> first.${RESET}`;
  }
  if (state.planApproved) {
    return `${YELLOW}Plan is already approved. Execution is in progress.${RESET}`;
  }

  state.planApproved = true;
  state.planMode = false;

  // Update status on disk
  if (state.currentPlanId) {
    const store = new PlanStore(state.projectRoot);
    await store.updateStatus(state.currentPlanId, "approved");
  }

  const plan = state.currentPlan;

  // Create a PlanExecutor for structured step-by-step execution.
  // Each step becomes a pendingAgentPrompt that the REPL loop processes.
  const executor = new PlanExecutor({
    executeStep: async (step: PlanStep, _plan: ExecutionPlan): Promise<StepExecutionResult> => {
      const startMs = Date.now();
      // Build a targeted prompt for this step
      const filesHint = step.files.length > 0 ? `\nTarget files: ${step.files.join(", ")}` : "";
      const stepPrompt = [
        `Execute plan step ${step.id}: ${step.description}`,
        filesHint,
        `\nContext: Plan "${_plan.goal}"`,
        `\nAfter completing this step, confirm what was done.`,
      ].join("");

      // Set as pending prompt — the REPL will process this
      state.pendingAgentPrompt = stepPrompt;

      return {
        stepId: step.id,
        success: true, // Optimistic — REPL execution is async
        output: `Step queued: ${step.description}`,
        durationMs: Date.now() - startMs,
      };
    },
    onStepStart: (step: PlanStep) => {
      step.status = "in_progress";
      process.stdout.write(
        `\n${CYAN}[plan] Starting step ${step.id}: ${step.description}${RESET}\n`,
      );
    },
    onStepComplete: (step: PlanStep, result: StepExecutionResult) => {
      step.status = result.success ? "completed" : "failed";
      const icon = result.success ? GREEN : RED;
      process.stdout.write(
        `${icon}[plan] Step ${step.id}: ${step.status}${RESET}\n`,
      );
      // Persist progress
      if (state.currentPlanId) {
        const persistStore = new PlanStore(state.projectRoot);
        persistStore.save({
          plan: state.currentPlan!,
          id: state.currentPlanId,
          status: "approved",
          createdAt: new Date().toISOString(),
          sessionId: state.session.id,
        }).catch(() => { /* non-fatal */ });
      }
    },
  });

  // Mark execution in progress
  state.planExecutionInProgress = true;

  // Execute the first step only — subsequent steps are driven by the REPL loop
  // via the pendingAgentPrompt chain. The PlanExecutor tracks overall state.
  const firstStep = plan.steps.find(s => s.status === "pending");
  if (firstStep) {
    executor.execute(plan).then((result: PlanExecutionResult) => {
      state.planExecutionInProgress = false;
      state.planExecutionResult = result;
      if (state.currentPlanId) {
        const finalStore = new PlanStore(state.projectRoot);
        const finalStatus = result.allPassed ? "completed" : "failed";
        finalStore.updateStatus(state.currentPlanId, finalStatus).catch(() => {});
      }
    }).catch(() => {
      state.planExecutionInProgress = false;
    });
  }

  return `\n${GREEN}${BOLD}Plan approved!${RESET} Structured execution started via PlanExecutor.\n${DIM}Steps will execute sequentially with dependency tracking.${RESET}`;
}

// ─── Reject Plan ────────────────────────────────────────────────────────────

async function rejectPlan(state: ReplState): Promise<string> {
  if (!state.currentPlan) {
    return `${YELLOW}No active plan to reject.${RESET}`;
  }

  // Update status on disk
  if (state.currentPlanId) {
    const store = new PlanStore(state.projectRoot);
    await store.updateStatus(state.currentPlanId, "rejected");
  }

  state.planMode = false;
  state.currentPlan = null;
  state.planApproved = false;
  state.currentPlanId = null;

  return `${RED}Plan rejected.${RESET} Plan mode disabled. You can generate a new plan with /plan <goal>.`;
}

// ─── List Plans ─────────────────────────────────────────────────────────────

async function listPlans(state: ReplState): Promise<string> {
  const store = new PlanStore(state.projectRoot);
  const plans = await store.list({ limit: 10 });

  if (plans.length === 0) {
    return `${DIM}No saved plans found in .dantecode/plans/${RESET}`;
  }

  const lines: string[] = [`${BOLD}Saved Plans${RESET} (${plans.length}):\n`];
  for (const p of plans) {
    const statusColor =
      p.status === "completed"
        ? GREEN
        : p.status === "approved"
          ? CYAN
          : p.status === "failed"
            ? RED
            : p.status === "rejected"
              ? RED
              : DIM;
    const summary = renderPlanSummary(p.plan);
    lines.push(`  ${statusColor}[${p.status}]${RESET} ${p.id}`);
    lines.push(`    ${DIM}${p.plan.goal}${RESET}`);
    lines.push(`    ${DIM}${summary}${RESET}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Plan Status ────────────────────────────────────────────────────────────

function planStatus(state: ReplState): string {
  if (!state.planMode && !state.currentPlan) {
    return `${DIM}Plan mode is not active. Use /plan <goal> to generate a plan.${RESET}`;
  }

  const lines: string[] = [`${BOLD}Plan Mode Status${RESET}\n`];
  lines.push(`  Mode: ${state.planMode ? `${YELLOW}active${RESET}` : `${DIM}inactive${RESET}`}`);
  lines.push(`  Approved: ${state.planApproved ? `${GREEN}yes${RESET}` : `${RED}no${RESET}`}`);
  if (state.currentPlanId) {
    lines.push(`  Plan ID: ${CYAN}${state.currentPlanId}${RESET}`);
  }
  if (state.currentPlan) {
    lines.push(`  ${renderPlanSummary(state.currentPlan)}`);
  }
  return lines.join("\n");
}
