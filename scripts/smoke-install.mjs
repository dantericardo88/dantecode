import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm, spawnNpm } from "./npm-runner.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

const publishablePackages = [
  "packages/config-types",
  "packages/core",
  "packages/danteforge",
  "packages/git-engine",
  "packages/skill-adapter",
  "packages/sandbox",
  "packages/cli",
];

const packDir = mkdtempSync(join(tmpdir(), "dantecode-pack-smoke-"));
const installRoot = mkdtempSync(join(tmpdir(), "dantecode-install-smoke-"));
const projectDir = join(installRoot, "project");

function runNode(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });

  const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.error) {
    throw new Error(
      [`Command failed: node ${args.join(" ")}`, result.error.message, combinedOutput.trim()]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  if (result.status !== 0) {
    throw new Error(
      [`Command failed: node ${args.join(" ")}`, combinedOutput.trim()]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return combinedOutput;
}

try {
  writeFileSync(
    join(installRoot, "package.json"),
    '{ "name": "dantecode-install-smoke", "version": "1.0.0" }\n',
  );
  mkdirSync(projectDir, { recursive: true });

  const tarballs = publishablePackages.map((packagePath) => {
    const packageDir = join(repoRoot, packagePath);
    const result = spawnNpm(["pack", "--json", "--pack-destination", packDir], packageDir);
    const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    if (result.error) {
      throw new Error(
        [`npm pack failed for ${packagePath}`, result.error.message, combinedOutput.trim()]
          .filter(Boolean)
          .join("\n\n"),
      );
    }

    if (result.status !== 0) {
      throw new Error(
        [`npm pack failed for ${packagePath}`, combinedOutput.trim()].filter(Boolean).join("\n\n"),
      );
    }

    const entries = JSON.parse(result.stdout ?? "[]");
    const tarball = entries.at(-1)?.filename;

    if (!tarball) {
      throw new Error(`Could not find tarball name in npm pack output for ${packagePath}.`);
    }

    return join(packDir, tarball);
  });

  runNpm(["install", "--no-package-lock", ...tarballs], installRoot);

  const binWrapper = join(
    installRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "dantecode.cmd" : "dantecode",
  );
  if (!existsSync(binWrapper)) {
    throw new Error("Installed CLI bin wrapper was not created.");
  }

  const installedCliEntry = join(
    installRoot,
    "node_modules",
    "@dantecode",
    "cli",
    "dist",
    "index.js",
  );
  if (!existsSync(installedCliEntry)) {
    throw new Error("Installed CLI entry file was not found.");
  }

  const helpOutput = runNode([installedCliEntry, "--help"], projectDir);
  if (!helpOutput.includes("Portable Skill Runtime and Coding Agent")) {
    throw new Error("Installed CLI help output did not include the expected text.");
  }

  runNode([installedCliEntry, "init"], projectDir);

  const statePath = join(projectDir, ".dantecode", "STATE.yaml");
  if (!existsSync(statePath)) {
    throw new Error("Installed CLI did not initialize .dantecode/STATE.yaml.");
  }

  console.log("Install smoke check passed.");
  console.log(`Temporary install root: ${installRoot}`);
} finally {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(installRoot, { recursive: true, force: true });
}
