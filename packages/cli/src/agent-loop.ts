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
  SessionStore,
  estimateMessageTokens,
  getContextUtilization,
  isProtectedWriteTarget,
  promptRequestsToolExecution,
  responseNeedsToolExecutionNudge,
  parseVerificationErrors,
  formatErrorsForFixPrompt,
  computeErrorSignature,
  runStartupHealthCheck,
  getCurrentWave,
  advanceWave,
  buildWavePrompt,
  isWaveComplete,
  CLAUDE_WORKFLOW_MODE,
  ApproachMemory,
  formatApproachesForPrompt,
} from "@dantecode/core";
import type { WaveOrchestratorState } from "@dantecode/core";
import {
  recordSuccessPattern,
  queryLessons,
  formatLessonsForPrompt,
  detectAndRecordPatterns,
} from "@dantecode/danteforge";
import { runDanteForge, getWrittenFilePath } from "./danteforge-pipeline.js";
import type {
  Session,
  SessionMessage,
  DanteCodeState,
  ModelConfig,
  SelfImprovementContext,
} from "@dantecode/config-types";
import {
  getStatus,
  autoCommit,
  generateRepoMap,
  formatRepoMapForContext,
} from "@dantecode/git-engine";
import { executeTool, getToolDefinitions, type SubAgentExecutor, type SubAgentOptions, type SubAgentResult } from "./tools.js";
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
  selfImprovement?: SelfImprovementContext;
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
  /**
   * Minimum number of tool rounds required to complete the task.
   * Set by pipeline orchestrators (e.g., /magic, /autoforge) to override the
   * default maxToolRounds=15 when more rounds are needed.
   */
  requiredRounds?: number;
  /**
   * Whether a skill is currently active. When true, pipeline continuation
   * protections (nudge, elevated round budget) activate regardless of the
   * prompt text — ensuring ALL skills run to completion.
   */
  skillActive?: boolean;
  /**
   * Wave orchestrator state for step-by-step skill execution.
   * When present, the agent loop feeds one wave at a time and enforces
   * verification gates between waves (Claude Workflow Mode).
   */
  waveState?: WaveOrchestratorState;
}

/** Entry in the approach memory log, tracking tried strategies and outcomes. */
export interface ApproachLogEntry {
  description: string;
  outcome: "success" | "failed" | "partial";
  toolCalls: number;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** How often (in tool calls) to emit a progress line. */
const PROGRESS_EMIT_INTERVAL = 5;

/** Planning instruction injected for complex tasks. */
const PLANNING_INSTRUCTION =
  "Before executing, create a brief plan:\n" +
  "1. What files need to change and why?\n" +
  "2. What's the approach? (Read → Edit → Verify cycle)\n" +
  "3. What could go wrong? (edge cases, breaking changes, missing imports)\n" +
  "4. What's the verification strategy? (tests, typecheck, manual check)\n" +
  "Then execute the plan step by step. After each major change, verify before moving on.";

/** Pivot instruction injected after 2 consecutive same-signature failures. */
const PIVOT_INSTRUCTION =
  "The same approach has failed twice. STOP and reconsider:\n" +
  "- What assumption might be wrong?\n" +
  "- Is there an alternative tool or method?\n" +
  "- Should we read more context first?";

const EXECUTION_CONTINUATION_PATTERN = /^(?:please\s+)?(?:continue|resume|run|verify)\b/i;
const EXECUTION_WORKFLOW_PATTERN = /^\/(?:autoforge|party|magic|forge|verify|ship)\b/i;

/** Detects premature wrap-up responses that should trigger pipeline continuation. */
const PREMATURE_SUMMARY_PATTERN =
  /(?:^|\n)\s*(?:#{1,3}\s*)?(?:summary|results?|complete|done|finished|all\s+(?:done|complete)|pipeline\s+complete)/i;

/** Max pipeline continuation nudges before allowing the model to stop. */
const MAX_PIPELINE_CONTINUATION_NUDGES = 3;

/** Pipeline continuation instruction injected when the model stops mid-pipeline. */
const PIPELINE_CONTINUATION_INSTRUCTION =
  "You stopped mid-pipeline with a summary/status response, but the task is NOT complete. " +
  "The pipeline still has remaining steps. Do NOT summarize — continue executing the next " +
  "step immediately with tool calls. If you are unsure what step is next, re-read your " +
  "todo list or the pipeline plan and continue from where you left off.";

// ----------------------------------------------------------------------------
// Anti-confabulation guards (Grok empty-response / phantom-completion fix)
// ----------------------------------------------------------------------------

/** Max consecutive empty responses (no text + no tool calls) before aborting. */
const MAX_CONSECUTIVE_EMPTY_ROUNDS = 3;

/** Max anti-confabulation nudges (model claims completion but 0 files modified). */
const MAX_CONFABULATION_NUDGES = 2;

// ----------------------------------------------------------------------------
// Structured reasoning checkpoints
// ----------------------------------------------------------------------------

/** How many tool calls between automatic reflection checkpoints. */
const REFLECTION_CHECKPOINT_INTERVAL = 15;

/** Reflection prompt injected at checkpoints to force chain-of-thought reasoning. */
const REFLECTION_PROMPT =
  "REFLECTION CHECKPOINT: Pause and evaluate your progress.\n" +
  "1. What have you accomplished so far?\n" +
  "2. Are you on track to solve the original problem?\n" +
  "3. Have you missed anything (untested edge cases, unread files, incomplete changes)?\n" +
  "4. What is the most important next step?\n" +
  "Continue with the most impactful action.";

/** Write payload size (chars) above which a truncation warning is emitted. */
const WRITE_SIZE_WARNING_THRESHOLD = 30_000;

/** Warning injected when model returns empty response. */
const EMPTY_RESPONSE_WARNING =
  "You returned an empty response with no tool calls. This may indicate a compatibility " +
  "issue. Execute the next step using a tool (Read, Edit, Write, Bash, Glob, Grep). " +
  "If you cannot proceed, explain what is blocking you.";

/** Warning injected when model claims completion but no files were modified. */
const CONFABULATION_WARNING =
  "You claimed to complete work, but NO files were actually modified in this session " +
  "(filesModified === 0). You MUST use Edit or Write tools to make real file changes. " +
  "Do NOT narrate changes without executing tool calls. Resume and actually execute " +
  "the next step with real tool calls.";

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
  ];

  // Skill execution: when a skill is active, inject either the full Claude Workflow
  // Mode (if wave orchestration is active) or the basic tool recipes + execution protocol.
  if (config.skillActive) {
    if (config.waveState && config.waveState.waves.length > 1) {
      // Wave orchestration: inject Claude Workflow Mode + current wave prompt
      sections.push(CLAUDE_WORKFLOW_MODE, "", buildWavePrompt(config.waveState), "");
    } else {
      // No wave structure detected: inject tool recipes + basic execution protocol.
      // This teaches non-Claude models (Grok, GPT, etc.) how to perform operations
      // that Claude Code handles natively using Bash equivalents.
      sections.push(
        "## Tool Recipes for Skill Execution",
        "",
        "When executing skills, you may need capabilities beyond the basic tool set.",
        "Use Bash to access these — do NOT skip steps because a dedicated tool is missing.",
        "",
        "### Searching GitHub",
        "```bash",
        'gh search repos "react state management" --limit 10 --json name,url,description,stargazersCount',
        "```",
        "To search code: `gh search code \"pattern\" --limit 10 --json path,repository`",
        "",
        "### Fetching Web Content",
        "```bash",
        "curl -sL 'https://example.com/page' | head -200",
        "```",
        "",
        "### Cloning and Analyzing Repositories",
        "```bash",
        "git clone --depth 1 'https://github.com/org/repo.git' /tmp/oss-scan/reponame",
        "```",
        "Then use Glob, Grep, and Read to analyze the cloned repository.",
        "",
        "### GitHub API Queries",
        "```bash",
        "gh api repos/owner/repo --jq '.stargazers_count, .license.spdx_id'",
        "gh api 'search/repositories?q=topic:state-management+language:typescript&sort=stars' --jq '.items[:5] | .[].full_name'",
        "```",
        "",
        "## Skill Execution Protocol",
        "",
        "You are executing a multi-step skill workflow. Follow this protocol STRICTLY:",
        "",
        "1. **DECOMPOSE FIRST**: Use TodoWrite to create a numbered checklist of all steps before doing any work.",
        "2. **READ BEFORE EDIT**: Always Read a file before modifying it. Never edit blind.",
        "3. **ONE STEP AT A TIME**: Complete one step fully, verify it, then advance to the next.",
        "4. **EVERY RESPONSE = TOOL CALLS**: Never respond with only text/narration. Every response MUST include at least one tool call.",
        "5. **VERIFY EACH STEP**: After completing a step, verify with a concrete check (Read the file, run a test, check git status).",
        "6. **UPDATE PROGRESS**: Mark each TodoWrite item as completed before starting the next.",
        "7. **USE BASH FOR EXTERNAL OPS**: GitHub search, web fetch, repo cloning — use Bash with the recipes above.",
        "8. **NEVER CONFABULATE**: Only claim a file was modified AFTER a successful Edit/Write tool result. Only claim tests pass AFTER a successful Bash test result.",
        "",
      );
    }
  }

  sections.push(
    "## Project Context",
    "",
    `Project root: ${session.projectRoot}`,
  );

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

  // Cross-session learning: inject summaries of recent sessions for this project
  try {
    const sessionStore = new SessionStore(session.projectRoot);
    const recentSummaries = await sessionStore.getRecentSummaries(3);
    // Filter out the current session
    const pastSummaries = recentSummaries.filter((s) => s.id !== session.id);
    if (pastSummaries.length > 0) {
      sections.push("", "## Recent Session Context", "");
      for (const s of pastSummaries) {
        const dateStr = new Date(s.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        sections.push(`- ${dateStr}: ${s.summary}`);
      }
    }
  } catch {
    // Non-fatal: cross-session context failure should not break the agent
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

function escapeLiteralControlCharsInJsonStrings(payload: string): string {
  let result = "";
  let inString = false;
  let escaping = false;

  for (const char of payload) {
    if (escaping) {
      result += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaping = true;
      continue;
    }

    if (char === '"') {
      result += char;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (char === "\n") {
        result += "\\n";
        continue;
      }
      if (char === "\r") {
        result += "\\r";
        continue;
      }
      if (char === "\t") {
        result += "\\t";
        continue;
      }
    }

    result += char;
  }

  return result;
}

function parseToolCallPayload(
  payload: string,
): { name?: string; input?: Record<string, unknown> } | null {
  try {
    return JSON.parse(payload) as { name?: string; input?: Record<string, unknown> };
  } catch {
    try {
      return JSON.parse(escapeLiteralControlCharsInJsonStrings(payload)) as {
        name?: string;
        input?: Record<string, unknown>;
      };
    } catch {
      return null;
    }
  }
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
    const parsed = parseToolCallPayload(match[1]!);
    if (parsed?.name && parsed.input) {
      toolCalls.push({
        id: randomUUID(),
        name: parsed.name,
        input: parsed.input,
      });
    }
    cleanText = cleanText.replace(match[0], "");
  }

  // Pattern 2: JSON blocks with tool call structure
  const jsonBlockPattern =
    /```(?:json)?\s*\n(\{[\s\S]*?"name"\s*:\s*"(?:Read|Write|Edit|Bash|Glob|Grep|GitCommit|GitPush|TodoWrite|WebSearch|WebFetch|SubAgent|GitHubSearch)"[\s\S]*?\})\s*\n```/g;

  while ((match = jsonBlockPattern.exec(text)) !== null) {
    const parsed = parseToolCallPayload(match[1]!);
    if (parsed?.name && parsed.input) {
      toolCalls.push({
        id: randomUUID(),
        name: parsed.name,
        input: parsed.input,
      });
      cleanText = cleanText.replace(match[0], "");
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

const CODE_FILE_EXTENSIONS = new Set([
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

interface MajorEditBatchGateResult {
  passed: boolean;
  failedSteps: string[];
}

function isCodeLikeFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return Array.from(CODE_FILE_EXTENSIONS).some((extension) => normalized.endsWith(extension));
}

function isWorktreeProjectRoot(projectRoot: string): boolean {
  const normalized = projectRoot.replace(/\\/g, "/");
  return normalized.includes("/.dantecode/worktrees/");
}

function isMajorEditBatch(files: string[], projectRoot: string): boolean {
  const codeFiles = [...new Set(files.filter(isCodeLikeFile))];
  if (codeFiles.length === 0) {
    return false;
  }

  return (
    codeFiles.some((filePath) => isProtectedWriteTarget(filePath, projectRoot)) ||
    (isWorktreeProjectRoot(projectRoot) && codeFiles.length > 1)
  );
}

async function runMajorEditBatchGate(
  session: Session,
  roundCounter: number,
  config: AgentLoopConfig,
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
    const gateResult = await executeTool("Bash", { command: step.command }, session.projectRoot, {
      sessionId: session.id,
      roundId: `round-${roundCounter}-gstack`,
      sandboxEnabled: false,
      selfImprovement: config.selfImprovement,
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
function summarizeDroppedMessages(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
): string {
  const filesRead = new Set<string>();
  const filesEdited = new Set<string>();
  const bashCommands: string[] = [];
  const keyDecisions: string[] = [];

  for (const msg of messages) {
    const text = msg.content;

    // Extract file reads
    const readMatches = text.matchAll(/(?:Read|read|Reading)\s+[`"]?([^\s`"]+\.\w+)/g);
    for (const m of readMatches) filesRead.add(m[1]!);

    // Extract file edits/writes
    const editMatches = text.matchAll(/(?:Edit|Write|Edited|Wrote|Modified)\s+[`"]?([^\s`"]+\.\w+)/g);
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

/**
 * Extract file paths the model claims to have modified from its response text.
 * Looks for patterns like "I updated/modified/edited <path>" or "Write to <path>".
 */
function extractClaimedFiles(text: string): string[] {
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

function isExecutionContinuationPrompt(prompt: string, session: Session): boolean {
  if (!EXECUTION_CONTINUATION_PATTERN.test(prompt.trim())) {
    return false;
  }

  const priorMessages = session.messages.slice(0, -1);
  return priorMessages.some((message) => {
    if (message.toolUse || message.toolResult) {
      return true;
    }
    // Detect skill activation system messages — any activated skill means
    // "continue" should be treated as an execution continuation.
    if (
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.startsWith('Activated skill "')
    ) {
      return true;
    }
    return (
      message.role === "user" &&
      typeof message.content === "string" &&
      EXECUTION_WORKFLOW_PATTERN.test(message.content.trim())
    );
  });
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
/**
 * Creates a sub-agent executor function that can be passed to the tool
 * execution context. The executor clones the parent session and runs
 * a fresh agent loop with constrained rounds.
 */
function createSubAgentExecutor(
  parentSession: Session,
  parentConfig: AgentLoopConfig,
): SubAgentExecutor {
  // Track background tasks for async sub-agent execution
  const backgroundTasks = new Map<string, Promise<SubAgentResult>>();
  const completedTasks = new Map<string, SubAgentResult>();

  async function executeSubAgent(
    prompt: string,
    projectRoot: string,
    maxRounds: number,
  ): Promise<SubAgentResult> {
    const startTime = Date.now();

    const childSession: Session = {
      id: `sub-${parentSession.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`,
      projectRoot,
      messages: [],
      activeFiles: [],
      readOnlyFiles: [],
      model: parentSession.model,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentStack: [
        ...(parentSession.agentStack ?? []),
        {
          agentId: `subagent-${randomUUID().slice(0, 8)}`,
          agentType: "sub-agent",
          startedAt: new Date().toISOString(),
          touchedFiles: [],
          status: "running" as const,
          subAgentIds: [],
        },
      ],
      todoList: [],
    };

    const childConfig: AgentLoopConfig = {
      ...parentConfig,
      requiredRounds: maxRounds,
      silent: true,
      onToken: undefined,
      abortSignal: parentConfig.abortSignal,
    };

    try {
      const completedSession = await runAgentLoop(prompt, childSession, childConfig);

      const assistantMsgs = completedSession.messages.filter(
        (m: SessionMessage) => m.role === "assistant",
      );
      const lastMsg = assistantMsgs[assistantMsgs.length - 1];
      const output = lastMsg?.content ?? "(no output)";

      const touchedFiles: string[] = [];
      for (const msg of completedSession.messages) {
        if (msg.role === "assistant" && typeof msg.content === "string") {
          const writeMatches = msg.content.matchAll(/Successfully (?:wrote|edited) ([^\s(]+)/g);
          for (const match of writeMatches) {
            if (match[1]) touchedFiles.push(match[1]);
          }
        }
      }

      return {
        output: typeof output === "string" ? output : JSON.stringify(output),
        touchedFiles,
        durationMs: Date.now() - startTime,
        success: true,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        output: "",
        touchedFiles: [],
        durationMs: Date.now() - startTime,
        success: false,
        error: message,
      };
    }
  }

  return async (prompt: string, options?: SubAgentOptions): Promise<SubAgentResult> => {
    const maxRounds = options?.maxRounds ?? 30;

    // Handle background task status queries
    if (prompt.startsWith("status ")) {
      const taskId = prompt.slice(7).trim();
      const completed = completedTasks.get(taskId);
      if (completed) {
        return completed;
      }
      if (backgroundTasks.has(taskId)) {
        return {
          output: `Background task ${taskId} is still running.`,
          touchedFiles: [],
          durationMs: 0,
          success: true,
        };
      }
      return {
        output: `No background task found with ID: ${taskId}`,
        touchedFiles: [],
        durationMs: 0,
        success: false,
        error: "Task not found",
      };
    }

    // Worktree isolation: create isolated branch for this agent
    let worktreeDir: string | undefined;
    if (options?.worktreeIsolation && parentConfig.enableGit) {
      try {
        const { createWorktree } = await import("@dantecode/git-engine");
        const sessionId = `sub-${randomUUID().slice(0, 8)}`;
        const result = createWorktree({
          directory: parentSession.projectRoot,
          branch: `agent-${sessionId}`,
          baseBranch: "HEAD",
          sessionId,
        });
        worktreeDir = result.directory;
      } catch {
        // Worktree creation failed — fall back to shared directory
      }
    }

    const workDir = worktreeDir ?? parentSession.projectRoot;

    // Background execution: queue task and return immediately
    if (options?.background) {
      const taskId = randomUUID().slice(0, 12);
      const taskPromise = executeSubAgent(prompt, workDir, maxRounds).then((result) => {
        completedTasks.set(taskId, result);
        backgroundTasks.delete(taskId);
        // Clean up worktree after background task completes
        if (worktreeDir) {
          import("@dantecode/git-engine")
            .then(({ removeWorktree }) => removeWorktree(worktreeDir!))
            .catch(() => {});
        }
        return result;
      });
      backgroundTasks.set(taskId, taskPromise);
      return {
        output: `Background task started: ${taskId}. Use SubAgent with prompt "status ${taskId}" to check progress.`,
        touchedFiles: [],
        durationMs: 0,
        success: true,
      };
    }

    // Synchronous execution with worktree cleanup
    try {
      return await executeSubAgent(prompt, workDir, maxRounds);
    } finally {
      if (worktreeDir) {
        try {
          const { removeWorktree } = await import("@dantecode/git-engine");
          removeWorktree(worktreeDir);
        } catch {
          // Best-effort cleanup
        }
      }
    }
  };
}

// Module-level flag: run startup health check only once per process.
let _healthCheckCompleted = false;

export async function runAgentLoop(
  prompt: string,
  session: Session,
  config: AgentLoopConfig,
): Promise<Session> {
  // Run startup health check on first invocation only
  if (!_healthCheckCompleted) {
    _healthCheckCompleted = true;
    try {
      const healthResult = await runStartupHealthCheck({ projectRoot: session.projectRoot });
      if (!healthResult.healthy) {
        process.stdout.write(
          `${YELLOW}[health] Some checks failed — see warnings above. Proceeding anyway.${RESET}\n`,
        );
      }
    } catch {
      // Health check failure is non-fatal — never block the agent loop
    }
  }

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
  // Dynamic round budget: pipeline orchestrators can request more rounds via requiredRounds.
  // When a skill is active (skillActive), default to 50 rounds to ensure completion.
  let maxToolRounds = config.requiredRounds
    ? Math.max(config.requiredRounds, 15)
    : config.skillActive
      ? 50
      : 15;
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
  // Pipeline continuation: prevent premature wrap-up during multi-step pipelines
  let pipelineContinuationNudges = 0;
  // CLI auto-continuation: refill round budget when exhausted mid-pipeline
  let autoContinuations = 0;
  const MAX_AUTO_CONTINUATIONS = 3;
  // Anti-confabulation guards
  let consecutiveEmptyRounds = 0;
  let confabulationNudges = 0;
  const isPipelineWorkflow =
    config.skillActive ||
    EXECUTION_WORKFLOW_PATTERN.test(prompt) ||
    isExecutionContinuationPrompt(prompt, session);

  // ---- Feature: Planning phase (for complex tasks) ----
  // Inject planning instruction before first model call when complexity >= 0.7
  const planningEnabled = lexicalComplexity >= 0.7;
  let planGenerated = false;

  // ---- Feature: Approach memory ----
  // Track what approaches were tried and their outcomes within this session
  const approachLog: ApproachLogEntry[] = [];
  let currentApproachDescription = "";
  let currentApproachToolCalls = 0;

  // Persistent approach memory: load historical approaches for similar tasks
  const persistentMemory = new ApproachMemory(session.projectRoot);
  let historicalFailures: string | undefined;
  try {
    const failed = await persistentMemory.getFailedApproaches(prompt, 5);
    if (failed.length > 0) {
      historicalFailures = formatApproachesForPrompt(failed);
    }
  } catch {
    // Non-fatal
  }

  // ---- Feature: Pivot logic ----
  // Track consecutive failures with similar error signatures for strategy change.
  // This is different from the existing tier escalation — it's about changing
  // strategy, not just using a better model.
  let consecutiveSameSignatureFailures = 0;
  let lastPivotErrorSignature = "";

  // ---- Feature: Progress tracking ----
  // Simple counters emitted to the session periodically
  let toolCallsThisTurn = 0;
  let filesModified = 0;
  let testsRun = 0;
  let roundCounter = 0;
  let lastMajorEditGatePassed = true;
  const readTracker = new Map<string, string>();
  const editAttempts = new Map<string, number>();

  if (config.verbose && thinkingBudget) {
    process.stdout.write(
      `${DIM}[thinking: ${config.state.model.default.provider}/${config.state.model.default.modelId}, budget=${thinkingBudget}]${RESET}\n`,
    );
  }

  // Planning phase: for complex tasks, inject a planning instruction into messages
  // so the model creates a plan before diving into execution
  if (planningEnabled) {
    let planContent = `## Planning Required (complexity: ${lexicalComplexity.toFixed(2)})\n\n${PLANNING_INSTRUCTION}`;
    if (historicalFailures) {
      planContent += `\n\n## Previously Failed Approaches (from past sessions)\n${historicalFailures}\nAvoid repeating these failed strategies.`;
    }
    messages.push({
      role: "system" as const,
      content: planContent,
    });
    if (!config.silent) {
      process.stdout.write(
        `${DIM}[planning: enabled — complexity ${lexicalComplexity.toFixed(2)} >= 0.7]${RESET}\n`,
      );
    }
  }

  while (maxToolRounds > 0) {
    // CLI auto-continuation: when rounds just hit 0 mid-pipeline, refill budget
    if (maxToolRounds <= 1 && isPipelineWorkflow && autoContinuations < MAX_AUTO_CONTINUATIONS && filesModified > 0) {
      autoContinuations++;
      maxToolRounds += config.skillActive ? 50 : 15;
      messages.push({
        role: "user" as const,
        content: "Continue executing remaining steps. Do not summarize — keep working.",
      });
      if (!config.silent) {
        process.stdout.write(
          `\n${YELLOW}[auto-continue ${autoContinuations}/${MAX_AUTO_CONTINUATIONS}]${RESET} ${DIM}(rounds low mid-pipeline — refilling budget)${RESET}\n`,
        );
      }
    }

    maxToolRounds--;
    roundCounter++;

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

      // Planning phase: track whether the first response contains a plan
      if (planningEnabled && !planGenerated) {
        planGenerated = true;
        // Capture the plan description from the first response for approach memory
        const planMatch = responseText.match(/(?:plan|approach|strategy)[:\s]*([\s\S]{10,200})/i);
        if (planMatch) {
          currentApproachDescription = planMatch[1]!.trim().slice(0, 150);
        } else {
          currentApproachDescription = responseText.slice(0, 150).trim();
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

    // ---- Anti-confabulation: empty response circuit breaker ----
    // If the model returned no text and no tool calls, track consecutive empties
    // and abort after MAX_CONSECUTIVE_EMPTY_ROUNDS (Grok empty-response fix).
    if (responseText.trim().length === 0 && toolCalls.length === 0) {
      consecutiveEmptyRounds++;
      if (!config.silent) {
        process.stdout.write(
          `\n${YELLOW}[confab-guard] empty response (${consecutiveEmptyRounds}/${MAX_CONSECUTIVE_EMPTY_ROUNDS})${RESET}\n`,
        );
      }
      if (consecutiveEmptyRounds >= MAX_CONSECUTIVE_EMPTY_ROUNDS) {
        process.stdout.write(
          `\n${RED}${BOLD}[confab-guard] ${MAX_CONSECUTIVE_EMPTY_ROUNDS} consecutive empty responses — aborting${RESET}\n`,
        );
        session.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: `The model returned ${MAX_CONSECUTIVE_EMPTY_ROUNDS} consecutive empty responses. This typically indicates a model compatibility issue. Try a different model or simplify your request.`,
          timestamp: new Date().toISOString(),
        });
        break;
      }
      messages.push({ role: "assistant" as const, content: "(empty response)" });
      messages.push({ role: "user" as const, content: EMPTY_RESPONSE_WARNING });
      continue;
    }
    if (toolCalls.length > 0) {
      consecutiveEmptyRounds = 0;
    }

    // Display the assistant's text response (suppressed in silent mode)
    if (cleanText.length > 0 && !config.silent) {
      process.stdout.write(`${cleanText}\n`);
    }

    // If no tool calls, we're done with this turn
    if (toolCalls.length === 0) {
      if (
        executedToolsThisTurn === 0 &&
        (promptRequestsToolExecution(prompt) || isExecutionContinuationPrompt(prompt, session)) &&
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
            "You described the intended work but did not use any tools. Stop narrating and actually execute the next step with Read, Write, Edit, Bash, Glob, Grep, GitCommit, GitPush, or TodoWrite. Only claim file changes after a successful tool result.",
        });
        if (!config.silent) {
          process.stdout.write(
            `\n${YELLOW}[nudge: execute with tools]${RESET} ${DIM}(no tool calls were emitted)${RESET}\n`,
          );
        }
        continue;
      }

      // Wave completion check: if the model signals [WAVE COMPLETE] and we have
      // wave orchestration active, advance to the next wave instead of stopping.
      if (
        config.waveState &&
        isWaveComplete(responseText) &&
        executedToolsThisTurn > 0 &&
        maxToolRounds > 0
      ) {
        const waveState = config.waveState;
        const completedWave = getCurrentWave(waveState);
        const hasMore = advanceWave(waveState);
        if (!config.silent && completedWave) {
          process.stdout.write(
            `\n${GREEN}[wave ${completedWave.number}/${waveState.waves.length} complete: ${completedWave.title}]${RESET}\n`,
          );
        }
        if (hasMore) {
          // Inject next wave prompt and continue
          const nextWavePrompt = buildWavePrompt(waveState);
          messages.push({ role: "assistant" as const, content: responseText });
          messages.push({ role: "user" as const, content: nextWavePrompt });
          if (!config.silent) {
            const next = getCurrentWave(waveState);
            process.stdout.write(
              `${CYAN}[advancing to wave ${next?.number}/${waveState.waves.length}: ${next?.title}]${RESET}\n`,
            );
          }
          // Reset per-wave counters
          pipelineContinuationNudges = 0;
          confabulationNudges = 0;
          continue;
        }
        // All waves complete — fall through to normal break
        if (!config.silent) {
          process.stdout.write(
            `\n${GREEN}${BOLD}[all ${waveState.waves.length} waves complete]${RESET}\n`,
          );
        }
      }

      // Pipeline continuation nudge: if we're in a pipeline workflow (e.g., /magic,
      // /autoforge) and the model emitted a summary-like response with no tool calls
      // but has clearly done work (executedToolsThisTurn > 0), it may be wrapping up
      // prematurely. Force it to continue unless we've already nudged too many times.
      if (
        isPipelineWorkflow &&
        executedToolsThisTurn > 0 &&
        maxToolRounds > 0 &&
        pipelineContinuationNudges < MAX_PIPELINE_CONTINUATION_NUDGES &&
        PREMATURE_SUMMARY_PATTERN.test(responseText)
      ) {
        pipelineContinuationNudges++;
        messages.push({
          role: "assistant",
          content: responseText,
        });
        messages.push({
          role: "user",
          content: PIPELINE_CONTINUATION_INSTRUCTION,
        });
        if (!config.silent) {
          process.stdout.write(
            `\n${YELLOW}[pipeline continuation ${pipelineContinuationNudges}/${MAX_PIPELINE_CONTINUATION_NUDGES}]${RESET} ${DIM}(model stopped mid-pipeline — nudging to continue)${RESET}\n`,
          );
        }
        continue;
      }

      // Anti-confabulation gate: if in a pipeline workflow and the model claims
      // completion/done but no files were actually modified, reject the claim.
      if (
        isPipelineWorkflow &&
        filesModified === 0 &&
        confabulationNudges < MAX_CONFABULATION_NUDGES &&
        PREMATURE_SUMMARY_PATTERN.test(responseText)
      ) {
        confabulationNudges++;
        messages.push({ role: "assistant" as const, content: responseText });
        messages.push({ role: "user" as const, content: CONFABULATION_WARNING });
        if (!config.silent) {
          process.stdout.write(
            `\n${RED}[confab-guard] model claims completion but 0 files modified (${confabulationNudges}/${MAX_CONFABULATION_NUDGES})${RESET}\n`,
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
    const roundWrittenFiles: string[] = [];
    let roundMajorEditGateResult: MajorEditBatchGateResult | null = null;
    let toolIndex = 0;

    for (const toolCall of toolCalls) {
      executedToolsThisTurn++;
      toolCallsThisTurn++;
      currentApproachToolCalls++;
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

      // Write size guard: block large Write payloads on existing files (force Edit).
      // Grok models try to rewrite entire files (50K+ chars) instead of using Edit.
      if (toolCall.name === "Write") {
        const writeContent = toolCall.input["content"] as string | undefined;
        if (writeContent && writeContent.length > WRITE_SIZE_WARNING_THRESHOLD) {
          const writeFilePath = toolCall.input["file_path"] as string | undefined;
          const fileExists = writeFilePath && readTracker.has(resolve(session.projectRoot, writeFilePath));
          if (fileExists) {
            // Block: model is rewriting an existing file with a massive payload
            if (!config.silent) {
              process.stdout.write(
                `\n${RED}[confab-guard] BLOCKED Write (${Math.round(writeContent.length / 1000)}K chars) to existing file. Use Edit for surgical changes.${RESET}\n`,
              );
            }
            toolResults.push(
              `SYSTEM: Write BLOCKED — your payload is ${Math.round(writeContent.length / 1000)}K characters, which will truncate and corrupt the file. ` +
              `The file "${writeFilePath}" already exists. Use the Edit tool for surgical changes instead of rewriting the entire file. ` +
              `Break your changes into multiple small Edit calls targeting specific sections.`,
            );
            continue;
          }
          // New file: warn but allow
          if (!config.silent) {
            process.stdout.write(
              `\n${YELLOW}[confab-guard] Write payload is ${Math.round(writeContent.length / 1000)}K chars — large file.${RESET}\n`,
            );
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

      // Premature commit blocker: block GitCommit/GitPush when no files have been
      // modified this session. Grok models confabulate file edits in their narrative
      // text, then try to commit non-existent changes.
      if (
        (toolCall.name === "GitCommit" || toolCall.name === "GitPush") &&
        filesModified === 0 &&
        isPipelineWorkflow
      ) {
        if (!config.silent) {
          process.stdout.write(
            `\n${RED}[confab-guard] BLOCKED ${toolCall.name} — 0 files modified this session. Write/Edit files first.${RESET}\n`,
          );
        }
        toolResults.push(
          `SYSTEM: ${toolCall.name} BLOCKED — you have not modified any files in this session (filesModified === 0). ` +
          `You cannot commit or push changes that do not exist. Use Edit or Write tools to make real file changes first, ` +
          `then commit. Do NOT claim you already made changes — only tool results count.`,
        );
        continue;
      }

      if (toolCall.name === "GitCommit" || toolCall.name === "GitPush") {
        if (isMajorEditBatch(roundWrittenFiles, session.projectRoot) && !roundMajorEditGateResult) {
          roundMajorEditGateResult = await runMajorEditBatchGate(
            session,
            roundCounter,
            config,
            readTracker,
            editAttempts,
          );
          lastMajorEditGatePassed = roundMajorEditGateResult.passed;

          if (!roundMajorEditGateResult.passed) {
            const failedSteps = roundMajorEditGateResult.failedSteps.join(", ");
            toolResults.push(
              `SYSTEM: ${toolCall.name} blocked. Major edit batch verification failed at the repository root (${failedSteps}). Fix typecheck, lint, and test before committing or pushing.`,
            );
            if (!config.silent) {
              process.stdout.write(`\n${RED}[gstack: blocked commit â€” ${failedSteps}]${RESET}\n`);
            }
            continue;
          }
        }

        if (!lastMajorEditGatePassed) {
          toolResults.push(
            `SYSTEM: ${toolCall.name} blocked because the last major edit batch failed repository-root verification. Fix the failing checks before attempting ${toolCall.name} again.`,
          );
          continue;
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
        result = await executeTool(toolCall.name, toolCall.input, session.projectRoot, {
          sessionId: session.id,
          roundId: `round-${roundCounter}`,
          sandboxEnabled: false,
          selfImprovement: config.selfImprovement,
          readTracker,
          editAttempts,
          subAgentExecutor: createSubAgentExecutor(session, config),
        });
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
        if (!result.isError && (toolCall.name === "Write" || toolCall.name === "Edit")) {
          roundWrittenFiles.push(resolvedPath);
        }
        // Progress tracking: count files modified
        filesModified++;
      }

      // Progress tracking: count test runs (Bash commands that look like tests)
      if (toolCall.name === "Bash") {
        const cmd = (toolCall.input["command"] as string) || "";
        if (/\b(test|jest|vitest|mocha|pytest|cargo\s+test)\b/i.test(cmd)) {
          testsRun++;
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

      // Progress tracking: emit a progress line every PROGRESS_EMIT_INTERVAL tool calls
      if (toolCallsThisTurn > 0 && toolCallsThisTurn % PROGRESS_EMIT_INTERVAL === 0) {
        const progressLine = `[progress: ${toolCallsThisTurn} tool calls | ${filesModified} files modified | ${testsRun} tests run]`;
        process.stdout.write(`\n${DIM}${progressLine}${RESET}\n`);
        // Also inject a progress marker into the session for visibility
        session.messages.push({
          id: randomUUID(),
          role: "system" as "user",
          content: progressLine,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Reflection checkpoint: inject chain-of-thought reasoning prompt at intervals
    if (
      executedToolsThisTurn > 0 &&
      executedToolsThisTurn % REFLECTION_CHECKPOINT_INTERVAL === 0 &&
      maxToolRounds > 0
    ) {
      toolResults.push(`SYSTEM: ${REFLECTION_PROMPT}`);
      if (!config.silent) {
        process.stdout.write(
          `\n${DIM}[reflection checkpoint at ${executedToolsThisTurn} tool calls]${RESET}\n`,
        );
      }
    }

    // Clear silent mode progress line after tool loop
    if (config.silent && toolCalls.length > 0) {
      process.stdout.write(
        `\r${DIM}[${toolCalls.length}/${toolCalls.length} tools done]${RESET}\n`,
      );
    }

    if (isMajorEditBatch(roundWrittenFiles, session.projectRoot) && !roundMajorEditGateResult) {
      roundMajorEditGateResult = await runMajorEditBatchGate(
        session,
        roundCounter,
        config,
        readTracker,
        editAttempts,
      );
      lastMajorEditGatePassed = roundMajorEditGateResult.passed;

      const summary = roundMajorEditGateResult.passed
        ? "SYSTEM: Repository-root verification passed for this major edit batch (typecheck, lint, test). Commits and merges may proceed."
        : `SYSTEM: Repository-root verification failed for this major edit batch (${roundMajorEditGateResult.failedSteps.join(", ")}). Do not commit or merge until those checks are green.`;
      toolResults.push(summary);

      if (!config.silent) {
        process.stdout.write(
          roundMajorEditGateResult.passed
            ? `\n${GREEN}[gstack: repo-root gate passed]${RESET}\n`
            : `\n${RED}[gstack: repo-root gate failed â€” ${roundMajorEditGateResult.failedSteps.join(", ")}]${RESET}\n`,
        );
      }
    }

    // Reflection loop (aider/Cursor pattern): after code edits, auto-run
    // the project's configured lint/test/build commands. If any fail,
    // parse the output into structured errors and inject a targeted fix
    // prompt so the model can fix specific issues instead of guessing.
    const wroteCode = toolCalls.some((tc) => tc.name === "Write" || tc.name === "Edit");
    if (wroteCode && verifyRetries < MAX_VERIFY_RETRIES) {
      const verifyCommands = getVerifyCommands(config);
      let verificationPassed = true;
      let verificationErrorSig = "";

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
            verificationPassed = false;

            // Self-healing: parse errors into structured format for targeted fixes
            const parsedErrors = parseVerificationErrors(vcResult.content);
            let retryMessage: string;

            if (parsedErrors.length > 0) {
              // Targeted fix prompt: tell the model exactly which errors to fix
              const fixPrompt = formatErrorsForFixPrompt(parsedErrors);
              retryMessage = `AUTO-VERIFY (${vc.name}) FAILED — ${parsedErrors.length} structured error(s) detected:\n\n${fixPrompt}\n\n(attempt ${verifyRetries}/${MAX_VERIFY_RETRIES})`;

              // Track error signature to detect repeated identical failures
              const errorSig = computeErrorSignature(parsedErrors);
              verificationErrorSig = errorSig;
              if (errorSig === lastErrorSignature) {
                sameErrorCount++;
                if (sameErrorCount >= 2) {
                  // Same errors persisting across retries — escalate model tier
                  const reason = `Persistent verification signature ${errorSig} repeated ${sameErrorCount + 1} times`;
                  if ("escalateTier" in router && typeof router.escalateTier === "function") {
                    router.escalateTier(reason);
                  } else {
                    router.forceCapable();
                  }
                  retryMessage += `\n\nWARNING: These same errors have persisted for ${sameErrorCount + 1} consecutive retries. The model tier has been escalated. Previous attempts failed with signature ${errorSig}. Try a fundamentally different approach to fix these issues.`;
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

              // Pivot logic: track consecutive failures with the same error signature
              // for strategy change (different from tier escalation — this is about
              // fundamentally changing the approach, not just using a better model)
              if (verificationErrorSig === lastPivotErrorSignature) {
                consecutiveSameSignatureFailures++;
              } else {
                consecutiveSameSignatureFailures = 1;
                lastPivotErrorSignature = verificationErrorSig;
              }

              if (consecutiveSameSignatureFailures >= 2) {
                retryMessage += `\n\n${PIVOT_INSTRUCTION}`;
                if (!config.silent) {
                  process.stdout.write(
                    `\n${YELLOW}[pivot: same error signature ${consecutiveSameSignatureFailures}x — requesting strategy change]${RESET}\n`,
                  );
                }
                // Include approach memory in the pivot prompt
                if (approachLog.length > 0) {
                  const failedApproaches = approachLog
                    .filter((a) => a.outcome === "failed")
                    .map((a) => `  - ${a.description} (${a.toolCalls} tool calls)`)
                    .join("\n");
                  if (failedApproaches) {
                    retryMessage += `\n\nPreviously failed approaches:\n${failedApproaches}`;
                  }
                }
              }

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

      // Approach memory: record the outcome of this verification cycle
      if (verifyCommands.length > 0) {
        const approachDesc = currentApproachDescription || `approach-${approachLog.length + 1}`;
        if (verificationPassed) {
          approachLog.push({
            description: approachDesc,
            outcome: "success",
            toolCalls: currentApproachToolCalls,
          });
          // Persist success to cross-session memory
          persistentMemory.record({
            description: approachDesc,
            outcome: "success",
            toolCalls: currentApproachToolCalls,
            sessionId: session.id,
          }).catch(() => {});
          // Reset pivot tracking on success
          consecutiveSameSignatureFailures = 0;
          lastPivotErrorSignature = "";
        } else {
          approachLog.push({
            description: approachDesc,
            outcome: "failed",
            toolCalls: currentApproachToolCalls,
          });
          // Persist failure to cross-session memory
          persistentMemory.record({
            description: approachDesc,
            outcome: "failed",
            errorSignature: lastErrorSignature || undefined,
            toolCalls: currentApproachToolCalls,
            sessionId: session.id,
          }).catch(() => {});

          // Inject approach memory into the retry prompt so the model knows what was tried
          if (approachLog.length > 1) {
            const lastFailed = approachLog[approachLog.length - 1]!;
            toolResults.push(
              `Previously tried: ${lastFailed.description} — failed. Try a different approach.`,
            );
          }
        }
        // Reset for the next approach
        currentApproachDescription = "";
        currentApproachToolCalls = 0;
      }
    } else if (wroteCode && verifyRetries >= MAX_VERIFY_RETRIES) {
      toolResults.push(
        `SYSTEM: Verification has failed ${MAX_VERIFY_RETRIES} times. Stop retrying and ask the user for guidance.`,
      );
    }

    // Wave advancement (after tool execution): if the model signaled [WAVE COMPLETE]
    // in a response that also had tool calls, advance to the next wave now.
    if (
      config.waveState &&
      isWaveComplete(responseText) &&
      maxToolRounds > 0
    ) {
      const waveState = config.waveState;
      const completedWave = getCurrentWave(waveState);
      const hasMore = advanceWave(waveState);
      if (!config.silent && completedWave) {
        process.stdout.write(
          `\n${GREEN}[wave ${completedWave.number}/${waveState.waves.length} complete: ${completedWave.title}]${RESET}\n`,
        );
      }
      if (hasMore) {
        const nextWavePrompt = buildWavePrompt(waveState);
        toolResults.push(`SYSTEM: Wave complete. Next wave instructions:\n\n${nextWavePrompt}`);
        if (!config.silent) {
          const next = getCurrentWave(waveState);
          process.stdout.write(
            `${CYAN}[advancing to wave ${next?.number}/${waveState.waves.length}: ${next?.title}]${RESET}\n`,
          );
        }
        // Reset per-wave counters
        pipelineContinuationNudges = 0;
        confabulationNudges = 0;
      } else if (!config.silent) {
        process.stdout.write(
          `\n${GREEN}${BOLD}[all ${waveState.waves.length} waves complete]${RESET}\n`,
        );
      }
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

  // Diff-based anti-confabulation: compare claimed vs actual file changes (advisory)
  if (config.verbose && touchedFiles.length > 0) {
    const lastAssistant = messages.filter(m => m.role === "assistant").pop();
    if (lastAssistant) {
      const claimedFiles = extractClaimedFiles(lastAssistant.content);
      if (claimedFiles.length > 0) {
        const actualSet = new Set(touchedFiles.map(f => f.replace(/\\/g, "/")));
        const unverified = claimedFiles.filter((f: string) => !actualSet.has(f.replace(/\\/g, "/")));
        if (unverified.length > 0) {
          process.stdout.write(
            `\n${YELLOW}[confab-diff] Model claimed changes to files not in actual write set: ${unverified.join(", ")}${RESET}\n`,
          );
        }
      }
    }
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
        content:
          typeof m.content === "string" ? m.content : m.content.map((b) => b.text || "").join("\n"),
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
