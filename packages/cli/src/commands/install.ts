// ============================================================================
// @dantecode/cli - Install Command
// Packages and installs the DanteCode VS Code extension into VS Code-family
// IDEs such as VS Code, Cursor, Windsurf, and Antigravity.
// ============================================================================

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export type SupportedIde = "vscode" | "cursor" | "windsurf" | "antigravity";

type InstallOptions = {
  ide: SupportedIde;
  dryRun: boolean;
  vsixPath?: string;
  ideExecutable?: string;
};

const IDE_METADATA: Record<SupportedIde, { label: string; bin: string; installDocs: string }> = {
  vscode: {
    label: "VS Code",
    bin: "code",
    installDocs: "Open Extensions -> ... -> Install from VSIX...",
  },
  cursor: {
    label: "Cursor",
    bin: "cursor",
    installDocs: "Open Extensions -> ... -> Install from VSIX...",
  },
  windsurf: {
    label: "Windsurf",
    bin: "windsurf",
    installDocs: "Open Extensions -> ... -> Install from VSIX...",
  },
  antigravity: {
    label: "Antigravity",
    bin: "antigravity",
    installDocs: "Open Plugins/Extensions -> ... -> Install from VSIX...",
  },
};

export async function runInstallCommand(args: string[], projectRoot: string): Promise<void> {
  const parsed = parseInstallArgs(args);
  if (!parsed) {
    printInstallUsage();
    process.exitCode = 1;
    return;
  }

  const vscodeRoot = resolve(projectRoot, "packages", "vscode");
  if (!existsSync(vscodeRoot)) {
    process.stdout.write(
      `${RED}Could not find packages/vscode from ${projectRoot}.${RESET}\n` +
        `${DIM}Run this command from a DanteCode repo checkout.${RESET}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const ideMeta = IDE_METADATA[parsed.ide];
  const ideExecutable = parsed.ideExecutable ?? ideMeta.bin;
  const installPlan = buildInstallPlan({
    projectRoot,
    vscodeRoot,
    ide: parsed.ide,
    ideExecutable,
    dryRun: parsed.dryRun,
    explicitVsixPath: parsed.vsixPath,
  });

  if (parsed.dryRun) {
    printInstallPlan(installPlan);
    return;
  }

  let vsixPath = parsed.vsixPath;
  if (!vsixPath) {
    process.stdout.write(`${BOLD}Packaging DanteCode VSIX for ${ideMeta.label}...${RESET}\n`);
    packageVsix(vscodeRoot);
    vsixPath = await findLatestVsix(vscodeRoot);
  }

  if (!vsixPath || !existsSync(vsixPath)) {
    process.stdout.write(
      `${RED}No VSIX package was found to install.${RESET}\n` +
        `${DIM}Try running in the repo checkout or pass --vsix <path>.${RESET}\n`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    execFileSync(ideExecutable, ["--install-extension", vsixPath, "--force"], {
      cwd: dirname(vsixPath),
      stdio: "inherit",
    });
    process.stdout.write(
      `\n${GREEN}${BOLD}Installed DanteCode into ${ideMeta.label}.${RESET}\n` +
        `${DIM}Reload the IDE window if the DanteCode sidebar does not appear immediately.${RESET}\n`,
    );
  } catch {
    process.stdout.write(
      `\n${YELLOW}Automatic install did not complete because '${ideExecutable}' was unavailable.${RESET}\n` +
        `${DIM}Manual install:${RESET} ${ideMeta.installDocs}\n` +
        `${DIM}VSIX:${RESET} ${vsixPath}\n`,
    );
    process.exitCode = 1;
  }
}

export function parseInstallArgs(args: string[]): InstallOptions | null {
  let ide: SupportedIde | null = null;
  let dryRun = false;
  let vsixPath: string | undefined;
  let ideExecutable: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--vsix") {
      vsixPath = args[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--ide-path") {
      ideExecutable = args[i + 1];
      i += 1;
      continue;
    }

    if (arg in IDE_METADATA) {
      ide = arg as SupportedIde;
      continue;
    }
  }

  if (!ide) {
    return null;
  }

  return { ide, dryRun, vsixPath, ideExecutable };
}

export function buildInstallPlan(input: {
  projectRoot: string;
  vscodeRoot: string;
  ide: SupportedIde;
  ideExecutable: string;
  dryRun: boolean;
  explicitVsixPath?: string;
}): { summary: string; commands: string[]; notes: string[] } {
  const meta = IDE_METADATA[input.ide];
  const commands = input.explicitVsixPath
    ? [`${input.ideExecutable} --install-extension "${input.explicitVsixPath}" --force`]
    : [
        `cd "${input.vscodeRoot}"`,
        "npm run build",
        "npx @vscode/vsce package",
        `${input.ideExecutable} --install-extension "<generated-vsix>" --force`,
      ];

  return {
    summary: `Install the DanteCode VS Code extension into ${meta.label}.`,
    commands,
    notes: [
      `Target IDE CLI: ${input.ideExecutable}`,
      input.explicitVsixPath
        ? "Using an explicit VSIX path."
        : "Packages the current repo's packages/vscode extension first.",
      `${meta.label} also supports manual installation from a VSIX file.`,
    ],
  };
}

function printInstallUsage(): void {
  process.stdout.write(
    `${BOLD}Usage:${RESET}\n` +
      `  dantecode install <vscode|cursor|windsurf|antigravity> [--dry-run]\n` +
      `  dantecode install <ide> --vsix <path-to-vsix>\n` +
      `  dantecode install <ide> --ide-path <custom-cli>\n\n` +
      `${DIM}Examples:${RESET}\n` +
      `  dantecode install vscode\n` +
      `  dantecode install antigravity\n` +
      `  dantecode install cursor --dry-run\n` +
      `  dantecode install vscode --vsix packages/vscode/dantecode-1.0.0.vsix\n\n`,
  );
}

function printInstallPlan(plan: { summary: string; commands: string[]; notes: string[] }): void {
  process.stdout.write(`[install] ${plan.summary}\n`);
  process.stdout.write(`${CYAN}Commands:${RESET}\n`);
  for (const command of plan.commands) {
    process.stdout.write(`  - ${command}\n`);
  }
  if (plan.notes.length > 0) {
    process.stdout.write(`${CYAN}Notes:${RESET}\n`);
    for (const note of plan.notes) {
      process.stdout.write(`  - ${note}\n`);
    }
  }
}

function packageVsix(vscodeRoot: string): void {
  execFileSync("npm", ["run", "build"], {
    cwd: vscodeRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  execFileSync("npx", ["@vscode/vsce", "package"], {
    cwd: vscodeRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

export async function findLatestVsix(vscodeRoot: string): Promise<string | undefined> {
  const files = await readdir(vscodeRoot, { withFileTypes: true });
  const vsixFiles = files
    .filter((entry) => entry.isFile() && entry.name.endsWith(".vsix"))
    .map((entry) => join(vscodeRoot, entry.name));

  if (vsixFiles.length === 0) {
    return undefined;
  }

  const stats = await Promise.all(
    vsixFiles.map(async (filePath) => ({
      filePath,
      mtimeMs: (await stat(filePath)).mtimeMs,
    })),
  );
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats[0]?.filePath;
}
