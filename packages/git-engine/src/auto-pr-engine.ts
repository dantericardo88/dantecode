import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import {
  GitAutomationStore,
  type StoredAutoPRRecord,
} from "./automation-store.js";

export interface AutoPROptions {
  cwd?: string;
  base?: string;
  draft?: boolean;
  head?: string;
  labels?: string[];
  assignees?: string[];
  persist?: boolean;
  prId?: string;
  changesetFiles?: string[];
  runner?: AutoPRCommandRunner;
}

export interface PRResult {
  id: string;
  success: boolean;
  prUrl?: string;
  error?: string;
  command: string[];
  changesetFiles: string[];
}

export interface AutoPRCommandResult {
  stdout: string;
  stderr: string;
}

export type AutoPRCommandRunner = (
  args: string[],
  options: { cwd: string },
) => Promise<AutoPRCommandResult>;

export async function createAutoPR(
  title: string,
  body = "",
  options: AutoPROptions = {},
): Promise<PRResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const id = options.prId ?? randomUUID().slice(0, 12);
  const runner = options.runner ?? runGhCommand;
  const store = new GitAutomationStore(cwd);

  const baseRecord: StoredAutoPRRecord = {
    id,
    title,
    cwd,
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(options.base ? { base: options.base } : {}),
    draft: options.draft ?? false,
    changesetFiles: [...(options.changesetFiles ?? [])],
  };

  await persistRecord(store, baseRecord, options.persist);

  try {
    await runner(["--version"], { cwd });
  } catch {
    const error =
      "GitHub CLI (`gh`) is not available. Install it and run `gh auth login` before creating PRs.";
    await persistRecord(
      store,
      {
        ...baseRecord,
        status: "failed",
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error,
      },
      options.persist,
    );
    return {
      id,
      success: false,
      error,
      command: ["gh", "--version"],
      changesetFiles: [...(options.changesetFiles ?? [])],
    };
  }

  const args = buildCreateArgs(title, body, options);

  try {
    const result = await runner(args, { cwd });
    const prUrl = parsePullRequestUrl(result.stdout, result.stderr);
    await persistRecord(
      store,
      {
        ...baseRecord,
        status: "completed",
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        ...(prUrl ? { prUrl } : {}),
      },
      options.persist,
    );
    return {
      id,
      success: true,
      ...(prUrl ? { prUrl } : {}),
      command: ["gh", ...args],
      changesetFiles: [...(options.changesetFiles ?? [])],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await persistRecord(
      store,
      {
        ...baseRecord,
        status: "failed",
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: message,
      },
      options.persist,
    );
    return {
      id,
      success: false,
      error: message,
      command: ["gh", ...args],
      changesetFiles: [...(options.changesetFiles ?? [])],
    };
  }
}

function buildCreateArgs(title: string, body: string, options: AutoPROptions): string[] {
  const args = ["pr", "create", "--title", title, "--body", body];

  if (options.base) {
    args.push("--base", options.base);
  }
  if (options.head) {
    args.push("--head", options.head);
  }
  if (options.draft) {
    args.push("--draft");
  }
  for (const label of options.labels ?? []) {
    args.push("--label", label);
  }
  for (const assignee of options.assignees ?? []) {
    args.push("--assignee", assignee);
  }

  return args;
}

async function runGhCommand(
  args: string[],
  options: { cwd: string },
): Promise<AutoPRCommandResult> {
  return new Promise<AutoPRCommandResult>((resolve, reject) => {
    const child = spawn("gh", args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error([stdout.trim(), stderr.trim()].filter(Boolean).join("\n")));
    });
  });
}

function parsePullRequestUrl(stdout: string, stderr: string): string | undefined {
  const combined = `${stdout}\n${stderr}`;
  const match = combined.match(/https:\/\/github\.com\/[^\s]+/);
  return match?.[0];
}

async function persistRecord(
  store: GitAutomationStore,
  record: StoredAutoPRRecord,
  persist: boolean | undefined,
): Promise<void> {
  if (persist === false) {
    return;
  }
  await store.upsertAutoPullRequest(record);
}
