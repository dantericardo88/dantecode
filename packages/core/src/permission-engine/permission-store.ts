/**
 * permission-engine/permission-store.ts — Permission Config Store
 *
 * Loads permission rules from `.dantecode/config.json` and provides
 * default configuration when no file exists.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseRules } from "./rule-parser.js";
import type { PermissionConfig, PermissionDecision, PermissionRule } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const CONFIG_DIR = ".dantecode";
const CONFIG_FILE = "permissions.json";

/**
 * Default permission config when no file exists.
 * Conservative: ask for everything by default.
 */
export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  rules: [],
  defaultDecision: "ask",
};

// ─── Serialized Format ───────────────────────────────────────────────────────

/**
 * The on-disk format for permission configuration.
 * Rules are stored as human-readable strings for easy editing.
 */
export interface PermissionConfigFile {
  /** Rule strings in "<decision> <tool> [specifier]" format */
  rules?: string[];
  /** Default decision when no rules match */
  defaultDecision?: PermissionDecision;
}

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load permission config from `.dantecode/permissions.json` relative to projectRoot.
 * Returns DEFAULT_PERMISSION_CONFIG if the file does not exist.
 *
 * @param projectRoot - The project root directory
 * @throws Error if the file exists but contains invalid JSON
 */
export function loadPermissionConfig(projectRoot: string): PermissionConfig {
  const configPath = join(projectRoot, CONFIG_DIR, CONFIG_FILE);

  if (!existsSync(configPath)) {
    return { ...DEFAULT_PERMISSION_CONFIG, rules: [] };
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed: PermissionConfigFile = JSON.parse(raw) as PermissionConfigFile;

  return normalizeConfigFile(parsed);
}

/**
 * Normalize a raw config file into a PermissionConfig.
 * Validates rules and applies defaults for missing fields.
 */
export function normalizeConfigFile(file: PermissionConfigFile): PermissionConfig {
  const ruleStrings = file.rules ?? [];
  const rules: PermissionRule[] = parseRules(ruleStrings);

  const defaultDecision: PermissionDecision = file.defaultDecision ?? "ask";

  return {
    rules,
    defaultDecision,
  };
}

/**
 * Save permission config to `.dantecode/permissions.json`.
 * Creates the directory if it does not exist.
 *
 * @param projectRoot - The project root directory
 * @param config - The permission config to save
 */
export function savePermissionConfig(projectRoot: string, config: PermissionConfig): void {
  const configDir = join(projectRoot, CONFIG_DIR);
  const configPath = join(configDir, CONFIG_FILE);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const serialized: PermissionConfigFile = {
    rules: config.rules.map((rule) => rule.raw),
    defaultDecision: config.defaultDecision,
  };

  writeFileSync(configPath, JSON.stringify(serialized, null, 2) + "\n", "utf-8");
}

/**
 * Merge additional rules into an existing config.
 * New rules are appended to the end of the rules list.
 */
export function mergePermissionRules(
  existing: PermissionConfig,
  additionalRules: PermissionRule[],
): PermissionConfig {
  return {
    ...existing,
    rules: [...existing.rules, ...additionalRules],
  };
}
