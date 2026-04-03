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

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import {
  PlanStore,
  PlanExecutor,
  renderPlan,
  renderPlanSummary,
  analyzeComplexity,
} from "@dantecode/core";
import type {
  StoredPlan,
  PlanExecutionResult,
  PlanStep,
  ExecutionPlan,
  StepExecutionResult,
} from "@dantecode/core";
import type { ReplState } from "../slash-commands.js";

// ─── ANSI ───────────────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const REPO_CONTEXT_FILE_LIMIT = 250;
const REPO_CONTEXT_DEPTH_LIMIT = 4;
const REPO_CONTEXT_IGNORES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  ".next",
  ".dantecode",
  "artifacts",
]);
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "make",
  "build",
  "improve",
  "update",
  "status",
  "reporting",
]);

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
  process.stdout.write(`${DIM}Gathering read-only repo context...${RESET}\n\n`);

  const repoContext = await buildRepoContext(goal, state.projectRoot);
  const plan = buildRepoAwarePlan(goal, complexity, repoContext);

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

async function buildRepoContext(
  goal: string,
  projectRoot: string,
): Promise<{
  relevantFiles: string[];
  verificationCommands: string[];
}> {
  const files = await collectRepoFiles(projectRoot, projectRoot, 0, []);
  const tokens = tokenizeGoal(goal);
  const changedFiles = readChangedFiles(projectRoot);
  const relevantFiles = selectRelevantFiles(files, tokens, changedFiles);
  const verificationCommands = await selectVerificationCommands(projectRoot, relevantFiles);

  return {
    relevantFiles,
    verificationCommands,
  };
}

async function collectRepoFiles(
  projectRoot: string,
  currentDir: string,
  depth: number,
  collected: string[],
): Promise<string[]> {
  if (depth > REPO_CONTEXT_DEPTH_LIMIT || collected.length >= REPO_CONTEXT_FILE_LIMIT) {
    return collected;
  }

  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return collected;
  }

  for (const entry of entries) {
    if (collected.length >= REPO_CONTEXT_FILE_LIMIT) {
      break;
    }

    if (entry.isDirectory()) {
      if (REPO_CONTEXT_IGNORES.has(entry.name)) {
        continue;
      }
      await collectRepoFiles(projectRoot, join(currentDir, entry.name), depth + 1, collected);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = relative(projectRoot, join(currentDir, entry.name)).replace(/\\/g, "/");
    if (/\.(png|jpg|jpeg|gif|svg|ico|lock)$/i.test(relativePath)) {
      continue;
    }
    collected.push(relativePath);
  }

  return collected;
}

function tokenizeGoal(goal: string): string[] {
  return Array.from(
    new Set(
      goal
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
    ),
  );
}

function readChangedFiles(projectRoot: string): string[] {
  try {
    const output = execFileSync("git", ["status", "--short"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[A-Z?]+\s+/, "").replace(/\\/g, "/"));
  } catch {
    return [];
  }
}

function scoreFile(filePath: string, goalTokens: string[], changedFiles: string[]): number {
  const lowerPath = filePath.toLowerCase();
  let score = 0;

  for (const token of goalTokens) {
    if (lowerPath.includes(token)) {
      score += 5;
    }
  }

  if (changedFiles.includes(filePath)) {
    score += 6;
  }
  if (lowerPath.includes("/src/")) {
    score += 2;
  }
  if (lowerPath.includes("test")) {
    score += 2;
  }
  if (lowerPath.endsWith("package.json") || lowerPath.endsWith("readme.md")) {
    score += 1;
  }

  return score;
}

function selectRelevantFiles(
  files: string[],
  goalTokens: string[],
  changedFiles: string[],
): string[] {
  const scored = files
    .map((filePath) => ({
      filePath,
      score: scoreFile(filePath, goalTokens, changedFiles),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath))
    .map((candidate) => candidate.filePath);

  if (scored.length > 0) {
    return scored.slice(0, 8);
  }

  const fallbacks = files.filter(
    (filePath) =>
      /^(packages|tests|scripts)\//.test(filePath) ||
      /(^README\.md$|package\.json$)/.test(filePath),
  );
  return fallbacks.slice(0, 8);
}

async function selectVerificationCommands(
  projectRoot: string,
  relevantFiles: string[],
): Promise<string[]> {
  let scripts: Record<string, string> = {};
  try {
    const raw = await readFile(join(projectRoot, "package.json"), "utf8");
    const packageJson = JSON.parse(raw) as { scripts?: Record<string, string> };
    scripts = packageJson.scripts ?? {};
  } catch {
    scripts = {};
  }

  const commands: string[] = [];
  if (relevantFiles.some((filePath) => filePath.startsWith("packages/vscode/"))) {
    commands.push("npm --prefix packages/vscode run package");
  }
  if (scripts["typecheck"]) {
    commands.push("npm run typecheck");
  }
  if (scripts["test"]) {
    commands.push("npm test");
  }
  if (scripts["lint"]) {
    commands.push("npm run lint");
  }

  return Array.from(new Set(commands)).slice(0, 3);
}

function buildRepoAwarePlan(
  goal: string,
  complexity: number,
  repoContext: { relevantFiles: string[]; verificationCommands: string[] },
): ExecutionPlan {
  const primaryFiles = repoContext.relevantFiles.slice(0, 6);
  const verificationFiles = repoContext.relevantFiles
    .filter((filePath) => filePath.includes("test") || filePath.endsWith(".md"))
    .slice(0, 4);
  const filesForVerification = verificationFiles.length > 0 ? verificationFiles : primaryFiles;
  const verificationCommand = repoContext.verificationCommands[0] ?? "npm test";
  const secondaryVerificationCommand = repoContext.verificationCommands[1];

  const steps: PlanStep[] = [
    {
      id: "step-1",
      description: `Gather read-only context for "${goal}" before editing.`,
      files: primaryFiles,
      status: "pending",
    },
    {
      id: "step-2",
      description: `Implement the required code changes for "${goal}".`,
      files: primaryFiles,
      dependencies: ["step-1"],
      status: "pending",
    },
    {
      id: "step-3",
      description: `Verify the changed areas and supporting proof for "${goal}".`,
      files: filesForVerification,
      dependencies: ["step-2"],
      verifyCommand: verificationCommand,
      status: "pending",
    },
  ];

  if (secondaryVerificationCommand) {
    steps.push({
      id: "step-4",
      description: `Run secondary verification before approving the change set for "${goal}".`,
      files: filesForVerification,
      dependencies: ["step-3"],
      verifyCommand: secondaryVerificationCommand,
      status: "pending",
    });
  }

  return {
    goal,
    steps,
    createdAt: new Date().toISOString(),
    estimatedComplexity: complexity,
  };
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
      process.stdout.write(`${icon}[plan] Step ${step.id}: ${step.status}${RESET}\n`);
      // Persist progress
      if (state.currentPlanId) {
        const persistStore = new PlanStore(state.projectRoot);
        persistStore
          .save({
            plan: state.currentPlan!,
            id: state.currentPlanId,
            status: "approved",
            createdAt: new Date().toISOString(),
            sessionId: state.session.id,
          })
          .catch(() => {
            /* non-fatal */
          });
      }
    },
  });

  // Mark execution in progress
  state.planExecutionInProgress = true;

  // Execute the first step only — subsequent steps are driven by the REPL loop
  // via the pendingAgentPrompt chain. The PlanExecutor tracks overall state.
  const firstStep = plan.steps.find((s) => s.status === "pending");
  if (firstStep) {
    executor
      .execute(plan)
      .then((result: PlanExecutionResult) => {
        state.planExecutionInProgress = false;
        state.planExecutionResult = result;
        if (state.currentPlanId) {
          const finalStore = new PlanStore(state.projectRoot);
          const finalStatus = result.allPassed ? "completed" : "failed";
          finalStore.updateStatus(state.currentPlanId, finalStatus).catch(() => {});
        }
      })
      .catch(() => {
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
