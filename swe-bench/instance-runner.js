import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCallback);

export async function runSWEBenchInstance(instance, modelConfig, options = {}) {
  const startedAt = Date.now();
  const workspaceDir = options.workspaceDir ?? (await mkdtemp(join(tmpdir(), "dantecode-swe-")));
  const cleanupWorkspace = !options.workspaceDir;

  try {
    await cloneInstanceRepo(instance, workspaceDir);

    const agentResult = options.runAgent
      ? await options.runAgent({ instance, workspaceDir, modelConfig })
      : { patch: "", notes: "No agent callback provided." };

    const patchApplied = await applyPatch(agentResult.patch ?? "", workspaceDir);
    const verification = options.useAutoforge && options.verifyCommand
      ? await runShell(options.verifyCommand, workspaceDir).then(
          ({ stdout }) => ({ passed: true, output: stdout }),
          (error) => ({ passed: false, output: extractOutput(error) }),
        )
      : { passed: true, output: "" };

    const testsPassed = await runShell(instance.testCommand, workspaceDir).then(
      () => true,
      () => false,
    );

    return {
      instanceId: instance.id,
      patchApplied,
      testsPassed: testsPassed && verification.passed,
      verification,
      durationMs: Date.now() - startedAt,
      workspaceDir,
      notes: agentResult.notes ?? "",
    };
  } finally {
    if (cleanupWorkspace) {
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function cloneInstanceRepo(instance, workspaceDir) {
  await runCommand("git", ["clone", "--depth", "1", instance.repo, workspaceDir], process.cwd());
  if (instance.baseSha) {
    await runCommand("git", ["fetch", "--depth", "1", "origin", instance.baseSha], workspaceDir);
    await runCommand("git", ["checkout", instance.baseSha], workspaceDir);
  }
}

async function applyPatch(patch, workspaceDir) {
  if (!patch || patch.trim().length === 0) {
    return false;
  }

  try {
    await runShell(`git apply --whitespace=nowarn - <<'PATCH'\n${patch}\nPATCH`, workspaceDir);
    return true;
  } catch {
    return false;
  }
}

async function runShell(command, cwd) {
  if (process.platform === "win32") {
    return runCommand("cmd.exe", ["/d", "/s", "/c", command], cwd);
  }

  return runCommand("bash", ["-lc", command], cwd);
}

async function runCommand(command, args, cwd) {
  return execFileAsync(command, args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function extractOutput(error) {
  return [error?.stdout, error?.stderr, error?.message].filter(Boolean).join("\n");
}
