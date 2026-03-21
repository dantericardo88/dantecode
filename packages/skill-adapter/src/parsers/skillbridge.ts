// ============================================================================
// @dantecode/skill-adapter — SkillBridge Bundle Parser
// Parses and validates a skillbridge.json manifest from a compiled bundle
// directory produced by DanteForge. Returns a typed result with errors if
// the bundle is malformed or missing required fields.
// ============================================================================

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  SkillBridgeManifest,
  SkillBridgeParseResult,
  EmitterResult,
  SkillBridgeEmitters,
} from "../types/skillbridge.js";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const MANIFEST_FILENAME = "skillbridge.json";
const DANTECODE_TARGET_DIR = "targets/dantecode";
const SKILL_DC_MD = "SKILL.dc.md";

// ----------------------------------------------------------------------------
// Internal Validators
// ----------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function parseEmitterResult(raw: unknown, key: string): EmitterResult {
  if (!isRecord(raw)) {
    return { status: "skipped", warnings: [`${key}: missing or invalid`] };
  }
  const status = raw["status"];
  const validStatuses = ["success", "warning", "skipped", "blocked"];
  return {
    status: validStatuses.includes(status as string)
      ? (status as EmitterResult["status"])
      : "skipped",
    warnings: Array.isArray(raw["warnings"])
      ? (raw["warnings"] as unknown[]).filter(isString)
      : undefined,
    error: isString(raw["error"]) ? raw["error"] : undefined,
  };
}

function validateManifest(raw: unknown, errors: string[]): SkillBridgeManifest | null {
  if (!isRecord(raw)) {
    errors.push("skillbridge.json: root must be a JSON object");
    return null;
  }

  if (!isString(raw["version"])) {
    errors.push("skillbridge.json: missing required field 'version'");
  }

  // --- source ---
  const src = raw["source"];
  if (!isRecord(src)) {
    errors.push("skillbridge.json: missing required object 'source'");
  }

  // --- normalizedSkill ---
  const ns = raw["normalizedSkill"];
  if (!isRecord(ns)) {
    errors.push("skillbridge.json: missing required object 'normalizedSkill'");
    if (errors.length > 0) return null;
  }

  const normalizedSkill = ns as Record<string, unknown>;
  if (!isString(normalizedSkill["name"])) {
    errors.push("skillbridge.json: normalizedSkill.name must be a string");
  }
  if (!isString(normalizedSkill["slug"])) {
    errors.push("skillbridge.json: normalizedSkill.slug must be a string");
  }

  // --- emitters ---
  const emittersRaw = raw["emitters"];
  if (!isRecord(emittersRaw)) {
    errors.push("skillbridge.json: missing required object 'emitters'");
  }

  // --- verification ---
  const verif = raw["verification"];
  if (!isRecord(verif)) {
    errors.push("skillbridge.json: missing required object 'verification'");
  }

  if (errors.length > 0) return null;

  const emitters = emittersRaw as Record<string, unknown>;
  const verification = verif as Record<string, unknown>;
  const source = src as Record<string, unknown>;

  const parsedEmitters: SkillBridgeEmitters = {
    dantecode: parseEmitterResult(emitters["dantecode"], "dantecode"),
    qwenSkill: parseEmitterResult(emitters["qwenSkill"], "qwenSkill"),
    mcp: parseEmitterResult(emitters["mcp"], "mcp"),
    cliWrapper: parseEmitterResult(emitters["cliWrapper"], "cliWrapper"),
  };

  const caps = isRecord(normalizedSkill["capabilities"])
    ? (normalizedSkill["capabilities"] as Record<string, unknown>)
    : {};

  return {
    version: isString(raw["version"]) ? raw["version"] : "1",
    source: {
      kind: (isString(source["kind"]) ? source["kind"] : "local-file") as SkillBridgeManifest["source"]["kind"],
      url: isString(source["url"]) ? source["url"] : "",
      repo: isString(source["repo"]) ? source["repo"] : "",
      commit: isString(source["commit"]) ? source["commit"] : "",
      path: isString(source["path"]) ? source["path"] : "",
      license: isString(source["license"]) ? source["license"] : "",
    },
    normalizedSkill: {
      name: isString(normalizedSkill["name"]) ? normalizedSkill["name"] : "",
      slug: isString(normalizedSkill["slug"]) ? normalizedSkill["slug"] : "",
      description: isString(normalizedSkill["description"]) ? normalizedSkill["description"] : "",
      instructions: isString(normalizedSkill["instructions"]) ? normalizedSkill["instructions"] : "",
      supportFiles: Array.isArray(normalizedSkill["supportFiles"])
        ? (normalizedSkill["supportFiles"] as unknown[]).filter(isString)
        : [],
      frontmatter: isRecord(normalizedSkill["frontmatter"])
        ? normalizedSkill["frontmatter"]
        : {},
      capabilities: {
        filesystem: Boolean(caps["filesystem"]),
        network: Boolean(caps["network"]),
        shell: Boolean(caps["shell"]),
        mcp: Boolean(caps["mcp"]),
        browser: Boolean(caps["browser"]),
        llmRepairNeeded: Boolean(caps["llmRepairNeeded"]),
      },
      classification: (isString(normalizedSkill["classification"])
        ? normalizedSkill["classification"]
        : "instruction-only") as SkillBridgeManifest["normalizedSkill"]["classification"],
    },
    emitters: parsedEmitters,
    verification: {
      parsePassed: Boolean(verification["parsePassed"]),
      constitutionPassed: Boolean(verification["constitutionPassed"]),
      antiStubPassed: Boolean(verification["antiStubPassed"]),
      conversionScore:
        typeof verification["conversionScore"] === "number"
          ? Math.min(1, Math.max(0, verification["conversionScore"]))
          : 0,
    },
    warnings: Array.isArray(raw["warnings"])
      ? (raw["warnings"] as unknown[]).filter(isString)
      : [],
  };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Parses a skillbridge.json manifest from the given bundle directory.
 *
 * Returns a discriminated union: `{ ok: true, manifest }` on success,
 * `{ ok: false, errors }` if the file is missing, unreadable, or invalid.
 *
 * @param bundleDir - Absolute path to the bundle directory containing skillbridge.json.
 */
export async function parseSkillBridgeManifest(bundleDir: string): Promise<SkillBridgeParseResult> {
  const manifestPath = join(bundleDir, MANIFEST_FILENAME);
  const errors: string[] = [];

  // Verify the bundle directory itself exists
  try {
    const s = await stat(bundleDir);
    if (!s.isDirectory()) {
      return { ok: false, errors: [`Bundle path is not a directory: ${bundleDir}`] };
    }
  } catch {
    return { ok: false, errors: [`Bundle directory not found: ${bundleDir}`] };
  }

  // Read the manifest file
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch {
    return { ok: false, errors: [`skillbridge.json not found in: ${bundleDir}`] };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`skillbridge.json contains invalid JSON: ${String(e)}`] };
  }

  // Validate shape
  const manifest = validateManifest(parsed, errors);
  if (manifest === null) {
    return { ok: false, errors };
  }

  return { ok: true, manifest };
}

/**
 * Checks whether a bundle directory contains the DanteCode target output.
 * Returns true only if `targets/dantecode/SKILL.dc.md` exists.
 *
 * @param bundleDir - Absolute path to the bundle directory.
 */
export async function bundleHasDanteCodeTarget(bundleDir: string): Promise<boolean> {
  const targetPath = join(bundleDir, DANTECODE_TARGET_DIR, SKILL_DC_MD);
  try {
    const s = await stat(targetPath);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Returns the path to the DanteCode SKILL.dc.md inside the bundle.
 *
 * @param bundleDir - Absolute path to the bundle directory.
 */
export function getDanteCodeTargetPath(bundleDir: string): string {
  return join(bundleDir, DANTECODE_TARGET_DIR, SKILL_DC_MD);
}
