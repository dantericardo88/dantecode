// ============================================================================
// DanteCode VS Code Extension - AI SDK Tool Schemas
// ============================================================================

import { z } from "zod";

export interface ToolSchema {
  description: string;
  parameters: z.ZodTypeAny;
}

export function getAISDKTools(): Record<string, ToolSchema> {
  return {
    InvalidTool: {
      description: "Internal repair target for malformed tool calls. Do not call directly.",
      parameters: z.object({
        tool: z.string().describe("The invalid tool name that was requested"),
        error: z.string().describe("The tool validation error"),
      }),
    },
    Read: {
      description: "Read a file from disk. Returns content with line numbers.",
      parameters: z.object({
        file_path: z.string(),
        offset: z.number().optional(),
        limit: z.number().optional(),
      }),
    },
    Write: {
      description: "Write content to a file, creating parent directories as needed.",
      parameters: z.object({
        file_path: z.string(),
        content: z.string(),
      }),
    },
    Edit: {
      description: "Perform an exact string replacement in a file.",
      parameters: z.object({
        file_path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
      }),
    },
    ListDir: {
      description: "List directory contents.",
      parameters: z.object({
        path: z.string(),
      }),
    },
    Bash: {
      description: "Execute a shell command and return stdout/stderr.",
      parameters: z.object({
        command: z.string(),
        timeout: z.number().optional(),
      }),
    },
    Glob: {
      description: "Find files matching a glob pattern.",
      parameters: z.object({
        pattern: z.string(),
        path: z.string().optional(),
      }),
    },
    Grep: {
      description: "Search file contents for a regex pattern.",
      parameters: z.object({
        pattern: z.string(),
        path: z.string().optional(),
        "-i": z.boolean().optional(),
        head_limit: z.number().optional(),
      }),
    },
    SelfUpdate: {
      description: "Run DanteCode self-update or self-deploy. Use action='deploy' to rebuild and reinstall from source when you've edited the DanteCode extension source code.",
      parameters: z.object({
        action: z.enum(["update", "deploy", "status"]).optional(),
        dryRun: z.boolean().optional(),
      }),
    },
    GitCommit: {
      description: "Stage files and create a git commit with a message.",
      parameters: z.object({
        message: z.string(),
        files: z.array(z.string()).optional(),
      }),
    },
    GitPush: {
      description: "Push a branch to a remote.",
      parameters: z.object({
        remote: z.string().optional(),
        branch: z.string().optional(),
        set_upstream: z.boolean().optional(),
      }),
    },
  };
}
