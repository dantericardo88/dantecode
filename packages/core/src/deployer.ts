// ============================================================================
// deployer.ts — Multi-platform deployment integration
// Based on Bolt.DIY's deployment abstraction pattern.
// ============================================================================

import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type DeploymentPlatform = "vercel" | "netlify" | "github-pages" | "fly" | "railway";

export interface DeploymentConfig {
  platform: DeploymentPlatform;
  projectRoot: string;
  /** e.g., "npm run build" */
  buildCommand?: string;
  /** e.g., "dist", ".next", "out" */
  outputDir?: string;
  /** Platform API key */
  apiKey?: string;
  /** Platform project name */
  projectName?: string;
}

export interface DeploymentResult {
  success: boolean;
  /** Deployed URL if available */
  url?: string;
  platform: DeploymentPlatform;
  durationMs: number;
  error?: string;
  logs: string[];
}

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Detect deployment platform from config files in the project root.
 * Returns null if no recognisable config found.
 */
export function detectDeploymentPlatform(projectRoot: string): DeploymentPlatform | null {
  const checks: Array<[string, DeploymentPlatform]> = [
    ["vercel.json", "vercel"],
    [".vercel/project.json", "vercel"],
    ["netlify.toml", "netlify"],
    ["fly.toml", "fly"],
    ["railway.toml", "railway"],
    [".github/workflows/pages.yml", "github-pages"],
  ];

  for (const [file, platform] of checks) {
    if (existsSync(join(projectRoot, file))) {
      return platform;
    }
  }

  return null;
}

// ─── Output directory detection ───────────────────────────────────────────────

const CANDIDATE_OUTPUT_DIRS = ["dist", "build", ".next", "out", "public"];

function detectOutputDir(projectRoot: string, hint?: string): string {
  if (hint) return hint;

  for (const dir of CANDIDATE_OUTPUT_DIRS) {
    if (existsSync(join(projectRoot, dir))) {
      return dir;
    }
  }

  return "dist"; // sensible fallback
}

// ─── CLI availability ─────────────────────────────────────────────────────────

function isCLIAvailable(name: string): boolean {
  try {
    execSync(`${name} --version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function tryExec(
  cmd: string,
  args: string[],
  cwd: string,
  logs: string[],
  env?: Record<string, string>,
): string {
  try {
    const result = execFileSync(cmd, args, {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, ...env },
    });
    const output = result.toString().trim();
    if (output) logs.push(output);
    return output;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push(`error: ${msg}`);
    throw new Error(msg);
  }
}

// ─── Platform deployers ───────────────────────────────────────────────────────

async function deployVercel(
  config: DeploymentConfig,
  logs: string[],
): Promise<{ url?: string }> {
  const hasVercelCLI = isCLIAvailable("vercel") || isCLIAvailable("npx");

  if (!hasVercelCLI) {
    const instructions = [
      "Install Vercel CLI: npm i -g vercel",
      "Login: vercel login",
      `Deploy: vercel deploy --prod${config.projectName ? ` --name ${config.projectName}` : ""}`,
    ];
    logs.push(...instructions);
    return {};
  }

  const env: Record<string, string> = config.apiKey ? { VERCEL_TOKEN: config.apiKey } : {};
  const args = ["vercel", "deploy", "--prod", "--yes"];
  if (config.projectName) args.push("--name", config.projectName);

  const output = tryExec("npx", args, config.projectRoot, logs, env);

  // Extract URL from output (Vercel prints the URL on the last line)
  const urlMatch = output.match(/https?:\/\/[^\s]+\.vercel\.app[^\s]*/);
  return { url: urlMatch?.[0] };
}

async function deployNetlify(
  config: DeploymentConfig,
  logs: string[],
): Promise<{ url?: string }> {
  const hasNetlifyCLI = isCLIAvailable("netlify") || isCLIAvailable("npx");

  if (!hasNetlifyCLI) {
    const outputDir = detectOutputDir(config.projectRoot, config.outputDir);
    const instructions = [
      "Install Netlify CLI: npm i -g netlify-cli",
      "Login: netlify login",
      `Deploy: netlify deploy --prod --dir=${outputDir}`,
    ];
    logs.push(...instructions);
    return {};
  }

  const outputDir = detectOutputDir(config.projectRoot, config.outputDir);
  const env: Record<string, string> = config.apiKey ? { NETLIFY_AUTH_TOKEN: config.apiKey } : {};
  const args = ["netlify-cli", "deploy", "--prod", `--dir=${outputDir}`];
  if (config.projectName) args.push(`--site=${config.projectName}`);

  const output = tryExec("npx", args, config.projectRoot, logs, env);

  const urlMatch = output.match(/https?:\/\/[^\s]+\.netlify\.app[^\s]*/);
  return { url: urlMatch?.[0] };
}

async function deployGitHubPages(
  config: DeploymentConfig,
  logs: string[],
): Promise<{ url?: string }> {
  const outputDir = detectOutputDir(config.projectRoot, config.outputDir);
  const args = ["gh-pages", "-d", outputDir];

  tryExec("npx", args, config.projectRoot, logs);

  logs.push(`Deployed to GitHub Pages from ${outputDir}/`);
  return {}; // URL depends on repo name — can't determine without git remote parsing
}

async function deployFly(
  config: DeploymentConfig,
  logs: string[],
): Promise<{ url?: string }> {
  const args = ["deploy"];
  if (config.projectName) args.push("--app", config.projectName);

  const output = tryExec("flyctl", args, config.projectRoot, logs);

  const urlMatch = output.match(/https?:\/\/[^\s]+\.fly\.dev[^\s]*/);
  return { url: urlMatch?.[0] };
}

async function deployRailway(
  config: DeploymentConfig,
  logs: string[],
): Promise<{ url?: string }> {
  const output = tryExec("railway", ["up"], config.projectRoot, logs);

  const urlMatch = output.match(/https?:\/\/[^\s]+\.railway\.app[^\s]*/);
  return { url: urlMatch?.[0] };
}

// ─── Main deploy function ─────────────────────────────────────────────────────

/**
 * Deploy a project to the specified platform.
 *
 * Steps:
 * 1. Run build command if specified.
 * 2. Detect output directory.
 * 3. Execute platform-specific deployment.
 * 4. Return result with URL if available.
 */
export async function deploy(config: DeploymentConfig): Promise<DeploymentResult> {
  const startMs = Date.now();
  const logs: string[] = [];

  try {
    // ── Step 1: Build ──
    if (config.buildCommand) {
      logs.push(`Running build: ${config.buildCommand}`);
      try {
        const buildOutput = execSync(config.buildCommand, {
          cwd: config.projectRoot,
          encoding: "utf-8",
        });
        if (buildOutput) logs.push(buildOutput.trim());
        logs.push("Build complete.");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          platform: config.platform,
          durationMs: Date.now() - startMs,
          error: `Build failed: ${msg}`,
          logs,
        };
      }
    }

    // ── Step 2 & 3: Platform-specific deploy ──
    let platformResult: { url?: string };

    logs.push(`Deploying to ${config.platform}...`);

    switch (config.platform) {
      case "vercel":
        platformResult = await deployVercel(config, logs);
        break;
      case "netlify":
        platformResult = await deployNetlify(config, logs);
        break;
      case "github-pages":
        platformResult = await deployGitHubPages(config, logs);
        break;
      case "fly":
        platformResult = await deployFly(config, logs);
        break;
      case "railway":
        platformResult = await deployRailway(config, logs);
        break;
      default: {
        const exhaustive: never = config.platform;
        throw new Error(`Unknown platform: ${exhaustive as string}`);
      }
    }

    logs.push(`Deployment to ${config.platform} complete.`);

    return {
      success: true,
      url: platformResult.url,
      platform: config.platform,
      durationMs: Date.now() - startMs,
      logs,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      platform: config.platform,
      durationMs: Date.now() - startMs,
      error: msg,
      logs,
    };
  }
}
