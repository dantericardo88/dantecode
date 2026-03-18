// ============================================================================
// @dantecode/core — Version Migration
// Detects the config version in .dantecode/STATE.yaml and applies idempotent
// migrations to bring it up to the latest schema version.
// ============================================================================

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import YAML from "yaml";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const STATE_YAML_RELATIVE_PATH = ".dantecode/STATE.yaml";

/** The latest config version. Increment this when adding new migrations. */
export const LATEST_CONFIG_VERSION = 1;

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Result of a single migration step. */
export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: boolean;
  message: string;
}

/** Aggregate result of running all pending migrations. */
export interface MigrationRunResult {
  results: MigrationResult[];
  finalVersion: number;
  migrated: boolean;
}

/**
 * A migration function receives the raw YAML data (as a plain object)
 * and returns the transformed data. Migrations must be idempotent.
 */
type MigrationFn = (data: Record<string, unknown>) => Record<string, unknown>;

// ----------------------------------------------------------------------------
// Model Name Normalization Map
// ----------------------------------------------------------------------------

/**
 * Known model ID aliases that should be normalized to their canonical form.
 * This allows users who typed legacy/abbreviated names to get the correct IDs.
 */
const MODEL_NAME_NORMALIZATION: Record<string, string> = {
  "grok-3-latest": "grok-3",
  "grok3": "grok-3",
  "claude-3.5-sonnet": "claude-sonnet-4-20250514",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-20250514",
  "claude-3-opus": "claude-opus-4-20250514",
  "gpt-4-turbo": "gpt-4-turbo-2024-04-09",
  "gpt4": "gpt-4-turbo-2024-04-09",
  "gpt-4o": "gpt-4o-2024-08-06",
};

// ----------------------------------------------------------------------------
// Migration: v0 -> v1
// ----------------------------------------------------------------------------

/**
 * Migration from v0 (no configVersion field) to v1.
 *
 * Changes:
 *   1. Adds `configVersion: 1` to the root of the YAML document.
 *   2. Normalizes model names in `model.default.modelId` and
 *      `model.fallback[].modelId` to their canonical forms.
 *
 * This migration is idempotent: if configVersion is already 1, it returns
 * the data unchanged.
 */
export function v0_to_v1(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data, configVersion: 1 };

  // Normalize model names
  const model = result["model"] as Record<string, unknown> | undefined;
  if (model && typeof model === "object") {
    const modelCopy = { ...model };

    // Normalize default model
    const defaultModel = modelCopy["default"] as Record<string, unknown> | undefined;
    if (defaultModel && typeof defaultModel === "object" && typeof defaultModel["modelId"] === "string") {
      const normalized = MODEL_NAME_NORMALIZATION[defaultModel["modelId"]];
      if (normalized) {
        modelCopy["default"] = { ...defaultModel, modelId: normalized };
      }
    }

    // Normalize fallback models
    const fallback = modelCopy["fallback"];
    if (Array.isArray(fallback)) {
      modelCopy["fallback"] = fallback.map((fb: unknown) => {
        if (fb && typeof fb === "object" && "modelId" in (fb as Record<string, unknown>)) {
          const fbRecord = fb as Record<string, unknown>;
          const normalized = MODEL_NAME_NORMALIZATION[fbRecord["modelId"] as string];
          if (normalized) {
            return { ...fbRecord, modelId: normalized };
          }
        }
        return fb;
      });
    }

    // Normalize task overrides
    const overrides = modelCopy["taskOverrides"];
    if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
      const overridesCopy: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(overrides as Record<string, unknown>)) {
        if (val && typeof val === "object" && "modelId" in (val as Record<string, unknown>)) {
          const ovRecord = val as Record<string, unknown>;
          const normalized = MODEL_NAME_NORMALIZATION[ovRecord["modelId"] as string];
          if (normalized) {
            overridesCopy[key] = { ...ovRecord, modelId: normalized };
            continue;
          }
        }
        overridesCopy[key] = val;
      }
      modelCopy["taskOverrides"] = overridesCopy;
    }

    result["model"] = modelCopy;
  }

  return result;
}

// ----------------------------------------------------------------------------
// Migration Registry
// ----------------------------------------------------------------------------

/**
 * Ordered list of migrations. Each entry maps a source version to a target
 * version and the function that performs the transformation.
 */
const MIGRATIONS: Array<{ from: number; to: number; fn: MigrationFn }> = [
  { from: 0, to: 1, fn: v0_to_v1 },
];

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Detects the current config version from a raw YAML object.
 * Returns 0 if no `configVersion` field is present.
 */
export function detectConfigVersion(data: Record<string, unknown>): number {
  const version = data["configVersion"];
  if (typeof version === "number" && Number.isFinite(version)) {
    return version;
  }
  return 0;
}

/**
 * Runs all pending migrations on the STATE.yaml file in the given project root.
 *
 * 1. Reads `.dantecode/STATE.yaml` and detects the current configVersion.
 * 2. Applies each migration in order from the current version to LATEST_CONFIG_VERSION.
 * 3. Writes the updated YAML back atomically (write to .tmp, then rename).
 *
 * Migrations are idempotent and safe to re-run. If the file is already at the
 * latest version, no changes are made.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @returns The aggregate MigrationRunResult.
 */
export async function runMigrations(projectRoot: string): Promise<MigrationRunResult> {
  const filePath = join(projectRoot, STATE_YAML_RELATIVE_PATH);
  const results: MigrationResult[] = [];

  // Read the current STATE.yaml
  let rawContent: string;
  try {
    rawContent = await readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist — nothing to migrate
    return {
      results: [],
      finalVersion: 0,
      migrated: false,
    };
  }

  let data: Record<string, unknown>;
  try {
    data = YAML.parse(rawContent) as Record<string, unknown>;
  } catch {
    // Corrupt YAML — cannot migrate
    return {
      results: [{
        fromVersion: 0,
        toVersion: LATEST_CONFIG_VERSION,
        applied: false,
        message: "STATE.yaml contains invalid YAML — cannot migrate",
      }],
      finalVersion: 0,
      migrated: false,
    };
  }

  if (!data || typeof data !== "object") {
    return {
      results: [{
        fromVersion: 0,
        toVersion: LATEST_CONFIG_VERSION,
        applied: false,
        message: "STATE.yaml root is not an object — cannot migrate",
      }],
      finalVersion: 0,
      migrated: false,
    };
  }

  let currentVersion = detectConfigVersion(data);

  if (currentVersion >= LATEST_CONFIG_VERSION) {
    return {
      results: [],
      finalVersion: currentVersion,
      migrated: false,
    };
  }

  // Apply migrations in order
  let migrated = false;
  for (const migration of MIGRATIONS) {
    if (currentVersion === migration.from) {
      try {
        data = migration.fn(data);
        results.push({
          fromVersion: migration.from,
          toVersion: migration.to,
          applied: true,
          message: `Migrated from v${migration.from} to v${migration.to}`,
        });
        currentVersion = migration.to;
        migrated = true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          fromVersion: migration.from,
          toVersion: migration.to,
          applied: false,
          message: `Migration v${migration.from}->v${migration.to} failed: ${msg}`,
        });
        break;
      }
    }
  }

  // Write back if any migrations were applied
  if (migrated) {
    const tmpPath = filePath + ".tmp";
    await mkdir(dirname(filePath), { recursive: true });
    const yamlContent = YAML.stringify(data, { indent: 2, lineWidth: 120 });
    await writeFile(tmpPath, yamlContent, "utf-8");
    await rename(tmpPath, filePath);
  }

  return {
    results,
    finalVersion: currentVersion,
    migrated,
  };
}
