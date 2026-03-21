// ============================================================================
// @dantecode/core — Council Bridge Listener
// Daemon that watches the file-bridge inbox directory, spawns agent CLIs for
// each new session, and writes results to the outbox.
// ============================================================================

import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  spawn as nodeSpawn,
  type SpawnOptions,
  type ChildProcess,
} from "node:child_process";
import type { CouncilTaskPacket } from "./council-types.js";

/** Config for a specific agent CLI tool. */
export interface AgentCommandConfig {
  kind: "claude-code" | "codex" | "antigravity";
  /** Executable name or path (e.g. "claude", "codex"). */
  command: string;
  /** Extra args prepended to all invocations. */
  args?: string[];
  /** Extra environment variables. */
  env?: Record<string, string>;
}

/** Injectable spawn function for testing. */
export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: SpawnOptions & { stdio?: "pipe" | ["pipe", "pipe", "pipe"] },
) => ChildProcess;

export interface BridgeListenerOptions {
  /** How often to poll the inbox directory (ms). Default: 5000. */
  pollIntervalMs?: number;
  /** GIT_TIMEOUT_MS for diff collection. Default: 10000. */
  gitTimeoutMs?: number;
}

/**
 * BridgeListener is a polling daemon that watches `bridgeDir/inbox/` for new
 * session directories written by file-bridge adapters (ClaudeCodeAdapter,
 * CodexAdapter, AntigravityAdapter). When a session directory contains both
 * `task.md` and `packet.json` and has not yet been claimed, BridgeListener
 * writes a `started.lock` file to claim it, spawns the appropriate agent CLI
 * non-interactively (via `--print`), captures stdout/stderr to
 * `outbox/{sessionId}/output.log`, and writes `done.json` + an optional
 * `patch.diff` on completion.
 *
 * Agent kind is resolved from `packet.laneId` prefix (since `newLaneId(kind)`
 * produces `${kind}-${uuid}`), with a fallback scan of all registered agents.
 */
export class BridgeListener {
  private readonly bridgeDir: string;
  private readonly agents: AgentCommandConfig[];
  private readonly spawnFn: SpawnFn;
  private readonly pollIntervalMs: number;
  private readonly gitTimeoutMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Track dispatched sessions to avoid double-dispatch. */
  private readonly dispatched = new Set<string>();
  /** Suppress repeated inbox-missing warnings after the first one. */
  private _inboxWarned = false;

  constructor(
    bridgeDir: string,
    agents: AgentCommandConfig[],
    spawnFn?: SpawnFn,
    options?: BridgeListenerOptions,
  ) {
    this.bridgeDir = bridgeDir;
    this.agents = agents;
    this.spawnFn = spawnFn ?? nodeSpawn;
    this.pollIntervalMs = options?.pollIntervalMs ?? 5_000;
    this.gitTimeoutMs = options?.gitTimeoutMs ?? 10_000;
  }

  /** Probes whether a CLI command is available in PATH. Non-blocking; returns false on any error. */
  private isCommandAvailable(command: string): boolean {
    const prog = process.platform === "win32" ? "where" : "which";
    try {
      execFileSync(prog, [command], { stdio: "pipe", timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  start(): void {
    if (this.pollTimer) return; // idempotent
    // Pre-flight: warn for any agent commands not found in PATH
    for (const agent of this.agents) {
      if (!this.isCommandAvailable(agent.command)) {
        process.stderr.write(
          `[bridge-listener] WARNING: "${agent.command}" (${agent.kind}) not found in PATH — sessions will fail.\n`,
        );
      }
    }
    this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
    // Run immediately on start
    void this.poll();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Exposed for testing. */
  async poll(): Promise<void> {
    const inboxBase = join(this.bridgeDir, "inbox");
    let sessionDirs: string[];
    try {
      sessionDirs = await readdir(inboxBase);
    } catch {
      if (!this._inboxWarned) {
        this._inboxWarned = true;
        process.stderr.write(
          `[bridge-listen] WARNING: inbox not found: ${inboxBase} — waiting for it to be created\n`,
        );
      }
      return;
    }

    await Promise.allSettled(
      sessionDirs.map((sessionId) => this.maybeDispatch(sessionId, inboxBase)),
    );
  }

  private async maybeDispatch(sessionId: string, inboxBase: string): Promise<void> {
    if (this.dispatched.has(sessionId)) return;

    const sessionDir = join(inboxBase, sessionId);
    const lockPath = join(sessionDir, "started.lock");
    const taskPath = join(sessionDir, "task.md");
    const packetPath = join(sessionDir, "packet.json");

    // If lock already exists, another listener/run claimed it
    try {
      await stat(lockPath);
      this.dispatched.add(sessionId);
      return;
    } catch {
      // lock missing — proceed to check required files
    }

    // Both task.md and packet.json must be present before we claim
    try {
      await Promise.all([stat(taskPath), stat(packetPath)]);
    } catch {
      return; // not ready yet
    }

    // Claim the session by writing lock (first writer wins; race is acceptable)
    try {
      await writeFile(lockPath, new Date().toISOString(), "utf-8");
    } catch {
      return; // race condition — another listener claimed it
    }

    this.dispatched.add(sessionId);
    void this.runSession(sessionId, sessionDir).catch(() => {
      // per-session fault isolation — errors are written to done.json inside
    });
  }

  private async runSession(sessionId: string, inboxDir: string): Promise<void> {
    const outboxDir = join(this.bridgeDir, "outbox", sessionId);
    await mkdir(outboxDir, { recursive: true });

    const logPath = join(outboxDir, "output.log");
    const donePath = join(outboxDir, "done.json");

    let taskContent: string;
    let packet: CouncilTaskPacket;

    try {
      const [taskRaw, packetRaw] = await Promise.all([
        readFile(join(inboxDir, "task.md"), "utf-8"),
        readFile(join(inboxDir, "packet.json"), "utf-8"),
      ]);
      taskContent = taskRaw;
      packet = JSON.parse(packetRaw) as CouncilTaskPacket;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await writeFile(
        donePath,
        JSON.stringify({ success: false, exitCode: -1, error: `Failed to read task inputs: ${msg}` }),
        "utf-8",
      );
      return;
    }

    // Resolve agent kind from laneId prefix (newLaneId produces "<kind>-<uuid>")
    const agentConfig = this.resolveAgent(packet.laneId);

    if (!agentConfig) {
      await writeFile(
        donePath,
        JSON.stringify({
          success: false,
          exitCode: -1,
          error: `No agent config matches laneId: ${packet.laneId}`,
        }),
        "utf-8",
      );
      return;
    }

    // Build args: prepend custom args, then pass task via --print (non-interactive)
    const spawnArgs = [...(agentConfig.args ?? []), "--print", taskContent];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...agentConfig.env,
    };

    // Spawn and capture stdout + stderr
    let logBuffer = "";
    let exitCode = 0;

    await new Promise<void>((resolve) => {
      const child = this.spawnFn(agentConfig.command, spawnArgs, {
        cwd: packet.worktreePath,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (child.stdout) {
        child.stdout.on("data", (chunk: Buffer) => {
          logBuffer += chunk.toString();
        });
      }
      if (child.stderr) {
        child.stderr.on("data", (chunk: Buffer) => {
          logBuffer += chunk.toString();
        });
      }

      child.on("close", (code) => {
        exitCode = code ?? 1;
        resolve();
      });
      child.on("error", (err) => {
        logBuffer += `\nProcess error: ${err.message}`;
        exitCode = 1;
        resolve();
      });
    });

    // Persist output log regardless of exit code
    await writeFile(logPath, logBuffer, "utf-8");

    if (exitCode === 0) {
      // Collect git diff from the worktree (non-fatal if it fails)
      try {
        const diff = execFileSync("git", ["diff", "HEAD"], {
          cwd: packet.worktreePath,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: this.gitTimeoutMs,
        }).trim();

        if (diff) {
          await writeFile(join(outboxDir, "patch.diff"), diff, "utf-8");
        }
      } catch {
        // Non-fatal: patch collection failure does not abort the session
      }

      await writeFile(
        donePath,
        JSON.stringify({
          success: true,
          exitCode: 0,
          completedAt: new Date().toISOString(),
        }),
        "utf-8",
      );
    } else {
      const errorTail = (logBuffer.length > 500 ? logBuffer.slice(-500) : logBuffer).trim();
      await writeFile(
        donePath,
        JSON.stringify({
          success: false,
          exitCode,
          completedAt: new Date().toISOString(),
          error: errorTail || `Process exited with code ${exitCode}`,
        }),
        "utf-8",
      );
    }
  }

  /**
   * Resolve the AgentCommandConfig for a given laneId.
   *
   * Strategy:
   *  1. The `newLaneId(kind)` factory in council-types produces `"<kind>-<uuid>"`.
   *     Extract the prefix before the first `-` and match against registered kinds.
   *  2. If no prefix match, fall back to the first registered agent (single-agent setups).
   */
  private resolveAgent(laneId: string): AgentCommandConfig | undefined {
    const prefix = laneId.split("-")[0] ?? "";
    const byPrefix = this.agents.find((a) => a.kind === prefix);
    if (byPrefix) return byPrefix;
    // Fallback: only agent registered
    if (this.agents.length === 1) return this.agents[0];
    return undefined;
  }
}
