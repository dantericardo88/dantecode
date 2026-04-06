// ============================================================================
// Party Mode / Council Orchestrator Integration
// Wrapper for @dantecode/core CouncilOrchestrator — full wiring
// ============================================================================

import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { join } from "node:path";
import {
  CouncilOrchestrator,
  newRunId,
  newLaneId,
  globalDelegationManager,
} from "@dantecode/core";
import type {
  AgentSessionState,
  CouncilRunState,
  OrchestratorStartOptions,
  AgentKind,
} from "@dantecode/core";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface PartyLaneStatus {
  laneId: string;
  agentKind: AgentKind;
  objective: string;
  status: AgentSessionState["status"] | "pending";
  tokensUsed: number;
  costUsd: number;
  filesModified: number;
  startedAt: string | undefined;
  completedAt: string | undefined;
  pdseScore: number | undefined;
  durationMs: number | undefined;
  /** Delegation ID registered with globalDelegationManager for this lane. */
  delegationId?: string;
}

export interface PartyRunState {
  runId: string;
  status: CouncilRunState["status"] | "idle";
  lanes: Map<string, PartyLaneStatus>;
  totalTokens: number;
  totalFiles: number;
  startedAt: number;
}

// ----------------------------------------------------------------------------
// Module-level state
// ----------------------------------------------------------------------------

let _activeRunId: string | undefined;
let _activeStatus: CouncilRunState["status"] | "idle" = "idle";
let _runState: PartyRunState | undefined;

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function ensureLane(laneId: string, agentKind: AgentKind, objective: string): void {
  if (!_runState || _runState.lanes.has(laneId)) return;
  _runState.lanes.set(laneId, {
    laneId,
    agentKind,
    objective,
    status: "running",
    tokensUsed: 0,
    costUsd: 0,
    filesModified: 0,
    startedAt: new Date().toISOString(),
    completedAt: undefined,
    pdseScore: undefined,
    durationMs: undefined,
  });
}

function postLaneUpdate(
  laneId: string,
  status: PartyLaneStatus["status"],
  extra: Partial<PartyLaneStatus> = {},
): void {
  if (!_runState) return;
  const existing = _runState.lanes.get(laneId);
  if (!existing) return;

  const updated: PartyLaneStatus = { ...existing, status, ...extra };
  _runState.lanes.set(laneId, updated);

  // Recompute aggregated totals
  let totalTokens = 0;
  let totalFiles = 0;
  for (const lane of _runState.lanes.values()) {
    totalTokens += lane.tokensUsed;
    totalFiles += lane.filesModified;
  }
  _runState.totalTokens = totalTokens;
  _runState.totalFiles = totalFiles;
}

function emitPanelUpdate(
  commandSuffix: string,
  payload: Record<string, unknown>,
): void {
  void vscode.commands.executeCommand(`dantecode.party${commandSuffix}`, payload);
}

function wireOrchestratorEvents(
  orchestrator: CouncilOrchestrator,
  runId: string,
  outputChannel: vscode.OutputChannel,
): void {
  orchestrator.on("lane:assigned", ({ laneId, agentKind }: { laneId: string; agentKind: AgentKind }) => {
    // Look up any pre-created stub so we can carry forward the objective
    const existingObjective = _runState?.lanes.get(laneId)?.objective ?? "";
    outputChannel.appendLine(`[Party] Lane assigned: ${laneId} → ${agentKind}`);
    // Register this lane as a delegation with the global manager
    const delegationId = globalDelegationManager.delegate({
      parentAgentId: runId,
      taskDescription: existingObjective,
      context: `Lane ${laneId} (${agentKind})`,
      maxRounds: 20,
    });
    ensureLane(laneId, agentKind, existingObjective);
    // Store delegationId on the lane state
    const laneState = _runState?.lanes.get(laneId);
    if (laneState) {
      laneState.delegationId = delegationId;
    }
    emitPanelUpdate("AgentAdded", { laneId, agentKind, objective: existingObjective });
  });

  orchestrator.on("lane:completed", ({ laneId, agentKind, sessionId }: { laneId: string; agentKind: string; sessionId: string }) => {
    outputChannel.appendLine(
      `[Party] Lane completed: ${laneId} (${agentKind}, session ${sessionId})`,
    );
    const lane = _runState?.lanes.get(laneId);
    if (lane?.delegationId) {
      globalDelegationManager.complete(lane.delegationId, {
        parentAgentId: runId,
        success: true,
        output: `Lane ${laneId} completed`,
        filesModified: [],
        roundsUsed: 0,
      });
    }
    postLaneUpdate(laneId, "completed", { completedAt: new Date().toISOString() });
    emitPanelUpdate("AgentCompleted", { laneId, status: "completed" });
  });

  orchestrator.on("lane:frozen", ({ laneId, reason }) => {
    outputChannel.appendLine(`[Party] Lane frozen: ${laneId} — ${reason}`);
    postLaneUpdate(laneId, "frozen");
    emitPanelUpdate("AgentCompleted", { laneId, status: "frozen" });
  });

  orchestrator.on("lane:verified", ({ laneId, pdseScore }) => {
    outputChannel.appendLine(`[Party] Lane verified: ${laneId} score=${pdseScore}`);
    postLaneUpdate(laneId, "completed", { pdseScore });
    emitPanelUpdate("AgentVerified", { laneId, score: pdseScore });
  });

  orchestrator.on("lane:accepted-with-warning", ({ laneId, pdseScore }) => {
    outputChannel.appendLine(
      `[Party] Lane accepted with warning: ${laneId} score=${pdseScore}`,
    );
    postLaneUpdate(laneId, "completed", { pdseScore });
    emitPanelUpdate("AgentVerified", { laneId, score: pdseScore });
  });

  orchestrator.on("lane:verify-failed", ({ laneId, score }) => {
    outputChannel.appendLine(`[Party] Lane verify-failed: ${laneId} score=${score}`);
    postLaneUpdate(laneId, "failed", { pdseScore: score });
    emitPanelUpdate("AgentCompleted", { laneId, status: "failed" });
  });

  orchestrator.on("lanes:all-terminal", () => {
    outputChannel.appendLine(`[Party] All lanes terminal — run ${runId} complete`);
    _activeStatus = "completed";
    if (_runState) _runState.status = "completed";
    emitPanelUpdate("Status", { from: "running", to: "completed", runId });
  });

  orchestrator.on("error", ({ message, context }) => {
    outputChannel.appendLine(
      `[Party] Orchestrator error: ${message}${context ? ` (${context})` : ""}`,
    );
  });
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Launch party mode with multiple agents via CouncilOrchestrator.
 * Creates a run ID, initialises per-lane tracking, and wires all orchestrator
 * events back to the party-progress-panel via VS Code commands.
 */
export async function launchPartyMode(
  objective: string,
  agents: string[],
  projectRoot: string,
  outputChannel: vscode.OutputChannel,
): Promise<string> {
  const runId = newRunId();
  _activeRunId = runId;
  _activeStatus = "planning";

  _runState = {
    runId,
    status: "planning",
    lanes: new Map(),
    totalTokens: 0,
    totalFiles: 0,
    startedAt: Date.now(),
  };

  outputChannel.appendLine(`[Party Mode] Objective: ${objective}`);
  outputChannel.appendLine(`[Party Mode] Agents: ${agents.join(", ")}`);
  outputChannel.appendLine(`[Party Mode] Run ID: ${runId}`);

  // Notify panel: planning state
  emitPanelUpdate("Status", { from: "idle", to: "planning", runId });

  // Create pending lane stubs so the panel shows all agents immediately
  for (const agentName of agents) {
    const agentKind: AgentKind = isValidAgentKind(agentName) ? agentName : "custom";
    const laneId = newLaneId(agentKind);
    _runState.lanes.set(laneId, {
      laneId,
      agentKind,
      objective,
      status: "pending",
      tokensUsed: 0,
      costUsd: 0,
      filesModified: 0,
      startedAt: undefined,
      completedAt: undefined,
      pdseScore: undefined,
      durationMs: undefined,
    });
    emitPanelUpdate("AgentAdded", { laneId, agentKind, objective });
  }

  // Wire real subprocess adapters — each lane runs via the dantecode CLI binary.
  // The DanteCodeAdapter drives the orchestrator's per-lane lifecycle properly.
  const { DanteCodeAdapter } = await import("@dantecode/core");

  // Try to find the dantecode CLI in order of preference
  const possiblePaths = [
    join(projectRoot, "node_modules", ".bin", "dantecode"),
    join(projectRoot, "node_modules", ".bin", "dantecode.cmd"), // Windows
    process.execPath.replace("node.exe", "dantecode").replace(/\bnode\b/, "dantecode"), // Same node dir
    "dantecode", // PATH fallback
  ];

  let cliPath = "dantecode"; // Default to PATH
  for (const p of possiblePaths) {
    try {
      const { existsSync } = await import("node:fs");
      if (existsSync(p)) {
        cliPath = p;
        break;
      }
    } catch { /* continue */ }
  }

  const selfExecutor = async (
    prompt: string,
    laneProjectRoot: string,
    opts?: { maxRounds?: number; worktreePath?: string },
  ) => {
    return new Promise<{ output: string; touchedFiles: string[]; success: boolean; error?: string }>(
      (resolve) => {
        const cliArgs = [
          "--headless",
          `--project=${laneProjectRoot}`,
          `--task=${prompt}`,
        ];
        if (opts?.worktreePath) {
          cliArgs.push(`--worktree=${opts.worktreePath}`);
        }
        const proc = execFile(
          cliPath,
          cliArgs,
          { cwd: laneProjectRoot, timeout: 300_000, windowsHide: true },
          (err, stdout, stderr) => {
            if (err) {
              resolve({ output: stderr || err.message, touchedFiles: [], success: false, error: err.message });
            } else {
              resolve({ output: stdout, touchedFiles: [], success: true });
            }
          },
        );
        // Kill after 5 minutes regardless
        setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } resolve({ output: "[timeout]", touchedFiles: [], success: false, error: "timeout" }); }, 300_000);
      },
    );
  };

  const adapters = new Map<AgentKind, InstanceType<typeof DanteCodeAdapter>>();
  adapters.set("dantecode", new DanteCodeAdapter({ executor: selfExecutor }));

  const orchestrator = new CouncilOrchestrator(adapters);
  wireOrchestratorEvents(orchestrator, runId, outputChannel);

  // Build start options (separate from constructor options)
  const startOpts: OrchestratorStartOptions = {
    objective,
    agents: agents.map((a): AgentKind => (isValidAgentKind(a) ? a : "custom")),
    repoRoot: projectRoot,
  };

  _activeStatus = "running";
  _runState.status = "running";
  emitPanelUpdate("Status", { from: "planning", to: "running", runId });

  // Fire-and-forget: orchestrator runs async; events drive the panel
  void orchestrator.start(startOpts).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[Party] Orchestrator start error: ${msg}`);
  });

  void vscode.window.showInformationMessage(
    `Party Mode launched — Run ${runId.substring(0, 8)}... with ${agents.length} agent(s)`,
  );

  return runId;
}

function isValidAgentKind(name: string): name is AgentKind {
  const valid: AgentKind[] = ["dantecode", "codex", "claude-code", "antigravity", "custom"];
  return (valid as string[]).includes(name);
}

/** Get current party mode status string (null when idle). */
export function getPartyModeStatus(): string | null {
  return _activeStatus === "idle" ? null : _activeStatus;
}

/** Get current run ID. */
export function getActiveRunId(): string | undefined {
  return _activeRunId;
}

/** Get full run state snapshot for the panel. */
export function getPartyRunState(): PartyRunState | undefined {
  return _runState;
}

/** Stop active party mode and clean up. */
export function stopPartyMode(): void {
  _activeRunId = undefined;
  _activeStatus = "idle";
  _runState = undefined;
}

/**
 * Request merge approval (called when orchestrator is ready to merge).
 */
export async function requestMergeApproval(): Promise<boolean> {
  const result = await vscode.window.showInformationMessage(
    "Party Mode agents have completed their work. Merge changes?",
    { modal: true },
    "Merge",
    "Cancel",
  );
  return result === "Merge";
}
