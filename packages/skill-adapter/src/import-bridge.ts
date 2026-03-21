// ============================================================================
// @dantecode/skill-adapter — Import Bridge
// Imports a compiled SkillBridge bundle (produced by DanteForge) into the
// local DanteCode project under .dantecode/skills/<slug>/.
//
// The bundle is produced by `danteforge skills convert` and contains:
//   skillbridge.json          — canonical manifest
//   targets/dantecode/        — SKILL.dc.md + support files
//   reports/                  — verification + conversion-score JSON
//
// This module copies the DanteCode target into the local skill registry and
// writes a warnings.json alongside it so the runtime can surface capability
// warnings at activation time.
// ============================================================================

import { mkdir, copyFile, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { appendAuditEvent, readOrInitializeState, updateStateYaml } from "@dantecode/core";
import { parseSkillBridgeManifest, bundleHasDanteCodeTarget, getDanteCodeTargetPath } from "./parsers/skillbridge.js";
import type { BridgeBundleMetadata, BundleBucket, SkillBridgeManifest } from "./types/skillbridge.js";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const SKILLS_BASE = ".dantecode/skills";
const DANTECODE_TARGET_DIR = "targets/dantecode";
const WARNINGS_FILENAME = "warnings.json";
const BRIDGE_META_FILENAME = "bridge-meta.json";

// ----------------------------------------------------------------------------
// Internal Helpers
// ----------------------------------------------------------------------------

/**
 * Derives the outcome bucket (green/amber/red) from a manifest's emitter
 * and verification state.
 */
function deriveBucket(manifest: SkillBridgeManifest): BundleBucket {
  const score = manifest.verification.conversionScore;
  const dcStatus = manifest.emitters.dantecode.status;

  if (dcStatus === "blocked" || !manifest.verification.parsePassed) {
    return "red";
  }
  if (dcStatus === "warning" || score < 0.7 || manifest.warnings.length > 0) {
    return "amber";
  }
  return "green";
}

/**
 * Generates runtime capability warnings based on the skill's capability profile.
 * These are surfaced to the user when they activate the skill via `/skill <name>`.
 */
function buildRuntimeWarnings(manifest: SkillBridgeManifest): string[] {
  const caps = manifest.normalizedSkill.capabilities;
  const warnings: string[] = [];

  if (caps.shell) {
    warnings.push("This skill requires shell/bash execution. Ensure Bash tool is available.");
  }
  if (caps.browser) {
    warnings.push("This skill requires browser automation. Ensure browser tools are configured.");
  }
  if (caps.mcp) {
    warnings.push("This skill requires MCP tools. Ensure relevant MCP servers are configured.");
  }
  if (caps.llmRepairNeeded) {
    warnings.push(
      "This skill required LLM repair during conversion. Review instructions for accuracy.",
    );
  }

  // Add emitter-level warnings
  const dcWarnings = manifest.emitters.dantecode.warnings ?? [];
  warnings.push(...dcWarnings);

  return warnings;
}

/**
 * Copies all files from a source directory to a destination directory.
 * Non-recursive (single level only — support files are flat by convention).
 */
async function copyDirContents(srcDir: string, destDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(srcDir);
  } catch {
    return; // source dir might not exist (no support files)
  }

  for (const entry of entries) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    try {
      const s = await stat(srcPath);
      if (s.isFile()) {
        await copyFile(srcPath, destPath);
      }
    } catch {
      // Skip files that can't be copied
    }
  }
}

// ----------------------------------------------------------------------------
// Options + Result
// ----------------------------------------------------------------------------

/** Options for importing a SkillBridge bundle. */
export interface ImportBridgeOptions {
  /** Absolute path to the compiled bundle directory (contains skillbridge.json). */
  bundleDir: string;
  /** Absolute path to the project root where .dantecode/ lives. */
  projectRoot: string;
  /** Session ID for audit logging. Defaults to "import-bridge". */
  sessionId?: string;
  /** Model ID for audit logging. Defaults to "skill-adapter". */
  modelId?: string;
  /**
   * If true, import even when the bucket is "red" (blocked).
   * Defaults to false — red bundles are rejected by default.
   */
  allowBlocked?: boolean;
}

/** Result of a bridge bundle import operation. */
export interface ImportBridgeResult {
  /** True if the bundle was successfully imported. */
  success: boolean;
  /** The skill slug (directory name under .dantecode/skills/). */
  slug: string;
  /** Absolute path to the imported skill directory. */
  skillDir: string;
  /** The outcome bucket (green/amber/red). */
  bucket: BundleBucket;
  /** Runtime capability warnings to surface at activation. */
  runtimeWarnings: string[];
  /** Conversion warnings from the DanteForge compiler. */
  conversionWarnings: string[];
  /** Conversion score (0–1). */
  conversionScore: number;
  /** Error message if success is false. */
  error?: string;
}

// ----------------------------------------------------------------------------
// Main Function
// ----------------------------------------------------------------------------

/**
 * Imports a compiled SkillBridge bundle into the DanteCode project.
 *
 * Steps:
 * 1. Parse and validate skillbridge.json
 * 2. Verify the DanteCode target (targets/dantecode/SKILL.dc.md) exists
 * 3. Derive bucket (green/amber/red) — reject red by default
 * 4. Create .dantecode/skills/<slug>/ directory
 * 5. Copy SKILL.dc.md and support files
 * 6. Write warnings.json and bridge-meta.json alongside
 * 7. Log audit event
 *
 * @param options - Import configuration.
 * @returns ImportBridgeResult with success status and metadata.
 */
export async function importSkillBridgeBundle(
  options: ImportBridgeOptions,
): Promise<ImportBridgeResult> {
  const {
    bundleDir,
    projectRoot,
    sessionId = "import-bridge",
    modelId = "skill-adapter",
    allowBlocked = false,
  } = options;

  // Step 1: Parse manifest
  const parseResult = await parseSkillBridgeManifest(bundleDir);
  if (!parseResult.ok) {
    return {
      success: false,
      slug: "",
      skillDir: "",
      bucket: "red",
      runtimeWarnings: [],
      conversionWarnings: [],
      conversionScore: 0,
      error: `Invalid bundle: ${parseResult.errors.join("; ")}`,
    };
  }

  const { manifest } = parseResult;
  const slug = manifest.normalizedSkill.slug;
  const skillDir = join(projectRoot, SKILLS_BASE, slug);

  // Step 2: Verify DanteCode target exists
  const hasDcTarget = await bundleHasDanteCodeTarget(bundleDir);
  if (!hasDcTarget) {
    return {
      success: false,
      slug,
      skillDir,
      bucket: "red",
      runtimeWarnings: [],
      conversionWarnings: manifest.warnings,
      conversionScore: manifest.verification.conversionScore,
      error: `Bundle is missing DanteCode target: targets/dantecode/SKILL.dc.md not found in ${bundleDir}`,
    };
  }

  // Step 3: Derive bucket — reject red unless explicitly allowed
  const bucket = deriveBucket(manifest);
  if (bucket === "red" && !allowBlocked) {
    return {
      success: false,
      slug,
      skillDir,
      bucket,
      runtimeWarnings: [],
      conversionWarnings: manifest.warnings,
      conversionScore: manifest.verification.conversionScore,
      error: `Bundle classified as red (blocked). Use allowBlocked to override. Score: ${manifest.verification.conversionScore.toFixed(2)}`,
    };
  }

  // Step 4: Build capability warnings
  const runtimeWarnings = buildRuntimeWarnings(manifest);
  const conversionWarnings = manifest.warnings;

  // Step 5: Create skill directory
  await mkdir(skillDir, { recursive: true });

  // Step 6: Copy SKILL.dc.md
  const srcSkillFile = getDanteCodeTargetPath(bundleDir);
  const destSkillFile = join(skillDir, "SKILL.dc.md");
  await copyFile(srcSkillFile, destSkillFile);

  // Copy support files if present
  const srcSupportDir = join(bundleDir, DANTECODE_TARGET_DIR, "support-files");
  const destSupportDir = join(skillDir, "support-files");
  await mkdir(destSupportDir, { recursive: true });
  await copyDirContents(srcSupportDir, destSupportDir);

  // Copy skillbridge.json manifest
  await copyFile(join(bundleDir, "skillbridge.json"), join(skillDir, "skillbridge.json"));

  // Step 7: Write warnings.json
  const warningsPayload = {
    runtimeWarnings,
    conversionWarnings,
    bucket,
    conversionScore: manifest.verification.conversionScore,
    classification: manifest.normalizedSkill.classification,
  };
  await writeFile(
    join(skillDir, WARNINGS_FILENAME),
    JSON.stringify(warningsPayload, null, 2),
    "utf-8",
  );

  // Write bridge-meta.json for registry lookups
  const meta: BridgeBundleMetadata = {
    slug,
    name: manifest.normalizedSkill.name,
    description: manifest.normalizedSkill.description,
    bundleDir,
    conversionScore: manifest.verification.conversionScore,
    bucket,
    runtimeWarnings,
    conversionWarnings,
    importedAt: new Date().toISOString(),
    classification: manifest.normalizedSkill.classification,
    emitterStatuses: {
      dantecode: manifest.emitters.dantecode.status,
      "qwen-skill": manifest.emitters.qwenSkill.status,
      mcp: manifest.emitters.mcp.status,
      "cli-wrapper": manifest.emitters.cliWrapper.status,
    },
  };
  await writeFile(
    join(skillDir, BRIDGE_META_FILENAME),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );

  // Update STATE.yaml to record the skills directory (mirrors importSkills behavior)
  try {
    const state = await readOrInitializeState(projectRoot);
    const skillsDirEntry = ".dantecode/skills";
    const updatedDirs = state.skills.directories.includes(skillsDirEntry)
      ? state.skills.directories
      : [...state.skills.directories, skillsDirEntry];
    await updateStateYaml(projectRoot, {
      skills: { ...state.skills, directories: updatedDirs },
    });
  } catch {
    // STATE.yaml update failure is non-fatal
  }

  // Step 8: Audit log
  try {
    await appendAuditEvent(projectRoot, {
      sessionId,
      timestamp: new Date().toISOString(),
      type: "skill_import",
      payload: {
        action: "bridge_imported",
        slug,
        bundleDir,
        bucket,
        conversionScore: manifest.verification.conversionScore,
        runtimeWarnings: runtimeWarnings.length,
        conversionWarnings: conversionWarnings.length,
        classification: manifest.normalizedSkill.classification,
      },
      modelId,
      projectRoot,
    });
  } catch {
    // Audit failure is non-fatal
  }

  return {
    success: true,
    slug,
    skillDir,
    bucket,
    runtimeWarnings,
    conversionWarnings,
    conversionScore: manifest.verification.conversionScore,
  };
}

// ----------------------------------------------------------------------------
// Bundle Inspection
// ----------------------------------------------------------------------------

/**
 * Lists bridge warnings for an already-imported skill.
 * Reads warnings.json from .dantecode/skills/<slug>/.
 *
 * @param skillName - The skill name or slug.
 * @param projectRoot - Absolute path to the project root.
 * @returns The warnings payload, or null if not a bridge skill or not found.
 */
export async function listBridgeWarnings(
  skillName: string,
  projectRoot: string,
): Promise<{ runtimeWarnings: string[]; conversionWarnings: string[]; bucket: BundleBucket; conversionScore: number } | null> {
  const slug = skillName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const warningsPath = join(projectRoot, SKILLS_BASE, slug, WARNINGS_FILENAME);

  let raw: string;
  try {
    raw = await readFile(warningsPath, "utf-8");
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      runtimeWarnings?: string[];
      conversionWarnings?: string[];
      bucket?: BundleBucket;
      conversionScore?: number;
    };
    return {
      runtimeWarnings: Array.isArray(parsed.runtimeWarnings) ? parsed.runtimeWarnings : [],
      conversionWarnings: Array.isArray(parsed.conversionWarnings) ? parsed.conversionWarnings : [],
      bucket: (parsed.bucket as BundleBucket) ?? "amber",
      conversionScore: typeof parsed.conversionScore === "number" ? parsed.conversionScore : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Validates that an imported bridge skill's SKILL.dc.md and skillbridge.json
 * are present and the manifest re-parses cleanly.
 *
 * @param skillName - The skill name or slug.
 * @param projectRoot - Absolute path to the project root.
 * @returns True if the skill is valid, false otherwise.
 */
export async function validateBridgeSkill(
  skillName: string,
  projectRoot: string,
): Promise<boolean> {
  const slug = skillName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const skillDir = join(projectRoot, SKILLS_BASE, slug);

  // Check SKILL.dc.md exists
  try {
    const s = await stat(join(skillDir, "SKILL.dc.md"));
    if (!s.isFile()) return false;
  } catch {
    return false;
  }

  // Re-parse manifest
  const result = await parseSkillBridgeManifest(skillDir);
  return result.ok;
}
