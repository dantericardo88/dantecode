// ============================================================================
// @dantecode/core — Council State Store
// Durable persistence for CouncilRunState objects.
// Stored under <repoRoot>/.dantecode/council/<runId>/state.json
// ============================================================================

import { readFile, writeFile, mkdir, readdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { CouncilRunState, AgentSessionState, OverlapRecord, HandoffPacket } from "./council-types.js";

// ----------------------------------------------------------------------------
// Storage helpers
// ----------------------------------------------------------------------------

function runDir(repoRoot: string, runId: string): string {
  return join(repoRoot, ".dantecode", "council", runId);
}

function statePath(repoRoot: string, runId: string): string {
  return join(runDir(repoRoot, runId), "state.json");
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Persist a council run state to disk.
 * Creates the run directory if it does not exist.
 */
export async function saveCouncilRun(state: CouncilRunState): Promise<void> {
  const path = statePath(state.repoRoot, state.runId);
  const tmpPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  const updated: CouncilRunState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  // Write to .tmp first, then rename — atomic on POSIX, best-effort on Windows
  await writeFile(tmpPath, JSON.stringify(updated, null, 2), "utf-8");
  await rename(tmpPath, path);
}

/**
 * Load a council run state from disk.
 * Throws if the run does not exist.
 */
export async function loadCouncilRun(repoRoot: string, runId: string): Promise<CouncilRunState> {
  const path = statePath(repoRoot, runId);
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as CouncilRunState;
}

/**
 * Try to load a council run state; returns null if not found.
 */
export async function tryLoadCouncilRun(
  repoRoot: string,
  runId: string,
): Promise<CouncilRunState | null> {
  try { return await loadCouncilRun(repoRoot, runId); } catch { /* fall through */ }
  // Recovery: the .tmp file survives an interrupted rename
  try {
    const tmpPath = `${statePath(repoRoot, runId)}.tmp`;
    const raw = await readFile(tmpPath, "utf-8");
    return JSON.parse(raw) as CouncilRunState;
  } catch {
    return null;
  }
}

/**
 * List all run IDs for a given repo root.
 */
export async function listCouncilRuns(repoRoot: string): Promise<string[]> {
  const base = join(repoRoot, ".dantecode", "council");
  try {
    const entries = await readdir(base, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Update an agent session state within an existing run.
 * Loads, patches, and re-persists atomically (best-effort).
 */
export async function updateAgentSession(
  repoRoot: string,
  runId: string,
  updated: AgentSessionState,
): Promise<void> {
  const state = await loadCouncilRun(repoRoot, runId);
  const idx = state.agents.findIndex((a) => a.laneId === updated.laneId);
  if (idx >= 0) {
    state.agents[idx] = updated;
  } else {
    state.agents.push(updated);
  }
  await saveCouncilRun(state);
}

/**
 * Append an overlap record to an existing run.
 */
export async function appendOverlapRecord(
  repoRoot: string,
  runId: string,
  overlap: OverlapRecord,
): Promise<void> {
  const state = await loadCouncilRun(repoRoot, runId);
  state.overlaps.push(overlap);
  await saveCouncilRun(state);
}

/**
 * Append a handoff packet to an existing run.
 */
export async function appendHandoffPacket(
  repoRoot: string,
  runId: string,
  packet: HandoffPacket,
): Promise<void> {
  const state = await loadCouncilRun(repoRoot, runId);
  state.handoffs.push(packet);
  // Mark the originating lane as handed-off
  const lane = state.agents.find((a) => a.laneId === packet.laneId);
  if (lane) {
    lane.status = "handed-off";
    lane.handoffPacketId = packet.id;
  }
  await saveCouncilRun(state);
}

/**
 * Advance the run status and persist.
 */
export async function setRunStatus(
  repoRoot: string,
  runId: string,
  status: CouncilRunState["status"],
): Promise<void> {
  const state = await loadCouncilRun(repoRoot, runId);
  state.status = status;
  await saveCouncilRun(state);
}
