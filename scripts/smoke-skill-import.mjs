import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const cliEntry = join(repoRoot, "packages", "cli", "dist", "index.js");
const fixtureSkill = join(repoRoot, "tests", "fixtures", "sample-claude-skill.md");
const importedSkillSlug = "sample-refactor-skill";

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

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-9;]*m/g, "");
}

if (!existsSync(cliEntry)) {
  throw new Error(`Built CLI entry not found at ${cliEntry}. Run "npm run build" first.`);
}

if (!existsSync(fixtureSkill)) {
  throw new Error(`Fixture skill not found at ${fixtureSkill}.`);
}

const tempProject = mkdtempSync(join(tmpdir(), "dantecode-skill-import-smoke-"));

try {
  runNode([cliEntry, "init"], tempProject);

  const importOutput = stripAnsi(
    runNode([cliEntry, "skills", "import", "--file", fixtureSkill], tempProject),
  );
  if (
    !importOutput.includes("Imported skill:") ||
    !importOutput.includes("Sample Refactor Skill")
  ) {
    throw new Error("Skill import output did not include the expected skill name.");
  }

  const wrappedSkillPath = join(
    tempProject,
    ".dantecode",
    "skills",
    importedSkillSlug,
    "SKILL.dc.md",
  );
  if (!existsSync(wrappedSkillPath)) {
    throw new Error("Wrapped skill file was not created in .dantecode/skills.");
  }

  const wrappedSkillContent = readFileSync(wrappedSkillPath, "utf8");
  if (!wrappedSkillContent.includes("DANTEFORGE PREAMBLE")) {
    throw new Error("Wrapped skill file is missing the DanteForge preamble.");
  }
  if (!wrappedSkillContent.includes("DANTEFORGE POSTAMBLE")) {
    throw new Error("Wrapped skill file is missing the DanteForge postamble.");
  }

  const listOutput = stripAnsi(runNode([cliEntry, "skills", "list"], tempProject));
  if (!listOutput.includes("Sample Refactor Skill")) {
    throw new Error("Imported skill did not appear in the registry listing.");
  }

  const validateOutput = stripAnsi(
    runNode([cliEntry, "skills", "validate", importedSkillSlug], tempProject),
  );
  if (!/Overall:\s+PASSED/.test(validateOutput)) {
    throw new Error("Imported skill validation did not pass.");
  }

  console.log("Skill import smoke check passed.");
  console.log(`Temporary project: ${tempProject}`);
} finally {
  rmSync(tempProject, { recursive: true, force: true });
}
