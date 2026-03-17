// ============================================================================
// @dantecode/cli — Agent Interaction Loop
// The core loop that sends user prompts to the model, processes tool calls,
// runs the DanteForge pipeline on generated code, and streams responses.
// ============================================================================

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ModelRouterImpl } from "@dantecode/core";
import {
  runAntiStubScanner,
  runLocalPDSEScorer,
  runConstitutionCheck,
} from "@dantecode/danteforge";
import type { Session, SessionMessage, DanteCodeState } from "@dantecode/config-types";
import { getStatus, autoCommit } from "@dantecode/git-engine";
import { executeTool, getToolDefinitions } from "./tools.js";

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
}

// ----------------------------------------------------------------------------
// System Prompt Builder
// ----------------------------------------------------------------------------

/**
 * Builds the system prompt sent to the model. Includes instructions for tool
 * use, the DanteForge doctrine, and project-specific context.
 */
function buildSystemPrompt(session: Session, config: AgentLoopConfig): string {
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
// DanteForge Pipeline
// ----------------------------------------------------------------------------

/**
 * Runs the DanteForge quality pipeline on generated code.
 * Steps: anti-stub scan -> constitution check -> PDSE score
 * Returns a summary of results.
 */
async function runDanteForge(
  code: string,
  filePath: string,
  projectRoot: string,
  verbose: boolean,
): Promise<{ passed: boolean; summary: string }> {
  const summaryLines: string[] = [];
  let passed = true;

  // Step 1: Anti-stub scan
  const antiStub = runAntiStubScanner(code, projectRoot, filePath);
  if (!antiStub.passed) {
    passed = false;
    summaryLines.push(
      `${RED}Anti-stub scan: FAILED${RESET} (${antiStub.hardViolations.length} hard violations)`,
    );
    if (verbose) {
      for (const v of antiStub.hardViolations.slice(0, 5) as Array<{
        line?: number;
        message: string;
      }>) {
        summaryLines.push(`  ${DIM}Line ${v.line ?? "?"}: ${v.message}${RESET}`);
      }
    }
  } else {
    summaryLines.push(`${GREEN}Anti-stub scan: PASSED${RESET}`);
  }

  // Step 2: Constitution check
  const constitution = runConstitutionCheck(code, filePath);
  const criticalViolations = constitution.violations.filter((v) => v.severity === "critical");
  if (criticalViolations.length > 0) {
    passed = false;
    summaryLines.push(
      `${RED}Constitution check: FAILED${RESET} (${criticalViolations.length} critical violations)`,
    );
    if (verbose) {
      for (const v of criticalViolations.slice(0, 5) as Array<{ line?: number; message: string }>) {
        summaryLines.push(`  ${DIM}Line ${v.line ?? "?"}: ${v.message}${RESET}`);
      }
    }
  } else {
    const warnings = constitution.violations.filter((v) => v.severity === "warning");
    if (warnings.length > 0) {
      summaryLines.push(
        `${YELLOW}Constitution check: PASSED with ${warnings.length} warning(s)${RESET}`,
      );
    } else {
      summaryLines.push(`${GREEN}Constitution check: PASSED${RESET}`);
    }
  }

  // Step 3: PDSE local score (model-based scoring deferred for speed)
  const pdse = runLocalPDSEScorer(code, projectRoot);
  if (!pdse.passedGate) {
    passed = false;
    summaryLines.push(`${RED}PDSE score: ${pdse.overall}/100 (BELOW threshold)${RESET}`);
  } else {
    summaryLines.push(`${GREEN}PDSE score: ${pdse.overall}/100${RESET}`);
  }

  if (verbose) {
    summaryLines.push(
      `  ${DIM}Completeness: ${pdse.completeness} | Correctness: ${pdse.correctness} | Clarity: ${pdse.clarity} | Consistency: ${pdse.consistency}${RESET}`,
    );
  }

  return { passed, summary: summaryLines.join("\n") };
}

// ----------------------------------------------------------------------------
// Track Written Files for DanteForge
// ----------------------------------------------------------------------------

/**
 * Checks if a tool call writes code to a file and returns the file path.
 */
function getWrittenFilePath(toolName: string, toolInput: Record<string, unknown>): string | null {
  if (toolName === "Write" || toolName === "Edit") {
    const filePath = toolInput["file_path"] as string | undefined;
    if (filePath) {
      // Only run DanteForge on code files
      const codeExtensions = [
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
        ".c",
        ".cpp",
        ".h",
      ];
      const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
      if (codeExtensions.includes(ext)) {
        return filePath;
      }
    }
  }
  return null;
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
 * Keeps the first message (system prompt) and the most recent messages,
 * replacing older messages with a brief summary note.
 * (Pattern from opencode/OpenHands)
 */
function compactMessages(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  contextWindow: number,
): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  // Only compact when above 75% of context window
  if (estimatedTokens < contextWindow * 0.75) {
    return messages;
  }

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

// ----------------------------------------------------------------------------
// Pre-Tool Safety Hooks (Ruflo/ccswarm pattern)
// ----------------------------------------------------------------------------

/** Dangerous Bash command patterns that should be blocked. */
const DANGEROUS_BASH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Filesystem destruction
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+\/\s*$/m, reason: "recursive delete of root filesystem" },
  { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r?\s+\/\s*$/m, reason: "forced delete of root filesystem" },
  { pattern: /\brm\s+-rf\s+\/(?:\s|$)/m, reason: "rm -rf / — catastrophic filesystem delete" },
  { pattern: /\brm\s+-rf\s+~\s*$/m, reason: "rm -rf ~ — delete entire home directory" },
  // Git destructive operations
  { pattern: /\bgit\s+push\s+--force\s+(origin\s+)?(main|master)\b/, reason: "force push to main/master" },
  { pattern: /\bgit\s+reset\s+--hard\s+origin\/(main|master)\b/, reason: "hard reset to remote main/master" },
  // System attacks
  { pattern: /:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;?\s*:/, reason: "fork bomb detected" },
  { pattern: /\bdd\s+if=\/dev\/(zero|random|urandom)\s+of=\/dev\/[sh]d/, reason: "disk overwrite with dd" },
  { pattern: /\bmkfs\b/, reason: "filesystem format command" },
  { pattern: /\bchmod\s+-R\s+777\s+\/\s*$/, reason: "chmod 777 on root filesystem" },
  // Pipe-to-shell
  { pattern: /\bcurl\s+.*\|\s*(ba)?sh\b/, reason: "pipe remote script to shell" },
  { pattern: /\bwget\s+.*\|\s*(ba)?sh\b/, reason: "pipe remote script to shell" },
  // find with destructive actions
  { pattern: /\bfind\s+\/\s+.*-delete\b/, reason: "find with -delete on root filesystem" },
  { pattern: /\bfind\s+\/\s+.*-exec\s+rm\b/, reason: "find with -exec rm on root filesystem" },
  { pattern: /\bfind\s+~\s+.*-delete\b/, reason: "find with -delete on home directory" },
  // Scripting language destructive commands
  { pattern: /\bpython[23]?\s+(-c\s+)?.*shutil\.rmtree\s*\(/, reason: "Python shutil.rmtree — recursive delete" },
  { pattern: /\bnode\s+(-e\s+)?.*fs\.(rmSync|rmdirSync)\s*\(/, reason: "Node.js destructive fs operation" },
  // Env exfiltration
  { pattern: /\benv\b.*\|\s*(curl|wget|nc|netcat)\b/, reason: "environment variable exfiltration via network" },
  { pattern: /\bprintenv\b.*\|\s*(curl|wget|nc|netcat)\b/, reason: "printenv piped to network tool" },
  { pattern: /\bcat\s+.*\.env\b.*\|\s*(curl|wget|nc|netcat)\b/, reason: ".env file exfiltration via network" },
  // Privilege escalation
  { pattern: /\bchown\s+-R\s+root\b/, reason: "recursive chown to root" },
  { pattern: /\bchmod\s+[ugo]*\+s\b/, reason: "setuid/setgid bit modification" },
  // Block device redirect
  { pattern: />\s*\/dev\/sd[a-z]\b/, reason: "redirect to block device" },
  { pattern: /\bshred\s+/, reason: "shred command — secure file destruction" },
];

/**
 * Pre-tool safety hook: checks Bash commands for dangerous patterns.
 * Returns null if safe, or a blocking reason string if dangerous.
 */
function checkBashSafety(command: string): string | null {
  for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return reason;
    }
  }
  return null;
}

/**
 * Semantic safety layer: normalizes a command and checks for compound
 * patterns that individual regex checks might miss.
 *
 * Handles command chaining (;, &&, ||), backslash-escaped commands (\rm),
 * base64-encoded payloads, and eval with variable expansion.
 */
function normalizeAndCheckBash(command: string): string | null {
  // Expand backslash-escaped command names (\rm -> rm)
  const normalized = command.replace(/\\([a-zA-Z])/g, "$1");

  // Split on command chain operators and check each segment
  const segments = normalized.split(/\s*(?:;|&&|\|\|)\s*/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const blockReason = checkBashSafety(trimmed);
    if (blockReason) return blockReason;
  }

  // Check for base64-encoded payloads piped to shell
  if (/\b(base64\s+-d|echo\s+[A-Za-z0-9+/=]{20,})\s*\|\s*(ba)?sh\b/.test(normalized)) {
    return "base64-encoded payload piped to shell";
  }

  // Check for eval with variable expansion
  if (/\beval\s+.*\$\{?[A-Z_]/.test(normalized)) {
    return "eval with environment variable expansion";
  }

  // Check the full normalized command against patterns
  return checkBashSafety(normalized);
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

  // Build system prompt
  const systemPrompt = buildSystemPrompt(session, config);

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

  while (maxToolRounds > 0) {
    maxToolRounds--;

    // Context compaction (opencode/OpenHands pattern): condense old messages
    // when approaching the context window limit
    const compacted = compactMessages(messages, config.state.model.default.contextWindow);
    if (compacted.length < messages.length) {
      messages.splice(0, messages.length, ...compacted);
      if (config.verbose) {
        process.stdout.write(`${DIM}[context compacted: ${messages.length} messages remaining]${RESET}\n`);
      }
    }

    // Generate response from model
    let responseText: string;
    try {
      if (!config.silent) {
        process.stdout.write(`\n${CYAN}${BOLD}DanteCode${RESET} ${DIM}(thinking...)${RESET}\n\n`);
      }

      responseText = await router.generate(messages, {
        system: systemPrompt,
        maxTokens: config.state.model.default.maxTokens,
      });

      totalTokensUsed += responseText.length; // Approximate token count

      // Model-assisted complexity scoring: extract on first response
      if (!router.getModelRatedComplexity()) {
        const modelScore = router.extractModelComplexityRating(responseText);
        if (config.verbose && modelScore !== null) {
          process.stdout.write(
            `${DIM}[complexity: model=${modelScore.toFixed(2)}]${RESET}\n`,
          );
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

    // Extract tool calls from the response
    const { cleanText, toolCalls } = extractToolCalls(responseText);

    // Display the assistant's text response (suppressed in silent mode)
    if (cleanText.length > 0 && !config.silent) {
      process.stdout.write(`${cleanText}\n`);
    }

    // If no tool calls, we're done with this turn
    if (toolCalls.length === 0) {
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

      const result = await executeTool(
        toolCall.name,
        toolCall.input,
        session.projectRoot,
        session.id,
      );

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
      process.stdout.write(`\r${DIM}[${toolCalls.length}/${toolCalls.length} tools done]${RESET}\n`);
    }

    // Reflection loop (aider/Cursor pattern): after code edits, auto-run
    // the project's configured lint/test/build commands. If any fail,
    // inject the failure output so the model can fix the issue.
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
            toolResults.push(
              `AUTO-VERIFY (${vc.name}) FAILED:\n${vcResult.content}\n\nFix the errors above. (attempt ${verifyRetries}/${MAX_VERIFY_RETRIES})`,
            );
            process.stdout.write(
              `\n${YELLOW}[verify: ${vc.name} FAILED]${RESET} ${DIM}(retry ${verifyRetries}/${MAX_VERIFY_RETRIES})${RESET}\n`,
            );
          } else {
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
        const { summary } = await runDanteForge(
          content,
          filePath,
          session.projectRoot,
          config.verbose,
        );
        process.stdout.write(`\n${DIM}File: ${filePath}${RESET}\n${summary}\n`);

        // Track file in session active files
        if (!session.activeFiles.includes(filePath)) {
          session.activeFiles.push(filePath);
        }
      } catch {
        process.stdout.write(`${DIM}Could not read ${filePath} for DanteForge analysis${RESET}\n`);
      }
    }
  }

  // Update session timestamp
  session.updatedAt = new Date().toISOString();

  return session;
}
