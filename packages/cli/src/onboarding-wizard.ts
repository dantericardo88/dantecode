/**
 * onboarding-wizard.ts
 *
 * Interactive "dante init" onboarding wizard.
 * Guides first-time users through model selection, API key verification,
 * project type detection, and DanteForge configuration.
 *
 * Inspired by Cline's onboarding flow and Mastra's interactive CLI setup.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WizardConfig {
  provider: string;
  modelId: string;
  apiKeyEnv: string;
  apiKeyValue?: string;
  enableDanteForge: boolean;
  enableSandbox: boolean;
  contextWindow: number;
  projectRoot: string;
}

export interface WizardResult {
  config: WizardConfig;
  configPath: string;
  /** Whether the user skipped the wizard (accepted all defaults). */
  skipped: boolean;
}

// ---------------------------------------------------------------------------
// Model menu
// ---------------------------------------------------------------------------

interface ModelOption {
  provider: string;
  modelId: string;
  label: string;
  apiKeyEnv: string;
  contextWindow: number;
}

const MODEL_OPTIONS: ModelOption[] = [
  {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6 (Anthropic) — recommended for quality",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    contextWindow: 200_000,
  },
  {
    provider: "anthropic",
    modelId: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5 (Anthropic) — fast & cheap",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    contextWindow: 200_000,
  },
  {
    provider: "grok",
    modelId: "grok-3",
    label: "Grok-3 (xAI) — high capability",
    apiKeyEnv: "XAI_API_KEY",
    contextWindow: 131_072,
  },
  {
    provider: "openai",
    modelId: "gpt-4o",
    label: "GPT-4o (OpenAI)",
    apiKeyEnv: "OPENAI_API_KEY",
    contextWindow: 128_000,
  },
  {
    provider: "google",
    modelId: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash (Google)",
    apiKeyEnv: "GEMINI_API_KEY",
    contextWindow: 1_000_000,
  },
  {
    provider: "ollama",
    modelId: "llama3.2",
    label: "Ollama (local) — no API key needed",
    apiKeyEnv: "",
    contextWindow: 128_000,
  },
];

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function print(text: string): void {
  process.stdout.write(text + "\n");
}

function printHeader(title: string): void {
  print(`\n${CYAN}${BOLD}${title}${RESET}`);
  print(`${DIM}${"─".repeat(50)}${RESET}`);
}

function printSuccess(msg: string): void {
  print(`${GREEN}✓${RESET} ${msg}`);
}

function printWarning(msg: string): void {
  print(`${YELLOW}⚠${RESET} ${msg}`);
}

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

async function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${CYAN}?${RESET} ${question} `, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function askYN(
  rl: readline.Interface,
  question: string,
  defaultYes = true,
): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await ask(rl, `${question} ${DIM}${hint}${RESET}`);
  if (answer === "") return defaultYes;
  return /^y/i.test(answer);
}

async function askChoice(
  rl: readline.Interface,
  question: string,
  options: string[],
  defaultIndex = 0,
): Promise<number> {
  print(`\n${BOLD}${question}${RESET}`);
  options.forEach((opt, i) => {
    const marker = i === defaultIndex ? `${GREEN}>${RESET}` : " ";
    print(`  ${marker} ${DIM}${i + 1}.${RESET} ${opt}`);
  });
  const hint = `${DIM}(1–${options.length}, default: ${defaultIndex + 1})${RESET}`;
  const answer = await ask(rl, `Select ${hint}`);
  const num = parseInt(answer, 10);
  if (isNaN(num) || num < 1 || num > options.length) return defaultIndex;
  return num - 1;
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

/**
 * Run the interactive onboarding wizard.
 * @param projectRoot - The project root to initialize.
 * @param skipIfExists - Skip if .dantecode/config.json already exists. Default: true.
 */
export async function runOnboardingWizard(
  projectRoot: string,
  skipIfExists = true,
): Promise<WizardResult> {
  const configDir = path.join(projectRoot, ".dantecode");
  const configPath = path.join(configDir, "config.json");

  if (skipIfExists && fs.existsSync(configPath)) {
    const existing = JSON.parse(fs.readFileSync(configPath, "utf-8")) as WizardConfig;
    return { config: existing, configPath, skipped: true };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  try {
    printHeader("DanteCode Setup Wizard");
    print(`Welcome! Let's configure DanteCode for your project.`);
    print(`Project: ${DIM}${projectRoot}${RESET}`);

    // -----------------------------------------------------------------------
    // Step 1: Model selection
    // -----------------------------------------------------------------------
    printHeader("Step 1 of 4 — Select your AI model");
    const modelIdx = await askChoice(
      rl,
      "Which AI model would you like to use?",
      MODEL_OPTIONS.map((m) => m.label),
      0,
    );
    const selectedModel = MODEL_OPTIONS[modelIdx]!;

    // -----------------------------------------------------------------------
    // Step 2: API key
    // -----------------------------------------------------------------------
    let apiKeyValue: string | undefined;
    if (selectedModel.apiKeyEnv) {
      printHeader("Step 2 of 4 — API Key");
      const existingKey = process.env[selectedModel.apiKeyEnv];
      if (existingKey) {
        printSuccess(`${selectedModel.apiKeyEnv} is already set in your environment.`);
      } else {
        printWarning(`${selectedModel.apiKeyEnv} not found in environment.`);
        const saveKey = await askYN(
          rl,
          "Would you like to enter it now (saved to .dantecode/config.json)?",
          false,
        );
        if (saveKey) {
          apiKeyValue = await ask(rl, `Enter your ${selectedModel.apiKeyEnv}:`);
          if (!apiKeyValue)
            printWarning("Skipped — you can set it later via `dantecode config set`.");
        } else {
          print(`${DIM}Set it later with: export ${selectedModel.apiKeyEnv}=<your-key>${RESET}`);
        }
      }
    } else {
      printHeader("Step 2 of 4 — API Key");
      printSuccess("Ollama runs locally — no API key needed.");
    }

    // -----------------------------------------------------------------------
    // Step 3: DanteForge
    // -----------------------------------------------------------------------
    printHeader("Step 3 of 4 — DanteForge");
    print(`DanteForge is DanteCode's quality verification and skill orchestration engine.`);
    print(`${DIM}Enables PDSE scoring, /autoforge, /magic, /party, and more.${RESET}`);
    const enableDanteForge = await askYN(rl, "Enable DanteForge integration?", true);

    // -----------------------------------------------------------------------
    // Step 4: Sandbox
    // -----------------------------------------------------------------------
    printHeader("Step 4 of 4 — Sandbox Mode");
    print(`Sandbox mode runs Bash commands inside an isolated container (Docker required).`);
    print(`${DIM}Recommended for running untrusted code or working on sensitive repos.${RESET}`);
    const enableSandbox = await askYN(rl, "Enable sandbox mode by default?", false);

    // -----------------------------------------------------------------------
    // Build config
    // -----------------------------------------------------------------------
    const config: WizardConfig = {
      provider: selectedModel.provider,
      modelId: selectedModel.modelId,
      apiKeyEnv: selectedModel.apiKeyEnv,
      apiKeyValue: apiKeyValue || undefined,
      enableDanteForge,
      enableSandbox,
      contextWindow: selectedModel.contextWindow,
      projectRoot,
    };

    // Write config
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Summary
    printHeader("Setup Complete");
    printSuccess(`Config saved to ${DIM}${configPath}${RESET}`);
    print(`\n  Model:       ${BOLD}${config.provider}/${config.modelId}${RESET}`);
    print(
      `  DanteForge:  ${config.enableDanteForge ? `${GREEN}enabled${RESET}` : `${DIM}disabled${RESET}`}`,
    );
    print(
      `  Sandbox:     ${config.enableSandbox ? `${GREEN}enabled${RESET}` : `${DIM}disabled${RESET}`}`,
    );
    print(`\n${DIM}Run ${RESET}${CYAN}dantecode${RESET}${DIM} to start your session.${RESET}\n`);

    return { config, configPath, skipped: false };
  } finally {
    rl.close();
  }
}

/**
 * Check if onboarding is needed (no config exists) and prompt the user.
 * Returns immediately if config already exists.
 */
export async function maybeRunOnboarding(projectRoot: string): Promise<WizardConfig | null> {
  const configPath = path.join(projectRoot, ".dantecode", "config.json");
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as WizardConfig;
  }

  // Only prompt in interactive TTY
  if (!process.stdin.isTTY) return null;

  printWarning("No DanteCode config found. Run `dantecode init` to set up your project.");
  return null;
}
