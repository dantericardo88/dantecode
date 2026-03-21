// ============================================================================
// @dantecode/cli — Council Command
// User-facing CLI surface for the DanteCode Council Orchestrator.
//
// Usage:
//   dantecode council start "<objective>" --agents=codex,claude,dante --worktrees
//   dantecode council status [run-id]
//   dantecode council lanes [run-id]
//   dantecode council freeze <file>
//   dantecode council thaw <file>
//   dantecode council reassign --from=<agent> [--to=<agent>] [--reason=<reason>]
//   dantecode council merge [--auto]
//   dantecode council verify
//   dantecode council push
//   dantecode council resume <run-id>
// ============================================================================

import { join } from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";

import {
  saveCouncilRun,
  tryLoadCouncilRun,
  listCouncilRuns,
  setRunStatus,
  createCouncilRunState,
  UsageLedger,
} from "@dantecode/core";
import type { AgentKind, CouncilRunState } from "@dantecode/core";

// ANSI colors
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function statusColor(status: string): string {
  if (status === "completed" || status === "verify-passed") return GREEN;
  if (status === "running" || status === "merging" || status === "verifying") return CYAN;
  if (status === "blocked" || status === "failed") return RED;
  if (status === "planning" || status === "paused" || status === "frozen") return YELLOW;
  return DIM;
}

function printRun(state: CouncilRunState): void {
  const sc = statusColor(state.status);
  console.log(`${BOLD}Run:${RESET} ${state.runId}`);
  console.log(`  Status:    ${sc}${state.status}${RESET}`);
  console.log(`  Objective: ${state.objective}`);
  console.log(`  Created:   ${state.createdAt}`);
  console.log(`  Updated:   ${state.updatedAt}`);
  console.log(`  Lanes:     ${state.agents.length}`);
  console.log(`  Handoffs:  ${state.handoffs.length}`);
  console.log(`  Overlaps:  ${state.overlaps.length}`);
}

function findLatestRun(repoRoot: string): CouncilRunState | null {
  try {
    const councilDir = join(repoRoot, ".dantecode", "council");
    const entries = readdirSync(councilDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const p = join(councilDir, e.name, "state.json");
        try {
          return { name: e.name, mtime: statSync(p).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((x): x is { name: string; mtime: number } => x !== null)
      .sort((a, b) => b.mtime - a.mtime);

    if (entries.length === 0) return null;
    const latestPath = join(councilDir, entries[0]!.name, "state.json");
    const raw = readFileSync(latestPath, "utf-8");
    return JSON.parse(raw) as CouncilRunState;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Sub-command handlers
// ----------------------------------------------------------------------------

async function cmdStart(args: string[], projectRoot: string): Promise<void> {
  const objectiveIdx = args.findIndex((a) => !a.startsWith("--"));
  const objective = args[objectiveIdx] ?? "Council orchestration run";

  const agentsFlag =
    args.find((a) => a.startsWith("--agents="))?.slice("--agents=".length) ?? "";
  const agentKinds: AgentKind[] = agentsFlag
    ? (agentsFlag.split(",").map((a) => a.trim()) as AgentKind[])
    : ["dantecode"];

  const auditLogPath = join(projectRoot, ".dantecode", "council", "audit.jsonl");
  const state = createCouncilRunState(projectRoot, objective, auditLogPath);

  const ledger = new UsageLedger();
  for (const kind of agentKinds) {
    ledger.register(kind);
  }

  await saveCouncilRun(state);

  console.log(`${GREEN}${BOLD}Council run started${RESET}`);
  console.log(`  Run ID:    ${CYAN}${state.runId}${RESET}`);
  console.log(`  Objective: ${objective}`);
  console.log(`  Agents:    ${agentKinds.join(", ")}`);
  console.log(`  State:     ${join(projectRoot, ".dantecode", "council", state.runId)}`);
  console.log(``);
  console.log(`${DIM}Use 'dantecode council lanes' to assign tasks.${RESET}`);
}

async function cmdStatus(args: string[], projectRoot: string): Promise<void> {
  const runId = args[0];

  if (runId) {
    const state = await tryLoadCouncilRun(projectRoot, runId);
    if (!state) {
      console.error(`${RED}Run not found: ${runId}${RESET}`);
      process.exit(1);
    }
    printRun(state);
    return;
  }

  const runIds = await listCouncilRuns(projectRoot);
  if (runIds.length === 0) {
    console.log(`${YELLOW}No council runs found in ${projectRoot}${RESET}`);
    console.log(`Start one with: ${CYAN}dantecode council start "<objective>"${RESET}`);
    return;
  }

  console.log(`${BOLD}Council Runs (${runIds.length}):${RESET}`);
  for (const id of runIds) {
    const state = await tryLoadCouncilRun(projectRoot, id);
    if (state) {
      const sc = statusColor(state.status);
      console.log(
        `  ${CYAN}${id}${RESET}  ${sc}${state.status}${RESET}  ${DIM}${state.objective.slice(0, 60)}${RESET}`,
      );
    }
  }
}

async function cmdLanes(args: string[], projectRoot: string): Promise<void> {
  const runId = args[0];
  let state: CouncilRunState | null = null;

  if (runId) {
    state = await tryLoadCouncilRun(projectRoot, runId);
  } else {
    state = findLatestRun(projectRoot);
  }

  if (!state) {
    console.error(`${RED}No active council run found.${RESET}`);
    process.exit(1);
  }

  if (state.agents.length === 0) {
    console.log(`${YELLOW}No lanes assigned yet in run ${state.runId}${RESET}`);
    return;
  }

  console.log(`${BOLD}Council Lanes — Run ${state.runId}${RESET}`);
  for (const lane of state.agents) {
    const sc = statusColor(lane.status);
    const filesPreview =
      lane.assignedFiles.slice(0, 3).join(", ") +
      (lane.assignedFiles.length > 3 ? "..." : "");
    console.log(`  ${CYAN}${lane.laneId}${RESET}`);
    console.log(`    Agent:   ${lane.agentKind}`);
    console.log(`    Status:  ${sc}${lane.status}${RESET}`);
    console.log(`    Files:   ${filesPreview || "(none)"}`);
    console.log(`    Touched: ${lane.touchedFiles.length} files`);
    if (lane.handoffPacketId) {
      console.log(`    Handoff: ${YELLOW}${lane.handoffPacketId}${RESET}`);
    }
  }
}

async function cmdFreeze(args: string[], projectRoot: string): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error(`${RED}Usage: dantecode council freeze <file>${RESET}`);
    process.exit(1);
  }

  const state = findLatestRun(projectRoot);
  if (!state) {
    console.error(`${RED}No active council run.${RESET}`);
    process.exit(1);
  }

  let frozenCount = 0;
  for (const lane of state.agents) {
    if (lane.assignedFiles.includes(filePath) && lane.status === "running") {
      lane.status = "frozen";
      frozenCount++;
    }
  }

  await saveCouncilRun(state);
  console.log(`${YELLOW}Frozen ${frozenCount} lane(s) for file: ${filePath}${RESET}`);
}

async function cmdThaw(args: string[], projectRoot: string): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error(`${RED}Usage: dantecode council thaw <file>${RESET}`);
    process.exit(1);
  }

  const state = findLatestRun(projectRoot);
  if (!state) {
    console.error(`${RED}No active council run.${RESET}`);
    process.exit(1);
  }

  let thawedCount = 0;
  for (const lane of state.agents) {
    if (lane.assignedFiles.includes(filePath) && lane.status === "frozen") {
      lane.status = "paused";
      thawedCount++;
    }
  }

  await saveCouncilRun(state);
  console.log(`${GREEN}Thawed ${thawedCount} lane(s) for file: ${filePath}${RESET}`);
}

async function cmdReassign(args: string[], projectRoot: string): Promise<void> {
  const fromFlag = args.find((a) => a.startsWith("--from="))?.slice("--from=".length);
  const toFlag = args.find((a) => a.startsWith("--to="))?.slice("--to=".length);
  const reasonFlag =
    args.find((a) => a.startsWith("--reason="))?.slice("--reason=".length) ?? "manual";

  if (!fromFlag) {
    console.error(
      `${RED}Usage: dantecode council reassign --from=<agent> [--to=<agent>] [--reason=<reason>]${RESET}`,
    );
    process.exit(1);
  }

  const state = findLatestRun(projectRoot);
  if (!state) {
    console.error(`${RED}No active council run.${RESET}`);
    process.exit(1);
  }

  const lanesFromAgent = state.agents.filter(
    (a) => a.agentKind === fromFlag && a.status === "running",
  );

  if (lanesFromAgent.length === 0) {
    console.log(`${YELLOW}No running lanes found for agent: ${fromFlag}${RESET}`);
    return;
  }

  for (const lane of lanesFromAgent) {
    lane.status = "handed-off";
    console.log(
      `${YELLOW}Lane ${lane.laneId} (${lane.agentKind}) marked for reassignment → ${toFlag ?? "auto-select"}${RESET}`,
    );
    console.log(`  Reason: ${reasonFlag}`);
    console.log(`  ${DIM}Use the council router API to complete reassignment.${RESET}`);
  }

  await saveCouncilRun(state);
}

async function cmdMerge(args: string[], projectRoot: string): Promise<void> {
  const autoFlag = args.includes("--auto");
  const state = findLatestRun(projectRoot);

  if (!state) {
    console.error(`${RED}No active council run.${RESET}`);
    process.exit(1);
  }

  const completedLanes = state.agents.filter((a) => a.status === "completed");
  if (completedLanes.length === 0) {
    console.log(`${YELLOW}No completed lanes to merge yet.${RESET}`);
    return;
  }

  await setRunStatus(projectRoot, state.runId, "merging");
  console.log(`${CYAN}${BOLD}Merge initiated for run ${state.runId}${RESET}`);
  console.log(`  Completed lanes: ${completedLanes.map((l) => l.laneId).join(", ")}`);
  if (autoFlag) {
    console.log(
      `  Mode: ${GREEN}auto (high-confidence merges will proceed automatically)${RESET}`,
    );
  } else {
    console.log(`  Mode: ${YELLOW}manual (all merges require review)${RESET}`);
  }
  console.log(`${DIM}Use the MergeBrain API to perform synthesis.${RESET}`);
}

async function cmdVerify(_args: string[], projectRoot: string): Promise<void> {
  const state = findLatestRun(projectRoot);
  if (!state) {
    console.error(`${RED}No active council run.${RESET}`);
    process.exit(1);
  }

  console.log(`${CYAN}${BOLD}Running verification gates for run ${state.runId}${RESET}`);
  console.log(`${DIM}Gates: typecheck, lint, test, anti-stub, PDSE${RESET}`);
  console.log(
    `${YELLOW}Note: wire up verification via the council router API for full gate execution.${RESET}`,
  );
}

async function cmdPush(_args: string[], projectRoot: string): Promise<void> {
  const state = findLatestRun(projectRoot);
  if (!state) {
    console.error(`${RED}No active council run.${RESET}`);
    process.exit(1);
  }

  if (!state.finalSynthesis?.verificationPassed) {
    console.error(
      `${RED}Cannot push: verification has not passed.${RESET}\n` +
        `Run 'dantecode council verify' first.`,
    );
    process.exit(1);
  }

  if (state.finalSynthesis.decision !== "auto-merge") {
    console.error(
      `${RED}Cannot auto-push: merge decision is '${state.finalSynthesis.decision}'.${RESET}\n` +
        `Manual review required before push.`,
    );
    process.exit(1);
  }

  console.log(`${GREEN}${BOLD}Push authorized for run ${state.runId}${RESET}`);
  console.log(`  Confidence: ${state.finalSynthesis.confidence}`);
  console.log(`  Synthesis:  ${state.finalSynthesis.id}`);
  console.log(`${DIM}Use 'git push' in the main worktree to complete.${RESET}`);
}

async function cmdResume(args: string[], projectRoot: string): Promise<void> {
  const runId = args[0];
  if (!runId) {
    console.error(`${RED}Usage: dantecode council resume <run-id>${RESET}`);
    process.exit(1);
  }

  const state = await tryLoadCouncilRun(projectRoot, runId);
  if (!state) {
    console.error(`${RED}Run not found: ${runId}${RESET}`);
    process.exit(1);
  }

  if (state.status === "completed") {
    console.log(`${YELLOW}Run ${runId} is already completed.${RESET}`);
    return;
  }

  await setRunStatus(projectRoot, runId, "running");
  console.log(`${GREEN}${BOLD}Resumed council run${RESET}`);
  printRun({ ...state, status: "running" });
}

// ----------------------------------------------------------------------------
// Main command router
// ----------------------------------------------------------------------------

/**
 * Entry point for `dantecode council <subcommand> [args]`.
 */
export async function runCouncilCommand(
  args: string[],
  projectRoot: string,
): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "start":
      await cmdStart(rest, projectRoot);
      break;
    case "status":
      await cmdStatus(rest, projectRoot);
      break;
    case "lanes":
      await cmdLanes(rest, projectRoot);
      break;
    case "freeze":
      await cmdFreeze(rest, projectRoot);
      break;
    case "thaw":
      await cmdThaw(rest, projectRoot);
      break;
    case "reassign":
      await cmdReassign(rest, projectRoot);
      break;
    case "merge":
      await cmdMerge(rest, projectRoot);
      break;
    case "verify":
      await cmdVerify(rest, projectRoot);
      break;
    case "push":
      await cmdPush(rest, projectRoot);
      break;
    case "resume":
      await cmdResume(rest, projectRoot);
      break;
    default:
      printHelp();
  }
}

function printHelp(): void {
  console.log(`${BOLD}dantecode council${RESET} — Usage-Aware Multi-Agent Git Conductor`);
  console.log(``);
  console.log(`Sub-commands:`);
  console.log(
    `  ${CYAN}start${RESET} "<objective>" [--agents=codex,claude,dante] [--worktrees]`,
  );
  console.log(`  ${CYAN}status${RESET} [run-id]`);
  console.log(`  ${CYAN}lanes${RESET} [run-id]`);
  console.log(`  ${CYAN}freeze${RESET} <file>`);
  console.log(`  ${CYAN}thaw${RESET} <file>`);
  console.log(
    `  ${CYAN}reassign${RESET} --from=<agent> [--to=<agent>] [--reason=<reason>]`,
  );
  console.log(`  ${CYAN}merge${RESET} [--auto]`);
  console.log(`  ${CYAN}verify${RESET}`);
  console.log(`  ${CYAN}push${RESET}`);
  console.log(`  ${CYAN}resume${RESET} <run-id>`);
}
