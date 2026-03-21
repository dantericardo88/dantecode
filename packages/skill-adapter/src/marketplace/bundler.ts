// ============================================================================
// @dantecode/skill-adapter — Skill Bundler
// Exports installed skills as distributable directory packages.
// Copies SKILL.md, SKILL.dc.md, and scripts/ to output path.
// ============================================================================

import { mkdir, copyFile, readdir, stat, writeFile, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { CatalogEntry } from "./catalog.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface BundleOptions {
  skillName: string;
  outputPath: string; // destination directory
  includeVerification?: boolean; // include .verification.json, default: true
  includeScripts?: boolean; // include scripts/, default: true
}

export interface BundleResult {
  skillName: string;
  outputPath: string;
  filesWritten: string[];
  success: boolean;
  error?: string;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function sanitizeName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "") || "unnamed-skill"
  );
}

/**
 * Copies all files from srcDir to destDir recursively.
 * Returns the list of destination paths written.
 */
async function copyDirRecursive(srcDir: string, destDir: string): Promise<string[]> {
  const written: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(srcDir);
  } catch {
    return written;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;

    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);

    let entryStat;
    try {
      entryStat = await stat(srcPath);
    } catch {
      continue;
    }

    if (entryStat.isDirectory()) {
      try {
        await mkdir(destPath, { recursive: true });
        const nested = await copyDirRecursive(srcPath, destPath);
        written.push(...nested);
      } catch {
        // Skip unreadable subdirectories
      }
    } else if (entryStat.isFile()) {
      try {
        await copyFile(srcPath, destPath);
        written.push(destPath);
      } catch {
        // Skip files that fail to copy
      }
    }
  }

  return written;
}

/**
 * Copies a single file if it exists. Returns destination path or null.
 */
async function copyIfExists(src: string, dest: string): Promise<string | null> {
  try {
    await stat(src);
  } catch {
    return null;
  }
  try {
    await copyFile(src, dest);
    return dest;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Main Bundler
// ----------------------------------------------------------------------------

/**
 * Bundles an installed skill as a distributable directory package.
 *
 * Copies SKILL.md, SKILL.dc.md (optional), optionally
 * .verification.json and scripts/ to the output directory. Writes a
 * bundle-manifest.json with metadata.
 *
 * @param options - Bundle configuration.
 * @param projectRoot - Absolute project root path.
 * @returns BundleResult with list of files written.
 */
export async function bundleSkill(
  options: BundleOptions,
  projectRoot: string,
): Promise<BundleResult> {
  const skillDir = join(projectRoot, ".dantecode", "skills", sanitizeName(options.skillName));

  // Verify source skill directory exists
  try {
    await stat(skillDir);
  } catch {
    return {
      skillName: options.skillName,
      outputPath: options.outputPath,
      filesWritten: [],
      success: false,
      error: `Skill directory not found: ${skillDir}`,
    };
  }

  // Create output directory
  try {
    await mkdir(options.outputPath, { recursive: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      skillName: options.skillName,
      outputPath: options.outputPath,
      filesWritten: [],
      success: false,
      error: `Failed to create output directory: ${message}`,
    };
  }

  const filesWritten: string[] = [];
  const includeVerification = options.includeVerification !== false;
  const includeScripts = options.includeScripts !== false;

  // Copy core skill files (SKILL.md is required; SKILL.dc.md is optional)
  const coreFiles = ["SKILL.md", "SKILL.dc.md"];
  for (const filename of coreFiles) {
    const dest = await copyIfExists(join(skillDir, filename), join(options.outputPath, filename));
    if (dest !== null) filesWritten.push(dest);
  }

  // Optionally copy .verification.json
  if (includeVerification) {
    const dest = await copyIfExists(
      join(skillDir, ".verification.json"),
      join(options.outputPath, ".verification.json"),
    );
    if (dest !== null) filesWritten.push(dest);
  }

  // Optionally copy scripts/ directory
  if (includeScripts) {
    const scriptsDir = join(skillDir, "scripts");
    let scriptsExist = false;
    try {
      const s = await stat(scriptsDir);
      scriptsExist = s.isDirectory();
    } catch {
      scriptsExist = false;
    }

    if (scriptsExist) {
      const outputScripts = join(options.outputPath, "scripts");
      try {
        await mkdir(outputScripts, { recursive: true });
        const copied = await copyDirRecursive(scriptsDir, outputScripts);
        filesWritten.push(...copied);
      } catch {
        // Non-fatal if scripts dir copy fails
      }
    }
  }

  // Guard: if no real skill files were written (excluding manifest), the bundle is empty
  if (filesWritten.filter((f) => !f.endsWith("bundle-manifest.json")).length === 0) {
    return {
      skillName: options.skillName,
      outputPath: options.outputPath,
      filesWritten: [],
      success: false,
      error: "Bundle is empty — no skill files were found to include",
    };
  }

  // Read version from .verification.json if available
  const version = "0.0.0";
  try {
    const verificationRaw = await readFile(join(skillDir, ".verification.json"), "utf-8");
    const verificationData = JSON.parse(verificationRaw) as Record<string, unknown>;
    // Not stored in verification — use default
    void verificationData;
  } catch {
    // Use default version
  }

  // Write bundle-manifest.json
  const manifestPath = join(options.outputPath, "bundle-manifest.json");
  const manifestData = {
    name: options.skillName,
    version,
    bundledAt: new Date().toISOString(),
    files: filesWritten.map((f) => relative(options.outputPath, f)),
  };

  try {
    await writeFile(manifestPath, JSON.stringify(manifestData, null, 2), "utf-8");
    filesWritten.push(manifestPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      skillName: options.skillName,
      outputPath: options.outputPath,
      filesWritten,
      success: false,
      error: `Failed to write bundle-manifest.json: ${message}`,
    };
  }

  return {
    skillName: options.skillName,
    outputPath: options.outputPath,
    filesWritten,
    success: true,
  };
}

/**
 * Convenience wrapper that bundles a skill from a CatalogEntry.
 *
 * @param entry - The catalog entry for the skill.
 * @param outputPath - Destination directory for the bundle.
 * @param projectRoot - Absolute project root path.
 * @returns BundleResult with list of files written.
 */
export async function exportSkillToDirectory(
  entry: CatalogEntry,
  outputPath: string,
  projectRoot: string,
): Promise<BundleResult> {
  return bundleSkill({ skillName: entry.name, outputPath }, projectRoot);
}
