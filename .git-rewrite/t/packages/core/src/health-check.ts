// ============================================================================
// @dantecode/core — Startup Health Check
// Verifies runtime prerequisites before the agent loop begins.
// ============================================================================

import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Result of a single health check. */
export interface HealthCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

/** Aggregate result returned by runStartupHealthCheck. */
export interface HealthCheckResult {
  checks: HealthCheck[];
  healthy: boolean;
}

/** Configuration accepted by the health check runner. */
export interface HealthCheckConfig {
  projectRoot: string;
}

// ----------------------------------------------------------------------------
// ANSI helpers (matches agent-loop.ts style)
// ----------------------------------------------------------------------------

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ----------------------------------------------------------------------------
// Individual Checks
// ----------------------------------------------------------------------------

/**
 * Verify the current Node.js version is >= 18.
 */
function checkNodeVersion(): HealthCheck {
  const major = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major >= 18) {
    return {
      name: "Node.js version",
      status: "pass",
      message: `v${process.versions.node} (>= 18 required)`,
    };
  }
  return {
    name: "Node.js version",
    status: "fail",
    message: `v${process.versions.node} — Node.js >= 18 is required`,
  };
}

/**
 * Verify the `.dantecode/` directory exists or can be created.
 */
async function checkDantecodeDirectory(projectRoot: string): Promise<HealthCheck> {
  const dirPath = join(projectRoot, ".dantecode");
  try {
    await access(dirPath);
    return {
      name: ".dantecode/ directory",
      status: "pass",
      message: "exists",
    };
  } catch {
    // Directory doesn't exist — try to create it
    try {
      await mkdir(dirPath, { recursive: true });
      return {
        name: ".dantecode/ directory",
        status: "pass",
        message: "created successfully",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        name: ".dantecode/ directory",
        status: "fail",
        message: `cannot create .dantecode/ — ${msg}`,
      };
    }
  }
}

/**
 * Check that at least one provider API key is configured via environment
 * variables. Checks: GROK_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY,
 * OLLAMA_HOST (Ollama runs locally, so its host counts as "configured").
 */
function checkProviderApiKeys(): HealthCheck {
  const knownKeys: Array<{ env: string; provider: string }> = [
    { env: "GROK_API_KEY", provider: "Grok" },
    { env: "ANTHROPIC_API_KEY", provider: "Anthropic" },
    { env: "OPENAI_API_KEY", provider: "OpenAI" },
    { env: "OLLAMA_HOST", provider: "Ollama" },
  ];

  const configured = knownKeys.filter((k) => {
    const val = process.env[k.env];
    return val !== undefined && val.trim().length > 0;
  });

  if (configured.length > 0) {
    const names = configured.map((k) => k.provider).join(", ");
    return {
      name: "Provider API keys",
      status: "pass",
      message: `${configured.length} provider(s) configured: ${names}`,
    };
  }

  return {
    name: "Provider API keys",
    status: "warn",
    message:
      "No provider API keys found. Set GROK_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or OLLAMA_HOST.",
  };
}

/**
 * Check that the DanteForge binary (compiled engine) is loadable.
 * Catches gracefully if the binary is not available.
 */
function checkDanteForge(): HealthCheck {
  try {
    // Use createRequire so esbuild doesn't statically follow the package
    // and bundle its contents into the core dist chunk. We only need to
    // verify the package resolves at runtime — not import it.
    const req = createRequire(import.meta.url);
    req.resolve("@dantecode/danteforge");
    return {
      name: "DanteForge binary",
      status: "pass",
      message: "loadable",
    };
  } catch {
    return {
      name: "DanteForge binary",
      status: "warn",
      message:
        "DanteForge binary not found. Some features (anti-stub, PDSE, constitution) will be unavailable.",
    };
  }
}

// ----------------------------------------------------------------------------
// Logging
// ----------------------------------------------------------------------------

/**
 * Prints the health check results as a formatted table to stdout.
 */
function logHealthCheckTable(result: HealthCheckResult): void {
  const statusIcon = (status: HealthCheck["status"]): string => {
    switch (status) {
      case "pass":
        return `${GREEN}PASS${RESET}`;
      case "warn":
        return `${YELLOW}WARN${RESET}`;
      case "fail":
        return `${RED}FAIL${RESET}`;
    }
  };

  process.stdout.write(`\n${BOLD}Startup Health Check${RESET}\n`);
  process.stdout.write(`${DIM}${"─".repeat(60)}${RESET}\n`);

  for (const check of result.checks) {
    const icon = statusIcon(check.status);
    const name = check.name.padEnd(24);
    process.stdout.write(`  ${icon}  ${name} ${DIM}${check.message}${RESET}\n`);
  }

  process.stdout.write(`${DIM}${"─".repeat(60)}${RESET}\n`);

  if (result.healthy) {
    process.stdout.write(`  ${GREEN}${BOLD}All checks passed.${RESET}\n\n`);
  } else {
    const failCount = result.checks.filter((c) => c.status === "fail").length;
    const warnCount = result.checks.filter((c) => c.status === "warn").length;
    const parts: string[] = [];
    if (failCount > 0) parts.push(`${failCount} failed`);
    if (warnCount > 0) parts.push(`${warnCount} warning(s)`);
    process.stdout.write(
      `  ${YELLOW}${BOLD}${parts.join(", ")} — see above for details.${RESET}\n\n`,
    );
  }
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Runs all startup health checks and returns the aggregate result.
 *
 * Checks performed:
 *   1. Node.js version >= 18
 *   2. `.dantecode/` directory exists or can be created
 *   3. At least one provider API key is configured
 *   4. DanteForge binary is loadable
 *
 * Results are logged as a formatted table to stdout.
 * The function never throws — all errors are captured as check results.
 *
 * @param config - Health check configuration (project root path).
 * @returns The aggregate HealthCheckResult.
 */
export async function runStartupHealthCheck(config: HealthCheckConfig): Promise<HealthCheckResult> {
  const checks: HealthCheck[] = [];

  // 1. Node.js version
  checks.push(checkNodeVersion());

  // 2. .dantecode/ directory
  checks.push(await checkDantecodeDirectory(config.projectRoot));

  // 3. Provider API keys
  checks.push(checkProviderApiKeys());

  // 4. DanteForge binary
  checks.push(checkDanteForge());

  const healthy = checks.every((c) => c.status !== "fail");

  const result: HealthCheckResult = { checks, healthy };
  logHealthCheckTable(result);

  return result;
}
