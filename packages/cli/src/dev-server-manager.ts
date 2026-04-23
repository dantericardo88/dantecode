// ============================================================================
// packages/cli/src/dev-server-manager.ts
//
// Dim 14 — Browser live preview: detect and start a local dev server,
// then expose a preview URL for the IDE preview panel.
//
// Patterns from E2B (port-based URL, ready-signal abstraction) and
// browser-use (phase-separated loop, port readiness detection).
// Decision-changing: agents can now spin up and verify running web apps,
// not just generate code in the dark.
// ============================================================================

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DevServerHandle {
  port: number;
  url: string;
  kill(): void;
  onExit(cb: (code: number | null) => void): void;
  /** Accumulated stdout+stderr lines since server started */
  captureOutput(): string[];
}

export interface DevServerConfig {
  command: string;
  cwd: string;
  readyPattern?: RegExp;
  /** Default reduced to 10s — most dev servers start in under 5s */
  timeoutMs?: number;
  /** Retry attempts before giving up (default: 2) */
  maxAttempts?: number;
}

// ── detectDevCommand ──────────────────────────────────────────────────────────

const SCRIPT_PRIORITY = ["dev", "start", "serve", "preview", "develop"] as const;

export function detectDevCommand(projectRoot: string): string | null {
  const pkgPath = join(resolve(projectRoot), "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    for (const key of SCRIPT_PRIORITY) {
      if (key in scripts) return `npm run ${key}`;
    }
    return null;
  } catch {
    return null;
  }
}

// ── startDevServer ────────────────────────────────────────────────────────────

const DEFAULT_READY_PATTERN =
  /localhost:(\d+)|on port (\d+)|ready on .+:(\d+)|listening on .+:(\d+)|server running.*:(\d+)/i;

async function _startDevServerAttempt(
  config: DevServerConfig & { readyPattern: RegExp; timeoutMs: number },
): Promise<DevServerHandle & { elapsedMs: number }> {
  const { command, cwd, readyPattern, timeoutMs } = config;
  const startMs = Date.now();

  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command.split(" ");
    const child = spawn(cmd!, args, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    let resolved = false;
    let port = 0;

    const exitCallbacks: Array<(code: number | null) => void> = [];
    const outputBuffer: string[] = [];

    const handleLine = (line: string) => {
      if (line.trim()) outputBuffer.push(line);
      const match = line.match(readyPattern);
      if (match && !resolved) {
        const portStr = match.slice(1).find((g) => g && /^\d+$/.test(g));
        port = portStr ? parseInt(portStr, 10) : 3000;
        resolved = true;
        clearTimeout(timer);

        const elapsedMs = Date.now() - startMs;
        const handle = {
          port,
          url: `http://localhost:${port}`,
          elapsedMs,
          kill: () => { try { child.kill("SIGTERM"); } catch { /* */ } },
          onExit: (cb: (code: number | null) => void) => exitCallbacks.push(cb),
          captureOutput: () => [...outputBuffer],
        };
        resolve(handle);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      chunk.toString().split(/\r?\n/).forEach(handleLine);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      chunk.toString().split(/\r?\n/).forEach(handleLine);
    });

    child.on("exit", (code) => {
      exitCallbacks.forEach((cb) => cb(code));
      if (!resolved) reject(new Error(`Dev server exited with code ${code} before becoming ready`));
    });

    const timer = setTimeout(() => {
      if (!resolved) {
        child.kill("SIGTERM");
        reject(new Error(`Dev server did not become ready within ${timeoutMs}ms`));
      }
    }, timeoutMs);
  });
}

export async function startDevServer(config: DevServerConfig): Promise<DevServerHandle> {
  const {
    readyPattern = DEFAULT_READY_PATTERN,
    timeoutMs = 10_000,
    maxAttempts = 2,
  } = config;

  let lastError: Error = new Error("Dev server failed to start");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await _startDevServerAttempt({ ...config, readyPattern, timeoutMs });
      console.log(`[dev-server] ready in ${result.elapsedMs}ms (attempt ${attempt}/${maxAttempts})`);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        console.log(`[dev-server] attempt ${attempt}/${maxAttempts} failed — retrying`);
      }
    }
  }
  throw lastError;
}

// ── getPreviewUrl ─────────────────────────────────────────────────────────────

export function getPreviewUrl(handle: DevServerHandle): string {
  return handle.url;
}
