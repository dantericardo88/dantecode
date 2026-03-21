// ============================================================================
// @dantecode/skill-adapter — Skill Installer
// Installs skills from local paths, git repos, or HTTP URLs.
// Runs DanteForge verification on every install by default.
// ============================================================================

import { mkdir, copyFile, readdir, stat, symlink, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { SkillSourceFormat, UniversalParsedSkill } from "../parsers/universal-parser.js";
import {
  detectSkillSources,
  parseUniversalSkill,
  universalToWrappable,
} from "../parsers/universal-parser.js";
import { verifySkill } from "../verifier/skill-verifier.js";
import type { SkillVerificationResult } from "../verifier/skill-verifier.js";
import { wrapSkillWithAdapter } from "../wrap.js";
import { SkillCatalog } from "./catalog.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface InstallOptions {
  source: string; // local path, git URL, or HTTP URL
  verify?: boolean; // default: true
  tier?: "guardian" | "sentinel" | "sovereign"; // required tier, default: "guardian"
  force?: boolean; // install even if verification fails
  symlink?: boolean; // symlink instead of copy
  sourceTimeout?: number; // timeout in ms for git/HTTP source fetch, default: 30000
}

export interface InstallResult {
  name: string;
  installedPath: string;
  source: string;
  format: SkillSourceFormat;
  verification?: SkillVerificationResult;
  success: boolean;
  error?: string;
}

// ----------------------------------------------------------------------------
// Source Resolution
// ----------------------------------------------------------------------------

async function resolveSource(
  source: string,
  projectRoot: string,
  options: InstallOptions,
): Promise<string> {
  // Check if it's a local path that exists
  const resolved = resolve(source);
  try {
    await stat(resolved);
    return resolved;
  } catch {
    // Not a local path — try URL-based resolution
  }

  if (
    source.startsWith("git://") ||
    source.startsWith("https://github.com/") ||
    source.endsWith(".git")
  ) {
    const tmpDir = join(projectRoot, ".dantecode", "tmp", `skill-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    try {
      execFileSync("git", ["clone", "--depth", "1", source, tmpDir], {
        stdio: "pipe",
        timeout: options.sourceTimeout ?? 30_000,
      });
      return tmpDir;
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(
        `Git clone failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (source.startsWith("http://") || source.startsWith("https://")) {
    const tmpDir = join(projectRoot, ".dantecode", "tmp", `skill-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    try {
      const tarball = join(tmpDir, "skill.tar.gz");
      execFileSync("curl", ["-sL", source, "-o", tarball], {
        stdio: "pipe",
        timeout: options.sourceTimeout ?? 30_000,
      });
      execFileSync("tar", ["xzf", tarball, "-C", tmpDir], {
        stdio: "pipe",
        timeout: options.sourceTimeout ?? 30_000,
      });
      return tmpDir;
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(
        `HTTP fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(
    "Cannot resolve skill source. Supported: local paths, git URLs, HTTP URLs.",
  );
}

// ----------------------------------------------------------------------------
// File Copy Helpers
// ----------------------------------------------------------------------------

/**
 * Copies SKILL.md, SKILL.dc.md, *.toml, and scripts/ directory to destDir.
 */
async function copySkillFiles(srcDir: string, destDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(srcDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;

    const srcPath = join(srcDir, entry);
    let entryStat;
    try {
      entryStat = await stat(srcPath);
    } catch {
      continue;
    }

    if (entryStat.isDirectory() && entry === "scripts") {
      // Copy scripts directory recursively
      const destScripts = join(destDir, "scripts");
      await mkdir(destScripts, { recursive: true });
      await copySkillFiles(srcPath, destScripts);
    } else if (entryStat.isFile()) {
      if (
        entry === "SKILL.md" ||
        entry === "SKILL.dc.md" ||
        /\.toml$/i.test(entry)
      ) {
        try {
          await copyFile(srcPath, join(destDir, entry));
        } catch {
          // Skip files that fail to copy
        }
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Name Sanitization
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

// ----------------------------------------------------------------------------
// Main Installer
// ----------------------------------------------------------------------------

/**
 * Installs a skill from a local path, git URL, or HTTP URL into the project.
 *
 * Steps:
 * 1. Resolve the source path
 * 2. Detect skill format
 * 3. Parse the skill
 * 4. Verify (unless disabled)
 * 5. Install to .dantecode/skills/<name>/
 * 6. Write DanteForge wrapper (SKILL.dc.md)
 * 7. Write verification result
 * 8. Register in catalog
 *
 * @param options - Installation options.
 * @param projectRoot - Absolute project root path.
 * @returns InstallResult with success/failure details.
 */
export async function installSkill(
  options: InstallOptions,
  projectRoot: string,
): Promise<InstallResult> {
  const shouldVerify = options.verify !== false;

  // Step 1: Resolve source
  let resolvedPath: string;
  try {
    resolvedPath = await resolveSource(options.source, projectRoot, options);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: "",
      installedPath: "",
      source: options.source,
      format: "unknown",
      success: false,
      error: message,
    };
  }

  // Track whether resolvedPath is a temp dir that must be cleaned up on all paths.
  // FIX 1: Normalize separators on both sides to handle Windows backslash vs forward slash.
  const normalizedResolved = resolvedPath.replace(/\\/g, "/");
  const normalizedTmpMarker = [projectRoot.replace(/\\/g, "/"), ".dantecode", "tmp"].join("/");
  const isTempPath = normalizedResolved.startsWith(normalizedTmpMarker);

  // FIX 2: Use try/finally so cleanup runs on ALL exit paths (early returns AND exceptions).
  try {
    // Step 2: Detect format
    let detections;
    try {
      detections = await detectSkillSources(resolvedPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        name: "",
        installedPath: "",
        source: options.source,
        format: "unknown",
        success: false,
        error: `Failed to detect skill format: ${message}`,
      };
    }

    if (detections.length === 0) {
      return {
        name: "",
        installedPath: "",
        source: options.source,
        format: "unknown",
        success: false,
        error: "No skill files detected at the source path",
      };
    }

    // Pick the highest-confidence detection
    const detection = detections.sort((a, b) => b.confidence - a.confidence)[0];
    if (!detection || detection.paths.length === 0) {
      return {
        name: "",
        installedPath: "",
        source: options.source,
        format: detection?.format ?? "unknown",
        success: false,
        error: "No skill files found in detected format",
      };
    }

    // Step 3: Parse skill
    let parsed: UniversalParsedSkill;
    try {
      parsed = await parseUniversalSkill(detection.paths[0]!, detection.format);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        name: "",
        installedPath: "",
        source: options.source,
        format: detection.format,
        success: false,
        error: `Failed to parse skill: ${message}`,
      };
    }

    // Step 4: Verify
    let verification: SkillVerificationResult | undefined;
    if (shouldVerify) {
      try {
        verification = await verifySkill(parsed, {
          tier: options.tier ?? "guardian",
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          name: parsed.name,
          installedPath: "",
          source: options.source,
          format: detection.format,
          success: false,
          error: `Verification failed with an error: ${message}`,
        };
      }

      if (!verification.passed && !options.force) {
        return {
          name: parsed.name,
          installedPath: "",
          source: options.source,
          format: detection.format,
          verification,
          success: false,
          error: `Skill verification did not meet required tier "${options.tier ?? "guardian"}" (qualified: ${verification.tier}, score: ${verification.overallScore})`,
        };
      }
    }

    // Step 5: Create install directory
    const installDir = join(projectRoot, ".dantecode", "skills", sanitizeName(parsed.name));
    try {
      await mkdir(installDir, { recursive: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        name: parsed.name,
        installedPath: "",
        source: options.source,
        format: detection.format,
        verification,
        success: false,
        error: `Failed to create install directory: ${message}`,
      };
    }

    // Copy or symlink files
    if (options.symlink) {
      try {
        await symlink(resolvedPath, join(installDir, "source-link"));
      } catch {
        // Symlink may fail if already exists — continue
      }
    } else {
      await copySkillFiles(resolvedPath, installDir);
    }

    // Step 6: Write DanteForge wrapper (SKILL.dc.md)
    try {
      const wrappable = universalToWrappable(parsed);
      // Map non-standard sources to the closest ImportSource type
      const importSource = (["claude", "continue", "opencode"] as const).includes(
        parsed.source as "claude" | "continue" | "opencode",
      )
        ? (parsed.source as "claude" | "continue" | "opencode")
        : "claude";

      const wrappedContent = wrapSkillWithAdapter(wrappable, importSource);
      await writeFile(join(installDir, "SKILL.dc.md"), wrappedContent, "utf-8");
    } catch {
      // Non-fatal — continue with install
    }

    // Step 7: Write verification result
    if (verification) {
      try {
        await writeFile(
          join(installDir, ".verification.json"),
          JSON.stringify(verification, null, 2),
          "utf-8",
        );
      } catch {
        // Non-fatal
      }
    }

    // Step 8: Register in catalog
    try {
      const catalog = new SkillCatalog(projectRoot);
      await catalog.load();
      catalog.upsert({
        name: parsed.name,
        description: parsed.description,
        source: parsed.source,
        sourcePath: parsed.sourcePath,
        installedPath: installDir,
        version: parsed.version ?? "0.0.0",
        tags: parsed.tags ?? [],
        verificationScore: verification?.overallScore,
        verificationTier: verification?.tier,
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await catalog.save();
    } catch {
      // Non-fatal — catalog update failure doesn't block install
    }

    return {
      name: parsed.name,
      installedPath: installDir,
      source: options.source,
      format: detection.format,
      verification,
      success: true,
    };
  } finally {
    // Clean up the temp directory on ALL exit paths (early returns AND exceptions).
    if (isTempPath && resolvedPath) {
      await rm(resolvedPath, { recursive: true, force: true }).catch(() => {});
    }
  }
}
