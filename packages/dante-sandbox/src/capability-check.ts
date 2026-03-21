// ============================================================================
// @dantecode/dante-sandbox — Capability Check
// Detects which isolation strategies are available at runtime.
// ============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IsolationStrategy } from "./types.js";

const execFileAsync = promisify(execFile);

let _dockerCache: boolean | null = null;
let _dockerCacheAt = 0;
const DOCKER_CACHE_TTL_MS = 30_000;

/** Returns true when the Docker daemon is reachable. Caches result for 30s. */
export async function isDockerAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_dockerCache !== null && now - _dockerCacheAt < DOCKER_CACHE_TTL_MS) {
    return _dockerCache;
  }
  try {
    await execFileAsync("docker", ["info"], { timeout: 5_000 });
    _dockerCache = true;
  } catch {
    _dockerCache = false;
  }
  _dockerCacheAt = Date.now();
  return _dockerCache;
}

/** Returns true when git worktree commands are available. */
export async function isWorktreeAvailable(): Promise<boolean> {
  try {
    await execFileAsync("git", ["worktree", "list"], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

/** Returns the ordered list of available isolation strategies (preferred first). */
export async function detectAvailableStrategies(): Promise<IsolationStrategy[]> {
  const [docker, worktree] = await Promise.all([
    isDockerAvailable(),
    isWorktreeAvailable(),
  ]);
  const available: IsolationStrategy[] = [];
  if (docker) available.push("docker");
  if (worktree) available.push("worktree");
  available.push("host"); // host is always nominally available as escape
  return available;
}

/** Returns the preferred strategy given availability and mode preference. */
export async function selectStrategy(
  preferDocker: boolean,
): Promise<"docker" | "worktree" | "host"> {
  const [docker, worktree] = await Promise.all([
    isDockerAvailable(),
    isWorktreeAvailable(),
  ]);
  if (preferDocker && docker) return "docker";
  if (worktree) return "worktree";
  if (docker) return "docker";
  return "host";
}

/** Invalidates the Docker availability cache (useful for tests). */
export function resetCapabilityCache(): void {
  _dockerCache = null;
  _dockerCacheAt = 0;
}
