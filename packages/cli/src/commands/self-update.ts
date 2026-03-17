// ============================================================================
// @dantecode/cli — Self-Update Command
// ============================================================================

import { execSync } from "node:child_process";
import { resolve } from "node:path";

type SelfUpdateOptions = {
  verbose: boolean;
  dryRun: boolean;
};

export async function runSelfUpdateCommand(
  projectRoot: string,
  options: SelfUpdateOptions,
): Promise<void> {
  const { verbose, dryRun } = options;

  const log = (msg: string) => {
    if (verbose) console.log(`[self-update] ${msg}`);
  };

  try {
    log("1. Checking gates...");
    execSync("npm run release:check", { cwd: projectRoot, stdio: "inherit", timeout: 120000 });

    if (dryRun) {
      console.log("[self-update] Dry-run complete. Would update now.");
      return;
    }

    log("2. Git pull...");
    execSync("git pull origin main", { cwd: projectRoot, stdio: "inherit" });

    log("3. Clean install...");
    execSync("npm ci", { cwd: projectRoot, stdio: "inherit", timeout: 300000 });

    log("4. Build...");
    execSync("npm run build", { cwd: projectRoot, stdio: "inherit", timeout: 120000 });

    log("5. VSCode package & reinstall...");
    const vscodeDir = resolve(projectRoot, "packages/vscode");
    execSync("npx @vscode/vsce package", { cwd: vscodeDir, stdio: "inherit" });
    const vsix = (await import("node:fs/promises"))
      .readdir(vscodeDir)
      .then((files) => files.find((f) => f.endsWith(".vsix")));
    if (vsix) {
      execSync(`code --install-extension ${vsix} --force`, { cwd: vscodeDir, stdio: "inherit" });
    }

    log("6. Reload window...");
    console.log("\n✅ Self-update complete! Reload VS Code window (Cmd+R).");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[self-update] FAILED: ${msg}`);
    process.exit(1);
  }
}
