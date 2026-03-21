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

import { join, dirname } from "node:path";
import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";

import {
  saveCouncilRun,
  tryLoadCouncilRun,
  listCouncilRuns,
  CouncilOrchestrator,
  DanteCodeAdapter,
  ClaudeCodeAdapter,
  CodexAdapter,
  AntigravityAdapter,
  BridgeListener,
} from "@dantecode/core";
import type { AgentKind, CouncilRunState, CouncilAgentAdapter, SelfLaneExecutor, AgentCommandConfig } from "@dantecode/core";
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

const execAsync = promisify(exec);

/**
 * Creates a SelfLaneExecutor that spawns a child dantecode process
 * to execute council task prompts inside a lane worktree.
 */
function createSelfExecutor(projectRoot: string): SelfLaneExecutor {
  return async (prompt, worktreePath, opts) => {
    const cwd = worktreePath ?? projectRoot;
    const promptFile = join(cwd, ".dantecode", "council", "task.txt");
    await mkdir(dirname(promptFile), { recursive: true });
    await writeFile(promptFile, prompt, "utf-8");

    try {
      const maxRounds = opts?.maxRounds ?? 80;
      const bin = join(projectRoot, "node_modules/.bin/dantecode");
      const { stdout } = await execAsync(
        `"${bin}" --prompt-file "${promptFile}" --max-rounds ${maxRounds}`,
        { cwd, timeout: 30 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 },
      );

      let touchedFiles: string[] = [];
      try {
        const { stdout: diffOut } = await execAsync("git diff HEAD --name-only", { cwd, timeout: 10_000 });
        touchedFiles = diffOut.split("\n").filter(Boolean);
      } catch { /* non-fatal */ }

      return { output: stdout, touchedFiles, success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg, touchedFiles: [], success: false, error: msg };
    }
  };
}

/** Build adapters map for the requested agent kinds. */
function buildAdapters(
  agentKinds: AgentKind[],
  options: { bridgeDir?: string; projectRoot?: string } = {},
): Map<AgentKind, CouncilAgentAdapter> {
  const map = new Map<AgentKind, CouncilAgentAdapter>();
  for (const kind of agentKinds) {
    switch (kind) {
      case "dantecode":
        map.set(kind, new DanteCodeAdapter({
          executor: options.projectRoot ? createSelfExecutor(options.projectRoot) : undefined,
        }));
        break;
      case "claude-code":
        if (options.bridgeDir) {
          map.set(kind, new ClaudeCodeAdapter(options.bridgeDir));
        }
        break;
      case "codex":
        if (options.bridgeDir) {
          map.set(kind, new CodexAdapter(options.bridgeDir));
        }
        break;
      case "antigravity":
        if (options.bridgeDir) {
          map.set(kind, new AntigravityAdapter(options.bridgeDir));
        }
        break;
      default:
        // Other adapters not yet wired
        break;
    }
  }
  return map;
}

async function cmdStart(args: string[], projectRoot: string): Promise<void> {
  const objectiveIdx = args.findIndex((a) => !a.startsWith("--"));
  const objective = args[objectiveIdx] ?? "Council orchestration run";

  const agentsFlag =
    args.find((a) => a.startsWith("--agents="))?.slice("--agents=".length) ?? "";
  const agentKinds: AgentKind[] = agentsFlag
    ? (agentsFlag.split(",").map((a) => a.trim()) as AgentKind[])
    : ["dantecode"];

  const bridgeDir = args.find((a) => a.startsWith("--bridge-dir="))?.slice("--bridge-dir=".length);
  const watch = args.includes("--watch");
  const adapters = buildAdapters(agentKinds, { bridgeDir, projectRoot });
  const orchestrator = new CouncilOrchestrator(adapters);

  // Wire error events to stderr
  orchestrator.on("error", ({ message, context }) => {
    console.error(`${RED}[council] ${context ?? "error"}: ${message}${RESET}`);
  });

  const auditLogPath = join(projectRoot, ".dantecode", "council", "audit.jsonl");
  const runId = await orchestrator.start({ objective, agents: agentKinds, repoRoot: projectRoot, auditLogPath });

  console.log(`${GREEN}${BOLD}Council run started${RESET}`);
  console.log(`  Run ID:    ${CYAN}${runId}${RESET}`);
  console.log(`  Objective: ${objective}`);
  console.log(`  Agents:    ${agentKinds.join(", ")}`);
  console.log(`  State:     ${join(projectRoot, ".dantecode", "council", runId)}`);
  console.log(``);

  if (watch) {
    console.log(`${DIM}Watching lanes — Ctrl+C to detach (run resumes in background)...${RESET}`);
    orchestrator.on("lane:completed", ({ laneId, agentKind: kind }) => {
      console.log(`${GREEN}[council] Lane ${laneId} (${kind}) completed${RESET}`);
    });
    orchestrator.on("merge:complete", (result) => {
      const decision = result.synthesis.decision;
      const color = result.success ? GREEN : YELLOW;
      console.log(`${color}[council] Merge complete — decision: ${decision}${RESET}`);
    });
    orchestrator.on("state:transition", ({ from, to }) => {
      console.log(`${DIM}[council] ${from} → ${to}${RESET}`);
    });

    const sigintHandler = async () => {
      console.log(`\n${YELLOW}[council] Detaching — run ${runId} continues in background.${RESET}`);
      console.log(`${DIM}Resume with: dantecode council resume ${runId}${RESET}`);
      process.exit(0);
    };
    process.on("SIGINT", sigintHandler as NodeJS.SignalsListener);

    await orchestrator.watchUntilComplete();

    process.off("SIGINT", sigintHandler as NodeJS.SignalsListener);
    const finalStatus = orchestrator.currentStatus;
    const sc = statusColor(finalStatus);
    console.log(`\n${sc}${BOLD}Run ${runId} finished: ${finalStatus}${RESET}`);
  } else {
    console.log(`${DIM}Use 'dantecode council lanes' to assign tasks.${RESET}`);
    console.log(`${DIM}Run with --watch to keep watching lane progress.${RESET}`);
  }
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
  const bridgeDir = args.find((a) => a.startsWith("--bridge-dir="))?.slice("--bridge-dir=".length);
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

  console.log(`${CYAN}${BOLD}Running MergeBrain synthesis for run ${state.runId}${RESET}`);
  console.log(`  Completed lanes: ${completedLanes.map((l) => l.laneId).join(", ")}`);
  console.log(`  Mode: ${autoFlag ? GREEN + "auto" : YELLOW + "manual"}${RESET}`);

  // Build a minimal orchestrator to drive the merge
  const adapters = buildAdapters(state.agents.map((a) => a.agentKind), { bridgeDir, projectRoot });
  const orchestrator = new CouncilOrchestrator(adapters, {
    allowAutoMerge: autoFlag,
  });
  orchestrator.on("error", ({ message }) => console.error(`${RED}[merge] ${message}${RESET}`));

  // Resume into the existing run state so the orchestrator can drive merge()
  try {
    await orchestrator.resume(projectRoot, state.runId);
    const result = await orchestrator.merge();

    const sc = result.synthesis.decision === "auto-merge" ? GREEN : YELLOW;
    console.log(`${BOLD}Synthesis complete${RESET}`);
    console.log(`  Decision:   ${sc}${result.synthesis.decision}${RESET}`);
    console.log(`  Confidence: ${result.synthesis.confidence}`);
    console.log(`  Synthesis:  ${result.synthesis.id}`);
    if (!result.success) {
      console.log(`${YELLOW}  Note: ${result.error}${RESET}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}Merge failed: ${msg}${RESET}`);
    process.exit(1);
  }
}

async function cmdBridgeListen(args: string[], projectRoot: string): Promise<void> {
  const bridgeDir =
    args.find((a) => a.startsWith("--bridge-dir="))?.slice("--bridge-dir=".length) ??
    join(projectRoot, ".dantecode", "bridge");

  const timeoutSecs = parseInt(
    args.find((a) => a.startsWith("--timeout="))?.slice("--timeout=".length) ?? "0",
    10,
  );

  // Parse --agents flag (comma-separated kinds: claude-code,codex,antigravity)
  const commandMap: Record<string, string> = {
    "claude-code": "claude",
    "codex": "codex",
    "antigravity": "antigravity",
  };

  const agentsFlag = args.find((a) => a.startsWith("--agents="))?.slice("--agents=".length);
  const requestedKinds = agentsFlag
    ? agentsFlag.split(",").map((k) => k.trim()).filter(Boolean)
    : Object.keys(commandMap);

  const agentConfigs: AgentCommandConfig[] = requestedKinds
    .filter((k) => k in commandMap)
    .map((k) => ({
      kind: k as AgentCommandConfig["kind"],
      command: commandMap[k]!,
    }));

  if (agentConfigs.length === 0) {
    console.error(
      `${RED}No valid agent kinds specified. Use --agents=claude-code,codex,antigravity${RESET}`,
    );
    return;
  }

  console.log(`${CYAN}${BOLD}[bridge-listen] Watching ${bridgeDir}/inbox for sessions...${RESET}`);
  console.log(
    `${DIM}[bridge-listen] Agents: ${agentConfigs.map((a) => `${a.kind}(${a.command})`).join(", ")}${RESET}`,
  );

  const listener = new BridgeListener(bridgeDir, agentConfigs);
  listener.start();

  // Handle graceful shutdown on SIGINT / SIGTERM
  const shutdown = (): void => {
    console.log(`\n${DIM}[bridge-listen] Shutting down...${RESET}`);
    listener.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown as NodeJS.SignalsListener);
  process.on("SIGTERM", shutdown as NodeJS.SignalsListener);

  // Optional timeout (--timeout=<secs>)
  const timeoutMs = timeoutSecs > 0 ? timeoutSecs * 1000 : 0;
  if (timeoutMs > 0) {
    setTimeout(() => {
      console.log(`${DIM}[bridge-listen] Timeout reached (${timeoutMs}ms). Stopping.${RESET}`);
      listener.stop();
      process.off("SIGINT", shutdown as NodeJS.SignalsListener);
      process.off("SIGTERM", shutdown as NodeJS.SignalsListener);
    }, timeoutMs);
  } else {
    // Keep process alive indefinitely (daemon mode)
    await new Promise<void>(() => {/* run forever until signal */});
  }
}

async function cmdVerify(_args: string[], projectRoot: string): Promise<void> {
  const state = findLatestRun(projectRoot);
  if (!state) {
    console.error(`${RED}No active council run.${RESET}`);
    process.exit(1);
  }

  console.log(`${CYAN}${BOLD}Running verification gates for run ${state.runId}${RESET}`);

  const gates = [
    { name: "typecheck", cmd: "npm run typecheck" },
    { name: "test",      cmd: "npm run test" },
  ];

  let allPassed = true;
  for (const gate of gates) {
    process.stdout.write(`  ${gate.name}... `);
    try {
      execSync(gate.cmd, { cwd: projectRoot, stdio: "pipe", timeout: 300_000 });
      console.log(`${GREEN}PASS${RESET}`);
    } catch {
      console.log(`${RED}FAIL${RESET}`);
      allPassed = false;
    }
  }

  if (allPassed && state.finalSynthesis) {
    state.finalSynthesis.verificationPassed = true;
    await saveCouncilRun(state);
    console.log(`\n${GREEN}${BOLD}All verification gates passed.${RESET}`);
  } else if (allPassed) {
    console.log(`\n${YELLOW}Gates passed but no synthesis found. Run 'council merge' first.${RESET}`);
  } else {
    console.error(`\n${RED}${BOLD}Verification failed. Fix issues before pushing.${RESET}`);
    process.exit(1);
  }
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
  const runId = args.find((a) => !a.startsWith("--"));
  if (!runId) {
    console.error(`${RED}Usage: dantecode council resume <run-id>${RESET}`);
    process.exit(1);
  }

  const bridgeDir = args.find((a) => a.startsWith("--bridge-dir="))?.slice("--bridge-dir=".length);

  const state = await tryLoadCouncilRun(projectRoot, runId);
  if (!state) {
    console.error(`${RED}Run not found: ${runId}${RESET}`);
    process.exit(1);
  }

  if (state.status === "completed" || state.status === "failed") {
    console.log(`${YELLOW}Run ${runId} is in terminal state: ${state.status}${RESET}`);
    return;
  }

  const adapters = buildAdapters(state.agents.map((a) => a.agentKind), { bridgeDir, projectRoot });
  const orchestrator = new CouncilOrchestrator(adapters);
  orchestrator.on("error", ({ message }) => console.error(`${RED}[resume] ${message}${RESET}`));

  try {
    await orchestrator.resume(projectRoot, runId);
    console.log(`${GREEN}${BOLD}Resumed council run${RESET}`);
    printRun({ ...state, status: "running" });
    console.log(`${DIM}Orchestrator is active. Assign lanes and use 'council merge' when done.${RESET}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}Resume failed: ${msg}${RESET}`);
    process.exit(1);
  }
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
    case "bridge-listen":
      await cmdBridgeListen(rest, projectRoot);
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
  console.log(`  ${CYAN}bridge-listen${RESET} [run-id] [--timeout=<secs>]`);
}
