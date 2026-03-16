import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const cliEntry = join(repoRoot, "packages", "cli", "dist", "index.js");

function runNode(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(
      [`Command failed: node ${args.join(" ")}`, result.stdout?.trim(), result.stderr?.trim()]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

if (!existsSync(cliEntry)) {
  throw new Error(`Built CLI entry not found at ${cliEntry}. Run "npm run build" first.`);
}

const tempProject = mkdtempSync(join(tmpdir(), "dantecode-cli-smoke-"));

try {
  const helpOutput = runNode([cliEntry, "--help"], repoRoot);
  if (!helpOutput.includes("Portable Skill Runtime and Coding Agent")) {
    throw new Error("CLI help output did not include the updated product description.");
  }

  runNode([cliEntry, "init"], tempProject);

  const statePath = join(tempProject, ".dantecode", "STATE.yaml");
  if (!existsSync(statePath)) {
    throw new Error("CLI init did not create .dantecode/STATE.yaml.");
  }

  const stateContent = readFileSync(statePath, "utf8");
  if (!stateContent.includes("projectRoot:")) {
    throw new Error("Generated STATE.yaml does not look valid.");
  }

  const configOutput = runNode([cliEntry, "config", "show"], tempProject);
  if (!configOutput.includes(".dantecode/STATE.yaml")) {
    throw new Error("Config show did not report the canonical STATE.yaml path.");
  }

  runNode([cliEntry, "skills", "list"], tempProject);

  console.log("CLI smoke check passed.");
  console.log(`Temporary project: ${tempProject}`);
} finally {
  rmSync(tempProject, { recursive: true, force: true });
}
