// ============================================================================
// @dantecode/cli — Init Command
// Creates the .dantecode/ directory structure with default STATE.yaml,
// AGENTS.dc.md template, and skills/agents directories.
// Scans for API keys, detects project language, and writes STATE.yaml
// with language-aware GStack defaults.
// ============================================================================

import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";
import {
  initializeState,
  stateYamlExists,
  detectProjectStack,
  getGStackDefaults,
} from "@dantecode/core";
import type { InitializeStateOptions } from "@dantecode/core";

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ----------------------------------------------------------------------------
// Provider Configuration
// ----------------------------------------------------------------------------

/** Maps provider names to their environment variable keys. */
export const PROVIDER_ENV_MAP: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  grok: ["XAI_API_KEY", "GROK_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
};

/** Default model configurations per provider. */
export const PROVIDER_DEFAULTS: Record<string, { modelId: string; contextWindow: number }> = {
  anthropic: { modelId: "claude-sonnet-4-20250514", contextWindow: 200000 },
  grok: { modelId: "grok-3", contextWindow: 131072 },
  openai: { modelId: "gpt-4o", contextWindow: 128000 },
  google: { modelId: "gemini-2.5-pro", contextWindow: 1048576 },
  groq: { modelId: "llama-3.3-70b-versatile", contextWindow: 131072 },
  ollama: { modelId: "llama3.2", contextWindow: 131072 },
};

// ----------------------------------------------------------------------------
// AGENTS.dc.md Template
// ----------------------------------------------------------------------------

const AGENTS_DC_MD_TEMPLATE = `---
name: project-agent
description: Default project agent for DanteCode
---

# Project Agent

This is the default agent configuration for your DanteCode project.
Customize it to define how DanteCode interacts with your codebase.

## Instructions

- Follow the project's coding conventions and style guide
- Write complete, production-ready code (no stubs or placeholders)
- Include error handling for all async operations
- Add JSDoc comments to exported functions and types
- Run type-checking and tests after making changes

## Context

This project uses:
- Language: (specify your language)
- Framework: (specify your framework)
- Test runner: (specify your test runner)
- Build tool: (specify your build tool)

## Rules

1. Always read existing files before editing them
2. Preserve existing code style and conventions
3. Do not modify files outside the project scope
4. Ask for clarification when the task is ambiguous
5. Verify changes by running the project's test suite
`;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Prompts the user for input via readline and returns the trimmed answer.
 */
export function askQuestion(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Checks whether a file exists at the given path.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scans the environment for known API keys and returns an array of
 * [providerName, envVarName] tuples for each detected key.
 */
export function scanForApiKeys(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const [provider, envVars] of Object.entries(PROVIDER_ENV_MAP)) {
    for (const envVar of envVars) {
      if (process.env[envVar]) {
        found.push([provider, envVar]);
        break; // Only count each provider once
      }
    }
  }
  return found;
}

/**
 * Checks whether ollama is available on the system PATH.
 */
export function isOllamaAvailable(): boolean {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    execFileSync(cmd, ["ollama"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Init Command
// ----------------------------------------------------------------------------

/**
 * Runs the `dantecode init` command.
 *
 * Creates the full .dantecode/ directory structure:
 * - .dantecode/STATE.yaml (project configuration)
 * - .dantecode/AGENTS.dc.md (default agent definition)
 * - .dantecode/skills/ (skill storage directory)
 * - .dantecode/agents/ (agent definition directory)
 *
 * Scans for API keys, auto-detects project language, and writes
 * STATE.yaml with the selected provider and language-aware GStack defaults.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @param force - If true, uses first detected provider and overwrites existing files.
 */
export async function runInitCommand(projectRoot: string, force: boolean = false): Promise<void> {
  process.stdout.write(`\n${BOLD}Initializing DanteCode project...${RESET}\n\n`);

  // ── Step 1: Check for existing STATE.yaml ──────────────────────────────
  const stateExists = await stateYamlExists(projectRoot);
  if (stateExists && !force) {
    process.stdout.write(
      `${YELLOW}STATE.yaml already exists. Use --force to overwrite.${RESET}\n\n`,
    );
  }

  // ── Step 2: Scan for API keys and select provider ──────────────────────
  const detectedKeys = scanForApiKeys();
  let selectedProvider: string;
  let providerDefaults: { modelId: string; contextWindow: number };

  if (detectedKeys.length === 1) {
    // Auto-select the single detected provider
    const [provider, envVar] = detectedKeys[0]!;
    selectedProvider = provider;
    providerDefaults = PROVIDER_DEFAULTS[provider]!;
    process.stdout.write(
      `${GREEN}Found ${provider} API key (${envVar}). Using ${providerDefaults.modelId} as default.${RESET}\n`,
    );
  } else if (detectedKeys.length > 1) {
    if (force) {
      // Force mode: use the first detected provider
      const [provider] = detectedKeys[0]!;
      selectedProvider = provider;
      providerDefaults = PROVIDER_DEFAULTS[provider]!;
      process.stdout.write(
        `${GREEN}Force mode: using ${provider} (${providerDefaults.modelId}) as default.${RESET}\n`,
      );
    } else {
      // Multiple keys: show numbered menu
      process.stdout.write(`${CYAN}Multiple API keys detected. Select a provider:${RESET}\n\n`);
      for (let i = 0; i < detectedKeys.length; i++) {
        const [provider] = detectedKeys[i]!;
        const defaults = PROVIDER_DEFAULTS[provider]!;
        process.stdout.write(`  ${BOLD}${i + 1}${RESET}) ${provider} (${defaults.modelId})\n`);
      }
      process.stdout.write("\n");

      const answer = await askQuestion(`${CYAN}Enter choice [1-${detectedKeys.length}]: ${RESET}`);
      const choice = parseInt(answer, 10);

      if (isNaN(choice) || choice < 1 || choice > detectedKeys.length) {
        process.stderr.write(`${RED}Invalid choice. Aborting.${RESET}\n`);
        process.exitCode = 1;
        return;
      }

      const [provider] = detectedKeys[choice - 1]!;
      selectedProvider = provider;
      providerDefaults = PROVIDER_DEFAULTS[provider]!;
      process.stdout.write(`${GREEN}Selected ${provider} (${providerDefaults.modelId}).${RESET}\n`);
    }
  } else {
    // No API keys found — check for ollama
    if (isOllamaAvailable()) {
      selectedProvider = "ollama";
      providerDefaults = PROVIDER_DEFAULTS["ollama"]!;
      process.stdout.write(
        `${GREEN}No API keys found, but ollama detected on PATH. Using ${providerDefaults.modelId} as default.${RESET}\n`,
      );
    } else if (process.env["DANTECODE_NONINTERACTIVE"] === "1") {
      // Non-interactive mode (smoke tests, CI without credentials) — proceed
      // without a live provider. STATE.yaml is written with ollama defaults as a
      // harmless placeholder. The CLI will not make real API calls in this mode.
      selectedProvider = "ollama";
      providerDefaults = PROVIDER_DEFAULTS["ollama"]!;
      process.stdout.write(
        `${YELLOW}No API keys found (non-interactive mode). Writing STATE.yaml with placeholder provider.${RESET}\n`,
      );
    } else {
      process.stderr.write(`${RED}No API keys found.${RESET}\n\n`);
      process.stderr.write(`Set one of the following environment variables:\n\n`);
      process.stderr.write(`  ${BOLD}ANTHROPIC_API_KEY${RESET}   — Anthropic (Claude)\n`);
      process.stderr.write(`  ${BOLD}XAI_API_KEY${RESET}        — xAI (Grok)\n`);
      process.stderr.write(`  ${BOLD}OPENAI_API_KEY${RESET}     — OpenAI (GPT)\n`);
      process.stderr.write(`  ${BOLD}GOOGLE_API_KEY${RESET}     — Google (Gemini)\n`);
      process.stderr.write(`  ${BOLD}GROQ_API_KEY${RESET}       — Groq\n\n`);
      process.stderr.write(`Or install ${BOLD}ollama${RESET} for local inference.\n\n`);
      process.exitCode = 1;
      return;
    }
  }

  // ── Step 3: Detect project language ────────────────────────────────────
  const detectedStack = detectProjectStack(projectRoot);
  const language = detectedStack.language !== "unknown" ? detectedStack.language : "";

  if (language) {
    process.stdout.write(
      `${GREEN}Detected project language: ${BOLD}${language}${RESET}${GREEN}.${RESET}\n`,
    );
    if (detectedStack.framework) {
      process.stdout.write(`${DIM}  Framework: ${detectedStack.framework}${RESET}\n`);
    }
    if (detectedStack.testRunner) {
      process.stdout.write(`${DIM}  Test runner: ${detectedStack.testRunner}${RESET}\n`);
    }
    if (detectedStack.packageManager) {
      process.stdout.write(`${DIM}  Package manager: ${detectedStack.packageManager}${RESET}\n`);
    }
  } else {
    process.stdout.write(`${YELLOW}Could not auto-detect project language.${RESET}\n`);
  }

  // ── Step 4: Create directory structure ─────────────────────────────────
  const dantecodeDir = join(projectRoot, ".dantecode");
  const created: string[] = [];
  const skipped: string[] = [];

  // Create .dantecode/ directory
  try {
    await mkdir(dantecodeDir, { recursive: true });
    created.push(".dantecode/");
  } catch {
    // Directory might already exist, which is fine
  }

  // Create .dantecode/skills/ directory
  const skillsDir = join(dantecodeDir, "skills");
  try {
    await mkdir(skillsDir, { recursive: true });
    created.push(".dantecode/skills/");
  } catch {
    // Already exists
  }

  // Create .dantecode/agents/ directory
  const agentsDir = join(dantecodeDir, "agents");
  try {
    await mkdir(agentsDir, { recursive: true });
    created.push(".dantecode/agents/");
  } catch {
    // Already exists
  }

  // ── Step 5: Write STATE.yaml ───────────────────────────────────────────
  if (stateExists && !force) {
    skipped.push(".dantecode/STATE.yaml (already exists)");
  } else {
    try {
      const gstackCommands = getGStackDefaults(detectedStack);
      const stateOptions: InitializeStateOptions = {
        provider: selectedProvider as InitializeStateOptions["provider"],
        modelId: providerDefaults.modelId,
        contextWindow: providerDefaults.contextWindow,
        language,
        gstackOverrides: gstackCommands,
      };
      await initializeState(projectRoot, stateOptions);
      created.push(".dantecode/STATE.yaml");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${RED}Error creating STATE.yaml: ${message}${RESET}\n`);
    }
  }

  // Create AGENTS.dc.md template
  const agentsMdPath = join(dantecodeDir, "AGENTS.dc.md");
  const agentsMdExists = await fileExists(agentsMdPath);
  if (agentsMdExists && !force) {
    skipped.push(".dantecode/AGENTS.dc.md (already exists)");
  } else {
    try {
      await writeFile(agentsMdPath, AGENTS_DC_MD_TEMPLATE, "utf-8");
      created.push(".dantecode/AGENTS.dc.md");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${RED}Error creating AGENTS.dc.md: ${message}${RESET}\n`);
    }
  }

  // Create .gitignore for .dantecode/ (don't track worktrees and temp files)
  const gitignorePath = join(dantecodeDir, ".gitignore");
  const gitignoreExists = await fileExists(gitignorePath);
  if (gitignoreExists && !force) {
    skipped.push(".dantecode/.gitignore (already exists)");
  } else {
    const gitignoreContent = [
      "# DanteCode internal files",
      "worktrees/",
      "*.tmp",
      "lessons.db",
      "lessons.db-wal",
      "lessons.db-shm",
      "",
    ].join("\n");

    try {
      await writeFile(gitignorePath, gitignoreContent, "utf-8");
      created.push(".dantecode/.gitignore");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${RED}Error creating .gitignore: ${message}${RESET}\n`);
    }
  }

  // ── Step 6: Print summary ──────────────────────────────────────────────
  process.stdout.write("\n");

  if (created.length > 0) {
    process.stdout.write(`${GREEN}Created:${RESET}\n`);
    for (const item of created) {
      process.stdout.write(`  ${GREEN}+${RESET} ${item}\n`);
    }
  }

  if (skipped.length > 0) {
    process.stdout.write(`\n${YELLOW}Skipped:${RESET}\n`);
    for (const item of skipped) {
      process.stdout.write(`  ${DIM}-${RESET} ${item}\n`);
    }
  }

  process.stdout.write(
    `\n${GREEN}${BOLD}DanteCode initialized.${RESET} Type ${BOLD}dantecode${RESET} to start.\n\n`,
  );
}
