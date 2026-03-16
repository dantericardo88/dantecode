// ============================================================================
// DanteForge Skill — OSS Researcher
// Proactively suggests, clones, and learns from MIT-licensed OSS repos
// to accelerate feature development with clean-room pattern extraction.
// ============================================================================

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface OSSRepo {
  name: string;
  url: string;
  description: string;
  stars?: number;
  license?: string;
}

export interface ExtractedPattern {
  name: string;
  description: string;
  sourceRepo: string;
  category: "architecture" | "pattern" | "idiom" | "technique" | "structure";
  details: string;
}

export interface OSSResearchResult {
  repos: OSSRepo[];
  patterns: ExtractedPattern[];
  sandboxPath: string;
  cleanedUp: boolean;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const SANDBOX_DIR = ".dantecode/sandbox/oss-research";
const ALLOWED_LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Unlicense"]);

// ----------------------------------------------------------------------------
// Sandbox Management
// ----------------------------------------------------------------------------

/**
 * Creates the sandbox directory for cloning repos.
 */
export function ensureSandbox(projectRoot: string): string {
  const sandboxPath = join(projectRoot, SANDBOX_DIR);
  mkdirSync(sandboxPath, { recursive: true });
  return sandboxPath;
}

/**
 * Cleans up the sandbox directory after research.
 */
export function cleanupSandbox(projectRoot: string): void {
  const sandboxPath = join(projectRoot, SANDBOX_DIR);
  if (existsSync(sandboxPath)) {
    rmSync(sandboxPath, { recursive: true, force: true });
  }
}

// ----------------------------------------------------------------------------
// Repo Operations
// ----------------------------------------------------------------------------

/**
 * Clones a repo with --depth 1 into the sandbox.
 * Returns the local path or null on failure.
 */
export function cloneRepo(repoUrl: string, sandboxPath: string): string | null {
  // Extract repo name from URL
  const parts = repoUrl.replace(/\.git$/, "").split("/");
  const repoName = parts[parts.length - 1] || `repo-${Date.now()}`;
  const localPath = join(sandboxPath, repoName);

  if (existsSync(localPath)) {
    return localPath; // Already cloned
  }

  try {
    execSync(`git clone --depth 1 "${repoUrl}" "${localPath}"`, {
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return localPath;
  } catch {
    return null;
  }
}

/**
 * Reads the package.json or similar manifest to check license.
 */
export function checkLicense(repoPath: string): string | null {
  const pkgPath = join(repoPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { license?: string };
      return pkg.license ?? null;
    } catch {
      return null;
    }
  }

  // Check LICENSE file
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"]) {
    const licensePath = join(repoPath, name);
    if (existsSync(licensePath)) {
      const content = readFileSync(licensePath, "utf-8").slice(0, 500);
      if (content.includes("MIT")) return "MIT";
      if (content.includes("Apache")) return "Apache-2.0";
      if (content.includes("BSD")) return "BSD-3-Clause";
      if (content.includes("ISC")) return "ISC";
    }
  }

  return null;
}

/**
 * Validates that a repo has an allowed license.
 */
export function isLicenseAllowed(license: string | null): boolean {
  if (!license) return false;
  return ALLOWED_LICENSES.has(license);
}

/**
 * Reads the README from a cloned repo.
 */
export function readReadme(repoPath: string): string | null {
  for (const name of ["README.md", "README.rst", "README.txt", "README"]) {
    const readmePath = join(repoPath, name);
    if (existsSync(readmePath)) {
      const content = readFileSync(readmePath, "utf-8");
      // Truncate to 4000 chars to save context
      return content.length > 4000 ? content.slice(0, 4000) + "\n... (truncated)" : content;
    }
  }
  return null;
}

/**
 * Lists the top-level directory structure of a cloned repo.
 */
export function listRepoStructure(repoPath: string): string[] {
  try {
    const output = execSync("git ls-files", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 10000,
    });
    return output
      .split("\n")
      .filter((line) => line.length > 0)
      .slice(0, 100);
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// Pattern Storage
// ----------------------------------------------------------------------------

/**
 * Saves extracted patterns to a summary file in the sandbox.
 */
export function savePatterns(
  projectRoot: string,
  patterns: ExtractedPattern[],
  repos: OSSRepo[],
): void {
  const harvestedDir = join(projectRoot, "packages/danteforge/skills/harvested");
  mkdirSync(harvestedDir, { recursive: true });

  const summary = {
    timestamp: new Date().toISOString(),
    repos: repos.map((r) => ({ name: r.name, url: r.url, license: r.license })),
    patterns,
  };

  writeFileSync(
    join(harvestedDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf-8",
  );
}

// ----------------------------------------------------------------------------
// Main Research Flow (for programmatic use)
// ----------------------------------------------------------------------------

/**
 * Performs the full OSS research flow:
 * 1. Create sandbox
 * 2. Clone repos
 * 3. Verify licenses
 * 4. Extract patterns
 * 5. Clean up
 *
 * This is the programmatic API; the LLM-driven flow uses tools instead.
 */
export async function runOSSResearch(
  repos: OSSRepo[],
  projectRoot: string,
): Promise<OSSResearchResult> {
  const sandboxPath = ensureSandbox(projectRoot);
  const patterns: ExtractedPattern[] = [];
  const validRepos: OSSRepo[] = [];

  for (const repo of repos) {
    const localPath = cloneRepo(repo.url, sandboxPath);
    if (!localPath) continue;

    const license = checkLicense(localPath);
    if (!isLicenseAllowed(license)) {
      // Skip repos with non-permissive licenses
      continue;
    }

    repo.license = license ?? "Unknown";
    validRepos.push(repo);

    // Read structure for pattern extraction context
    const files = listRepoStructure(localPath);
    const readme = readReadme(localPath);

    // Basic pattern extraction from structure
    if (files.some((f) => f.includes("src/agent") || f.includes("agent-loop"))) {
      patterns.push({
        name: "Agent Loop Architecture",
        description: "Multi-round tool-calling agent loop with autonomous decision making",
        sourceRepo: repo.name,
        category: "architecture",
        details: `Found in ${repo.name}: agent loop pattern with tool call extraction and execution`,
      });
    }

    if (files.some((f) => f.includes("tools") || f.includes("tool-"))) {
      patterns.push({
        name: "Tool Registry Pattern",
        description: "Extensible tool registry with typed inputs and outputs",
        sourceRepo: repo.name,
        category: "pattern",
        details: `Found in ${repo.name}: tool definitions and dispatcher pattern`,
      });
    }

    if (readme && readme.includes("provider")) {
      patterns.push({
        name: "Provider Abstraction",
        description: "Model-agnostic provider interface for multiple LLM backends",
        sourceRepo: repo.name,
        category: "architecture",
        details: `Found in ${repo.name}: provider abstraction layer`,
      });
    }
  }

  // Save patterns
  if (patterns.length > 0) {
    savePatterns(projectRoot, patterns, validRepos);
  }

  // Clean up sandbox
  cleanupSandbox(projectRoot);

  return {
    repos: validRepos,
    patterns,
    sandboxPath,
    cleanedUp: true,
  };
}
