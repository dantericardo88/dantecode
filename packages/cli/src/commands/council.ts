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
//   dantecode council fleet "<objective>" [--agents=builder,reviewer,tester]
// ============================================================================

import { join } from "node:path";
import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createWorktree, removeWorktree } from "@dantecode/git-engine";

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
  readOrInitializeState,
} from "@dantecode/core";
import type {
  AgentKind,
  CouncilRunState,
  CouncilAgentAdapter,
  SelfLaneExecutor,
  AgentCommandConfig,
  LaneAssignmentRequest,
} from "@dantecode/core";
import type { ContentBlock, Session, DanteCodeState } from "@dantecode/config-types";
import { runAgentLoop } from "../agent-loop.js";
import type { AgentLoopConfig } from "../agent-loop.js";

// ANSI colors
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ---------------------------------------------------------------------------
// In-process concurrency limit for self-executor lanes
// Override via DANTE_COUNCIL_MAX_LANES env var (0 = unlimited, default 3)
// ---------------------------------------------------------------------------
const _MAX_CONCURRENT_LANES = (() => {
  const raw = process.env["DANTE_COUNCIL_MAX_LANES"];
  if (raw !== undefined) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 3;
  }
  return 3;
})();
let _activeLaneCount = 0;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Platform-aware PID liveness probe.
 * Windows: `process.kill(pid, 0)` never throws for dead processes, so we query
 *   tasklist instead (conservative: returns true on exec error).
 * Unix: signal-0 probe — ESRCH = dead, EPERM = alive but owned by another user.
 */
function probePidAlive(pid: number): boolean {
  if (process.platform === "win32") {
    try {
      const out = execSync(
        `tasklist /FI "PID eq ${pid}" /NH /FO CSV`,
        { timeout: 3_000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
      return out.includes(String(pid));
    } catch {
      return true; // conservative: assume alive on exec error
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Extract the last assistant text from session messages.
 * Handles both string content and ContentBlock[] (text blocks only).
 */
function extractLastAssistantText(messages: Session["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== "assistant") continue;
    const { content } = msg;
    if (typeof content === "string") return content;
    return (content as ContentBlock[])
      .filter(
        (b): b is ContentBlock & { type: "text"; text: string } =>
          b.type === "text" && typeof (b as { text?: unknown }).text === "string",
      )
      .map((b) => b.text)
      .join("");
  }
  return "";
}

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
 * Creates a SelfLaneExecutor that runs agent tasks in-process via runAgentLoop,
 * avoiding the overhead and fragility of spawning a child dantecode process.
 */
function createSelfExecutor(projectRoot: string): SelfLaneExecutor {
  return async (prompt, worktreePath, opts) => {
    const cwd = worktreePath ?? projectRoot;
    const maxRounds = opts?.maxRounds ?? 80;

    // Load state from worktree (falls back to projectRoot if worktree has no STATE.yaml)
    let state: DanteCodeState;
    try {
      state = await readOrInitializeState(cwd);
    } catch {
      state = await readOrInitializeState(projectRoot);
    }

    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      projectRoot: cwd,
      messages: [],
      activeFiles: [],
      readOnlyFiles: [],
      model: state.model.default,
      createdAt: now,
      updatedAt: now,
      agentStack: [],
      todoList: [],
    };

    const agentConfig: AgentLoopConfig = {
      state,
      verbose: false,
      enableGit: true,
      enableSandbox: false,
      silent: true,
      requiredRounds: maxRounds,
      abortSignal: opts?.abortSignal,
    };

    if (_MAX_CONCURRENT_LANES > 0 && _activeLaneCount >= _MAX_CONCURRENT_LANES) {
      return {
        output: `Council lane rejected: concurrency limit reached (${_MAX_CONCURRENT_LANES} active). Retry after existing lanes complete.`,
        touchedFiles: [],
        success: false,
        error: `concurrency-limit`,
      };
    }
    _activeLaneCount++;
    try {
      await runAgentLoop(prompt, session, agentConfig);
      let touchedFiles: string[] = [];
      try {
        const { stdout } = await execAsync("git diff HEAD --name-only", { cwd, timeout: 10_000 });
        touchedFiles = stdout.split("\n").filter(Boolean);
      } catch { /* non-fatal */ }
      return {
        output: extractLastAssistantText(session.messages),
        touchedFiles,
        success: true,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: msg, touchedFiles: [], success: false, error: msg };
    } finally {
      _activeLaneCount--;
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
  // --background for fire-and-forget; default is foreground
  const background = args.includes("--background");
  // --no-worktree: explicitly disable NOMA isolation and share the main repo.
  // Without this flag, worktree creation failure is a hard error (not a silent fallback).
  const noWorktree = args.includes("--no-worktree");

  const timeoutSecs = parseInt(
    args.find((a) => a.startsWith("--timeout="))?.slice("--timeout=".length) ?? "0",
    10,
  );
  const timeoutMs = timeoutSecs > 0 ? timeoutSecs * 1000 : undefined;

  const adapters = buildAdapters(agentKinds, { bridgeDir, projectRoot });
  const orchestrator = new CouncilOrchestrator(adapters);

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

  // Auto-assign one lane per agent kind with isolated worktrees.
  const createdWorktrees: string[] = [];

  for (const agentKind of agentKinds) {
    const wtTimestamp = Date.now();
    const sessionId = `${runId.slice(-8)}-${agentKind}-${wtTimestamp}`;
    const branch = `council-${runId.slice(-8)}-${agentKind}-${wtTimestamp}`;
    let worktreePath: string;

    try {
      const result = createWorktree({
        branch,
        baseBranch: "HEAD",
        sessionId,
        directory: projectRoot,
      });
      worktreePath = result.directory;
      createdWorktrees.push(worktreePath);
      console.log(`${DIM}  Worktree: ${worktreePath}${RESET}`);
    } catch (wtErr: unknown) {
      const wtMsg = wtErr instanceof Error ? wtErr.message : String(wtErr);
      try { execSync("git worktree prune", { cwd: projectRoot, stdio: "pipe", timeout: 10_000 }); } catch { /* non-fatal */ }
      if (noWorktree) {
        console.warn(
          `${YELLOW}[council] Worktree creation failed for ${agentKind}: ${wtMsg}.` +
          ` --no-worktree active — falling back to shared repo (NOMA isolation disabled).${RESET}`,
        );
        worktreePath = projectRoot;
      } else {
        console.error(
          `${RED}[council] Worktree creation failed for ${agentKind}: ${wtMsg}${RESET}\n` +
          `  NOMA isolation requires an isolated worktree. Re-run with --no-worktree to explicitly disable it (conflict risk).`,
        );
        // Clean up any worktrees already created during earlier loop iterations.
        for (const wt of createdWorktrees) {
          try { removeWorktree(wt); } catch { /* non-fatal */ }
        }
        await orchestrator.fail("worktree creation failed");
        return;
      }
    }

    const req: LaneAssignmentRequest = {
      preferredAgent: agentKind,
      objective,
      worktreePath,
      branch,
      baseBranch: "main",
      taskCategory: "coding",
      ownedFiles: [],
    };
    const laneResult = await orchestrator.assignLane(req);

    if (laneResult.accepted) {
      console.log(`${GREEN}  Lane: ${laneResult.laneId} (${agentKind})${RESET}`);
    } else {
      console.warn(`${YELLOW}  Lane rejected for ${agentKind}: ${laneResult.reason ?? "unknown"}${RESET}`);
    }
  }

  console.log(``);

  if (background) {
    orchestrator.on("lane:completed", ({ laneId, agentKind }) => {
      console.log(`[council] Lane ${laneId} (${agentKind as string}) completed`);
    });
    orchestrator.on("merge:complete", (r) => {
      console.log(`[council] Merge: ${r.synthesis.decision}`);
    });
    const statusFile = join(projectRoot, ".dantecode", "council", runId, "bg-pid.json");
    await writeFile(
      statusFile,
      JSON.stringify({ pid: process.pid, runId, startedAt: new Date().toISOString() }),
      "utf-8",
    );
    console.log(`[council] Background mode — resume with: dantecode council resume ${runId}`);
  } else {
    orchestrator.on("lane:completed", ({ laneId, agentKind }) => {
      console.log(`[council] Lane ${laneId} (${agentKind as string}) completed`);
    });
    orchestrator.on("merge:complete", (r) => {
      console.log(`[council] Merge: ${r.synthesis.decision}`);
    });
    orchestrator.on("state:transition", ({ from, to }) => {
      console.log(`[council] ${from} → ${to}`);
    });
    const onSIGINT = (): void => {
      console.log(`\n[council] Detaching — resume with: dantecode council resume ${runId}`);
      for (const wt of createdWorktrees) {
        try { removeWorktree(wt); } catch { /* non-fatal */ }
      }
      process.exit(0);
    };
    process.once("SIGINT", onSIGINT);
    try {
      await orchestrator.watchUntilComplete(timeoutMs !== undefined ? { timeoutMs } : undefined);
    } finally {
      for (const wt of createdWorktrees) {
        try { removeWorktree(wt); } catch { /* non-fatal */ }
      }
    }
    process.off("SIGINT", onSIGINT);
    console.log(`\n[council] Run ${runId} finished: ${orchestrator.currentStatus}`);
  }
}

/**
 * Checks bg-pid.json for a background process and prints its liveness status.
 * Non-fatal: absent file or unreadable data is silently ignored.
 */
function printBgPidStatus(repoRoot: string, runId: string): void {
  const pidFile = join(repoRoot, ".dantecode", "council", runId, "bg-pid.json");
  if (!existsSync(pidFile)) return;
  try {
    const data = JSON.parse(readFileSync(pidFile, "utf-8")) as {
      pid?: number;
      startedAt?: string;
    };
    if (typeof data.pid !== "number") return;
    const alive = probePidAlive(data.pid);
    const tag = alive
      ? `${CYAN}running (pid: ${data.pid})${RESET}`
      : `${DIM}dead/exited (pid: ${data.pid})${RESET}`;
    console.log(
      `  Background: ${tag}` +
        (data.startedAt ? `  started ${data.startedAt}` : ""),
    );
  } catch { /* non-fatal */ }
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
    printBgPidStatus(projectRoot, runId);
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
      const pidFile = join(projectRoot, ".dantecode", "council", id, "bg-pid.json");
      let bgTag = "";
      if (existsSync(pidFile)) {
        try {
          const pidData = JSON.parse(readFileSync(pidFile, "utf-8")) as { pid?: number };
          if (typeof pidData.pid === "number") {
            const alive = probePidAlive(pidData.pid);
            bgTag = alive ? `  ${CYAN}[bg:alive]${RESET}` : `  ${DIM}[bg:exited]${RESET}`;
          }
        } catch { /* non-fatal */ }
      }
      console.log(
        `  ${CYAN}${id}${RESET}  ${sc}${state.status}${RESET}  ${DIM}${state.objective.slice(0, 60)}${RESET}${bgTag}`,
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

  const adapters = buildAdapters(state.agents.map((a) => a.agentKind), { bridgeDir, projectRoot });
  const orchestrator = new CouncilOrchestrator(adapters, {
    allowAutoMerge: autoFlag,
  });
  orchestrator.on("error", ({ message }) => console.error(`${RED}[merge] ${message}${RESET}`));

  try {
    await orchestrator.resume(projectRoot, state.runId);

    if (orchestrator.currentStatus !== "running") {
      console.log(
        `${YELLOW}[council] Orchestrator is in '${orchestrator.currentStatus}' state — merge requires 'running'.${RESET}`,
      );
      if (state.finalSynthesis) {
        console.log(`  Last synthesis: ${state.finalSynthesis.decision} (confidence: ${state.finalSynthesis.confidence})`);
      }
      return;
    }

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

  const shutdown = (): void => {
    console.log(`\n${DIM}[bridge-listen] Shutting down...${RESET}`);
    listener.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown as NodeJS.SignalsListener);
  process.on("SIGTERM", shutdown as NodeJS.SignalsListener);

  const timeoutMs = timeoutSecs > 0 ? timeoutSecs * 1000 : 0;
  if (timeoutMs > 0) {
    setTimeout(() => {
      console.log(`${DIM}[bridge-listen] Timeout reached (${timeoutMs}ms). Stopping.${RESET}`);
      listener.stop();
      process.off("SIGINT", shutdown as NodeJS.SignalsListener);
      process.off("SIGTERM", shutdown as NodeJS.SignalsListener);
    }, timeoutMs);
  } else {
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
// Fleet subcommand — declarative agent manifest runner
// ----------------------------------------------------------------------------

/** Agent manifest loaded from .dantecode/agents/<name>.yaml */
interface AgentManifest {
  name: string;
  description?: string;
  model?: string;
  sandbox_mode?: string;
  system_prompt?: string;
  tool_permissions?: string[];
  [key: string]: unknown;
}

/**
 * Reads .dantecode/agents/*.yaml manifests from the project root.
 * Returns an array of parsed manifests. Non-fatal: skips unreadable files.
 */
async function loadAgentManifests(projectRoot: string): Promise<AgentManifest[]> {
  const agentsDir = join(projectRoot, ".dantecode", "agents");
  let files: string[];
  try {
    files = readdirSync(agentsDir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );
  } catch {
    return [];
  }

  const manifests: AgentManifest[] = [];
  for (const file of files) {
    try {
      const raw = await readFile(join(agentsDir, file), "utf-8");
      // Minimal YAML key-value parser — handles string/list values.
      // We avoid pulling in a YAML dependency; the manifest format is simple.
      const manifest: AgentManifest = { name: file.replace(/\.(yaml|yml)$/, "") };
      let currentListKey: string | null = null;
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          currentListKey = null;
          continue;
        }
        // List item continuation
        if (trimmed.startsWith("- ") && currentListKey) {
          const listVal = trimmed.slice(2).trim();
          const existing = (manifest as Record<string, unknown>)[currentListKey];
          if (Array.isArray(existing)) {
            existing.push(listVal);
          } else {
            (manifest as Record<string, unknown>)[currentListKey] = [listVal];
          }
          continue;
        }
        // Key: value
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) { currentListKey = null; continue; }
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        currentListKey = null;
        if (value === "" || value === "|") {
          // Multi-line or list — start tracking
          currentListKey = key;
          (manifest as Record<string, unknown>)[key] = value === "|" ? "" : [];
        } else {
          (manifest as Record<string, unknown>)[key] = value;
        }
      }
      manifests.push(manifest);
    } catch {
      // Skip unreadable manifests — non-fatal
    }
  }
  return manifests;
}

/**
 * Maps an agent manifest name to a CouncilOrchestrator AgentKind.
 * Known names (builder/planner/reviewer/tester) map to "dantecode" (in-process executor).
 * Unknown names also default to "dantecode" for extensibility.
 */
function manifestToAgentKind(_manifest: AgentManifest): AgentKind {
  return "dantecode";
}

async function cmdFleet(args: string[], projectRoot: string): Promise<void> {
  const objectiveIdx = args.findIndex((a) => !a.startsWith("--"));
  const objective = args.slice(objectiveIdx).filter((a) => !a.startsWith("--")).join(" ").trim();

  if (!objective) {
    console.error(
      `${RED}Usage: dantecode council fleet "<objective>" [--agents=builder,reviewer,tester] [--no-worktree]${RESET}`,
    );
    process.exit(1);
  }

  const agentsFlag = args.find((a) => a.startsWith("--agents="))?.slice("--agents=".length);
  const noWorktree = args.includes("--no-worktree");
  const timeoutSecs = parseInt(
    args.find((a) => a.startsWith("--timeout="))?.slice("--timeout=".length) ?? "0",
    10,
  );
  const timeoutMs = timeoutSecs > 0 ? timeoutSecs * 1000 : undefined;

  // Load agent manifests from .dantecode/agents/
  const allManifests = await loadAgentManifests(projectRoot);

  let selectedManifests: AgentManifest[];
  if (agentsFlag) {
    const requested = agentsFlag.split(",").map((s) => s.trim());
    selectedManifests = requested
      .map((name) => allManifests.find((m) => m.name === name))
      .filter((m): m is AgentManifest => m !== undefined);
    if (selectedManifests.length === 0) {
      // Fall back to defaults when no manifests found
      selectedManifests = requested.map((name) => ({ name }));
    }
  } else if (allManifests.length > 0) {
    // Use all loaded manifests — skip planner (read-only) in active execution
    selectedManifests = allManifests.filter((m) => m.name !== "planner");
    if (selectedManifests.length === 0) selectedManifests = allManifests;
  } else {
    // No manifests found — use default fleet
    selectedManifests = [
      { name: "builder", sandbox_mode: "workspace-write" },
      { name: "reviewer", sandbox_mode: "read-only" },
      { name: "tester", sandbox_mode: "workspace-write" },
    ];
  }

  const agentKinds: AgentKind[] = selectedManifests.map(manifestToAgentKind);

  console.log(`${GREEN}${BOLD}Council Fleet${RESET}`);
  console.log(`  Objective: ${objective}`);
  console.log(`  Manifest dir: ${join(projectRoot, ".dantecode", "agents")}`);
  console.log(`  Agents loaded: ${selectedManifests.map((m) => m.name).join(", ")}`);
  console.log(``);

  if (allManifests.length === 0) {
    console.log(
      `${YELLOW}No manifests found in .dantecode/agents/ — using default fleet (builder, reviewer, tester).${RESET}`,
    );
    console.log(
      `${DIM}Create YAML manifests in .dantecode/agents/ to customize agent roles and models.${RESET}`,
    );
    console.log(``);
  } else {
    for (const m of selectedManifests) {
      console.log(
        `  ${CYAN}${m.name}${RESET}  ${DIM}${m.description ?? "(no description)"}${RESET}  model: ${m.model ?? "default"}`,
      );
    }
    console.log(``);
  }

  // Delegate to cmdStart with the resolved agents
  const startArgs = [
    `"${objective}"`,
    `--agents=${agentKinds.join(",")}`,
    ...(noWorktree ? ["--no-worktree"] : []),
    ...(timeoutSecs > 0 ? [`--timeout=${timeoutSecs}`] : []),
  ];

  const adapters = buildAdapters(agentKinds, { projectRoot });
  const orchestrator = new CouncilOrchestrator(adapters);

  orchestrator.on("error", ({ message, context }) => {
    console.error(`${RED}[fleet] ${context ?? "error"}: ${message}${RESET}`);
  });

  const auditLogPath = join(projectRoot, ".dantecode", "council", "audit.jsonl");
  const runId = await orchestrator.start({
    objective,
    agents: agentKinds,
    repoRoot: projectRoot,
    auditLogPath,
  });

  console.log(`${GREEN}Fleet run started${RESET}`);
  console.log(`  Run ID:  ${CYAN}${runId}${RESET}`);
  console.log(``);

  const createdWorktrees: string[] = [];

  for (const manifest of selectedManifests) {
    const agentKind = manifestToAgentKind(manifest);
    const wtTimestamp = Date.now();
    const sessionId = `${runId.slice(-8)}-${manifest.name}-${wtTimestamp}`;
    const branch = `fleet-${runId.slice(-8)}-${manifest.name}-${wtTimestamp}`;
    let worktreePath: string;

    try {
      const result = createWorktree({
        branch,
        baseBranch: "HEAD",
        sessionId,
        directory: projectRoot,
      });
      worktreePath = result.directory;
      createdWorktrees.push(worktreePath);
      console.log(`${DIM}  Worktree [${manifest.name}]: ${worktreePath}${RESET}`);
    } catch (wtErr: unknown) {
      const wtMsg = wtErr instanceof Error ? wtErr.message : String(wtErr);
      try { execSync("git worktree prune", { cwd: projectRoot, stdio: "pipe", timeout: 10_000 }); } catch { /* non-fatal */ }
      if (noWorktree) {
        console.warn(
          `${YELLOW}[fleet] Worktree creation failed for ${manifest.name}: ${wtMsg}. Using shared repo.${RESET}`,
        );
        worktreePath = projectRoot;
      } else {
        console.error(
          `${RED}[fleet] Worktree creation failed for ${manifest.name}: ${wtMsg}${RESET}\n` +
          `  Re-run with --no-worktree to disable NOMA isolation.`,
        );
        for (const wt of createdWorktrees) {
          try { removeWorktree(wt); } catch { /* non-fatal */ }
        }
        await orchestrator.fail("worktree creation failed");
        return;
      }
    }

    const laneResult = await orchestrator.assignLane({
      preferredAgent: agentKind,
      objective: `[${manifest.name}] ${objective}`,
      worktreePath,
      branch,
      baseBranch: "main",
      taskCategory: manifest.name === "tester" ? "testing" : "coding",
      ownedFiles: [],
    });

    if (laneResult.accepted) {
      console.log(`${GREEN}  Lane: ${laneResult.laneId} [${manifest.name}]${RESET}`);
    } else {
      console.warn(`${YELLOW}  Lane rejected for ${manifest.name}: ${laneResult.reason ?? "unknown"}${RESET}`);
    }
  }

  console.log(``);
  orchestrator.on("lane:completed", ({ laneId, agentKind }) => {
    console.log(`[fleet] Lane ${laneId} (${agentKind as string}) completed`);
  });
  orchestrator.on("merge:complete", (r) => {
    console.log(`[fleet] Merge: ${r.synthesis.decision}`);
  });
  orchestrator.on("state:transition", ({ from, to }) => {
    console.log(`[fleet] ${from} → ${to}`);
  });

  const onSIGINT = (): void => {
    console.log(`\n[fleet] Detaching — resume with: dantecode council resume ${runId}`);
    for (const wt of createdWorktrees) {
      try { removeWorktree(wt); } catch { /* non-fatal */ }
    }
    process.exit(0);
  };
  process.once("SIGINT", onSIGINT);
  try {
    await orchestrator.watchUntilComplete(timeoutMs !== undefined ? { timeoutMs } : undefined);
  } finally {
    for (const wt of createdWorktrees) {
      try { removeWorktree(wt); } catch { /* non-fatal */ }
    }
  }
  process.off("SIGINT", onSIGINT);
  console.log(`\n[fleet] Run ${runId} finished: ${orchestrator.currentStatus}`);

  // Silence the unused variable warning — startArgs is intentionally unused after we
  // chose to inline the orchestration logic here rather than forwarding to cmdStart.
  void startArgs;
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
    case "fleet":
      await cmdFleet(rest, projectRoot);
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
  console.log(
    `  ${CYAN}fleet${RESET} "<objective>" [--agents=builder,reviewer,tester] [--no-worktree]`,
  );
  console.log(`         Reads .dantecode/agents/*.yaml manifests and launches parallel lanes.`);
}
