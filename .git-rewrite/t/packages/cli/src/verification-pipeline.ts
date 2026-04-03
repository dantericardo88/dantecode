// ============================================================================
// @dantecode/cli — Verification Pipeline
// Verification helpers, major-edit gating, evidence building, and utility
// functions. Extracted from agent-loop.ts for maintainability.
// ============================================================================

import { randomUUID } from "node:crypto";
import { isProtectedWriteTarget, estimateMessageTokens } from "@dantecode/core";
import type { ExecutionEvidence, ModelConfig, DanteCodeState } from "@dantecode/config-types";
import { executeTool } from "./tools.js";

// ----------------------------------------------------------------------------
// Verification Helpers
// ----------------------------------------------------------------------------

/**
 * Returns the project's configured verification commands (lint, test, build).
 * Used by the reflection loop to auto-verify code changes.
 */
export function getVerifyCommands(state: DanteCodeState): Array<{ name: string; command: string }> {
  const commands: Array<{ name: string; command: string }> = [];
  const project = state.project;
  if (project.lintCommand) commands.push({ name: "lint", command: project.lintCommand });
  if (project.testCommand) commands.push({ name: "test", command: project.testCommand });
  if (project.buildCommand) commands.push({ name: "build", command: project.buildCommand });
  return commands;
}

export const CODE_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".css",
  ".scss",
  ".html",
  ".md",
  ".json",
  ".yaml",
  ".yml",
]);

export interface MajorEditBatchGateResult {
  passed: boolean;
  failedSteps: string[];
}

export function isCodeLikeFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return Array.from(CODE_FILE_EXTENSIONS).some((extension) => normalized.endsWith(extension));
}

export function isWorktreeProjectRoot(projectRoot: string): boolean {
  const normalized = projectRoot.replace(/\\/g, "/");
  return normalized.includes("/.dantecode/worktrees/");
}

export function isMajorEditBatch(files: string[], projectRoot: string): boolean {
  const codeFiles = [...new Set(files.filter(isCodeLikeFile))];
  if (codeFiles.length === 0) {
    return false;
  }

  return (
    codeFiles.some((filePath) => isProtectedWriteTarget(filePath, projectRoot)) ||
    (isWorktreeProjectRoot(projectRoot) && codeFiles.length > 1)
  );
}

export async function runMajorEditBatchGate(
  sessionId: string,
  projectRoot: string,
  roundCounter: number,
  selfImprovement: import("@dantecode/config-types").SelfImprovementContext | undefined,
  readTracker: Map<string, string>,
  editAttempts: Map<string, number>,
): Promise<MajorEditBatchGateResult> {
  const steps = [
    { name: "typecheck", command: "npm run typecheck" },
    { name: "lint", command: "npm run lint" },
    { name: "test", command: "npm test" },
  ];
  const failedSteps: string[] = [];

  for (const step of steps) {
    const gateResult = await executeTool("Bash", { command: step.command }, projectRoot, {
      sessionId,
      roundId: `round-${roundCounter}-gstack`,
      sandboxEnabled: false,
      selfImprovement,
      readTracker,
      editAttempts,
    });

    if (gateResult.isError) {
      failedSteps.push(step.name);
    }
  }

  return {
    passed: failedSteps.length === 0,
    failedSteps,
  };
}

// ----------------------------------------------------------------------------
// Context Compaction
// ----------------------------------------------------------------------------

/**
 * Compacts messages when approaching the context window limit.
 * Three-tier strategy:
 *   Tier 1 (< 50%): No compaction.
 *   Tier 2 (50-75%): Summarize old tool results, keep tool call names.
 *   Tier 3 (> 75%): Keep first + recent 10, inject summary of dropped range.
 */
export function compactMessages(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  contextWindow: number,
): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  const tokens = estimateMessageTokens(messages);

  // Tier 1: Under 50% — no compaction needed
  if (tokens < contextWindow * 0.5) {
    return messages;
  }

  // Tier 2: 50-75% — summarize old tool results, keep recent 5 tool calls intact
  if (tokens < contextWindow * 0.75) {
    const KEEP_RECENT_TOOLS = 5;
    let toolResultCount = 0;
    const result: typeof messages = [];

    // Walk from end to start, counting tool results
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      const isToolResult = msg.role === "user" && msg.content.startsWith("Tool execution results:");

      if (isToolResult) {
        toolResultCount++;
        if (toolResultCount > KEEP_RECENT_TOOLS) {
          // Summarize old tool result to one line
          const firstLine = msg.content.split("\n")[1] ?? "tool result";
          result.unshift({
            role: msg.role,
            content: `[Summarized] ${firstLine.slice(0, 120)}`,
          });
          continue;
        }
      }
      result.unshift(msg);
    }
    return result;
  }

  // Tier 3: 75-90% — summarize dropped messages (keep key facts)
  const KEEP_RECENT = 10;
  if (messages.length <= KEEP_RECENT + 1) {
    return messages;
  }

  const first = messages[0]!;
  const recent = messages.slice(-KEEP_RECENT);
  const dropped = messages.slice(1, messages.length - KEEP_RECENT);

  // Generate a structured summary of dropped messages
  const summary = summarizeDroppedMessages(dropped);

  return [
    first,
    {
      role: "system" as const,
      content: summary,
    },
    ...recent,
  ];
}

/**
 * Generate a meaningful summary of dropped messages, preserving key facts
 * about what files were read, edited, and what commands were run.
 */
export function summarizeDroppedMessages(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
): string {
  const filesRead = new Set<string>();
  const filesEdited = new Set<string>();
  const bashCommands: string[] = [];
  const keyDecisions: string[] = [];

  for (const msg of messages) {
    const text = msg.content;

    // Extract file reads
    const readMatches = text.matchAll(/(?:Read|read|Reading)\s+[`"']?([^\s`"]+\.\w+)/g);
    for (const m of readMatches) filesRead.add(m[1]!);

    // Extract file edits/writes
    const editMatches = text.matchAll(
      /(?:Edit|Write|Edited|Wrote|Modified)\s+[`"']?([^\s`"]+\.\w+)/g,
    );
    for (const m of editMatches) filesEdited.add(m[1]!);

    // Extract bash commands (first line only)
    const bashMatches = text.matchAll(/(?:Bash|command|ran|execute)[:\s]+[`"]?([^\n`"]{5,80})/gi);
    for (const m of bashMatches) {
      if (bashCommands.length < 5) bashCommands.push(m[1]!.trim());
    }

    // Extract tool result file paths
    const toolPathMatches = text.matchAll(/file_path[":=\s]+([^\s"',}]+\.\w+)/g);
    for (const m of toolPathMatches) {
      if (msg.role === "user") filesRead.add(m[1]!);
    }
  }

  const parts = [
    `[Context compacted: ${messages.length} earlier messages summarized]`,
    "",
    "## Earlier Session Activity",
  ];

  if (filesRead.size > 0) {
    parts.push(`Files read: ${[...filesRead].slice(0, 15).join(", ")}`);
  }
  if (filesEdited.size > 0) {
    parts.push(`Files modified: ${[...filesEdited].slice(0, 10).join(", ")}`);
  }
  if (bashCommands.length > 0) {
    parts.push(`Commands run: ${bashCommands.join("; ")}`);
  }
  if (keyDecisions.length > 0) {
    parts.push(`Key decisions: ${keyDecisions.join("; ")}`);
  }

  return parts.join("\n");
}

// ----------------------------------------------------------------------------
// Claimed Files Extraction
// ----------------------------------------------------------------------------

/**
 * Extract file paths the model claims to have modified from its response text.
 * Looks for patterns like "I updated/modified/edited <path>" or "Write to <path>".
 */
export function extractClaimedFiles(text: string): string[] {
  const patterns = [
    /(?:updated|modified|edited|wrote|created|changed)\s+[`"']?([^\s`"',]+\.\w{1,6})/gi,
    /(?:Write|Edit)\s+(?:to\s+)?[`"']?([^\s`"',]+\.\w{1,6})/g,
  ];
  const files = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const path = match[1]!;
      // Filter out common false positives
      if (path.length > 3 && !path.startsWith("http") && !path.startsWith("//")) {
        files.add(path);
      }
    }
  }
  return [...files];
}

// ----------------------------------------------------------------------------
// Model Capability Detection
// ----------------------------------------------------------------------------

export function supportsExtendedThinking(model: ModelConfig): boolean {
  if (typeof model.supportsExtendedThinking === "boolean") {
    return model.supportsExtendedThinking;
  }

  return (
    model.provider === "anthropic" ||
    model.modelId.toLowerCase().includes("reasoning") ||
    /^o[13]/i.test(model.modelId) ||
    /r1/i.test(model.modelId)
  );
}

export function deriveThinkingBudget(model: ModelConfig, complexity: number): number | undefined {
  if (!supportsExtendedThinking(model) || complexity < 0.6) {
    return undefined;
  }

  const baseBudget =
    model.reasoningEffort === "high" ? 8192 : model.reasoningEffort === "low" ? 2048 : 4096;
  return Math.round(baseBudget * Math.max(1, complexity));
}

export function isTimeoutError(message: string): boolean {
  return /\b(?:timed?\s*out|timeout)\b/i.test(message);
}

// ----------------------------------------------------------------------------
// Evidence Building
// ----------------------------------------------------------------------------

export function buildExecutionEvidence(
  toolName: string,
  toolInput: Record<string, unknown>,
  result: { isError: boolean },
  writtenFile?: string,
): ExecutionEvidence {
  const timestamp = new Date().toISOString();
  const command = typeof toolInput["command"] === "string" ? toolInput["command"] : undefined;
  const filePath =
    typeof toolInput["file_path"] === "string" ? toolInput["file_path"] : writtenFile;
  const sourceUrl = typeof toolInput["url"] === "string" ? toolInput["url"] : undefined;

  if (writtenFile && !result.isError) {
    return {
      id: randomUUID(),
      kind: "file_write",
      success: true,
      label: `Updated ${writtenFile}`,
      filePath: writtenFile,
      timestamp,
    };
  }

  if (
    toolName === "Bash" &&
    command &&
    /\b(?:test|lint|build|typecheck|vitest|jest)\b/i.test(command)
  ) {
    return {
      id: randomUUID(),
      kind: result.isError ? "tool_result" : "verification_pass",
      success: !result.isError,
      label: result.isError ? `Verification failed: ${command}` : `Verified with: ${command}`,
      command,
      timestamp,
    };
  }

  if (toolName === "WebFetch" || toolName === "WebSearch" || toolName === "GitHubSearch") {
    return {
      id: randomUUID(),
      kind: "source_fetch",
      success: !result.isError,
      label: `${toolName} executed`,
      sourceUrl,
      timestamp,
    };
  }

  if (toolName === "SubAgent") {
    return {
      id: randomUUID(),
      kind: "agent_spawn",
      success: !result.isError,
      label: "Spawned sub-agent",
      agentId: typeof toolInput["agentId"] === "string" ? toolInput["agentId"] : undefined,
      timestamp,
    };
  }

  if (toolName === "GitCommit" || toolName === "GitPush") {
    return {
      id: randomUUID(),
      kind: "commit",
      success: !result.isError,
      label: `${toolName} executed`,
      timestamp,
    };
  }

  return {
    id: randomUUID(),
    kind: "tool_result",
    success: !result.isError,
    label: `${toolName} executed`,
    filePath,
    command,
    sourceUrl,
    timestamp,
  };
}
