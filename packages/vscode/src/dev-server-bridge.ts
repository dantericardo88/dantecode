// ============================================================================
// packages/vscode/src/dev-server-bridge.ts
//
// Dim 14 — Re-exposes dev-server-manager logic for the VSCode extension
// without a cross-package dependency on @dantecode/cli.
// ============================================================================

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface DevServerHandle {
  port: number;
  url: string;
  kill(): void;
  captureOutput(): string[];
  onExit(cb: (code: number | null) => void): void;
}

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

const READY_PATTERN =
  /localhost:(\d+)|on port (\d+)|ready on .+:(\d+)|listening on .+:(\d+)|server running.*:(\d+)/i;

export async function startDevServer(config: {
  command: string;
  cwd: string;
  timeoutMs?: number;
}): Promise<DevServerHandle> {
  const { command, cwd, timeoutMs = 30_000 } = config;

  return new Promise((res, rej) => {
    const [cmd, ...args] = command.split(" ");
    const child = spawn(cmd!, args, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    let resolved = false;
    const lineBuffer: string[] = [];

    const tryResolve = (line: string) => {
      if (line.trim()) lineBuffer.push(line);
      if (resolved) return;
      const match = line.match(READY_PATTERN);
      if (match) {
        const portStr = match.slice(1).find((g) => g && /^\d+$/.test(g));
        const port = portStr ? parseInt(portStr, 10) : 3000;
        resolved = true;
        clearTimeout(timer);
        const outputBuf: string[] = [...lineBuffer];
        const exitCallbacks: Array<(code: number | null) => void> = [];
        child.on("exit", (code) => exitCallbacks.forEach((cb) => cb(code)));
        res({ port, url: `http://localhost:${port}`, kill: () => { try { child.kill("SIGTERM"); } catch { /* */ } }, captureOutput: () => [...outputBuf], onExit: (cb) => exitCallbacks.push(cb) });
      }
    };

    child.stdout?.on("data", (c: Buffer) => c.toString().split(/\r?\n/).forEach(tryResolve));
    child.stderr?.on("data", (c: Buffer) => c.toString().split(/\r?\n/).forEach(tryResolve));
    child.on("exit", (code) => {
      if (!resolved) rej(new Error(`Dev server exited (code ${code}) before ready`));
    });

    const timer = setTimeout(() => {
      if (!resolved) { child.kill("SIGTERM"); rej(new Error(`Dev server timed out after ${timeoutMs}ms`)); }
    }, timeoutMs);
  });
}
