import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ReadinessArtifact {
  name: string;
  path: string;
  gitCommit: string;
  timestamp: string;
  stale: boolean;
  staleDuration?: string;
}

export interface FreshnessCheckResult {
  currentCommit: string;
  artifacts: ReadinessArtifact[];
  staleCount: number;
  allFresh: boolean;
}

/**
 * Get current git commit hash from repository
 */
export function getCurrentCommit(projectRoot: string): string {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return commit;
  } catch (error) {
    throw new Error(`Failed to get current git commit: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Calculate human-readable duration from ISO timestamp to now
 */
export function calculateDuration(timestamp: string): string {
  try {
    const then = new Date(timestamp);
    const now = new Date();

    // Check for invalid date
    if (isNaN(then.getTime())) {
      return "unknown";
    }

    const diffMs = now.getTime() - then.getTime();

    if (diffMs < 0) {
      return "in the future";
    }

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days} day${days === 1 ? "" : "s"} ago`;
    }
    if (hours > 0) {
      return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    }
    if (minutes > 0) {
      return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    }
    return `${seconds} second${seconds === 1 ? "" : "s"} ago`;
  } catch {
    return "unknown";
  }
}

/**
 * Check freshness of readiness artifacts against current git commit
 */
export function checkReadinessFreshness(
  artifactPaths: string[],
  projectRoot: string
): FreshnessCheckResult {
  const currentCommit = getCurrentCommit(projectRoot);
  const artifacts: ReadinessArtifact[] = [];

  for (const artifactPath of artifactPaths) {
    const fullPath = resolve(projectRoot, artifactPath);

    if (!existsSync(fullPath)) {
      artifacts.push({
        name: artifactPath.split(/[/\\]/).pop() || artifactPath,
        path: artifactPath,
        gitCommit: "missing",
        timestamp: new Date().toISOString(),
        stale: true,
        staleDuration: "missing file",
      });
      continue;
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      const artifact = JSON.parse(content);

      const artifactCommit = artifact.gitCommit || artifact.commitSha || "";
      const artifactTimestamp = artifact.timestamp || artifact.generatedAt || new Date().toISOString();
      const stale = artifactCommit !== currentCommit;

      artifacts.push({
        name: artifactPath.split(/[/\\]/).pop() || artifactPath,
        path: artifactPath,
        gitCommit: artifactCommit || "unknown",
        timestamp: artifactTimestamp,
        stale,
        staleDuration: stale ? calculateDuration(artifactTimestamp) : undefined,
      });
    } catch (error) {
      artifacts.push({
        name: artifactPath.split(/[/\\]/).pop() || artifactPath,
        path: artifactPath,
        gitCommit: "parse-error",
        timestamp: new Date().toISOString(),
        stale: true,
        staleDuration: `parse error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const staleCount = artifacts.filter((a) => a.stale).length;

  return {
    currentCommit,
    artifacts,
    staleCount,
    allFresh: staleCount === 0,
  };
}

/**
 * Display warnings for stale artifacts
 */
export function warnStaleArtifacts(result: FreshnessCheckResult): void {
  const staleArtifacts = result.artifacts.filter((a) => a.stale);

  if (staleArtifacts.length === 0) {
    return;
  }

  console.warn(`\n⚠️  ${staleArtifacts.length} readiness artifact${staleArtifacts.length === 1 ? "" : "s"} STALE:`);

  for (const artifact of staleArtifacts) {
    const commitDisplay = artifact.gitCommit === "missing"
      ? "MISSING"
      : artifact.gitCommit === "parse-error"
      ? "PARSE-ERROR"
      : artifact.gitCommit === "unknown"
      ? "UNKNOWN"
      : artifact.gitCommit.slice(0, 7);

    console.warn(`   - ${artifact.name}: commit ${commitDisplay} (${artifact.staleDuration})`);
  }

  console.warn(`   Current commit: ${result.currentCommit.slice(0, 7)}`);
  console.warn(`   Action: npm run generate-readiness\n`);
}

/**
 * Check and enforce freshness in CI environment
 * Returns true if check passed, false if stale artifacts detected in CI/strict mode
 */
export function enforceFreshnessInCI(
  artifactPaths: string[],
  projectRoot: string,
  options: { ci?: boolean; strict?: boolean } = {}
): boolean {
  const result = checkReadinessFreshness(artifactPaths, projectRoot);

  warnStaleArtifacts(result);

  if (!result.allFresh && (options.ci || options.strict)) {
    console.error("❌ Stale readiness artifacts detected in CI/strict mode");
    return false;
  }

  if (result.allFresh) {
    console.log("✅ All readiness artifacts are fresh");
  }

  // In non-CI mode, return true even if stale (warnings already shown)
  return options.ci || options.strict ? result.allFresh : true;
}
