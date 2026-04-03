// ============================================================================
// @dantecode/cli — Startup Banner
// ============================================================================

import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * ANSI color helpers for terminal output.
 */
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/**
 * Detects whether an API key is configured for the given provider by checking
 * environment variables. Returns the first matching key name found, or null.
 */
function detectApiKey(provider: string): string | null {
  const envMappings: Record<string, string[]> = {
    grok: ["XAI_API_KEY", "GROK_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    openai: ["OPENAI_API_KEY"],
    google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    groq: ["GROQ_API_KEY"],
    ollama: [], // Ollama runs locally, no key needed
    custom: [],
  };

  const keys = envMappings[provider] ?? [];
  for (const key of keys) {
    if (process.env[key] && process.env[key]!.length > 0) {
      return key;
    }
  }
  return null;
}

/**
 * Format API key status for display.
 */
function formatApiKeyStatus(provider: string): string {
  if (provider === "ollama") {
    return `${GREEN}Local (no key needed)${RESET}`;
  }
  const keyName = detectApiKey(provider);
  if (keyName) {
    return `${GREEN}${keyName} detected${RESET}`;
  }
  return `${RED}No API key found${RESET}`;
}

/**
 * Returns the startup banner string for the DanteCode CLI.
 *
 * @param model - The default model configuration to display.
 * @param projectRoot - The project root directory.
 * @param version - The DanteCode version string. Defaults to "1.0.0".
 * @returns The formatted banner string.
 */
export function getBanner(
  model: ModelConfig,
  projectRoot: string,
  version: string = "1.0.0",
): string {
  const modelDisplay = `${model.provider}/${model.modelId}`;
  const apiKeyStatus = formatApiKeyStatus(model.provider);

  const lines = [
    "",
    `${CYAN}${BOLD}DanteCode${RESET} v${version}`,
    "",
    `  ${DIM}Model:${RESET}     ${BOLD}${modelDisplay}${RESET}`,
    `  ${DIM}API Key:${RESET}   ${apiKeyStatus}`,
    `  ${DIM}Project:${RESET}   ${projectRoot}`,
    "",
    `  ${DIM}Type${RESET} ${YELLOW}/magic${RESET} ${DIM}to start building, or${RESET} ${YELLOW}/help${RESET} ${DIM}for commands.${RESET}`,
    "",
  ];

  return lines.join("\n");
}

/**
 * Returns a compact banner for one-shot mode (no interactive REPL).
 */
export function getOneShotBanner(model: ModelConfig, version: string = "1.0.0"): string {
  const modelDisplay = `${model.provider}/${model.modelId}`;
  return `${CYAN}${BOLD}DanteCode${RESET} v${version} ${DIM}(${modelDisplay})${RESET}`;
}

/**
 * Returns the help text shown when the user runs dantecode --help.
 */
export function getHelpText(): string {
  return `
${BOLD}DanteCode${RESET} \u2014 Build software by describing what you want

${BOLD}USAGE${RESET}
  dantecode                       Start interactive session
  dantecode "prompt"              Run a single task and exit
  dantecode init                  Set up a new project

${BOLD}OPTIONS${RESET}
  --model <id>        Choose AI model (e.g. anthropic/claude-sonnet-4-20250514)
  --execution-profile <name>
                      Use an explicit runtime profile (e.g. benchmark)
  --verbose           Show detailed output
  --version           Print version and exit
  --help              Show this help message

${BOLD}KEY COMMANDS${RESET}
  /magic <goal>       Build something \u2014 describe what you want
  /help               Show all available commands
  /help --all         Show every command (advanced)
  /status             Check project health and settings
  /diff               See what changed
  /commit             Save your changes
  /undo               Undo the last change
  /party <task>       Multi-agent build (advanced)
  /compact            Free up conversation space

${DIM}Documentation: https://dantecode.dev/docs${RESET}
`;
}

/**
 * Checks if this is the user's first run by looking for session history.
 */
export function isFirstRun(projectRoot: string): boolean {
  const sessionsDir = join(projectRoot, ".dantecode", "sessions");
  try {
    const entries = readdirSync(sessionsDir);
    return entries.filter((e) => e.endsWith(".json")).length === 0;
  } catch {
    return true; // Directory doesn't exist => first run
  }
}

/**
 * Returns a welcoming first-run banner with example tasks.
 */
export function getFirstRunBanner(version: string = "1.0.0"): string {
  const lines = [
    "",
    `${CYAN}${BOLD}Welcome to DanteCode${RESET} v${version}`,
    "",
    `  ${DIM}Describe what you want to build:${RESET}`,
    `    ${YELLOW}/magic "Build a todo app with user accounts"${RESET}`,
    `    ${YELLOW}/magic "Add search to the product catalog"${RESET}`,
    "",
    `  ${DIM}Or just type what you need in plain language.${RESET}`,
    `  ${DIM}Type${RESET} ${YELLOW}/help${RESET} ${DIM}for all commands.${RESET}`,
    "",
  ];
  return lines.join("\n");
}

/**
 * Returns a compact one-line banner for subsequent runs.
 */
export function getCompactBanner(model: ModelConfig, version: string = "1.0.0"): string {
  return `${CYAN}${BOLD}DanteCode${RESET} v${version} ${DIM}\u00b7${RESET} ${model.provider}/${model.modelId} ${DIM}\u00b7${RESET} ${YELLOW}/help${RESET}`;
}
