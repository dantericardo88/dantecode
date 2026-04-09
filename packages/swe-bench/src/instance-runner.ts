import { exec as execCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SWEBenchInstance } from "./dataset-loader.js";

export interface RunnerOptions {
  dockerImage?: string;
  timeout?: number;
  workDir?: string;
}

export interface RunResult {
  instanceId: string;
  status: "resolved" | "failed" | "error" | "timeout";
  testOutput?: string;
  patchApplied: boolean;
  durationMs: number;
}

const DEFAULT_DOCKER_IMAGE = "python:3.11-slim";
const DEFAULT_TIMEOUT = 300_000; // 5 minutes

/**
 * Run a single SWE-bench instance inside a Docker container.
 *
 * Steps:
 *   1. Create a temp dir, write the candidate patch and test patch to files
 *   2. Build a Docker run command that clones the repo at baseSha,
 *      applies the candidate patch, applies the test patch, and runs pytest
 *   3. Parse the exit code and stdout/stderr to determine status
 */
export async function runInstance(
  instance: SWEBenchInstance,
  patch: string,
  options?: RunnerOptions,
): Promise<RunResult> {
  const startTime = Date.now();
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const dockerImage = options?.dockerImage ?? DEFAULT_DOCKER_IMAGE;
  const workDir =
    options?.workDir ?? (await mkdtemp(join(tmpdir(), "swe-bench-")));
  const shouldCleanup = !options?.workDir;

  try {
    // Write patches to temp files so they can be mounted into Docker
    const candidatePatchPath = join(workDir, "candidate.patch");
    const testPatchPath = join(workDir, "test.patch");
    await writeFile(candidatePatchPath, patch, "utf-8");
    await writeFile(testPatchPath, instance.testPatch, "utf-8");

    // Build the shell script that runs inside the container
    const innerScript = buildInnerScript(instance);

    // Build Docker command
    const dockerCmd = [
      "docker",
      "run",
      "--rm",
      "--network=host",
      `-v`,
      `${candidatePatchPath}:/tmp/candidate.patch:ro`,
      `-v`,
      `${testPatchPath}:/tmp/test.patch:ro`,
      `-w`,
      `/workspace`,
      dockerImage,
      "bash",
      "-c",
      innerScript,
    ].join(" ");

    const result = await execWithTimeout(dockerCmd, timeout, workDir);

    const elapsed = Date.now() - startTime;
    const testsPassed = result.exitCode === 0;

    return {
      instanceId: instance.instanceId,
      status: testsPassed ? "resolved" : "failed",
      testOutput: result.output,
      patchApplied: !result.output.includes("PATCH_APPLY_FAILED"),
      durationMs: elapsed,
    };
  } catch (err: unknown) {
    const elapsed = Date.now() - startTime;
    const isTimeout =
      err instanceof Error && err.message.includes("TIMEOUT_EXCEEDED");

    return {
      instanceId: instance.instanceId,
      status: isTimeout ? "timeout" : "error",
      testOutput: err instanceof Error ? err.message : String(err),
      patchApplied: false,
      durationMs: elapsed,
    };
  } finally {
    if (shouldCleanup) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {
        /* best-effort cleanup */
      });
    }
  }
}

/**
 * Run a single SWE-bench instance locally without Docker.
 * Useful for testing and development.
 */
export async function runInstanceLocal(
  instance: SWEBenchInstance,
  patch: string,
  _workDir?: string,
): Promise<RunResult> {
  const startTime = Date.now();

  // Normalize repo slug to full GitHub URL (mirrors buildInnerScript logic)
  const repoUrl = instance.repo.includes("://")
    ? instance.repo
    : `https://github.com/${instance.repo}.git`;

  // Create a per-instance temp subdir so sequential instances don't collide
  const instanceDir = await mkdtemp(join(tmpdir(), `swe-local-${instance.instanceId.slice(-8)}-`));
  const shouldCleanup = true;

  try {
    // Step 1: Clone the repo at baseSha
    await execInDir(
      `git clone --depth 1 ${repoUrl} repo`,
      instanceDir,
    );

    const repoDir = join(instanceDir, "repo");

    if (instance.baseSha) {
      await execInDir(
        `git fetch --depth 1 origin ${instance.baseSha}`,
        repoDir,
      );
      await execInDir(`git checkout ${instance.baseSha}`, repoDir);
    }

    // Step 2: Apply the candidate patch
    let patchApplied = false;
    if (patch.trim().length > 0) {
      const patchFile = join(instanceDir, "candidate.patch");
      await writeFile(patchFile, patch, "utf-8");
      try {
        await execInDir(
          `git apply --whitespace=nowarn ${patchFile}`,
          repoDir,
        );
        patchApplied = true;
      } catch {
        // Patch failed to apply
        return {
          instanceId: instance.instanceId,
          status: "failed",
          testOutput: "Candidate patch failed to apply",
          patchApplied: false,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Step 3: Apply the test patch
    if (instance.testPatch.trim().length > 0) {
      const testPatchFile = join(instanceDir, "test.patch");
      await writeFile(testPatchFile, instance.testPatch, "utf-8");
      try {
        await execInDir(
          `git apply --whitespace=nowarn ${testPatchFile}`,
          repoDir,
        );
      } catch {
        return {
          instanceId: instance.instanceId,
          status: "error",
          testOutput: "Test patch failed to apply",
          patchApplied,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Step 3.5: Install project dependencies (mirrors Docker script)
    try {
      await execInDir(
        'pip install -e ".[test,dev]" 2>/dev/null || pip install -e . 2>/dev/null || pip install -e . || true',
        repoDir,
      );
    } catch {
      // Best-effort; some repos don't need install to run tests
    }

    // Step 4: Run the test command
    try {
      const testResult = await execInDir(
        "python -m pytest --tb=short -q",
        repoDir,
      );

      // Step 5: Parse test output to determine pass/fail
      const output = testResult.stdout + "\n" + testResult.stderr;
      const passed =
        testResult.exitCode === 0 && !output.includes("FAILED");

      return {
        instanceId: instance.instanceId,
        status: passed ? "resolved" : "failed",
        testOutput: output,
        patchApplied,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      return {
        instanceId: instance.instanceId,
        status: "error",
        testOutput: err instanceof Error ? err.message : String(err),
        patchApplied,
        durationMs: Date.now() - startTime,
      };
    }
  } catch (err: unknown) {
    return {
      instanceId: instance.instanceId,
      status: "error",
      testOutput: err instanceof Error ? err.message : String(err),
      patchApplied: false,
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (shouldCleanup) {
      await rm(instanceDir, { recursive: true, force: true }).catch(() => {
        /* best-effort cleanup */
      });
    }
  }
}

// ---- internal helpers ----

function buildInnerScript(instance: SWEBenchInstance): string {
  const cloneUrl = instance.repo.includes("://")
    ? instance.repo
    : `https://github.com/${instance.repo}.git`;

  const lines = [
    `set -e`,
    `git clone --depth 1 "${cloneUrl}" /workspace/repo`,
    `cd /workspace/repo`,
  ];

  if (instance.baseSha) {
    lines.push(
      `git fetch --depth 1 origin ${instance.baseSha}`,
      `git checkout ${instance.baseSha}`,
    );
  }

  // Apply candidate patch
  lines.push(
    `if ! git apply --whitespace=nowarn /tmp/candidate.patch 2>/dev/null; then`,
    `  echo "PATCH_APPLY_FAILED"`,
    `  exit 1`,
    `fi`,
  );

  // Apply test patch
  lines.push(`git apply --whitespace=nowarn /tmp/test.patch`);

  // Install deps and run tests
  lines.push(
    `pip install -e ".[test,dev]" 2>/dev/null || pip install -e . 2>/dev/null || true`,
    `python -m pytest --tb=short -q`,
  );

  return lines.join(" && ");
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  output: string;
}

async function execWithTimeout(
  cmd: string,
  timeout: number,
  cwd: string,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = execCallback(
      cmd,
      {
        cwd,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout,
      },
      (error, stdout, stderr) => {
        if (error && "killed" in error && error.killed) {
          reject(new Error("TIMEOUT_EXCEEDED"));
          return;
        }

        const exitCode =
          error && "code" in error && typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;

        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode,
          output: `${stdout ?? ""}\n${stderr ?? ""}`.trim(),
        });
      },
    );

    // Safety: ensure the child is cleaned up on timeout
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeout + 5000);

    child.on("close", () => {
      clearTimeout(timer);
    });
  });
}

async function execInDir(
  cmd: string,
  cwd: string,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execCallback(
      cmd,
      {
        cwd,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode =
          error && "code" in error && typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;

        if (error && exitCode !== 0) {
          const enrichedError = new Error(
            `Command failed: ${cmd}\n${stdout}\n${stderr}`,
          );
          reject(enrichedError);
          return;
        }

        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode,
          output: `${stdout ?? ""}\n${stderr ?? ""}`.trim(),
        });
      },
    );
  });
}
