// ============================================================================
// packages/cli/src/action-dispatcher.ts
//
// OpenHands-style typed Action/Observation dispatch.
// Maps tool calls from the AI SDK into structured Action objects, then
// executes them against the filesystem or shell.
// ============================================================================

import { execFile as execFileCb } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export type ActionType =
  | "cmd_run"
  | "file_read"
  | "file_edit"
  | "file_write"
  | "agent_finish"
  | "think"
  | "condense";

export interface CmdRunAction {
  type: "cmd_run";
  command: string;
  timeout?: number;
}

export interface FileReadAction {
  type: "file_read";
  path: string;
}

export interface FileEditAction {
  type: "file_edit";
  path: string;
  old_str: string;
  new_str: string;
}

export interface FileWriteAction {
  type: "file_write";
  path: string;
  content: string;
}

export interface AgentFinishAction {
  type: "agent_finish";
  outputs: Record<string, string>;
  thought: string;
}

export interface ThinkAction {
  type: "think";
  thought: string;
}

export interface CondenseAction {
  type: "condense";
  summary: string;
}

export type Action =
  | CmdRunAction
  | FileReadAction
  | FileEditAction
  | FileWriteAction
  | AgentFinishAction
  | ThinkAction
  | CondenseAction;

// ---------------------------------------------------------------------------
// Observation type
// ---------------------------------------------------------------------------

export interface Observation {
  type: "cmd_output" | "file_content" | "edit_result" | "error";
  content: string;
  exitCode?: number;
}

// ---------------------------------------------------------------------------
// ToolCall — minimal shape matching AI SDK output
// ---------------------------------------------------------------------------

export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// parseActionsFromToolCalls
// ---------------------------------------------------------------------------

/**
 * Convert an array of AI SDK ToolCall objects into typed Action objects.
 * Unknown tool names are silently skipped (not an error).
 */
export function parseActionsFromToolCalls(toolCalls: ToolCall[]): Action[] {
  const actions: Action[] = [];

  for (const call of toolCalls) {
    const { toolName, args } = call;

    if (toolName === "execute_bash") {
      actions.push({
        type: "cmd_run",
        command: args.command as string,
        ...(args.timeout !== undefined
          ? { timeout: args.timeout as number }
          : {}),
      });
      continue;
    }

    if (toolName === "str_replace_based_edit_tool") {
      const cmd = args.command as string;

      if (cmd === "str_replace") {
        actions.push({
          type: "file_edit",
          path: args.path as string,
          old_str: args.old_str as string,
          new_str: args.new_str as string,
        });
        continue;
      }

      if (cmd === "view") {
        actions.push({
          type: "file_read",
          path: args.path as string,
        });
        continue;
      }

      if (cmd === "create") {
        actions.push({
          type: "file_write",
          path: args.path as string,
          content: args.file_text as string,
        });
        continue;
      }

      // Unknown subcommand — skip
      continue;
    }

    if (toolName === "think") {
      actions.push({
        type: "think",
        thought: args.thought as string,
      });
      continue;
    }

    if (toolName === "finish") {
      actions.push({
        type: "agent_finish",
        outputs: (args.outputs as Record<string, string>) ?? {},
        thought: (args.thought as string) ?? "",
      });
      continue;
    }

    // Unknown tool name — skip
  }

  return actions;
}

// ---------------------------------------------------------------------------
// executeAction
// ---------------------------------------------------------------------------

/**
 * Execute a single Action and return an Observation.
 *
 * @param action       The action to execute.
 * @param projectRoot  Base directory for resolving relative file paths.
 * @param abortSignal  Optional AbortSignal to cancel in-flight commands.
 */
async function execCmdRun(
  action: CmdRunAction,
  abortSignal?: AbortSignal,
): Promise<Observation> {
  const timeoutMs = action.timeout ?? 30_000;
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "cmd.exe" : "bash";
  const shellFlag = isWindows ? "/c" : "-c";

  try {
    const { stdout } = await execFile(shell, [shellFlag, action.command], {
      timeout: timeoutMs,
      signal: abortSignal,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { type: "cmd_output", content: stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    };
    if (
      e.killed ||
      e.signal === "SIGTERM" ||
      e.code === "ETIMEDOUT" ||
      (e as { name?: string }).name === "AbortError"
    ) {
      return { type: "error", content: "Command timed out", exitCode: -1 };
    }
    const exitCode = typeof e.code === "number" ? e.code : e.code ? 1 : 1;
    return {
      type: "cmd_output",
      content: e.stderr || e.stdout || e.message || "",
      exitCode,
    };
  }
}

async function execFileRead(action: FileReadAction, projectRoot: string): Promise<Observation> {
  const filePath = resolve(projectRoot, action.path);
  try {
    const content = await readFile(filePath, "utf8");
    return { type: "file_content", content };
  } catch (err: unknown) {
    return { type: "error", content: (err as Error).message };
  }
}

async function execFileEdit(action: FileEditAction, projectRoot: string): Promise<Observation> {
  const filePath = resolve(projectRoot, action.path);
  try {
    const original = await readFile(filePath, "utf8");
    if (!original.includes(action.old_str)) {
      return { type: "error", content: `str_replace: old_str not found in ${action.path}` };
    }
    const updated = original.replace(action.old_str, action.new_str);
    await writeFile(filePath, updated, "utf8");
    return { type: "edit_result", content: `Applied edit to ${action.path}` };
  } catch (err: unknown) {
    return { type: "error", content: (err as Error).message };
  }
}

async function execFileWrite(action: FileWriteAction, projectRoot: string): Promise<Observation> {
  const filePath = resolve(projectRoot, action.path);
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, action.content, "utf8");
    return { type: "edit_result", content: `Created ${action.path}` };
  } catch (err: unknown) {
    return { type: "error", content: (err as Error).message };
  }
}

function execAgentFinish(action: AgentFinishAction): Observation {
  const content =
    action.thought ||
    (Object.keys(action.outputs).length > 0 ? JSON.stringify(action.outputs) : "");
  return { type: "cmd_output", content };
}

export async function executeAction(
  action: Action,
  projectRoot: string,
  abortSignal?: AbortSignal,
): Promise<Observation> {
  switch (action.type) {
    case "cmd_run":     return execCmdRun(action, abortSignal);
    case "file_read":   return execFileRead(action, projectRoot);
    case "file_edit":   return execFileEdit(action, projectRoot);
    case "file_write":  return execFileWrite(action, projectRoot);
    case "think":       return { type: "cmd_output", content: action.thought };
    case "condense":    return { type: "cmd_output", content: action.summary };
    case "agent_finish": return execAgentFinish(action);
  }
}
