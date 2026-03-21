// ============================================================================
// @dantecode/cli — Command: dantecode serve
// Starts the DanteCode HTTP server and exposes the agent-loop as a JSON API.
//
// Usage:
//   dantecode serve                    Start on default port (3210)
//   dantecode serve --port 8080        Custom port
//   dantecode serve --host 0.0.0.0     Listen on all interfaces (not just localhost)
//   dantecode serve --open             Start server and open browser
//   dantecode serve --mdns             Enable mDNS service discovery
//
// Environment:
//   DANTECODE_SERVER_PASSWORD  Set to require HTTP Basic auth
// ============================================================================

import { startServer } from "../serve/server.js";

// ANSI color codes (inline to avoid circular imports)
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/** Parse --port <n> from args. Returns undefined if not found. */
function parsePort(args: string[]): number | undefined {
  const idx = args.indexOf("--port");
  if (idx === -1) return undefined;
  const val = args[idx + 1];
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : undefined;
}

/** Parse --host <addr> from args. Returns undefined if not found. */
function parseHost(args: string[]): string | undefined {
  const idx = args.indexOf("--host");
  if (idx === -1) return undefined;
  return args[idx + 1] ?? undefined;
}

/**
 * Run the `dantecode serve` command.
 *
 * Parses port/host/flags from args, starts the HTTP server, logs startup
 * info, and keeps the process alive until Ctrl+C.
 */
export async function runServeCommand(args: string[]): Promise<void> {
  const port = parsePort(args) ?? 3210;
  const host = parseHost(args) ?? "127.0.0.1";
  const openBrowser = args.includes("--open");
  const enableMdns = args.includes("--mdns");
  const projectRoot = process.cwd();
  const password = process.env["DANTECODE_SERVER_PASSWORD"];

  // Security warning: non-localhost binding without auth is dangerous
  if (host !== "127.0.0.1" && host !== "localhost" && !password) {
    process.stderr.write(
      `${YELLOW}WARNING: Binding to ${host} without DANTECODE_SERVER_PASSWORD is insecure.${RESET}\n` +
        `${DIM}Set DANTECODE_SERVER_PASSWORD to require authentication.${RESET}\n\n`,
    );
  }

  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer({ port, host, projectRoot, password, enableMdns });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${"\x1b[31m"}Failed to start server: ${message}${RESET}\n`);
    process.exit(1);
  }

  // Startup banner
  process.stdout.write(`\n${GREEN}${BOLD}DanteCode server running at ${server.url}${RESET}\n`);
  process.stdout.write(`${DIM}Project:${RESET} ${projectRoot}\n`);

  if (password) {
    process.stdout.write(
      `${DIM}Auth:${RESET} ${GREEN}enabled${RESET} ${DIM}(HTTP Basic, username: dantecode)${RESET}\n`,
    );
  } else {
    process.stdout.write(
      `${DIM}Auth:${RESET} ${YELLOW}disabled${RESET} ${DIM}(set DANTECODE_SERVER_PASSWORD to enable)${RESET}\n`,
    );
  }

  process.stdout.write(`\n${DIM}Endpoints:${RESET}\n`);
  process.stdout.write(`  ${DIM}Health:${RESET}   ${server.url}/api/health\n`);
  process.stdout.write(`  ${DIM}Status:${RESET}   ${server.url}/api/status\n`);
  process.stdout.write(`  ${DIM}Sessions:${RESET} ${server.url}/api/sessions\n`);
  process.stdout.write(`  ${DIM}Stream:${RESET}   ${server.url}/api/sessions/:id/stream\n`);
  process.stdout.write(`\n${DIM}Press Ctrl+C to stop.${RESET}\n\n`);

  // Open browser if requested
  if (openBrowser) {
    try {
      const { exec } = await import("node:child_process");
      const openCmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      exec(`${openCmd} ${server.url}`);
    } catch {
      // Non-fatal — browser open failure should not crash the server
    }
  }

  // Keep process alive until Ctrl+C
  await new Promise<void>((resolve) => {
    process.on("SIGINT", async () => {
      process.stdout.write(`\n${DIM}Shutting down DanteCode server...${RESET}\n`);
      try {
        await server.stop();
      } catch {
        // Non-fatal
      }
      resolve();
    });
  });
}
