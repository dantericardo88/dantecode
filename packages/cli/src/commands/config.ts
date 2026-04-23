// ============================================================================
// @dantecode/cli — Config Command
// Sub-commands for viewing and editing configuration: init, show, set, models
// ============================================================================

import { readStateYaml, writeStateYaml, stateYamlExists } from "@dantecode/core";
import {
  validateDantecodeConfig,
  applyConfigDefaults,
  DEFAULT_DANTECODE_CONFIG,
  type DantecodeConfig,
} from "@dantecode/core";
import type { DanteCodeState } from "@dantecode/config-types";
import YAML from "yaml";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runInitCommand } from "./init.js";

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ----------------------------------------------------------------------------
// Config Command Router
// ----------------------------------------------------------------------------

/**
 * Runs the `dantecode config` command with the given sub-command and arguments.
 *
 * @param args - Arguments after "config" (e.g., ["show"], ["set", "model.default.modelId", "grok-3"]).
 * @param projectRoot - Absolute path to the project root.
 */
export async function runConfigCommand(args: string[], projectRoot: string): Promise<void> {
  const subCommand = args[0] || "show";

  switch (subCommand) {
    case "init":
      await runInitCommand(projectRoot);
      break;
    case "show":
      await configShow(projectRoot);
      break;
    case "set":
      await configSet(args.slice(1), projectRoot);
      break;
    case "models":
      await configModels(projectRoot);
      break;
    default:
      process.stdout.write(`${RED}Unknown config sub-command: ${subCommand}${RESET}\n`);
      process.stdout.write(`\n${BOLD}Usage:${RESET}\n`);
      process.stdout.write(`  dantecode config init              Initialize project config\n`);
      process.stdout.write(`  dantecode config show              Show resolved config\n`);
      process.stdout.write(`  dantecode config set <key> <value> Set a config value\n`);
      process.stdout.write(`  dantecode config models            List configured models\n`);
      break;
  }
}

// ----------------------------------------------------------------------------
// Sub-Commands
// ----------------------------------------------------------------------------

/**
 * Shows the resolved configuration by reading and displaying STATE.yaml.
 */
async function configShow(projectRoot: string): Promise<void> {
  const exists = await stateYamlExists(projectRoot);
  if (!exists) {
    process.stdout.write(
      `${YELLOW}No STATE.yaml found.${RESET}\n` +
        `${DIM}Run 'dantecode init' to create one.${RESET}\n`,
    );
    return;
  }

  try {
    const state = await readStateYaml(projectRoot);

    const yamlStr = YAML.stringify(state, {
      indent: 2,
      lineWidth: 120,
    });

    process.stdout.write(`\n${BOLD}DanteCode Configuration${RESET}\n`);
    process.stdout.write(`${DIM}Source: ${projectRoot}/.dantecode/STATE.yaml${RESET}\n\n`);
    process.stdout.write(yamlStr);
    process.stdout.write("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${RED}Error reading config: ${message}${RESET}\n`);
  }
}

/**
 * Sets a specific configuration value in STATE.yaml using dot-notation keys.
 *
 * Examples:
 *   dantecode config set model.default.modelId grok-3
 *   dantecode config set git.autoCommit true
 *   dantecode config set pdse.threshold 90
 */
async function configSet(args: string[], projectRoot: string): Promise<void> {
  if (args.length < 2) {
    process.stdout.write(`${RED}Usage: dantecode config set <key> <value>${RESET}\n`);
    process.stdout.write(`\n${DIM}Examples:${RESET}\n`);
    process.stdout.write(`  ${DIM}dantecode config set model.default.modelId grok-3${RESET}\n`);
    process.stdout.write(`  ${DIM}dantecode config set git.autoCommit true${RESET}\n`);
    process.stdout.write(`  ${DIM}dantecode config set pdse.threshold 90${RESET}\n`);
    process.stdout.write(`  ${DIM}dantecode config set project.name "my-project"${RESET}\n`);
    return;
  }

  const key = args[0]!;
  const rawValue = args.slice(1).join(" ");

  // Parse the value to the appropriate type
  const value = parseConfigValue(rawValue);

  const exists = await stateYamlExists(projectRoot);
  if (!exists) {
    process.stdout.write(
      `${YELLOW}No STATE.yaml found.${RESET}\n` + `${DIM}Run 'dantecode init' first.${RESET}\n`,
    );
    return;
  }

  try {
    const state = await readStateYaml(projectRoot);

    // Set the value using dot-notation path
    const updated = setNestedValue(state, key, value);

    if (updated === null) {
      process.stdout.write(`${RED}Invalid key path: ${key}${RESET}\n`);
      return;
    }

    await writeStateYaml(projectRoot, updated);

    process.stdout.write(
      `${GREEN}Set${RESET} ${BOLD}${key}${RESET} = ${CYAN}${JSON.stringify(value)}${RESET}\n`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${RED}Error setting config: ${message}${RESET}\n`);
  }
}

/**
 * Parses a raw string value into its appropriate JavaScript type.
 */
function parseConfigValue(raw: string): unknown {
  // Boolean
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Number
  const num = Number(raw);
  if (!isNaN(num) && raw.trim().length > 0) return num;

  // Null
  if (raw === "null") return null;

  // Strip quotes from strings
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  // Array (comma-separated)
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      // Fall through to string
    }
  }

  return raw;
}

/**
 * Sets a nested value in an object using a dot-notation path.
 * Returns the updated object, or null if the path is invalid.
 */
function setNestedValue(obj: DanteCodeState, path: string, value: unknown): DanteCodeState | null {
  const keys = path.split(".");
  if (keys.length === 0) return null;

  // Deep clone to avoid mutations
  const result = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  let current: Record<string, unknown> = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (typeof current[key] !== "object" || current[key] === null) {
      return null; // Invalid path
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1]!;

  // Verify the key exists at this level (to prevent typos creating new keys)
  if (!(lastKey in current)) {
    // Allow setting if parent exists (for extensibility)
    process.stdout.write(
      `${YELLOW}Warning: key '${lastKey}' does not exist at '${keys.slice(0, -1).join(".")}'. Creating it.${RESET}\n`,
    );
  }

  current[lastKey] = value;

  return result as unknown as DanteCodeState;
}

/**
 * Lists configured model providers with their details.
 */
async function configModels(projectRoot: string): Promise<void> {
  const exists = await stateYamlExists(projectRoot);
  if (!exists) {
    process.stdout.write(
      `${YELLOW}No STATE.yaml found.${RESET}\n` + `${DIM}Run 'dantecode init' first.${RESET}\n`,
    );
    return;
  }

  try {
    const state = await readStateYaml(projectRoot);

    process.stdout.write(`\n${BOLD}Configured Models${RESET}\n\n`);

    // Default model
    const defaultModel = state.model.default;
    process.stdout.write(`  ${GREEN}Default:${RESET}\n`);
    process.stdout.write(`    Provider:       ${BOLD}${defaultModel.provider}${RESET}\n`);
    process.stdout.write(`    Model:          ${BOLD}${defaultModel.modelId}${RESET}\n`);
    process.stdout.write(`    Max tokens:     ${defaultModel.maxTokens}\n`);
    process.stdout.write(`    Temperature:    ${defaultModel.temperature}\n`);
    process.stdout.write(`    Context window: ${defaultModel.contextWindow.toLocaleString()}\n`);
    process.stdout.write(`    Vision:         ${defaultModel.supportsVision ? "Yes" : "No"}\n`);
    process.stdout.write(`    Tool calls:     ${defaultModel.supportsToolCalls ? "Yes" : "No"}\n`);
    process.stdout.write(`    API key:        ${detectApiKeyStatus(defaultModel.provider)}\n`);

    // Fallback models
    if (state.model.fallback.length > 0) {
      process.stdout.write(`\n  ${YELLOW}Fallbacks:${RESET}\n`);
      for (const fallback of state.model.fallback) {
        process.stdout.write(
          `    ${DIM}-${RESET} ${fallback.provider}/${fallback.modelId}` +
            ` ${DIM}(${fallback.contextWindow.toLocaleString()} ctx)${RESET}\n`,
        );
      }
    }

    // Task overrides
    const overrideKeys = Object.keys(state.model.taskOverrides);
    if (overrideKeys.length > 0) {
      process.stdout.write(`\n  ${CYAN}Task Overrides:${RESET}\n`);
      for (const taskType of overrideKeys) {
        const override = state.model.taskOverrides[taskType];
        if (override) {
          process.stdout.write(
            `    ${DIM}-${RESET} ${taskType}: ${override.provider}/${override.modelId}\n`,
          );
        }
      }
    }

    process.stdout.write("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${RED}Error reading config: ${message}${RESET}\n`);
  }
}

// ── DantecodeConfig JSON file helpers (Dim 40) ───────────────────────────────

const DANTECODE_CONFIG_FILE = "config.json";
const DANTECODE_CONFIG_DIR = ".dantecode";

function dantecodeConfigPath(projectRoot: string): string {
  return join(resolve(projectRoot), DANTECODE_CONFIG_DIR, DANTECODE_CONFIG_FILE);
}

export async function readProjectConfig(projectRoot: string): Promise<DantecodeConfig> {
  try {
    const raw = JSON.parse(await readFile(dantecodeConfigPath(projectRoot), "utf-8")) as unknown;
    return applyConfigDefaults(raw as Partial<DantecodeConfig>);
  } catch {
    return applyConfigDefaults({});
  }
}

export async function writeProjectConfig(config: DantecodeConfig, projectRoot: string): Promise<void> {
  const dir = join(resolve(projectRoot), DANTECODE_CONFIG_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(dantecodeConfigPath(projectRoot), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function getConfigValue(config: DantecodeConfig, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let cur: unknown = config;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setConfigValue(config: DantecodeConfig, dotPath: string, value: string): DantecodeConfig {
  const clone = JSON.parse(JSON.stringify(config)) as DantecodeConfig;
  const parts = dotPath.split(".");
  let cur: Record<string, unknown> = clone as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1]!;
  if (value === "true") cur[lastKey] = true;
  else if (value === "false") cur[lastKey] = false;
  else if (/^\d+$/.test(value)) cur[lastKey] = parseInt(value, 10);
  else cur[lastKey] = value;
  return clone;
}

function maskDantecodeConfig(config: DantecodeConfig): DantecodeConfig {
  const clone = JSON.parse(JSON.stringify(config)) as DantecodeConfig;
  const key = clone.provider.apiKey;
  if (key && key.length > 8) clone.provider.apiKey = key.slice(0, 8) + "****";
  return clone;
}

export async function cmdConfig(args: string[], projectRoot: string): Promise<void> {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "get": {
      const key = rest[0];
      if (!key) { console.log(`${RED}Usage: dantecode config get <key>${RESET}`); return; }
      const config = await readProjectConfig(projectRoot);
      const val = getConfigValue(config, key);
      if (val === undefined) console.log(`${YELLOW}No value found at: ${key}${RESET}`);
      else console.log(typeof val === "object" ? JSON.stringify(val, null, 2) : String(val));
      break;
    }
    case "set": {
      const [key, val] = rest;
      if (!key || val === undefined) { console.log(`${RED}Usage: dantecode config set <key> <value>${RESET}`); return; }
      const config = await readProjectConfig(projectRoot);
      await writeProjectConfig(setConfigValue(config, key, val), projectRoot);
      console.log(`${GREEN}✓ Set ${key} = ${val}${RESET}`);
      break;
    }
    case "list": {
      const config = await readProjectConfig(projectRoot);
      console.log(`${BOLD}DanteCode Configuration${RESET} ${DIM}(${dantecodeConfigPath(projectRoot)})${RESET}\n`);
      console.log(JSON.stringify(maskDantecodeConfig(config), null, 2));
      break;
    }
    case "validate": {
      const config = await readProjectConfig(projectRoot);
      const result = validateDantecodeConfig(config);
      if (result.valid && result.warnings.length === 0) {
        console.log(`${GREEN}✓ Config is valid${RESET}`);
      } else {
        if (result.errors.length > 0) {
          console.log(`${RED}${result.errors.length} error(s):${RESET}`);
          for (const e of result.errors) {
            console.log(`  ${RED}[${e.field}]${RESET} ${e.message}`);
            console.log(`  ${DIM}→ ${e.fix}${RESET}`);
          }
        }
        if (result.warnings.length > 0) {
          for (const w of result.warnings) console.log(`  ${YELLOW}[${w.field}]${RESET} ${w.message}`);
        }
      }
      break;
    }
    case "reset": {
      await writeProjectConfig(DEFAULT_DANTECODE_CONFIG, projectRoot);
      console.log(`${GREEN}✓ Config reset to defaults${RESET}`);
      break;
    }
    default: {
      console.log(`${BOLD}dantecode config${RESET} — manage DanteCode configuration`);
      console.log(`  config get <key>    Print value at dotted path`);
      console.log(`  config set <key> <val>  Update value`);
      console.log(`  config list         Show full config (API key masked)`);
      console.log(`  config validate     Check for errors`);
      console.log(`  config reset        Restore defaults`);
    }
  }
}

/**
 * Detects the API key status for a given provider.
 */
function detectApiKeyStatus(provider: string): string {
  const envMappings: Record<string, string[]> = {
    grok: ["XAI_API_KEY", "GROK_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    openai: ["OPENAI_API_KEY"],
    google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    groq: ["GROQ_API_KEY"],
    ollama: [],
    custom: [],
  };

  if (provider === "ollama") {
    return `${GREEN}Local (no key needed)${RESET}`;
  }

  const keys = envMappings[provider] ?? [];
  for (const key of keys) {
    if (process.env[key] && process.env[key]!.length > 0) {
      return `${GREEN}${key} detected${RESET}`;
    }
  }

  return `${RED}Not found (set ${keys.join(" or ")})${RESET}`;
}
