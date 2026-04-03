// ============================================================================
// @dantecode/core - Runtime install context + self-update helpers
// ============================================================================

import { accessSync, existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

export type InstallContextKind =
  | "repo_checkout"
  | "npm_global_cli"
  | "npm_local_dependency"
  | "npx_ephemeral"
  | "vscode_extension_host";

export interface DetectInstallContextOptions {
  runtimePath: string;
  cwd?: string;
  workspaceRoot?: string;
  extensionPath?: string;
}

export interface DetectedInstallContext {
  kind: InstallContextKind;
  runtimePath: string;
  packageRoot: string;
  packageName?: string;
  repoRoot?: string;
  cwd?: string;
  workspaceRoot?: string;
  extensionPath?: string;
  workspaceIsRepoRoot: boolean;
}

export interface SelfUpdatePlan {
  kind: InstallContextKind;
  automatic: boolean;
  summary: string;
  targetRoot?: string;
  commands: string[];
  warnings: string[];
}

export interface ResolvePreferredShellOptions {
  platform?: NodeJS.Platform;
  accessSyncFn?: typeof accessSync;
  gitBashPaths?: string[];
}

const DEFAULT_GIT_BASH_PATHS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];

export function detectInstallContext(options: DetectInstallContextOptions): DetectedInstallContext {
  const runtimePath = resolve(options.runtimePath);
  const cwd = options.cwd ? resolve(options.cwd) : undefined;
  const workspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : cwd;
  const extensionPath = options.extensionPath ? resolve(options.extensionPath) : undefined;
  const packageRoot = extensionPath ? findPackageRoot(extensionPath) : findPackageRoot(runtimePath);
  const packageJson = readPackageJson(packageRoot);
  const repoRoot = findRepoRoot(packageRoot);
  const workspaceIsRepoRoot = Boolean(workspaceRoot && repoRoot && workspaceRoot === repoRoot);

  if (extensionPath) {
    return {
      kind: "vscode_extension_host",
      runtimePath,
      packageRoot,
      packageName: packageJson?.name,
      repoRoot,
      cwd,
      workspaceRoot,
      extensionPath,
      workspaceIsRepoRoot,
    };
  }

  if (repoRoot) {
    return {
      kind: "repo_checkout",
      runtimePath,
      packageRoot,
      packageName: packageJson?.name,
      repoRoot,
      cwd,
      workspaceRoot,
      workspaceIsRepoRoot,
    };
  }

  if (looksLikeNpxPath(packageRoot)) {
    return {
      kind: "npx_ephemeral",
      runtimePath,
      packageRoot,
      packageName: packageJson?.name,
      cwd,
      workspaceRoot,
      workspaceIsRepoRoot,
    };
  }

  if (workspaceRoot && isWithinPath(packageRoot, join(workspaceRoot, "node_modules"))) {
    return {
      kind: "npm_local_dependency",
      runtimePath,
      packageRoot,
      packageName: packageJson?.name,
      cwd,
      workspaceRoot,
      workspaceIsRepoRoot,
    };
  }

  return {
    kind: "npm_global_cli",
    runtimePath,
    packageRoot,
    packageName: packageJson?.name,
    cwd,
    workspaceRoot,
    workspaceIsRepoRoot,
  };
}

export function resolvePreferredShell(
  options: ResolvePreferredShellOptions = {},
): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return "/bin/bash";
  }

  const accessFn = options.accessSyncFn ?? accessSync;
  const gitBashPaths = options.gitBashPaths ?? DEFAULT_GIT_BASH_PATHS;
  for (const shellPath of gitBashPaths) {
    try {
      accessFn(shellPath);
      return shellPath;
    } catch {
      // Try the next candidate path.
    }
  }

  // Undefined lets child_process fall back to the OS default shell on Windows.
  return undefined;
}

function findPackageRoot(startPath: string): string {
  let current = normalizeSearchRoot(startPath);
  while (true) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return normalizeSearchRoot(startPath);
    }
    current = parent;
  }
}

function normalizeSearchRoot(targetPath: string): string {
  const resolvedTarget = resolve(targetPath);
  return extname(resolvedTarget) ? dirname(resolvedTarget) : resolvedTarget;
}

function readPackageJson(
  packageRoot: string,
): { name?: string; workspaces?: string[] | Record<string, unknown> } | null {
  try {
    return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as {
      name?: string;
      workspaces?: string[] | Record<string, unknown>;
    };
  } catch {
    return null;
  }
}

function findRepoRoot(packageRoot: string): string | undefined {
  let current = packageRoot;

  while (true) {
    const packageJson = readPackageJson(current);
    const hasWorkspaces = Boolean(packageJson?.workspaces);
    const cliRoot = join(current, "packages", "cli");
    const vscodeRoot = join(current, "packages", "vscode");
    const matchesDantePackage =
      packageRoot === cliRoot ||
      packageRoot === vscodeRoot ||
      isWithinPath(packageRoot, cliRoot) ||
      isWithinPath(packageRoot, vscodeRoot);

    if (hasWorkspaces && matchesDantePackage) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function looksLikeNpxPath(packageRoot: string): boolean {
  const normalized = packageRoot.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/_npx/");
}

function isWithinPath(targetPath: string, basePath: string): boolean {
  const rel = relative(resolve(basePath), resolve(targetPath));
  return rel === "" || (!rel.startsWith("..") && rel !== "." && !rel.includes(":"));
}
