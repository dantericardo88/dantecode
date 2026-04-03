/**
 * Automated score measurement with same-repo evidence and external manifests.
 * Run via: npm run measure:scores
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { spawnNpm } from "./npm-runner.mjs";
import {
  ensureBuildArtifacts,
  getCatalogPackageById,
  getCiConfig,
  getScoringEvidenceConfig,
} from "./release/catalog.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const scoringEvidence = getScoringEvidenceConfig(repoRoot);
const scoringRoot = resolve(repoRoot, scoringEvidence.root ?? "artifacts/scoring");

mkdirSync(scoringRoot, { recursive: true });

const measurements = [];
let passed = 0;
let failed = 0;

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-9;]*m/g, "");
}

function readManifest(pathKey, fallback) {
  const filePath = resolve(repoRoot, scoringEvidence.manifests?.[pathKey] ?? fallback);
  try {
    return { path: filePath, data: JSON.parse(readFileSync(filePath, "utf8")) };
  } catch {
    return { path: filePath, data: null };
  }
}

function measure(id, name, fn) {
  try {
    const result = fn();
    console.log(`  PASS  ${id} ${name}: ${result.evidence} -> score ${result.score}`);
    passed += 1;
    measurements.push({ id, name, ...result, status: "pass" });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  FAIL  ${id} ${name}: ${message}`);
    failed += 1;
    measurements.push({ id, name, score: 0, evidence: message, status: "fail" });
    return null;
  }
}

async function renderHelpEvidence() {
  ensureBuildArtifacts(repoRoot, [getCatalogPackageById(repoRoot, "cli")], { log: false });

  const tempProject = mkdtempSync(join(tmpdir(), "dantecode-score-help-"));
  try {
    const cliModule = await import(
      `${pathToFileURL(join(repoRoot, "packages", "cli", "dist", "slash-commands.js")).href}?v=${Date.now()}`
    );

    const { routeSlashCommand, getSlashCommandsMeta } = cliModule;
    const message = {
      id: "m1",
      role: "user",
      content: "show help",
      timestamp: new Date().toISOString(),
    };
    const state = {
      projectRoot: tempProject,
      session: {
        id: "score-help",
        projectRoot: tempProject,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [message],
        activeFiles: [],
        readOnlyFiles: [],
        model: {
          provider: "grok",
          modelId: "grok-3",
          maxTokens: 256,
          temperature: 0,
          contextWindow: 131072,
          supportsVision: false,
          supportsToolCalls: true,
        },
        agentStack: [],
        todoList: [],
      },
      state: {
        progressiveDisclosure: { unlocked: false },
      },
    };

    const helpOutput = stripAnsi(await routeSlashCommand("/help", state));
    const allHelpOutput = stripAnsi(await routeSlashCommand("/help --all", state));
    const totalCommands = getSlashCommandsMeta().length;

    const lines = helpOutput.split(/\r?\n/).map((line) => line.trimEnd());
    const commandsHeaderIndex = lines.findIndex((line) => line.trim() === "Commands");
    if (commandsHeaderIndex === -1) {
      throw new Error("Could not find the Commands section in /help output.");
    }

    const visibleCommands = [];
    for (const line of lines.slice(commandsHeaderIndex + 1)) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        if (visibleCommands.length > 0) {
          break;
        }
        continue;
      }
      if (trimmed.startsWith("/")) {
        visibleCommands.push(trimmed.split(/\s+/)[0]);
      }
    }

    if (visibleCommands.length === 0) {
      throw new Error("No default commands were detected in /help output.");
    }

    const allDisplayedCommands = allHelpOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("/"))
      .map((line) => line.split(/\s+/)[0]);

    return {
      defaultCommands: visibleCommands,
      defaultCount: visibleCommands.length,
      totalCount: Math.max(totalCommands, allDisplayedCommands.length),
    };
  } finally {
    rmSync(tempProject, { recursive: true, force: true });
  }
}

console.log("DanteCode Score Measurement Report");
console.log("===================================\n");
console.log(`Generated: ${new Date().toISOString()}\n`);

measure("A-1", "Test Suite", () => {
  const result = spawnNpm(["test"], repoRoot);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const passMatches = [...output.matchAll(/(\d+)\s+passed/g)];
  const totalPassed = passMatches.reduce((sum, match) => sum + Number(match[1] ?? 0), 0);
  const failMatch = output.match(/(\d+)\s+failed/);
  const failures = failMatch ? Number(failMatch[1]) : 0;

  if (result.status !== 0) {
    throw new Error(`test failed (exit ${result.status})`);
  }
  if (totalPassed === 0) {
    throw new Error("No passing test count found in test output.");
  }

  const score =
    totalPassed >= 500 && failures === 0 ? 10 : totalPassed >= 250 && failures === 0 ? 9 : 8;
  return { score, evidence: `${totalPassed} passing tests, ${failures} failures` };
});

measure("A-2", "Type Safety", () => {
  const result = spawnNpm(["run", "typecheck"], repoRoot);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const taskMatch = output.match(/Tasks:\s+(\d+)\s+successful,\s+(\d+)\s+total/);
  if (result.status !== 0) {
    throw new Error(`Typecheck failed (exit ${result.status})`);
  }
  const evidence = taskMatch
    ? `${taskMatch[1]}/${taskMatch[2]} packages clean`
    : "typecheck passed";
  return { score: 10, evidence };
});

const helpEvidence = await (async () => {
  try {
    return await renderHelpEvidence();
  } catch (error) {
    measurements.push({
      id: "C-3/C-6",
      name: "Help runtime measurement",
      score: 0,
      evidence: error instanceof Error ? error.message : String(error),
      status: "fail",
    });
    throw error;
  }
})();

measure("C-3", "Help Discoverability", () => {
  const score =
    helpEvidence.defaultCount >= 8 && helpEvidence.defaultCount <= 15
      ? 10
      : helpEvidence.defaultCount <= 18
        ? 8
        : 6;
  return {
    score,
    evidence: `${helpEvidence.defaultCount} commands shown by default in /help (${helpEvidence.totalCount} total)`,
  };
});

measure("C-6", "Command Surface Ratio", () => {
  const ratio =
    helpEvidence.totalCount > 0 ? helpEvidence.defaultCount / helpEvidence.totalCount : 1;
  const score = ratio <= 0.18 ? 10 : ratio <= 0.25 ? 9 : ratio <= 0.3 ? 8 : 6;
  return {
    score,
    evidence: `${helpEvidence.defaultCount}/${helpEvidence.totalCount} = ${ratio.toFixed(3)}`,
  };
});

measure("C-1", "Docs Time To Value", () => {
  const manifest = readManifest("docsTimeToValue", "artifacts/scoring/docs-time-to-value.json");
  const medianMinutes = Number(manifest.data?.medianMinutes ?? 0);
  const sampleSize = Number(manifest.data?.sampleSize ?? 0);
  if (sampleSize <= 0) {
    return {
      score: 0,
      evidence: `no stopwatch evidence recorded in ${manifest.path}`,
    };
  }
  const score =
    medianMinutes <= 5
      ? 10
      : medianMinutes <= 8
        ? 9
        : medianMinutes <= 10
          ? 8
          : medianMinutes <= 15
            ? 6
            : 4;
  return { score, evidence: `median ${medianMinutes} minutes across ${sampleSize} trial(s)` };
});

measure("D-1", "Install Success Rate", () => {
  const result = spawnNpm(["run", "smoke:install"], repoRoot);
  if (result.status !== 0) {
    throw new Error("smoke:install failed");
  }
  return { score: 10, evidence: "smoke:install passed" };
});

measure("D-2", "External Users", () => {
  const manifest = readManifest("externalUsers", "artifacts/scoring/external-users.json");
  const sessions = Number(manifest.data?.successfulSessions ?? 0);
  const source = String(manifest.data?.source ?? "manual manifest");
  const score =
    sessions >= 100 ? 10 : sessions >= 50 ? 8 : sessions >= 10 ? 6 : sessions >= 1 ? 4 : 0;
  return { score, evidence: `${sessions} successful external sessions (${source})` };
});

measure("D-3", "Skill Ecosystem", () => {
  const manifest = readManifest("skillEcosystem", "artifacts/scoring/skill-ecosystem.json");
  const skills = Number(manifest.data?.thirdPartySkillCount ?? 0);
  const source = String(manifest.data?.source ?? "manual manifest");
  const score = skills >= 100 ? 10 : skills >= 50 ? 8 : skills >= 10 ? 6 : skills >= 1 ? 4 : 0;
  return { score, evidence: `${skills} importable third-party skills (${source})` };
});

measure("D-4", "CI Integration", () => {
  const ciConfig = getCiConfig(repoRoot);
  const found = [];
  if (readFileSync(resolve(repoRoot, ".github", "workflows", "ci.yml"), "utf8")) {
    found.push("GitHub Actions");
  }
  try {
    if (readFileSync(resolve(repoRoot, ".gitlab-ci.yml"), "utf8")) {
      found.push("GitLab CI");
    }
  } catch {}
  try {
    if (readFileSync(resolve(repoRoot, ".circleci", "config.yml"), "utf8")) {
      found.push("CircleCI");
    }
  } catch {}

  const score = found.length >= 3 ? 10 : found.length === 2 ? 8 : found.length === 1 ? 6 : 0;
  return {
    score,
    evidence: `${found.length}/${ciConfig.platforms?.length ?? found.length} configured platforms: ${found.join(", ")}`,
  };
});

const categoryScores = {
  A: measurements.filter((item) => item.id.startsWith("A-")),
  C: measurements.filter((item) => item.id.startsWith("C-")),
  D: measurements.filter((item) => item.id.startsWith("D-")),
};

const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    passed,
    failed,
    total: passed + failed,
    scoreA:
      categoryScores.A.reduce((sum, item) => sum + item.score, 0) /
      Math.max(categoryScores.A.length, 1),
    scoreC:
      categoryScores.C.reduce((sum, item) => sum + item.score, 0) /
      Math.max(categoryScores.C.length, 1),
    scoreD:
      categoryScores.D.reduce((sum, item) => sum + item.score, 0) /
      Math.max(categoryScores.D.length, 1),
  },
  measurements,
};

writeFileSync(
  join(scoringRoot, "current-score-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} measurements`);
console.log(`Score report: ${join(scoringRoot, "current-score-report.json")}`);

if (failed > 0) {
  process.exitCode = 1;
}
