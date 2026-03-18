import { appendFile, readFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCallback);

async function main() {
  const projectRoot = process.cwd();
  const pdseThreshold = Number(process.env.INPUT_PDSE_THRESHOLD || "70");
  const failOnStub = (process.env.INPUT_FAIL_ON_STUB || "true").toLowerCase() !== "false";
  const gstackCommands = (process.env.INPUT_GSTACK_COMMANDS || "")
    .split(/\r?\n/)
    .map((command) => command.trim())
    .filter(Boolean);

  const changedFiles = await detectChangedFiles(projectRoot);
  const antiStub = await runAntiStubCheck(projectRoot);
  const pdse = await runPdseChecks(projectRoot, changedFiles, pdseThreshold);
  const gstack = await runGStack(projectRoot, gstackCommands);

  const succeeded =
    (!failOnStub || antiStub.passed) &&
    pdse.failedFiles.length === 0 &&
    gstack.every((result) => result.passed);

  const summary = buildSummary({
    changedFiles,
    antiStub,
    pdse,
    gstack,
    pdseThreshold,
    succeeded,
  });

  await writeStepSummary(summary);
  await postPullRequestComment(summary);

  if (!succeeded) {
    process.exitCode = 1;
  }
}

async function detectChangedFiles(projectRoot) {
  const event = await readGithubEvent();
  const baseSha = event?.pull_request?.base?.sha;
  const headSha = event?.pull_request?.head?.sha;

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

async function runAntiStubCheck(projectRoot) {
  const scriptPath = join(projectRoot, "scripts", "anti-stub-check.cjs");
  try {
    const { stdout, stderr } = await execNode([scriptPath], projectRoot);
    return {
      passed: true,
      output: [stdout, stderr].filter(Boolean).join("\n").trim(),
    };
  } catch (error) {
    return {
      passed: false,
      output: extractCommandOutput(error),
    };
  }
}

async function runPdseChecks(projectRoot, changedFiles, threshold) {
  const sourceFiles = changedFiles.filter((filePath) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/.test(filePath));
  if (sourceFiles.length === 0) {
    return {
      averageScore: null,
      files: [],
      failedFiles: [],
      skipped: true,
    };
  }

  let danteforge;
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

  const files = await Promise.all(
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

async function runGStack(projectRoot, commands) {
  const results = [];
  for (const command of commands) {
    try {
      await execShell(command, projectRoot);
      results.push({ command, passed: true, output: "" });
    } catch (error) {
      results.push({
        command,
        passed: false,
        output: extractCommandOutput(error),
      });
    }
  }
  return results;
}

function buildSummary({ changedFiles, antiStub, pdse, gstack, pdseThreshold, succeeded }) {
  const lines = [
    "# DanteForge Verification",
    "",
    `Status: ${succeeded ? "PASS" : "FAIL"}`,
    `Changed files: ${changedFiles.length || 0}`,
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

async function postPullRequestComment(body) {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const event = await readGithubEvent();
  const issueNumber = event?.pull_request?.number;

  if (!token || !repository || !issueNumber) {
    return;
  }

  await fetch(`https://api.github.com/repos/${repository}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ body }),
  }).catch(() => undefined);
}

async function writeStepSummary(summary) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }
  await appendFile(summaryPath, `${summary}\n`, "utf-8");
}

async function readGithubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return null;
  }

  try {
    const raw = await readFile(eventPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function execGit(args, cwd) {
  return execFileAsync("git", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function execNode(args, cwd) {
  return execFileAsync(process.execPath, args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function execShell(command, cwd) {
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

function extractCommandOutput(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
  return [stdout, stderr, error?.message].filter(Boolean).join("\n").trim();
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

await main();
