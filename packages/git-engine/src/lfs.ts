/**
 * lfs.ts - Git LFS (Large File Storage) support
 *
 * Provides utilities for working with Git LFS:
 * - Check if LFS is installed
 * - Initialize LFS in a repository
 * - Track file patterns with LFS
 * - Check if a file is tracked by LFS
 * - Get LFS status and statistics
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface LfsStatus {
  installed: boolean;
  initialized: boolean;
  version?: string;
  trackedPatterns: string[];
  trackedFiles: number;
  totalSize?: string;
}

export interface LfsTrackResult {
  success: boolean;
  pattern: string;
  message: string;
}

/**
 * Check if Git LFS is installed
 */
export function isLfsInstalled(): boolean {
  try {
    execFileSync("git", ["lfs", "version"], { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Git LFS version
 */
export function getLfsVersion(): string | undefined {
  try {
    const output = execFileSync("git", ["lfs", "version"], { encoding: "utf-8", stdio: "pipe" });
    const match = output.match(/git-lfs\/([\d.]+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Check if LFS is initialized in repository
 */
export function isLfsInitialized(projectRoot: string): boolean {
  const gitAttributesPath = join(projectRoot, ".gitattributes");
  if (!existsSync(gitAttributesPath)) {
    return false;
  }

  const content = readFileSync(gitAttributesPath, "utf-8");
  return content.includes("filter=lfs");
}

/**
 * Initialize Git LFS in repository
 */
export function initializeLfs(projectRoot: string): { success: boolean; message: string } {
  if (!isLfsInstalled()) {
    return {
      success: false,
      message: "Git LFS is not installed. Install from https://git-lfs.github.com/",
    };
  }

  try {
    execFileSync("git", ["lfs", "install"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });

    return {
      success: true,
      message: "Git LFS initialized successfully",
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to initialize Git LFS: ${error.message}`,
    };
  }
}

/**
 * Track file pattern with LFS
 */
export function trackPattern(projectRoot: string, pattern: string): LfsTrackResult {
  if (!isLfsInstalled()) {
    return {
      success: false,
      pattern,
      message: "Git LFS is not installed",
    };
  }

  if (!isLfsInitialized(projectRoot)) {
    const initResult = initializeLfs(projectRoot);
    if (!initResult.success) {
      return {
        success: false,
        pattern,
        message: initResult.message,
      };
    }
  }

  try {
    execFileSync("git", ["lfs", "track", pattern], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });

    return {
      success: true,
      pattern,
      message: `Tracking "${pattern}" with Git LFS`,
    };
  } catch (error: any) {
    return {
      success: false,
      pattern,
      message: `Failed to track pattern: ${error.message}`,
    };
  }
}

/**
 * Untrack file pattern from LFS
 */
export function untrackPattern(projectRoot: string, pattern: string): LfsTrackResult {
  if (!isLfsInstalled()) {
    return {
      success: false,
      pattern,
      message: "Git LFS is not installed",
    };
  }

  try {
    execFileSync("git", ["lfs", "untrack", pattern], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });

    return {
      success: true,
      pattern,
      message: `Untracked "${pattern}" from Git LFS`,
    };
  } catch (error: any) {
    return {
      success: false,
      pattern,
      message: `Failed to untrack pattern: ${error.message}`,
    };
  }
}

/**
 * Get list of tracked patterns
 */
export function getTrackedPatterns(projectRoot: string): string[] {
  const gitAttributesPath = join(projectRoot, ".gitattributes");
  if (!existsSync(gitAttributesPath)) {
    return [];
  }

  const content = readFileSync(gitAttributesPath, "utf-8");
  const patterns: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("filter=lfs")) {
      const pattern = trimmed.split(/\s+/)[0];
      if (pattern) {
        patterns.push(pattern);
      }
    }
  }

  return patterns;
}

/**
 * Check if file is tracked by LFS
 */
export function isFileTrackedByLfs(projectRoot: string, filePath: string): boolean {
  if (!isLfsInstalled() || !isLfsInitialized(projectRoot)) {
    return false;
  }

  try {
    const output = execFileSync("git", ["check-attr", "filter", filePath], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });

    return output.includes("filter: lfs");
  } catch {
    return false;
  }
}

/**
 * Get LFS status
 */
export function getLfsStatus(projectRoot: string): LfsStatus {
  const installed = isLfsInstalled();
  const version = getLfsVersion();
  const initialized = installed && isLfsInitialized(projectRoot);
  const trackedPatterns = initialized ? getTrackedPatterns(projectRoot) : [];

  let trackedFiles = 0;
  let totalSize: string | undefined;

  if (installed && initialized) {
    try {
      const output = execFileSync("git", ["lfs", "ls-files", "--size"], {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: "pipe",
      });

      const lines = output
        .trim()
        .split("\n")
        .filter((l) => l.trim());
      trackedFiles = lines.length;

      // Calculate total size
      let totalBytes = 0;
      for (const line of lines) {
        const match = line.match(/\((\d+)\s+B\)/);
        if (match && match[1]) {
          totalBytes += parseInt(match[1], 10);
        }
      }

      if (totalBytes > 0) {
        totalSize = formatBytes(totalBytes);
      }
    } catch {
      // Non-fatal: status retrieval failed
    }
  }

  return {
    installed,
    initialized,
    version,
    trackedPatterns,
    trackedFiles,
    totalSize,
  };
}

/**
 * Migrate existing files to LFS
 */
export function migrateToLfs(
  projectRoot: string,
  pattern: string,
  options: { includeRef?: string } = {},
): { success: boolean; message: string; migratedCount?: number } {
  if (!isLfsInstalled()) {
    return {
      success: false,
      message: "Git LFS is not installed",
    };
  }

  // Track pattern first
  const trackResult = trackPattern(projectRoot, pattern);
  if (!trackResult.success) {
    return {
      success: false,
      message: trackResult.message,
    };
  }

  try {
    const args = ["lfs", "migrate", "import", "--include", pattern];
    if (options.includeRef) {
      args.push("--include-ref", options.includeRef);
    }

    const output = execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });

    // Parse output to get migrated count
    const match = output.match(/migrate: (\d+) object\(s\) found/);
    const migratedCount = match?.[1] ? parseInt(match[1], 10) : undefined;

    return {
      success: true,
      message: `Migrated "${pattern}" to Git LFS`,
      migratedCount,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to migrate: ${error.message}`,
    };
  }
}

/**
 * Pull LFS files
 */
export function pullLfsFiles(projectRoot: string): { success: boolean; message: string } {
  if (!isLfsInstalled()) {
    return {
      success: false,
      message: "Git LFS is not installed",
    };
  }

  try {
    execFileSync("git", ["lfs", "pull"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
    });

    return {
      success: true,
      message: "Git LFS files pulled successfully",
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to pull LFS files: ${error.message}`,
    };
  }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Common patterns for LFS tracking
 */
export const COMMON_LFS_PATTERNS = {
  images: ["*.png", "*.jpg", "*.jpeg", "*.gif", "*.bmp", "*.svg", "*.ico"],
  videos: ["*.mp4", "*.mov", "*.avi", "*.mkv", "*.webm"],
  audio: ["*.mp3", "*.wav", "*.flac", "*.aac"],
  archives: ["*.zip", "*.tar.gz", "*.rar", "*.7z"],
  binaries: ["*.exe", "*.dll", "*.so", "*.dylib", "*.app"],
  models: ["*.h5", "*.pkl", "*.pth", "*.onnx", "*.pb"],
  datasets: ["*.csv", "*.parquet", "*.arrow", "*.feather"],
  fonts: ["*.ttf", "*.otf", "*.woff", "*.woff2"],
} as const;
