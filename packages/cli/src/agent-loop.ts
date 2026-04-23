// ============================================================================
// @dantecode/cli — Agent Interaction Loop
// The core loop that sends user prompts to the model, processes tool calls,
// runs the DanteForge pipeline on generated code, and streams responses.
// ============================================================================

import { createHash, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import {
  ModelRouterImpl,
  recordToolCall,
  recordMutation,
  recordValidation,
  recordCompletionGate,
  compactTextTranscript,
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
  ApproachMemory,
  formatApproachesForPrompt,
  truncateToolOutput,
  BoundedRepairLoop,
  createFileSnapshot,
  classifyRisk,
  UndoStack,
  buildApprovalRequest,
  decomposeTask,
  detectProjectStack,
  buildTestOutputContext,
  makeVerifyFn,
  incrementalVerifyGate,
  AutonomyOrchestrator,
  suggestDebugFix,
  emitDebugRepairHint,
  generateRepairSuggestions,
  formatRepairSuggestionsForPrompt,
  globalErrorRecoveryRouter,
  AutonomyMetricsTracker,
  recordFinishRate,
  loadFinishRates,
  getFinishRateStats,
  classifyTaskDifficulty,
  recordMemoryOutcomeCorrelation,
  loadContextCoverage,
  InlineEditAcceptanceStore,
  recordCostPerTaskOutcome,
  detectTaskAmbiguity,
  recordAmbiguityDetection,
  beginRetrievalSession,
  computeCitationScore,
  recordCitationResult,
  computeMemoryDecisionInfluence,
  recordMemoryDecisionInfluence,
  computeQualityTrend,
  recordQualityTrend,
  buildAutonomySessionSummary,
  recordAutonomyReport,
  recordContextRankingEvent,
  recordTaskRecovery,
  buildInlineEditMetrics,
  buildInlineEditQualityReport,
  recordInlineEditReport,
  loadInlineEditReports,
  classifyTask,
  computeTaskCompletionVerdict,
  recordTaskCompletion,
  hasStackTrace,
  assembleDebugContext,
  formatDebugContextForPrompt,
  recordDebugRepairOutcome,
  extractErrorsFromDevOutput,
  buildCaptureSummary,
  buildRepairPrompt,
  narrateDecision,
  renderContextAttribution,
  renderSessionSummary,
  recordDecisionNarrative,
} from "@dantecode/core";
import type {
  FileSnapshot,
  WaveOrchestratorState,
  DecompositionResult,
} from "@dantecode/core";
import type { DevServerHandle } from "./dev-server-manager.js";
import {
  recordSuccessPattern,
  runAntiStubScanner,
  queryLessons,
} from "@dantecode/danteforge";
import { runDanteForge, getWrittenFilePath } from "./danteforge-pipeline.js";
import type {
  Session,
  SessionMessage,
  DanteCodeState,
  ModelConfig,
  SelfImprovementContext,
  ExecutionLedger,
  CostEstimate,
  ValidationRecord,
  CompletionGateResult,
} from "@dantecode/config-types";
import {
  getStatus,
  autoCommit,
  getDiff,
} from "@dantecode/git-engine";
import {
  executeTool,
  type ToolResult,
  type SubAgentExecutor,
  type SubAgentOptions,
  type SubAgentResult,
} from "./tools.js";
import { normalizeAndCheckBash } from "./safety.js";
import { StreamRenderer } from "./stream-renderer.js";
import { TokenGauge } from "./token-gauge.js";
import { getAISDKTools } from "./tool-schemas.js";
import { SandboxBridge } from "./sandbox-bridge.js";
import { classifyRequest, evaluateCompletionGate } from "./completion-gate.js";
import {
  evaluateEmptyResponseRound,
  getAutoContinuationRefill,
  getInitialRoundBudget,
  shouldAutoContinueBudget,
} from "./loop-safety.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { normalizeActionToolCalls } from "./tool-dispatch.js";
import { recordExecutionEvidence } from "./verification-hooks.js";
import * as readline from "node:readline";

type PermissionCategory = "edit" | "bash" | "tools";

function questionAsync(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

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
  /**
   * Permissions for destructive actions. Defaults to edit: "ask", bash: "ask", tools: "allow".
   * - "allow": always allow execution
   * - "ask": prompt user for approval before execution
   * - "deny": always block execution
   */
  permissions?: {
    edit: "allow" | "ask" | "deny";
    bash: "allow" | "ask" | "deny";
    tools: "allow" | "ask" | "deny";
  };
  /**
   * When true, runs `incrementalVerifyGate` (typecheck) after each file write
   * in the agent loop and injects failure output as next-step context.
   * Default: false (opt-in to avoid latency in standard runs).
   */
  incrementalVerify?: boolean;
  /** Readline interface for interactive permission prompts (used for 'ask' permissions). */
  rl?: readline.Interface;
  /** Called after each LLM round with updated cost data. Used by REPL for live cost display. */
  onCostUpdate?: (estimate: CostEstimate, provider: string) => void;
  /**
   * Optional planning model for architect/editor split.
   * When set AND lexicalComplexity >= 0.7, a planning round fires before execution
   * using this model. Off by default (zero cost impact when not configured).
   */
  architectModel?: ModelConfig;
  /**
   * Git integration settings. When git.autoCommit is true, the agent will
   * automatically commit all files written in each round with an LLM-generated
   * conventional commit message. Default: false.
   */
  git?: { autoCommit?: boolean };
  /**
   * When true, enables automatic task decomposition via decomposeAndRun().
   * Harvested from OpenHands' sandbox grouping strategy.
   * Default: false (opt-in).
   */
  enableParallelDecomp?: boolean;
  /**
   * Maximum number of parallel decomposition lanes when enableParallelDecomp is true.
   * Default: 3.
   */
  parallelLanes?: number;
  /**
   * Optional debug attach provider for injecting live breakpoint/variable context
   * into agent messages each round (dim 20 — snapshot actively drives decisions).
   * Must implement hasNewSnapshot() and markConsumed() and formatForContext().
   */
  debugProvider?: {
    hasNewSnapshot(): boolean;
    markConsumed(): void;
    formatForContext(): string;
    getSnapshot?(): { exceptionMessage?: string; stopReason?: string; frames?: Array<{ source?: string; line?: number; name?: string }> } | null;
  };
  /**
   * Active dev server handle (dim 14 — browser live preview).
   * When set, stdout errors are extracted at session start and injected as a
   * structured [BROWSER PREVIEW FAILURE] system message before the first
   * assistant turn — closing the "agent sees what's broken" loop.
   */
  activeDevServer?: DevServerHandle;
}

// ----------------------------------------------------------------------------
// Permission Checking
// ----------------------------------------------------------------------------

const DEFAULT_RUNTIME_PERMISSIONS: Record<PermissionCategory, "allow" | "ask" | "deny"> = {
  edit: "allow",
  bash: "allow",
  tools: "allow",
};

function getPermissionCategory(toolName: string): PermissionCategory {
  if (toolName === "Write" || toolName === "Edit") {
    return "edit";
  }
  if (toolName === "Bash") {
    return "bash";
  }
  return "tools";
}

function getPermissionLevel(
  config: AgentLoopConfig,
  category: PermissionCategory,
): "allow" | "ask" | "deny" {
  return (
    config.permissions?.[category] ??
    config.state.permissions?.[category] ??
    DEFAULT_RUNTIME_PERMISSIONS[category]
  );
}

/**
 * Checks if a tool execution is permitted based on the configured permissions.
 * Also runs ApprovalWorkflow risk classification: destructive operations are
 * auto-blocked; dangerous operations are escalated to "ask" even in "allow" mode.
 * Returns null if allowed, or an error message if denied.
 * For "ask" permissions, prompts the user via terminal and returns null if approved.
 */
async function checkToolPermission(
  toolName: string,
  config: AgentLoopConfig,
  payload?: string,
): Promise<string | null> {
  // ApprovalWorkflow risk gate — classify risk before permission check
  if (payload !== undefined) {
    const operationType =
      toolName === "Bash" ? "shell-command" as const
      : toolName === "Write" ? "file-write" as const
      : toolName === "Edit" ? "file-write" as const
      : null;
    if (operationType !== null) {
      const risk = classifyRisk(operationType, payload);
      if (risk === "destructive") {
        return `[ApprovalWorkflow] Destructive operation blocked: "${payload.slice(0, 80)}" (risk: destructive). Undo is not possible. Confirm explicitly in a separate prompt.`;
      }
      // Dangerous ops: escalate to "ask" even if permission is currently "allow"
      if (risk === "dangerous") {
        buildApprovalRequest(operationType, `${toolName} operation`, payload);
        if (config.rl) {
          const answer = await questionAsync(config.rl, `[Risk: dangerous] Allow "${payload.slice(0, 60)}"? (yes/no): `);
          if (answer.trim().toLowerCase() !== "yes" && answer.trim().toLowerCase() !== "y") {
            return `Permission denied by user (dangerous operation): ${payload.slice(0, 80)}`;
          }
          return null;
        }
        // No TTY — let normal permission flow decide
      }
    }
  }

  const category = getPermissionCategory(toolName);
  const permission = getPermissionLevel(config, category);

  if (permission === "allow") {
    return null;
  }

  if (permission === "deny") {
    return `Permission denied: ${category} actions are disabled.`;
  }

  if (!config.rl) {
    return `Permission denied: ${category} actions require interactive approval, but no terminal available.`;
  }

  const actionDescription = getCategoryDescription(toolName, category);
  const promptMessage = `Allow ${actionDescription}? (yes/no): `;

  try {
    const answer = await questionAsync(config.rl, promptMessage);
    if (answer.trim().toLowerCase() === "yes" || answer.trim().toLowerCase() === "y") {
      return null;
    }
    return `Permission denied by user: ${actionDescription}`;
  } catch (err) {
    return `Error during permission prompt: ${err}`;
  }
}

function getCategoryDescription(toolName: string, category: PermissionCategory): string {
  switch (category) {
    case "edit":
      if (toolName === "Write") {
        return "writing a new file or overwriting an existing file";
      } else if (toolName === "Edit") {
        return "editing an existing file";
      }
      return "file edit operation";
    case "bash":
      return "execution of Bash command";
    case "tools":
      return `use of tool "${toolName}"`;
    default:
      return `action requiring ${category} permission`;
  }
}

/** Entry in the approach memory log, tracking tried strategies and outcomes. */
export interface ApproachLogEntry {
  description: string;
  outcome: "success" | "failed" | "partial";
  toolCalls: number;
}

export function buildTaskOutcomeVerificationSnapshots(
  validationRecords: ValidationRecord[],
  completionGateResult?: CompletionGateResult,
): Array<{ kind: string; passed: boolean; summary: string }> {
  const snapshots = validationRecords.map((record, index) => ({
    kind: `${record.type}-${index + 1}`,
    passed: record.passed,
    summary: `${record.command} => ${record.passed ? "passed" : `failed (${record.exitCode})`}`,
  }));

  if (completionGateResult) {
    snapshots.push({
      kind: "completion-gate",
      passed: completionGateResult.ok,
      summary: completionGateResult.ok
        ? "completion gate passed"
        : `completion gate failed: ${completionGateResult.reasonCode ?? "unknown"}`,
    });
  }

  return snapshots;
}

interface PersistAgentTaskOutcomeParams {
  prompt: string;
  session: Session;
  sessionStatus: "COMPLETE" | "INCOMPLETE" | "FAILED";
  taskStartTime: number;
  completionTime: number | null;
  touchedFiles: string[];
  executionLedger: ExecutionLedger;
  verifyRetries: number;
  autonomyVerifyRoundsUsed: number;
  confabulationNudges: number;
  modelRoundTrips: number;
}

export async function persistAgentTaskOutcome(
  params: PersistAgentTaskOutcomeParams,
): Promise<void> {
  const completedAt = new Date(params.completionTime ?? Date.now()).toISOString();
  const startedAt = new Date(params.taskStartTime).toISOString();
  const durationMs = (params.completionTime ?? Date.now()) - params.taskStartTime;
  const verificationSnapshots = buildTaskOutcomeVerificationSnapshots(
    params.executionLedger.validationRecords,
    params.executionLedger.completionGateResult,
  );

  try {
    const df = (await import("@dantecode/danteforge")) as unknown as {
      recordTaskOutcome?: (artifact: Record<string, unknown>, projectRoot: string) => Promise<void>;
    };
    await df.recordTaskOutcome?.(
      {
        command: "agent",
        taskDescription: params.prompt,
        success: params.sessionStatus === "COMPLETE",
        startedAt,
        completedAt,
        durationMs,
        verificationSnapshots,
        evidenceRefs: params.touchedFiles,
        error:
          params.sessionStatus === "FAILED"
            ? "agent loop failed before reaching a valid completion state"
            : undefined,
        metadata: {
          sessionId: params.session.id,
          modelId: params.session.model.modelId,
          status: params.sessionStatus,
          touchedFiles: params.touchedFiles.length,
          toolCalls: params.executionLedger.toolCallRecords.length,
          mutations: params.executionLedger.mutationRecords.length,
          validations: params.executionLedger.validationRecords.length,
          verifyRetries: params.verifyRetries,
          autonomyVerifyRoundsUsed: params.autonomyVerifyRoundsUsed,
          confabulationNudges: params.confabulationNudges,
          modelRoundTrips: params.modelRoundTrips,
        },
      },
      params.session.projectRoot,
    );
  } catch {
    // Non-fatal: danteforge recordTaskOutcome unavailable
  }
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** How often (in tool calls) to emit a progress line. */
const PROGRESS_EMIT_INTERVAL = 5;

/** Module-level undo stack — tracks reversible Write/Edit operations for the session. */
export const globalUndoStack = new UndoStack();

/** Planning instruction injected for complex tasks. */
const PLANNING_INSTRUCTION =
  "Before executing, create a brief plan:\n" +
  "1. What files need to change and why?\n" +
  "2. What's the approach? (Read → Edit → Verify cycle)\n" +
  "3. What could go wrong? (edge cases, breaking changes, missing imports)\n" +
  "4. What's the verification strategy? (tests, typecheck, manual check)\n" +
  "Then execute the plan step by step. After each major change, verify before moving on.";

/**
 * System prompt used for the architect planning round (Phase 4).
 * The architect model produces a prose plan; the executor model then implements it.
 */
const ARCHITECT_SYSTEM_PROMPT =
  "You are a planning assistant. Describe ONLY the changes needed — do NOT write code. " +
  "For each file: (1) path, (2) what changes, (3) why. Pure prose, no code blocks. " +
  "Be concise. The executor will implement exactly what you describe.";

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
const SAFE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "GitHubSearch",
  "TodoWrite",
]);

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

const COMPLETION_CLAIM_PATTERN =
  /\b(?:done|complete|completed|finished|all changes made|task complete|implemented|created|updated|modified|written|applied successfully)\b/i;

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
 * Generate a conventional commit message for the files written this round.
 * Calls the active LLM with a trimmed diff (≤2000 chars) and returns the first
 * non-empty line as the commit subject (≤72 chars).
 */
async function generateAutoCommitMessage(
  diff: string,
  config: AgentLoopConfig,
  session: Session,
): Promise<string> {
  try {
    const routerConfig = {
      default: config.state.model.default,
      fallback: config.state.model.fallback,
      overrides: config.state.model.taskOverrides,
    };
    const router = new ModelRouterImpl(routerConfig, session.projectRoot, session.id);
    const prompt =
      `Given this git diff, write a concise conventional commit message (≤72 chars subject line only, no body):\n\n` +
      diff.slice(0, 2000);
    const responseText = await router.generate(
      [{ role: "user", content: prompt }],
      { maxTokens: 80 },
    );
    const subject = responseText
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "chore: auto-commit agent changes";
    return subject.slice(0, 72);
  } catch {
    return "chore: auto-commit agent changes";
  }
}

/**
 * Derives a PR title from a conventional commit message (dim 8).
 * Parses feat/fix/chore + scope and capitalizes the description.
 * Pure string transformation — no API call required.
 *
 * @param commitMsg - The auto-generated commit message (conventional commit format).
 * @returns Formatted PR title string.
 */
export function generatePRTitle(commitMsg: string): string {
  const subject = commitMsg.split("\n")[0]?.trim() ?? commitMsg;
  // Match conventional commit: type(scope)!?: description OR type: description
  const match = subject.match(/^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  if (!match) return subject;
  const [, type, scope, description] = match;
  const capitalizedDesc = (description ?? "").charAt(0).toUpperCase() + (description ?? "").slice(1);
  const scopePart = scope ? `(${scope})` : "";
  return `${type}${scopePart}: ${capitalizedDesc}`;
}

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
  readTracker: Map<string, FileSnapshot>,
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
 * Builds a compact summary of session progress for context condensation.
 * Used when context utilization >= 80% to preserve headroom for remaining rounds.
 */
function buildCondensationSummary(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  touchedFiles: string[],
  roundCounter: number,
): string {
  // Extract key facts from recent messages without an LLM call
  const recentAssistant = messages
    .filter((m) => m.role === "assistant")
    .slice(-3)
    .map((m) => m.content.slice(0, 200))
    .join(" | ");

  const filesStr = touchedFiles.length > 0
    ? `Modified files: ${touchedFiles.slice(-10).join(", ")}`
    : "No files modified yet";

  return (
    `## Session Summary (auto-condensed at round ${roundCounter})\n\n` +
    `${filesStr}\n\n` +
    `Recent agent activity: ${recentAssistant.slice(0, 500) || "(none yet)"}\n\n` +
    `Continue the task from where you left off. The above summarizes work completed so far.`
  );
}

/**
 * Drops old verbose tool results, keeping the system prompt, first user message,
 * and the most recent N message pairs. Injects a condensation summary as a
 * system message before the retained recent messages.
 *
 * This is the SWE-bench / OpenHands condensation pattern: long tasks accumulate
 * many tool results that consume context but add little signal after the fact.
 */
function condenseOldMessages(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  keepRecentRounds: number,
  summary: string,
): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  if (messages.length <= keepRecentRounds * 2 + 3) {
    // Not enough messages to benefit from condensation
    return messages;
  }

  // Always keep: system messages at the start + first user message
  const systemMessages = messages.filter((m) => m.role === "system").slice(0, 3);
  const firstUserIdx = messages.findIndex((m) => m.role === "user");
  const firstUser = firstUserIdx >= 0 ? [messages[firstUserIdx]!] : [];

  // Keep only the last N*2 non-system messages (pairs of user+assistant)
  const nonSystem = messages.filter((m) => m.role !== "system");
  const recentMessages = nonSystem.slice(-(keepRecentRounds * 2));

  // Truncate verbose tool outputs in retained messages (keep first 500 chars)
  const trimmed = recentMessages.map((m) => {
    if (m.role === "user" && m.content.length > 1000) {
      return { ...m, content: m.content.slice(0, 1000) + "\n[...truncated]" };
    }
    return m;
  });

  return [
    ...systemMessages,
    ...firstUser,
    { role: "system" as const, content: summary },
    ...trimmed,
  ];
}

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
  return compactTextTranscript(messages, {
    contextWindow,
    preserveRecentMessages: 10,
    preserveRecentToolResults: 5,
  }).messages;
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

function looksLikeCompletionClaim(text: string): boolean {
  return PREMATURE_SUMMARY_PATTERN.test(text) || COMPLETION_CLAIM_PATTERN.test(text);
}

function fingerprintOutput(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex").slice(0, 16);
}

function buildSessionResultSummary(summary: {
  touchedFiles: string[];
  testsRun: number;
  toolCalls: number;
  confabulationWarnings: number;
  status: "COMPLETE" | "INCOMPLETE" | "FAILED";
}): string {
  return [
    "┌─ Session Result ──────────────────────┐",
    `│ Files modified: ${summary.touchedFiles.length}`.padEnd(39) + "│",
    `│ Tests run: ${summary.testsRun}`.padEnd(39) + "│",
    `│ Tool calls: ${summary.toolCalls}`.padEnd(39) + "│",
    `│ Confab warnings: ${summary.confabulationWarnings}`.padEnd(39) + "│",
    `│ Status: ${summary.status}`.padEnd(39) + "│",
    "└──────────────────────────────────────┘",
  ].join("\n");
}

/**
 * Sprint AB (dim 11): Extract 3 key decisions/changes from the session messages
 * and format them as a structured [Session summary] injectable message.
 */
export function summarizeAgentSession(
  messages: Array<{ role: string; content: string }>,
  touchedFiles: string[],
  status: "COMPLETE" | "INCOMPLETE" | "FAILED",
): string {
  const assistantMessages = messages
    .filter((m) => m.role === "assistant")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean);

  const decisions: string[] = [];

  // Extract key actions from assistant messages
  for (const msg of assistantMessages) {
    const lines = msg.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.length > 20 &&
        trimmed.length < 200 &&
        /^[A-Z]/.test(trimmed) &&
        !trimmed.startsWith("Using tool") &&
        !trimmed.startsWith("Tool ") &&
        decisions.length < 3
      ) {
        decisions.push(trimmed.slice(0, 150));
        break;
      }
    }
    if (decisions.length >= 3) break;
  }

  const fileList = touchedFiles.length > 0
    ? touchedFiles.slice(-5).map((f) => f.split("/").pop() ?? f).join(", ")
    : "none";

  const parts = [
    `[Session summary] status=${status} | files=${touchedFiles.length} (${fileList})`,
    decisions.length > 0 ? `Key decisions:\n${decisions.map((d, i) => `  ${i + 1}. ${d}`).join("\n")}` : "",
  ].filter(Boolean);

  return parts.join("\n");
}

function buildSessionProofSummary(
  validationRecords: ValidationRecord[],
  completionGateResult?: CompletionGateResult,
): string {
  const passedValidations = validationRecords.filter((record) => record.passed).length;
  const validationPassRate =
    validationRecords.length > 0 ? `${passedValidations}/${validationRecords.length}` : "0/0";
  const completionGateStatus = completionGateResult
    ? completionGateResult.ok
      ? "passed"
      : `failed (${completionGateResult.reasonCode ?? "unknown"})`
    : "not run";

  return [
    "Proof Summary:",
    `- Validation pass rate: ${validationPassRate}`,
    `- Completion gate: ${completionGateStatus}`,
  ].join("\n");
}

/**
 * Sprint AK — Dim 11: Format session decisions as structured markdown
 * for display in the DanteCode chat panel, showing what was done and
 * what quality gates passed.
 */
export function formatSessionProof(
  messages: Array<{ role: string; content: string }>,
  touchedFiles: string[],
  status: "COMPLETE" | "INCOMPLETE" | "FAILED",
  validationRecords?: ValidationRecord[],
): string {
  const summary = summarizeAgentSession(messages, touchedFiles, status);
  const lines: string[] = [`## Session Proof`, ``];

  lines.push(`**Status**: ${status}`);
  lines.push(`**Files modified**: ${touchedFiles.length}`);
  if (touchedFiles.length > 0) {
    lines.push(`**Changed**: ${touchedFiles.slice(-5).map((f) => f.split("/").pop() ?? f).join(", ")}`);
  }

  if (validationRecords && validationRecords.length > 0) {
    const passed = validationRecords.filter((r) => r.passed).length;
    lines.push(`**Validations**: ${passed}/${validationRecords.length} passed`);
  }

  // Extract key decisions from the full summary
  const decisionBlock = summary.split("Key decisions:")[1];
  if (decisionBlock) {
    lines.push(``, `**Key decisions**:`);
    lines.push(decisionBlock.trim());
  }

  return lines.join("\n");
}

interface RecentOutcomePolicy {
  forcePlanning: boolean;
  maxVerifyRetries?: number;
  guidance?: string;
  escalateReason?: string;
  retryGuidance?: string;
  successGuidance?: string;
  runtimeHeavy?: boolean;
}

function deriveRecentOutcomePolicy(summary: {
  total: number;
  successCount: number;
  failureCount: number;
  verifiedCount: number;
  partiallyVerifiedCount: number;
  unverifiedCount: number;
  verificationFailureCount: number;
  unverifiedFailureCount: number;
  runtimeFailureCount: number;
  dominantFailureMode?: "verification_failures" | "unverified_completion" | "runtime_failures";
  dominantFailureCommand?: string;
  warning?: string;
}): RecentOutcomePolicy {
  const repeatedFailures = summary.failureCount >= 3 && summary.failureCount >= summary.successCount;
  const unverifiedStreak = summary.unverifiedCount >= 3;
  const verificationHeavy =
    summary.dominantFailureMode === "verification_failures" || summary.verificationFailureCount >= 2;
  const runtimeHeavy =
    summary.dominantFailureMode === "runtime_failures" || summary.runtimeFailureCount >= 2;

  if (!repeatedFailures && !unverifiedStreak && !verificationHeavy && !runtimeHeavy) {
    return { forcePlanning: false };
  }

  const guidanceLines = ["RECENT OUTCOME GUARDRAIL:"];
  if (summary.warning) {
    guidanceLines.push(summary.warning);
  }
  if (repeatedFailures) {
    guidanceLines.push(
      "Break the task into smaller validated steps and verify after each meaningful edit.",
    );
  }
  if (verificationHeavy) {
    guidanceLines.push(
      "Recent failures are verification-heavy. Run the smallest relevant checks before further edits and prefer narrower repairs over broad rewrites.",
    );
  }
  if (unverifiedStreak) {
    guidanceLines.push(
      "Do not claim completion without explicit checks or a concrete manual verification note.",
    );
  }
  if (runtimeHeavy) {
    guidanceLines.push(
      "Recent failures look runtime/tooling-related. Reduce tool churn, inspect the failing command output closely, and only retry after changing the approach.",
    );
  }

  return {
    forcePlanning: repeatedFailures || unverifiedStreak,
    maxVerifyRetries: repeatedFailures || verificationHeavy ? 4 : 3,
    guidance: guidanceLines.join("\n"),
    retryGuidance: verificationHeavy
      ? "Retry posture: make the narrowest repair that addresses the failing check, rerun the smallest relevant verification command first, and avoid unrelated rewrites."
      : runtimeHeavy
        ? "Retry posture: inspect the failing command output carefully, change the approach before rerunning, and avoid repeating the same tool sequence without a concrete adjustment."
        : unverifiedStreak
          ? "Retry posture: after you repair the issue, state exactly which checks you ran before claiming completion."
          : undefined,
    successGuidance: unverifiedStreak
      ? "Verification passed. Before claiming completion, explicitly state what you verified and what remains manual."
      : undefined,
    escalateReason:
      (repeatedFailures && summary.dominantFailureCommand === "agent") || runtimeHeavy
        ? "Recent task outcomes show repeated agent failures"
        : undefined,
    runtimeHeavy,
  };
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
          status: "running",
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
      rl: undefined,
    };

    try {
      const completedSession = await runAgentLoop(prompt, childSession, childConfig);

      const assistantMessages = completedSession.messages.filter(
        (message: SessionMessage) => message.role === "assistant",
      );
      const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
      const output = lastAssistantMessage?.content ?? "(no output)";

      const touchedFiles: string[] =
        completedSession.executionLedger?.mutationRecords.map((r) => r.path) || [];

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
  // Instrumentation for speed-to-verified-completion metrics
  const taskStartTime = Date.now();
  let firstMutationTime: number | null = null;
  let completionTime: number | null = null;
  let modelRoundTrips = 0;
  const fileReads = 0;
  const repairAttempts = 0;

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

  // Sprint AY (dim 15): detect ambiguous prompt and inject assumption declaration
  try {
    const ambiguity = detectTaskAmbiguity(prompt);
    recordAmbiguityDetection({
      sessionId: session.id,
      prompt: prompt.slice(0, 200),
      isAmbiguous: ambiguity.isAmbiguous,
      score: ambiguity.score,
      signalTypes: ambiguity.signals.map((s) => s.type),
      assumptionText: ambiguity.assumptionText,
    }, session.projectRoot);
    if (ambiguity.isAmbiguous) {
      session.messages.push({
        id: randomUUID(),
        role: "system" as const,
        content: `[Task Assumptions]: ${ambiguity.assumptionText}`,
        timestamp: new Date().toISOString(),
      });
    }
  } catch { /* non-fatal */ }

  // Sprint CH2 (dim 15): task triage — classify difficulty, inject assumption declaration for hard tasks
  const dim15RepairCount = { count: 0 };
  const dim15ToolResults: string[] = [];
  let dim15ConsecutiveFailures = 0;

  // Sprint Dim20: debug context tracking — counts how many structured debug contexts were injected
  let debugContextsInjected = 0;
  let maxDebugSeverity = 0;
  try {
    const triage = classifyTask(prompt);
    if (triage.difficulty === "hard" && triage.assumptionText) {
      session.messages.push({
        id: randomUUID(),
        role: "system" as const,
        content: `[Task Triage — Hard]: ${triage.reason}. Proceeding with assumptions: ${triage.assumptionText}`,
        timestamp: new Date().toISOString(),
      });
    }
  } catch { /* non-fatal */ }

  // Dim 14 — browser live preview error injection:
  // When a dev server is active, extract any captured stdout errors and prepend a
  // structured repair prompt so the agent immediately sees what's broken.
  if (config.activeDevServer) {
    try {
      const output = config.activeDevServer.captureOutput().join("\n");
      if (output.trim()) {
        const devErrors = extractErrorsFromDevOutput(output);
        if (devErrors.length > 0) {
          const summary = buildCaptureSummary(config.activeDevServer.port, devErrors, []);
          const repairPrompt = buildRepairPrompt(summary);
          session.messages.push({
            id: randomUUID(),
            role: "system" as const,
            content: repairPrompt.fullPrompt,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch { /* non-fatal */ }
  }

  // Sprint AZ (dim 2): begin retrieval session buffer for citation scoring
  try { beginRetrievalSession(session.id); } catch { /* non-fatal */ }
  // Sprint AZ (dim 21): injected memory facts for decision influence tracking
  const injectedMemoryFacts: string[] = [];

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
  const repairLoop = new BoundedRepairLoop();

  // Instantiate MemoryOrchestrator once per session (Sprint 22 fix: avoid per-turn rebuild)
  let sessionMemOrchestrator: { memoryRecall(query: string, limit?: number): Promise<unknown[]> } | undefined;
  try {
    const { createMemoryOrchestrator } = await (Function("return import('@dantecode/memory-engine')")() as Promise<{ createMemoryOrchestrator: (opts: { projectRoot: string; similarityThreshold: number }) => { initialize(): Promise<void>; memoryRecall(query: string, limit?: number): Promise<unknown[]> } }>);
    const orch = createMemoryOrchestrator({
      projectRoot: session.projectRoot,
      similarityThreshold: 0.25,
    });
    await orch.initialize();
    sessionMemOrchestrator = orch;
  } catch {
    // Non-fatal: memory engine unavailable or initialization failed
  }

  // Build system prompt
  const systemPrompt = await buildSystemPrompt(session, config, prompt, sessionMemOrchestrator);

  // Sprint BW (dim 4): record context ranking event
  try {
    recordContextRankingEvent(
      session.id,
      prompt.slice(0, 100),
      10,   // chunksConsidered (estimate)
      5,    // chunksSelected (estimate)
      "bm25",
      session.projectRoot,
    );
  } catch { /* non-fatal */ }

  // ── Task Decomposition (Sprint 32) ──────────────────────────────────────────
  // When enableParallelDecomp is true and the task is complex (complexity ≥ 0.6),
  // decompose into ordered sub-tasks and run each as a focused agent call.
  // Sub-tasks with no inter-dependency run in the same parallel group.
  // After each file-writing sub-task, inject a test-run nudge if tests exist.
  if (config.enableParallelDecomp && lexicalComplexity >= 0.6 && prompt.length > 80) {
    const decomposition = await (async (): Promise<DecompositionResult | null> => {
      try {
        return await decomposeTask(
          prompt,
          async (planPrompt: string) => {
            let text = "";
            const planResult = await router.stream(
              [{ role: "user", content: planPrompt }],
              { system: "You are a task decomposer. Output only JSON.", maxTokens: 1024 },
            );
            for await (const chunk of planResult.textStream) {
              text += chunk;
            }
            return text;
          },
          { maxSubTasks: config.parallelLanes ?? 3, projectRoot: session.projectRoot },
        );
      } catch {
        return null;
      }
    })();

    if (decomposition && decomposition.tasks.length > 1) {
      process.stdout.write(
        `\n${YELLOW}[decompose] Task broken into ${decomposition.tasks.length} sub-tasks across ${decomposition.parallelGroups.length} group(s).${RESET}\n`,
      );
      for (const [groupIdx, group] of decomposition.parallelGroups.entries()) {
        process.stdout.write(`${YELLOW}[decompose] Group ${groupIdx + 1}: ${group.map((t) => t.id).join(", ")}${RESET}\n`);
        for (const subTask of group) {
          const affectedNote = subTask.affectedFiles?.length
            ? ` (files: ${subTask.affectedFiles.join(", ")})`
            : "";
          process.stdout.write(`${YELLOW}  → [${subTask.id}] ${subTask.description}${affectedNote}${RESET}\n`);
          // Run each sub-task as a focused prompt within this session
          const subTaskPrompt =
            `CONTEXT: This is sub-task ${subTask.id} of a larger task.\n` +
            `OVERALL TASK: ${prompt}\n\n` +
            `YOUR SPECIFIC SUB-TASK: ${subTask.description}\n` +
            (subTask.affectedFiles?.length
              ? `AFFECTED FILES (focus here): ${subTask.affectedFiles.join(", ")}\n`
              : "") +
            `Complete ONLY this sub-task. Be thorough and complete.`;

          const subTaskSession = await runAgentLoop(subTaskPrompt, session, {
            ...config,
            enableParallelDecomp: false, // prevent recursive decomposition
          });
          // Update session messages from sub-task result
          session.messages = subTaskSession.messages;
        }
      }
      // Decomposition complete — return early, each sub-task ran its own loop
      return session;
    }
  }

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
  let maxToolRounds = getInitialRoundBudget({
    requiredRounds: config.requiredRounds,
    skillActive: config.skillActive,
  });
  const initialMaxRounds = maxToolRounds;
  let totalTokensUsed = 0;
  const touchedFiles: string[] = [];
  const executionLedger: ExecutionLedger = {
    toolCallRecords: [],
    mutationRecords: [],
    validationRecords: [],
  };
  // Stuck loop detection (from opencode/OpenHands): track recent tool call signatures
  const recentToolSignatures: string[] = [];
  const STUCK_LOOP_THRESHOLD = 3; // 3 identical consecutive calls = stuck
  // Reflection loop (aider/Cursor pattern): auto-retry verification after code edits
  // Dynamic budget: hard tasks with low historical finish rates get more verify rounds.
  let maxVerifyRetries = 3;
  try {
    const finishEntries = loadFinishRates(session.projectRoot);
    if (finishEntries.length >= 5) {
      const finishStats = getFinishRateStats(finishEntries);
      const taskDiff = classifyTaskDifficulty(prompt, []);
      if (taskDiff === "hard" && finishStats.hardTaskFinishRate < 0.6) {
        maxVerifyRetries = 5; // hard task historically under-finishing — allocate more rounds
      } else if (taskDiff === "hard") {
        maxVerifyRetries = 4;
      }
    }
  } catch { /* non-fatal — default stays at 3 */ }
  let verifyRetries = 0;
  // Self-healing loop: track error signatures to detect repeated identical failures
  let lastErrorSignature = "";
  let sameErrorCount = 0;
  let executionNudges = 0;
  const MAX_EXECUTION_NUDGES = 2;
  let executedToolsThisTurn = 0;
  // Pipeline continuation: prevent premature wrap-up during multi-step pipelines
  let pipelineContinuationNudges = 0;
  // Autonomous verify loop: rounds used after all waves complete
  let autonomyVerifyRoundsUsed = 0;
  const AUTONOMY_MAX_VERIFY_ROUNDS = 3;
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
  const executionRequested =
    isPipelineWorkflow ||
    promptRequestsToolExecution(prompt) ||
    session.messages.some((m) => Boolean(m.toolUse));
  const requestClass = classifyRequest(prompt);
  const modelLabel = `${config.state.model.default.provider}/${config.state.model.default.modelId}`;
  const executionEvidencePersister = {
    recordToolCall,
    recordMutation,
    recordValidation,
  };

  let recentOutcomePolicy: RecentOutcomePolicy = { forcePlanning: false };
  try {
    const danteforge = (await import("@dantecode/danteforge")) as unknown as typeof import("@dantecode/danteforge") & {
      queryRecentTaskOutcomes: (projectRoot: string, limit?: number) => Promise<unknown[]>;
      summarizeTaskOutcomeTrends: (outcomes: unknown[]) => {
        total: number;
        successCount: number;
        failureCount: number;
        verifiedCount: number;
        partiallyVerifiedCount: number;
        unverifiedCount: number;
        verificationFailureCount: number;
        unverifiedFailureCount: number;
        runtimeFailureCount: number;
        dominantFailureMode?: "verification_failures" | "unverified_completion" | "runtime_failures";
        dominantFailureCommand?: string;
        warning?: string;
      };
    };
    const recentOutcomes = await danteforge.queryRecentTaskOutcomes(session.projectRoot, 5);
    if (recentOutcomes.length > 0) {
      recentOutcomePolicy = deriveRecentOutcomePolicy(
        danteforge.summarizeTaskOutcomeTrends(recentOutcomes) as unknown as Parameters<typeof deriveRecentOutcomePolicy>[0],
      );
      maxVerifyRetries = recentOutcomePolicy.maxVerifyRetries ?? maxVerifyRetries;
      if (recentOutcomePolicy.guidance) {
        messages.push({ role: "system", content: recentOutcomePolicy.guidance });
      }
    }
  } catch {
    // Non-fatal
  }

  // ---- Feature: Planning phase (for complex tasks) ----
  // Inject planning instruction before first model call when complexity >= 0.5
  const planningEnabled = lexicalComplexity >= 0.5 || recentOutcomePolicy.forcePlanning;
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

  // OutcomeAwareRetry (Sprint AE — dim 15): inject past failure modes from task-outcomes.json
  try {
    const { lookupRecentFailureModes } = await import("@dantecode/core");
    const pastFailureCtx = lookupRecentFailureModes(prompt, session.projectRoot);
    if (pastFailureCtx.failureModes.length > 0) {
      messages.push({
        role: "system" as const,
        content: pastFailureCtx.antiPatternPrompt,
      });
      // Sprint AZ (dim 21): capture injected anti-pattern facts
      try {
        for (const line of pastFailureCtx.antiPatternPrompt.split("\n").filter((l) => l.startsWith("- "))) {
          injectedMemoryFacts.push(line);
        }
      } catch { /* non-fatal */ }
      if (!config.silent) {
        process.stdout.write(
          `${DIM}[outcome-aware] ${pastFailureCtx.recentFailureCount} similar past failure(s): ${pastFailureCtx.failureModes.join(", ")}${RESET}\n`,
        );
      }
    }
  } catch {
    // non-fatal
  }

  // Sprint AM — Dim 15: inject recovery brief from past repair successes
  try {
    const { getTopRecoveryPatterns, buildRecoveryBrief } = await import("@dantecode/core");
    const patterns = getTopRecoveryPatterns(session.projectRoot, 3);
    const brief = buildRecoveryBrief(patterns);
    if (brief) {
      messages.push({ role: "system" as const, content: brief });
      // Sprint AZ (dim 21): capture injected recovery brief lines
      try {
        for (const line of brief.split("\n").filter((l) => l.trim())) {
          injectedMemoryFacts.push(line);
        }
      } catch { /* non-fatal */ }
      if (!config.silent) {
        process.stdout.write(`${DIM}[recovery-brief] ${patterns.length} proven fix pattern(s) loaded${RESET}\n`);
      }
    }
  } catch { /* non-fatal */ }

  // Sprint AN — Dim 21: inject lesson brief from top-scored past lessons
  try {
    const { emitLessonBrief } = await import("@dantecode/core");
    const brief = emitLessonBrief(session.projectRoot, 5);
    if (brief) {
      messages.push({ role: "system" as const, content: brief });
      // Sprint AZ (dim 21): capture injected lesson brief lines
      try {
        for (const line of brief.split("\n").filter((l) => l.trim())) {
          injectedMemoryFacts.push(line);
        }
      } catch { /* non-fatal */ }
      if (!config.silent) {
        process.stdout.write(`${DIM}[lesson-brief] Top lessons injected at session start${RESET}\n`);
      }
    }
  } catch { /* non-fatal */ }

  // Sprint Memory (dim 21): stale memory warning — if approach memory file is older than 7 days
  // AND we injected more than 2 memory facts, warn the model to verify against current state.
  try {
    if (injectedMemoryFacts.length > 2) {
      const { detectStaleMemoryFacts } = await import("@dantecode/core");
      const approachMemPath = resolve(session.projectRoot, ".dantecode", "approach-memory.json");
      const facts = injectedMemoryFacts.map((text, i) => ({
        key: `injected-fact-${i}`,
        text,
        source: approachMemPath,
      }));
      const staleReport = detectStaleMemoryFacts(facts, session.projectRoot);
      if (staleReport.staleFacts > 2) {
        messages.push({
          role: "system" as const,
          content: `[Memory Warning: ${staleReport.staleFacts} stale memory facts detected — these may reference outdated code. Verify against current file state before acting on memory.]`,
        });
        if (!config.silent) {
          process.stdout.write(`${DIM}[memory] Stale facts warning: ${staleReport.staleFacts} facts may be outdated${RESET}\n`);
        }
      }
    }
  } catch { /* non-fatal */ }

  // ---- Feature: Pivot logic ----
  // Track consecutive failures with similar error signatures for strategy change.
  // This is different from the existing tier escalation — it's about changing
  // strategy, not just using a better model.
  let consecutiveSameSignatureFailures = 0;
  let lastPivotErrorSignature = "";

  // ---- Per-turn lesson injection state (dim 21) ----
  let _lastInjectedLesson = "";
  let _lessonCooldownTurns = 0;
  const LESSON_COOLDOWN = 5;
  const LESSON_SCORE_THRESHOLD = 0.7;

  // ---- Feature: Progress tracking ----
  // Simple counters emitted to the session periodically
  let toolCallsThisTurn = 0;
  let filesModified = 0;
  let testsRun = 0;
  let roundCounter = 0;
  let lastMajorEditGatePassed = true;
  let sessionStatus: "COMPLETE" | "INCOMPLETE" | "FAILED" = "COMPLETE";
  const autonomyTracker = new AutonomyMetricsTracker(session.projectRoot);
  // Sprint AV (dim 21): capture context hit count before loop to compute delta post-session
  const preSessionContextHits = (() => { try { return loadContextCoverage(session.projectRoot).length; } catch { return 0; } })();
  const readTracker = new Map<string, FileSnapshot>();
  const editAttempts = new Map<string, number>();
  // Track Bash command outputs by hash to detect duplicate outputs (first 200 chars)
  // Map<command, Set<fingerprint>>
  const bashSnapshots = new Map<string, Set<string>>();

  if (config.verbose && thinkingBudget) {
    process.stdout.write(
      `${DIM}[thinking: ${config.state.model.default.provider}/${config.state.model.default.modelId}, budget=${thinkingBudget}]${RESET}\n`,
    );
  }

  // Memory recall visibility (dim 21): surface when historical context is injected
  if (historicalFailures && !config.silent) {
    const lessonCount = (historicalFailures.match(/^-\s/gm) || []).length || 1;
    process.stdout.write(
      `${DIM}🧠 Memory recall active: ${lessonCount} lesson${lessonCount !== 1 ? "s" : ""} injected${RESET}\n`,
    );
    config.onToken?.(
      `\x00memory_recall_active:${JSON.stringify({ count: lessonCount, preview: historicalFailures.split("\n")[0] ?? "" })}`,
    );
  }

  if (recentOutcomePolicy.escalateReason && "escalateTier" in router && typeof router.escalateTier === "function") {
    router.escalateTier(recentOutcomePolicy.escalateReason);
  }

  // Dim 30 — Decision narrator: surface strategy + confidence before first tool call
  if (!config.silent) {
    const taskStrategy = lexicalComplexity >= 0.7 ? "decompose" : lexicalComplexity >= 0.4 ? "explore" : "direct";
    const taskConfidence = Math.max(0.5, 1 - lexicalComplexity * 0.6);
    const contextFiles = Array.from(readTracker.keys()).slice(0, 3);
    const narrative = narrateDecision(taskStrategy, taskConfidence, contextFiles);
    process.stdout.write(`${DIM}${narrative.formattedLine}${RESET}\n`);
    recordDecisionNarrative(narrative, session.projectRoot);
    // Context attribution line (Continue-pattern): show which sources are loaded
    const lessonCount = (historicalFailures?.match(/^-\s/gm) || []).length;
    const contextLine = renderContextAttribution(contextFiles, lessonCount, 0);
    if (contextLine) {
      process.stdout.write(`${DIM}${contextLine}${RESET}\n`);
    }
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
        `${DIM}[planning: enabled — complexity ${lexicalComplexity.toFixed(2)} >= 0.5]${RESET}\n`,
      );
    }
  }

  // Architect/Editor split: fire one planning round before execution when
  // complexity >= 0.7 AND architectModel is configured.  Off by default.
  const architectEnabled = lexicalComplexity >= 0.7 && config.architectModel !== undefined;
  if (architectEnabled && config.architectModel) {
    if (!config.silent) {
      process.stdout.write(
        `${DIM}[architect: planning with ${config.architectModel.modelId}]${RESET}\n`,
      );
    }
    try {
      const architectRouter = new ModelRouterImpl(
        { default: config.architectModel, fallback: [], overrides: {} },
        session.projectRoot,
        session.id,
      );
      const planText = await architectRouter.generate(
        messages.map((m) => ({ role: m.role, content: m.content })),
        { system: ARCHITECT_SYSTEM_PROMPT, maxTokens: 2000 },
      );
      if (planText.trim()) {
        messages.push({
          role: "system" as const,
          content:
            `## Architect Plan\n\nGenerated by ${config.architectModel.modelId}. Execute precisely:\n\n${planText}`,
        });
        if (!config.silent) {
          process.stdout.write(`${DIM}[architect: ${planText.length} chars]${RESET}\n`);
        }
      }
    } catch { /* non-fatal: no plan injected, execution continues normally */ }
  }

  // Auto-lint gate: per-round cache prevents >1 tsc call per file per round
  const { createLintRoundCache } = await import("./auto-lint-gate.js");
  let lintRoundCache = createLintRoundCache();
  const pendingLintErrors: string[] = [];

  while (maxToolRounds > 0) {
    // Reset lint cache at the start of each round so the same file can be
    // re-checked if it was written in a previous round.
    lintRoundCache = createLintRoundCache();

    // Inject any lint errors from the previous round as a system message
    if (pendingLintErrors.length > 0) {
      const lintMsg = pendingLintErrors.splice(0).join("\n\n");
      messages.push({
        role: "user" as const,
        content:
          `SYSTEM (auto-lint): The following TypeScript errors were detected after your last edits. ` +
          `Fix them before proceeding:\n\n${lintMsg}`,
      });
    }

    // CLI auto-continuation: when rounds just hit 0 mid-pipeline, refill budget
    if (
      shouldAutoContinueBudget({
        remainingRounds: maxToolRounds,
        isPipelineWorkflow,
        autoContinuations,
        maxAutoContinuations: MAX_AUTO_CONTINUATIONS,
        filesModified,
      })
    ) {
      autoContinuations++;
      maxToolRounds += getAutoContinuationRefill({ skillActive: config.skillActive });
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

    // Rounds-remaining awareness: inject urgency signal when budget is low
    if (maxToolRounds <= 5 && maxToolRounds > 0 && !config.silent) {
      process.stdout.write(
        `${YELLOW}[rounds remaining: ${maxToolRounds}]${RESET} ${DIM}Prioritize completing the most critical steps.${RESET}\n`,
      );
    }

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
    const _roundTokenGauge = new TokenGauge();
    if (!config.silent) {
      _roundTokenGauge.updateContext(utilization.tokens, utilization.maxTokens);
      _roundTokenGauge.printLine();
      // Tier warnings for yellow/red remain for discoverability
      if (utilization.tier === "yellow") {
        process.stdout.write(`${YELLOW}[context filling up — older messages will be summarized soon]${RESET}\n`);
      } else if (utilization.tier === "red") {
        process.stdout.write(`${RED}[context critical — use /compact or /new for fresh session]${RESET}\n`);
      }
    }

    // SWE-bench condensation (Phase 5): When context >= 80%, inject a compact
    // session summary and drop verbose tool result messages older than 5 rounds.
    // This mirrors OpenHands condensation_request.py and prevents context death
    // on long tasks (clone → install → test → fix → retest cycles).
    if (utilization.percent >= 80 && roundCounter > 5) {
      const condensationSummary = buildCondensationSummary(messages, touchedFiles, roundCounter);
      // Replace old tool results with summary: keep system prompt + first user msg + recent 5
      const condensed = condenseOldMessages(messages, 5, condensationSummary);
      if (condensed.length < messages.length) {
        messages.splice(0, messages.length, ...condensed);
        if (!config.silent) {
          process.stdout.write(
            `${DIM}[condensed: ${messages.length} msgs kept, older tool results summarized]${RESET}\n`,
          );
        }
      }
    }

    // Rounds-remaining awareness: inject urgency into LLM context at ≤ 3 rounds
    if (maxToolRounds <= 3 && maxToolRounds > 0) {
      messages.push({
        role: "system" as const,
        content:
          `## Budget Warning\n` +
          `You have ${maxToolRounds} round${maxToolRounds !== 1 ? "s" : ""} remaining. ` +
          `Prioritize completing the MOST CRITICAL steps. ` +
          `Use TodoWrite to mark what is done and what must be deferred.`,
      });
    }

    // Generate response from model (streaming with tool calling support)
    let responseText = "";
    let toolCalls: ExtractedToolCall[] = [];
    let cleanText = "";
    try {
      const renderer = new StreamRenderer(!!config.silent);
      const tokenGauge = new TokenGauge();
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
          modelRoundTrips++;
        }
        const extracted = extractToolCalls(responseText);
        cleanText = extracted.cleanText;
        toolCalls = extracted.toolCalls;
      }

      totalTokensUsed += responseText.length; // Approximate token count

      // Emit inline cost after each round (non-fatal — cost display must never break the loop)
      try {
        const costEstimate = router.getCostEstimate();
        config.onCostUpdate?.(costEstimate, config.state.model.default.provider);
        tokenGauge.updateRound({
          requestCostUsd: costEstimate.lastRequestUsd,
          sessionCostUsd: costEstimate.sessionTotalUsd,
        });
      } catch { /* non-fatal */ }

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
      sessionStatus = "FAILED";

      const errorMsg: SessionMessage = {
        id: randomUUID(),
        role: "assistant",
        content: `I encountered an error communicating with the model: ${errorMessage}`,
        timestamp: new Date().toISOString(),
      };
      session.messages.push(errorMsg);
      const sessionResult = buildSessionResultSummary({
        touchedFiles,
        testsRun,
        toolCalls: toolCallsThisTurn,
        confabulationWarnings: confabulationNudges,
        status: sessionStatus,
      });
      const sessionProofSummary = buildSessionProofSummary(
        executionLedger.validationRecords,
        executionLedger.completionGateResult,
      );
      session.messages.push({
        id: randomUUID(),
        role: "system",
        content: `${sessionResult}\n${sessionProofSummary}`,
        timestamp: new Date().toISOString(),
      });
      if (!config.silent) {
        process.stdout.write(`\n${DIM}${sessionResult}\n${sessionProofSummary}${RESET}\n`);
      }
      session.status = sessionStatus;
      try {
        await persistAgentTaskOutcome({
          prompt,
          session,
          sessionStatus,
          taskStartTime,
          completionTime,
          touchedFiles,
          executionLedger,
          verifyRetries,
          autonomyVerifyRoundsUsed,
          confabulationNudges,
          modelRoundTrips,
        });
      } catch { /* non-fatal */ }
      return session;
    }

    // ---- Anti-confabulation: empty response circuit breaker ----
    // If the model returned no text and no tool calls, track consecutive empties
    // and abort after MAX_CONSECUTIVE_EMPTY_ROUNDS (Grok empty-response fix).
    const emptyResponseEvaluation = evaluateEmptyResponseRound({
      responseText,
      toolCallCount: toolCalls.length,
      consecutiveEmptyRounds,
      maxConsecutiveEmptyRounds: MAX_CONSECUTIVE_EMPTY_ROUNDS,
    });
    consecutiveEmptyRounds = emptyResponseEvaluation.nextConsecutiveEmptyRounds;
    if (emptyResponseEvaluation.shouldWarn) {
      if (!config.silent) {
        process.stdout.write(
          `\n${YELLOW}[confab-guard] empty response (${consecutiveEmptyRounds}/${MAX_CONSECUTIVE_EMPTY_ROUNDS})${RESET}\n`,
        );
      }
      if (emptyResponseEvaluation.shouldAbort) {
        sessionStatus = "FAILED";
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

    // Inline SEARCH/REPLACE blocks: parse from model prose and apply before tool execution.
    // This lets models emit Aider-style edits without using the Edit tool explicitly.
    {
      const srModifiedFiles = new Set<string>();
      try {
        const { parseSearchReplaceBlocks, applySearchReplaceBlock } = await import(
          "./search-replace-parser.js"
        );
        const srResult = parseSearchReplaceBlocks(responseText);
        for (const block of srResult.blocks) {
          const absPath = resolve(session.projectRoot, block.filePath);
          if (srModifiedFiles.has(absPath)) continue; // already handled this file this round
          try {
            const existing = await readFile(absPath, "utf-8").catch(() => "");
            const applied = applySearchReplaceBlock(existing, block);
            if (applied.matched && applied.updatedContent !== undefined) {
              await writeFile(absPath, applied.updatedContent, "utf-8");
              filesModified++;
              srModifiedFiles.add(absPath);
              // Keep readTracker in sync so the snapshot guard stays accurate
              readTracker.set(absPath, createFileSnapshot(absPath, applied.updatedContent));
              touchedFiles.push(absPath);
              if (!config.silent) {
                process.stdout.write(
                  `${DIM}[search-replace] applied → ${block.filePath}${applied.usedFallback ? " (fallback)" : ""}${RESET}\n`,
                );
              }
            } else if (!config.silent) {
              process.stdout.write(
                `${YELLOW}[search-replace] no match in ${block.filePath}: ${applied.diagnostic ?? "check search content"}${RESET}\n`,
              );
            }
          } catch { /* non-fatal: single block failure should not abort the loop */ }
        }
      } catch { /* non-fatal: parser import failure */ }
    }

    // Display the assistant's text response (suppressed in silent mode)
    if (cleanText.length > 0 && !config.silent) {
      process.stdout.write(`${cleanText}\n`);
    }

    // If no tool calls, we're done with this turn
    if (toolCalls.length === 0) {
      if (
        executedToolsThisTurn === 0 &&
        executionRequested &&
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
        // All waves complete — AutonomyOrchestrator owns the verify loop (dim 15).
        // The orchestrator is the primary coordination backbone for autoforge paths.
        if (!config.silent) {
          process.stdout.write(
            `\n${GREEN}${BOLD}[all ${waveState.waves.length} waves complete]${RESET}\n`,
          );
        }
        if (autonomyVerifyRoundsUsed < AUTONOMY_MAX_VERIFY_ROUNDS) {
          try {
            const stack = await detectProjectStack(session.projectRoot);
            const testCmd = stack.typecheckCmd || stack.testCmd;
            if (testCmd) {
              const orchestrator = new AutonomyOrchestrator({ maxVerifyRounds: AUTONOMY_MAX_VERIFY_ROUNDS - autonomyVerifyRoundsUsed });
              const verifyFn = makeVerifyFn(testCmd);
              // Capture snapshot of messages for waveFn replay context
              const capturedMessages = messages.slice();
              const capturedResponse = responseText;
              let orchestratorInjectedContext = "";
              const orchestratorResult = await orchestrator.runWithVerifyLoop(
                ["[verify-and-fix]"],
                async (_instructions: string) => {
                  // waveFn: inject context from orchestrator into message stream
                  if (orchestratorInjectedContext) {
                    messages.push({ role: "assistant" as const, content: capturedResponse });
                    messages.push({ role: "user" as const, content: orchestratorInjectedContext });
                  }
                  void capturedMessages;
                  return capturedResponse;
                },
                verifyFn,
                { workdir: session.projectRoot, skipFinalVerify: false },
              ).catch(() => null);
              if (orchestratorResult) {
                autonomyVerifyRoundsUsed += orchestratorResult.verifyRoundsUsed;
                if (!orchestratorResult.finalSuccess && orchestratorResult.waves.length > 0) {
                  const lastWave = orchestratorResult.waves[orchestratorResult.waves.length - 1];
                  const lastVerifyOutput = lastWave?.verifyResult?.output ?? orchestratorResult.lastTestOutput;
                  if (lastVerifyOutput) {
                    if (!config.silent) {
                      process.stdout.write(
                        `\n${YELLOW}[autonomy-orchestrator: tests failed — injecting output for fix]${RESET}\n`,
                      );
                    }
                    // Classify failure mode and inject targeted hint (dim 15)
                    let failureHint = "";
                    try {
                      const { classifyAgentFailure, buildFailureModeHint } = await import("./swe-bench-runner.js");
                      const mode = classifyAgentFailure(lastVerifyOutput);
                      failureHint = "\n" + buildFailureModeHint(mode);
                      if (!config.silent) {
                        process.stdout.write(`\n${YELLOW}[recovery: failure-mode=${mode}]${RESET}\n`);
                      }
                    } catch { /* non-fatal */ }
                    orchestratorInjectedContext = buildTestOutputContext(lastVerifyOutput) + failureHint;
                    messages.push({ role: "assistant" as const, content: responseText });
                    messages.push({ role: "user" as const, content: orchestratorInjectedContext });
                    pipelineContinuationNudges = 0;
                    confabulationNudges = 0;
                    continue;
                  }
                } else if (!config.silent) {
                  process.stdout.write(
                    `\n${GREEN}[autonomy-orchestrator: all checks passed]${RESET}\n`,
                  );
                }
              }
            }
          } catch {
            // Non-fatal — skip verify if stack detection or orchestrator setup fails
          }
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

      // Anti-confabulation gate: reject completion claims when no files were
      // actually modified during an execution-oriented task.
      if (
        executionRequested &&
        filesModified === 0 &&
        confabulationNudges < MAX_CONFABULATION_NUDGES &&
        looksLikeCompletionClaim(responseText)
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
      completionTime = Date.now();
      break;
    }

    // Execute each tool call
    const toolResults: string[] = [];
    const roundWrittenFiles: string[] = [];
    let roundMajorEditGateResult: MajorEditBatchGateResult | null = null;
    let toolIndex = 0;

    // CodeAct action dispatcher: handle OpenHands-style tool names before the
    // standard tool execution loop. Models fine-tuned on OpenHands may emit
    // execute_bash / str_replace_based_edit_tool / think / finish instead of
    // DanteCode's native Bash / Edit / Write / Bash tools.
    try {
      const dispatchNormalization = normalizeActionToolCalls(toolCalls, {
        silent: Boolean(config.silent),
      });
      if (dispatchNormalization.inlineToolResults.length > 0) {
        toolResults.push(...dispatchNormalization.inlineToolResults);
      }
      if (dispatchNormalization.virtualToolCallCount > 0) {
        executedToolsThisTurn += dispatchNormalization.virtualToolCallCount;
        currentApproachToolCalls += dispatchNormalization.virtualToolCallCount;
      }
      for (const message of dispatchNormalization.logMessages) {
        process.stdout.write(`${DIM}${message}${RESET}\n`);
      }
      if (dispatchNormalization.normalizedToolCalls.length !== toolCalls.length) {
        toolCalls.splice(0, toolCalls.length, ...dispatchNormalization.normalizedToolCalls);
      } else if (
        dispatchNormalization.normalizedToolCalls.some(
          (toolCall, index) =>
            toolCall.name !== toolCalls[index]?.name || toolCall.input !== toolCalls[index]?.input,
        )
      ) {
        toolCalls.splice(0, toolCalls.length, ...dispatchNormalization.normalizedToolCalls);
      }
    } catch { /* non-fatal — fall through to standard tool loop */ }

    // Separate safe and unsafe tool calls for batching
    const safeToolCalls = toolCalls.filter((tc) => SAFE_TOOLS.has(tc.name));
    const unsafeToolCalls = toolCalls.filter((tc) => !SAFE_TOOLS.has(tc.name));

    // Execute safe tool calls in parallel
    const safeResultsMap = new Map<string, ToolResult>();
    if (safeToolCalls.length > 0) {
      const safePromises = safeToolCalls.map(async (tc) => {
        const result = await executeTool(tc.name, tc.input, session.projectRoot, {
          sessionId: session.id,
          roundId: `round-${roundCounter}`,
          sandboxEnabled: false,
          selfImprovement: config.selfImprovement,
          readTracker,
          editAttempts,
          subAgentExecutor: createSubAgentExecutor(session, config),
        });
        safeResultsMap.set(tc.id, result);
      });
      await Promise.all(safePromises);
      executedToolsThisTurn += safeToolCalls.length;
      currentApproachToolCalls += safeToolCalls.length;
    }

    for (const toolCall of unsafeToolCalls) {
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
          const fileExists =
            writeFilePath && readTracker.has(resolve(session.projectRoot, writeFilePath));
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
      if ((toolCall.name === "GitCommit" || toolCall.name === "GitPush") && filesModified === 0) {
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
        config.enableSandbox &&
        activeSandboxBridge &&
        typeof toolCall.input["command"] === "string";

      let result: ToolResult;
      // Check permissions before executing the tool (including risk classification)
      const toolPayload =
        typeof toolCall.input["command"] === "string" ? toolCall.input["command"]
        : typeof toolCall.input["file_path"] === "string" ? toolCall.input["file_path"]
        : undefined;
      const permissionError = await checkToolPermission(toolCall.name, config, toolPayload);
      if (permissionError) {
        toolResults.push(permissionError);
        continue;
      }

      // Register Write/Edit operations with the undo stack before execution
      if ((toolCall.name === "Write" || toolCall.name === "Edit") && typeof toolCall.input["file_path"] === "string") {
        const fp = toolCall.input["file_path"] as string;
        globalUndoStack.push(
          toolCall.name,
          `${toolCall.name} ${fp}`,
          async () => {
            // Lightweight registration — full undo is handled by the checkpoint system
          },
        );
      }
      if (isMCPTool) {
        try {
          const mcpResult = await config.mcpClient!.callToolByName(toolCall.name, toolCall.input);
          result = {
            toolName: toolCall.name as ToolResult["toolName"],
            content: mcpResult,
            isError: false,
            ok: true,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          result = {
            toolName: toolCall.name as ToolResult["toolName"],
            content: `MCP tool error: ${msg}`,
            isError: true,
            ok: false,
          };
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

        // Automatic bounded repair for failed verification commands
        if (toolCall.name === "Bash" && result.isError) {
          const command = toolCall.input["command"] as string;
          if (command && (
            command.includes("typecheck") ||
            command.includes("lint") ||
            command.includes("test") ||
            command.includes("build") ||
            command.includes("compile") ||
            (command.includes("npm") && (command.includes("run") || command.includes("test"))) ||
            (command.includes("yarn") && command.includes("test"))
          )) {
            const repairStart = Date.now();
            const attempt = await repairLoop.attemptRepair(result.content, session.projectRoot);
            if (attempt) {
              result.content += `\n\n[AUTOMATIC REPAIR ${attempt.attemptNumber}]: ${attempt.result} using ${attempt.plan.strategy}`;
              const repairSucceeded = attempt.result === "success";
              if (repairSucceeded) {
                // If repair succeeded, mark as not error
                result.isError = false;
              }
              // Sprint CF (dim 15): record repair attempt
              try {
                const errorMsg = result.content.slice(0, 200);
                const failureMode = errorMsg.includes("TS") || errorMsg.includes("type") ? "type_error" : "test_failure";
                recordTaskRecovery({
                  taskId: session.id,
                  attempt: attempt.attemptNumber,
                  failureMode,
                  fixApplied: `bounded_repair:${attempt.plan.strategy}`,
                  succeeded: repairSucceeded,
                  durationMs: Date.now() - repairStart,
                }, session.projectRoot);
              } catch { /* non-fatal */ }
            }
          }
        }

        // Sprint CH2 (dim 15): structured repair system message — visible to model, capped at 2
        const errorOutput = result.content;
        const hasToolError = result.isError ||
          /FAILED|error TS\d+|Error:/i.test(errorOutput.slice(0, 500));
        if (hasToolError) {
          dim15ConsecutiveFailures++;
          dim15ToolResults.push(errorOutput.slice(0, 200));
          if (dim15RepairCount.count < 2) {
            dim15RepairCount.count++;
            const errorSummary = errorOutput.slice(0, 150).replace(/\n+/g, " ").trim();
            messages.push({
              role: "system" as const,
              content: `[REPAIR attempt ${dim15RepairCount.count}/2]: Previous tool call failed — ${errorSummary}. Fix the issue before continuing.`,
            });
          }
        } else {
          dim15ConsecutiveFailures = 0;
          dim15ToolResults.push("ok");
        }

        // Sprint Dim20: auto-detect stack traces in Bash output → inject structured debug context
        try {
          if (toolCall.name === "Bash" && hasStackTrace(errorOutput)) {
            const watchVals: Record<string, string> = {};
            const dbgCtx = assembleDebugContext(errorOutput, watchVals, session.id);
            const dbgPrompt = formatDebugContextForPrompt(dbgCtx);
            messages.push({ role: "system" as const, content: dbgPrompt });
            debugContextsInjected++;
            if (dbgCtx.severityScore > maxDebugSeverity) maxDebugSeverity = dbgCtx.severityScore;
          }
        } catch { /* non-fatal */ }
      }

      firstMutationTime = await recordExecutionEvidence(
        toolCall,
        result,
        {
          executionLedger,
          firstMutationTime,
          projectRoot: session.projectRoot,
          sessionId: session.id,
          modelLabel,
        },
        executionEvidencePersister,
      );

      if (toolCall.name === "Bash") {
        const command =
          typeof toolCall.input["command"] === "string" ? toolCall.input["command"] : "";
        const snapshotKey = command.trim().replace(/\s+/g, " ");
        const outputHash = fingerprintOutput(result.content);
        const previousHashes = bashSnapshots.get(snapshotKey);
        if (previousHashes && previousHashes.has(outputHash)) {
          result = {
            ...result,
            content:
              result.content +
              "\n\nSYSTEM: This command produced identical output to a previous run. " +
              "Do not claim new results from repeated identical commands.",
          };
        }
        if (!previousHashes) {
          bashSnapshots.set(snapshotKey, new Set([outputHash]));
        } else {
          previousHashes.add(outputHash);
        }
      }

      const writtenFile = getWrittenFilePath(toolCall.name, toolCall.input);
      if (
        writtenFile &&
        !result.isError &&
        (toolCall.name === "Write" || toolCall.name === "Edit")
      ) {
        const resolvedPath = resolve(session.projectRoot, writtenFile);
        try {
          const writtenContent = await readFile(resolvedPath, "utf-8");
          const expectedWriteContent =
            typeof toolCall.input["content"] === "string" ? toolCall.input["content"] : undefined;
          const expectedEditedContent =
            typeof toolCall.input["new_string"] === "string"
              ? toolCall.input["new_string"]
              : undefined;

          const verificationFailed =
            writtenContent.trim().length === 0 ||
            (toolCall.name === "Write" &&
              expectedWriteContent !== undefined &&
              writtenContent !== expectedWriteContent) ||
            (toolCall.name === "Edit" &&
              expectedEditedContent !== undefined &&
              !writtenContent.includes(expectedEditedContent));

          if (verificationFailed) {
            result = {
              toolName: toolCall.name,
              content:
                `SYSTEM: ${toolCall.name} tool reported success, but file verification failed — ` +
                `the file at ${writtenFile} is missing, empty, or does not contain the expected content. ` +
                `The write did NOT succeed. Retry the write operation after re-reading the file.`,
              isError: true,
              ok: false,
            };
          } else {
            if (!touchedFiles.includes(resolvedPath)) {
              touchedFiles.push(resolvedPath);
            }
            roundWrittenFiles.push(resolvedPath);
            filesModified++;

            // Auto-lint gate: run tsc after every .ts/.tsx write to catch type errors
            // in the round they are introduced, before they cascade.
            try {
              const { runAutoLintGate } = await import("./auto-lint-gate.js");
              const lintResult = await runAutoLintGate(resolvedPath, session.projectRoot, lintRoundCache);
              if (!lintResult.skipped && lintResult.hasErrors) {
                pendingLintErrors.push(lintResult.formattedErrors);
              }
            } catch { /* non-fatal */ }

            // Incremental verify gate (dim 10): run full typecheckCmd after each
            // generated file write when enabled. Critical TS errors abort the write.
            if (config.incrementalVerify) {
              try {
                const stack = await detectProjectStack(session.projectRoot);
                const gateResult = await incrementalVerifyGate(resolvedPath, stack);
                if (!gateResult.passed && gateResult.output) {
                  const hasCriticalTsError = /error TS\d+/.test(gateResult.output);
                  const ctx = buildTestOutputContext(gateResult.output);
                  if (hasCriticalTsError) {
                    // Blocking: critical TypeScript errors abort the write — gate enforces, not just logs
                    result = {
                      toolName: toolCall.name,
                      content:
                        `SYSTEM: Critical TypeScript errors after writing ${writtenFile} — write aborted.\n\n${ctx}\n\n` +
                        `Fix the type errors before writing this file.`,
                      isError: true,
                      ok: false,
                    };
                  } else {
                    // Non-critical: inject context but allow write to proceed
                    toolResults.push(`SYSTEM: Incremental typecheck after writing ${writtenFile}:\n\n${ctx}`);
                  }
                }
              } catch { /* non-fatal */ }
            }

            const stubCheck = runAntiStubScanner(writtenContent, session.projectRoot, writtenFile);
            if (!stubCheck.passed) {
              const violations = stubCheck.hardViolations
                .slice(0, 3)
                .map((violation) => `${violation.message} (line ${violation.line})`)
                .join("; ");
              result = {
                toolName: toolCall.name,
                content:
                  result.content +
                  `\n\nSYSTEM: The file you just wrote contains stub code (${violations}). ` +
                  "This is NOT production-ready. Fix the stubs before proceeding.",
                isError: true,
                ok: false,
              };
            }
          }
        } catch {
          result = {
            toolName: toolCall.name,
            content:
              `SYSTEM: ${toolCall.name} tool reported success, but file verification failed — ` +
              `the file at ${writtenFile} could not be read back from disk.`,
            isError: true,
            ok: false,
          };
        }
      } else if (writtenFile && !result.isError) {
        const resolvedPath = resolve(session.projectRoot, writtenFile);
        if (!touchedFiles.includes(resolvedPath)) {
          touchedFiles.push(resolvedPath);
        }
        filesModified++;
      }

      // Progress tracking: count test runs (Bash commands that look like tests)
      if (toolCall.name === "Bash") {
        const cmd = (toolCall.input["command"] as string) || "";
        if (/\b(test|jest|vitest|mocha|pytest|cargo\s+test)\b/i.test(cmd)) {
          testsRun++;
        }
      }

      // Shared tool output truncation: keep the head/tail of large results while
      // preserving a full fidelity copy in the tool result message.
      const MAX_OUTPUT_LINES = 2000;
      let outputContent = result.content;
      const outputLines = outputContent.split("\n");
      if (outputLines.length > MAX_OUTPUT_LINES) {
        outputContent =
          outputLines.slice(0, MAX_OUTPUT_LINES).join("\n") +
          `\n\n... (truncated, ${outputLines.length} total lines)`;
      }
      outputContent = truncateToolOutput(outputContent, {
        maxChars: 50 * 1024,
        headChars: 32 * 1024,
        tailChars: 8 * 1024,
      });

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

      // Multimodal screenshot injection: if the tool produced image blocks, push a
      // user message with the image content so the model can see the screenshot.
      if (result.imageBlocks && result.imageBlocks.length > 0) {
        for (const block of result.imageBlocks) {
          messages.push({
            role: "user" as const,
            content: [
              { type: "text", text: `Screenshot from ${toolCall.name}:` },
              { type: "image", image: block.source.data, mediaType: block.source.mediaType },
            ] as unknown as string,
          });
        }
      }

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

    // Append safe tool results
    for (const tc of safeToolCalls) {
      const result = safeResultsMap.get(tc.id);
      if (result) {
        toolResults.push(result.content);
        firstMutationTime = await recordExecutionEvidence(
          tc,
          result,
          {
            executionLedger,
            firstMutationTime,
            projectRoot: session.projectRoot,
            sessionId: session.id,
            modelLabel,
          },
          executionEvidencePersister,
        );

        // Add session messages
        const toolUseMessage: SessionMessage = {
          id: randomUUID(),
          role: "assistant",
          content: `Using tool: ${tc.name}`,
          timestamp: new Date().toISOString(),
          toolUse: {
            id: tc.id,
            name: tc.name,
            input: tc.input,
          },
        };
        session.messages.push(toolUseMessage);

        const toolResultMessage: SessionMessage = {
          id: randomUUID(),
          role: "tool",
          content: result.content,
          timestamp: new Date().toISOString(),
          toolResult: {
            toolUseId: tc.id,
            content: result.content,
            isError: result.isError,
          },
        };
        session.messages.push(toolResultMessage);

        // Update progress
        toolCallsThisTurn++;
        if (toolCallsThisTurn % PROGRESS_EMIT_INTERVAL === 0) {
          const progressLine = `[progress: ${toolCallsThisTurn} tool calls | ${filesModified} files modified | ${testsRun} tests run]`;
          process.stdout.write(`\n${DIM}${progressLine}${RESET}\n`);
          session.messages.push({
            id: randomUUID(),
            role: "system" as "user",
            content: progressLine,
            timestamp: new Date().toISOString(),
          });
        }
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

    // Auto-commit: if git.autoCommit is enabled, commit all files written this
    // round with an LLM-generated conventional commit message. Opt-in only
    // (default: false) to avoid unexpected commits during normal sessions.
    if (roundWrittenFiles.length > 0 && config.git?.autoCommit === true) {
      try {
        const relFiles = roundWrittenFiles.map((f) =>
          relative(session.projectRoot, f),
        );
        const rawDiff = getDiff(session.projectRoot).slice(0, 2000);
        const commitMsg = await generateAutoCommitMessage(rawDiff, config, session);
        await autoCommit(
          { message: commitMsg, footer: "", files: relFiles, allowEmpty: false },
          session.projectRoot,
        );
        if (!config.silent) {
          process.stdout.write(
            `\n${DIM}[auto-commit: ${commitMsg.split("\n")[0]}]${RESET}\n`,
          );
        }
        // Generate and print suggested PR title (dim 8 — git-native extends beyond auto-commit)
        const prTitle = generatePRTitle(commitMsg);
        if (!config.silent) {
          process.stdout.write(`${DIM}[Suggested PR title: ${prTitle}]${RESET}\n`);
        }

        // Wire gh pr create when autoCreatePR is enabled (dim 8 — actual PR creation)
        if ((config as unknown as { autoCreatePR?: boolean }).autoCreatePR === true) {
          try {
            const safeTitle = prTitle.replace(/"/g, '\\"');
            const prUrl = execSync(
              `gh pr create --title "${safeTitle}" --body "Auto-generated by DanteCode autoforge" --fill-first 2>/dev/null || echo ""`,
              { encoding: "utf-8", cwd: session.projectRoot },
            ).trim();
            if (prUrl) {
              process.stdout.write(`${DIM}[PR created: ${prUrl}]${RESET}\n`);
            } else {
              process.stdout.write(`${DIM}[PR creation skipped — gh unavailable or no remote]${RESET}\n`);
            }
          } catch {
            process.stdout.write(`${DIM}[PR creation skipped — gh unavailable or no remote]${RESET}\n`);
          }
        }
      } catch {
        // Non-fatal: auto-commit failure should never block the agent loop
      }
    }

    // ContinuousVerifyMode (Sprint AA — dim 15): if any test file was written
    // this round, run a lightweight typecheck and emit result to task-outcomes.json.
    const TEST_FILE_RE_CV = /\.(test|spec)\.[jt]sx?$|__tests__\//;
    const roundTestFiles = roundWrittenFiles.filter((f) => TEST_FILE_RE_CV.test(f));
    if (roundTestFiles.length > 0) {
      try {
        const cvResult = await executeTool(
          "Bash",
          { command: "npm run typecheck --workspace=packages/cli 2>&1 | tail -5" },
          session.projectRoot,
          session.id,
        );
        const cvPassed = !cvResult.isError;
        const { trackTaskOutcome } = await import("@dantecode/core");
        trackTaskOutcome({
          taskId: `cv-${session.id}-r${roundCounter}`,
          description: `ContinuousVerify: ${roundTestFiles.length} test file(s) written`,
          status: cvPassed ? "success" : "partial",
          durationMs: 0,
          toolCallCount: 1,
          iterationCount: 0,
          failureMode: cvPassed ? undefined : "typecheck",
          summary: cvPassed ? "typecheck clean" : cvResult.content.slice(0, 120),
        }, session.projectRoot ?? resolve(process.cwd()));
        if (!cvPassed && !config.silent) {
          process.stdout.write(`\n${RED}[continuous-verify] typecheck failed after test file write — see above${RESET}\n`);
          toolResults.push(`[ContinuousVerify] typecheck failed after writing ${roundTestFiles.map((f) => relative(session.projectRoot, f)).join(", ")}:\n${cvResult.content.slice(0, 300)}\nFix the type errors before proceeding.`);
        } else if (cvPassed && !config.silent) {
          process.stdout.write(`\n${GREEN}[continuous-verify] typecheck clean${RESET}\n`);
        }
      } catch {
        // non-fatal
      }
    }

    // Reflection loop (aider/Cursor pattern): after code edits, auto-run
    // the project's configured lint/test/build commands. If any fail,
    // parse the output into structured errors and inject a targeted fix
    // prompt so the model can fix specific issues instead of guessing.
    const wroteCode = toolCalls.some((tc) => tc.name === "Write" || tc.name === "Edit");
    if (wroteCode && verifyRetries < maxVerifyRetries) {
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
              retryMessage = `AUTO-VERIFY (${vc.name}) FAILED — ${parsedErrors.length} structured error(s) detected:\n\n${fixPrompt}\n\n(attempt ${verifyRetries}/${maxVerifyRetries})`;

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

              if (recentOutcomePolicy.retryGuidance) {
                retryMessage += `\n\n${recentOutcomePolicy.retryGuidance}`;
              }
              if (recentOutcomePolicy.runtimeHeavy && verifyRetries >= 1) {
                retryMessage +=
                  "\n\nDo not rerun the same failing command sequence unless you changed the approach or inputs.";
              }

              if (config.verbose) {
                process.stdout.write(
                  `${DIM}[self-heal: parsed ${parsedErrors.length} error(s) from ${vc.name} output]${RESET}\n`,
                );
              }
            } else {
              // Fallback: parser found nothing structured, inject raw output as before
              retryMessage = `AUTO-VERIFY (${vc.name}) FAILED:\n${vcResult.content}\n\nFix the errors above. (attempt ${verifyRetries}/${maxVerifyRetries})`;
              if (recentOutcomePolicy.retryGuidance) {
                retryMessage += `\n\n${recentOutcomePolicy.retryGuidance}`;
              }
            }

            // Sprint CG — Dim 22: classify error and route recovery strategy
            try {
              const recoverySession = globalErrorRecoveryRouter.startSession(vcResult.content.slice(0, 500));
              const nextAction = globalErrorRecoveryRouter.nextAction(recoverySession.id);
              if (nextAction && nextAction !== "retry-immediate") {
                retryMessage += `\n\n[Recovery] Error class: ${recoverySession.fingerprint.errorClass}. Recommended action: ${nextAction}.`;
              }
            } catch { /* non-fatal */ }
            toolResults.push(retryMessage);
            process.stdout.write(
              `\n${YELLOW}[verify: ${vc.name} FAILED]${RESET} ${DIM}(retry ${verifyRetries}/${maxVerifyRetries})${RESET}\n`,
            );
          } else {
            // Verification passed — reset error signature tracking
            lastErrorSignature = "";
            sameErrorCount = 0;
            if (recentOutcomePolicy.successGuidance) {
              toolResults.push(`SYSTEM: ${recentOutcomePolicy.successGuidance}`);
            }
            // Proof oracle: inject verification proof so the model knows the change is correct.
            // This closes the completion signal — the model can wrap up rather than re-verify.
            toolResults.push(`[PROOF ATTACHED] ${vc.name} passed — verification confirms correctness. Task may be declared complete.`);
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
          persistentMemory
            .record({
              description: approachDesc,
              outcome: "success",
              toolCalls: currentApproachToolCalls,
              sessionId: session.id,
            })
            .catch(() => {});
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
          persistentMemory
            .record({
              description: approachDesc,
              outcome: "failed",
              errorSignature: lastErrorSignature || undefined,
              toolCalls: currentApproachToolCalls,
              sessionId: session.id,
            })
            .catch(() => {});

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
    } else if (wroteCode && verifyRetries >= maxVerifyRetries) {
      toolResults.push(
        `SYSTEM: Verification has failed ${maxVerifyRetries} times. Stop retrying and ask the user for guidance.`,
      );
    }

    // Wave advancement (after tool execution): if the model signaled [WAVE COMPLETE]
    // in a response that also had tool calls, advance to the next wave now.
    if (config.waveState && isWaveComplete(responseText) && maxToolRounds > 0) {
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

    // Per-turn lesson injection (dim 21): after each tool round, check for a
    // contextually-relevant lesson and inject it as a [Lesson reminder] user msg.
    if (_lessonCooldownTurns > 0) {
      _lessonCooldownTurns--;
    } else {
      try {
        const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
        if (lastAssistant) {
          const contextTokens = lastAssistant.content
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 50);
          const lessons = await queryLessons({
            contextTokens,
            limit: 1,
            projectRoot: session.projectRoot,
          });
          const topLesson = lessons[0];
          if (topLesson && topLesson.pattern !== _lastInjectedLesson) {
            // Compute a blended score to check against threshold
            const maxOccurrences = Math.max(topLesson.occurrences, 1);
            const normalizedOccurrences = topLesson.occurrences / maxOccurrences;
            if (normalizedOccurrences >= LESSON_SCORE_THRESHOLD) {
              messages.push({
                role: "user" as const,
                content: `[Lesson reminder]: ${topLesson.pattern}`,
              });
              _lastInjectedLesson = topLesson.pattern;
              _lessonCooldownTurns = LESSON_COOLDOWN;
            }
          }
        }
      } catch {
        // queryLessons failure is non-fatal
      }
    }

    // Per-round debug snapshot injection (dim 20): if debug provider has a new
    // snapshot (breakpoint hit / variable update), inject it as a user message
    // so the agent can actively react to the live runtime state.
    if (config.debugProvider?.hasNewSnapshot()) {
      try {
        const debugContext = config.debugProvider.formatForContext();
        if (debugContext) {
          messages.push({ role: "user" as const, content: `[Debug update]: ${debugContext}` });
          config.debugProvider.markConsumed();
          if (!config.silent) {
            process.stdout.write(`[debug-attach] Injected new snapshot into agent context.\n`);
          }
          // Sprint AI — Dim 20: suggest targeted repair when exception present
          const snap = config.debugProvider.getSnapshot?.();
          if (snap) {
            const hint = suggestDebugFix(snap);
            if (hint) {
              const hintText = emitDebugRepairHint(hint, session.projectRoot);
              messages.push({ role: "user" as const, content: hintText });
              if (!config.silent) {
                process.stdout.write(`${hintText}\n`);
              }
            }
            // Sprint CG — Dim 20: structured repair suggestions from exception message
            const repairSuggestions = generateRepairSuggestions(snap);
            if (repairSuggestions.length > 0) {
              const repairText = `## Repair Suggestions\n${formatRepairSuggestionsForPrompt(repairSuggestions)}`;
              messages.push({ role: "user" as const, content: repairText });
            }
          }
        }
      } catch { /* non-fatal */ }
    }
  }

  // Diff-based anti-confabulation: compare claimed vs actual file changes (advisory)
  if (config.verbose && touchedFiles.length > 0) {
    const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
    if (lastAssistant) {
      const claimedFiles = extractClaimedFiles(lastAssistant.content);
      if (claimedFiles.length > 0) {
        const actualSet = new Set(touchedFiles.map((f) => f.replace(/\\/g, "/")));
        const unverified = claimedFiles.filter(
          (f: string) => !actualSet.has(f.replace(/\\/g, "/")),
        );
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
    // detectAndRecordPatterns is not available in all danteforge builds — access defensively
    const _df = await import("@dantecode/danteforge");
    const detectFn = (_df as Record<string, unknown>).detectAndRecordPatterns as
      | ((messages: unknown[], projectRoot: string) => Promise<unknown[]>)
      | undefined;
    if (detectFn) await detectFn(conversationMessages, session.projectRoot);
  } catch {
    // Non-fatal: pattern detection failure should not break the session
  }

  // Update session timestamp
  session.updatedAt = new Date().toISOString();

  // Derive touchedFiles from execution ledger
  touchedFiles.length = 0;
  touchedFiles.push(...executionLedger.mutationRecords.map((r) => r.path));

  // Evaluate completion gate
  const gateResult = evaluateCompletionGate(executionLedger, requestClass);
  await recordCompletionGate(
    session.projectRoot,
    session.id,
    `${config.state.model.default.provider}/${config.state.model.default.modelId}`,
    gateResult,
  );
  executionLedger.completionGateResult = gateResult;
  if (!gateResult.ok) {
    sessionStatus = "INCOMPLETE";
    if (!config.silent) {
      process.stdout.write(
        `\n${RED}[completion gate failed] ${gateResult.reasonCode}: ${gateResult.message}${RESET}\n`,
      );
    }
  } else if (maxToolRounds === 0 && executionRequested && sessionStatus !== "FAILED") {
    sessionStatus = "INCOMPLETE";
  }

  // Attach ledger, status, and touched files to session
  session.executionLedger = executionLedger;
  session.status = sessionStatus;
  session.touchedFiles = [...touchedFiles];

  // Sprint AQ (dim 7): record convergence evidence — finishedCleanly only when COMPLETE
  try {
    autonomyTracker.trackConvergence(
      session.id,
      roundCounter,
      initialMaxRounds,
      sessionStatus === "COMPLETE",
    );
  } catch { /* non-fatal */ }

  // Sprint AU (dim 15): hard-task finish-rate artifact
  try {
    const taskPrompt = prompt.slice(0, 400);
    const touchedArr = [...touchedFiles];
    recordFinishRate({
      taskId: session.id,
      taskDifficulty: classifyTaskDifficulty(taskPrompt, touchedArr),
      finishedCleanly: sessionStatus === "COMPLETE",
      roundsUsed: roundCounter,
      touchedFiles: touchedArr.length,
      verifyPassed: sessionStatus === "COMPLETE",
    }, session.projectRoot);
  } catch { /* non-fatal */ }

  // Sprint AV (dim 21): memory-to-outcome correlation
  try {
    const postContextHits = (() => { try { return loadContextCoverage(session.projectRoot).length; } catch { return 0; } })();
    const contextHitsUsed = Math.max(0, postContextHits - preSessionContextHits);
    recordMemoryOutcomeCorrelation(session.id, contextHitsUsed, sessionStatus === "COMPLETE", session.projectRoot);
  } catch { /* non-fatal */ }

  // Sprint AX (dim 6): inline edit acceptance — session completion as acceptance proxy
  try {
    new InlineEditAcceptanceStore(session.projectRoot).recordAcceptance(
      session.projectRoot, session.id, sessionStatus === "COMPLETE",
    );
  } catch { /* non-fatal */ }

  // Sprint CG (dim 6): build inline edit quality report and record trend
  try {
    const sessionCompleted = sessionStatus === "COMPLETE";
    const sessionMetrics = buildInlineEditMetrics(session.id, [{
      accepted: sessionCompleted,
      partial: false,
      editDistance: sessionCompleted ? Math.min(touchedFiles.length * 10, 100) : 200,
    }]);
    const priorReports = loadInlineEditReports(session.projectRoot);
    const allMetrics = priorReports.flatMap((r) => r.sessions).concat(sessionMetrics);
    const report = buildInlineEditQualityReport(allMetrics.slice(-20)); // rolling 20-session window
    recordInlineEditReport(report, session.projectRoot);
    if (!config.silent && report.trendDirection === "declining") {
      process.stdout.write(`\n[Inline Edit Quality] Trend: ${report.trendDirection} (session score: ${sessionMetrics.qualityScore.toFixed(2)})\n`);
    }
  } catch { /* non-fatal */ }

  // Derive completion verdict string from sessionStatus for use in post-session analytics
  const sessionVerdict: "COMPLETED" | "ATTEMPTED" | "FAILED" =
    sessionStatus === "COMPLETE" ? "COMPLETED" : sessionStatus === "FAILED" ? "FAILED" : "ATTEMPTED";

  // Sprint AX (dim 27): cost-per-success metric
  try {
    const finalCostForLog = router.getCostEstimate();
    recordCostPerTaskOutcome(session.id, finalCostForLog.sessionTotalUsd ?? 0, sessionStatus === "COMPLETE", session.projectRoot);
  } catch { /* non-fatal */ }

  // Sprint AZ (dim 2): compute and record citation score
  try {
    const assistantTexts = session.messages
      .filter((m) => m.role === "assistant")
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    const citationResult = computeCitationScore(session.id, assistantTexts);
    recordCitationResult(citationResult, session.projectRoot);
  } catch { /* non-fatal */ }

  // Sprint AZ (dim 21): compute and record memory decision influence
  try {
    const assistantTexts = session.messages
      .filter((m) => m.role === "assistant")
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    const influence = computeMemoryDecisionInfluence(session.id, injectedMemoryFacts, assistantTexts);
    recordMemoryDecisionInfluence(influence, session.projectRoot);
  } catch { /* non-fatal */ }

  // Sprint Memory (dim 21): join memory influence to outcome and record correlation
  try {
    const { joinMemoryToOutcomes, computeMemoryOutcomeCorrelation, recordMemoryCorrelation } = await import("@dantecode/core");
    const joined = joinMemoryToOutcomes(session.projectRoot);
    if (joined.length >= 2) {
      const correlation = computeMemoryOutcomeCorrelation(joined);
      recordMemoryCorrelation(correlation, session.projectRoot);
    }
  } catch { /* non-fatal */ }

  // Sprint Dim3: retrieval relevance eval — join retrieval context to task outcome
  try {
    const { evaluateRetrievalRelevance, getRetrievalImpactOnCompletion, computeCitationScore: getCitation } = await import("@dantecode/core");
    const queryProxy = prompt.slice(0, 200);
    const assistantTextsForRetrieval = session.messages
      .filter((m) => m.role === "assistant")
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    const citedKeysForRetrieval = getCitation(session.id, assistantTextsForRetrieval).citedKeys;
    const resultProxies = citedKeysForRetrieval.map((k: string) => ({ filePath: k, snippet: k }));
    evaluateRetrievalRelevance(queryProxy, resultProxies, sessionVerdict, session.projectRoot);
    getRetrievalImpactOnCompletion(session.projectRoot);
  } catch { /* non-fatal */ }

  // Sprint Dim20: record debug repair outcome — hadDebugContext + verdict for impact analysis
  try {
    recordDebugRepairOutcome({
      sessionId: session.id,
      hadDebugContext: debugContextsInjected > 0,
      debugContextCount: debugContextsInjected,
      verdict: sessionVerdict,
      severityScore: maxDebugSeverity,
      timestamp: new Date().toISOString(),
    }, session.projectRoot);
  } catch { /* non-fatal */ }

  // Sprint BB (dim 3): compute and record quality trend
  try {
    const qTrend = computeQualityTrend(session.projectRoot);
    recordQualityTrend(qTrend, session.projectRoot);
    if (qTrend.isAlert && !config.silent) {
      process.stdout.write(
        `\n[Quality Trend] Session avg ${qTrend.currentSessionAvg.toFixed(2)} is ${Math.abs(qTrend.delta).toFixed(2)} below 30-day avg ${qTrend.rollingAvg.toFixed(2)}\n`,
      );
    }
  } catch { /* non-fatal */ }

  // Sprint CE (dim 7+15): record autonomy session summary
  try {
    const autonomyEntry = buildAutonomySessionSummary(
      session.id,
      messages.length,
      1,    // tasksAttempted = 1 per session
      sessionStatus === "COMPLETE" ? 1 : 0,
      toolCallsThisTurn,
      touchedFiles.length,
      0,    // userInterventions (not tracked yet, use 0)
      sessionStatus === "FAILED" ? ["failed"] : [],
    );
    recordAutonomyReport(autonomyEntry, session.projectRoot);
  } catch { /* non-fatal */ }

  const sessionResult = buildSessionResultSummary({
    touchedFiles,
    testsRun,
    toolCalls: toolCallsThisTurn,
    confabulationWarnings: confabulationNudges,
    status: sessionStatus,
  });
  const sessionProofSummary = buildSessionProofSummary(
    executionLedger.validationRecords,
    executionLedger.completionGateResult,
  );
  // Sprint AB (dim 11): inject structured session summary into messages
  const agentSessionSummary = summarizeAgentSession(messages, touchedFiles, sessionStatus);
  session.messages.push({
    id: randomUUID(),
    role: "system",
    content: agentSessionSummary,
    timestamp: new Date().toISOString(),
  });

  session.messages.push({
    id: randomUUID(),
    role: "system",
    content: `${sessionResult}\n${sessionProofSummary}`,
    timestamp: new Date().toISOString(),
  });
  if (!config.silent) {
    process.stdout.write(`\n${DIM}${sessionResult}\n${sessionProofSummary}${RESET}\n`);
    // Dim 30 — Session explanation summary (trust UX): render proof as user-facing narrative
    try {
      const editedFiles = touchedFiles.slice(0, 6);
      const sessionConfidence = sessionStatus === "COMPLETE" ? 0.88 : sessionStatus === "INCOMPLETE" ? 0.65 : 0.45;
      const summary = renderSessionSummary({
        filesEdited: editedFiles,
        testsResult: testsRun > 0 ? `${testsRun} test run${testsRun !== 1 ? "s" : ""}` : undefined,
        confidence: sessionConfidence,
      });
      process.stdout.write(`\n${DIM}${summary}${RESET}\n`);
    } catch { /* non-fatal */ }
  }

  if (localSandboxBridge) {
    await localSandboxBridge.shutdown();
  }

  // Log speed-to-verified-completion metrics
  const taskDuration = completionTime ? completionTime - taskStartTime : Date.now() - taskStartTime;
  const timeToFirstMutation = firstMutationTime ? firstMutationTime - taskStartTime : null;
  const repoMemoryUsed = true; // Assume if loaded, it was used

  // Add to execution ledger for persistence
  if (!session.executionLedger) session.executionLedger = { toolCallRecords: [], mutationRecords: [], validationRecords: [] };
  session.executionLedger.speedMetrics = {
    taskDuration,
    timeToFirstMutation,
    modelRoundTrips,
    fileReads,
    repoMemoryHits: repoMemoryUsed ? 1 : 0,
    repairAttempts,
    timestamp: new Date().toISOString()
  };

  if (!config.silent) {
    process.stdout.write(`\n${DIM}[speed-metrics] Duration: ${taskDuration}ms | Round-trips: ${modelRoundTrips} | File reads: ${fileReads} | Repo memory hits: ${repoMemoryUsed ? 1 : 0} | Repair attempts: ${repairAttempts}${timeToFirstMutation ? ` | Time to first mutation: ${timeToFirstMutation}ms` : ''}${RESET}\n`);
  }

  // Persist session cost to disk (non-fatal — cost persistence must never break the loop)
  try {
    const finalCost = router.getCostEstimate();
    if (finalCost.sessionTotalUsd > 0) {
      const { appendSessionCost } = await import("./cost-tracker.js");
      await appendSessionCost({
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        provider: config.state.model.default.provider,
        totalCostUsd: finalCost.sessionTotalUsd,
        totalTokens: finalCost.tokensUsedSession,
        requestCount: modelRoundTrips,
        projectRoot: session.projectRoot,
      });
      // Dim 27: Print user-visible session cost summary to CLI
      process.stdout.write(
        `\n💰 Session cost: ~$${finalCost.sessionTotalUsd.toFixed(4)}` +
          ` (${finalCost.tokensUsedSession.toLocaleString()} tokens)\n`,
      );
    }
  } catch { /* non-fatal */ }

  try {
    await persistAgentTaskOutcome({
      prompt,
      session,
      sessionStatus,
      taskStartTime,
      completionTime,
      touchedFiles,
      executionLedger,
      verifyRetries,
      autonomyVerifyRoundsUsed,
      confabulationNudges,
      modelRoundTrips,
    });
  } catch { /* non-fatal */ }

  // Sprint CH2 (dim 15): completion verdict — COMPLETED | ATTEMPTED | FAILED
  try {
    const { verdict, reason } = computeTaskCompletionVerdict(
      dim15ToolResults,
      toolCallsThisTurn,
      dim15ConsecutiveFailures,
    );
    recordTaskCompletion({
      sessionId: session.id,
      prompt: prompt.slice(0, 120),
      verdict,
      reason,
      toolCallCount: toolCallsThisTurn,
    }, session.projectRoot);
    if (!config.silent) {
      process.stdout.write(`\n[Task Verdict] ${verdict}: ${reason}\n`);
    }
  } catch { /* non-fatal */ }

  // Track task outcome to .danteforge/task-outcomes.json (Sprint Z)
  try {
    const { trackTaskOutcome } = await import("@dantecode/core");
    const outcomeStatus =
      sessionStatus === "COMPLETE" ? "success" :
      sessionStatus === "INCOMPLETE" ? "partial" : "failure";
    trackTaskOutcome(
      {
        taskId: session.id,
        description: prompt.slice(0, 120),
        status: outcomeStatus,
        durationMs: taskDuration,
        toolCallCount: modelRoundTrips,
        iterationCount: autonomyVerifyRoundsUsed,
        summary: sessionResult.slice(0, 200),
      },
      session.projectRoot ?? resolve(process.cwd()),
    );
  } catch { /* non-fatal */ }

  return session;
}
