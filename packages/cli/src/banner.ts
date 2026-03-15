// ============================================================================
// @dantecode/cli — Startup Banner
// ============================================================================

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
    `${CYAN}${BOLD}+==============================================================+${RESET}`,
    `${CYAN}${BOLD}|${RESET}  ${BOLD}DanteCode v${version}${RESET} ${DIM}-- Open-Source AI Coding Agent${RESET}              ${CYAN}${BOLD}|${RESET}`,
    `${CYAN}${BOLD}|${RESET}  Powered by ${BOLD}DanteForge${RESET} ${DIM}+ PDSE + Autoforge IAL${RESET}              ${CYAN}${BOLD}|${RESET}`,
    `${CYAN}${BOLD}+==============================================================+${RESET}`,
    "",
    `  ${DIM}Model:${RESET}       ${BOLD}${modelDisplay}${RESET}`,
    `  ${DIM}API Key:${RESET}     ${apiKeyStatus}`,
    `  ${DIM}Project:${RESET}     ${projectRoot}`,
    `  ${DIM}Context:${RESET}     ${model.contextWindow.toLocaleString()} tokens`,
    "",
    `  ${DIM}Type${RESET} ${YELLOW}/help${RESET} ${DIM}for commands, or start typing to chat.${RESET}`,
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
${BOLD}DanteCode${RESET} - Open-Source AI Coding Agent

${BOLD}USAGE${RESET}
  dantecode                       Start interactive REPL
  dantecode "prompt"              One-shot: execute prompt and exit
  dantecode <command> [options]   Run a specific command

${BOLD}COMMANDS${RESET}
  init                Initialize .dantecode/ project config
  skills              Manage skills (list, import, wrap, show, validate, remove)
  agent               Manage agents (list, run, create)
  config              View/edit configuration (init, show, set, models)
  git                 Git operations (status, log, diff)

${BOLD}OPTIONS${RESET}
  --model <id>        Override the default model (e.g. grok/grok-3, anthropic/claude-sonnet-4-20250514)
  --no-git            Disable git auto-commit for this session
  --sandbox           Run commands in a sandboxed container
  --worktree          Create a git worktree for this session
  --verbose           Enable verbose/debug output
  --config <path>     Use a custom config file path
  --version           Print version and exit
  --help              Show this help message

${BOLD}REPL SLASH COMMANDS${RESET}
  /help               Show all available slash commands
  /model <id>         Switch model mid-session
  /add <file>         Add a file to the conversation context
  /drop <file>        Remove a file from context
  /files              List files currently in context
  /diff               Show pending changes (unstaged diff)
  /commit             Trigger an auto-commit of touched files
  /revert             Revert the last auto-commit
  /undo               Undo the last file edit
  /lessons            Show project lessons from the lessons DB
  /pdse <file>        Run PDSE scorer on a file
  /qa                 Run GStack QA pipeline
  /audit              Show recent audit log entries
  /clear              Clear the conversation history
  /tokens             Show token usage for the current session
  /web <url>          Fetch URL content and add to context
  /skill <name>       Activate a skill by name
  /agents             List available agent definitions
  /worktree           Create a git worktree for isolated changes
  /sandbox            Toggle sandbox mode on/off

${DIM}Documentation: https://dantecode.dev/docs${RESET}
`;
}
