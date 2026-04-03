// ============================================================================
// @dantecode/danteforge-action - Main Entry Point
// TypeScript rewrite of run-verification.js with GitHub Actions SDK support,
// Check Run annotations, SARIF output, and configurable annotation modes.
// ============================================================================

import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFile, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  buildCheckRunAnnotations,
  buildPRReviewComments,
  parseAntiStubViolations,
} from "./annotations.js";
import type { AntiStubResult, PdseFileResult } from "./annotations.js";
import { createCheckRun, postPRComment, postPRReview } from "./github-api.js";

const execFileAsync = promisify(execFileCallback);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnnotationsMode = "pr-comment" | "check-run" | "both";

export interface PdseResults {
  averageScore: number | null;
  files: PdseFileResult[];
  failedFiles: PdseFileResult[];
  skipped: boolean;
  reason?: string;
}

export interface GStackResult {
  command: string;
  passed: boolean;
  output: string;
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine: number };
    };
  }>;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function run(): Promise<void> {
  const projectRoot = process.cwd();
  const pdseThreshold = Number(core.getInput("pdse-threshold") || "70");
  const failOnStub = core.getInput("fail-on-stub").toLowerCase() !== "false";
  const annotationsMode = (core.getInput("annotations-mode") || "both") as AnnotationsMode;
  const gstackCommands = core
    .getInput("gstack-commands")
    .split(/\r?\n/)
    .map((cmd) => cmd.trim())
    .filter(Boolean);

  // 1. Detect changed files
  const changedFiles = await detectChangedFiles(projectRoot);
  core.info(`Detected ${changedFiles.length} changed file(s).`);

  // 2. Run anti-stub check
  const antiStub = await runAntiStubCheck(projectRoot);
  core.info(`Anti-stub: ${antiStub.passed ? "PASS" : "FAIL"}`);

  // 3. Run PDSE checks
  const pdse = await runPdseChecks(projectRoot, changedFiles, pdseThreshold);
  if (pdse.skipped) {
    core.info(`PDSE: skipped${pdse.reason ? ` (${pdse.reason})` : ""}`);
  } else {
    core.info(`PDSE average: ${pdse.averageScore} (threshold ${pdseThreshold})`);
  }

  // 4. Run GStack commands
  const gstack = await runGStack(projectRoot, gstackCommands);

  // 5. Determine pass/fail
  const succeeded =
    (!failOnStub || antiStub.passed) &&
    pdse.failedFiles.length === 0 &&
    gstack.every((result) => result.passed);

  // 6. Build summary
  const summary = buildSummary({
    changedFiles,
    antiStub,
    pdse,
    gstack,
    pdseThreshold,
    succeeded,
  });

  // 7. Write GitHub Actions step summary
  core.summary.addRaw(summary);
  await core.summary.write();

  // 8. Set outputs
  core.setOutput("passed", String(succeeded));
  core.setOutput("pdse-average", String(pdse.averageScore ?? ""));
  core.setOutput("stub-count", String(antiStub.violations?.length ?? 0));
  core.setOutput("summary", summary);

  // 9. Annotations (Check Run + PR comments)
  await publishAnnotations(annotationsMode, antiStub, pdse, summary, succeeded);

  // 10. Write SARIF output
  await writeSarifReport(antiStub, pdse, projectRoot);

  // 11. Fail the action if checks did not pass
  if (!succeeded) {
    core.setFailed("DanteForge verification failed. See summary for details.");
  }
}

// ---------------------------------------------------------------------------
// Detect changed files
// ---------------------------------------------------------------------------

export async function detectChangedFiles(projectRoot: string): Promise<string[]> {
  const context = github.context;
  const baseSha = context.payload?.pull_request?.base?.sha as string | undefined;
  const headSha = context.payload?.pull_request?.head?.sha as string | undefined;

  const diffRange = baseSha && headSha ? `${baseSha}...${headSha}` : "HEAD~1...HEAD";
  try {
    const { stdout } = await execGit(["diff", "--name-only", diffRange], projectRoot);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Anti-stub check
// ---------------------------------------------------------------------------

export async function runAntiStubCheck(projectRoot: string): Promise<AntiStubResult> {
  const scriptPath = join(projectRoot, "scripts", "anti-stub-check.cjs");
  try {
    const { stdout, stderr } = await execNode([scriptPath], projectRoot);
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    return {
      passed: true,
      output,
      violations: [],
    };
  } catch (error: unknown) {
    const output = extractCommandOutput(error);
    return {
      passed: false,
      output,
      violations: parseAntiStubViolations(output),
    };
  }
}

// ---------------------------------------------------------------------------
// PDSE checks
// ---------------------------------------------------------------------------

const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/;

export async function runPdseChecks(
  projectRoot: string,
  changedFiles: string[],
  threshold: number,
): Promise<PdseResults> {
  const sourceFiles = changedFiles.filter((f) => SOURCE_FILE_PATTERN.test(f));
  if (sourceFiles.length === 0) {
    return {
      averageScore: null,
      files: [],
      failedFiles: [],
      skipped: true,
    };
  }

  let danteforge: { runLocalPDSEScorer: (code: string, root: string) => { overall: number } };
  try {
    danteforge = await import("@dantecode/danteforge");
  } catch {
    return {
      averageScore: null,
      files: [],
      failedFiles: [],
      skipped: true,
      reason: "Could not import @dantecode/danteforge in the action runtime.",
    };
  }

  const files: PdseFileResult[] = await Promise.all(
    sourceFiles.map(async (filePath) => {
      const absolutePath = join(projectRoot, filePath);
      const code = await readFile(absolutePath, "utf-8");
      const score = danteforge.runLocalPDSEScorer(code, projectRoot);
      return {
        filePath,
        overall: score.overall,
        passed: score.overall >= threshold,
      };
    }),
  );

  const averageScore =
    files.length === 0
      ? null
      : Math.round(files.reduce((total, file) => total + file.overall, 0) / files.length);

  return {
    averageScore,
    files,
    failedFiles: files.filter((file) => !file.passed),
    skipped: false,
  };
}

// ---------------------------------------------------------------------------
// GStack
// ---------------------------------------------------------------------------

export async function runGStack(projectRoot: string, commands: string[]): Promise<GStackResult[]> {
  const results: GStackResult[] = [];
  for (const command of commands) {
    try {
      await execShell(command, projectRoot);
      results.push({ command, passed: true, output: "" });
    } catch (error: unknown) {
      results.push({
        command,
        passed: false,
        output: extractCommandOutput(error),
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

interface SummaryInput {
  changedFiles: string[];
  antiStub: AntiStubResult;
  pdse: PdseResults;
  gstack: GStackResult[];
  pdseThreshold: number;
  succeeded: boolean;
}

export function buildSummary(input: SummaryInput): string {
  const { changedFiles, antiStub, pdse, gstack, pdseThreshold, succeeded } = input;

  const lines: string[] = [
    "# DanteForge Verification",
    "",
    `Status: ${succeeded ? "PASS" : "FAIL"}`,
    `Changed files: ${changedFiles.length}`,
    "",
    "## Anti-Stub",
    antiStub.passed ? "- Passed" : "- Failed",
    antiStub.output ? `- Output: ${truncate(antiStub.output, 600)}` : "- Output: none",
    "",
    "## PDSE",
    pdse.skipped
      ? `- Skipped${pdse.reason ? `: ${pdse.reason}` : " (no changed source files)"}`
      : `- Average score: ${pdse.averageScore} (threshold ${pdseThreshold})`,
  ];

  if (!pdse.skipped) {
    for (const file of pdse.files) {
      lines.push(`- ${file.filePath}: ${file.overall} (${file.passed ? "pass" : "fail"})`);
    }
  }

  lines.push("", "## GStack");
  if (gstack.length === 0) {
    lines.push("- Skipped (no commands configured)");
  } else {
    for (const result of gstack) {
      lines.push(`- ${result.command}: ${result.passed ? "pass" : "fail"}`);
      if (result.output) {
        lines.push(`  ${truncate(result.output, 400)}`);
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Annotation publishing
// ---------------------------------------------------------------------------

async function publishAnnotations(
  mode: AnnotationsMode,
  antiStub: AntiStubResult,
  pdse: PdseResults,
  summary: string,
  succeeded: boolean,
): Promise<void> {
  const token = core.getInput("github-token") || process.env["GITHUB_TOKEN"];
  if (!token) {
    core.warning("No GitHub token available -- skipping annotations.");
    return;
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const sha = github.context.sha;
  const pullNumber = github.context.payload?.pull_request?.number as number | undefined;

  const repoContext = { owner, repo, sha, pullNumber };
  const conclusion = succeeded ? "success" as const : "failure" as const;

  if (mode === "check-run" || mode === "both") {
    const annotations = buildCheckRunAnnotations(pdse, antiStub);
    await createCheckRun(octokit, repoContext, annotations, conclusion, summary);
  }

  if (mode === "pr-comment" || mode === "both") {
    await postPRComment(octokit, repoContext, summary);

    const reviewComments = buildPRReviewComments(pdse);
    if (reviewComments.length > 0) {
      await postPRReview(octokit, repoContext, reviewComments);
    }
  }
}

// ---------------------------------------------------------------------------
// SARIF report
// ---------------------------------------------------------------------------

async function writeSarifReport(
  antiStub: AntiStubResult,
  pdse: PdseResults,
  projectRoot: string,
): Promise<void> {
  const results: SarifResult[] = [];

  if (!antiStub.passed && antiStub.violations) {
    for (const violation of antiStub.violations) {
      results.push({
        ruleId: "danteforge/anti-stub",
        level: "error",
        message: { text: violation.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: violation.filePath },
              region: { startLine: violation.line },
            },
          },
        ],
      });
    }
  }

  if (!pdse.skipped) {
    for (const file of pdse.failedFiles) {
      results.push({
        ruleId: "danteforge/pdse-threshold",
        level: "warning",
        message: { text: `PDSE score ${file.overall} is below the required threshold.` },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: file.filePath },
              region: { startLine: file.line ?? 1 },
            },
          },
        ],
      });
    }
  }

  const sarif = {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0" as const,
    runs: [
      {
        tool: {
          driver: {
            name: "DanteForge",
            version: "1.0.0",
            informationUri: "https://github.com/dantecode/danteforge-action",
            rules: [
              {
                id: "danteforge/anti-stub",
                shortDescription: { text: "Stub implementation detected" },
                helpUri: "https://github.com/dantecode/danteforge-action#anti-stub",
              },
              {
                id: "danteforge/pdse-threshold",
                shortDescription: { text: "PDSE score below threshold" },
                helpUri: "https://github.com/dantecode/danteforge-action#pdse",
              },
            ],
          },
        },
        results,
      },
    ],
  };

  const outputPath = join(projectRoot, "danteforge-results.sarif");
  await writeFile(outputPath, JSON.stringify(sarif, null, 2), "utf-8");
  core.info(`SARIF report written to ${outputPath}`);
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

async function execGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function execNode(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function execShell(
  command: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  if (process.platform === "win32") {
    return execFileAsync("cmd.exe", ["/d", "/s", "/c", command], {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  return execFileAsync("bash", ["-lc", command], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function extractCommandOutput(error: unknown): string {
  const err = error as { stdout?: string; stderr?: string; message?: string } | undefined;
  const stderr = typeof err?.stderr === "string" ? err.stderr.trim() : "";
  const stdout = typeof err?.stdout === "string" ? err.stdout.trim() : "";
  return [stdout, stderr, err?.message].filter(Boolean).join("\n").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

// ---------------------------------------------------------------------------
// Bootstrap — guarded so that test imports do not trigger a real run.
// The ncc bundle entry point (index.ts) re-exports and calls run() directly.
// ---------------------------------------------------------------------------

const isTestEnv =
  typeof process.env["VITEST"] === "string" ||
  typeof process.env["JEST_WORKER_ID"] === "string";

if (!isTestEnv) {
  run().catch((error: unknown) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
  });
}
