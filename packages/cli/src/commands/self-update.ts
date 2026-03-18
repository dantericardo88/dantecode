// ============================================================================
// @dantecode/cli - Self-Update Command
// ============================================================================

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectInstallContext,
  type DetectedInstallContext,
  type SelfUpdatePlan,
} from "@dantecode/core";

export type SelfUpdateOptions = {
  verbose: boolean;
  dryRun: boolean;
  runtimePath?: string;
};

export async function runSelfUpdateCommand(cwd: string, options: SelfUpdateOptions): Promise<void> {
  const { verbose, dryRun } = options;
  const runtimePath = options.runtimePath ?? fileURLToPath(import.meta.url);
  const installContext = detectInstallContext({ runtimePath, cwd });
  const plan = buildSelfUpdatePlan(installContext);

  const log = (message: string) => {
    if (verbose) {
      console.log(`[self-update] ${message}`);
    }
  };

  log(`Detected install context: ${installContext.kind}`);

  if (dryRun) {
    printPlan(plan);
    return;
  }

  try {
    switch (installContext.kind) {
      case "repo_checkout":
        await runRepoCheckoutUpdate(installContext, log);
        return;
      case "npm_global_cli":
        runGlobalCliUpdate(log);
        return;
      case "npm_local_dependency":
      case "npx_ephemeral":
        printPlan(plan);
        return;
      case "vscode_extension_host":
        console.log("[self-update] Use the VS Code extension command surface to update DanteCode.");
        return;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[self-update] FAILED: ${message}`);
    process.exitCode = 1;
  }
}

function buildSelfUpdatePlan(installContext: DetectedInstallContext): SelfUpdatePlan {
  switch (installContext.kind) {
    case "repo_checkout":
      return {
        kind: installContext.kind,
        automatic: true,
        summary:
          "Update the DanteCode repo checkout in place: pull the configured upstream, reinstall dependencies, run the release checks, then package and reinstall the VS Code extension.",
        targetRoot: installContext.repoRoot,
        commands: [
          "git status --porcelain",
          "git pull --ff-only <resolved-remote> <resolved-branch>",
          "npm ci",
          "npm run release:check",
          "npx @vscode/vsce package",
          "code --install-extension <generated-vsix> --force",
        ],
        warnings: ["This path refuses to run when the repo worktree is dirty."],
      };
    case "npm_global_cli":
      return {
        kind: installContext.kind,
        automatic: true,
        summary: "Update the globally installed DanteCode CLI via npm.",
        commands: ["npm install -g @dantecode/cli@latest"],
        warnings: ["Run dantecode --version after the install completes."],
      };
    case "npm_local_dependency":
      return {
        kind: installContext.kind,
        automatic: false,
        summary:
          "This CLI is installed inside the current project. Updating it should be done through the project's package manager, not by mutating the workspace automatically.",
        targetRoot: installContext.workspaceRoot,
        commands: ["npm install @dantecode/cli@latest"],
        warnings: ["Re-run your usual project install command if the project uses a lockfile."],
      };
    case "npx_ephemeral":
      return {
        kind: installContext.kind,
        automatic: false,
        summary:
          "This CLI is running from an ephemeral npx install. Start the next session from the latest published package instead of updating the current cache entry.",
        commands: ["npx @dantecode/cli@latest"],
        warnings: [],
      };
    case "vscode_extension_host":
      return {
        kind: installContext.kind,
        automatic: false,
        summary: "VS Code extension updates should be triggered from the extension host UI.",
        commands: ["Use the DanteCode: Self Update command from VS Code."],
        warnings: [],
      };
  }
}

async function runRepoCheckoutUpdate(
  installContext: DetectedInstallContext,
  log: (message: string) => void,
): Promise<void> {
  const repoRoot = installContext.repoRoot;
  if (!repoRoot) {
    throw new Error("Repo checkout update requested without a detected repo root.");
  }

  log(`Checking git status in ${repoRoot}`);
  const dirtyStatus = runCommand("git status --porcelain", repoRoot).trim();
  if (dirtyStatus.length > 0) {
    console.error(
      "[self-update] Refusing to update a dirty repo checkout. Commit or stash your changes first.",
    );
    process.exitCode = 1;
    return;
  }

  const { remote, branch } = resolveGitUpstream(repoRoot);
  log(`Pulling ${remote}/${branch}`);
  execSync(`git pull --ff-only "${remote}" "${branch}"`, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  log("Running npm ci...");
  execSync("npm ci", {
    cwd: repoRoot,
    stdio: "inherit",
    timeout: 300000,
  });

  log("Running release checks...");
  execSync("npm run release:check", {
    cwd: repoRoot,
    stdio: "inherit",
    timeout: 900000,
  });

  const vscodeRoot = resolve(repoRoot, "packages", "vscode");
  if (!existsSync(vscodeRoot)) {
    console.log(
      "[self-update] Repo update complete. packages/vscode was not found, so no VSIX was packaged.",
    );
    return;
  }

  log("Packaging the VS Code extension...");
  execSync("npx @vscode/vsce package", {
    cwd: vscodeRoot,
    stdio: "inherit",
    timeout: 300000,
  });

  const vsixName = (await readdir(vscodeRoot)).find((fileName) => fileName.endsWith(".vsix"));
  if (!vsixName) {
    console.log("[self-update] Repo update complete. No VSIX artifact was produced to reinstall.");
    return;
  }

  try {
    log(`Installing ${vsixName} with the VS Code CLI...`);
    execSync(`code --install-extension "${vsixName}" --force`, {
      cwd: vscodeRoot,
      stdio: "inherit",
      timeout: 120000,
    });
  } catch {
    console.log(
      `[self-update] Repo update complete, but the VS Code CLI was unavailable. Install ${vsixName} manually if needed.`,
    );
    return;
  }

  console.log(
    "[self-update] Repo self-update complete. Reload the VS Code window to pick up the new extension build.",
  );
}

function runGlobalCliUpdate(log: (message: string) => void): void {
  log("Updating the globally installed CLI...");
  execSync("npm install -g @dantecode/cli@latest", {
    stdio: "inherit",
    timeout: 300000,
  });

  console.log(
    "[self-update] Global CLI update complete. Run `dantecode --version` to verify the new install.",
  );
}

function resolveGitUpstream(repoRoot: string): { remote: string; branch: string } {
  try {
    const upstream = runCommand(
      "git rev-parse --abbrev-ref --symbolic-full-name @{upstream}",
      repoRoot,
    ).trim();
    const [remote, ...branchParts] = upstream.split("/");
    if (remote && branchParts.length > 0) {
      return { remote, branch: branchParts.join("/") };
    }
  } catch {
    // Fall through to local branch detection.
  }

  const branch = runCommand("git rev-parse --abbrev-ref HEAD", repoRoot).trim();
  if (!branch || branch === "HEAD") {
    throw new Error("Unable to resolve the current branch or upstream for this checkout.");
  }
  return { remote: "origin", branch };
}

function runCommand(command: string, cwd: string): string {
  return execSync(command, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function printPlan(plan: SelfUpdatePlan): void {
  console.log(`[self-update] ${plan.summary}`);
  if (plan.targetRoot) {
    console.log(`[self-update] Target root: ${plan.targetRoot}`);
  }
  if (plan.commands.length > 0) {
    console.log("[self-update] Commands:");
    for (const command of plan.commands) {
      console.log(`  - ${command}`);
    }
  }
  if (plan.warnings.length > 0) {
    console.log("[self-update] Notes:");
    for (const warning of plan.warnings) {
      console.log(`  - ${warning}`);
    }
  }
}
