// ============================================================================
// @dantecode/cli — Agent Interaction Loop
// The core loop that sends user prompts to the model, processes tool calls,
// runs the DanteForge pipeline on generated code, and streams responses.
// ============================================================================

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ModelRouterImpl,
  estimateMessageTokens,
  getContextUtilization,
  promptRequestsToolExecution,
  responseNeedsToolExecutionNudge,
  parseVerificationErrors,
  formatErrorsForFixPrompt,
  computeErrorSignature,
} from "@dantecode/core";
import {
  recordSuccessPattern,
  queryLessons,
  formatLessonsForPrompt,
  detectAndRecordPatterns,
} from "@dantecode/danteforge";
import { runDanteForge, getWrittenFilePath } from "./danteforge-pipeline.js";
import type { Session, SessionMessage, DanteCodeState, ModelConfig } from "@dantecode/config-types";
import {
  getStatus,
  autoCommit,
  generateRepoMap,
  formatRepoMapForContext,
} from "@dantecode/git-engine";
import { executeTool, getToolDefinitions } from "./tools.js";
import { normalizeAndCheckBash } from "./safety.js";
import { StreamRenderer } from "./stream-renderer.js";
import { getAISDKTools } from "./tool-schemas.js";
import { SandboxBridge } from "./sandbox-bridge.js";

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Configuration passed to the agent loop. */
export interface AgentLoopConfig {
  state: DanteCodeState;
  verbose: boolean;
  enableGit: boolean;
  enableSandbox: boolean;
  /** Silent mode (Ruflo pattern): suppress per-tool output, show only compact progress. */
  silent?: boolean;
  /** Called for each streaming token chunk, enabling real-time UI updates. */
  onToken?: (token: string) => void;
  /** Signal to abort the current generation (e.g., on Ctrl+C). */
  abortSignal?: AbortSignal;
  /** Sandbox bridge for isolated command execution (when --sandbox is set). */
  sandboxBridge?: SandboxBridge;
  /** MCP tools converted to AI SDK schema (from MCPClientManager). */
  mcpTools?: Record<string, { description: string; parameters: import("zod").ZodTypeAny }>;
  /** MCP client for dispatching tool calls to external MCP servers. */
  mcpClient?: { callToolByName: (name: string, args: Record<string, unknown>) => Promise<string> };
}

// ----------------------------------------------------------------------------
// System Prompt Builder
// ----------------------------------------------------------------------------

/**
 * Builds the system prompt sent to the model. Includes instructions for tool
 * use, the DanteForge doctrine, and project-specific context.
 */
async function buildSystemPrompt(session: Session, config: AgentLoopConfig): Promise<string> {
  const toolDefs = getToolDefinitions();
  const toolList = toolDefs.map((t) => `- ${t.name}: ${t.description}`).join("\n");

  const sections: string[] = [
    "You are DanteCode, an expert AI coding agent. You help users write, edit, debug, and maintain code.",
    "",
    "## Available Tools",
    "",
    "You can use the following tools by including tool_use blocks in your response:",
    "",
    toolList,
    "",
    "## Key Principles",
    "",
    "1. ALWAYS produce COMPLETE, PRODUCTION-READY code. Never use stubs, placeholders, or ellipsis.",
    "2. Read files before editing them to understand context.",
    "3. Use Edit for small changes, Write for new files or complete rewrites.",
    "4. Run Bash commands to verify your changes (e.g., type-check, test, lint).",
    "5. Be precise with file paths. Use the Glob tool to find files if unsure.",
    "6. Explain what you are doing and why.",
    "",
    "## Project Context",
    "",
    `Project root: ${session.projectRoot}`,
  ];

  if (config.state.project.name) {
    sections.push(`Project name: ${config.state.project.name}`);
  }
  if (config.state.project.language) {
    sections.push(`Language: ${config.state.project.language}`);
  }
  if (config.state.project.framework) {
    sections.push(`Framework: ${config.state.project.framework}`);
  }

  if (session.activeFiles.length > 0) {
    sections.push("");
    sections.push("## Files in Context");
    sections.push("");
    for (const file of session.activeFiles) {
      sections.push(`- ${file}`);
    }
  }

  // Repo map injection: give the model a structural overview of the project
  try {
    const repoMap = generateRepoMap(session.projectRoot, { maxFiles: 150 });
    if (repoMap.length > 0) {
      sections.push("", "## Repository Structure", "", formatRepoMapForContext(repoMap));
    }
  } catch {
    // Non-fatal: repo map generation failure should not break the agent
  }

  // Lesson injection: give the model learned patterns from past sessions
  try {
    const lessons = await queryLessons({ projectRoot: session.projectRoot, limit: 10 });
    if (lessons.length > 0) {
      sections.push("", "## Learned Patterns (from past sessions)", "");
      sections.push(formatLessonsForPrompt(lessons));
    }
  } catch {
    // Non-fatal: lesson injection failure should not break the agent
  }

  // Project notes: load .dantecode/DANTE.md if it exists (similar to Claude Code's CLAUDE.md)
  try {
    const danteNotesPath = resolve(session.projectRoot, ".dantecode", "DANTE.md");
    const danteNotes = await readFile(danteNotesPath, "utf-8");
    if (danteNotes.trim().length > 0) {
      sections.push("", "## Project Notes", "", danteNotes.trim());
    }
  } catch {
    // File doesn't exist — that's fine
  }

  // First-turn complexity rating instruction (model-assisted scoring)
  if (session.messages.length <= 1) {
    sections.push("");
    sections.push(
      "On your FIRST response only, include at the very end: [COMPLEXITY: X.X] " +
        "where X.X is your 0-1 self-assessment of task complexity. " +
        "0.0 = trivial, 1.0 = extremely complex multi-file refactor.",
    );
  }

  return sections.join("\n");
}

// ----------------------------------------------------------------------------
// Tool Call Extraction
// ----------------------------------------------------------------------------

/**
 * Represents a tool call extracted from the model's response text.
 * When the model outputs structured tool_use blocks, this is how we capture them.
 * Since we are using generateText (not structured tool calling), we parse
 * tool calls from a simple XML-like format in the model's response.
 */
interface ExtractedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Extracts tool calls from the model response text.
 * Looks for patterns like:
 *   <tool_use>
 *   {"name": "Read", "input": {"file_path": "..."}}
 *   </tool_use>
 *
 * Also handles JSON code blocks that look like tool calls.
 */
function extractToolCalls(text: string): { cleanText: string; toolCalls: ExtractedToolCall[] } {
  const toolCalls: ExtractedToolCall[] = [];
  let cleanText = text;

  // Pattern 1: XML-style tool use blocks
  const xmlPattern = /<tool_use>\s*([\s\S]*?)\s*<\/tool_use>/g;
  let match: RegExpExecArray | null;

  while ((match = xmlPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!) as {
        name?: string;
        input?: Record<string, unknown>;
      };
      if (parsed.name && parsed.input) {
        toolCalls.push({
          id: randomUUID(),
          name: parsed.name,
          input: parsed.input,
        });
      }
    } catch {
      // Not valid JSON, skip
    }
    cleanText = cleanText.replace(match[0], "");
  }

  // Pattern 2: JSON blocks with tool call structure
  const jsonBlockPattern =
    /```(?:json)?\s*\n(\{[\s\S]*?"name"\s*:\s*"(?:Read|Write|Edit|Bash|Glob|Grep|GitCommit|TodoWrite)"[\s\S]*?\})\s*\n```/g;

  while ((match = jsonBlockPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!) as {
        name?: string;
        input?: Record<string, unknown>;
      };
      if (parsed.name && parsed.input) {
        toolCalls.push({
          id: randomUUID(),
          name: parsed.name,
          input: parsed.input,
        });
        cleanText = cleanText.replace(match[0], "");
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  return { cleanText: cleanText.trim(), toolCalls };
}

// ----------------------------------------------------------------------------
// Reflection Loop Helpers
// ----------------------------------------------------------------------------

/**
 * Returns the project's configured verification commands (lint, test, build).
 * Used by the reflection loop to auto-verify code changes.
 */
function getVerifyCommands(config: AgentLoopConfig): Array<{ name: string; command: string }> {
  const commands: Array<{ name: string; command: string }> = [];
  const project = config.state.project;
  if (project.lintCommand) commands.push({ name: "lint", command: project.lintCommand });
  if (project.testCommand) commands.push({ name: "test", command: project.testCommand });
  if (project.buildCommand) commands.push({ name: "build", command: project.buildCommand });
  return commands;
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
 * (Pattern from opencode/OpenHands)
 */
function compactMessages(
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

  // Tier 3: Over 75% — aggressive compaction
  const KEEP_RECENT = 10;
  if (messages.length <= KEEP_RECENT + 1) {
    return messages;
  }

  const first = messages[0]!;
  const recent = messages.slice(-KEEP_RECENT);
  const droppedCount = messages.length - KEEP_RECENT - 1;

  return [
    first,
    {
      role: "system" as const,
      content: `[Context compacted: ${droppedCount} earlier messages removed to fit context window. Recent conversation preserved below.]`,
    },
    ...recent,
  ];
}

function supportsExtendedThinking(model: ModelConfig): boolean {
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

function deriveThinkingBudget(model: ModelConfig, complexity: number): number | undefined {
  if (!supportsExtendedThinking(model) || complexity < 0.6) {
    return undefined;
  }

  const baseBudget =
    model.reasoningEffort === "high" ? 8192 : model.reasoningEffort === "low" ? 2048 : 4096;
  return Math.round(baseBudget * Math.max(1, complexity));
}

// ----------------------------------------------------------------------------
// Main Agent Loop
// ----------------------------------------------------------------------------

/**
 * Runs the agent interaction loop for a single user turn.
 *
 * 1. Appends user message to the session
 * 2. Builds the system prompt and message history
 * 3. Sends to the model via ModelRouterImpl
 * 4. Extracts tool calls from the response
 * 5. Executes each tool call and collects results
 * 6. If tool calls were made, loops back to send results to the model
 * 7. Runs DanteForge pipeline on any code files written
 * 8. Returns the updated session
 *
 * @param prompt - The user's natural language prompt.
 * @param session - The current session state.
 * @param config - Agent loop configuration.
 * @returns The updated session with new messages.
 */
export async function runAgentLoop(
  prompt: string,
  session: Session,
  config: AgentLoopConfig,
): Promise<Session> {
  // Append user message
  const userMessage: SessionMessage = {
    id: randomUUID(),
    role: "user",
    content: prompt,
    timestamp: new Date().toISOString(),
  };
  session.messages.push(userMessage);

  // Build the model router
  const routerConfig = {
    default: config.state.model.default,
    fallback: config.state.model.fallback,
    overrides: config.state.model.taskOverrides,
  };
  const router = new ModelRouterImpl(routerConfig, session.projectRoot, session.id);
  const lexicalComplexity = router.analyzeComplexity(prompt);
  const thinkingBudget = deriveThinkingBudget(config.state.model.default, lexicalComplexity);
  let localSandboxBridge: SandboxBridge | null = null;

  // Build system prompt
  const systemPrompt = await buildSystemPrompt(session, config);

  // Convert session messages to the format expected by the AI SDK
  const messages = session.messages.map((msg) => ({
    role: msg.role as "user" | "assistant" | "system",
    content:
      typeof msg.content === "string"
        ? msg.content
        : msg.content.map((b) => b.text || "").join("\n"),
  }));

  // Tool call loop: keep sending to the model until no more tool calls
  let maxToolRounds = 15;
  let totalTokensUsed = 0;
  const touchedFiles: string[] = [];
  // Stuck loop detection (from opencode/OpenHands): track recent tool call signatures
  const recentToolSignatures: string[] = [];
  const STUCK_LOOP_THRESHOLD = 3; // 3 identical consecutive calls = stuck
  // Reflection loop (aider/Cursor pattern): auto-retry verification after code edits
  const MAX_VERIFY_RETRIES = 3;
  let verifyRetries = 0;
  // Self-healing loop: track error signatures to detect repeated identical failures
  let lastErrorSignature = "";
  let sameErrorCount = 0;
  let executionNudges = 0;
  const MAX_EXECUTION_NUDGES = 2;
  let executedToolsThisTurn = 0;

  if (config.verbose && thinkingBudget) {
    process.stdout.write(
      `${DIM}[thinking: ${config.state.model.default.provider}/${config.state.model.default.modelId}, budget=${thinkingBudget}]${RESET}\n`,
    );
  }

  while (maxToolRounds > 0) {
    maxToolRounds--;

    // Context compaction (opencode/OpenHands pattern): condense old messages
    // when approaching the context window limit
    const compacted = compactMessages(messages, config.state.model.default.contextWindow);
    if (compacted.length < messages.length) {
      messages.splice(0, messages.length, ...compacted);
      if (config.verbose) {
        process.stdout.write(
          `${DIM}[context compacted: ${messages.length} messages remaining]${RESET}\n`,
        );
      }
    }

    // Context utilization meter (WS5 Context Guardian)
    const ctxWindow = config.state.model.default.contextWindow;
    const utilization = getContextUtilization(
      messages.map((m) => ({ role: m.role, content: m.content })),
      ctxWindow,
    );
    if (!config.silent) {
      if (utilization.tier === "green") {
        process.stdout.write(
          `${DIM}[context: ${utilization.percent}% — ${Math.round(utilization.tokens / 1000)}K/${Math.round(utilization.maxTokens / 1000)}K tokens]${RESET}\n`,
        );
      } else if (utilization.tier === "yellow") {
        process.stdout.write(
          `${YELLOW}[context: ${utilization.percent}% — ${Math.round(utilization.tokens / 1000)}K/${Math.round(utilization.maxTokens / 1000)}K tokens — older messages will be summarized soon]${RESET}\n`,
        );
      } else {
        process.stdout.write(
          `${RED}[context: ${utilization.percent}% — ${Math.round(utilization.tokens / 1000)}K/${Math.round(utilization.maxTokens / 1000)}K tokens — use /compact or /new for fresh session]${RESET}\n`,
        );
      }
    }

    // Generate response from model (streaming with tool calling support)
    let responseText = "";
    let toolCalls: ExtractedToolCall[] = [];
    let cleanText = "";
    try {
      const renderer = new StreamRenderer(!!config.silent);
      renderer.printHeader();
      const useNativeTools = config.state.model.default.supportsToolCalls;
      let nativeSuccess = false;

      if (useNativeTools) {
        // Native AI SDK tool calling: stream with Zod-schema tools
        try {
          const aiSdkTools = getAISDKTools(config.mcpTools);
          const streamResult = await router.streamWithTools(messages, aiSdkTools, {
            system: systemPrompt,
            maxTokens: config.state.model.default.maxTokens,
            abortSignal: config.abortSignal,
            ...(thinkingBudget ? { thinkingBudget } : {}),
          });
          for await (const part of streamResult.fullStream) {
            if (part.type === "text-delta") {
              renderer.write(part.textDelta);
              config.onToken?.(part.textDelta);
            } else if (part.type === "reasoning") {
              if (config.verbose) {
                process.stdout.write(`${DIM}[reasoning] ${part.textDelta}${RESET}\n`);
              }
            } else if (part.type === "tool-call") {
              toolCalls.push({
                id: part.toolCallId,
                name: part.toolName,
                input: part.args as Record<string, unknown>,
              });
            }
          }
          responseText = renderer.getFullText();
          renderer.finish();
          cleanText = responseText;
          nativeSuccess = true;
        } catch {
          // Native tool calling failed — fall through to XML fallback
          renderer.reset();
        }
      }

      if (!nativeSuccess) {
        // XML parsing fallback: stream text, then extract tool calls from response
        try {
          const streamResult = await router.stream(messages, {
            system: systemPrompt,
            maxTokens: config.state.model.default.maxTokens,
            abortSignal: config.abortSignal,
            ...(thinkingBudget ? { thinkingBudget } : {}),
          });
          for await (const chunk of streamResult.textStream) {
            renderer.write(chunk);
            config.onToken?.(chunk);
          }
          responseText = renderer.getFullText();
          renderer.finish();
        } catch {
          // Fallback to blocking generate if streaming is not supported
          renderer.reset();
          if (!config.silent) {
            process.stdout.write(`${DIM}(thinking...)${RESET}\n`);
          }
          responseText = await router.generate(messages, {
            system: systemPrompt,
            maxTokens: config.state.model.default.maxTokens,
            ...(thinkingBudget ? { thinkingBudget } : {}),
          });
        }
        const extracted = extractToolCalls(responseText);
        cleanText = extracted.cleanText;
        toolCalls = extracted.toolCalls;
      }

      totalTokensUsed += responseText.length; // Approximate token count

      // Model-assisted complexity scoring: extract on first response
      if (!router.getModelRatedComplexity()) {
        const modelScore = router.extractModelComplexityRating(responseText, prompt);
        if (config.verbose && modelScore !== null) {
          process.stdout.write(`${DIM}[complexity: model=${modelScore.toFixed(2)}]${RESET}\n`);
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\n${RED}Model error: ${errorMessage}${RESET}\n`);

      const errorMsg: SessionMessage = {
        id: randomUUID(),
        role: "assistant",
        content: `I encountered an error communicating with the model: ${errorMessage}`,
        timestamp: new Date().toISOString(),
      };
      session.messages.push(errorMsg);
      return session;
    }

    // Display the assistant's text response (suppressed in silent mode)
    if (cleanText.length > 0 && !config.silent) {
      process.stdout.write(`${cleanText}\n`);
    }

    // If no tool calls, we're done with this turn
    if (toolCalls.length === 0) {
      if (
        executedToolsThisTurn === 0 &&
        promptRequestsToolExecution(prompt) &&
        responseNeedsToolExecutionNudge(responseText) &&
        executionNudges < MAX_EXECUTION_NUDGES &&
        maxToolRounds > 0
      ) {
        executionNudges++;
        messages.push({
          role: "assistant",
          content: responseText,
        });
        messages.push({
          role: "user",
          content:
            "You described the intended work but did not use any tools. Stop narrating and actually execute the next step with Read, Write, Edit, Bash, Glob, Grep, or TodoWrite. Only claim file changes after a successful tool result.",
        });
        if (!config.silent) {
          process.stdout.write(
            `\n${YELLOW}[nudge: execute with tools]${RESET} ${DIM}(no tool calls were emitted)${RESET}\n`,
          );
        }
        continue;
      }

      const assistantMessage: SessionMessage = {
        id: randomUUID(),
        role: "assistant",
        content: responseText,
        timestamp: new Date().toISOString(),
        modelId: `${config.state.model.default.provider}/${config.state.model.default.modelId}`,
        tokensUsed: totalTokensUsed,
      };
      session.messages.push(assistantMessage);
      break;
    }

    // Execute each tool call
    const toolResults: string[] = [];
    let toolIndex = 0;

    for (const toolCall of toolCalls) {
      executedToolsThisTurn++;
      toolIndex++;
      // Stuck loop detection (opencode/OpenHands pattern): if the same tool call
      // signature appears 3 times consecutively, inject a warning to break the loop
      const toolSig = `${toolCall.name}:${JSON.stringify(toolCall.input)}`;
      recentToolSignatures.push(toolSig);
      if (recentToolSignatures.length > STUCK_LOOP_THRESHOLD) {
        recentToolSignatures.shift();
      }
      if (
        recentToolSignatures.length === STUCK_LOOP_THRESHOLD &&
        recentToolSignatures.every((sig) => sig === toolSig)
      ) {
        process.stdout.write(
          `\n${YELLOW}${BOLD}Stuck loop detected:${RESET} ${DIM}same tool call repeated ${STUCK_LOOP_THRESHOLD} times. Breaking loop.${RESET}\n`,
        );
        toolResults.push(
          `SYSTEM: Stuck loop detected — you have called ${toolCall.name} with identical arguments ${STUCK_LOOP_THRESHOLD} times. Stop repeating this action and try a different approach, or ask the user for help.`,
        );
        recentToolSignatures.length = 0;
        break;
      }

      // Pre-tool safety hook (Ruflo/ccswarm pattern): block dangerous Bash commands
      if (toolCall.name === "Bash") {
        const bashCmd = toolCall.input["command"] as string | undefined;
        if (bashCmd) {
          const blockReason = normalizeAndCheckBash(bashCmd);
          if (blockReason) {
            process.stdout.write(
              `\n${RED}${BOLD}BLOCKED:${RESET} ${RED}${blockReason}${RESET}\n${DIM}Command: ${bashCmd.slice(0, 100)}${RESET}\n`,
            );
            toolResults.push(
              `SAFETY HOOK: Bash command blocked — ${blockReason}. Use a safer approach.`,
            );
            continue;
          }
        }
      }

      // Silent mode (Ruflo pattern): compact progress counter
      if (config.silent) {
        process.stdout.write(
          `\r${DIM}[${toolIndex}/${toolCalls.length} tools] ${toolCall.name}${RESET}` +
            " ".repeat(20),
        );
      } else {
        process.stdout.write(`\n${DIM}[tool: ${toolCall.name}]${RESET} `);
      }

      if (config.verbose && !config.silent) {
        process.stdout.write(`${DIM}${JSON.stringify(toolCall.input).slice(0, 200)}${RESET}\n`);
      }

      // Dirty-commit-before-edit (aider pattern): if the agent is about to edit
      // a file that has uncommitted changes, commit those first so /undo works cleanly
      if (config.enableGit && (toolCall.name === "Write" || toolCall.name === "Edit")) {
        try {
          const targetPath = toolCall.input["file_path"] as string | undefined;
          if (targetPath) {
            const gitStatus = getStatus(session.projectRoot);
            const dirtyPaths = [
              ...gitStatus.unstaged.map((s: { path: string }) => s.path),
              ...gitStatus.staged.map((s: { path: string }) => s.path),
            ];
            const resolvedTarget = resolve(session.projectRoot, targetPath);
            const isDirty = dirtyPaths.some(
              (p) => resolve(session.projectRoot, p) === resolvedTarget,
            );
            if (isDirty) {
              autoCommit(
                {
                  message: `dantecode: snapshot before agent edit of ${targetPath}`,
                  footer: "",
                  files: [targetPath],
                  allowEmpty: false,
                },
                session.projectRoot,
              );
              if (config.verbose) {
                process.stdout.write(
                  `${DIM}[dirty-commit: saved pre-edit state of ${targetPath}]${RESET}\n`,
                );
              }
            }
          }
        } catch {
          // Non-fatal: if the dirty commit fails, continue with the edit anyway
        }
      }

      // Route MCP tool calls to the MCP client
      const isMCPTool = toolCall.name.startsWith("mcp_") && config.mcpClient;

      // Route Bash commands through sandbox when available
      if (
        toolCall.name === "Bash" &&
        config.enableSandbox &&
        !config.sandboxBridge &&
        !localSandboxBridge
      ) {
        localSandboxBridge = new SandboxBridge(session.projectRoot, config.verbose);
      }

      const activeSandboxBridge = config.sandboxBridge ?? localSandboxBridge ?? undefined;
      const useSandbox =
        toolCall.name === "Bash" &&
        activeSandboxBridge &&
        typeof toolCall.input["command"] === "string";

      let result: { content: string; isError: boolean };
      if (isMCPTool) {
        try {
          const mcpResult = await config.mcpClient!.callToolByName(toolCall.name, toolCall.input);
          result = { content: mcpResult, isError: false };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          result = { content: `MCP tool error: ${msg}`, isError: true };
        }
      } else if (useSandbox) {
        result = await activeSandboxBridge.runInSandbox(
          toolCall.input["command"] as string,
          (toolCall.input["timeout"] as number | undefined) ?? 120000,
        );
      } else {
        result = await executeTool(toolCall.name, toolCall.input, session.projectRoot, session.id);
      }

      // Tool output truncation (opencode pattern): cap large outputs to avoid
      // blowing the context window. Truncate to 2000 lines / 50KB.
      const MAX_OUTPUT_LINES = 2000;
      const MAX_OUTPUT_BYTES = 50 * 1024;
      let outputContent = result.content;
      const outputLines = outputContent.split("\n");
      if (outputLines.length > MAX_OUTPUT_LINES) {
        outputContent =
          outputLines.slice(0, MAX_OUTPUT_LINES).join("\n") +
          `\n\n... (truncated, ${outputLines.length} total lines)`;
      }
      if (outputContent.length > MAX_OUTPUT_BYTES) {
        outputContent =
          outputContent.slice(0, MAX_OUTPUT_BYTES) +
          `\n\n... (truncated, ${result.content.length} total bytes)`;
      }

      // Track files written for DanteForge pipeline
      const writtenFile = getWrittenFilePath(toolCall.name, toolCall.input);
      if (writtenFile) {
        const resolvedPath = resolve(session.projectRoot, writtenFile);
        if (!touchedFiles.includes(resolvedPath)) {
          touchedFiles.push(resolvedPath);
        }
      }

      // Show result summary (suppressed in silent mode)
      if (!config.silent) {
        if (result.isError) {
          process.stdout.write(`${RED}error${RESET}\n`);
          if (config.verbose) {
            process.stdout.write(`${DIM}${result.content.slice(0, 300)}${RESET}\n`);
          }
        } else {
          const preview = result.content.split("\n")[0] || "(success)";
          process.stdout.write(`${GREEN}ok${RESET} ${DIM}${preview.slice(0, 100)}${RESET}\n`);
        }
      }

      toolResults.push(`Tool "${toolCall.name}" result:\n${outputContent}`);

      // Record the tool call in the session
      const toolUseMessage: SessionMessage = {
        id: randomUUID(),
        role: "assistant",
        content: `Using tool: ${toolCall.name}`,
        timestamp: new Date().toISOString(),
        toolUse: {
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        },
      };
      session.messages.push(toolUseMessage);

      const toolResultMessage: SessionMessage = {
        id: randomUUID(),
        role: "tool",
        content: result.content,
        timestamp: new Date().toISOString(),
        toolResult: {
          toolUseId: toolCall.id,
          content: result.content,
          isError: result.isError,
        },
      };
      session.messages.push(toolResultMessage);
    }

    // Clear silent mode progress line after tool loop
    if (config.silent && toolCalls.length > 0) {
      process.stdout.write(
        `\r${DIM}[${toolCalls.length}/${toolCalls.length} tools done]${RESET}\n`,
      );
    }

    // Reflection loop (aider/Cursor pattern): after code edits, auto-run
    // the project's configured lint/test/build commands. If any fail,
    // parse the output into structured errors and inject a targeted fix
    // prompt so the model can fix specific issues instead of guessing.
    const wroteCode = toolCalls.some((tc) => tc.name === "Write" || tc.name === "Edit");
    if (wroteCode && verifyRetries < MAX_VERIFY_RETRIES) {
      const verifyCommands = getVerifyCommands(config);
      for (const vc of verifyCommands) {
        try {
          const vcResult = await executeTool(
            "Bash",
            { command: vc.command },
            session.projectRoot,
            session.id,
          );
          if (vcResult.isError) {
            verifyRetries++;

            // Self-healing: parse errors into structured format for targeted fixes
            const parsedErrors = parseVerificationErrors(vcResult.content);
            let retryMessage: string;

            if (parsedErrors.length > 0) {
              // Targeted fix prompt: tell the model exactly which errors to fix
              const fixPrompt = formatErrorsForFixPrompt(parsedErrors);
              retryMessage = `AUTO-VERIFY (${vc.name}) FAILED — ${parsedErrors.length} structured error(s) detected:\n\n${fixPrompt}\n\n(attempt ${verifyRetries}/${MAX_VERIFY_RETRIES})`;

              // Track error signature to detect repeated identical failures
              const errorSig = computeErrorSignature(parsedErrors);
              if (errorSig === lastErrorSignature) {
                sameErrorCount++;
                if (sameErrorCount >= 2) {
                  // Same errors persisting across retries — escalate model tier
                  router.forceCapable();
                  retryMessage += `\n\nWARNING: These same errors have persisted for ${sameErrorCount + 1} consecutive retries. The model tier has been escalated. Try a fundamentally different approach to fix these issues.`;
                  if (config.verbose) {
                    process.stdout.write(
                      `\n${YELLOW}[self-heal: tier escalated to capable — same errors ${sameErrorCount + 1}x]${RESET}\n`,
                    );
                  }
                }
              } else {
                sameErrorCount = 0;
              }
              lastErrorSignature = errorSig;

              if (config.verbose) {
                process.stdout.write(
                  `${DIM}[self-heal: parsed ${parsedErrors.length} error(s) from ${vc.name} output]${RESET}\n`,
                );
              }
            } else {
              // Fallback: parser found nothing structured, inject raw output as before
              retryMessage = `AUTO-VERIFY (${vc.name}) FAILED:\n${vcResult.content}\n\nFix the errors above. (attempt ${verifyRetries}/${MAX_VERIFY_RETRIES})`;
            }

            toolResults.push(retryMessage);
            process.stdout.write(
              `\n${YELLOW}[verify: ${vc.name} FAILED]${RESET} ${DIM}(retry ${verifyRetries}/${MAX_VERIFY_RETRIES})${RESET}\n`,
            );
          } else {
            // Verification passed — reset error signature tracking
            lastErrorSignature = "";
            sameErrorCount = 0;
            process.stdout.write(`\n${GREEN}[verify: ${vc.name} OK]${RESET}\n`);
          }
        } catch {
          // Verification command failed to execute, skip
        }
      }
    } else if (wroteCode && verifyRetries >= MAX_VERIFY_RETRIES) {
      toolResults.push(
        `SYSTEM: Verification has failed ${MAX_VERIFY_RETRIES} times. Stop retrying and ask the user for guidance.`,
      );
    }

    // Add tool results to messages for the next model call
    const assistantToolMessage = {
      role: "assistant" as const,
      content: responseText,
    };
    messages.push(assistantToolMessage);

    const toolResultsMessage = {
      role: "user" as const,
      content: `Tool execution results:\n\n${toolResults.join("\n\n---\n\n")}`,
    };
    messages.push(toolResultsMessage);
  }

  // Run DanteForge pipeline on touched files
  if (touchedFiles.length > 0) {
    process.stdout.write(`\n${CYAN}${BOLD}DanteForge Pipeline${RESET}\n`);

    for (const filePath of touchedFiles) {
      try {
        const content = await readFile(filePath, "utf-8");
        const { passed, summary } = await runDanteForge(
          content,
          filePath,
          session.projectRoot,
          config.verbose,
        );
        process.stdout.write(`\n${DIM}File: ${filePath}${RESET}\n${summary}\n`);

        if (passed) {
          await recordSuccessPattern(
            {
              pattern: `DanteForge pass: ${filePath}`,
              correction:
                "Preserve the verified structure that passed anti-stub, constitution, and PDSE checks.",
              filePattern: filePath,
              language: config.state.project.language || undefined,
              framework: config.state.project.framework,
              occurrences: 1,
              lastSeen: new Date().toISOString(),
            },
            session.projectRoot,
          );
        }

        // Track file in session active files
        if (!session.activeFiles.includes(filePath)) {
          session.activeFiles.push(filePath);
        }
      } catch {
        process.stdout.write(`${DIM}Could not read ${filePath} for DanteForge analysis${RESET}\n`);
      }
    }
  }

  // Record patterns from this conversation for future lesson injection
  try {
    const conversationMessages = session.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: typeof m.content === "string" ? m.content : m.content.map((b) => b.text || "").join("\n"),
      }));
    await detectAndRecordPatterns(conversationMessages, session.projectRoot);
  } catch {
    // Non-fatal: pattern detection failure should not break the session
  }

  // Update session timestamp
  session.updatedAt = new Date().toISOString();

  if (localSandboxBridge) {
    await localSandboxBridge.shutdown();
  }

  return session;
}
