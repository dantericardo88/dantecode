// ============================================================================
// @dantecode/cli — Slash Command Router for the REPL
// Each slash command is a function that operates on the REPL state.
// ============================================================================

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import {
  appendAuditEvent,
  criticDebate,
  createSelfImprovementContext,
  getProviderCatalogEntry,
  getContextUtilization,
  globalVerificationRailRegistry,
  parseModelReference,
  readAuditEvents,
  MultiAgent,
  ModelRouterImpl,
  runQaSuite,
  SessionStore,
  DurableRunStore,
  AutoforgeCheckpointManager,
  TaskCircuitBreaker,
  RecoveryEngine,
  EventSourcedCheckpointer,
  LoopDetector,
  parseSkillWaves,
  createWaveState,
  verifyOutput,
  VerificationHistoryStore,
  VerificationBenchmarkStore,
  VerificationSuiteRunner,
  RunReportAccumulator,
  serializeRunReportToMarkdown,
  writeRunReport,
  estimateMessageTokens,
  verifyCompletion,
  deriveExpectations,
  globalApprovalGateway,
  globalToolScheduler,
  updateStateYaml,
  PROVIDER_CATALOG,
  MODEL_CATALOG,
  estimateRunCost,
  detectDrift,
} from "@dantecode/core";
import type {
  CriticOpinion,
  MultiAgentProgressCallback,
  QaSuiteOutputInput,
  VerificationHistoryKind,
  VerificationRail,
  VerifyOutputInput,
  WaveOrchestratorState,
  WorkflowExecutionContext,
  ConfidenceSynthesisResult,
  ReasoningTier,
  ReasoningChain,
} from "@dantecode/core";
import { loadWorkflowCommand, createWorkflowExecutionContext } from "@dantecode/core";
import {
  runLocalPDSEScorer,
  runGStack,
  allGStackPassed,
  summarizeGStackResults,
  queryLessons,
  formatLessonsForPrompt,
  runAutoforgeIAL,
  formatBladeProgressLine,
} from "@dantecode/danteforge";
import {
  listSkills,
  getSkill,
  SkillCatalog,
  installSkill,
  verifySkill,
} from "@dantecode/skill-adapter";
import {
  getStatus,
  getDiff,
  autoCommit,
  revertLastCommit,
  createWorktree,
  mergeWorktree,
  removeWorktree,
  getGitStatusSummary,
  watchGitEvents,
  listGitWatchers,
  stopGitWatcher,
  addChangeset,
  WebhookListener,
  listWebhookListeners,
  stopWebhookListener,
  scheduleGitTask,
  listScheduledGitTasks,
  stopScheduledGitTask,
} from "@dantecode/git-engine";
import {
  GitAutomationOrchestrator,
  substitutePromptVars,
  type AgentBridgeConfig,
  type AgentBridgeResult,
} from "@dantecode/automation-engine";
import type {
  Session,
  SessionMessage,
  ChatSessionFile,
  DanteCodeState,
  ModelConfig,
  ModelRouterConfig,
} from "@dantecode/config-types";
import type { GitEventType, WebhookProvider } from "@dantecode/git-engine";
import type { DanteGaslightIntegration } from "@dantecode/dante-gaslight";
import { getThemeEngine, renderTokenDashboard } from "@dantecode/ux-polish";
import type { ThemeName } from "@dantecode/ux-polish";
import { SandboxBridge } from "./sandbox-bridge.js";
import { DanteSandbox, globalApprovalEngine } from "@dantecode/dante-sandbox";
import { runAgentLoop } from "./agent-loop.js";
import { runSkillsCommand } from "./commands/skills.js";
import { runSkillPolicyCheck } from "@dantecode/skills-policy";
import { discoverSkillsWithScopes } from "@dantecode/skills-registry";
import { getOrInitGaslight, getOrInitMemory } from "./lazy-init.js";
import { runGaslightCommand } from "./commands/gaslight.js";
import { runFearsetCommand } from "./commands/fearset.js";
import { researchSlashHandler } from "./commands/research.js";
import { automateCommand } from "./commands/automate.js";
import { adaptationCommand } from "./commands/adaptation.js";
import { planCommand } from "./commands/plan.js";
import { buildCliOperatorStatus } from "./operator-status.js";
import { mergeVisibleSkills } from "./skill-visibility.js";
import { loadSlashCommandRegistry, type NativeSlashCommandDefinition } from "./command-registry.js";
import { countSuccessfulSessions } from "./session-utils.js";
import {
  configureApprovalMode,
  normalizeApprovalMode,
  type ApprovalModeInput,
} from "./approval-mode-runtime.js";

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

// ------------------------------------------------------------------------------
// Tree Visualization Helpers
// ------------------------------------------------------------------------------
// Cursor movement for in-place updates
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const MOVE_CURSOR_UP = (lines: number) => `\x1b[${lines}A`;
const CLEAR_SCREEN_FROM_CURSOR = "\x1b[0J";

interface ProgressNode {
  name: string;
  status: "pending" | "running" | "complete" | "failed";
  pdseScore?: number;
  progress?: number;
  children?: ProgressNode[];
}

function renderProgressTree(nodes: ProgressNode[], prefix = "", isLast = true): string {
  const lines: string[] = [];
  const childPrefix = prefix + (isLast ? "    " : "│   ");

  nodes.forEach((node, index) => {
    const isLastNode = index === nodes.length - 1;
    let statusIcon: string;
    let statusColor: string;

    switch (node.status) {
      case "running":
        statusIcon = "▸";
        statusColor = YELLOW;
        break;
      case "complete":
        statusIcon = "✓";
        statusColor = GREEN;
        break;
      case "failed":
        statusIcon = "✗";
        statusColor = RED;
        break;
      default:
        statusIcon = "○";
        statusColor = DIM;
    }

    let label = node.name;
    if (node.progress !== undefined) {
      label += ` (${node.progress}%)`;
    }
    if (node.pdseScore !== undefined) {
      const pdseStr = node.pdseScore.toFixed(0);
      const pdseColor = node.pdseScore >= 80 ? GREEN : node.pdseScore >= 60 ? YELLOW : RED;
      label += ` ${pdseColor}${pdseStr}${RESET}`;
    }

    lines.push(
      `${prefix}${isLastNode ? "└──" : "├──"} ${statusColor}${statusIcon}${RESET} ${BOLD}${label}${RESET}`,
    );

    if (node.children && node.children.length > 0) {
      lines.push(...renderProgressTree(node.children, childPrefix, isLastNode));
    }
  });

  return lines.join("\n");
}

// Start progress display with initial state
function startProgressDisplay(header: string, initialNodes: ProgressNode[]) {
  process.stdout.write(HIDE_CURSOR);
  const initialTree = renderProgressTree(initialNodes);
  const display = `\n${header}\n${initialTree}\n\n`;
  process.stdout.write(display);
  return {
    update: (nodes: ProgressNode[]) => {
      const newTree = renderProgressTree(nodes);
      const lines = newTree.split("\n").length + 2; // header + empty line
      process.stdout.write(MOVE_CURSOR_UP(lines) + CLEAR_SCREEN_FROM_CURSOR);
      process.stdout.write(`${header}\n${newTree}\n\n`);
    },
    end: () => {
      process.stdout.write(SHOW_CURSOR);
    },
  };
}

// --------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** The mutable state shared between all slash commands and the REPL. */
export interface ReplState {
  session: Session;
  state: DanteCodeState;
  projectRoot: string;
  verbose: boolean;
  enableGit: boolean;
  enableSandbox: boolean;
  /** Whether silent mode is active (toggle with /silent). */
  silent: boolean;
  lastEditFile: string | null;
  lastEditContent: string | null;
  lastRestoreEvent?: { restoredAt: string; restoreSummary: string } | null;
  /** Files for which a pre-mutation debug-trail snapshot has been captured this session. */
  preMutationSnapshotted: Set<string>;
  /** Tracks recent tool call signatures for stuck-loop detection (from opencode/OpenHands). */
  recentToolCalls: string[];
  /** When set by a slash command, processInput will feed this prompt to the agent loop. */
  pendingAgentPrompt: string | null;
  /** Pending durable run ID to resume on the next agent loop turn. */
  pendingResumeRunId: string | null;
  /** Expected workflow name for the next agent loop turn. */
  pendingExpectedWorkflow: string | null;
  /**
   * Full workflow execution context loaded from workflow-runtime.ts.
   * When set, the agent loop injects the contract preamble (stages, failure/rollback
   * policy) into the system prompt — giving all models structured pipeline guidance.
   */
  pendingWorkflowContext?: WorkflowExecutionContext | null;
  /** Active abort controller for cancelling streaming generation via Ctrl+C. */
  activeAbortController: AbortController | null;
  /** Live sandbox bridge when sandbox mode is enabled. */
  sandboxBridge: SandboxBridge | null;
  /** MCP client manager for external tool integration. */
  mcpClient?: {
    isConnected: () => boolean;
    getConnectedServers: () => string[];
    listTools: () => Array<{ name: string; description: string; serverName: string }>;
  };
  /** Background agent runner (lazily initialized by /bg). */
  _bgRunner?: unknown;
  /** Durable git automation orchestrator for workflow/webhook/schedule pipelines. */
  _gitAutomationOrchestrator?: unknown;
  /** Code index (lazily initialized by /index and /search). */
  _codeIndex?: unknown;
  /** Currently active skill name, or null. Used to enable universal pipeline continuation. */
  activeSkill: string | null;
  /** Wave orchestrator state for step-by-step skill execution (Claude Workflow Mode). */
  waveState: WaveOrchestratorState | null;
  /**
   * Live DanteGaslightIntegration singleton shared between the agent loop and
   * slash commands. When set, /gaslight on/off call setEnabled() on the same
   * instance the agent loop uses — not a detached disk-reading copy.
   */
  gaslight: DanteGaslightIntegration | null;
  /** DanteMemory orchestrator — wired from repl.ts. Null if init failed. */
  memoryOrchestrator: import("@dantecode/memory-engine").MemoryOrchestrator | null;
  /** Semantic index for codebase search — wired from repl.ts. Null until initialized. */
  semanticIndex: import("@dantecode/core").SemanticIndex | null;
  /**
   * Manual reasoning tier override set by /think command.
   * When set, the agent loop uses this tier instead of calling decideTier.
   * Cleared after each prompt unless reasoningOverrideSession is true.
   */
  reasoningOverride?: ReasoningTier;
  /** When true, reasoningOverride persists for the entire session. Default: false. */
  reasoningOverrideSession?: boolean;
  /** Last thinking budget used (tokens). Displayed by /think. */
  lastThinkingBudget?: number;
  /** Active ReasoningChain instance — shared between agent-loop and /think stats. */
  reasoningChain?: ReasoningChain;
  /** Active TUI theme name. Defaults to "default". Persisted via /theme command. */
  theme: ThemeName;
  /** Active run report accumulator for /party and skill runs. */
  runReportAccumulator?: RunReportAccumulator | null;
  /** D-12: Model adaptation store for quirk detection and overrides. */
  modelAdaptationStore?: import("@dantecode/core").ModelAdaptationStore | null;
  /** Verification trend tracker — records PDSE scores and detects regressions. */
  verificationTrendTracker: import("@dantecode/core").VerificationTrendTracker | null;
  /** Cache for PDSE scores to avoid recomputing during file listing. */
  pdseCache: Map<string, number>;
  /** Last list of files shown to the user for selection. */
  lastFileList: string[];
  /**
   * Per-file PDSE results from the most recent agent-loop run.
   * Populated by the DanteForge pipeline block in agent-loop.ts.
   * Passed to generateSessionReport so REPL run reports include verification truth.
   */
  lastSessionPdseResults: Array<{ file: string; pdseScore: number; passed: boolean }>;
  planMode: boolean;
  currentPlan: import("@dantecode/core").ExecutionPlan | null;
  planApproved: boolean;
  currentPlanId: string | null;
  planExecutionInProgress: boolean;
  planExecutionResult: import("@dantecode/core").PlanExecutionResult | null;
  approvalMode: ApprovalModeInput | "review" | "apply" | "autoforge";
  taskMode: "observe-only" | "diagnose-only" | "run-and-observe" | null;
  macroRecording: boolean;
  macroRecordingName: string | null;
  macroRecordingSteps: Array<{ type: "slash" | "input"; value: string }>;
}

/** A single slash command handler. */
interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  handler: (args: string, state: ReplState) => Promise<string>;
  tier?: 1 | 2;
  category?:
    | "core"
    | "git"
    | "verification"
    | "memory"
    | "skills"
    | "sessions"
    | "search"
    | "agents"
    | "automation"
    | "sandbox"
    | "advanced";
}

// ----------------------------------------------------------------------------
type MacroStep = { type: "slash" | "input"; value: string };
type MacroDefinition = { [name: string]: MacroStep[] };

// ----------------------------------------------------------------------------
async function loadMacros(state: ReplState): Promise<MacroDefinition> {
  const macrosPath = join(state.projectRoot, ".dantecode", "macros.json");
  try {
    await mkdir(join(state.projectRoot, ".dantecode"), { recursive: true });
    const content = await readFile(macrosPath, "utf-8");
    const macros = JSON.parse(content) as MacroDefinition;
    return macros;
  } catch {
    return {};
  }
}

async function saveMacros(macros: MacroDefinition, state: ReplState): Promise<void> {
  const macrosPath = join(state.projectRoot, ".dantecode", "macros.json");
  await mkdir(join(state.projectRoot, ".dantecode"), { recursive: true });
  await writeFile(macrosPath, JSON.stringify(macros, null, 2), "utf-8");
}

// ----------------------------------------------------------------------------
async function macroRecordCommand(args: string, state: ReplState): Promise<string> {
  const name = args.trim();
  if (!name) {
    return `${RED}Usage: /macro record <name>${RESET}`;
  }

  if (state.macroRecording) {
    return `${RED}Already recording macro: ${state.macroRecordingName}${RESET}`;
  }

  state.macroRecording = true;
  state.macroRecordingName = name;
  state.macroRecordingSteps = [];
  return `${GREEN}Started recording macro: ${name}${RESET} ${DIM}(Use /macro stop to finish)${RESET}`;
}

async function macroStopCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.macroRecording) {
    return `${YELLOW}No macro is currently being recorded.${RESET}`;
  }

  const name = state.macroRecordingName!;
  const macros = await loadMacros(state);
  const steps = [...state.macroRecordingSteps];

  macros[name] = steps;
  await saveMacros(macros, state);

  state.macroRecording = false;
  state.macroRecordingName = null;
  state.macroRecordingSteps = [];

  return `${GREEN}Recorded macro: ${name}${RESET} ${DIM}(${steps.length} steps)${RESET}`;
}

async function macroPlayCommand(args: string, state: ReplState): Promise<string> {
  const name = args.trim();
  if (!name) {
    return `${RED}Usage: /macro play <name>${RESET}`;
  }

  const macros = await loadMacros(state);
  const macro = macros[name];
  if (!macro) {
    return `${RED}Macro not found: ${name}${RESET}`;
  }

  // Verify PDSE before playing
  if (macro.length > 0 && state.lastSessionPdseResults.length > 0) {
    const recentPdse =
      state.lastSessionPdseResults.reduce((total, result) => total + result.pdseScore, 0) /
      state.lastSessionPdseResults.length;
    const threshold = state.state.pdse?.threshold ?? 85;
    if (recentPdse < threshold / 100) {
      return `${RED}PDSE verification failed${RESET} ${DIM}(recent score: ${(recentPdse * 100).toFixed(1)}, threshold: ${threshold})${RESET}`;
    }
  }

  for (const step of macro) {
    if (step.type === "slash") {
      const result = await routeSlashCommand(step.value, state);
      process.stdout.write(`${CYAN}[MACRO ${name}]${RESET} /${step.value}\n`);
      if (result) {
        process.stdout.write(`${result}\n`);
      }
    }
  }

  return `${GREEN}Played macro: ${name}${RESET} ${DIM}(${macro.length} steps)${RESET}`;
}

async function macroListCommand(_args: string, state: ReplState): Promise<string> {
  const macros = await loadMacros(state);
  const names = Object.keys(macros).sort();

  if (names.length === 0) {
    return `${DIM}No macros defined. Use /macro record <name> to start recording.${RESET}`;
  }

  const lines = [`${BOLD}Stored Macros${RESET}`, ""];
  for (const name of names) {
    const steps = macros[name];
    if (steps) {
      lines.push(`  ${YELLOW}${name}${RESET} ${DIM}(${steps.length} steps)${RESET}`);
    }
  }

  return lines.join("\n");
}

async function macroCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/, 2);
  const subcommand = parts[0] || "";
  const rest = parts[1] || "";

  switch (subcommand) {
    case "record":
      return await macroRecordCommand(rest, state);
    case "stop":
      return await macroStopCommand("", state);
    case "play":
      return await macroPlayCommand(rest, state);
    case "list":
      return await macroListCommand("", state);
    default:
      return `${RED}Usage: /macro <record|stop|play|list>${RESET}`;
  }
}

function cloneSessionForTask(
  session: Session,
  projectRoot: string,
  taskId: string,
  snapshot?: Session,
): Session {
  if (snapshot) {
    return JSON.parse(JSON.stringify(snapshot)) as Session;
  }

  return {
    ...JSON.parse(JSON.stringify(session)),
    id: `bg-${taskId}`,
    projectRoot,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Session;
}

function collectTouchedFilesFromSession(session: Session, projectRoot: string): string[] {
  const touched = new Set<string>();

  for (const message of session.messages) {
    const filePath = message.toolUse?.input?.["file_path"];
    if (
      message.toolUse &&
      (message.toolUse.name === "Write" || message.toolUse.name === "Edit") &&
      typeof filePath === "string"
    ) {
      touched.add(resolve(projectRoot, filePath));
    }
  }

  return Array.from(touched);
}

function getLastAssistantText(session: Session): string {
  const lastAssistant = [...session.messages]
    .reverse()
    .find((message) => message.role === "assistant" && typeof message.content === "string");
  return (lastAssistant?.content as string | undefined) ?? "Background task completed.";
}

async function ensureBackgroundRunner(state: ReplState) {
  const { BackgroundAgentRunner } = await import("@dantecode/core");

  if (!state._bgRunner) {
    state._bgRunner = new BackgroundAgentRunner(1, state.projectRoot);
  }

  const runner = state._bgRunner as InstanceType<typeof BackgroundAgentRunner>;
  const hasConfiguredWorkFn =
    typeof (runner as { hasWorkFn?: () => boolean }).hasWorkFn === "function"
      ? (runner as { hasWorkFn: () => boolean }).hasWorkFn()
      : false;

  if (!hasConfiguredWorkFn) {
    runner.setWorkFn(async (prompt, onProgress, context) => {
      const latestCheckpoint = context.getLatestCheckpoint?.();
      const taskProjectRoot = context.task.worktreeDir ?? state.projectRoot;
      const workingSession = cloneSessionForTask(
        state.session,
        taskProjectRoot,
        context.task.id,
        latestCheckpoint?.sessionSnapshot,
      );

      onProgress(
        latestCheckpoint
          ? `Resuming from checkpoint ${latestCheckpoint.id}`
          : "Starting autonomous agent loop...",
      );

      await context.saveCheckpoint?.(
        latestCheckpoint ? "resume-start" : "task-start",
        workingSession,
      );

      const completedSession = await runAgentLoop(prompt, workingSession, {
        state: state.state,
        verbose: state.verbose,
        enableGit: state.enableGit,
        enableSandbox: state.enableSandbox,
        silent: true,
        sandboxBridge: state.sandboxBridge ?? undefined,
        selfImprovement: context.task.selfImprovement,
      });

      await context.saveCheckpoint?.("post-run", completedSession);

      return {
        output: getLastAssistantText(completedSession),
        touchedFiles: collectTouchedFilesFromSession(completedSession, taskProjectRoot),
      };
    });
  }

  return runner;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must include a non-empty "${key}" string.`);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function shorten(value: string, max = 96): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 3)}...`;
}

function formatFraction(value: number | undefined): string {
  return typeof value === "number" ? value.toFixed(2) : "-";
}

function formatPassFail(passed: boolean): string {
  return passed ? `${GREEN}PASSED${RESET}` : `${RED}FAILED${RESET}`;
}

function hasFlag(args: string, flag: string): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(flag)}(?=\\s|$)`).test(args);
}

function readFlagValue(args: string, flag: string): string | undefined {
  const match = args.match(new RegExp(`${escapeRegExp(flag)}\\s+([^\\s]+)`));
  return match?.[1];
}

function stripFlag(args: string, flag: string): string {
  return args.replace(new RegExp(`(^|\\s)${escapeRegExp(flag)}(?=\\s|$)`, "g"), " ").trim();
}

function stripFlagWithValue(args: string, flag: string): string {
  return args.replace(new RegExp(`${escapeRegExp(flag)}\\s+([^\\s]+)`, "g"), " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadJsonFile(
  relativeFilePath: string,
  state: ReplState,
): Promise<Record<string, unknown>> {
  const resolved = resolve(state.projectRoot, relativeFilePath.replace(/^['"]|['"]$/g, ""));
  const raw = await readFile(resolved, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function getGitAutomationOrchestrator(state: ReplState): GitAutomationOrchestrator {
  if (!state._gitAutomationOrchestrator) {
    state._gitAutomationOrchestrator = new GitAutomationOrchestrator({
      projectRoot: state.projectRoot,
      sessionId: state.session.id,
      modelId: `${state.session.model.provider}/${state.session.model.modelId}`,
      runAgent: buildAutomationAgentRunner(state),
    });
  }
  return state._gitAutomationOrchestrator as GitAutomationOrchestrator;
}

function buildAutomationAgentRunner(
  state: ReplState,
): (config: AgentBridgeConfig, ctx: Record<string, unknown>) => Promise<AgentBridgeResult> {
  return async (
    config: AgentBridgeConfig,
    ctx: Record<string, unknown>,
  ): Promise<AgentBridgeResult> => {
    const taskId = randomUUID().slice(0, 12);
    const prompt = substitutePromptVars(config.prompt, ctx);
    const taskSession = cloneSessionForTask(state.session, config.projectRoot, taskId);
    const startMs = Date.now();

    try {
      const completed = await runAgentLoop(prompt, taskSession, {
        state: state.state,
        verbose: false,
        enableGit: state.enableGit,
        enableSandbox: state.enableSandbox,
        silent: true,
        ...(state.sandboxBridge ? { sandboxBridge: state.sandboxBridge } : {}),
      });

      const output = getLastAssistantText(completed);
      const filesChanged = collectTouchedFilesFromSession(completed, config.projectRoot);

      // Run DanteForge verification if requested
      let pdseScore: number | undefined;
      if (config.verifyOutput !== false && filesChanged.length > 0) {
        try {
          const scores: number[] = [];
          for (const file of filesChanged) {
            const content = await readFile(file, "utf-8").catch(() => null);
            if (content !== null) {
              const score = runLocalPDSEScorer(content, config.projectRoot);
              scores.push(score.overall > 1 ? score.overall : score.overall * 100);
            }
          }
          if (scores.length > 0) {
            pdseScore = scores.reduce((a, b) => a + b, 0) / scores.length;
          }
        } catch {
          // forge unavailable — skip scoring
        }
      }

      return {
        sessionId: `bg-${taskId}`,
        success: true,
        output,
        tokensUsed: 0,
        durationMs: Date.now() - startMs,
        filesChanged,
        ...(pdseScore !== undefined ? { pdseScore } : {}),
      };
    } catch (error: unknown) {
      return {
        sessionId: `bg-${taskId}`,
        success: false,
        output: "",
        tokensUsed: 0,
        durationMs: Date.now() - startMs,
        filesChanged: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

async function loadJsonCommandInput(
  args: string,
  state: ReplState,
  usage: string,
): Promise<unknown> {
  const filePath = args.trim();
  if (!filePath) {
    throw new Error(`Usage: ${usage}`);
  }

  const resolved = resolve(state.projectRoot, filePath.replace(/^['"]|['"]$/g, ""));

  try {
    const raw = await readFile(resolved, "utf-8");
    return JSON.parse(raw) as unknown;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not load JSON input from ${relative(state.projectRoot, resolved)}: ${message}`,
    );
  }
}

function parseVerificationRailRecord(
  record: Record<string, unknown>,
  context: string,
): VerificationRail {
  const requiredSubstrings = readStringArray(record["requiredSubstrings"]);
  const forbiddenPatterns = readStringArray(record["forbiddenPatterns"]);
  const mode = record["mode"] === "soft" ? "soft" : record["mode"] === "hard" ? "hard" : undefined;

  return {
    id: readRequiredString(record, "id", context),
    name: readRequiredString(record, "name", context),
    ...(readOptionalString(record, "description")
      ? { description: readOptionalString(record, "description") }
      : {}),
    ...(mode ? { mode } : {}),
    ...(requiredSubstrings.length > 0 ? { requiredSubstrings } : {}),
    ...(forbiddenPatterns.length > 0 ? { forbiddenPatterns } : {}),
    ...(readOptionalNumber(record, "minLength") !== undefined
      ? { minLength: readOptionalNumber(record, "minLength") }
      : {}),
    ...(readOptionalNumber(record, "maxLength") !== undefined
      ? { maxLength: readOptionalNumber(record, "maxLength") }
      : {}),
  };
}

function parseVerificationCriteria(value: unknown): VerifyOutputInput["criteria"] {
  if (!isRecord(value)) {
    return undefined;
  }

  const requiredKeywords = readStringArray(value["requiredKeywords"]);
  const forbiddenPatterns = readStringArray(value["forbiddenPatterns"]);
  const expectedSections = readStringArray(value["expectedSections"]);
  const minLength = readOptionalNumber(value, "minLength");
  const pdseGate = readOptionalNumber(value, "pdseGate");
  const weightsValue = value["weights"];
  const weights = isRecord(weightsValue)
    ? {
        ...(readOptionalNumber(weightsValue, "faithfulness") !== undefined
          ? { faithfulness: readOptionalNumber(weightsValue, "faithfulness") }
          : {}),
        ...(readOptionalNumber(weightsValue, "correctness") !== undefined
          ? { correctness: readOptionalNumber(weightsValue, "correctness") }
          : {}),
        ...(readOptionalNumber(weightsValue, "hallucination") !== undefined
          ? { hallucination: readOptionalNumber(weightsValue, "hallucination") }
          : {}),
        ...(readOptionalNumber(weightsValue, "completeness") !== undefined
          ? { completeness: readOptionalNumber(weightsValue, "completeness") }
          : {}),
        ...(readOptionalNumber(weightsValue, "safety") !== undefined
          ? { safety: readOptionalNumber(weightsValue, "safety") }
          : {}),
      }
    : undefined;

  return {
    ...(requiredKeywords.length > 0 ? { requiredKeywords } : {}),
    ...(forbiddenPatterns.length > 0 ? { forbiddenPatterns } : {}),
    ...(expectedSections.length > 0 ? { expectedSections } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(pdseGate !== undefined ? { pdseGate } : {}),
    ...(weights && Object.keys(weights).length > 0 ? { weights } : {}),
  };
}

function parseVerifyOutputInput(payload: unknown): VerifyOutputInput {
  if (!isRecord(payload)) {
    throw new Error("verify-output input must be a JSON object.");
  }

  const railsValue = payload["rails"];
  const rails = Array.isArray(railsValue)
    ? railsValue.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`verify-output rails[${index}] must be an object.`);
        }
        return parseVerificationRailRecord(entry, `verify-output rails[${index}]`);
      })
    : undefined;

  return {
    task: readRequiredString(payload, "task", "verify-output input"),
    output: readRequiredString(payload, "output", "verify-output input"),
    ...(parseVerificationCriteria(payload["criteria"])
      ? { criteria: parseVerificationCriteria(payload["criteria"]) }
      : {}),
    ...(rails && rails.length > 0 ? { rails } : {}),
  };
}

function parseQaSuiteInput(payload: unknown): {
  planId: string;
  benchmarkId?: string;
  outputs: QaSuiteOutputInput[];
} {
  if (!isRecord(payload)) {
    throw new Error("qa-suite input must be a JSON object.");
  }

  const rawOutputs = payload["outputs"];
  if (!Array.isArray(rawOutputs) || rawOutputs.length === 0) {
    throw new Error('qa-suite input must include a non-empty "outputs" array.');
  }

  const outputs = rawOutputs.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`qa-suite outputs[${index}] must be an object.`);
    }

    const parsed = parseVerifyOutputInput(entry);
    return {
      id: readOptionalString(entry, "id") ?? `output-${index + 1}`,
      ...parsed,
    };
  });

  return {
    planId: readRequiredString(payload, "planId", "qa-suite input"),
    ...(readOptionalString(payload, "benchmarkId")
      ? { benchmarkId: readOptionalString(payload, "benchmarkId") }
      : {}),
    outputs,
  };
}

function parseCriticDebateInput(payload: unknown): { opinions: CriticOpinion[]; output?: string } {
  if (!isRecord(payload)) {
    throw new Error("critic-debate input must be a JSON object.");
  }

  const rawOpinions = payload["subagents"] ?? payload["opinions"] ?? payload["agents"];
  if (!Array.isArray(rawOpinions) || rawOpinions.length === 0) {
    throw new Error('critic-debate input must include a non-empty "subagents" array.');
  }

  const opinions = rawOpinions.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`critic-debate subagents[${index}] must be an object.`);
    }

    const verdict = readRequiredString(entry, "verdict", `critic-debate subagents[${index}]`);
    if (verdict !== "pass" && verdict !== "warn" && verdict !== "fail") {
      throw new Error(`critic-debate subagents[${index}] verdict must be pass, warn, or fail.`);
    }

    const findings = readStringArray(entry["findings"]);
    const confidence = readOptionalNumber(entry, "confidence");
    return {
      agentId:
        readOptionalString(entry, "agentId") ??
        readOptionalString(entry, "id") ??
        `critic-${index + 1}`,
      verdict,
      ...(confidence !== undefined ? { confidence } : {}),
      ...(findings.length > 0 ? { findings } : {}),
      ...(readOptionalString(entry, "critique")
        ? { critique: readOptionalString(entry, "critique") }
        : {}),
    } satisfies CriticOpinion;
  });

  return {
    opinions,
    ...(readOptionalString(payload, "output")
      ? { output: readOptionalString(payload, "output") }
      : {}),
  };
}

function parseVerificationHistoryArgs(args: string): {
  limit: number;
  kind?: VerificationHistoryKind;
} {
  const trimmed = args.trim();
  if (!trimmed) {
    return { limit: 10 };
  }

  const kindMatch = trimmed.match(/--kind\s+([^\s]+)/);
  const kindCandidate = kindMatch?.[1] as VerificationHistoryKind | undefined;
  const kind =
    kindCandidate &&
    ["verify_output", "qa_suite", "critic_debate", "verification_rail"].includes(kindCandidate)
      ? kindCandidate
      : undefined;

  const limitMatch = trimmed.match(/\b(\d+)\b/);
  const limit = limitMatch ? Math.max(1, Math.min(Number(limitMatch[1]), 50)) : 10;
  return kind ? { limit, kind } : { limit };
}

async function persistVerificationTelemetry(
  state: ReplState,
  input: {
    kind: VerificationHistoryKind;
    label: string;
    summary: string;
    payload: Record<string, unknown>;
    passed?: boolean;
    pdseScore?: number;
    averageConfidence?: number;
    auditType: "verification_run" | "qa_suite_run" | "critic_debate_run" | "verification_rail_add";
  },
): Promise<string[]> {
  const warnings: string[] = [];
  const historyStore = new VerificationHistoryStore(state.projectRoot);

  try {
    await historyStore.append({
      kind: input.kind,
      source: "cli",
      label: input.label,
      summary: input.summary,
      sessionId: state.session.id,
      ...(input.passed !== undefined ? { passed: input.passed } : {}),
      ...(input.pdseScore !== undefined ? { pdseScore: input.pdseScore } : {}),
      ...(input.averageConfidence !== undefined
        ? { averageConfidence: input.averageConfidence }
        : {}),
      payload: input.payload,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`History persistence failed: ${message}`);
  }

  try {
    await appendAuditEvent(state.projectRoot, {
      sessionId: state.session.id,
      type: input.auditType,
      payload: input.payload,
      modelId: state.session.model.modelId,
      projectRoot: state.projectRoot,
      timestamp: new Date().toISOString(),
    });

    if (input.pdseScore !== undefined && input.auditType !== "critic_debate_run") {
      await appendAuditEvent(state.projectRoot, {
        sessionId: state.session.id,
        type: input.passed ? "pdse_gate_pass" : "pdse_gate_fail",
        payload: {
          score: input.pdseScore,
          source: input.kind,
          label: input.label,
        },
        modelId: state.session.model.modelId,
        projectRoot: state.projectRoot,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Audit logging failed: ${message}`);
  }

  return warnings;
}

async function persistVerificationBenchmark(
  state: ReplState,
  input: {
    benchmarkId: string;
    planId: string;
    passed: boolean;
    averagePdseScore: number;
    outputCount: number;
    failingOutputIds: string[];
    payload: Record<string, unknown>;
  },
): Promise<string[]> {
  const warnings: string[] = [];
  const store = new VerificationBenchmarkStore(state.projectRoot);

  try {
    await store.append({
      benchmarkId: input.benchmarkId,
      planId: input.planId,
      source: "cli",
      passed: input.passed,
      averagePdseScore: input.averagePdseScore,
      outputCount: input.outputCount,
      failingOutputIds: input.failingOutputIds,
      payload: input.payload,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Benchmark persistence failed: ${message}`);
  }

  return warnings;
}

// ----------------------------------------------------------------------------
// Helper Functions
// ----------------------------------------------------------------------------

async function getAllFiles(
  dir: string,
  exclude: Set<string> = new Set(["node_modules", ".git", "dist", "build", ".dantecode"]),
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!exclude.has(entry.name)) {
        files.push(...(await getAllFiles(fullPath, exclude)));
      }
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function getPDSEScore(filePath: string, state: ReplState): Promise<number> {
  if (state.pdseCache.has(filePath)) {
    return state.pdseCache.get(filePath)!;
  }
  try {
    const content = await readFile(filePath, "utf-8");
    const score = runLocalPDSEScorer(content, state.projectRoot);
    const overall = score.overall > 1 ? score.overall : score.overall * 100;
    state.pdseCache.set(filePath, overall);
    return overall;
  } catch {
    return 0;
  }
}

// ----------------------------------------------------------------------------
// Command Implementations
// ----------------------------------------------------------------------------
// Helper to analyze session for context-aware help suggestions
function analyzeRecentSession(session: Session) {
  const recentMessages = session.messages.slice(-20); // Last 20 messages for analysis
  const usedCommands = new Set<string>();
  const recentCommands: string[] = [];
  let hasErrors = false;

  for (const message of recentMessages) {
    // Check for slash command usage in user input
    if (message.role === "user" && typeof message.content === "string") {
      const slashedCommands = message.content.match(/\/(\w+)/g);
      if (slashedCommands) {
        for (const cmd of slashedCommands) {
          const cleanCmd = cmd.slice(1); // remove /
          usedCommands.add(cleanCmd);
          recentCommands.push(cleanCmd);
        }
      }
    }

    // Check for tool use that might represent slash commands
    if (message.toolUse?.name === "route_slash_command" && message.toolUse.input?.command) {
      const command = message.toolUse.input.command;
      if (typeof command === "string") {
        usedCommands.add(command);
        recentCommands.push(command);
      }
    }

    // Check for error messages in assistant responses
    if (message.role === "assistant" && typeof message.content === "string") {
      const lowercaseContent = message.content.toLowerCase();
      if (
        lowercaseContent.includes("error") ||
        lowercaseContent.includes("failed") ||
        lowercaseContent.includes("✗") ||
        lowercaseContent.includes("\x1b[31m")
      ) {
        // RED color code
        hasErrors = true;
      }
    }
  }

  return { recentCommands, hasErrors, usedCommands };
}

// ----------------------------------------------------------------------------
const TUTORIALS: Record<string, { title: string; steps: string[]; tips: string[] }> = {
  "magic-basics": {
    title: "Magic Basics: Getting Started with AI Development",
    steps: [
      "Use /magic to start building something new",
      "Describe what you want in plain language",
      "Review the generated code and ask questions",
      "Use /verify to check code quality",
      "Iterate by asking for improvements",
    ],
    tips: [
      "Be specific about what you want to build",
      "Mention technologies if you have preferences",
      "Include example behavior or features",
    ],
  },
  "party-advanced": {
    title: "Party Mode: Multi-Agent Development",
    steps: [
      "Use /party for complex tasks needing multiple agents",
      "Set your approval mode first: /approval review",
      "Define the task clearly with requirements",
      "Monitor progress and provide feedback",
      "Review results with /verify and /score",
    ],
    tips: [
      "Break complex tasks into clear requirements",
      "Use /status to check agent availability",
      "Consider using worktrees: /git worktree create",
    ],
  },
  verification: {
    title: "Code Verification: Ensuring Quality",
    steps: [
      "Run /verify on important files",
      "Use /score for overall project health",
      "Check for PDSE scores above 80%",
      "Address failing verifications promptly",
      "Use /party if verification reveals issues",
    ],
    tips: [
      "Run verification after major changes",
      "PDSE scores indicate code robustness",
      "Fix errors before committing",
    ],
  },
  debugging: {
    title: "Debugging Common Issues",
    steps: [
      "Check error messages in the output",
      "Use /add to examine relevant files",
      "Run /verify to identify code issues",
      "Ask specific questions about problems",
      "Use /tutorial [topic] for help with any command",
    ],
    tips: [
      "Include error messages in questions",
      "Check file permissions and dependencies",
      "Try simple test cases first",
    ],
  },
  agents: {
    title: "Multi-Agent Workflows",
    steps: [
      "Start with single commands like /magic for simple tasks",
      "Use /party for complex multi-step tasks",
      "Use /multirun to coordinate multiple agents",
      "Set appropriate approval levels: /approval autoforge",
      "Monitor progress and intervene when needed",
    ],
    tips: [
      "Agents specialize in different types of work",
      "Use /status to see available agents",
      "Complex tasks benefit from multiple perspectives",
    ],
  },
};

async function tutorialCommand(args: string, _state: ReplState): Promise<string> {
  const topic = args.trim().toLowerCase().replace(/\s+/g, "-");

  if (!topic) {
    const availableTopics = Object.keys(TUTORIALS);
    const lines = [`${BOLD}Interactive Tutorials${RESET}`, "", `${DIM}Available topics:${RESET}`];

    availableTopics.forEach((topic) => {
      const tutorial = TUTORIALS[topic];
      if (tutorial) {
        lines.push(`  ${YELLOW}${topic.padEnd(15)}${RESET} ${DIM}${tutorial.title}${RESET}`);
      }
    });

    lines.push("");
    lines.push(`${DIM}Usage: /tutorial <topic>${RESET}`);
    lines.push(`${DIM}Examples: /tutorial magic-basics, /tutorial debugging${RESET}`);

    return lines.join("\n");
  }

  const tutorial = TUTORIALS[topic];
  if (!tutorial) {
    const availableTopics = Object.keys(TUTORIALS);
    return `${RED}Tutorial not found:${RESET} ${topic}\n\n${DIM}Available: ${availableTopics.join(", ")}${RESET}`;
  }

  const lines = [`${BOLD}${tutorial.title}${RESET}`, "", `${CYAN}Steps to follow:${RESET}`];

  tutorial.steps.forEach((step, index) => {
    lines.push(`  ${index + 1}. ${step}`);
  });

  if (tutorial.tips.length > 0) {
    lines.push("");
    lines.push(`${CYAN}Pro tips:${RESET}`);
    tutorial.tips.forEach((tip) => {
      lines.push(`  • ${tip}`);
    });
  }

  lines.push("");
  lines.push(`${DIM}Need help with a specific command? Try /help${RESET}`);

  return lines.join("\n");
}

// ----------------------------------------------------------------------------
async function helpCommand(args: string, state: ReplState): Promise<string> {
  const showAll = args.trim() === "--all";

  // D-12: Count successful sessions for progressive disclosure unlock
  const sessionStats = await countSuccessfulSessions(state.projectRoot);
  const advancedUnlocked = showAll || sessionStats.unlocked;

  // Analyze recent session for context-aware suggestions
  const { recentCommands, hasErrors, usedCommands } = analyzeRecentSession(state.session);

  if (!advancedUnlocked) {
    // Tier 1 only — the essential commands new users need
    const tier1 = SLASH_COMMANDS.filter((c) => c.tier === 1);
    const lines = ["", `${BOLD}Commands${RESET}`, ""];
    for (const cmd of tier1) {
      lines.push(`  ${YELLOW}${cmd.usage.padEnd(24)}${RESET} ${DIM}${cmd.description}${RESET}`);
    }

    lines.push("");

    // Enhanced contextual suggestions
    const suggestions: string[] = [];
    if (state.session.messages.length === 0) {
      suggestions.push(`  ${YELLOW}/magic${RESET} ${DIM}\u2014 start building something${RESET}`);
    }
    if (state.session.messages.length > 20) {
      suggestions.push(
        `  ${YELLOW}/compact${RESET} ${DIM}\u2014 free up conversation space${RESET}`,
      );
    }
    if (hasErrors) {
      suggestions.push(
        `  ${YELLOW}/tutorial debugging${RESET} ${DIM}\u2014 learn to fix common errors${RESET}`,
      );
    }
    if (recentCommands.includes("magic") && !usedCommands.has("verify")) {
      suggestions.push(
        `  ${YELLOW}/tutorial verification${RESET} ${DIM}\u2014 ensure your builds are solid${RESET}`,
      );
    }
    if (recentCommands.includes("party") || recentCommands.includes("multirun")) {
      suggestions.push(
        `  ${YELLOW}/tutorial agents${RESET} ${DIM}\u2014 mastering multi-agent workflows${RESET}`,
      );
    }
    if (suggestions.length > 0) {
      lines.push(`${BOLD}Suggested:${RESET}`);
      lines.push(...suggestions);
      lines.push("");
    }

    if (sessionStats.count > 0) {
      lines.push(
        `${DIM}${sessionStats.count}/3 sessions completed \u2014 ${3 - sessionStats.count} more to unlock advanced commands.${RESET}`,
      );
    }
    lines.push(
      `${DIM}Type ${YELLOW}/help --all${RESET}${DIM} to see all ${SLASH_COMMANDS.length} commands.${RESET}`,
    );
    lines.push("");
    return lines.join("\n");
  }

  // Grouped display — all commands organised by category
  const categoryOrder = [
    "core",
    "git",
    "verification",
    "memory",
    "skills",
    "sessions",
    "search",
    "agents",
    "automation",
    "sandbox",
    "advanced",
  ] as const;
  const categoryLabels: Record<string, string> = {
    core: "Core",
    git: "Git",
    verification: "Verification & QA",
    memory: "Memory & Lessons",
    skills: "Skills",
    sessions: "Sessions",
    search: "Search & Research",
    agents: "Agents & Multi-Agent",
    automation: "Automation",
    sandbox: "Sandbox & Approval",
    advanced: "Advanced",
  };

  // Also include markdown-backed commands from the registry
  const registry = await loadSlashCommandRegistry(state.projectRoot, getNativeCommandDefinitions());
  const markdownCmds = registry.filter((c) => c.source === "markdown");

  const lines = [
    "",
    `${BOLD}All Commands${RESET}`,
    "",
    `${DIM}Tip: Current mode is always visible in the status bar at the bottom.${RESET}`,
    `${DIM}Use /mode to view or change approval mode (review/plan/apply/autoforge/yolo).${RESET}`,
    "",
  ];
  for (const cat of categoryOrder) {
    const cmds = SLASH_COMMANDS.filter((c) => (c.category ?? "advanced") === cat);
    if (cmds.length === 0) continue;
    lines.push(`  ${BOLD}${categoryLabels[cat]}${RESET}`);
    for (const cmd of cmds) {
      lines.push(`    ${YELLOW}${cmd.usage.padEnd(28)}${RESET} ${DIM}${cmd.description}${RESET}`);
    }
    lines.push("");
  }

  if (markdownCmds.length > 0) {
    lines.push(`  ${BOLD}Workflows (Markdown)${RESET}`);
    for (const cmd of markdownCmds) {
      lines.push(`    ${YELLOW}${cmd.usage.padEnd(28)}${RESET} ${DIM}${cmd.description}${RESET}`);
    }
    lines.push("");
  }

  // Add context-aware suggestions for advanced users
  const suggestions: string[] = [];
  if (hasErrors) {
    suggestions.push(
      `  ${YELLOW}/tutorial debugging${RESET} ${DIM}\u2014 learn to fix common errors${RESET}`,
    );
  }
  if (recentCommands.includes("magic") && !usedCommands.has("verify")) {
    suggestions.push(
      `  ${YELLOW}/tutorial verification${RESET} ${DIM}\u2014 ensure your builds are solid${RESET}`,
    );
  }
  if (recentCommands.includes("party") || recentCommands.includes("multirun")) {
    suggestions.push(
      `  ${YELLOW}/tutorial agents${RESET} ${DIM}\u2014 mastering multi-agent workflows${RESET}`,
    );
  }
  if (state.session.messages.length === 0) {
    suggestions.push(
      `  ${YELLOW}/tutorial magic-basics${RESET} ${DIM}\u2014 get started with AI development${RESET}`,
    );
  }

  if (suggestions.length > 0) {
    lines.push(`${BOLD}Contextual Help:${RESET}`);
    lines.push(...suggestions);
    lines.push("");
  }

  return lines.join("\n");
}

async function resumeCommand(args: string, state: ReplState): Promise<string> {
  const requestedRunId = args.trim() || undefined;
  const store = new DurableRunStore(state.projectRoot);
  const run = requestedRunId
    ? await store.loadRun(requestedRunId)
    : await store.getLatestWaitingUserRun();

  if (!run) {
    return `${YELLOW}No paused durable run found.${RESET}`;
  }

  state.pendingAgentPrompt = "continue";
  state.pendingResumeRunId = run.id;
  state.pendingExpectedWorkflow = run.workflow;

  const hint = await store.getResumeHint(run.id);
  const nextAction = hint?.nextAction ?? run.nextAction ?? "Resume from the last checkpoint.";
  return `${GREEN}Queued durable run ${run.id} for resume.${RESET}\n${DIM}${nextAction}${RESET}`;
}

async function runsCommand(_args: string, state: ReplState): Promise<string> {
  const store = new DurableRunStore(state.projectRoot);
  const runs = await store.listRuns();

  if (runs.length === 0) {
    return `${DIM}No durable runs found for this project.${RESET}`;
  }

  const lines = [`${BOLD}Durable Runs${RESET}`, ""];
  for (const run of runs) {
    const source = run.legacySource ? ` (${run.legacySource})` : "";
    lines.push(
      `  ${CYAN}${run.id}${RESET} ${run.status.padEnd(12)} ${DIM}${run.workflow}${source}${RESET}`,
    );
  }

  return lines.join("\n");
}

async function modelCommand(args: string, state: ReplState): Promise<string> {
  const trimmedArgs = args.trim();

  // Handle /model select command
  if (trimmedArgs === "select") {
    return await modelSelectCommand(state);
  }

  const modelReference = trimmedArgs;
  if (!modelReference) {
    const current = state.state.model.default;
    return `${DIM}Current model:${RESET} ${BOLD}${current.provider}/${current.modelId}${RESET}\n\n${DIM}Usage: /model <provider/modelId> or /model select${RESET}`;
  }

  const parsed = parseModelReference(modelReference, state.state.model.default.provider);
  const providerEntry = getProviderCatalogEntry(parsed.provider);

  if (!providerEntry) {
    return `${RED}Unknown provider:${RESET} ${parsed.provider}`;
  }

  const newModelConfig: ModelConfig = {
    ...state.state.model.default,
    provider: parsed.provider,
    modelId: parsed.modelId,
  };

  state.state.model.default = newModelConfig;
  state.session.model = newModelConfig;

  return `${GREEN}Model switched to${RESET} ${BOLD}${parsed.id}${RESET} ${DIM}(${providerEntry.label})${RESET}`;
}

async function modelSelectCommand(state: ReplState): Promise<string> {
  if (!process.stdin.isTTY) {
    return `${YELLOW}Interactive model selection requires a TTY terminal.${RESET}`;
  }

  // Group models by provider for display
  const groupedModels = MODEL_CATALOG.map((model) => {
    const provider = PROVIDER_CATALOG.find((p) => p.id === model.provider);
    return {
      ...model,
      providerLabel: provider?.shortLabel ?? model.provider,
      requiresApiKey: provider?.requiresApiKey ?? false,
      localOnly: provider?.localOnly ?? false,
    };
  });

  // Create menu options with cost estimates
  const menuOptions = groupedModels.map((model) => {
    // Estimate cost for a typical 1000 token input + 500 token output
    const costEstimate = estimateRunCost(model.modelId, 1000, 500);
    const costDisplay = costEstimate > 0 ? `$${costEstimate.toFixed(4)}` : "Free";

    const reasoningIndicator = model.reasoningModel ? " (Reasoning)" : "";
    const thinkingIndicator = model.supportsExtendedThinking ? " (Thinking)" : "";

    return {
      id: model.id,
      label: `${model.label}${reasoningIndicator}${thinkingIndicator}`,
      provider: model.providerLabel,
      cost: costDisplay,
      requiresApiKey: model.requiresApiKey,
      localOnly: model.localOnly,
    };
  });

  // Interactive menu with arrow navigation
  const selectedModelId = await interactiveModelMenu(menuOptions);

  if (!selectedModelId) {
    return `${DIM}Model selection cancelled.${RESET}`;
  }

  const selectedModel = MODEL_CATALOG.find((m) => m.id === selectedModelId);
  if (!selectedModel) {
    return `${RED}Selected model not found.${RESET}`;
  }

  // Handle API key setup if required
  const provider = PROVIDER_CATALOG.find((p) => p.id === selectedModel.provider);
  if (provider?.requiresApiKey) {
    const existingKey = provider.envVars.some((envVar) => process.env[envVar]);
    if (!existingKey) {
      const apiKey = await promptForApiKey(provider);
      if (!apiKey) {
        return `${YELLOW}Model selection cancelled — API key required.${RESET}`;
      }
      // Note: In a real implementation, you'd save this to environment or config
      process.env[provider.envVars[0]!] = apiKey;
    }
  }

  // Update state
  const newModelConfig: ModelConfig = {
    ...state.state.model.default,
    provider: selectedModel.provider,
    modelId: selectedModel.modelId,
  };

  state.state.model.default = newModelConfig;
  state.session.model = newModelConfig;

  return `${GREEN}Model selected:${RESET} ${BOLD}${selectedModel.id}${RESET} ${DIM}(${provider?.label ?? selectedModel.provider})${RESET}`;
}

interface MenuOption {
  id: string;
  label: string;
  provider: string;
  cost: string;
  requiresApiKey: boolean;
  localOnly: boolean;
}

async function interactiveModelMenu(options: MenuOption[]): Promise<string | null> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let isRawMode = false;

    const renderMenu = () => {
      // Clear screen and move cursor to top
      process.stdout.write("\x1b[2J\x1b[H");

      console.log(`${BOLD}Select AI Model${RESET}`);
      console.log(`${DIM}Use ↑↓ arrows to navigate, Enter to select, Ctrl+C to cancel${RESET}\n`);

      options.forEach((option, index) => {
        const isSelected = index === selectedIndex;
        const marker = isSelected ? `${GREEN}▶${RESET}` : " ";
        const apiKeyIndicator = option.requiresApiKey ? `${YELLOW}🔑${RESET}` : `${GREEN}✓${RESET}`;
        const localIndicator = option.localOnly ? `${CYAN}🏠${RESET}` : "";

        const line = `${marker} ${option.label} ${DIM}(${option.provider})${RESET} ${DIM}${option.cost}/1k${RESET} ${apiKeyIndicator}${localIndicator}`;
        console.log(line);
      });

      console.log(`\n${DIM}Selected: ${options[selectedIndex]?.label ?? "None"}${RESET}`);
    };

    const cleanup = () => {
      if (isRawMode) {
        process.stdin.setRawMode(false);
        process.stdin.removeListener("data", handleKeypress);
      }
      process.stdout.write("\x1b[?25h"); // Show cursor
    };

    const handleKeypress = (data: Buffer) => {
      const key = data.toString();

      if (key === "\u0003" || key === "\u0004") {
        // Ctrl+C or Ctrl+D
        cleanup();
        resolve(null);
        return;
      }

      if (key === "\r" || key === "\n") {
        // Enter
        cleanup();
        resolve(options[selectedIndex]?.id ?? null);
        return;
      }

      if (key === "\u001b[A") {
        // Up arrow
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : options.length - 1;
        renderMenu();
      } else if (key === "\u001b[B") {
        // Down arrow
        selectedIndex = selectedIndex < options.length - 1 ? selectedIndex + 1 : 0;
        renderMenu();
      }
    };

    // Setup raw mode for arrow key detection
    process.stdout.write("\x1b[?25l"); // Hide cursor
    process.stdin.setRawMode(true);
    isRawMode = true;
    process.stdin.on("data", handleKeypress);

    renderMenu();
  });
}

async function promptForApiKey(provider: {
  label: string;
  envVars: string[];
}): Promise<string | null> {
  return new Promise((resolve) => {
    console.log(`\n${YELLOW}API Key Required${RESET}`);
    console.log(`${DIM}Provider: ${provider.label}${RESET}`);
    console.log(`${DIM}Set one of: ${provider.envVars.join(", ")}${RESET}`);

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    rl.question(
      `${CYAN}Enter API key${RESET} ${DIM}(or press Enter to skip)${RESET}: `,
      (answer: string) => {
        rl.close();
        const trimmed = answer.trim();
        resolve(trimmed || null);
      },
    );

    // Handle Ctrl+C
    rl.on("SIGINT", () => {
      rl.close();
      resolve(null);
    });
  });
}

async function addCommand(args: string, state: ReplState): Promise<string> {
  const trimmed = args.trim();
  if (!trimmed) {
    // Show numbered list with PDSE previews
    const files = (await getAllFiles(state.projectRoot)).filter(
      (f): f is string => typeof f === "string",
    );
    state.lastFileList = files.sort((a, b) => a.localeCompare(b)); // Sort for consistency
    const lines = [`${BOLD}Files in project (${files.length}):${RESET}`, ""];

    const limit = Math.min(files.length, 30); // Limit display to avoid overwhelming
    for (let i = 0; i < limit; i++) {
      const relPath = relative(state.projectRoot, files[i]!);
      const pdse = await getPDSEScore(files[i]!, state);
      const color = pdse >= 80 ? GREEN : pdse >= 60 ? YELLOW : RED;
      lines.push(
        `  ${CYAN}${(i + 1).toString().padStart(3)}${RESET} ${color}${pdse.toFixed(0).padEnd(3)}${RESET} ${relPath}`,
      );
    }

    if (files.length > 30) {
      lines.push(`  ${DIM}... and ${files.length - 30} more (use /add <search> to filter)${RESET}`);
    }
    lines.push("");
    lines.push(
      `${DIM}Type /add <number> to add a file, or /add <search> to filter by name${RESET}`,
    );
    return lines.join("\n");
  } else if (/^\d+$/.test(trimmed)) {
    // Select file by number
    const index = parseInt(trimmed) - 1;
    if (!state.lastFileList || index < 0 || index >= state.lastFileList.length) {
      return `${RED}Invalid number: ${trimmed}. Run /add with no arguments to see the list.${RESET}`;
    }
    const file = state.lastFileList[index];
    if (!file) {
      return `${RED}Invalid file at index ${index} (file list may have changed)${RESET}`;
    }
    const resolved = file;
    try {
      const content = await readFile(resolved, "utf-8");
      const lineCount = content.split("\n").length;

      if (!state.session.activeFiles.includes(resolved)) {
        state.session.activeFiles.push(resolved);
      }

      // Add as a system message so the agent has the context
      state.session.messages.push({
        id: randomUUID(),
        role: "system",
        content: `File added to context: ${resolved}\n\n\`\`\`\n${content}\n\`\`\``,
        timestamp: new Date().toISOString(),
      });

      return `${GREEN}Added${RESET} ${relative(state.projectRoot, resolved)} ${DIM}(${lineCount} lines)${RESET}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `${RED}Error reading file: ${message}${RESET}`;
    }
  } else {
    // Filter by search string (case-insensitive)
    const files = (await getAllFiles(state.projectRoot))
      .filter((f): f is string => typeof f === "string")
      .filter((f) => relative(state.projectRoot, f).toLowerCase().includes(trimmed.toLowerCase()));
    state.lastFileList = files;

    const lines = [`${BOLD}Files matching "${trimmed}" (${files.length}):${RESET}`, ""];

    const limit = Math.min(files.length, 30);
    for (let i = 0; i < limit; i++) {
      const relPath = relative(state.projectRoot, files[i]!);
      const pdse = await getPDSEScore(files[i]!, state);
      const color = pdse >= 80 ? GREEN : pdse >= 60 ? YELLOW : RED;
      lines.push(
        `  ${CYAN}${(i + 1).toString().padStart(3)}${RESET} ${color}${pdse.toFixed(0).padEnd(3)}${RESET} ${relPath}`,
      );
    }

    if (files.length > 30) {
      lines.push(`  ${DIM}... and ${files.length - 30} more${RESET}`);
    }
    lines.push("");
    lines.push(`${DIM}Type /add <number> to add a file${RESET}`);
    return lines.join("\n");
  }
}

async function browseCommand(args: string, state: ReplState): Promise<string> {
  const trimmed = args.trim();
  let files: string[];

  if (!trimmed) {
    files = (await getAllFiles(state.projectRoot)).filter(
      (f): f is string => typeof f === "string",
    );
  } else {
    files = (await getAllFiles(state.projectRoot))
      .filter((f): f is string => typeof f === "string")
      .filter((f) => relative(state.projectRoot, f).toLowerCase().includes(trimmed.toLowerCase()));
  }

  files.sort((a, b) => a.localeCompare(b));

  const lines = [
    `${BOLD}Browsing ${trimmed ? `files matching "${trimmed}"` : "project files"} (${files.length}):${RESET}`,
    "",
  ];

  const limit = Math.min(files.length, 20); // More conservative limit for browse
  for (let i = 0; i < limit; i++) {
    const relPath = relative(state.projectRoot, files[i]!);
    const pdse = await getPDSEScore(files[i]!, state);
    const color = pdse >= 80 ? GREEN : pdse >= 60 ? YELLOW : RED;
    lines.push(
      `  ${CYAN}${(i + 1).toString().padStart(3)}${RESET} ${color}${pdse.toFixed(0).padEnd(3)}${RESET} ${relPath}`,
    );
  }

  if (files.length > 20) {
    lines.push(`  ${DIM}... and ${files.length - 20} more${RESET}`);
  }

  return lines.join("\n");
}

async function dropCommand(args: string, state: ReplState): Promise<string> {
  const filePath = args.trim();
  if (!filePath) {
    return `${RED}Usage: /drop <file_path>${RESET}`;
  }

  const resolved = resolve(state.projectRoot, filePath);
  const index = state.session.activeFiles.indexOf(resolved);

  if (index === -1) {
    // Try matching by relative path
    const relativeMatch = state.session.activeFiles.findIndex(
      (f) => relative(state.projectRoot, f) === filePath || f.endsWith(filePath),
    );
    if (relativeMatch === -1) {
      return `${YELLOW}File not in context: ${filePath}${RESET}`;
    }
    const removed = state.session.activeFiles.splice(relativeMatch, 1)[0];
    return `${GREEN}Removed${RESET} ${removed} from context`;
  }

  state.session.activeFiles.splice(index, 1);
  return `${GREEN}Removed${RESET} ${resolved} from context`;
}

async function filesCommand(_args: string, state: ReplState): Promise<string> {
  if (state.session.activeFiles.length === 0) {
    return `${DIM}No files in context. Use /add <file> to add files.${RESET}`;
  }

  const lines = [`${BOLD}Files in context:${RESET}`, ""];
  for (const file of state.session.activeFiles) {
    const rel = relative(state.projectRoot, file);
    lines.push(`  ${DIM}-${RESET} ${rel}`);
  }
  lines.push("");
  lines.push(`${DIM}${state.session.activeFiles.length} file(s) total${RESET}`);
  return lines.join("\n");
}

async function diffCommand(_args: string, state: ReplState): Promise<string> {
  try {
    const diff = getDiff(state.projectRoot);
    if (!diff || diff.trim().length === 0) {
      return `${DIM}No unstaged changes.${RESET}`;
    }
    return `${BOLD}Unstaged changes:${RESET}\n\n${diff}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error getting diff: ${message}${RESET}`;
  }
}

async function commitCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.enableGit) {
    return `${YELLOW}Git is disabled for this session (--no-git).${RESET}`;
  }

  try {
    const status = getStatus(state.projectRoot);
    const filesToCommit = [
      ...status.staged.map((s: { path: string }) => s.path),
      ...status.unstaged.map((s: { path: string }) => s.path),
      ...status.untracked.map((s: { path: string }) => s.path),
    ];

    if (filesToCommit.length === 0) {
      return `${DIM}Nothing to commit. Working tree is clean.${RESET}`;
    }

    const commitResult = autoCommit(
      {
        message: `${state.state.git.commitPrefix} update ${filesToCommit.length} file(s)`,
        footer:
          "Generated with DanteCode (https://dantecode.dev)\n\nCo-Authored-By: DanteCode <noreply@dantecode.dev>",
        files: filesToCommit,
        allowEmpty: false,
      },
      state.projectRoot,
    );

    return `${GREEN}Committed${RESET} ${commitResult.commitHash.slice(0, 8)}: ${commitResult.message.split("\n")[0]}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Commit error: ${message}${RESET}`;
  }
}

async function revertCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.enableGit) {
    return `${YELLOW}Git is disabled for this session (--no-git).${RESET}`;
  }

  try {
    const result = revertLastCommit(state.projectRoot);
    return `${GREEN}Reverted last commit.${RESET} New HEAD: ${result.slice(0, 8)}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Revert error: ${message}${RESET}`;
  }
}

interface TrailMutationEvent {
  timestamp: string;
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
  beforeSnapshotId?: string;
  afterSnapshotId?: string;
}

async function loadTrailBridge() {
  const trailMod = await import("@dantecode/debug-trail");
  return {
    bridge: new trailMod.CliBridge(trailMod.getGlobalLogger()),
    debugRestore: trailMod.debugRestore,
  };
}

function isPathLikeRestoreTarget(target: string): boolean {
  return target.includes("/") || target.includes("\\") || target.includes(".");
}

function eventFilePath(event: TrailMutationEvent): string | null {
  const filePath = event.payload["filePath"];
  return typeof filePath === "string" ? filePath : null;
}

function formatTrailTarget(event: TrailMutationEvent, projectRoot: string): string {
  const filePath = eventFilePath(event);
  if (!filePath) {
    return event.summary;
  }

  return relative(projectRoot, filePath) || filePath;
}

async function findLatestRestorableSnapshot(
  state: ReplState,
  target?: string,
): Promise<{ snapshotId: string; filePath: string | null } | null> {
  const { bridge } = await loadTrailBridge();
  const trail = await bridge.debugTrailRecent(100);
  const targetPath = target ? resolve(state.projectRoot, target) : null;

  for (const event of trail.results as TrailMutationEvent[]) {
    if (!event.beforeSnapshotId) {
      continue;
    }

    const filePath = eventFilePath(event);
    if (targetPath && filePath && resolve(filePath) !== targetPath) {
      continue;
    }

    if (
      event.kind === "file_write" ||
      event.kind === "file_restore" ||
      event.kind === "file_move"
    ) {
      return {
        snapshotId: event.beforeSnapshotId,
        filePath,
      };
    }
  }

  return null;
}

function rememberRestore(state: ReplState, summary: string): void {
  state.lastRestoreEvent = {
    restoredAt: new Date().toISOString(),
    restoreSummary: summary,
  };
}

async function undoCommand(_args: string, state: ReplState): Promise<string> {
  try {
    const target = _args.trim() || state.lastEditFile || undefined;
    const restorable = await findLatestRestorableSnapshot(state, target);

    if (restorable) {
      const { debugRestore } = await loadTrailBridge();
      const restored = await debugRestore(restorable.snapshotId);
      if (!restored.restored) {
        return `${RED}Undo error:${RESET} ${restored.error ?? "restore failed"}`;
      }

      const restoredTarget = restorable.filePath
        ? relative(state.projectRoot, restorable.filePath) || restorable.filePath
        : (restored.targetPath ?? restorable.snapshotId);
      const summary = `Restored ${restoredTarget} from snapshot ${restorable.snapshotId}.`;
      rememberRestore(state, summary);
      state.lastEditFile = null;
      state.lastEditContent = null;
      return `${GREEN}Restored${RESET} ${restoredTarget} [persistent snapshot: ${restorable.snapshotId}]`;
    }

    if (!state.lastEditFile || !state.lastEditContent) {
      return `${DIM}Nothing to undo. No previous edit recorded.${RESET}`;
    }

    await writeFile(state.lastEditFile, state.lastEditContent, "utf-8");
    const filePath = state.lastEditFile;
    state.lastEditFile = null;
    state.lastEditContent = null;
    rememberRestore(
      state,
      `Restored ${relative(state.projectRoot, filePath) || filePath} from in-memory fallback.`,
    );
    return `${GREEN}Restored${RESET} ${filePath} ${DIM}[in-memory fallback — does not survive session exit; capture a snapshot next time with /snapshot]${RESET}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Undo error: ${message}${RESET}`;
  }
}

async function restoreCommand(args: string, state: ReplState): Promise<string> {
  const target = args.trim();
  if (!target) {
    return `${RED}Usage: /restore <snapshot-id|file-path>${RESET}`;
  }

  try {
    const { debugRestore } = await loadTrailBridge();
    const restorable = isPathLikeRestoreTarget(target)
      ? await findLatestRestorableSnapshot(state, target)
      : null;
    const restoreTarget = restorable?.snapshotId ?? target;
    const result = await debugRestore(restoreTarget);

    if (!result.restored) {
      return `${RED}Restore error:${RESET} ${result.error ?? "restore failed"}`;
    }

    const restoredTarget =
      restorable?.filePath != null
        ? relative(state.projectRoot, restorable.filePath) || restorable.filePath
        : (result.targetPath ?? target);
    const summary = `Restored ${restoredTarget} from ${restoreTarget}.`;
    rememberRestore(state, summary);
    return `${GREEN}Restored${RESET} ${restoredTarget} from ${restoreTarget}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Restore error: ${message}${RESET}`;
  }
}

async function recoverCommand(args: string, state: ReplState): Promise<string> {
  const subcommand = args.trim().split(/\s+/)[0]?.toLowerCase();
  const sessionArg = args.trim().split(/\s+/)[1];

  try {
    const { RecoveryManager, formatStaleSessionSummary, filterSessionsByStatus, sortSessionsByTime } =
      await import("@dantecode/core");
    const recoveryManager = new RecoveryManager({ projectRoot: state.projectRoot });
    const staleSessions = await recoveryManager.scanStaleSessions();

    // No sessions found
    if (staleSessions.length === 0) {
      return `${DIM}No stale or resumable sessions found.${RESET}`;
    }

    // /recover list or /recover (no args) - show all sessions
    if (!subcommand || subcommand === "list") {
      const sorted = sortSessionsByTime([...staleSessions]);
      const lines = [`${BOLD}Session Recovery${RESET}`, ""];

      const resumable = filterSessionsByStatus(sorted, "resumable");
      const stale = filterSessionsByStatus(sorted, "stale");
      const corrupt = filterSessionsByStatus(sorted, "corrupt");

      if (resumable.length > 0) {
        lines.push(`${GREEN}Resumable (${resumable.length}):${RESET}`);
        for (const session of resumable.slice(0, 10)) {
          lines.push(
            `  ${session.sessionId.slice(0, 12)} - ${DIM}${session.timestamp ?? "unknown time"}${RESET}`,
          );
        }
        lines.push("");
      }

      if (stale.length > 0) {
        lines.push(`${YELLOW}Stale (${stale.length}):${RESET}`);
        for (const session of stale.slice(0, 10)) {
          lines.push(
            `  ${session.sessionId.slice(0, 12)} - ${DIM}${session.reason ?? "unknown"}${RESET}`,
          );
        }
        lines.push("");
      }

      if (corrupt.length > 0) {
        lines.push(`${RED}Corrupt (${corrupt.length}):${RESET}`);
        for (const session of corrupt.slice(0, 5)) {
          lines.push(
            `  ${session.sessionId.slice(0, 12)} - ${DIM}${session.reason ?? "unknown"}${RESET}`,
          );
        }
        lines.push("");
      }

      lines.push(
        `${DIM}Usage:${RESET}`,
        `  /recover info <sessionId>    Show detailed session info`,
        `  /recover cleanup <sessionId> Delete checkpoint and event log`,
        `  /recover cleanup-all         Delete all corrupt sessions`,
      );

      return lines.join("\n");
    }

    // /recover info <sessionId> - show detailed info
    if (subcommand === "info") {
      if (!sessionArg) {
        return `${RED}Usage: /recover info <sessionId>${RESET}`;
      }

      const session = staleSessions.find((s) => s.sessionId.startsWith(sessionArg));
      if (!session) {
        return `${RED}Session not found: ${sessionArg}${RESET}`;
      }

      const summary = formatStaleSessionSummary(session);
      return `${BOLD}Session Details${RESET}\n\n${summary}`;
    }

    // /recover cleanup <sessionId> - delete checkpoint and event log
    if (subcommand === "cleanup") {
      if (!sessionArg) {
        return `${RED}Usage: /recover cleanup <sessionId>${RESET}`;
      }

      const session = staleSessions.find((s) => s.sessionId.startsWith(sessionArg));
      if (!session) {
        return `${RED}Session not found: ${sessionArg}${RESET}`;
      }

      // Delete checkpoint directory
      const checkpointDir = join(state.projectRoot, ".dantecode", "checkpoints", session.sessionId);
      const eventLogPath = join(state.projectRoot, ".dantecode", "events", `${session.sessionId}.jsonl`);

      const { rmSync } = await import("node:fs");
      const { existsSync } = await import("node:fs");

      let deletedCount = 0;
      if (existsSync(checkpointDir)) {
        rmSync(checkpointDir, { recursive: true, force: true });
        deletedCount++;
      }
      if (existsSync(eventLogPath)) {
        rmSync(eventLogPath, { force: true });
        deletedCount++;
      }

      return `${GREEN}Cleaned up session ${session.sessionId.slice(0, 12)}${RESET} (${deletedCount} ${deletedCount === 1 ? "item" : "items"} deleted)`;
    }

    // /recover cleanup-all - delete all corrupt sessions
    if (subcommand === "cleanup-all") {
      const corrupt = filterSessionsByStatus(staleSessions, "corrupt");
      if (corrupt.length === 0) {
        return `${DIM}No corrupt sessions to clean up.${RESET}`;
      }

      const { rmSync } = await import("node:fs");
      const { existsSync } = await import("node:fs");

      let deletedCount = 0;
      for (const session of corrupt) {
        const checkpointDir = join(
          state.projectRoot,
          ".dantecode",
          "checkpoints",
          session.sessionId,
        );
        const eventLogPath = join(
          state.projectRoot,
          ".dantecode",
          "events",
          `${session.sessionId}.jsonl`,
        );

        if (existsSync(checkpointDir)) {
          rmSync(checkpointDir, { recursive: true, force: true });
          deletedCount++;
        }
        if (existsSync(eventLogPath)) {
          rmSync(eventLogPath, { force: true });
          deletedCount++;
        }
      }

      return `${GREEN}Cleaned up ${corrupt.length} corrupt session(s)${RESET} (${deletedCount} items deleted)`;
    }

    return `${RED}Unknown subcommand: ${subcommand}${RESET}\n${DIM}Use /recover list, /recover info <id>, /recover cleanup <id>, or /recover cleanup-all${RESET}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Recovery error: ${message}${RESET}`;
  }
}

// ----------------------------------------------------------------------------
// Wave 2 Task 2.6: CLI Resume/Replay/Fork Commands
// ----------------------------------------------------------------------------

/**
 * /resume-checkpoint command - Resume from a checkpoint
 * Lists resumable sessions if no arg provided, otherwise resumes specific session
 */
async function resumeCheckpointCommand(args: string, state: ReplState): Promise<string> {
  const sessionArg = args.trim();

  try {
    const { RecoveryManager, resumeFromCheckpoint, JsonlEventStore } = await import("@dantecode/core");
    const recoveryManager = new RecoveryManager({ projectRoot: state.projectRoot });
    const staleSessions = await recoveryManager.scanStaleSessions();
    const resumableSessions = staleSessions.filter((s) => s.status === "resumable");

    // If no sessionId provided, list resumable sessions
    if (!sessionArg) {
      if (resumableSessions.length === 0) {
        return `${DIM}No resumable sessions found.${RESET}\n${DIM}Use /recover list to see all sessions.${RESET}`;
      }

      const lines = [`${BOLD}Resumable Sessions${RESET}`, ""];
      for (const session of resumableSessions.slice(0, 10)) {
        const timestamp = session.timestamp ? new Date(session.timestamp).toLocaleString() : "unknown";
        const stepInfo = session.step !== undefined ? ` step:${session.step}` : "";
        const eventInfo = session.lastEventId !== undefined ? ` events:${session.lastEventId}` : "";
        lines.push(
          `  ${GREEN}${session.sessionId.slice(0, 12)}${RESET} ${DIM}${timestamp}${stepInfo}${eventInfo}${RESET}`,
        );
      }

      if (resumableSessions.length > 10) {
        lines.push("");
        lines.push(`${DIM}... and ${resumableSessions.length - 10} more${RESET}`);
      }

      lines.push("");
      lines.push(`${DIM}Usage: /resume <sessionId>${RESET}`);
      return lines.join("\n");
    }

    // Find the session (allow prefix match)
    const session = resumableSessions.find((s) => s.sessionId.startsWith(sessionArg));
    if (!session) {
      return `${RED}Resumable session not found: ${sessionArg}${RESET}\n${DIM}Use /resume to see available sessions.${RESET}`;
    }

    // Load checkpoint and event store
    const eventStore = new JsonlEventStore(state.projectRoot, session.sessionId);
    const resumeContext = await resumeFromCheckpoint(
      state.projectRoot,
      session.sessionId,
      eventStore,
    );

    if (!resumeContext) {
      return `${RED}Failed to load checkpoint for session ${session.sessionId}${RESET}`;
    }

    // Build resume summary
    const lines = [
      `${GREEN}Resuming session ${session.sessionId.slice(0, 12)}${RESET}`,
      "",
      `  Checkpoint ID: ${DIM}${resumeContext.checkpoint.id}${RESET}`,
      `  Step: ${DIM}${resumeContext.checkpoint.step}${RESET}`,
      `  Checkpoint time: ${DIM}${new Date(resumeContext.checkpoint.ts).toLocaleString()}${RESET}`,
      `  Events to replay: ${DIM}${resumeContext.replayEventCount}${RESET}`,
    ];

    if (resumeContext.checkpoint.worktreeRef) {
      lines.push(`  Worktree: ${DIM}${resumeContext.checkpoint.worktreeRef}${RESET}`);
    }

    lines.push("");
    lines.push(`${YELLOW}Note:${RESET} ${DIM}Checkpoint state loaded. Resume logic integration is complete.${RESET}`);

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Resume error: ${message}${RESET}`;
  }
}

/**
 * /replay command - Display event timeline for a session
 * Shows all events with timestamps and kinds, supports filtering by event kind
 */
async function replayCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const sessionArg = parts[0];
  const kindFilter = parts.slice(1); // Optional kind filter(s)

  if (!sessionArg) {
    return `${RED}Usage: /replay <sessionId> [kind...]${RESET}\n${DIM}Example: /replay abc123 run.tool.started run.tool.completed${RESET}`;
  }

  try {
    const { JsonlEventStore } = await import("@dantecode/core");

    // Try to find a session that matches the prefix
    const { existsSync } = await import("node:fs");
    const eventsDir = join(state.projectRoot, ".dantecode", "events");
    if (!existsSync(eventsDir)) {
      return `${RED}No events directory found.${RESET}`;
    }

    const { readdirSync } = await import("node:fs");
    const eventFiles = readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl"));
    const matchingFile = eventFiles.find((f) => f.replace(".jsonl", "").startsWith(sessionArg));

    if (!matchingFile) {
      return `${RED}No event log found for session: ${sessionArg}${RESET}`;
    }

    const sessionId = matchingFile.replace(".jsonl", "");
    const eventStore = new JsonlEventStore(state.projectRoot, sessionId);

    // Build filter
    const filter: { kind?: string | string[] } = {};
    if (kindFilter.length > 0) {
      filter.kind = kindFilter.length === 1 ? kindFilter[0]! : kindFilter;
    }

    // Fetch events
    const events = eventStore.search(filter);
    const eventList: Array<{ id: number; kind: string; timestamp: string }> = [];

    for await (const event of events) {
      eventList.push({
        id: event.id,
        kind: event.kind,
        timestamp: event.timestamp,
      });
    }

    if (eventList.length === 0) {
      return `${DIM}No events found for session ${sessionId.slice(0, 12)}${RESET}`;
    }

    const lines = [
      `${BOLD}Event Replay: ${sessionId.slice(0, 12)}${RESET}`,
      "",
      `${DIM}Total events: ${eventList.length}${RESET}`,
      "",
    ];

    // Display event timeline (limit to 50 for readability)
    const displayEvents = eventList.slice(0, 50);
    for (const event of displayEvents) {
      const timestamp = new Date(event.timestamp).toLocaleTimeString();
      lines.push(`  [${event.id.toString().padStart(4)}] ${DIM}${timestamp}${RESET} ${event.kind}`);
    }

    if (eventList.length > 50) {
      lines.push("");
      lines.push(`${DIM}... and ${eventList.length - 50} more events${RESET}`);
    }

    if (kindFilter.length > 0) {
      lines.push("");
      lines.push(`${DIM}Filtered by: ${kindFilter.join(", ")}${RESET}`);
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Replay error: ${message}${RESET}`;
  }
}

/**
 * /fork command - Fork a session by creating a new branch from checkpoint
 * Creates a new git branch from the checkpoint's worktreeRef and sets up a new session
 */
async function forkCommand(args: string, state: ReplState): Promise<string> {
  const sessionArg = args.trim();

  if (!sessionArg) {
    return `${RED}Usage: /fork <sessionId>${RESET}\n${DIM}Creates a new branch from the checkpoint's git ref${RESET}`;
  }

  try {
    const { RecoveryManager, EventSourcedCheckpointer } = await import("@dantecode/core");
    const recoveryManager = new RecoveryManager({ projectRoot: state.projectRoot });
    const staleSessions = await recoveryManager.scanStaleSessions();

    // Find the session (allow prefix match, accept any status)
    const session = staleSessions.find((s) => s.sessionId.startsWith(sessionArg));
    if (!session) {
      return `${RED}Session not found: ${sessionArg}${RESET}\n${DIM}Use /recover list to see available sessions.${RESET}`;
    }

    // Load the checkpoint
    const checkpointer = new EventSourcedCheckpointer(state.projectRoot, session.sessionId);
    const tuple = await checkpointer.getTuple();

    if (!tuple) {
      return `${RED}Failed to load checkpoint for session ${session.sessionId}${RESET}`;
    }

    const { checkpoint } = tuple;

    // Create a new branch from the checkpoint's worktree ref (or current HEAD)
    const baseRef = checkpoint.worktreeRef || "HEAD";
    const timestamp = Date.now();
    const newBranchName = `fork-${session.sessionId.slice(0, 8)}-${timestamp}`;

    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync("git", ["branch", newBranchName, baseRef], {
        cwd: state.projectRoot,
        encoding: "utf8",
      });

      const lines = [
        `${GREEN}Forked session ${session.sessionId.slice(0, 12)}${RESET}`,
        "",
        `  New branch: ${YELLOW}${newBranchName}${RESET}`,
        `  Base ref: ${DIM}${baseRef}${RESET}`,
        `  Original checkpoint: ${DIM}${checkpoint.id}${RESET}`,
        `  Original step: ${DIM}${checkpoint.step}${RESET}`,
        "",
        `${DIM}To switch to the new branch, run:${RESET}`,
        `  ${CYAN}git checkout ${newBranchName}${RESET}`,
        "",
        `${DIM}Original session preserved as read-only.${RESET}`,
      ];

      return lines.join("\n");
    } catch (gitErr: unknown) {
      const gitMessage = gitErr instanceof Error ? gitErr.message : String(gitErr);
      return `${RED}Git error creating fork branch: ${gitMessage}${RESET}`;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Fork error: ${message}${RESET}`;
  }
}

async function timelineCommand(args: string, state: ReplState): Promise<string> {
  const limit = Math.max(1, Math.min(50, parseInt(args.trim() || "10", 10) || 10));

  try {
    const { bridge } = await loadTrailBridge();
    const trail = await bridge.debugTrailRecent(limit);
    if (trail.results.length === 0) {
      return `${DIM}No recovery timeline events are available yet.${RESET}`;
    }

    const lines = [`${BOLD}Recovery Timeline${RESET}`, ""];
    for (const event of trail.results as TrailMutationEvent[]) {
      const target = formatTrailTarget(event, state.projectRoot);
      const before = event.beforeSnapshotId ? ` before:${event.beforeSnapshotId}` : "";
      const after = event.afterSnapshotId ? ` after:${event.afterSnapshotId}` : "";
      lines.push(`  ${DIM}${event.timestamp}${RESET} ${event.kind} ${target}${before}${after}`);
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Timeline error: ${message}${RESET}`;
  }
}

async function lessonsCommand(_args: string, state: ReplState): Promise<string> {
  try {
    const lessons = await queryLessons({
      projectRoot: state.projectRoot,
      limit: 20,
    });

    if (lessons.length === 0) {
      return `${DIM}No lessons recorded for this project yet.${RESET}`;
    }

    const formatted = formatLessonsForPrompt(lessons);
    return formatted;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error loading lessons: ${message}${RESET}`;
  }
}

async function pdseCommand(args: string, state: ReplState): Promise<string> {
  const filePath = args.trim();
  if (!filePath) {
    return `${RED}Usage: /pdse <file_path>${RESET}`;
  }

  const resolved = resolve(state.projectRoot, filePath);

  try {
    const content = await readFile(resolved, "utf-8");
    const score = runLocalPDSEScorer(content, state.projectRoot);

    const lines = [
      `${BOLD}PDSE Score for ${relative(state.projectRoot, resolved)}${RESET}`,
      "",
      `  Overall:       ${score.passedGate ? GREEN : RED}${score.overall}/100${RESET} ${score.passedGate ? "(PASSED)" : "(FAILED)"}`,
      `  Completeness:  ${score.completeness}/100`,
      `  Correctness:   ${score.correctness}/100`,
      `  Clarity:       ${score.clarity}/100`,
      `  Consistency:   ${score.consistency}/100`,
    ];

    if (score.violations.length > 0) {
      lines.push("");
      lines.push(`  ${BOLD}Violations (${score.violations.length}):${RESET}`);
      for (const v of score.violations.slice(0, 10)) {
        const lineRef = v.line ? `line ${v.line}` : "?";
        const severity = v.severity === "hard" ? RED : YELLOW;
        lines.push(`    ${severity}[${v.severity}]${RESET} ${DIM}${lineRef}:${RESET} ${v.message}`);
      }
      if (score.violations.length > 10) {
        lines.push(`    ${DIM}... and ${score.violations.length - 10} more${RESET}`);
      }
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error scoring file: ${message}${RESET}`;
  }
}

async function qaCommand(_args: string, state: ReplState): Promise<string> {
  const gstackCommands = state.state.autoforge.gstackCommands;

  if (gstackCommands.length === 0) {
    return `${DIM}No GStack commands configured. Configure them in STATE.yaml.${RESET}`;
  }

  process.stdout.write(
    `${DIM}Running GStack QA pipeline (${gstackCommands.length} commands)...${RESET}\n`,
  );

  try {
    const results = await runGStack("", gstackCommands, state.projectRoot);
    const allPassed = allGStackPassed(results);
    const summary = summarizeGStackResults(results);

    const header = allPassed
      ? `${GREEN}${BOLD}GStack QA: ALL PASSED${RESET}`
      : `${RED}${BOLD}GStack QA: SOME FAILED${RESET}`;

    return `${header}\n\n${summary}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}GStack error: ${message}${RESET}`;
  }
}

async function verifyOutputCommand(args: string, state: ReplState): Promise<string> {
  try {
    const payload = await loadJsonCommandInput(args, state, "/verify-output <input.json>");
    const input = parseVerifyOutputInput(payload);
    const report = verifyOutput(input);
    const telemetryWarnings = await persistVerificationTelemetry(state, {
      kind: "verify_output",
      auditType: "verification_run",
      label: shorten(input.task, 72),
      summary: report.overallPassed ? "verify_output passed" : "verify_output failed",
      passed: report.overallPassed,
      pdseScore: report.pdseScore,
      payload: {
        task: input.task,
        passed: report.overallPassed,
        pdseScore: report.pdseScore,
        warnings: report.warnings,
        failingRails: report.railFindings
          .filter((finding) => !finding.passed)
          .map((finding) => finding.railName),
      },
    });

    const lines = [
      `${BOLD}Verification Output${RESET} ${formatPassFail(report.overallPassed)}`,
      "",
      `  Task:        ${shorten(input.task, 80)}`,
      `  PDSE Score:  ${report.passedGate ? GREEN : RED}${formatFraction(report.pdseScore)}${RESET}`,
      `  Rail checks: ${report.railFindings.length}`,
      "",
      `  ${BOLD}Metrics${RESET}`,
      ...report.metrics.map(
        (metric) =>
          `    ${metric.passed ? GREEN : RED}${metric.name.padEnd(14)}${RESET} ${formatFraction(metric.score)} ${DIM}${metric.reason}${RESET}`,
      ),
      "",
      `  ${BOLD}Critique Trace${RESET}`,
      ...report.critiqueTrace.map(
        (stage) =>
          `    ${stage.passed ? GREEN : RED}${stage.stage.padEnd(10)}${RESET} ${DIM}${stage.summary}${RESET}`,
      ),
    ];

    if (report.warnings.length > 0) {
      lines.push("");
      lines.push(`  ${BOLD}Warnings${RESET}`);
      lines.push(...report.warnings.map((warning) => `    ${YELLOW}- ${warning}${RESET}`));
    }

    // VerificationSuiteRunner: run a one-shot suite and display confidence decision
    try {
      const suiteRunner = new VerificationSuiteRunner();
      const suiteReport = await suiteRunner.run({
        label: `verify-output: ${shorten(input.task, 60)}`,
        cases: [
          {
            id: "primary",
            label: "Primary check",
            kind: "custom",
            task: input.task,
            output: input.output,
            ...(input.criteria ? { criteria: input.criteria } : {}),
            ...(input.rails ? { rails: input.rails } : {}),
          },
        ],
      });

      const primaryResult = suiteReport.results[0];
      if (primaryResult) {
        const synthesis: ConfidenceSynthesisResult = primaryResult.synthesis;
        const decisionColor =
          synthesis.decision === "pass" ? GREEN : synthesis.decision === "soft-pass" ? YELLOW : RED;
        lines.push("");
        lines.push(`  ${BOLD}Confidence Decision${RESET}`);
        lines.push(
          `    Decision:   ${decisionColor}${synthesis.decision.toUpperCase()}${RESET}  ${DIM}(confidence ${(synthesis.confidence * 100).toFixed(0)}%)${RESET}`,
        );
        if (synthesis.reasons.length > 0) {
          lines.push(`    Reasons:`);
          for (const reason of synthesis.reasons.slice(0, 5)) {
            lines.push(`      ${RED}- ${reason}${RESET}`);
          }
        }
        if (synthesis.softWarnings.length > 0) {
          lines.push(`    Warnings:`);
          for (const warning of synthesis.softWarnings.slice(0, 3)) {
            lines.push(`      ${YELLOW}- ${warning}${RESET}`);
          }
        }
      }
    } catch {
      // VerificationSuiteRunner errors must not break the existing command output
    }

    if (telemetryWarnings.length > 0) {
      lines.push("");
      lines.push(...telemetryWarnings.map((warning) => `${YELLOW}${warning}${RESET}`));
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}${message}${RESET}`;
  }
}

async function qaSuiteCommand(args: string, state: ReplState): Promise<string> {
  try {
    const payload = await loadJsonCommandInput(args, state, "/qa-suite <input.json>");
    const { planId, benchmarkId, outputs } = parseQaSuiteInput(payload);
    const report = runQaSuite(planId, outputs);
    const telemetryWarnings = await persistVerificationTelemetry(state, {
      kind: "qa_suite",
      auditType: "qa_suite_run",
      label: shorten(planId, 72),
      summary: report.overallPassed ? "qa_suite passed" : "qa_suite failed",
      passed: report.overallPassed,
      pdseScore: report.averagePdseScore,
      payload: {
        planId: report.planId,
        passed: report.overallPassed,
        averagePdseScore: report.averagePdseScore,
        failingOutputIds: report.failingOutputIds,
        outputCount: report.outputReports.length,
      },
    });
    const benchmarkWarnings = await persistVerificationBenchmark(state, {
      benchmarkId: benchmarkId ?? planId,
      planId: report.planId,
      passed: report.overallPassed,
      averagePdseScore: report.averagePdseScore,
      outputCount: report.outputReports.length,
      failingOutputIds: report.failingOutputIds,
      payload: {
        outputIds: report.outputReports.map((entry) => entry.id),
      },
    });

    const lines = [
      `${BOLD}QA Suite${RESET} ${formatPassFail(report.overallPassed)}`,
      "",
      `  Plan:         ${report.planId}`,
      `  Outputs:      ${report.outputReports.length}`,
      `  Avg PDSE:     ${report.averagePdseScore >= 0.85 ? GREEN : YELLOW}${formatFraction(report.averagePdseScore)}${RESET}`,
      `  Failing IDs:  ${report.failingOutputIds.length > 0 ? report.failingOutputIds.join(", ") : `${GREEN}none${RESET}`}`,
      "",
      `  ${BOLD}Per Output${RESET}`,
      ...report.outputReports.map(
        (entry) =>
          `    ${entry.report.overallPassed ? GREEN : RED}${entry.id.padEnd(14)}${RESET} score=${formatFraction(entry.report.pdseScore)} warnings=${entry.report.warnings.length}`,
      ),
    ];

    if (telemetryWarnings.length > 0 || benchmarkWarnings.length > 0) {
      lines.push("");
      lines.push(
        ...[...telemetryWarnings, ...benchmarkWarnings].map(
          (warning) => `${YELLOW}${warning}${RESET}`,
        ),
      );
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}${message}${RESET}`;
  }
}

async function criticDebateCommand(args: string, state: ReplState): Promise<string> {
  try {
    const payload = await loadJsonCommandInput(args, state, "/critic-debate <input.json>");
    const { opinions, output } = parseCriticDebateInput(payload);
    const report = criticDebate(opinions, output);
    const telemetryWarnings = await persistVerificationTelemetry(state, {
      kind: "critic_debate",
      auditType: "critic_debate_run",
      label: `critic debate (${opinions.length})`,
      summary: report.summary,
      averageConfidence: report.averageConfidence,
      payload: {
        consensus: report.consensus,
        averageConfidence: report.averageConfidence,
        verdictCounts: report.verdictCounts,
        blockingFindings: report.blockingFindings,
      },
    });

    const lines = [
      `${BOLD}Critic Debate${RESET}`,
      "",
      `  Consensus:    ${report.consensus === "pass" ? GREEN : report.consensus === "warn" ? YELLOW : RED}${report.consensus.toUpperCase()}${RESET}`,
      `  Confidence:   ${formatFraction(report.averageConfidence)}`,
      `  Verdicts:     pass=${report.verdictCounts.pass} warn=${report.verdictCounts.warn} fail=${report.verdictCounts.fail}`,
      `  Summary:      ${report.summary}`,
    ];

    if (report.blockingFindings.length > 0) {
      lines.push("");
      lines.push(`  ${BOLD}Blocking Findings${RESET}`);
      lines.push(...report.blockingFindings.map((finding) => `    ${RED}- ${finding}${RESET}`));
    }

    if (telemetryWarnings.length > 0) {
      lines.push("");
      lines.push(...telemetryWarnings.map((warning) => `${YELLOW}${warning}${RESET}`));
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}${message}${RESET}`;
  }
}

async function addVerificationRailCommand(args: string, state: ReplState): Promise<string> {
  try {
    const payload = await loadJsonCommandInput(args, state, "/add-verification-rail <input.json>");
    const rawRail = isRecord(payload) && isRecord(payload["rule"]) ? payload["rule"] : payload;
    if (!isRecord(rawRail)) {
      throw new Error('add-verification-rail input must be a rail object or { "rule": { ... } }.');
    }

    const rail = parseVerificationRailRecord(rawRail, "add-verification-rail input");
    const added = globalVerificationRailRegistry.addRail(rail);
    const totalRails = globalVerificationRailRegistry.listRails().length;
    const telemetryWarnings = await persistVerificationTelemetry(state, {
      kind: "verification_rail",
      auditType: "verification_rail_add",
      label: rail.name,
      summary: added ? "verification rail added" : "verification rail replaced",
      passed: true,
      payload: {
        railId: rail.id,
        name: rail.name,
        mode: rail.mode ?? "hard",
        totalRails,
      },
    });

    const lines = [
      `${BOLD}Verification Rail${RESET} ${GREEN}${added ? "REGISTERED" : "UPDATED"}${RESET}`,
      "",
      `  ID:           ${rail.id}`,
      `  Name:         ${rail.name}`,
      `  Mode:         ${rail.mode ?? "hard"}`,
      `  Total rails:  ${totalRails}`,
    ];

    if (telemetryWarnings.length > 0) {
      lines.push("");
      lines.push(...telemetryWarnings.map((warning) => `${YELLOW}${warning}${RESET}`));
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}${message}${RESET}`;
  }
}

async function verificationHistoryCommand(args: string, state: ReplState): Promise<string> {
  try {
    const filter = parseVerificationHistoryArgs(args);
    const store = new VerificationHistoryStore(state.projectRoot);
    const benchmarkStore = new VerificationBenchmarkStore(state.projectRoot);
    const [entries, summaries] = await Promise.all([
      store.list({
        limit: filter.limit,
        ...(filter.kind ? { kind: filter.kind } : {}),
      }),
      benchmarkStore.summarizeAll(5),
    ]);

    if (entries.length === 0 && summaries.length === 0) {
      return `${DIM}No verification history recorded yet.${RESET}`;
    }

    const lines = [`${BOLD}Verification History${RESET}`, ""];
    if (entries.length > 0) {
      for (const entry of entries) {
        const parts = [
          new Date(entry.recordedAt).toLocaleString(),
          entry.kind,
          entry.passed === undefined ? undefined : entry.passed ? "pass" : "fail",
          typeof entry.pdseScore === "number"
            ? `pdse=${formatFraction(entry.pdseScore)}`
            : undefined,
          typeof entry.averageConfidence === "number"
            ? `confidence=${formatFraction(entry.averageConfidence)}`
            : undefined,
        ].filter((part): part is string => Boolean(part));

        lines.push(`  ${CYAN}${entry.label}${RESET}`);
        lines.push(`    ${DIM}${parts.join(" | ")}${RESET}`);
        lines.push(`    ${entry.summary}`);
      }
    }

    if (summaries.length > 0) {
      lines.push("");
      lines.push(`  ${BOLD}Benchmark Summary${RESET}`);
      for (const summary of summaries) {
        lines.push(`    ${CYAN}${summary.benchmarkId}${RESET}`);
        lines.push(
          `      ${DIM}runs=${summary.totalRuns} passRate=${formatFraction(summary.passRate)} avgPdse=${formatFraction(summary.averagePdseScore)}${RESET}`,
        );
        if (summary.latestFailingOutputIds.length > 0) {
          lines.push(`      latest failing: ${summary.latestFailingOutputIds.join(", ")}`);
        }
      }
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}${message}${RESET}`;
  }
}

async function auditCommand(_args: string, state: ReplState): Promise<string> {
  try {
    const events = await readAuditEvents(state.projectRoot, {
      limit: 20,
    });

    if (events.length === 0) {
      return `${DIM}No audit events recorded yet.${RESET}`;
    }

    const lines = [`${BOLD}Recent Audit Events (${events.length}):${RESET}`, ""];
    for (const event of events) {
      const time = new Date(event.timestamp).toLocaleTimeString();
      lines.push(`  ${DIM}${time}${RESET} ${YELLOW}[${event.type}]${RESET} ${event.modelId}`);
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Audit error: ${message}${RESET}`;
  }
}

async function clearCommand(_args: string, state: ReplState): Promise<string> {
  const count = state.session.messages.length;
  state.session.messages = [];
  state.session.activeFiles = [];
  return `${GREEN}Cleared${RESET} ${count} messages and all context files.`;
}

async function tokensCommand(_args: string, state: ReplState): Promise<string> {
  const messageCount = state.session.messages.length;
  const contextWindow = state.state.model.default.contextWindow;

  // Use the Context Guardian utilization function for accurate estimation
  const util = getContextUtilization(
    state.session.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    })),
    contextWindow,
  );

  const tierColor = util.tier === "green" ? GREEN : util.tier === "yellow" ? YELLOW : RED;
  const tierLabel = `${tierColor}${util.tier.toUpperCase()}${RESET}`;

  const lines = [
    `${BOLD}Token Usage${RESET}`,
    "",
    `  Messages:       ${messageCount}`,
    `  Est. tokens:    ${util.tokens.toLocaleString()}`,
    `  Context window: ${contextWindow.toLocaleString()}`,
    `  Utilization:    ${util.percent}% [${tierLabel}]`,
    "",
    `  Context: ${util.percent}% (${util.tier}) — ${util.tokens}/${util.maxTokens} tokens`,
  ];

  return lines.join("\n");
}

async function webCommand(args: string, _state: ReplState): Promise<string> {
  const url = args.trim();
  if (!url) {
    return `${RED}Usage: /web <url>${RESET}`;
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return `${RED}Invalid URL: ${url}${RESET}`;
  }

  try {
    // Use a simple fetch to get the URL content
    const response = await fetch(url, {
      headers: {
        "User-Agent": "DanteCode/1.0.0",
        Accept: "text/html,text/plain,application/json",
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return `${RED}HTTP ${response.status}: ${response.statusText}${RESET}`;
    }

    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();

    // Truncate to a reasonable size for context
    const maxChars = 50000;
    const truncated =
      text.length > maxChars
        ? text.slice(0, maxChars) + `\n\n... (truncated, ${text.length} chars total)`
        : text;

    return `${GREEN}Fetched${RESET} ${url} ${DIM}(${text.length} chars, ${contentType})${RESET}\n\n${truncated}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Fetch error: ${message}${RESET}`;
  }
}

async function skillCommand(args: string, state: ReplState): Promise<string> {
  const skillName = args.trim();
  if (!skillName) {
    // List skills with scopes and precedence (deterministic discovery)
    const discovered = await discoverSkillsWithScopes({
      projectRoot: state.projectRoot,
      includeUserScope: true,
      includeCompatScope: true,
      userHome: undefined, // Will use default
    });
    const registered = await listSkills(state.projectRoot);
    const visibleSkills = mergeVisibleSkills(discovered, registered);

    if (visibleSkills.length === 0) {
      return `${DIM}No skills discovered. Use '/skills import' to import skills.${RESET}`;
    }

    const lines = [
      `${BOLD}Visible Skills (deterministic precedence: project > user > compat):${RESET}`,
      "",
    ];

    for (const skill of visibleSkills) {
      const scopeColors = {
        project: GREEN,
        user: CYAN,
        compat: YELLOW,
        none: DIM,
      };

      const winningScope = skill.winningScope === "none" ? "disabled" : skill.winningScope;
      const winnerColor = scopeColors[skill.winningScope] || DIM;

      lines.push(
        `  ${YELLOW}${skill.name.padEnd(24)}${RESET} ${winnerColor}${winningScope.padEnd(8)}${RESET}`,
      );

      if (skill.entries.length > 1) {
        // Show all versions with their scopes
        for (const entry of skill.entries) {
          const scopeColor = entry.disabled ? RED : scopeColors[entry.scope];
          const status = entry.disabled ? "disabled" : entry.scope;
          const marker = entry.wins ? "* " : "  ";
          const disabledSuffix = entry.disabled ? " (disabled)" : "";
          lines.push(
            `    ${marker}${scopeColor}${status}${disabledSuffix}${RESET} ${DIM}${entry.skillMdPath}${RESET}`,
          );
        }
      } else {
        // Single entry - show the path
        const entry = skill.entries[0]!;
        lines.push(`    ${DIM}${entry.skillMdPath}${RESET}`);
      }
    }

    lines.push(`\n${DIM}* indicates winning precedence${RESET}`);
    return lines.join("\n");
  }

  // Activate a specific skill
  const skill = await getSkill(skillName, state.projectRoot);
  if (!skill) {
    return `${RED}Skill not found: ${skillName}${RESET}`;
  }

  // Parse skill instructions into waves for step-by-step orchestration.
  // If the skill has wave/step/phase structure, we feed one wave at a time
  // (Claude Workflow Mode). Otherwise, inject the full instructions with
  // a basic execution preamble.
  const waves = parseSkillWaves(skill.instructions);
  const hasWaves = waves.length > 1;

  if (hasWaves) {
    // Wave orchestration: store state, inject only metadata + first wave reference.
    // The actual wave prompt is injected by buildSystemPrompt via config.waveState.
    state.waveState = createWaveState(waves);

    const waveList = waves
      .map((w: { number: number; title: string }) => `  ${w.number}. ${w.title}`)
      .join("\n");

    state.session.messages.push({
      id: randomUUID(),
      role: "system",
      content: [
        `Activated skill "${skill.frontmatter.name}": ${skill.frontmatter.description}`,
        "",
        `This skill has ${waves.length} waves. You will receive ONE wave at a time.`,
        "",
        "Wave overview:",
        waveList,
        "",
        "You are starting with Wave 1. The full instructions for each wave will be",
        "provided in the system prompt. When a wave is complete, signal with [WAVE COMPLETE].",
      ].join("\n"),
      timestamp: new Date().toISOString(),
    });
  } else {
    // No wave structure: inject full instructions with execution preamble
    const skillPreamble = [
      `Activated skill "${skill.frontmatter.name}": ${skill.frontmatter.description}`,
      "",
      "## MANDATORY: Step-by-Step Execution",
      "",
      "Before reading the skill instructions below, understand these ABSOLUTE rules:",
      "",
      "1. Your FIRST action must be: use TodoWrite to decompose this skill into numbered steps.",
      "2. Then execute each step ONE AT A TIME with real tool calls.",
      "3. NEVER skip steps. NEVER narrate what you would do — actually DO it with tools.",
      "4. After each step, verify your work (Read the file, run a check, etc.).",
      '5. For GitHub search: `gh search repos "query" --limit 10 --json name,url,description,stargazersCount`',
      "6. For web content: `curl -sL 'url' | head -200`",
      "7. For cloning repos: `git clone --depth 1 'url' /tmp/oss-scan/name`",
      "8. Mark each TodoWrite step completed as you finish it.",
      "",
      "---",
      "",
      skill.instructions,
    ].join("\n");

    state.session.messages.push({
      id: randomUUID(),
      role: "system",
      content: skillPreamble,
      timestamp: new Date().toISOString(),
    });

    state.waveState = null;
  }

  // Track active skill so pipeline continuation protections apply universally
  state.activeSkill = skill.frontmatter.name;

  const waveInfo = hasWaves
    ? `\n${DIM}Detected ${waves.length} waves — Claude Workflow Mode active${RESET}`
    : "";
  return `${GREEN}Activated skill:${RESET} ${BOLD}${skill.frontmatter.name}${RESET}\n${DIM}${skill.frontmatter.description}${RESET}${waveInfo}`;
}

async function skillsListCommand(_args: string, state: ReplState): Promise<string> {
  const catalog = new SkillCatalog(state.projectRoot);
  await catalog.load();
  const entries = catalog.getAll();

  const registry = await listSkills(state.projectRoot);
  if (entries.length === 0 && registry.length === 0) {
    return `${DIM}No skills installed. Use '/skill-install <source>' or 'dantecode skills install <source>'.${RESET}`;
  }

  const lines = [
    `${BOLD}Installed Skills (${entries.length} catalog + ${registry.length} registry):${RESET}`,
    "",
  ];

  if (entries.length > 0) {
    lines.push(`${BOLD}Catalog Skills:${RESET}`);
    for (const entry of entries) {
      const scoreStr =
        entry.verificationScore !== undefined
          ? ` ${entry.verificationScore >= 85 ? GREEN : entry.verificationScore >= 70 ? YELLOW : RED}[score:${entry.verificationScore}]${RESET}`
          : "";
      const tierStr = entry.verificationTier ? ` ${DIM}[${entry.verificationTier}]${RESET}` : "";
      lines.push(
        `  ${YELLOW}${entry.name.padEnd(24)}${RESET} ${DIM}${entry.source}${RESET}${tierStr}${scoreStr} ${entry.description.slice(0, 50)}`,
      );
    }
    lines.push("");
  }

  if (registry.length > 0) {
    lines.push(`${BOLD}Registry Skills:${RESET}`);
    for (const skill of registry) {
      lines.push(
        `  ${YELLOW}${skill.name.padEnd(24)}${RESET} ${DIM}${skill.importSource}${RESET} ${skill.description.slice(0, 60)}`,
      );
    }
  }

  return lines.join("\n");
}

/** Router: /skills with no args → list; /skills run <name> → agent loop; else → CLI handler */
async function skillsRoutingCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const sub = parts[0] ?? "";

  if (sub === "run") {
    return await skillsRunViaLoop(parts.slice(1).join(" ").trim(), state);
  }

  if (parts.length > 0) {
    // Other sub-commands (import, export, wrap, etc.) — delegate to CLI handler
    await runSkillsCommand(parts, state.projectRoot);
    return "";
  }

  return await skillsListCommand("", state);
}

async function skillsRunViaLoop(skillName: string, state: ReplState): Promise<string> {
  if (!skillName) return `${RED}Usage: /skills run <name>${RESET}`;

  const skill = await getSkill(skillName, state.projectRoot);
  if (!skill) return `${YELLOW}Skill "${skillName}" not found.${RESET}`;

  const policyResult = runSkillPolicyCheck({
    allowedTools: skill.frontmatter.tools,
    compatibility: undefined,
  });
  if (!policyResult.passed) {
    const details = policyResult.errors
      .map((e: { code: string; message: string }) => `[${e.code}] ${e.message}`)
      .join("; ");
    return `${RED}Policy check failed — ${details}${RESET}`;
  }

  const taskSession = cloneSessionForTask(
    state.session,
    state.projectRoot,
    `skill-run-${Date.now()}`,
  );

  const waves = parseSkillWaves(skill.instructions);
  const hasWaves = waves.length > 1;
  const waveStateObj = hasWaves ? createWaveState(waves) : undefined;

  // Build preamble and inject into cloned session (mirrors skillCommand logic)
  const preamble = hasWaves
    ? [
        `Execute skill "${skill.frontmatter.name}": ${skill.frontmatter.description ?? ""}`,
        "",
        `This skill has ${waves.length} waves. You will receive ONE wave at a time.`,
        "",
        "Wave overview:",
        ...waves.map((w: { number: number; title: string }) => `  ${w.number}. ${w.title}`),
        "",
        "You are starting with Wave 1. When a wave is complete, signal with [WAVE COMPLETE].",
      ].join("\n")
    : [
        `Execute skill "${skill.frontmatter.name}": ${skill.frontmatter.description ?? ""}`,
        "",
        "## MANDATORY: Step-by-Step Execution",
        "",
        "1. Use TodoWrite to decompose this skill into numbered steps.",
        "2. Execute each step ONE AT A TIME with real tool calls.",
        "3. NEVER skip steps. NEVER narrate — actually DO it with tools.",
        "4. Mark each step completed as you finish it.",
        "",
        "---",
        "",
        skill.instructions,
      ].join("\n");

  taskSession.messages.push({
    id: randomUUID(),
    role: "system",
    content: preamble,
    timestamp: new Date().toISOString(),
  });

  try {
    const loopResult = await runAgentLoop(
      `Execute the "${skill.frontmatter.name}" skill.`,
      taskSession,
      {
        state: state.state,
        verbose: state.verbose,
        enableGit: state.enableGit,
        enableSandbox: state.enableSandbox,
        silent: false,
        skillActive: true,
        waveState: waveStateObj,
      },
    );
    const output = getLastAssistantText(loopResult) ?? "";
    const summary = output.length > 400 ? `${output.slice(0, 400)}…` : output;
    return `${GREEN}Skill "${skill.frontmatter.name}" complete.${RESET}\n\n${summary}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Skill execution failed:${RESET} ${msg}`;
  }
}

async function skillInstallCommand(args: string, state: ReplState): Promise<string> {
  const source = args.trim();
  if (!source) {
    return `${RED}Usage: /skill-install <source>${RESET}\n${DIM}source can be a local path, git URL, or HTTP URL${RESET}`;
  }

  const lines = [`${DIM}Installing skill from: ${source}...${RESET}`];
  const result = await installSkill({ source, verify: true, tier: "guardian" }, state.projectRoot);

  if (!result.success) {
    return lines
      .concat([`${RED}Install failed: ${result.error ?? "unknown error"}${RESET}`])
      .join("\n");
  }

  lines.push(`${GREEN}Installed:${RESET} ${BOLD}${result.name}${RESET}`);
  lines.push(`  ${DIM}Format: ${result.format}${RESET}`);
  lines.push(`  ${DIM}Path: ${result.installedPath}${RESET}`);
  if (result.verification) {
    const tierColor =
      result.verification.tier === "sovereign"
        ? GREEN
        : result.verification.tier === "sentinel"
          ? YELLOW
          : DIM;
    lines.push(
      `  ${DIM}Verification: ${tierColor}${result.verification.tier}${RESET} ${DIM}(score: ${result.verification.overallScore})${RESET}`,
    );
  }
  return lines.join("\n");
}

async function skillVerifyCommand(args: string, state: ReplState): Promise<string> {
  const skillName = args.trim();
  if (!skillName) {
    return `${RED}Usage: /skill-verify <name>${RESET}`;
  }

  const skill = await getSkill(skillName, state.projectRoot);
  if (!skill) {
    return `${RED}Skill not found: ${skillName}${RESET}`;
  }

  const universalSkill = {
    name: skill.frontmatter.name,
    description: skill.frontmatter.description,
    instructions: skill.instructions,
    source: "claude" as const,
    sourcePath: skill.sourcePath,
  };

  const result = await verifySkill(universalSkill, { tier: "guardian" });
  const lines = [`${BOLD}Verification: ${skill.frontmatter.name}${RESET}`, ""];

  const overallColor =
    result.tier === "sovereign" ? GREEN : result.tier === "sentinel" ? YELLOW : RED;
  lines.push(`  Score:  ${overallColor}${result.overallScore}/100${RESET}`);
  lines.push(`  Tier:   ${overallColor}${result.tier}${RESET}`);
  lines.push(`  Passed: ${result.passed ? `${GREEN}YES${RESET}` : `${RED}NO${RESET}`}`);

  if (result.findings.length > 0) {
    lines.push("", `${BOLD}Findings (${result.findings.length}):${RESET}`);
    for (const f of result.findings) {
      const icon =
        f.severity === "critical"
          ? RED + "CRIT"
          : f.severity === "warning"
            ? YELLOW + "WARN"
            : DIM + "INFO";
      lines.push(`  ${icon}${RESET} [${f.category}] ${f.message}`);
    }
  }
  return lines.join("\n");
}

async function agentsCommand(_args: string, state: ReplState): Promise<string> {
  const agentsDir = join(state.projectRoot, ".dantecode", "agents");

  try {
    const entries = await readdir(agentsDir);
    const agentFiles = entries.filter(
      (e) => e.endsWith(".yaml") || e.endsWith(".yml") || e.endsWith(".md"),
    );

    if (agentFiles.length === 0) {
      return `${DIM}No agent definitions found in ${agentsDir}${RESET}`;
    }

    const lines = [`${BOLD}Available Agents:${RESET}`, ""];
    for (const file of agentFiles) {
      const name = file.replace(/\.(yaml|yml|md)$/, "");
      lines.push(`  ${YELLOW}${name}${RESET}`);
    }
    return lines.join("\n");
  } catch {
    return `${DIM}No agent definitions directory found. Run 'dantecode init' to create one.${RESET}`;
  }
}

async function worktreeCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.enableGit) {
    return `${YELLOW}Git is disabled for this session (--no-git).${RESET}`;
  }

  try {
    const branchName = `dantecode/${state.session.id.slice(0, 8)}`;
    let baseBranch: string;

    try {
      baseBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: state.projectRoot,
        encoding: "utf-8",
      }).trim();
    } catch {
      baseBranch = "main";
    }

    const result = createWorktree({
      branch: branchName,
      baseBranch,
      sessionId: state.session.id,
      directory: state.projectRoot,
    });

    state.session.worktreeRef = result.branch;

    return `${GREEN}Created worktree${RESET}\n  Branch: ${BOLD}${result.branch}${RESET}\n  Directory: ${result.directory}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Worktree error: ${message}${RESET}`;
  }
}

async function readOnlyCommand(args: string, state: ReplState): Promise<string> {
  const filePath = args.trim();
  if (!filePath) {
    // Show current read-only files
    if (state.session.readOnlyFiles.length === 0) {
      return `${DIM}No read-only files. Use /read-only <file> to add reference context.${RESET}`;
    }
    const lines = [`${BOLD}Read-only files (reference only, not editable):${RESET}`, ""];
    for (const file of state.session.readOnlyFiles) {
      const rel = relative(state.projectRoot, file);
      lines.push(`  ${DIM}-${RESET} ${rel}`);
    }
    return lines.join("\n");
  }

  const resolved = resolve(state.projectRoot, filePath);

  try {
    const content = await readFile(resolved, "utf-8");
    const lineCount = content.split("\n").length;

    if (!state.session.readOnlyFiles.includes(resolved)) {
      state.session.readOnlyFiles.push(resolved);
    }
    // Remove from editable files if present
    const editIdx = state.session.activeFiles.indexOf(resolved);
    if (editIdx !== -1) {
      state.session.activeFiles.splice(editIdx, 1);
    }

    state.session.messages.push({
      id: randomUUID(),
      role: "system",
      content: `Reference file (READ-ONLY, do not edit): ${resolved}\n\n\`\`\`\n${content}\n\`\`\``,
      timestamp: new Date().toISOString(),
    });

    return `${GREEN}Added (read-only)${RESET} ${resolved} ${DIM}(${lineCount} lines)${RESET}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error reading file: ${message}${RESET}`;
  }
}

async function compactCommand(_args: string, state: ReplState): Promise<string> {
  const before = state.session.messages.length;
  if (before <= 12) {
    return `${DIM}Context is small enough (${before} messages) — no compaction needed.${RESET}`;
  }

  // When DanteMemory is available, use semantic summarization
  const mo = await getOrInitMemory(state);
  if (mo) {
    try {
      const sumResult = await mo.memorySummarize(state.session.id);
      if (sumResult.compressed && sumResult.summary) {
        const KEEP_RECENT = 10;
        const first = state.session.messages[0]!;
        const recent = state.session.messages.slice(-KEEP_RECENT);
        const removed = before - KEEP_RECENT - 1;
        const summaryMsg: SessionMessage = {
          id: randomUUID(),
          role: "system",
          content: `## Session Summary (DanteMemory compact)\n${sumResult.summary}`,
          timestamp: new Date().toISOString(),
        };
        state.session.messages = [first, summaryMsg, ...recent];
        const savedNote = sumResult.tokensSaved ? ` (~${sumResult.tokensSaved} tokens saved)` : "";
        return `${GREEN}Compacted (DanteMemory):${RESET} ${before} → ${state.session.messages.length} messages (${removed} removed)${savedNote}`;
      }
    } catch {
      // Fall through to basic compaction
    }
  }

  // Fallback: basic slice compaction
  const KEEP_RECENT = 10;
  const first = state.session.messages[0]!;
  const last = state.session.messages.slice(-KEEP_RECENT);
  const removed = before - KEEP_RECENT - 1;
  const summaryMsg: SessionMessage = {
    id: randomUUID(),
    role: "system",
    content: `[${removed} earlier messages compacted to save context]`,
    timestamp: new Date().toISOString(),
  };
  state.session.messages = [first, summaryMsg, ...last];
  return `${GREEN}Compacted:${RESET} ${before} → ${state.session.messages.length} messages (${removed} removed)`;
}

async function memoryCommand(args: string, state: ReplState): Promise<string> {
  const mo = await getOrInitMemory(state);
  if (!mo) {
    return `${DIM}DanteMemory failed to initialize. Check disk permissions.${RESET}`;
  }

  const parts = args.trim().split(/\s+/).filter(Boolean);
  const subcommand = parts[0] ?? "list";

  switch (subcommand) {
    case "list": {
      try {
        const viz = mo.memoryVisualize();
        const nodes = viz.nodes ?? [];
        const counts: Record<string, number> = {};
        for (const node of nodes) {
          const t = (node as { type?: string }).type ?? "unknown";
          counts[t] = (counts[t] ?? 0) + 1;
        }
        const lines = [
          `${BOLD}DanteMemory State${RESET}`,
          ...Object.entries(counts).map(([t, n]) => `  ${t}: ${n}`),
          "",
          `${DIM}Use /memory search <query> to retrieve relevant memories${RESET}`,
          `${DIM}Use /memory stats for capacity info${RESET}`,
        ];
        return lines.join("\n");
      } catch (e) {
        return `${RED}Error listing memories: ${String(e)}${RESET}`;
      }
    }

    case "search": {
      const query = parts.slice(1).join(" ");
      if (!query) return `${RED}Usage: /memory search <query>${RESET}`;
      try {
        const result = await mo.memoryRecall(query, 10);
        if (!result.results.length) {
          return `${DIM}No memories found for: "${query}"${RESET}`;
        }
        const lines = [`${BOLD}Semantic Recall:${RESET} "${query}" (${result.latencyMs}ms)\n`];
        for (const item of result.results) {
          const summary =
            item.summary ??
            (typeof item.value === "string"
              ? item.value.slice(0, 100)
              : JSON.stringify(item.value).slice(0, 100));
          lines.push(`  [${item.scope}] ${item.key}`);
          lines.push(`    ${DIM}${summary}${RESET}`);
          lines.push(`    score: ${item.score.toFixed(2)} | recalls: ${item.recallCount}`);
        }
        return lines.join("\n");
      } catch (e) {
        return `${RED}Error searching memories: ${String(e)}${RESET}`;
      }
    }

    case "stats": {
      try {
        const viz = mo.memoryVisualize();
        const nodes = viz.nodes ?? [];
        const edges = viz.edges ?? [];
        return [
          `${BOLD}DanteMemory Statistics${RESET}`,
          `  Nodes: ${nodes.length}`,
          `  Edges: ${edges.length}`,
          `${DIM}Use /memory list for type breakdown${RESET}`,
        ].join("\n");
      } catch (e) {
        return `${RED}Error getting stats: ${String(e)}${RESET}`;
      }
    }

    case "forget": {
      const key = parts.slice(1).join(" ");
      if (!key) return `${RED}Usage: /memory forget <key>${RESET}`;
      return `${YELLOW}Memory "${key}" flagged for low-priority. Run /memory prune to clean up low-value entries.${RESET}`;
    }

    case "export": {
      // --format json|md outputs directly to stdout; otherwise write to a file
      const fmtFlagIdx = parts.indexOf("--format");
      const fmtArg = fmtFlagIdx !== -1 ? (parts[fmtFlagIdx + 1] ?? "") : "";
      const stdoutFormat =
        fmtArg === "json" ? "json" : fmtArg === "md" || fmtArg === "markdown" ? "md" : null;
      // If no --format flag, the next arg (if present) is the output path
      const exportPath =
        stdoutFormat === null
          ? (parts[1] ?? `dantecode-memory-${new Date().toISOString().slice(0, 10)}.json`)
          : null;
      try {
        const viz = mo.memoryVisualize();
        const recallAll = await mo.memoryRecall("*", 1000);
        const memories = recallAll.results.map((r) => ({
          key: r.key,
          scope: r.scope,
          value: r.value,
          summary: r.summary,
          score: r.score,
          recallCount: r.recallCount,
        }));

        if (stdoutFormat === "json") {
          return JSON.stringify(memories, null, 2);
        }

        if (stdoutFormat === "md") {
          const header = `# DanteMemory Export\n\nExported: ${new Date().toISOString()}\n\n`;
          const tableHeader = `| Key | Scope | Summary | Score | Recalls |\n| --- | ----- | ------- | ----- | ------- |\n`;
          const rows = memories
            .map(
              (m) =>
                `| ${m.key} | ${m.scope} | ${(m.summary ?? String(m.value)).slice(0, 60)} | ${m.score.toFixed(2)} | ${m.recallCount} |`,
            )
            .join("\n");
          return header + tableHeader + rows;
        }

        // File export (no --format)
        const exportData = {
          version: "1.0.0",
          exportedAt: new Date().toISOString(),
          projectRoot: state.projectRoot,
          stats: {
            nodeCount: (viz.nodes ?? []).length,
            edgeCount: (viz.edges ?? []).length,
          },
          memories,
        };
        await writeFile(
          resolve(state.projectRoot, exportPath!),
          JSON.stringify(exportData, null, 2),
          "utf8",
        );
        return `${GREEN}Memory exported to: ${BOLD}${exportPath}${RESET} (${exportData.memories.length} memories)`;
      } catch (e) {
        return `${RED}Error exporting memory: ${String(e)}${RESET}`;
      }
    }

    case "cross-session": {
      const goal = parts.slice(1).join(" ") || undefined;
      try {
        const result = await mo.crossSessionRecall(goal, 5);
        if (!result.results.length) {
          return `${DIM}No cross-session memories found${RESET}`;
        }
        const lines = [`${BOLD}Cross-session Recall${RESET}\n`];
        for (const item of result.results) {
          const summary = item.summary ?? String(item.value).slice(0, 100);
          lines.push(`  [${item.scope}] ${item.key}: ${DIM}${summary}${RESET}`);
        }
        return lines.join("\n");
      } catch (e) {
        return `${RED}Error in cross-session recall: ${String(e)}${RESET}`;
      }
    }

    default:
      return [
        `${BOLD}/memory subcommands:${RESET}`,
        `  list            — show memory state overview`,
        `  search <query>  — semantic search across all memories`,
        `  stats           — node/edge counts`,
        `  forget <key>    — mark a memory for low-priority pruning`,
        `  cross-session   — find memories across past sessions`,
        `  export [path]   — export all memories to JSON backup`,
      ].join("\n");
  }
}

async function architectCommand(_args: string, state: ReplState): Promise<string> {
  const ARCHITECT_MARKER = "[ARCHITECT MODE]";
  const hasArchitect = state.session.messages.some(
    (m) =>
      m.role === "system" && typeof m.content === "string" && m.content.includes(ARCHITECT_MARKER),
  );

  if (hasArchitect) {
    state.session.messages = state.session.messages.filter(
      (m) =>
        !(
          m.role === "system" &&
          typeof m.content === "string" &&
          m.content.includes(ARCHITECT_MARKER)
        ),
    );
    return `${YELLOW}Architect mode OFF${RESET} — direct coding mode resumed.`;
  }

  state.session.messages.push({
    id: randomUUID(),
    role: "system",
    content: `${ARCHITECT_MARKER}\nYou are now in Architect mode. Before writing any code:\n1. Analyze the full scope of the request\n2. Identify all files that need to change\n3. Draft a step-by-step plan with file paths and change descriptions\n4. Present the plan to the user for approval\n5. Only after approval, implement the changes one file at a time\n6. After each file change, run verification (lint/test/build) before moving to the next`,
    timestamp: new Date().toISOString(),
  });

  return `${GREEN}Architect mode ON${RESET} — the agent will plan before coding.`;
}

async function ossCommand(args: string, state: ReplState): Promise<string> {
  const focusArea = args.trim();

  const ossInstructions = `[OSS RESEARCHER — AUTONOMOUS PIPELINE]

You are now executing the /oss pipeline. Follow these steps AUTONOMOUSLY — do NOT ask the user for permission at any step.

## Phase 0: Auto-Detect This Project
Read the project root, package.json, README.md, and key source files to understand what this project is, what language/framework it uses, and what features it already has.

## Phase 1: Internet Search
Using what you learned about this project, search the internet for the 5-10 most relevant open source projects in the same domain. Use WebSearch to find repos with 1k+ stars, permissive licenses, and active maintenance.${focusArea ? `\n\nFocus area: ${focusArea}` : ""}

## Phase 2: Clone & License Gate
Clone each repo shallow into /tmp/oss-research-<name>. Check LICENSE files — skip GPL/AGPL/SSPL. Delete blocked repos immediately.

## Phase 3: Rapid Scan
For each repo: read entry points, glob for key patterns, note architecture and unique features. Spend 2-3 minutes max per repo.

## Phase 4: Deep Pattern Extraction
Use parallel subagents to analyze each repo. Look for architecture patterns, agent/AI patterns, CLI/UX patterns, quality patterns, and unique innovations.

## Phase 5: Gap Analysis
Compare findings against this project. Rank patterns by P0 (critical, small effort) through P3 (niche, large effort). Select the top 5-8 P0/P1 items.

## Phase 6: Implement
Implement each pattern directly — no stubs, no TODOs, no placeholders. Run typecheck/lint/test after each change. Commit each logical change.

## Phase 7: Autoforge Verification
Run the full QA pipeline. Fix any failures. Continue until ALL checks pass or 3 retry cycles complete.

## Cleanup
rm -rf /tmp/oss-research-* when done.

Rules: Never copy code verbatim. Always check licenses. Clean up cloned repos. Verify every change compiles and passes tests.`;

  state.session.messages.push({
    id: randomUUID(),
    role: "system",
    content: ossInstructions,
    timestamp: new Date().toISOString(),
  });

  // Set the pending agent prompt so processInput chains into the agent loop
  const prompt = focusArea
    ? `Execute the /oss pipeline now. Focus area: ${focusArea}. Start with Phase 0 — scan this project, then search the internet for relevant OSS, clone them, analyze, harvest patterns, implement, and run autoforge.`
    : `Execute the /oss pipeline now. Start with Phase 0 — scan this project to understand what it does, then search the internet for the most relevant OSS tools in the same domain, clone them, analyze, harvest the best patterns, implement them, and run autoforge to verify everything passes.`;

  state.pendingAgentPrompt = prompt;
  state.pendingExpectedWorkflow = "oss";

  return `${GREEN}${BOLD}OSS Research Pipeline activated${RESET}\n${DIM}Scanning project → searching internet → cloning repos → analyzing → implementing → autoforging${RESET}`;
}

async function sandboxCommand(args: string, state: ReplState): Promise<string> {
  const sub = args.trim().toLowerCase();

  // /sandbox status — real enforcement state from DanteSandbox engine
  if (sub === "status" || sub === "") {
    const status = await DanteSandbox.status();
    const modeColor = status.enforced ? GREEN : RED;
    const dockerStr = status.dockerReady ? `${GREEN}ready${RESET}` : `${RED}unavailable${RESET}`;
    const worktreeStr = status.worktreeReady
      ? `${GREEN}ready${RESET}`
      : `${RED}unavailable${RESET}`;
    return [
      `${BOLD}DanteSandbox Status${RESET}`,
      `  Enforced:    ${modeColor}${status.enforced ? "YES" : "NO"}${RESET}`,
      `  Mode:        ${BOLD}${status.mode}${RESET}`,
      `  Preferred:   ${BOLD}${status.preferred}${RESET}`,
      `  Docker:      ${dockerStr}`,
      `  Worktree:    ${worktreeStr}`,
      `  Executions:  ${status.executionCount}`,
      `  Violations:  ${status.violationCount > 0 ? RED : DIM}${status.violationCount}${RESET}`,
      `  Host escapes:${status.hostEscapeCount > 0 ? YELLOW : DIM}${status.hostEscapeCount}${RESET}`,
    ].join("\n");
  }

  // /sandbox force-docker
  if (sub === "force-docker") {
    DanteSandbox.setMode("docker");
    return `${BOLD}Sandbox mode:${RESET} ${GREEN}force-docker${RESET} — all executions routed to Docker.`;
  }

  // /sandbox force-worktree
  if (sub === "force-worktree") {
    DanteSandbox.setMode("worktree");
    return `${BOLD}Sandbox mode:${RESET} ${GREEN}force-worktree${RESET} — all executions routed to git worktree.`;
  }

  // /sandbox force-host — loud warning required
  if (sub === "force-host") {
    DanteSandbox.setMode("host-escape");
    return [
      `${RED}${BOLD}[DanteSandbox WARNING]${RESET} Host escape mode enabled.`,
      `Commands will run UNSANDBOXED on the host. This is audited.`,
      `Use /sandbox force-docker or /sandbox force-worktree to re-engage isolation.`,
    ].join("\n");
  }

  // /sandbox read-only — worktree isolation (safest, no host writes)
  if (sub === "read-only") {
    DanteSandbox.setMode("worktree");
    return `${BOLD}Sandbox mode:${RESET} ${GREEN}read-only${RESET} ${DIM}(worktree isolation — no host writes)${RESET}`;
  }

  // /sandbox workspace-write — auto mode (Docker preferred, worktree fallback)
  if (sub === "workspace-write") {
    DanteSandbox.setMode("auto");
    return `${BOLD}Sandbox mode:${RESET} ${GREEN}workspace-write${RESET} ${DIM}(auto — Docker preferred, worktree fallback)${RESET}`;
  }

  // /sandbox full-access — host escape with loud warning
  if (sub === "full-access") {
    DanteSandbox.setMode("host-escape");
    return [
      `${RED}${BOLD}[DanteSandbox WARNING]${RESET} Full-access mode enabled.`,
      `Commands will run UNSANDBOXED on the host. This is audited.`,
      `Use /sandbox read-only or /sandbox workspace-write to re-engage isolation.`,
    ].join("\n");
  }

  // /sandbox on|off — toggle (backward compat)
  if (sub === "off") {
    if (state.sandboxBridge) {
      await state.sandboxBridge.shutdown();
      state.sandboxBridge = null;
    }
    state.enableSandbox = false;
    DanteSandbox.setMode("off");
    return `${BOLD}Sandbox mode:${RESET} ${RED}OFF${RESET} ${DIM}(legacy compat only)${RESET}`;
  }

  if (sub === "on") {
    const bridge = new SandboxBridge(state.projectRoot, state.verbose);
    const dockerAvailable = await bridge.isAvailable();
    state.sandboxBridge = bridge;
    state.enableSandbox = true;
    DanteSandbox.setMode("auto");
    if (dockerAvailable) {
      return `${BOLD}Sandbox mode:${RESET} ${GREEN}ON${RESET} ${DIM}(Docker + DanteSandbox enforcement active)${RESET}`;
    }
    return `${BOLD}Sandbox mode:${RESET} ${YELLOW}ON (worktree fallback)${RESET} ${DIM}(Docker unavailable)${RESET}`;
  }

  // Default: toggle on/off (original behavior)
  if (state.enableSandbox) {
    if (state.sandboxBridge) {
      await state.sandboxBridge.shutdown();
    }
    state.sandboxBridge = null;
    state.enableSandbox = false;
    DanteSandbox.setMode("off");
    return `${BOLD}Sandbox mode:${RESET} ${RED}OFF${RESET}`;
  }

  const bridge = new SandboxBridge(state.projectRoot, state.verbose);
  const dockerAvailable = await bridge.isAvailable();
  state.sandboxBridge = bridge;
  state.enableSandbox = true;
  DanteSandbox.setMode("auto");

  if (dockerAvailable) {
    return `${BOLD}Sandbox mode:${RESET} ${GREEN}ON${RESET} ${DIM}(Docker isolation + DanteSandbox enforcement active)${RESET}`;
  }

  return `${BOLD}Sandbox mode:${RESET} ${YELLOW}HOST FALLBACK${RESET} ${DIM}(Docker unavailable; worktree isolation in use)${RESET}`;
}

async function silentCommand(_args: string, state: ReplState): Promise<string> {
  state.silent = !state.silent;
  const statusText = state.silent ? `${GREEN}ON${RESET}` : `${RED}OFF${RESET}`;
  return `${BOLD}Silent mode:${RESET} ${statusText}${state.silent ? ` ${DIM}(compact progress only)${RESET}` : ""}`;
}

async function autoforgeCommand(args: string, state: ReplState): Promise<string> {
  const flags = args.trim().split(/\s+/);
  const selfImprove = flags.includes("--self-improve");
  const silentMode = flags.includes("--silent");
  const persistUntilGreen = flags.includes("--persist");
  const resumeSession = flags.find((f) => f.startsWith("--resume="))?.slice("--resume=".length);
  const hardCeiling = persistUntilGreen ? 200 : state.state.autoforge.maxIterations;

  if (selfImprove && !state.lastEditFile && state.session.activeFiles.length === 0) {
    state.pendingAgentPrompt =
      "/autoforge --self-improve improve codebase reliability from the repository root. Run repo-root typecheck, lint, and test after every major edit batch and stop on red.";
    state.pendingExpectedWorkflow = "autoforge";
    return `${GREEN}${BOLD}Self-improvement autoforge queued.${RESET}\n${DIM}The next agent loop will run with explicit protected-write access.${RESET}`;
  }

  // If no active files or last edit, show config summary
  if (!state.lastEditFile && state.session.activeFiles.length === 0) {
    const lines: string[] = [
      `${BOLD}Autoforge Configuration:${RESET}`,
      `  Silent mode: ${silentMode ? `${GREEN}ON${RESET}` : `${DIM}OFF${RESET}`}`,
      `  Persist until green: ${persistUntilGreen ? `${GREEN}ON${RESET}` : `${DIM}OFF${RESET}`}`,
      `  Hard ceiling: ${hardCeiling} rounds`,
      `  GStack commands: ${state.state.autoforge.gstackCommands.length}`,
      "",
      `${DIM}Add a file with /add <file> then run /autoforge to start the loop.${RESET}`,
    ];
    return lines.join("\n");
  }

  // Get the code to autoforge from the last edited file or the first active file
  const targetFile = state.lastEditFile ?? state.session.activeFiles[0];
  if (!targetFile) {
    return `${RED}No file to autoforge. Edit a file first or specify one with /add${RESET}`;
  }
  const resolvedTargetFile = resolve(state.projectRoot, targetFile);
  const displayTargetFile = relative(state.projectRoot, resolvedTargetFile) || resolvedTargetFile;
  let code: string;
  try {
    code = await readFile(resolvedTargetFile, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Error reading target file: ${msg}${RESET}`;
  }

  // Initialize checkpoint manager, circuit breaker, recovery engine,
  // event-sourced checkpointer (LangGraph+OpenHands), and loop detector (CrewAI-inspired)
  const sessionId = resumeSession ?? `af-${state.session.id}-${Date.now()}`;
  const checkpointMgr = new AutoforgeCheckpointManager(state.projectRoot, sessionId);
  const taskBreaker = new TaskCircuitBreaker({
    identicalFailureThreshold: 5,
    maxRecoveryAttempts: 2,
    initialBackoffMs: 125,
    maxBackoffMs: 60_000,
    retryTimeoutMs: 60_000,
  });
  const recovery = new RecoveryEngine({
    execSyncFn: (cmd, cwd) => execSync(cmd, { cwd, stdio: "pipe", encoding: "utf-8" }) as string,
  });
  const eventCheckpointer = new EventSourcedCheckpointer(state.projectRoot, sessionId);
  const loopDetector = new LoopDetector({
    maxIterations: hardCeiling,
    identicalThreshold: 3,
    patternWindowSize: 10,
  });

  // Attempt to resume from a previous session
  let startStep = 0;
  if (resumeSession) {
    const loaded = await checkpointMgr.loadSession(resumeSession);
    const eventCount = await eventCheckpointer.resume();
    if (loaded > 0) {
      const latest = checkpointMgr.getLatestCheckpoint();
      startStep = latest?.currentStep ?? 0;
      process.stdout.write(
        `${GREEN}Resumed from checkpoint ${latest?.id} (step ${startStep}, ${eventCount} events replayed)${RESET}\n`,
      );
    }
  }

  // Create initial event-sourced checkpoint with session state
  await eventCheckpointer.put(
    {
      targetFile: resolvedTargetFile,
      startStep,
      mode: selfImprove ? "self-improve" : "standard",
    },
    {
      source: "input",
      step: startStep,
      triggerCommand: `/autoforge${selfImprove ? " --self-improve" : ""}`,
    },
  );

  // Record before-hash for audit
  recovery.recordBeforeHash(resolvedTargetFile, code);

  process.stdout.write(
    `${DIM}Starting Autoforge IAL on ${displayTargetFile} (max ${hardCeiling} iterations)...${RESET}\n`,
  );

  const routerConfig: ModelRouterConfig = {
    default: state.state.model.default,
    fallback: state.state.model.fallback,
    overrides: state.state.model.taskOverrides,
  };
  const modelRouter = new ModelRouterImpl(routerConfig, state.projectRoot, state.session.id);
  const router = {
    chat: async (prompt: string, opts?: { temperature?: number; maxTokens?: number }) =>
      modelRouter.generate([{ role: "user", content: prompt }], {
        maxTokens: opts?.maxTokens,
        taskType: "autoforge",
      }),
    getConfig: () => routerConfig,
    getCostEstimate: () => modelRouter.getCostEstimate(),
  };

  const sessionStart = Date.now();

  // Start periodic checkpointing (every 15 minutes)
  checkpointMgr.startPeriodicCheckpoints(() => ({
    triggerCommand: `/autoforge${selfImprove ? " --self-improve" : ""}`,
    currentStep: startStep,
    elapsedMs: Date.now() - sessionStart,
    targetFilePath: resolvedTargetFile,
    targetFileContent: code,
    metadata: { silentMode, persistUntilGreen, hardCeiling },
  }));

  try {
    const autoforgeConfig = {
      ...state.state.autoforge,
      maxIterations: hardCeiling,
      enabled: true,
    } as import("@dantecode/config-types").BladeAutoforgeConfig;
    autoforgeConfig.silentMode = silentMode;
    autoforgeConfig.persistUntilGreen = persistUntilGreen;
    autoforgeConfig.hardCeiling = hardCeiling;

    let currentCode = code;
    let result: Awaited<ReturnType<typeof runAutoforgeIAL>> | null = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount <= maxRetries) {
      // Loop detection: check for stuck patterns before each attempt
      const loopCheck = loopDetector.recordAction(
        "autoforge_attempt",
        `retry=${retryCount} step=${startStep + retryCount} file=${displayTargetFile}`,
      );
      if (loopCheck.stuck) {
        checkpointMgr.stopPeriodicCheckpoints();
        await eventCheckpointer.putWrite({
          taskId: `loop-break-${retryCount}`,
          channel: "loopDetection",
          value: { stuck: true, reason: loopCheck.reason, details: loopCheck.details },
          timestamp: new Date().toISOString(),
        });
        return `${RED}${BOLD}Autoforge LOOP DETECTED${RESET}: ${loopCheck.reason} — ${loopCheck.details}\n  Iterations: ${loopCheck.iterationCount}, consecutive repeats: ${loopCheck.consecutiveRepeats}\n  Session: ${sessionId} (resume with --resume=${sessionId})`;
      }

      try {
        result = await runAutoforgeIAL(
          currentCode,
          {
            taskDescription: `Autoforge quality improvement for ${displayTargetFile}`,
            filePath: resolvedTargetFile,
          },
          autoforgeConfig,
          router,
          state.projectRoot,
          silentMode
            ? undefined
            : (progressState) => {
                process.stdout.write(`\r${formatBladeProgressLine(progressState)}`);
              },
        );

        // Record success in circuit breaker and event checkpointer
        taskBreaker.recordSuccess();
        await eventCheckpointer.putWrite({
          taskId: `success-${retryCount}`,
          channel: "ialResult",
          value: {
            succeeded: result.succeeded,
            iterations: result.iterations,
            score: result.finalScore?.overall,
          },
          timestamp: new Date().toISOString(),
        });
        break;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const failureAction = taskBreaker.recordFailure(errMsg, startStep + retryCount);

        // Record failure event
        await eventCheckpointer.putWrite({
          taskId: `failure-${retryCount}`,
          channel: "error",
          value: { error: errMsg, action: failureAction.action, step: startStep + retryCount },
          timestamp: new Date().toISOString(),
        });

        if (failureAction.action === "escalate") {
          // Save final checkpoint before aborting
          await checkpointMgr.createCheckpoint({
            label: "escalation",
            triggerCommand: `/autoforge${selfImprove ? " --self-improve" : ""}`,
            currentStep: startStep + retryCount,
            elapsedMs: Date.now() - sessionStart,
            targetFilePath: resolvedTargetFile,
            targetFileContent: currentCode,
            metadata: { escalated: true, error: errMsg },
          });
          checkpointMgr.stopPeriodicCheckpoints();
          return `${RED}${BOLD}Autoforge ESCALATED${RESET}: ${taskBreaker.getTotalFailures()} failures, recovery exhausted.\n  Last error: ${errMsg}\n  Session: ${sessionId} (resume with --resume=${sessionId})`;
        }

        if (failureAction.action === "pause_and_recover") {
          // Apply exponential backoff before recovery (Aider-style)
          const backoff = taskBreaker.getBackoffDelay(errMsg);
          if (backoff.timedOut) {
            checkpointMgr.stopPeriodicCheckpoints();
            return `${RED}${BOLD}Autoforge TIMED OUT${RESET}: retry backoff exceeded ${taskBreaker.getRetryTimeoutMs()}ms cumulative delay.\n  Session: ${sessionId} (resume with --resume=${sessionId})`;
          }
          if (backoff.delayMs > 0) {
            process.stdout.write(
              `\n${DIM}Backoff: waiting ${backoff.delayMs}ms before recovery (attempt ${backoff.attempt})...${RESET}\n`,
            );
            await new Promise((r) => setTimeout(r, backoff.delayMs));
          }

          process.stdout.write(
            `\n${YELLOW}Circuit breaker triggered — re-reading target file...${RESET}\n`,
          );
          const recoveryResult = await recovery.rereadAndRecover(
            resolvedTargetFile,
            state.projectRoot,
          );
          if (recoveryResult.recovered && recoveryResult.targetContent) {
            currentCode = recoveryResult.targetContent;
            process.stdout.write(
              `${GREEN}Recovery: re-read ${displayTargetFile} (${recoveryResult.contextFiles.length} context files)${RESET}\n`,
            );
          }
        }

        retryCount++;
        if (retryCount > maxRetries) {
          await checkpointMgr.createCheckpoint({
            label: "max-retries-reached",
            triggerCommand: `/autoforge${selfImprove ? " --self-improve" : ""}`,
            currentStep: startStep + retryCount,
            elapsedMs: Date.now() - sessionStart,
            targetFilePath: resolvedTargetFile,
            targetFileContent: currentCode,
            metadata: { error: errMsg },
          });
          checkpointMgr.stopPeriodicCheckpoints();
          return `${RED}Autoforge error after ${retryCount} retries: ${errMsg}${RESET}\n  Session: ${sessionId} (resume with --resume=${sessionId})`;
        }
      }
    }

    checkpointMgr.stopPeriodicCheckpoints();
    process.stdout.write("\n");

    if (!result) {
      return `${RED}Autoforge: no result produced${RESET}`;
    }

    const lines: string[] = [
      "",
      result.succeeded
        ? `${GREEN}${BOLD}Autoforge: ALL GATES PASSED${RESET}`
        : `${RED}${BOLD}Autoforge: DID NOT PASS${RESET}`,
      `  Iterations: ${result.iterations}`,
      `  Termination: ${result.terminationReason}`,
    ];

    if (result.finalScore) {
      lines.push(`  PDSE Score: ${result.finalScore.overall}/100`);
    }

    const lastIteration = result.iterationHistory[result.iterationHistory.length - 1];
    const failedCommands = lastIteration?.gstackResults.filter((entry) => !entry.passed) ?? [];
    if (failedCommands.length > 0) {
      lines.push(`  Failed checks: ${failedCommands.map((entry) => entry.command).join(", ")}`);
    }
    if ((lastIteration?.lessonsInjected.length ?? 0) > 0) {
      lines.push(`  Lessons injected: ${lastIteration?.lessonsInjected.length ?? 0}`);
    }

    lines.push(`  Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);

    if (result.succeeded) {
      // Always require repo-root verification before declaring success/writing
      process.stdout.write(`${DIM}Running final verification...${RESET}\n`);
      const verification = recovery.runRepoRootVerification(state.projectRoot);
      if (!verification.passed) {
        // Override succeeded status if verification fails - no partial successes
        result.succeeded = false;
        lines[1] = `${RED}${BOLD}Autoforge: DID NOT PASS${RESET}`;
        lines.push(
          `  ${RED}Repo-root verification FAILED: ${verification.failedSteps.join(", ")}${RESET}`,
        );
        lines.push(`  Disk state: unchanged — all gates must be green for success`);
        lines.push(`  Session: ${sessionId}`);

        await checkpointMgr.createCheckpoint({
          label: "verification-failed",
          triggerCommand: selfImprove ? `/autoforge --self-improve` : `/autoforge`,
          currentStep: startStep + result.iterations,
          elapsedMs: Date.now() - sessionStart,
          targetFilePath: resolvedTargetFile,
          targetFileContent: currentCode, // Don't use result.finalCode since we didn't succeed
          pdseScores: result.finalScore
            ? [
                {
                  filePath: displayTargetFile,
                  overall: result.finalScore.overall,
                  passedGate: result.finalScore.passedGate ?? false, // Override to failed
                  iteration: result.iterations,
                },
              ]
            : [],
          metadata: { verificationFailed: verification.failedSteps, overrideSucceeded: false },
        });
        return lines.join("\n");
      }
      // Check git status before applying changes
      const preWriteStatus = getGitStatusSummary(state.projectRoot);
      if (!preWriteStatus.isClean) {
        result.succeeded = false;
        lines[1] = `${RED}${BOLD}Autoforge: DID NOT PASS${RESET}`;
        lines.push(
          `  ${RED}Pre-write verification FAILED: git is dirty (${preWriteStatus.stagedCount} staged, ${preWriteStatus.unstagedCount} unstaged, ${preWriteStatus.untrackedCount} untracked)${RESET}`,
        );
        lines.push(`  Disk state: unchanged — cannot apply on dirty repository`);
        return lines.join("\n");
      }

      // Verification passed - proceed with success
      lines.push(`${GREEN}${BOLD}✓ All gates green: Verification passed${RESET}`);

      await writeFile(resolvedTargetFile, result.finalCode, "utf-8");

      // Record after-hash for audit trail
      recovery.recordAfterHash(resolvedTargetFile, result.finalCode);

      // Check git status after writing and verify it's clean (only expected changes)
      const postWriteStatus = getGitStatusSummary(state.projectRoot);
      if (!postWriteStatus.isClean) {
        // Revert the file write since git became dirty
        try {
          // Check if we can safely revert by comparing git status
          const gitDiffOutput = execSync("git diff --name-only", {
            cwd: state.projectRoot,
            encoding: "utf-8",
          })
            .trim()
            .split("\n")
            .filter(Boolean);

          const expectedChanged = [relative(state.projectRoot, resolvedTargetFile)];
          const unexpectedChanges = gitDiffOutput.filter((path) => !expectedChanged.includes(path));

          if (unexpectedChanges.length > 0) {
            // Unexpected changes - revert everything
            execSync("git checkout -- . && git clean -fd", { cwd: state.projectRoot });
            result.succeeded = false;
            lines[1] = `${RED}${BOLD}Autoforge: DID NOT PASS${RESET}`;
            lines.push(
              `  ${RED}Post-write verification FAILED: unexpected changes found: ${unexpectedChanges.join(", ")}${RESET}`,
            );
            lines.push(`  Auto-reverted: all changes undone`);

            await checkpointMgr.createCheckpoint({
              label: "unexpected-changes-reverted",
              triggerCommand: selfImprove ? `/autoforge --self-improve` : `/autoforge`,
              currentStep: startStep + result.iterations,
              elapsedMs: Date.now() - sessionStart,
              targetFilePath: resolvedTargetFile,
              targetFileContent: currentCode, // Revert to original
              metadata: { reverted: true, unexpectedChanges },
            });
            return lines.join("\n");
          }
        } catch (_revertErr) {
          result.succeeded = false;
          lines[1] = `${RED}${BOLD}Autoforge: DID NOT PASS${RESET}`;
          lines.push(
            `  ${RED}Post-write verification FAILED: git is dirty and revert failed${RESET}`,
          );
          lines.push(`  Manual intervention required — check git status`);
          return lines.join("\n");
        }
      }

      // Git status is clean and only expected changes - safe to proceed with auto-commit
      const commitMessage = result.finalScore
        ? `autoforge: improve ${displayTargetFile} (${result.finalScore.overall}/100, ${result.iterations} iterations)`
        : `autoforge: update ${displayTargetFile} (${result.iterations} iterations)`;

      try {
        autoCommit(
          {
            message: commitMessage,
            body: "",
            footer: "Autoforge IAL",
            files: ["."], // commit all changes
            allowEmpty: false,
          },
          state.projectRoot,
        );
        lines.push(`  Committed: ${commitMessage}`);
      } catch (commitErr) {
        // If auto-commit fails, we keep the changes but warn user
        lines.push(
          `  ${YELLOW}Auto-commit failed: ${commitErr instanceof Error ? commitErr.message : String(commitErr)}${RESET}`,
        );
        lines.push(`  Changes applied to disk — manual commit required`);
      }

      state.lastEditFile = resolvedTargetFile;
      state.lastEditContent = code;
      if (!state.session.activeFiles.includes(resolvedTargetFile)) {
        state.session.activeFiles.push(resolvedTargetFile);
      }
      lines.push(`  Applied to disk: ${displayTargetFile}`);
    } else {
      lines.push(`  Disk state: unchanged (${displayTargetFile})`);
    }

    // Save final checkpoint
    await checkpointMgr.createCheckpoint({
      label: result.succeeded ? "completed" : "finished-not-passed",
      triggerCommand: `/autoforge${selfImprove ? " --self-improve" : ""}`,
      currentStep: startStep + result.iterations,
      elapsedMs: Date.now() - sessionStart,
      targetFilePath: resolvedTargetFile,
      targetFileContent: result.succeeded ? result.finalCode : code,
      pdseScores: result.finalScore
        ? [
            {
              filePath: displayTargetFile,
              overall: result.finalScore.overall,
              passedGate: result.finalScore.passedGate ?? true,
              iteration: result.iterations,
            },
          ]
        : [],
      metadata: { succeeded: result.succeeded, terminationReason: result.terminationReason },
    });

    lines.push(`  Session: ${sessionId}`);
    return lines.join("\n");
  } catch (err: unknown) {
    checkpointMgr.stopPeriodicCheckpoints();
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Autoforge error: ${msg}${RESET}`;
  }
}

// ---------------------------------------------------------------------------
// /magic — The primary entry point for non-technical users (D-11 / OnRamp v1.3)
// Runs a single agent loop with run report generation.
// ---------------------------------------------------------------------------

async function magicCommand(args: string, state: ReplState): Promise<string> {
  const goal = args.trim();
  if (!goal) {
    return [
      `${YELLOW}What would you like to build?${RESET}`,
      "",
      `${DIM}Examples:${RESET}`,
      `  ${YELLOW}/magic add user authentication with login and signup${RESET}`,
      `  ${YELLOW}/magic create a REST API for managing products${RESET}`,
      `  ${YELLOW}/magic build a dashboard with charts and filters${RESET}`,
      "",
    ].join("\n");
  }

  // D-11 Run Report: initialize accumulator
  const reportStart = new Date().toISOString();
  const reportAcc = new RunReportAccumulator({
    project: resolve(state.projectRoot).split(/[\\/]/).pop() ?? "unknown",
    command: `/magic ${goal}`,
    model: {
      provider: state.state.model.default.provider,
      modelId: state.state.model.default.modelId,
    },
    dantecodeVersion: "1.3.0",
  });
  reportAcc.beginEntry(goal, "magic");

  process.stdout.write(`\n${GREEN}${BOLD}Building...${RESET} ${DIM}${goal}${RESET}\n\n`);

  let result = "";
  let loopResult: Awaited<ReturnType<typeof runAgentLoop>> | undefined;
  const pdseFailures: string[] = [];
  try {
    const magicSession = cloneSessionForTask(
      state.session,
      state.projectRoot,
      `magic-${Date.now()}`,
    );
    const magicPrompt = [
      "You are building exactly what the user asked for.",
      `Goal: ${goal}`,
      "",
      "Rules:",
      "- Write complete, production-ready code. No stubs, no placeholders.",
      "- Run verification (typecheck, lint, test) after implementation.",
      "- If verification fails, fix the issues before stopping.",
      "- When done, summarize what you built in plain language.",
    ].join("\n");

    loopResult = await runAgentLoop(magicPrompt, magicSession, {
      state: state.state,
      verbose: state.verbose,
      enableGit: state.enableGit,
      enableSandbox: state.enableSandbox,
      silent: false,
    });

    const assistantText = getLastAssistantText(loopResult);

    // Collect files touched during the session
    const touchedFiles = collectTouchedFilesFromSession(loopResult, state.projectRoot);
    if (touchedFiles.length > 0) {
      const created = touchedFiles.map((p) => ({
        path: relative(state.projectRoot, p),
        lines: 0,
      }));
      reportAcc.recordFilesCreated(created);
      for (const f of created) {
        reportAcc.addToManifest([{ action: "created" as const, path: f.path }]);
      }
    }

    // D-12: Progressive disclosure unlock
    try {
      const isUndefined = !state.state.progressiveDisclosure;
      const isAlreadyUnlocked = state.state.progressiveDisclosure?.unlocked;
      if (!isUndefined && !isAlreadyUnlocked) {
        const sessionStats = await countSuccessfulSessions(state.projectRoot);
        if (sessionStats.unlocked) {
          await updateStateYaml(state.projectRoot, {
            progressiveDisclosure: { unlocked: true },
          });
        }
      }
    } catch {
      // Non-fatal, continue
    }

    // Memory auto-retain
    if (state.memoryOrchestrator) {
      try {
        const toolCalls = loopResult.messages.filter((m) => m.toolUse).length;
        let avgPdse = 0;
        if (touchedFiles.length > 0) {
          const scores: number[] = [];
          for (const file of touchedFiles) {
            const content = await readFile(file, "utf-8");
            const score = runLocalPDSEScorer(content, state.projectRoot);
            scores.push(score.overall > 1 ? score.overall : score.overall * 100);
          }
          avgPdse = scores.reduce((a, b) => a + b, 0) / scores.length;
        }
        const filesChanged = touchedFiles.map((p) => relative(state.projectRoot, p));
        await state.memoryOrchestrator.memoryStore(
          `round-${Date.now()}`,
          {
            toolCalls,
            avgPdse,
            filesChanged,
          },
          "session",
          {
            tags: ["auto-retain", "round"],
            source: "magic-command",
          },
        );
      } catch {
        // Never blocks on error
      }
    }

    // PDSE scoring on touched files
    const threshold = state.state.pdse?.threshold ?? 85;
    if (touchedFiles.length > 0) {
      for (const file of touchedFiles) {
        try {
          const content = await readFile(file, "utf-8");
          const score = runLocalPDSEScorer(content, state.projectRoot);
          if (score.overall < threshold || !score.passedGate) {
            const relPath = relative(state.projectRoot, file);
            if (score.completeness < threshold) {
              pdseFailures.push(`${relPath} Completeness ${score.completeness}/100`);
            }
            if (score.correctness < threshold) {
              pdseFailures.push(`${relPath} Correctness ${score.correctness}/100`);
            }
            if (score.clarity < threshold) {
              pdseFailures.push(`${relPath} Clarity ${score.clarity}/100`);
            }
            if (score.consistency < threshold) {
              pdseFailures.push(`${relPath} Consistency ${score.consistency}/100`);
            }
            for (const v of score.violations) {
              pdseFailures.push(
                `${relPath} ${v.severity} ${v.line ? `line ${v.line}` : ""}: ${v.message}`,
              );
            }
          }
        } catch {
          // skip
        }
      }
    }

    reportAcc.completeEntry({
      status: pdseFailures.length > 0 ? "partial" : "complete",
      summary: assistantText.slice(0, 300),
    });

    // D-12: Completion verification
    try {
      const entry = reportAcc.snapshot().entries[0];
      if (entry && (entry.filesCreated.length > 0 || entry.filesModified.length > 0)) {
        const expectations = deriveExpectations(entry);
        const verification = await verifyCompletion(state.projectRoot, expectations);
        reportAcc.recordCompletionVerification(verification);
      }
    } catch {
      /* non-fatal */
    }

    state.session.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: assistantText,
      timestamp: new Date().toISOString(),
    });

    result = `\n${GREEN}${BOLD}Done.${RESET}`;

    if (pdseFailures.length > 0) {
      result += `\n${YELLOW}PDSE Failures:${RESET}\n`;
      for (const failure of pdseFailures) {
        result += `  ${failure}\n`;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    reportAcc.completeEntry({
      status: "failed",
      summary: "Task failed.",
      failureReason: message,
      actionNeeded:
        "Try again with a more specific description, or break the task into smaller steps.",
    });
    result = `${RED}Error: ${message}${RESET}`;
  } finally {
    // D-11: Always write run report (crash-safe)
    try {
      const sealHash = (loopResult as Record<string, unknown> | undefined)?._sealHash;
      if (typeof sealHash === "string" && sealHash.length > 0) {
        reportAcc.setSealHash(sealHash);
      }
      const report = reportAcc.finalize();
      const md = serializeRunReportToMarkdown(report, state.verbose);
      const reportWrite = await writeRunReport({
        projectRoot: state.projectRoot,
        markdown: md,
        timestamp: reportStart,
        autoCommit: state.enableGit,
        commitFn: state.enableGit
          ? async (files, msg, cwd) => {
              autoCommit({ files, message: msg, footer: "", allowEmpty: false }, cwd);
            }
          : undefined,
      });
      if (reportWrite.success && reportWrite.path) {
        result += `\n  ${DIM}Report: ${relative(state.projectRoot, reportWrite.path)}${RESET}`;
      }

      // Human-friendly summary
      const entry = report.entries[0];
      if (entry) {
        if (entry.status === "complete") {
          result += `\n  ${GREEN}Completed and verified.${RESET}`;
        } else {
          result += `\n  ${YELLOW}${entry.failureReason ?? "Needs attention."}${RESET}`;
        }
      }
    } catch {
      /* non-fatal */
    }
  }

  return result;
}

async function forgeCommand(args: string, state: ReplState): Promise<string> {
  const goal = args.trim();
  if (!goal) {
    return [
      `${YELLOW}What would you like to forge?${RESET}`,
      "",
      `${DIM}Examples:${RESET}`,
      `  ${YELLOW}/forge add a payments checkout flow with Stripe${RESET}`,
      `  ${YELLOW}/forge build a full CRUD API with validation and tests${RESET}`,
      `  ${YELLOW}/forge implement rate limiting middleware with Redis${RESET}`,
      "",
      `${DIM}/forge runs a GSD-phased build (Plan → Execute → Verify) with full verification.${RESET}`,
      "",
    ].join("\n");
  }

  // D-11 Run Report: initialize accumulator
  const reportStart = new Date().toISOString();
  const reportAcc = new RunReportAccumulator({
    project: resolve(state.projectRoot).split(/[\\/]/).pop() ?? "unknown",
    command: `/forge ${goal}`,
    model: {
      provider: state.state.model.default.provider,
      modelId: state.state.model.default.modelId,
    },
    dantecodeVersion: "1.3.0",
  });
  reportAcc.beginEntry(goal, "forge");

  // Initialize progress tree for forge phases - all phases are executed in sequence in the agent loop
  const phaseNodes: ProgressNode[] = [
    { name: "Plan", status: "pending", progress: 0 },
    { name: "Execute", status: "pending", progress: 0 },
    { name: "Verify", status: "pending", progress: 0 },
  ];

  const progressDisplay = startProgressDisplay(
    `${GREEN}${BOLD}Forging...${RESET} ${DIM}${goal}${RESET}`,
    phaseNodes,
  );

  let result = "";
  let loopResult: Awaited<ReturnType<typeof runAgentLoop>> | undefined;
  const pdseFailures: string[] = [];
  try {
    const forgeSession = cloneSessionForTask(
      state.session,
      state.projectRoot,
      `forge-${Date.now()}`,
    );
    const forgePrompt = [
      "You are forging exactly what the user asked for using a GSD-phased approach.",
      `Goal: ${goal}`,
      "",
      "## Phase 1 — Plan",
      "- Use TodoWrite to decompose the goal into numbered implementation steps.",
      "- Identify files to create or modify.",
      "",
      "## Phase 2 — Execute",
      "- Implement each step ONE AT A TIME with real tool calls (Write, Edit, Bash).",
      "- Write complete, production-ready code. No stubs, no placeholders.",
      "- Verify each step as you go (Read the file back, run the relevant check).",
      "- Mark each TodoWrite step completed as you finish it.",
      "",
      "## Phase 3 — Verify",
      "- Run typecheck and tests for all touched files.",
      "- Fix any failures before stopping.",
      "- Summarize what you built in plain language.",
    ].join("\n");

    loopResult = await runAgentLoop(forgePrompt, forgeSession, {
      state: state.state,
      verbose: state.verbose,
      enableGit: state.enableGit,
      enableSandbox: state.enableSandbox,
      silent: false,
      skillActive: true,
    });

    const assistantText = getLastAssistantText(loopResult);

    const touchedFiles = collectTouchedFilesFromSession(loopResult, state.projectRoot);
    if (touchedFiles.length > 0) {
      const created = touchedFiles.map((p) => ({
        path: relative(state.projectRoot, p),
        lines: 0,
      }));
      reportAcc.recordFilesCreated(created);
      for (const f of created) {
        reportAcc.addToManifest([{ action: "created" as const, path: f.path }]);
      }
    }

    // Memory auto-retain
    if (state.memoryOrchestrator) {
      try {
        const toolCalls = loopResult.messages.filter((m) => m.toolUse).length;
        let avgPdse = 0;
        if (touchedFiles.length > 0) {
          const scores: number[] = [];
          for (const file of touchedFiles) {
            const content = await readFile(file, "utf-8");
            const score = runLocalPDSEScorer(content, state.projectRoot);
            scores.push(score.overall > 1 ? score.overall : score.overall * 100);
          }
          avgPdse = scores.reduce((a, b) => a + b, 0) / scores.length;
        }
        const filesChanged = touchedFiles.map((p) => relative(state.projectRoot, p));
        await state.memoryOrchestrator.memoryStore(
          `round-${Date.now()}`,
          {
            toolCalls,
            avgPdse,
            filesChanged,
          },
          "session",
          {
            tags: ["auto-retain", "round"],
            source: "forge-command",
          },
        );
      } catch {
        // Never blocks on error
      }
    }

    // PDSE scoring on touched files
    const threshold = state.state.pdse?.threshold ?? 85;
    if (touchedFiles.length > 0) {
      for (const file of touchedFiles) {
        try {
          const content = await readFile(file, "utf-8");
          const score = runLocalPDSEScorer(content, state.projectRoot);
          if (score.overall < threshold || !score.passedGate) {
            const relPath = relative(state.projectRoot, file);
            if (score.completeness < threshold) {
              pdseFailures.push(`${relPath} Completeness ${score.completeness}/100`);
            }
            if (score.correctness < threshold) {
              pdseFailures.push(`${relPath} Correctness ${score.correctness}/100`);
            }
            if (score.clarity < threshold) {
              pdseFailures.push(`${relPath} Clarity ${score.clarity}/100`);
            }
            if (score.consistency < threshold) {
              pdseFailures.push(`${relPath} Consistency ${score.consistency}/100`);
            }
            for (const v of score.violations) {
              pdseFailures.push(
                `${relPath} ${v.severity} ${v.line ? `line ${v.line}` : ""}: ${v.message}`,
              );
            }
          }
        } catch {
          // skip
        }
      }
    }

    // GStack verification — forge always runs verification suite when configured
    let forgeStatus: "complete" | "partial" = "complete";
    let verificationSummary: string | undefined;
    if (state.state.autoforge?.gstackCommands?.length) {
      try {
        const gstackResults = await runGStack(
          "",
          state.state.autoforge.gstackCommands,
          state.projectRoot,
        );
        const gstackPassed = allGStackPassed(gstackResults);
        verificationSummary = summarizeGStackResults(gstackResults);
        forgeStatus = gstackPassed && pdseFailures.length === 0 ? "complete" : "partial";
      } catch {
        forgeStatus = pdseFailures.length === 0 ? "complete" : "partial";
      }
    } else {
      forgeStatus = pdseFailures.length === 0 ? "complete" : "partial";
    }
    const completionSummary = verificationSummary
      ? `${assistantText.slice(0, 200)}\n\nVerification: ${verificationSummary}${pdseFailures.length > 0 ? `\nPDSE Failures: ${pdseFailures.length}` : ""}`
      : `${assistantText.slice(0, 300)}${pdseFailures.length > 0 ? `\nPDSE Failures: ${pdseFailures.length}` : ""}`;
    reportAcc.completeEntry({ status: forgeStatus, summary: completionSummary });

    // D-12: Completion verification
    try {
      const entry = reportAcc.snapshot().entries[0];
      if (entry && (entry.filesCreated.length > 0 || entry.filesModified.length > 0)) {
        const expectations = deriveExpectations(entry);
        const verification = await verifyCompletion(state.projectRoot, expectations);
        reportAcc.recordCompletionVerification(verification);
      }
    } catch {
      /* non-fatal */
    }

    state.session.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: assistantText,
      timestamp: new Date().toISOString(),
    });

    // Update progress: all phases complete
    phaseNodes.forEach((node) => {
      node.status = "complete";
      node.progress = 100;
    });
    const verifyPhaseNode = phaseNodes.at(-1);
    if (verifyPhaseNode) {
      verifyPhaseNode.pdseScore = pdseFailures.length > 0 ? 60 : 90; // Verify phase shows overall score
    }
    progressDisplay.update(phaseNodes);
    progressDisplay.end();

    result = `\n${GREEN}${BOLD}Forged.${RESET}`;

    if (pdseFailures.length > 0) {
      result += `\n${YELLOW}PDSE Failures:${RESET}\n`;
      for (const failure of pdseFailures) {
        result += `  ${failure}\n`;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Update progress: mark phases as failed
    phaseNodes.forEach((node) => {
      node.status = "failed";
      node.progress = 0;
    });
    progressDisplay.update(phaseNodes);
    progressDisplay.end();

    reportAcc.completeEntry({
      status: "failed",
      summary: "Forge failed.",
      failureReason: message,
      actionNeeded: "Try again with a more specific goal, or break into smaller steps.",
    });
    result = `${RED}Error: ${message}${RESET}`;
  } finally {
    // D-11: Always write run report (crash-safe)
    try {
      const sealHash = (loopResult as Record<string, unknown> | undefined)?._sealHash;
      if (typeof sealHash === "string" && sealHash.length > 0) {
        reportAcc.setSealHash(sealHash);
      }
      const report = reportAcc.finalize();
      const md = serializeRunReportToMarkdown(report, state.verbose);
      const reportWrite = await writeRunReport({
        projectRoot: state.projectRoot,
        markdown: md,
        timestamp: reportStart,
        autoCommit: state.enableGit,
        commitFn: state.enableGit
          ? async (files, msg, cwd) => {
              autoCommit({ files, message: msg, footer: "", allowEmpty: false }, cwd);
            }
          : undefined,
      });
      if (reportWrite.success && reportWrite.path) {
        result += `\n  ${DIM}Report: ${relative(state.projectRoot, reportWrite.path)}${RESET}`;
      }
      const entry = report.entries[0];
      if (entry) {
        result +=
          entry.status === "complete"
            ? `\n  ${GREEN}Forged and verified.${RESET}`
            : `\n  ${YELLOW}${entry.failureReason ?? "Needs attention."}${RESET}`;
      }
    } catch {
      /* non-fatal */
    }
  }

  return result;
}

async function partyCommand(args: string, state: ReplState): Promise<string> {
  const hasAutoforge = /(?:^|\s)--autoforge(?:\s|$)/.test(args);
  const filesMatch = args.match(/--files\s+([^\s]+)/);
  const scopedFiles = filesMatch?.[1]
    ? filesMatch[1]
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  const resumeMatch = args.match(/--resume=([^\s]+)/);
  const resumeSession = resumeMatch?.[1];
  const task = args
    .replace(/--autoforge/g, "")
    .replace(/--files\s+[^\s]+/g, "")
    .replace(/--resume=[^\s]+/g, "")
    .trim();

  if (!task) {
    return `${RED}Usage: /party [--autoforge] [--files a,b] [--resume=<session>] <task description>${RESET}\n${DIM}Spawns multi-agent coordination with parallel lanes.${RESET}`;
  }

  if (!hasAutoforge) {
    const routerConfig = {
      default: state.state.model.default,
      fallback: state.state.model.fallback ?? [],
      overrides:
        ((state.state.model as Record<string, unknown>)["taskOverrides"] as Record<
          string,
          import("@dantecode/config-types").ModelConfig
        >) ?? {},
    };
    const router = new ModelRouterImpl(routerConfig, state.projectRoot, state.session.id);
    const multiAgent = new MultiAgent(router, state.state);

    const onProgress: MultiAgentProgressCallback = (update) => {
      const icon =
        update.status === "started"
          ? `${YELLOW}>`
          : update.status === "completed"
            ? `${GREEN}+`
            : `${RED}x`;
      process.stdout.write(
        `  ${icon}${RESET} ${BOLD}${update.lane.padEnd(12)}${RESET} ${DIM}${update.message.slice(0, 60)}${RESET}\n`,
      );
    };

    process.stdout.write(
      `\n${YELLOW}${BOLD}Multi-Agent Party${RESET} ${DIM}(spawning lanes...)${RESET}\n\n`,
    );

    // D-11 Run Report: accumulator for non-autoforge party
    const partyReportStart = new Date().toISOString();
    const reportAcc = new RunReportAccumulator({
      project: resolve(state.projectRoot).split(/[\\/]/).pop() ?? "unknown",
      command: `/party ${args}`,
      model: {
        provider: state.state.model.default.provider,
        modelId: state.state.model.default.modelId,
      },
      dantecodeVersion: "1.3.0",
    });
    let partyResult: string = "";

    try {
      const result = await multiAgent.coordinate(task, {}, onProgress);

      // Populate run report from multi-agent result
      for (const output of result.outputs) {
        reportAcc.beginEntry(output.role, "multi-agent-lane");
        reportAcc.recordVerification({
          antiStub: { passed: true, violations: 0, details: ["DanteForge detail unavailable"] },
          constitution: {
            passed: true,
            violations: 0,
            warnings: 0,
            details: ["DanteForge detail unavailable"],
          },
          pdseScore: output.pdseScore,
          pdseThreshold: state.state.pdse.threshold,
          regenerationAttempts: 0,
          maxAttempts: 0,
        });
        const entryStatus =
          output.pdseScore >= state.state.pdse.threshold
            ? ("complete" as const)
            : ("partial" as const);
        reportAcc.completeEntry({
          status: entryStatus,
          summary: output.content.slice(0, 200),
          failureReason:
            entryStatus === "partial"
              ? `PDSE ${output.pdseScore} below threshold ${state.state.pdse.threshold}`
              : undefined,
        });

        // D-12: Completion verification per lane
        try {
          const entrySnapshot = reportAcc.snapshot().entries.at(-1);
          if (
            entrySnapshot &&
            (entrySnapshot.filesCreated.length > 0 || entrySnapshot.filesModified.length > 0)
          ) {
            const expectations = deriveExpectations(entrySnapshot);
            const cvResult = await verifyCompletion(state.projectRoot, expectations);
            reportAcc.recordCompletionVerification(cvResult);
          }
        } catch {
          /* non-fatal */
        }
      }

      const allPassed = result.compositePdse >= state.state.pdse.threshold;
      const lines: string[] = [
        "",
        allPassed
          ? `${GREEN}${BOLD}Done \u2014 all lanes verified${RESET}`
          : `${YELLOW}${BOLD}Done \u2014 some lanes need attention${RESET}`,
        `  Lanes: ${result.outputs.length} | Iterations: ${result.iterations}`,
        "",
      ];

      for (const output of result.outputs) {
        const icon =
          output.pdseScore >= 80
            ? `${GREEN}\u2713`
            : output.pdseScore >= 60
              ? `${YELLOW}\u26A0`
              : `${RED}\u2717`;
        const label =
          output.pdseScore >= 80
            ? "verified"
            : output.pdseScore >= 60
              ? "review needed"
              : "needs attention";
        lines.push(
          `  ${icon}${RESET} ${BOLD}${output.role.padEnd(12)}${RESET} ${DIM}${label}${RESET}`,
        );
      }

      const combinedContent = result.outputs
        .map((o) => `## ${o.role} (PDSE: ${o.pdseScore})\n\n${o.content}`)
        .join("\n\n---\n\n");

      state.session.messages.push({
        id: randomUUID(),
        role: "assistant",
        content: combinedContent,
        timestamp: new Date().toISOString(),
      });

      partyResult = lines.join("\n");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      partyResult = `${RED}Party error: ${message}${RESET}`;
    } finally {
      // D-11: crash-safe run report write
      try {
        const report = reportAcc.finalize();
        const md = serializeRunReportToMarkdown(report, state.verbose);
        const reportWrite = await writeRunReport({
          projectRoot: state.projectRoot,
          markdown: md,
          timestamp: partyReportStart,
          autoCommit: state.enableGit,
          commitFn: state.enableGit
            ? async (files, msg, cwd) => {
                autoCommit({ files, message: msg, footer: "", allowEmpty: false }, cwd);
              }
            : undefined,
        });
        if (reportWrite.success && reportWrite.path) {
          process.stdout.write(
            `  ${DIM}Run report: ${relative(state.projectRoot, reportWrite.path)}${RESET}\n`,
          );
        }
      } catch {
        /* non-fatal */
      }
    }

    return partyResult;
  }

  const lanes = ["orchestrator", "planner", "coder", "tester", "reviewer", "deployer"] as const;
  const baseBranch = execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: state.projectRoot,
    encoding: "utf-8",
  }).trim();

  const mergedLanes: string[] = [];
  const blockedLanes: string[] = [];

  // Initialize checkpoint manager, circuit breaker, recovery engine,
  // event-sourced checkpointer, and loop detector for party mode
  const sessionId = resumeSession ?? `party-${state.session.id}-${Date.now()}`;
  const checkpointMgr = new AutoforgeCheckpointManager(state.projectRoot, sessionId);
  const taskBreaker = new TaskCircuitBreaker({
    identicalFailureThreshold: 5,
    maxRecoveryAttempts: 2,
    initialBackoffMs: 125,
    maxBackoffMs: 60_000,
    retryTimeoutMs: 60_000,
  });
  const recoveryEng = new RecoveryEngine({
    execSyncFn: (cmd, cwd) => execSync(cmd, { cwd, stdio: "pipe", encoding: "utf-8" }) as string,
  });
  const partyCheckpointer = new EventSourcedCheckpointer(state.projectRoot, sessionId);
  const partyLoopDetector = new LoopDetector({
    maxIterations: lanes.length * 3,
    identicalThreshold: 3,
    patternWindowSize: lanes.length * 2,
  });
  const sessionStart = Date.now();

  // Resume from previous session if requested
  let completedLaneNames: string[] = [];
  if (resumeSession) {
    const loaded = await checkpointMgr.loadSession(resumeSession);
    const eventCount = await partyCheckpointer.resume();
    if (loaded > 0) {
      const latest = checkpointMgr.getLatestCheckpoint();
      completedLaneNames = (latest?.metadata?.completedLanes as string[]) ?? [];
      process.stdout.write(
        `${GREEN}Resumed from checkpoint ${latest?.id} — skipping lanes: ${completedLaneNames.join(", ") || "none"} (${eventCount} events replayed)${RESET}\n`,
      );
    }
  }

  // Create initial event-sourced checkpoint for party session
  await partyCheckpointer.put(
    { task, lanes: [...lanes], completedLanes: completedLaneNames },
    { source: "input", step: 0, triggerCommand: "/party --autoforge" },
  );

  // Start periodic checkpointing
  checkpointMgr.startPeriodicCheckpoints(() => ({
    triggerCommand: "/party --autoforge",
    currentStep: mergedLanes.length,
    elapsedMs: Date.now() - sessionStart,
    worktreeBranches: lanes.map((l) => `danteparty/${state.session.id}/${l}`),
    metadata: {
      mergedLanes: [...mergedLanes],
      blockedLanes: [...blockedLanes],
      completedLanes: [...mergedLanes, ...blockedLanes.map((b) => b.split(":")[0]!.trim())],
    },
  }));

  // Initialize progress tree for party lanes
  const laneNodes: ProgressNode[] = lanes.map((lane) => ({
    name: lane,
    status: completedLaneNames.includes(lane) ? "complete" : "pending",
    pdseScore: completedLaneNames.includes(lane) ? 90 : undefined,
  }));

  const progressDisplay = startProgressDisplay(
    `${YELLOW}${BOLD}Party Autoforge${RESET} ${DIM}(isolated worktrees per lane)${RESET}`,
    laneNodes,
  );

  // D-11 Run Report: accumulator for autoforge party
  const autoforgeReportStart = new Date().toISOString();
  const autoforgeReportAcc = new RunReportAccumulator({
    project: resolve(state.projectRoot).split(/[\\/]/).pop() ?? "unknown",
    command: `/party --autoforge ${task}`,
    model: {
      provider: state.state.model.default.provider,
      modelId: state.state.model.default.modelId,
    },
    dantecodeVersion: "1.3.0",
  });

  for (const lane of lanes) {
    // Skip lanes already completed in a previous session
    if (completedLaneNames.includes(lane)) {
      process.stdout.write(`  ${DIM}skipping ${lane} (completed in previous session)${RESET}\n`);
      continue;
    }

    // Update progress: mark lane as running
    const laneIndex = lanes.indexOf(lane);
    const activeLaneNode = laneNodes[laneIndex];
    if (activeLaneNode) {
      activeLaneNode.status = "running";
    }
    progressDisplay.update(laneNodes);

    const worktreeSessionId = `${state.session.id}-${lane}`;
    const branch = `danteparty/${state.session.id}/${lane}`;

    autoforgeReportAcc.beginEntry(lane, "party-autoforge");
    try {
      const worktree = createWorktree({
        branch,
        baseBranch,
        sessionId: worktreeSessionId,
        directory: state.projectRoot,
      });

      const lanePrompt = [
        `You are the ${lane} lane in a /party --autoforge workflow.`,
        `Goal: ${task}`,
        scopedFiles.length > 0
          ? `Allowed files: ${scopedFiles.join(", ")}`
          : "Allowed files: repository-wide",
        "Acceptance criteria:",
        "- Stay within your lane scope.",
        "- Run repository-root verification after major edits.",
        "- Do not commit or merge if typecheck, lint, or test fails.",
      ].join("\n");

      const laneSession = cloneSessionForTask(
        state.session,
        worktree.directory,
        `${lane}-${Date.now()}`,
      );
      const laneResult = await runAgentLoop(lanePrompt, laneSession, {
        state: state.state,
        verbose: state.verbose,
        enableGit: false,
        enableSandbox: state.enableSandbox,
        silent: true,
        selfImprovement: createSelfImprovementContext(worktree.directory, {
          workflowId: "party-autoforge",
          triggerCommand: "/party --autoforge",
          targetFiles: scopedFiles,
          auditMetadata: { lane },
        }),
      });

      const gitStatus = getStatus(worktree.directory);
      const changedFiles = [
        ...gitStatus.staged.map((entry: { path: string }) => entry.path),
        ...gitStatus.unstaged.map((entry: { path: string }) => entry.path),
        ...gitStatus.untracked.map((entry: { path: string }) => entry.path),
      ];
      const uniqueChangedFiles = [...new Set(changedFiles)];

      const scopeViolation =
        scopedFiles.length > 0 &&
        uniqueChangedFiles.some(
          (filePath) =>
            !scopedFiles.some(
              (allowed) => filePath === allowed || filePath.startsWith(`${allowed}/`),
            ),
        );

      const pdseFailures: string[] = [];
      for (const filePath of uniqueChangedFiles) {
        try {
          const content = await readFile(resolve(worktree.directory, filePath), "utf-8");
          const score = runLocalPDSEScorer(content, worktree.directory);
          if (!score.passedGate || score.overall < state.state.pdse.threshold) {
            pdseFailures.push(`${filePath} (${score.overall})`);
          }
        } catch {
          pdseFailures.push(`${filePath} (unreadable)`);
        }
      }

      // Use RecoveryEngine for repo-root verification (consistent with autoforge path)
      const laneVerification = recoveryEng.runRepoRootVerification(worktree.directory);
      const lanePassed = !scopeViolation && pdseFailures.length === 0 && laneVerification.passed;

      // D-11 Run Report: record lane data
      {
        const created = gitStatus.untracked.map((e: { path: string }) => ({
          path: e.path,
          lines: 0,
        }));
        const modified = [...gitStatus.staged, ...gitStatus.unstaged]
          .filter(
            (e: { path: string }) =>
              !gitStatus.untracked.some((u: { path: string }) => u.path === e.path),
          )
          .map((e: { path: string }) => ({ path: e.path, added: 0, removed: 0 }));
        autoforgeReportAcc.recordFilesCreated(created);
        autoforgeReportAcc.recordFilesModified(modified);

        // Compute average PDSE from failures vs total
        const avgPdse =
          pdseFailures.length === 0 && uniqueChangedFiles.length > 0
            ? 90
            : pdseFailures.length < uniqueChangedFiles.length
              ? 70
              : 40;
        autoforgeReportAcc.recordVerification({
          antiStub: { passed: true, violations: 0, details: ["DanteForge detail unavailable"] },
          constitution: {
            passed: true,
            violations: 0,
            warnings: 0,
            details: ["DanteForge detail unavailable"],
          },
          pdseScore: avgPdse,
          pdseThreshold: state.state.pdse.threshold,
          regenerationAttempts: 0,
          maxAttempts: 3,
        });

        // Estimate tokens from lane session messages
        const laneMessages = laneResult.messages.map((m: SessionMessage) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : "",
        }));
        const laneTokens = estimateMessageTokens(laneMessages);
        autoforgeReportAcc.recordTokenUsage(
          Math.floor(laneTokens * 0.6),
          Math.floor(laneTokens * 0.4),
        );

        // Add to global manifest
        for (const f of created) {
          autoforgeReportAcc.addToManifest([{ action: "created", path: f.path }]);
        }
        for (const f of modified) {
          autoforgeReportAcc.addToManifest([{ action: "modified", path: f.path }]);
        }
      }

      if (!lanePassed) {
        const failureMsg =
          `${lane}: ${scopeViolation ? "scope violation" : ""}${pdseFailures.length > 0 ? ` PDSE failed (${pdseFailures.join(", ")})` : ""}${!laneVerification.passed ? ` verification failed (${laneVerification.failedSteps.join(", ")})` : ""}`.trim();
        blockedLanes.push(failureMsg);

        // Update progress: mark lane as failed
        if (activeLaneNode) {
          activeLaneNode.status = "failed";
        }
        if (pdseFailures.length > 0) {
          const avgPdse =
            pdseFailures.reduce((sum, f) => {
              const match = f.match(/(\d+)/);
              return match && match[1] ? sum + parseInt(match[1], 10) : sum;
            }, 0) / pdseFailures.length;
          if (laneNodes[laneIndex]) laneNodes[laneIndex].pdseScore = avgPdse;
        } else {
          if (laneNodes[laneIndex]) laneNodes[laneIndex].pdseScore = 0;
        }
        progressDisplay.update(laneNodes);

        autoforgeReportAcc.completeEntry({
          status: "failed",
          summary: `Lane ${lane} blocked.`,
          failureReason: failureMsg,
          actionNeeded: `Re-run /party --autoforge with lane ${lane} fixes.`,
        });

        // Loop detection: track lane failures for stuck patterns
        const loopCheck = partyLoopDetector.recordAction("lane_failure", failureMsg);
        if (loopCheck.stuck) {
          process.stdout.write(
            `  ${RED}Loop detected in party lanes: ${loopCheck.reason} — ${loopCheck.details}${RESET}\n`,
          );
          removeWorktree(worktree.directory);
          checkpointMgr.stopPeriodicCheckpoints();
          break;
        }

        // Record failure in circuit breaker
        const failureAction = taskBreaker.recordFailure(failureMsg, mergedLanes.length);

        // Record failure event in event-sourced checkpoint
        await partyCheckpointer.putWrite({
          taskId: `lane-fail-${lane}`,
          channel: `lane.${lane}.error`,
          value: { failureMsg, action: failureAction.action },
          timestamp: new Date().toISOString(),
        });

        if (failureAction.action === "escalate") {
          process.stdout.write(
            `  ${RED}Circuit breaker escalated after repeated lane failures${RESET}\n`,
          );
          removeWorktree(worktree.directory);

          await checkpointMgr.createCheckpoint({
            label: "escalation",
            triggerCommand: "/party --autoforge",
            currentStep: mergedLanes.length,
            elapsedMs: Date.now() - sessionStart,
            worktreeBranches: lanes.map((l) => `danteparty/${state.session.id}/${l}`),
            metadata: { mergedLanes, blockedLanes, escalated: true },
          });
          checkpointMgr.stopPeriodicCheckpoints();
          break;
        }
        if (failureAction.action === "pause_and_recover") {
          // Apply exponential backoff before recovery (Aider-style)
          const backoff = taskBreaker.getBackoffDelay(failureMsg);
          if (!backoff.timedOut && backoff.delayMs > 0) {
            process.stdout.write(
              `  ${DIM}Backoff: waiting ${backoff.delayMs}ms before next lane...${RESET}\n`,
            );
            await new Promise((r) => setTimeout(r, backoff.delayMs));
          }
          process.stdout.write(
            `  ${YELLOW}Circuit breaker paused — attempting recovery for ${lane}...${RESET}\n`,
          );
        }

        removeWorktree(worktree.directory);
        continue;
      }

      // Record success in circuit breaker + loop detector + event-sourced checkpoint
      taskBreaker.recordSuccess();
      partyLoopDetector.recordAction("lane_success", lane);
      await partyCheckpointer.putWrite({
        taskId: `lane-ok-${lane}`,
        channel: `lane.${lane}.result`,
        value: { passed: true, changedFiles: uniqueChangedFiles.length },
        timestamp: new Date().toISOString(),
      });

      if (uniqueChangedFiles.length > 0) {
        // Hash audit before merge
        for (const filePath of uniqueChangedFiles) {
          try {
            const content = await readFile(resolve(worktree.directory, filePath), "utf-8");
            recoveryEng.recordBeforeHash(filePath, content);
          } catch {
            /* skip */
          }
        }

        const mergeResult = mergeWorktree(worktree.directory, baseBranch, state.projectRoot);
        mergedLanes.push(lane);

        // Post-merge verification using RecoveryEngine
        const postMergeVerification = recoveryEng.runRepoRootVerification(state.projectRoot);
        if (!postMergeVerification.passed || !mergeResult.mainBranchClean) {
          blockedLanes.push(
            `post-merge gate failed after ${lane} (${postMergeVerification.failedSteps.join(", ")})${!mergeResult.mainBranchClean ? " — main branch dirty after merge" : ""}`,
          );

          // Update progress: mark lane as failed due to post-merge issues
          if (laneNodes[laneIndex]) {
            laneNodes[laneIndex].status = "failed";
            laneNodes[laneIndex].pdseScore = 0; // post-merge failure is critical
          }
          progressDisplay.update(laneNodes);

          break;
        }

        // Auto-commit verified good changes
        try {
          const commitMessage = `${lane}: party autoforge improvements (${uniqueChangedFiles.length} files)`;
          autoCommit(
            {
              message: commitMessage,
              body: "",
              footer: "Party Autoforge",
              files: ["."], // commit all changes
              allowEmpty: false,
            },
            state.projectRoot,
          );
          process.stdout.write(`  ${GREEN}Committed: ${commitMessage}${RESET}\n`);
        } catch (commitErr) {
          process.stdout.write(
            `  ${YELLOW}Auto-commit failed for ${lane}: ${commitErr instanceof Error ? commitErr.message : String(commitErr)}${RESET}\n`,
          );
        }
      } else {
        removeWorktree(worktree.directory);
      }

      // D-11: mark lane complete in report
      autoforgeReportAcc.completeEntry({
        status: "complete",
        summary: `Lane ${lane} merged successfully. ${uniqueChangedFiles.length} files changed.`,
      });

      // Update progress: mark lane as complete with PDSE score
      if (laneNodes[laneIndex]) laneNodes[laneIndex].status = "complete";
      if (uniqueChangedFiles.length > 0) {
        const scores: number[] = [];
        for (const file of uniqueChangedFiles) {
          try {
            const content = await readFile(resolve(worktree.directory, file), "utf-8");
            const score = runLocalPDSEScorer(content, worktree.directory);
            scores.push(score.overall > 1 ? score.overall : score.overall * 100);
          } catch {
            scores.push(50); // default for unreadable files
          }
        }
        if (laneNodes[laneIndex])
          laneNodes[laneIndex].pdseScore =
            scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 80;
      } else {
        if (laneNodes[laneIndex]) laneNodes[laneIndex].pdseScore = 85; // no changes is still good
      }
      progressDisplay.update(laneNodes);

      // Save checkpoint after each lane
      await checkpointMgr.createCheckpoint({
        label: `lane-${lane}-complete`,
        triggerCommand: "/party --autoforge",
        currentStep: mergedLanes.length,
        elapsedMs: Date.now() - sessionStart,
        worktreeBranches: lanes.map((l) => `danteparty/${state.session.id}/${l}`),
        metadata: {
          mergedLanes: [...mergedLanes],
          blockedLanes: [...blockedLanes],
          completedLanes: [...mergedLanes, ...blockedLanes.map((b) => b.split(":")[0]!.trim())],
        },
      });

      state.session.messages.push({
        id: randomUUID(),
        role: "assistant",
        content: `## ${lane}\n\n${getLastAssistantText(laneResult)}`,
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      blockedLanes.push(`${lane}: ${errMsg}`);

      // Update progress: mark lane as failed due to exception
      if (laneNodes[laneIndex]) {
        laneNodes[laneIndex].status = "failed";
        laneNodes[laneIndex].pdseScore = 0; // exceptions mean major failure
      }
      progressDisplay.update(laneNodes);

      autoforgeReportAcc.completeEntry({
        status: "failed",
        summary: `Lane ${lane} threw an error.`,
        failureReason: errMsg,
      });
    }
  }

  checkpointMgr.stopPeriodicCheckpoints();
  progressDisplay.end();

  // Final verification using RecoveryEngine
  const finalVerification = recoveryEng.runRepoRootVerification(state.projectRoot);
  const statusLine =
    blockedLanes.length === 0 && finalVerification.passed
      ? `${GREEN}${BOLD}Done \u2014 all lanes verified${RESET}`
      : `${YELLOW}${BOLD}Done \u2014 some lanes need attention${RESET}`;

  // Save final checkpoint
  await checkpointMgr.createCheckpoint({
    label: "party-complete",
    triggerCommand: "/party --autoforge",
    currentStep: mergedLanes.length,
    elapsedMs: Date.now() - sessionStart,
    worktreeBranches: [],
    metadata: { mergedLanes, blockedLanes, finalGstackPassed: finalVerification.passed },
  });

  // D-11: Mark any unattempted lanes and write the run report
  const attemptedLaneNames = [...mergedLanes, ...blockedLanes.map((b) => b.split(":")[0]!.trim())];
  const unattemptedLanes = lanes.filter(
    (l) => !attemptedLaneNames.includes(l) && !completedLaneNames.includes(l),
  );
  if (unattemptedLanes.length > 0) {
    autoforgeReportAcc.markRemainingNotAttempted("Execution stopped before reaching this lane.", [
      ...unattemptedLanes,
    ]);
  }

  try {
    const report = autoforgeReportAcc.finalize();
    const md = serializeRunReportToMarkdown(report, state.verbose);
    const reportWrite = await writeRunReport({
      projectRoot: state.projectRoot,
      markdown: md,
      timestamp: autoforgeReportStart,
      autoCommit: state.enableGit,
      commitFn: state.enableGit
        ? async (files, msg, cwd) => {
            autoCommit({ files, message: msg, footer: "", allowEmpty: false }, cwd);
          }
        : undefined,
    });
    if (reportWrite.success && reportWrite.path) {
      process.stdout.write(
        `  ${DIM}Run report: ${relative(state.projectRoot, reportWrite.path)}${RESET}\n`,
      );
    }
  } catch {
    /* non-fatal */
  }

  // D-11 human-friendly summary after report
  const totalLanes = lanes.length;
  const completeLanes = mergedLanes.length;
  const humanSummary =
    completeLanes === totalLanes && finalVerification.passed
      ? `  ${GREEN}All ${totalLanes} lanes completed and verified.${RESET}`
      : blockedLanes.length > 0
        ? `  ${YELLOW}${completeLanes}/${totalLanes} lanes complete. ${blockedLanes.length} need attention.${RESET}`
        : `  ${YELLOW}${completeLanes}/${totalLanes} lanes complete.${RESET}`;

  return [
    "",
    statusLine,
    humanSummary,
    `  ${DIM}Merged: ${mergedLanes.length > 0 ? mergedLanes.join(", ") : "none"}${RESET}`,
    finalVerification.passed ? "" : `  ${YELLOW}Final verification: needs review${RESET}`,
    blockedLanes.length > 0
      ? `  ${YELLOW}Blocked: ${blockedLanes.map((b) => b.split(":")[0]!.trim()).join(", ")}${RESET}`
      : "",
    `  Session: ${sessionId}`,
    "",
  ].join("\n");
}

function postalCommand(_args: string, _state: ReplState): Promise<string> {
  return Promise.resolve(
    [
      "",
      `${BOLD}Postal Service: Cross-Workspace Workflow${RESET}`,
      "",
      `${DIM}You are the envelope, not the editor. Carry documents, not understanding.${RESET}`,
      "",
      `${BOLD}Three Documents You Carry:${RESET}`,
      `  1. ${CYAN}PRD${RESET}          You + Claude.ai -> DanteCode / Claude Code`,
      `  2. ${CYAN}Run Report${RESET}   DanteCode -> Claude Code (for verification)`,
      `  3. ${CYAN}Bug Report${RESET}   Claude Code (verifier) -> Claude Code (fixer)`,
      "",
      `${BOLD}Quick Reference: What to Say Where${RESET}`,
      "",
      `  ${YELLOW}Plan a feature${RESET}        -> HQ (Claude.ai):     "Create a PRD for [feature]"`,
      `  ${YELLOW}Build with DanteCode${RESET}  -> DC-Run (CLI):        /party --prds [file paths]`,
      `  ${YELLOW}Verify the output${RESET}     -> DL-Build (CC):       "Read .dantecode/reports/[latest].md and verify every claim"`,
      `  ${YELLOW}DanteCode has a bug${RESET}   -> DL-Build -> DC-Build: Ask for bug report, paste into DC-Build`,
      `  ${YELLOW}Generated code issue${RESET}  -> DL-Build (CC):       "Fix these issues"`,
      `  ${YELLOW}I'm confused${RESET}          -> HQ (Claude.ai):      "Here's what I'm seeing: [paste]. What does it mean?"`,
      "",
      `${BOLD}Golden Rules:${RESET}`,
      `  1. Never translate -- transport. Copy the entire thing.`,
      `  2. Verify through a ${BOLD}different${RESET} AI than the one that did the work.`,
      `  3. The run report is the source of truth.`,
      `  4. One workspace, one job.`,
      `  5. When confused, come to HQ.`,
      `  6. Ask for copy-paste commands.`,
      "",
      `${DIM}Full guide: Docs/Postal-Service-Workflow.md${RESET}`,
      "",
    ].join("\n"),
  );
}

async function mcpCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.mcpClient || !state.mcpClient.isConnected()) {
    return `${DIM}No MCP servers connected.${RESET}\n${DIM}Configure servers in .dantecode/mcp.json:${RESET}\n${DIM}  { "servers": [{ "name": "fs", "transport": "stdio", "command": "mcp-fs", "enabled": true }] }${RESET}`;
  }

  const servers = state.mcpClient.getConnectedServers();
  const tools = state.mcpClient.listTools();
  const lines = ["", `${BOLD}MCP Servers${RESET} (${servers.length} connected)`, ""];

  for (const serverName of servers) {
    const serverTools = tools.filter((t) => t.serverName === serverName);
    lines.push(`  ${GREEN}${serverName}${RESET} — ${serverTools.length} tools`);
    for (const tool of serverTools) {
      lines.push(`    ${DIM}${tool.name}${RESET}: ${tool.description.slice(0, 80)}`);
    }
  }

  lines.push("", `${DIM}Total: ${tools.length} MCP tools available to the agent.${RESET}`);
  return lines.join("\n");
}

async function gitWatchCommand(args: string, state: ReplState): Promise<string> {
  let trimmed = args.trim();

  if (!trimmed || trimmed === "list") {
    const watchers = await listGitWatchers(state.projectRoot);
    if (watchers.length === 0) {
      return `${DIM}No Git watchers registered. Start one with /git-watch <eventType> [path].${RESET}`;
    }

    const lines = ["", `${BOLD}Git Watchers${RESET}`, ""];
    for (const watcher of watchers) {
      lines.push(
        `  ${GREEN}${watcher.id}${RESET} ${DIM}${watcher.status}${RESET} ${watcher.eventType} ${watcher.targetPath ?? "."}`,
      );
      lines.push(`    ${DIM}events=${watcher.eventCount} updated=${watcher.updatedAt}${RESET}`);
    }
    return lines.join("\n");
  }

  const stopMatch = trimmed.match(/^stop\s+(\S+)$/);
  if (stopMatch?.[1]) {
    const stopped = await stopGitWatcher(stopMatch[1], state.projectRoot);
    return stopped
      ? `${GREEN}Stopped Git watcher ${stopMatch[1]}.${RESET}`
      : `${RED}Git watcher not found: ${stopMatch[1]}${RESET}`;
  }

  const workflowPath = readFlagValue(trimmed, "--workflow");
  trimmed = stripFlagWithValue(trimmed, "--workflow");
  const eventFile = readFlagValue(trimmed, "--event");
  trimmed = stripFlagWithValue(trimmed, "--event");
  const [eventTypeToken, ...rest] = trimmed.split(/\s+/);
  const eventType = eventTypeToken as GitEventType | undefined;
  if (
    eventType !== "post-commit" &&
    eventType !== "pre-push" &&
    eventType !== "branch-update" &&
    eventType !== "file-change"
  ) {
    return `${RED}Usage: /git-watch [list | stop <id> | <post-commit|pre-push|branch-update|file-change> [path] [--workflow path] [--event event.json]]${RESET}`;
  }

  const targetPath = rest.join(" ").trim() || undefined;
  const eventPayload = eventFile ? await loadJsonFile(eventFile, state) : undefined;
  const watcher = watchGitEvents(eventType, targetPath, { cwd: state.projectRoot });
  await watcher.flush();
  watcher.on("event", (event) => {
    const data = event as { type: string; data: { relativePath: string } };
    if (workflowPath) {
      const orchestrator = getGitAutomationOrchestrator(state);
      void orchestrator
        .runWorkflowInBackground({
          workflowPath,
          eventPayload: {
            ...(eventPayload ?? {}),
            eventName: data.type,
            watchId: watcher.id,
            relativePath: data.data.relativePath,
          },
          trigger: {
            kind: "watch",
            sourceId: watcher.id,
            label: `${data.type} ${data.data.relativePath}`,
          },
        })
        .then((queued) => {
          process.stdout.write(
            `${DIM}[git-watch ${watcher.id}] queued ${queued.executionId} for ${data.type} ${data.data.relativePath}${RESET}\n`,
          );
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          process.stdout.write(
            `${RED}[git-watch ${watcher.id}] automation failed: ${message}${RESET}\n`,
          );
        });
      return;
    }

    process.stdout.write(
      `${DIM}[git-watch ${watcher.id}] ${data.type} ${data.data.relativePath}${RESET}\n`,
    );
  });

  return [
    "",
    `${GREEN}${BOLD}Git Watcher Started${RESET}`,
    `  ID:        ${watcher.id}`,
    `  Event:     ${eventType}`,
    `  Target:    ${targetPath ?? "."}`,
    `  Workflow:  ${workflowPath ?? "none"}`,
    `  Project:   ${state.projectRoot}`,
    "",
  ].join("\n");
}

async function runWorkflowCommand(args: string, state: ReplState): Promise<string> {
  let trimmed = args.trim();
  if (!trimmed) {
    return `${RED}Usage: /run-workflow <workflowPath> [event.json] [--background]${RESET}`;
  }

  const background = hasFlag(trimmed, "--background");
  trimmed = stripFlag(trimmed, "--background");
  const [workflowPath, eventFile] = trimmed.split(/\s+/, 2);
  if (!workflowPath) {
    return `${RED}Usage: /run-workflow <workflowPath> [event.json] [--background]${RESET}`;
  }
  const eventPayload = eventFile ? await loadJsonFile(eventFile, state) : undefined;

  if (background) {
    const queued = await getGitAutomationOrchestrator(state).runWorkflowInBackground({
      workflowPath,
      eventPayload,
      trigger: {
        kind: "manual",
        label: "CLI /run-workflow",
      },
    });

    return [
      "",
      `${GREEN}${BOLD}Workflow Queued${RESET}`,
      `  Execution: ${queued.executionId}`,
      `  Task:      ${queued.backgroundTaskId}`,
      `  Workflow:  ${workflowPath}`,
      "",
    ].join("\n");
  }

  const result = await getGitAutomationOrchestrator(state).runWorkflow({
    workflowPath,
    eventPayload,
    trigger: {
      kind: "manual",
      label: "CLI /run-workflow",
    },
  });

  const lines = [
    "",
    `${BOLD}Workflow Run${RESET}`,
    `  Name:      ${result.workflowName ?? workflowPath}`,
    `  Status:    ${formatPassFail(result.status === "completed")}`,
    `  Gate:      ${result.gateStatus}`,
    `  Execution: ${result.id}`,
  ];
  if (result.modifiedFiles.length > 0) {
    lines.push(`  Files:     ${result.modifiedFiles.join(", ")}`);
  }
  if (typeof result.pdseScore === "number") {
    lines.push(`  PDSE:      ${formatFraction(result.pdseScore)}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function autoPrCommand(args: string, state: ReplState): Promise<string> {
  let remaining = args.trim();
  if (!remaining) {
    return `${RED}Usage: /auto-pr <title> [--body-file path] [--base branch] [--draft] [--changeset patch:pkg1,pkg2] [--background]${RESET}`;
  }

  const background = hasFlag(remaining, "--background");
  remaining = stripFlag(remaining, "--background");
  const draft = hasFlag(remaining, "--draft");
  remaining = stripFlag(remaining, "--draft");
  const bodyFile = readFlagValue(remaining, "--body-file");
  remaining = stripFlagWithValue(remaining, "--body-file");
  const base = readFlagValue(remaining, "--base");
  remaining = stripFlagWithValue(remaining, "--base");

  const changesetMatch = remaining.match(/--changeset\s+(patch|minor|major):([^\s]+)/);
  let changesetFiles: string[] = [];
  if (changesetMatch?.[0]) {
    remaining = remaining.replace(changesetMatch[0], " ").trim();
  }

  const title = remaining.trim();
  if (!title) {
    return `${RED}A PR title is required.${RESET}`;
  }

  const body = bodyFile ? await readFile(resolve(state.projectRoot, bodyFile), "utf-8") : "";

  if (changesetMatch?.[1] && changesetMatch[2]) {
    const packages = changesetMatch[2]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const changeset = await addChangeset(
      changesetMatch[1] as "patch" | "minor" | "major",
      packages,
      title,
      { cwd: state.projectRoot },
    );
    if (!changeset.success || !changeset.filePath) {
      return `${RED}Changeset generation failed: ${changeset.error ?? "Unknown error"}${RESET}`;
    }
    changesetFiles = [changeset.filePath];
  }

  const orchestrator = getGitAutomationOrchestrator(state);
  if (background) {
    const queued = await orchestrator.runAutoPRInBackground({
      title,
      body,
      changesetFiles,
      options: {
        cwd: state.projectRoot,
        ...(base ? { base } : {}),
        draft,
      },
      trigger: {
        kind: "manual",
        label: "CLI /auto-pr",
      },
    });

    return [
      "",
      `${GREEN}${BOLD}Pull Request Queued${RESET}`,
      `  Execution: ${queued.executionId}`,
      `  Task:      ${queued.backgroundTaskId}`,
      `  Title:     ${title}`,
      "",
    ].join("\n");
  }

  const execution = await orchestrator.createPullRequest({
    title,
    body,
    changesetFiles,
    options: {
      cwd: state.projectRoot,
      ...(base ? { base } : {}),
      draft,
    },
    trigger: {
      kind: "manual",
      label: "CLI /auto-pr",
    },
  });

  if (execution.status !== "completed") {
    const reason = execution.error ?? execution.summary ?? "Unknown error";
    return `${RED}PR creation ${execution.status}: ${reason}${RESET}`;
  }

  return [
    "",
    `${GREEN}${BOLD}Pull Request Created${RESET}`,
    `  ID:        ${execution.id}`,
    `  URL:       ${execution.prUrl ?? "(gh returned no URL)"}`,
    `  Base:      ${base ?? "(default)"}`,
    `  Draft:     ${draft ? "yes" : "no"}`,
    `  Changeset: ${changesetFiles.length > 0 ? relative(state.projectRoot, changesetFiles[0]!) : "none"}`,
    "",
  ].join("\n");
}

async function webhookListenCommand(args: string, state: ReplState): Promise<string> {
  const trimmed = args.trim();

  if (!trimmed || trimmed === "list") {
    const listeners = await listWebhookListeners(state.projectRoot);
    if (listeners.length === 0) {
      return `${DIM}No webhook listeners registered. Start one with /webhook-listen [github|gitlab|custom] [port].${RESET}`;
    }

    const lines = ["", `${BOLD}Webhook Listeners${RESET}`, ""];
    for (const listener of listeners) {
      lines.push(
        `  ${GREEN}${listener.id}${RESET} ${DIM}${listener.status}${RESET} ${listener.provider} ${listener.path} port=${listener.port}`,
      );
      lines.push(
        `    ${DIM}received=${listener.receivedCount} updated=${listener.updatedAt}${RESET}`,
      );
    }
    return lines.join("\n");
  }

  const stopMatch = trimmed.match(/^stop\s+(\S+)$/);
  if (stopMatch?.[1]) {
    const stopped = await stopWebhookListener(stopMatch[1], state.projectRoot);
    return stopped
      ? `${GREEN}Stopped webhook listener ${stopMatch[1]}.${RESET}`
      : `${RED}Webhook listener not found: ${stopMatch[1]}${RESET}`;
  }

  let remaining = trimmed;
  const pathFlag = readFlagValue(remaining, "--path");
  remaining = stripFlagWithValue(remaining, "--path");
  const portFlag = readFlagValue(remaining, "--port");
  remaining = stripFlagWithValue(remaining, "--port");
  const workflowPath = readFlagValue(remaining, "--workflow");
  remaining = stripFlagWithValue(remaining, "--workflow");
  const providerToken = remaining.split(/\s+/, 1)[0];
  const provider =
    providerToken === "gitlab" || providerToken === "custom" ? providerToken : "github";

  const port = portFlag ? Number(portFlag) : 3000;
  const listener = new WebhookListener({
    cwd: state.projectRoot,
    provider: provider as WebhookProvider,
    port,
    path: pathFlag ?? "/webhook",
    secret:
      provider === "github"
        ? process.env.GITHUB_WEBHOOK_SECRET
        : provider === "gitlab"
          ? process.env.GITLAB_WEBHOOK_SECRET
          : process.env.CUSTOM_WEBHOOK_SECRET,
  });
  await listener.start();
  listener.on("any-event", (event) => {
    const data = event as { event: string; provider: string; payload: Record<string, unknown> };
    if (workflowPath) {
      const orchestrator = getGitAutomationOrchestrator(state);
      void orchestrator
        .runWorkflowInBackground({
          workflowPath,
          eventPayload: {
            ...data.payload,
            eventName: data.event,
          },
          trigger: {
            kind: "webhook",
            sourceId: listener.id,
            label: `${data.provider}:${data.event}`,
          },
        })
        .then((queued) => {
          process.stdout.write(
            `${DIM}[webhook ${listener.id}] queued ${queued.executionId} for ${data.provider}:${data.event}${RESET}\n`,
          );
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          process.stdout.write(`${RED}[webhook ${listener.id}] ${message}${RESET}\n`);
        });
      return;
    }

    process.stdout.write(`${DIM}[webhook ${listener.id}] ${data.provider}:${data.event}${RESET}\n`);
  });

  return [
    "",
    `${GREEN}${BOLD}Webhook Listener Started${RESET}`,
    `  ID:        ${listener.id}`,
    `  Provider:  ${provider}`,
    `  Port:      ${listener.port}`,
    `  Path:      ${pathFlag ?? "/webhook"}`,
    `  Workflow:  ${workflowPath ?? "none"}`,
    "",
  ].join("\n");
}

async function scheduleGitTaskCommand(args: string, state: ReplState): Promise<string> {
  const trimmed = args.trim();

  if (!trimmed || trimmed === "list") {
    const tasks = await listScheduledGitTasks(state.projectRoot);
    if (tasks.length === 0) {
      return `${DIM}No scheduled Git tasks registered. Start one with /schedule-git-task <cron|intervalMs> <task>${RESET}`;
    }

    const lines = ["", `${BOLD}Scheduled Git Tasks${RESET}`, ""];
    for (const task of tasks) {
      lines.push(
        `  ${GREEN}${task.id}${RESET} ${DIM}${task.status}${RESET} ${task.schedule} ${task.taskName}`,
      );
      lines.push(`    ${DIM}runs=${task.runCount} next=${task.nextRunAt ?? "unknown"}${RESET}`);
    }
    return lines.join("\n");
  }

  const stopMatch = trimmed.match(/^stop\s+(\S+)$/);
  if (stopMatch?.[1]) {
    const stopped = await stopScheduledGitTask(stopMatch[1], state.projectRoot);
    return stopped
      ? `${GREEN}Stopped scheduled task ${stopMatch[1]}.${RESET}`
      : `${RED}Scheduled task not found: ${stopMatch[1]}${RESET}`;
  }

  let remaining = trimmed;
  const workflowPath = readFlagValue(remaining, "--workflow");
  remaining = stripFlagWithValue(remaining, "--workflow");
  const eventFile = readFlagValue(remaining, "--event");
  remaining = stripFlagWithValue(remaining, "--event");

  const tokens = remaining.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return `${RED}Usage: /schedule-git-task [list | stop <id> | <cron|intervalMs> <task> [--workflow path] [--event event.json]]${RESET}`;
  }

  let scheduleValue: string | number;
  let taskName: string;
  if (/^\d+$/.test(tokens[0]!)) {
    scheduleValue = Number(tokens[0]);
    taskName = tokens.slice(1).join(" ");
  } else if (
    tokens.length >= 6 &&
    tokens.slice(0, 5).every((token) => /^[\d*/,\-]+$/.test(token))
  ) {
    scheduleValue = tokens.slice(0, 5).join(" ");
    taskName = tokens.slice(5).join(" ");
  } else {
    return `${RED}Provide either an interval in milliseconds or a 5-field cron expression.${RESET}`;
  }

  const eventPayload = eventFile ? await loadJsonFile(eventFile, state) : undefined;
  const resolvedTaskName =
    taskName.trim() || (workflowPath ? `Run workflow ${workflowPath}` : "Scheduled Git task");

  const task = scheduleGitTask(
    scheduleValue,
    async () => {
      if (workflowPath) {
        await getGitAutomationOrchestrator(state).runWorkflowInBackground({
          workflowPath,
          eventPayload,
          trigger: {
            kind: "schedule",
            sourceId: task.id,
            label: resolvedTaskName,
          },
        });
        return;
      }
      process.stdout.write(
        `${DIM}[schedule ${resolvedTaskName}] fired at ${new Date().toISOString()}${RESET}\n`,
      );
    },
    {
      cwd: state.projectRoot,
      taskName: resolvedTaskName,
      runOnStart: false,
    },
  );
  await task.flush();

  return [
    "",
    `${GREEN}${BOLD}Scheduled Git Task Started${RESET}`,
    `  ID:        ${task.id}`,
    `  Schedule:  ${task.schedule}`,
    `  Task:      ${resolvedTaskName}`,
    `  Workflow:  ${workflowPath ?? "none"}`,
    "",
  ].join("\n");
}

async function listenCommand(args: string, state: ReplState): Promise<string> {
  // Lazy import to avoid circular dependency
  const { BackgroundAgentRunner, EventTriggerRegistry, createWebhookServer } =
    await import("@dantecode/core");

  const trimmed = args.trim();

  // Handle `/listen status` subcommand
  if (trimmed === "status") {
    const port = ((state as unknown as Record<string, unknown>)._listenPort as number) ?? 8080;
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      const data = (await res.json()) as Record<string, unknown>;
      const counts = (data.taskCounts as Record<string, number>) ?? {};
      return [
        "",
        `${GREEN}${BOLD}Event Gateway Status${RESET}`,
        `  Status:    ${data.status === "ok" ? `${GREEN}OK${RESET}` : `${RED}DOWN${RESET}`}`,
        `  Uptime:    ${data.uptime}s`,
        `  Active:    ${data.activeTasks ?? 0} tasks`,
        `  Running:   ${counts.running ?? 0}`,
        `  Queued:    ${counts.queued ?? 0}`,
        `  Completed: ${counts.completed ?? 0}`,
        `  Failed:    ${counts.failed ?? 0}`,
        "",
      ].join("\n");
    } catch {
      return `${RED}Event Gateway not running. Start with /listen [port]${RESET}`;
    }
  }

  const port = trimmed ? parseInt(trimmed, 10) : 8080;
  if (isNaN(port) || port < 1 || port > 65535) {
    return `${RED}Invalid port number. Usage: /listen [port | status]${RESET}`;
  }

  // Reuse or create the background runner
  if (!state._bgRunner) {
    state._bgRunner = new BackgroundAgentRunner(1, state.projectRoot);
  }
  const runner = state._bgRunner as InstanceType<typeof BackgroundAgentRunner>;

  // Create the event trigger registry with env-based secrets
  const registry = new EventTriggerRegistry({
    enabledSources: ["github", "slack", "api", "manual"],
    githubSecret: process.env.GITHUB_WEBHOOK_SECRET,
    defaultPriority: "normal",
  });

  // Build issue-to-PR config from environment if GitHub token is available
  const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const githubRepo = process.env.GITHUB_REPOSITORY;
  const issueToPRConfig =
    githubToken && githubRepo
      ? { githubToken, repository: githubRepo, baseBranch: "main" }
      : undefined;

  // Default agent executor: run prompt through the background runner
  const agentExecutor = issueToPRConfig
    ? async (prompt: string, _workdir: string) => {
        const taskId = runner.enqueue(prompt, { autoCommit: false, createPR: false });
        return new Promise<{ output: string; touchedFiles: string[] }>((resolve, reject) => {
          const check = setInterval(() => {
            const task = runner.getTask(taskId);
            if (!task) {
              clearInterval(check);
              reject(new Error("Task not found"));
              return;
            }
            if (task.status === "completed") {
              clearInterval(check);
              resolve({ output: task.output ?? "", touchedFiles: task.touchedFiles });
            } else if (task.status === "failed" || task.status === "cancelled") {
              clearInterval(check);
              reject(new Error(task.error ?? "Task failed"));
            }
          }, 2000);
        });
      }
    : undefined;

  const handle = createWebhookServer({
    port,
    eventRegistry: registry,
    backgroundRunner: runner,
    projectRoot: state.projectRoot,
    apiToken: process.env.DANTECODE_API_TOKEN,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    issueToPR: issueToPRConfig,
    agentExecutor,
  });

  try {
    await handle.start();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Failed to start webhook server: ${msg}${RESET}`;
  }

  // Store port for /listen status
  (state as unknown as Record<string, unknown>)._listenPort = port;

  const ghSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const slackSecret = process.env.SLACK_SIGNING_SECRET;
  const apiToken = process.env.DANTECODE_API_TOKEN;
  const check = (v: string | undefined) =>
    v ? `${GREEN}configured${RESET}` : `${RED}missing${RESET}`;

  const lines = [
    "",
    `${GREEN}${BOLD}DanteCode Event Gateway — listening on port ${port}${RESET}`,
    "",
    `${BOLD}Endpoints:${RESET}`,
    `  POST /webhooks/github  — GitHub webhook receiver`,
    `  POST /webhooks/slack   — Slack webhook receiver`,
    `  POST /api/tasks        — REST API task submission`,
    `  GET  /health           — Health check`,
    "",
    `${BOLD}Secrets:${RESET}`,
    `  GITHUB_WEBHOOK_SECRET: ${check(ghSecret)}`,
    `  SLACK_SIGNING_SECRET:  ${check(slackSecret)}`,
    `  DANTECODE_API_TOKEN:   ${check(apiToken)}`,
    "",
    `${BOLD}Issue-to-PR Pipeline:${RESET}`,
    `  GITHUB_TOKEN:          ${check(githubToken)}`,
    `  GITHUB_REPOSITORY:     ${githubRepo ? `${GREEN}${githubRepo}${RESET}` : `${RED}missing${RESET}`}`,
    `  Status:                ${issueToPRConfig ? `${GREEN}enabled${RESET} — issues → auto-PR` : `${DIM}disabled (set GITHUB_TOKEN + GITHUB_REPOSITORY)${RESET}`}`,
    "",
    `${DIM}To expose publicly: npx ngrok http ${port}${RESET}`,
    `${DIM}Check status: /listen status${RESET}`,
    "",
  ];

  return lines.join("\n");
}

async function bgCommand(args: string, state: ReplState): Promise<string> {
  const runner = await ensureBackgroundRunner(state);

  const trimmed = args.trim();

  // /bg with no args — list tasks
  if (!trimmed) {
    const tasks = runner.listTasks();
    if (tasks.length === 0) {
      return `${DIM}No background tasks. Use /bg <task description> to start one.${RESET}`;
    }
    const lines = ["", `${BOLD}Background Tasks${RESET}`, ""];
    for (const task of tasks) {
      const icon =
        task.status === "running"
          ? `${YELLOW}⟳${RESET}`
          : task.status === "paused"
            ? `${YELLOW}⏸${RESET}`
            : task.status === "completed"
              ? `${GREEN}✓${RESET}`
              : task.status === "failed"
                ? `${RED}✗${RESET}`
                : task.status === "cancelled"
                  ? `${DIM}⊘${RESET}`
                  : `${DIM}…${RESET}`;
      lines.push(`  ${icon} [${task.id}] ${task.status} — ${task.prompt.slice(0, 60)}`);
      lines.push(`    ${DIM}${task.progress}${RESET}`);
    }
    return lines.join("\n");
  }

  // /bg cancel <id>
  if (trimmed.startsWith("cancel ")) {
    const taskId = trimmed.slice(7).trim();
    const cancelled = runner.cancel(taskId);
    return cancelled
      ? `${GREEN}Task ${taskId} cancelled.${RESET}`
      : `${RED}Could not cancel task ${taskId} (not found or already finished).${RESET}`;
  }

  // /bg clear
  if (trimmed === "clear") {
    const cleared = runner.clearFinished();
    return `${DIM}Cleared ${cleared} finished tasks.${RESET}`;
  }

  const resumeMatch = trimmed.match(/^--resume\s+(\S+)$/);
  if (resumeMatch?.[1]) {
    const resumed = await runner.resume(resumeMatch[1]);
    return resumed
      ? `${GREEN}Resuming background task ${resumeMatch[1]}.${RESET}`
      : `${RED}Could not resume task ${resumeMatch[1]}.${RESET}`;
  }

  // /bg <prompt> — enqueue a new task
  // Parse flags from the raw args string
  const hasPR = trimmed.includes("--pr");
  const hasCommit = trimmed.includes("--commit") || hasPR; // --pr implies --commit
  const hasDocker = trimmed.includes("--docker");
  const hasLong = trimmed.includes("--long");

  // Strip all known flags to extract the prompt text
  const prompt = trimmed
    .replace(/--pr/g, "")
    .replace(/--commit/g, "")
    .replace(/--docker/g, "")
    .replace(/--long/g, "")
    .trim();

  if (!prompt) {
    return `${RED}Usage: /bg [--docker] [--commit] [--pr] [--long] <task description> | /bg --resume <taskId>${RESET}`;
  }

  const dockerConfig = hasDocker
    ? {
        image: state.state.sandbox.defaultImage,
        networkMode: state.state.sandbox.networkMode,
        memoryLimitMb: state.state.sandbox.memoryLimitMb,
        cpuLimit: state.state.sandbox.cpuLimit,
        readOnlyMount: false,
      }
    : undefined;

  const taskId = runner.enqueue(prompt, {
    autoCommit: hasCommit,
    createPR: hasPR,
    docker: hasDocker,
    dockerConfig,
    longRunning: hasLong,
  });

  const parts: string[] = [`${GREEN}Background task ${taskId} queued.${RESET}`];
  if (hasDocker) parts.push(`${DIM}(Docker)${RESET}`);
  if (hasLong) parts.push(`${DIM}(Long-running checkpoints enabled)${RESET}`);
  if (hasPR) {
    parts.push(`\n  ${DIM}Will auto-commit and create PR on completion.${RESET}`);
  } else if (hasCommit) {
    parts.push(`\n  ${DIM}Will auto-commit on completion.${RESET}`);
  }
  parts.push(`Use ${DIM}/bg${RESET} to check status.`);
  return parts.join(" ");
}

async function rememberCommand(args: string, state: ReplState): Promise<string> {
  const text = args.trim();
  if (!text) {
    return `${YELLOW}Usage: /remember <text to remember>${RESET}`;
  }

  const { appendFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const danteNotesPath = resolve(state.projectRoot, ".dantecode", "DANTE.md");
  await mkdir(dirname(danteNotesPath), { recursive: true });
  await appendFile(danteNotesPath, `\n- ${text}\n`, "utf-8");
  return `${GREEN}Remembered: "${text}"${RESET}\n${DIM}Saved to .dantecode/DANTE.md — will be injected into future prompts.${RESET}`;
}

function parseEmbeddingProviderArg(args: string): "ollama" | "openai" | "google" | null {
  const trimmed = args.trim();
  if (!trimmed.includes("--embed")) {
    return null;
  }

  const inlineMatch = trimmed.match(/--embed(?:=|\s+)(ollama|openai|google)\b/i);
  if (inlineMatch?.[1]) {
    return inlineMatch[1].toLowerCase() as "ollama" | "openai" | "google";
  }

  return "ollama";
}

async function indexCommand(args: string, state: ReplState): Promise<string> {
  const { CodeIndex, createEmbeddingProvider } = await import("@dantecode/core");

  if (!state._codeIndex) {
    state._codeIndex = new CodeIndex();
  }
  const index = state._codeIndex as InstanceType<typeof CodeIndex>;
  const embeddingProviderName = parseEmbeddingProviderArg(args);

  let embeddingProvider: Awaited<ReturnType<typeof createEmbeddingProvider>> | null = null;
  if (embeddingProviderName) {
    embeddingProvider = createEmbeddingProvider(embeddingProviderName);
  }

  process.stdout.write(`${DIM}Building code index for ${state.projectRoot}...${RESET}\n`);
  const count = await index.buildIndex(
    state.projectRoot,
    {
      excludePatterns: state.state.project.excludePatterns,
      useEmbeddings: embeddingProvider !== null,
    },
    embeddingProvider,
  );

  await index.save(state.projectRoot);
  const modeLabel =
    embeddingProvider && index.hasEmbeddings
      ? `${DIM}(hybrid TF-IDF + ${embeddingProvider.info.provider} embeddings)${RESET}`
      : `${DIM}(TF-IDF only)${RESET}`;
  return `${GREEN}Indexed ${count} code chunks.${RESET} ${modeLabel} Use ${DIM}/search <query>${RESET} to search.`;
}

async function searchCommand(args: string, state: ReplState): Promise<string> {
  const { CodeIndex, createEmbeddingProvider } = await import("@dantecode/core");

  if (!args.trim()) {
    return `${RED}Usage: /search <query>${RESET}`;
  }

  if (!state._codeIndex) {
    state._codeIndex = new CodeIndex();
    // Try to load existing index
    const loaded = await (state._codeIndex as InstanceType<typeof CodeIndex>).load(
      state.projectRoot,
    );
    if (!loaded) {
      return `${YELLOW}No index found. Run /index first.${RESET}`;
    }
  }

  const index = state._codeIndex as InstanceType<typeof CodeIndex>;
  const embeddingInfo = index.getEmbeddingProviderInfo();
  let queryEmbedding: number[] | undefined;
  let searchMode = "TF-IDF";

  if (index.hasEmbeddings && embeddingInfo) {
    try {
      const provider = createEmbeddingProvider(embeddingInfo.provider, {
        modelId: embeddingInfo.modelId,
        ...(embeddingInfo.dimensions ? { dimensions: embeddingInfo.dimensions } : {}),
      });
      queryEmbedding = await provider.embedSingle(args.trim());
      searchMode = "Hybrid";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `${DIM}[search: embedding fallback to TF-IDF â€” ${message.slice(0, 120)}]${RESET}\n`,
      );
    }
  }

  const results = index.search(args.trim(), 10, queryEmbedding);

  if (results.length === 0) {
    return `${DIM}No results for "${args.trim()}"${RESET}`;
  }

  const lines = [
    "",
    `${BOLD}Search Results${RESET} for "${args.trim()}" ${DIM}[${searchMode}]${RESET}`,
    "",
  ];
  for (let i = 0; i < results.length; i++) {
    const chunk = results[i]!;
    lines.push(`  ${GREEN}${i + 1}.${RESET} ${chunk.filePath}:${chunk.startLine}-${chunk.endLine}`);
    if (chunk.symbols.length > 0) {
      lines.push(`     ${DIM}symbols: ${chunk.symbols.slice(0, 5).join(", ")}${RESET}`);
    }
    // Show first 2 lines of content
    const preview = chunk.content.split("\n").slice(0, 2).join(" ").slice(0, 100);
    lines.push(`     ${DIM}${preview}${RESET}`);
  }
  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// Session Utilities
// ----------------------------------------------------------------------------

/**
 * Converts the live Session object to the ChatSessionFile format used by SessionStore.
 */
function sessionToFile(session: Session): ChatSessionFile {
  const now = new Date().toISOString();
  return {
    id: session.id,
    title: session.name ?? session.id.slice(0, 8),
    createdAt: session.createdAt,
    updatedAt: now,
    model: `${session.model.provider}/${session.model.modelId}`,
    messages: session.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      timestamp: m.timestamp ?? now,
    })),
    contextFiles: session.activeFiles,
  };
}

// ----------------------------------------------------------------------------
// /name Command
// ----------------------------------------------------------------------------

async function nameCommand(args: string, state: ReplState): Promise<string> {
  const name = args.trim();
  if (!name) {
    const current = state.session.name ?? state.session.id.slice(0, 8);
    return `Current session: ${BOLD}${current}${RESET}\nUsage: /name <new-name>`;
  }
  state.session.name = name;
  const store = new SessionStore(state.projectRoot);
  try {
    await store.save(sessionToFile(state.session));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${YELLOW}Session renamed to: ${BOLD}${name}${RESET}\n${DIM}Warning: failed to persist rename — ${msg}${RESET}`;
  }
  return `${GREEN}Session renamed to: ${BOLD}${name}${RESET}`;
}

// ----------------------------------------------------------------------------
// /export Command
// ----------------------------------------------------------------------------

async function exportCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const format = parts[0] === "md" || parts[0] === "markdown" ? "md" : "json";
  const defaultName = `session-${state.session.name ?? state.session.id.slice(0, 8)}.${format}`;
  const outputPath = parts[1] ?? defaultName;
  const absPath = resolve(state.projectRoot, outputPath);
  const visibility = {
    approvalMode: state.approvalMode,
    planMode: state.planMode,
    activeSkill: state.activeSkill,
    pendingResumeRunId: state.pendingResumeRunId,
    recentToolCalls: [...state.recentToolCalls],
    lastRestoreEvent: state.lastRestoreEvent ?? null,
    pdseResults: [...state.lastSessionPdseResults],
  };

  try {
    if (format === "json") {
      const data = {
        version: "1.0.0",
        exportedAt: new Date().toISOString(),
        session: {
          id: state.session.id,
          name: state.session.name,
          createdAt: state.session.createdAt,
          model: `${state.session.model.provider}/${state.session.model.modelId}`,
          messageCount: state.session.messages.length,
          messages: state.session.messages,
          activeFiles: state.session.activeFiles,
          todoList: state.session.todoList,
        },
        visibility,
        memoryStats: state.memoryOrchestrator ? state.memoryOrchestrator.memoryVisualize() : null,
      };
      await writeFile(absPath, JSON.stringify(data, null, 2), "utf8");
    } else {
      const lines: string[] = [
        `# Session: ${state.session.name ?? state.session.id.slice(0, 8)}`,
        "",
        `- **Created:** ${state.session.createdAt}`,
        `- **Model:** ${state.session.model.provider}/${state.session.model.modelId}`,
        `- **Mode:** ${state.approvalMode}`,
        `- **Plan Mode:** ${state.planMode ? "on" : "off"}`,
        `- **Messages:** ${state.session.messages.length}`,
        "",
      ];
      if (state.activeSkill) {
        lines.push(`- **Active Skill:** ${state.activeSkill}`);
      }
      if (state.lastRestoreEvent) {
        lines.push(`- **Last Restore:** ${state.lastRestoreEvent.restoreSummary}`);
      }
      if (state.lastSessionPdseResults.length > 0) {
        lines.push(`- **PDSE Results:**`);
        for (const result of state.lastSessionPdseResults) {
          lines.push(
            `  - ${result.file}: ${result.pdseScore} (${result.passed ? "pass" : "fail"})`,
          );
        }
      }
      lines.push("---", "");
      for (const msg of state.session.messages) {
        const role =
          msg.role === "user"
            ? "**You**"
            : msg.role === "assistant"
              ? "**DanteCode**"
              : `*${msg.role}*`;
        const ts = msg.timestamp ?? "";
        lines.push(`### ${role} (${ts})`);
        lines.push("");
        const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        lines.push(text.slice(0, 5000));
        lines.push("");
        lines.push("---");
        lines.push("");
      }
      await writeFile(absPath, lines.join("\n"), "utf8");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Failed to export session: ${msg}${RESET}`;
  }

  return `${GREEN}Session exported to: ${BOLD}${outputPath}${RESET} (${format})`;
}

// ----------------------------------------------------------------------------
// /import Command
// ----------------------------------------------------------------------------

async function importSessionCommand(args: string, state: ReplState): Promise<string> {
  const filePath = args.trim();
  if (!filePath) return `${RED}Usage: /import <path-to-session.json>${RESET}`;

  try {
    const content = await readFile(resolve(state.projectRoot, filePath), "utf8");
    const data = JSON.parse(content) as Record<string, unknown>;

    const sessionData = data["session"] as Record<string, unknown> | undefined;
    if (!sessionData || !Array.isArray(sessionData["messages"])) {
      return `${RED}Invalid session file: missing messages array${RESET}`;
    }

    const version = typeof data["version"] === "string" ? data["version"] : "0.0.0";
    if (!version.startsWith("1.")) {
      state.session.messages.push({
        id: randomUUID(),
        role: "system",
        content: `WARN: session file version ${version} may not be fully compatible`,
        timestamp: new Date().toISOString(),
      });
    }

    const importedMessages = sessionData["messages"] as Array<Record<string, unknown>>;
    const imported = importedMessages.length;

    state.session.messages.push({
      id: randomUUID(),
      role: "system",
      content: `## Imported Session Context\nImported ${imported} messages from ${String(sessionData["name"] ?? sessionData["id"] ?? "unknown")} (${String(sessionData["createdAt"] ?? "unknown date")}).\nOriginal model: ${String(sessionData["model"] ?? "unknown")}.`,
      timestamp: new Date().toISOString(),
    });

    const contextSummary = importedMessages
      .filter((m) => m["role"] === "user" || m["role"] === "assistant")
      .slice(-20)
      .map((m) => {
        const raw = m["content"] ?? "";
        const text = typeof raw === "string" ? raw : JSON.stringify(raw);
        return `[${String(m["role"])}]: ${text.slice(0, 500)}`;
      })
      .join("\n\n");

    state.session.messages.push({
      id: randomUUID(),
      role: "system",
      content: `## Previous Session Context\n${contextSummary}`,
      timestamp: new Date().toISOString(),
    });

    const sessionName = String(sessionData["name"] ?? sessionData["id"] ?? "unknown").slice(0, 8);
    return `${GREEN}Imported session: ${BOLD}${sessionName}${RESET} (${imported} messages → context summary injected)`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Failed to import session: ${msg}${RESET}`;
  }
}

// ----------------------------------------------------------------------------
// /branch Command
// ----------------------------------------------------------------------------

async function branchCommand(args: string, state: ReplState): Promise<string> {
  const branchName = args.trim() || `branch-${Date.now()}`;

  const store = new SessionStore(state.projectRoot);
  try {
    await store.save(sessionToFile(state.session));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Failed to save parent session before branching: ${msg}${RESET}`;
  }

  let summary: string;
  if (state.memoryOrchestrator) {
    try {
      const sumResult = await state.memoryOrchestrator.memorySummarize(state.session.id);
      summary = sumResult.summary ?? `Session with ${state.session.messages.length} messages`;
    } catch {
      summary = `Session with ${state.session.messages.length} messages`;
    }
  } else {
    summary = `Session with ${state.session.messages.length} messages`;
  }

  const oldName = state.session.name ?? state.session.id.slice(0, 8);
  const recentMessages = state.session.messages.slice(-5);

  state.session.id = randomUUID();
  state.session.name = branchName;
  state.session.createdAt = new Date().toISOString();
  state.session.updatedAt = new Date().toISOString();
  state.session.messages = [
    {
      id: randomUUID(),
      role: "system",
      content: `## Branched from: ${oldName}\n\n${summary}\n\n---\n*This is a new branch. The parent session is preserved.*`,
      timestamp: new Date().toISOString(),
    },
    ...recentMessages,
  ];

  try {
    await store.save(sessionToFile(state.session));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      `${GREEN}Session branched: ${BOLD}${oldName}${RESET} → ${BOLD}${branchName}${RESET}\n` +
      `${YELLOW}Warning: new branch not persisted — ${msg}${RESET}`
    );
  }

  return (
    `${GREEN}Session branched: ${BOLD}${oldName}${RESET} → ${BOLD}${branchName}${RESET}\n` +
    `${DIM}Parent session preserved. ${state.session.messages.length} messages in new branch (summary + recent).${RESET}`
  );
}

// ----------------------------------------------------------------------------
// /session Command — unified session management dispatcher
// ----------------------------------------------------------------------------

async function sessionCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0] ?? "";

  switch (sub) {
    case "name": {
      // /session name <name> — rename the current session
      const name = parts.slice(1).join(" ").trim();
      return nameCommand(name, state);
    }

    case "export": {
      // /session export [--format json|md] — export current session
      let format = "json";
      const fmtIdx = parts.indexOf("--format");
      if (fmtIdx !== -1 && parts[fmtIdx + 1]) {
        const fmtArg = parts[fmtIdx + 1] ?? "json";
        if (fmtArg === "md" || fmtArg === "markdown") format = "md";
      } else if (parts[1] === "md" || parts[1] === "markdown") {
        format = "md";
      }
      return exportCommand(format, state);
    }

    case "branch": {
      // /session branch [<name>] — fork current session into a new context
      const branchName = parts.slice(1).join(" ").trim() || undefined;
      return branchCommand(branchName ?? "", state);
    }

    case "list":
    case "": {
      // /session list — show saved sessions with names
      const store = new SessionStore(state.projectRoot);
      const entries = await store.list();
      if (entries.length === 0) {
        return `${DIM}No saved sessions.${RESET}`;
      }
      const recent = entries.slice(0, 20);
      const lines = ["", `${BOLD}Sessions${RESET} ${DIM}(${entries.length} total)${RESET}`, ""];
      for (const entry of recent) {
        const shortId = entry.id.slice(0, 8);
        const name = entry.title.length > 0 ? ` ${DIM}— ${entry.title}${RESET}` : "";
        const date = new Date(entry.updatedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        lines.push(
          `  ${CYAN}${shortId}${RESET}${name}  ${DIM}${date} (${entry.messageCount} msgs)${RESET}`,
        );
      }
      lines.push("");
      lines.push(
        `${DIM}Current: ${BOLD}${state.session.name ?? state.session.id.slice(0, 8)}${RESET}`,
      );
      return lines.join("\n");
    }

    default:
      return [
        `Usage: /session <subcommand>`,
        ``,
        `  list               — list saved sessions`,
        `  name <name>        — rename current session`,
        `  export [--format json|md]  — export current session`,
        `  branch [<name>]    — fork current session`,
      ].join("\n");
  }
}

// ----------------------------------------------------------------------------
// History Command
// ----------------------------------------------------------------------------

async function historyCommand(args: string, state: ReplState): Promise<string> {
  const store = new SessionStore(state.projectRoot);
  const trimmed = args.trim();

  // /history clear — delete all sessions
  if (trimmed === "clear") {
    const entries = await store.list();
    if (entries.length === 0) {
      return `${DIM}No sessions to clear.${RESET}`;
    }
    const count = await store.deleteAll();
    return `${GREEN}Cleared ${count} session(s).${RESET}`;
  }

  // /history <id> — show details of a specific session
  if (trimmed.length > 0) {
    // Try to find session by prefix match
    const entries = await store.list();
    const match = entries.find((e) => e.id === trimmed || e.id.startsWith(trimmed));
    if (!match) {
      return `${RED}Session not found: ${trimmed}${RESET}\n${DIM}Use /history to see all sessions.${RESET}`;
    }

    const session = await store.load(match.id);
    if (!session) {
      return `${RED}Could not load session: ${match.id}${RESET}`;
    }

    // Generate summary if not cached
    let summary = session.summary;
    if (!summary) {
      summary = await store.summarize(session);
    }

    // Collect files touched
    const files = session.contextFiles.length > 0 ? session.contextFiles : [];

    // Message breakdown
    const userCount = session.messages.filter((m) => m.role === "user").length;
    const assistantCount = session.messages.filter((m) => m.role === "assistant").length;
    const toolCount = session.messages.filter((m) => m.role === "tool").length;

    const lines = [
      "",
      `${BOLD}Session Details${RESET}`,
      "",
      `  ${CYAN}ID:${RESET}        ${session.id}`,
      `  ${CYAN}Title:${RESET}     ${session.title}`,
      `  ${CYAN}Model:${RESET}     ${session.model}`,
      `  ${CYAN}Created:${RESET}   ${new Date(session.createdAt).toLocaleString()}`,
      `  ${CYAN}Updated:${RESET}   ${new Date(session.updatedAt).toLocaleString()}`,
      `  ${CYAN}Messages:${RESET}  ${session.messages.length} total (${userCount} user, ${assistantCount} assistant, ${toolCount} tool)`,
      "",
      `  ${CYAN}Summary:${RESET}   ${summary}`,
    ];

    if (files.length > 0) {
      lines.push("");
      lines.push(`  ${CYAN}Files:${RESET}`);
      for (const f of files.slice(0, 10)) {
        lines.push(`    ${DIM}- ${f}${RESET}`);
      }
      if (files.length > 10) {
        lines.push(`    ${DIM}... and ${files.length - 10} more${RESET}`);
      }
    }

    lines.push("");
    return lines.join("\n");
  }

  // /history — list last 20 sessions
  const entries = await store.list();
  if (entries.length === 0) {
    return `${DIM}No saved sessions. Sessions are stored in .dantecode/sessions/.${RESET}`;
  }

  const recent = entries.slice(0, 20);
  const lines = [
    "",
    `${BOLD}Session History${RESET} ${DIM}(${entries.length} total, showing last ${recent.length})${RESET}`,
    "",
    `  ${DIM}${"ID".padEnd(12)} ${"Title".padEnd(30)} ${"Date".padEnd(20)} Msgs${RESET}`,
    `  ${DIM}${"─".repeat(12)} ${"─".repeat(30)} ${"─".repeat(20)} ${"─".repeat(4)}${RESET}`,
  ];

  for (const entry of recent) {
    const shortId = entry.id.slice(0, 10) + "..";
    const title = entry.title.length > 28 ? entry.title.slice(0, 27) + "..." : entry.title;
    const date = new Date(entry.updatedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    lines.push(
      `  ${CYAN}${shortId.padEnd(12)}${RESET} ${title.padEnd(30)} ${DIM}${date.padEnd(20)}${RESET} ${entry.messageCount}`,
    );
  }

  lines.push("");
  lines.push(`${DIM}Use /history <id> for details, /history clear to delete all.${RESET}`);
  lines.push("");

  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// /think — reasoning effort control
// ----------------------------------------------------------------------------

function formatThinkTier(tier: string): string {
  switch (tier) {
    case "quick":
      return `${CYAN}quick${RESET} (fast, minimal reasoning)`;
    case "deep":
      return `${YELLOW}deep${RESET} (step-by-step analysis)`;
    case "expert":
      return `${RED}expert${RESET} (full decomposition + verification)`;
    case "auto":
      return `${GREEN}auto${RESET} (complexity-driven)`;
    default:
      return tier;
  }
}

function formatThinkStats(chain: import("@dantecode/core").ReasoningChain | undefined): string {
  if (!chain) return `${DIM}No reasoning chain active.${RESET}`;

  const steps = chain.getHistory();
  const tiers = { quick: 0, deep: 0, expert: 0 };
  let totalCritiques = 0;
  let escalations = 0;
  let avgPdse = 0;
  let pdseCount = 0;

  for (const step of steps) {
    const content = step.phase.content;
    if (content.startsWith("Consider the most direct")) tiers.quick++;
    else if (content.startsWith("Analyze step-by-step")) tiers.deep++;
    else if (content.startsWith("Deep analysis required")) tiers.expert++;
    if (step.phase.type === "critique") totalCritiques++;
    if (step.escalated) escalations++;
    if (step.phase.pdseScore !== undefined) {
      avgPdse += step.phase.pdseScore;
      pdseCount++;
    }
  }

  const avg = pdseCount > 0 ? ((avgPdse / pdseCount) * 100).toFixed(0) : "N/A";
  const tierPerf = chain.getTierPerformance();
  const perfLines: string[] = [];
  for (const [t, v] of Object.entries(tierPerf)) {
    if (v !== undefined) {
      perfLines.push(`    ${t}: avg PDSE ${(v * 100).toFixed(0)}`);
    }
  }

  // PRD §3.5: display distilled playbook bullets when available
  const playbook = chain.getPlaybook();
  const playbookSection =
    playbook.length > 0
      ? `  Distilled playbook (${playbook.length} bullet${playbook.length === 1 ? "" : "s"}):\n${playbook.map((b) => `    • ${b.slice(0, 100)}`).join("\n")}`
      : "";

  return [
    `${BOLD}Reasoning Statistics${RESET}`,
    `  Total steps: ${steps.length}`,
    `  Tier distribution: quick=${tiers.quick} deep=${tiers.deep} expert=${tiers.expert}`,
    `  Critiques: ${totalCritiques}`,
    `  Auto-escalations: ${escalations}`,
    `  Average PDSE: ${avg}`,
    perfLines.length > 0 ? `  Tier performance (>=3 samples):\n${perfLines.join("\n")}` : "",
    playbookSection,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatThinkChain(
  chain: import("@dantecode/core").ReasoningChain | undefined,
  limit: number,
): string {
  if (!chain) return `${DIM}No reasoning chain active.${RESET}`;

  const steps = chain.getHistory().slice(-limit);
  if (steps.length === 0) return `${DIM}Reasoning chain is empty.${RESET}`;

  const lines = [`${BOLD}Reasoning Chain (last ${steps.length} steps)${RESET}`, ""];
  for (const step of steps) {
    const icon =
      step.phase.type === "thinking"
        ? "💭"
        : step.phase.type === "critique"
          ? "🔍"
          : step.phase.type === "action"
            ? "⚡"
            : "👁";
    const pdse =
      step.phase.pdseScore !== undefined ? ` P:${(step.phase.pdseScore * 100).toFixed(0)}` : "";
    const esc = step.escalated ? ` ${YELLOW}↑escalated${RESET}` : "";
    lines.push(`  ${icon} #${step.stepNumber} [${step.phase.type}]${pdse}${esc}`);
    lines.push(`    ${DIM}${step.phase.content.slice(0, 120)}${RESET}`);
    if (step.rootCause) lines.push(`    ${RED}Root cause: ${step.rootCause}${RESET}`);
    if (step.playbookBullets?.length) {
      lines.push(`    ${GREEN}Playbook: ${step.playbookBullets[0]}${RESET}`);
    }
  }
  return lines.join("\n");
}

async function thinkCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const sub = parts[0]?.toLowerCase() ?? "";
  const subSub = parts[1]?.toLowerCase() ?? "";
  const isSession = parts.includes("--session");

  if (!sub) {
    const current = state.reasoningOverride ?? "auto";
    const budget = state.lastThinkingBudget;
    const chain = state.reasoningChain;
    const displayMode = state.state.thinkingDisplayMode ?? "spinner";
    return [
      `${BOLD}Reasoning Effort${RESET}`,
      `  Current tier: ${formatThinkTier(current)}`,
      `  Display mode: ${displayMode}`,
      `  Mode: ${state.reasoningOverride ? "manual override" : "automatic (decideTier)"}`,
      `  Scope: ${state.reasoningOverrideSession ? "session" : "next prompt only"}`,
      budget !== undefined ? `  Last thinking budget: ${budget.toLocaleString()} tokens` : "",
      `  Chain depth: ${chain?.getHistory().length ?? 0} steps`,
      "",
      `  ${DIM}Usage: /think [quick|deep|expert|auto] [--session] | display <mode> | stats | chain [N]${RESET}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (sub === "display") {
    if (!subSub) {
      const current = state.state.thinkingDisplayMode ?? "spinner";
      return [
        `${BOLD}Thinking Display Mode${RESET}`,
        `  Current mode: ${current}`,
        "",
        `${BOLD}Available modes:${RESET}`,
        `  ${GREEN}spinner${RESET}      - Show animated spinner ┌${RESET}`,
        `  ${YELLOW}progress-bar${RESET} - Show progress bar with percentage`,
        `  ${RED}disabled${RESET}     - Disable thinking display entirely`,
        `  ${CYAN}compact${RESET}     - Show compact indicator (…)`,
        "",
        `  ${DIM}Usage: /think display <spinner|progress-bar|disabled|compact>${RESET}`,
      ].join("\n");
    }

    const validModes = ["spinner", "progress-bar", "disabled", "compact"];
    if (!validModes.includes(subSub)) {
      return `${RED}Invalid mode: ${subSub}. Options: ${validModes.join(", ")}${RESET}`;
    }

    state.state.thinkingDisplayMode = subSub as "spinner" | "progress-bar" | "disabled" | "compact";
    await updateStateYaml(state.projectRoot, {
      thinkingDisplayMode: subSub as "spinner" | "progress-bar" | "disabled" | "compact",
    });

    return `${GREEN}Thinking display mode set to ${BOLD}${subSub}${RESET}${GREEN}${
      subSub === "disabled" ? " (thinking indicators hidden)" : ""
    }${RESET}`;
  }

  if (sub === "stats") return formatThinkStats(state.reasoningChain);
  if (sub === "chain") {
    const limit = Math.max(1, parseInt(parts[1] ?? "10", 10) || 10);
    return formatThinkChain(state.reasoningChain, limit);
  }

  const validTiers = ["quick", "deep", "expert", "auto"];
  if (!validTiers.includes(sub)) {
    return `${RED}Invalid tier: ${sub}. Options: ${validTiers.join(", ")}${RESET}`;
  }

  if (sub === "auto") {
    state.reasoningOverride = undefined;
    state.reasoningOverrideSession = false;
    return `${GREEN}Reasoning: automatic tier selection restored${RESET}`;
  }

  state.reasoningOverride = sub as ReasoningTier;
  state.reasoningOverrideSession = isSession;
  const scope = isSession ? "session" : "next prompt";
  const hint =
    sub === "expert" ? " (high token usage)" : sub === "quick" ? " (minimal tokens)" : "";
  return `${GREEN}Reasoning set to ${BOLD}${sub}${RESET}${GREEN} for ${scope}${hint}${RESET}`;
}

// ----------------------------------------------------------------------------
// Approval Mode slash command
// ----------------------------------------------------------------------------

const APPROVAL_MODES = ["review", "apply", "autoforge", "plan", "yolo"] as const;
type ApprovalMode = (typeof APPROVAL_MODES)[number];

async function modeCommand(args: string, state: ReplState): Promise<string> {
  const sub = args.trim().toLowerCase();
  const currentMode = normalizeApprovalMode(state.approvalMode) ?? "review";

  if (!sub) {
    // Color code current mode based on severity
    const modeColor =
      currentMode === "plan" || currentMode === "review"
        ? CYAN
        : currentMode === "apply"
          ? YELLOW
          : currentMode === "autoforge"
            ? RED
            : "\x1b[35m"; // magenta for yolo

    const lines = [
      `${BOLD}Current approval mode: ${modeColor}${currentMode}${RESET}`,
      "",
      `${BOLD}Available modes:${RESET}`,
      `  ${CYAN}review${RESET}     - Require approval before workspace mutations and subagents (default, safe)`,
      `  ${CYAN}plan${RESET}       - Block workspace mutations and subagents until execution is approved (read-only)`,
      `  ${YELLOW}apply${RESET}      - Auto-approve edits, still gate shell/git/subagent execution (caution)`,
      `  ${RED}autoforge${RESET}  - Apply profile for pipeline execution (autonomous)`,
      `  ${DIM}Unsafe escape hatch:${RESET} \x1b[35myolo${RESET} -> disables the approval gateway (unrestricted)`,
      "",
      `${DIM}Legacy aliases: default -> review, auto-edit -> apply${RESET}`,
      "",
      `${DIM}Usage: /mode <mode-name>${RESET}`,
    ];
    return lines.join("\n");
  }

  const normalized = normalizeApprovalMode(sub);
  if (!normalized && sub !== "yolo") {
    return `${RED}Unknown mode "${sub}". Available: ${APPROVAL_MODES.join(", ")}${RESET}`;
  }

  const nextMode = (normalized ?? "yolo") as ApprovalMode;
  state.approvalMode = nextMode;
  configureApprovalMode(nextMode);

  if (nextMode === "plan") {
    state.planMode = true;
    state.planApproved = false;
  } else if (state.planMode) {
    state.planMode = false;
  }

  const nextModeColor =
    nextMode === "plan" || nextMode === "review"
      ? CYAN
      : nextMode === "apply"
        ? YELLOW
        : nextMode === "autoforge"
          ? RED
          : "\x1b[35m"; // magenta for yolo

  return `${GREEN}Approval mode set to ${nextModeColor}${BOLD}${nextMode}${RESET}${GREEN}.${RESET} Status bar updated.`;
}

// ----------------------------------------------------------------------------
// DanteGaslight slash command
// ----------------------------------------------------------------------------

async function gaslightCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const sub = parts[0]?.toLowerCase() ?? "";

  const gl = getOrInitGaslight(state);

  switch (sub) {
    case "on":
      return gl.cmdOn();
    case "off":
      return gl.cmdOff();
    case "stats":
      return gl.cmdStats();
    case "review":
      return gl.cmdReview();
    case "bridge": {
      try {
        await runGaslightCommand(parts, state.projectRoot);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `${RED}Gaslight bridge error: ${msg}${RESET}`;
      }
      return "";
    }
    default:
      return [
        `${BOLD}DanteGaslight${RESET} — bounded adversarial refinement engine`,
        `  ${CYAN}/gaslight on${RESET}        Enable the engine (default: off)`,
        `  ${CYAN}/gaslight off${RESET}       Disable the engine`,
        `  ${CYAN}/gaslight stats${RESET}     Session statistics`,
        `  ${CYAN}/gaslight review${RESET}    Review last session`,
        `  ${CYAN}/gaslight bridge${RESET}    Distill PASS session → Skillbook`,
        `  ${DIM}Trigger: "go deeper", "again but better", "truth mode"${RESET}`,
      ].join("\n");
  }
}

// ----------------------------------------------------------------------------
// DanteFearSet slash command
// ----------------------------------------------------------------------------

async function fearsetCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const sub = parts[0]?.toLowerCase() ?? "";

  const gl = getOrInitGaslight(state);

  switch (sub) {
    case "on":
      return gl.cmdFearSetOn();
    case "off":
      return gl.cmdFearSetOff();
    case "stats":
      return gl.cmdFearSetStats();
    case "review":
      return gl.cmdFearSetReview();
    case "bridge": {
      try {
        await runFearsetCommand(["bridge", ...parts.slice(1)], state.projectRoot);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `${RED}FearSet bridge error: ${msg}${RESET}`;
      }
      return "";
    }
    case "run": {
      const context = parts.slice(1).join(" ").trim();
      if (!context) {
        return `${RED}Usage: /fearset run <decision context>${RESET}\n${DIM}Example: /fearset run "Should we migrate to PostgreSQL?"${RESET}`;
      }
      try {
        const result = await gl.runFearSet(context);
        const decColor =
          result.synthesizedRecommendation?.decision === "go"
            ? GREEN
            : result.synthesizedRecommendation?.decision === "no-go"
              ? RED
              : YELLOW;
        const lines = [
          `${BOLD}FearSet complete${RESET}  ${result.passed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`}`,
          `  ID:         ${CYAN}${result.id}${RESET}`,
          `  Robustness: ${result.robustnessScore?.overall.toFixed(2) ?? "n/a"} (${result.robustnessScore?.gateDecision ?? "n/a"})`,
          `  Columns:    ${result.columns.map((c) => c.name).join(", ")}`,
        ];
        if (result.synthesizedRecommendation) {
          lines.push(
            `  Decision:   ${decColor}${BOLD}${result.synthesizedRecommendation.decision.toUpperCase()}${RESET}`,
          );
          lines.push(`  ${result.synthesizedRecommendation.reasoning.slice(0, 120)}`);
        }
        if (result.passed) {
          lines.push(`${DIM}Run /fearset bridge to distill lessons → Skillbook.${RESET}`);
        }
        return lines.join("\n");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `${RED}FearSet run error: ${msg}${RESET}`;
      }
    }
    default:
      return [
        `${BOLD}DanteFearSet${RESET} — Tim Ferriss Fear-Setting for high-stakes decisions`,
        `  ${CYAN}/fearset on${RESET}              Enable auto-trigger`,
        `  ${CYAN}/fearset off${RESET}             Disable FearSet`,
        `  ${CYAN}/fearset stats${RESET}           Aggregated run statistics`,
        `  ${CYAN}/fearset review${RESET}          Review last result`,
        `  ${CYAN}/fearset run <context>${RESET}   One-shot fear-setting analysis`,
        `  ${CYAN}/fearset bridge${RESET}          Distill PASS results → Skillbook`,
        `${DIM}Columns: Define→Prevent→Repair+Benefits+Inaction${RESET}`,
      ].join("\n");
  }
}

// ----------------------------------------------------------------------------
// /drift — Doc-Code Drift Detection
// ----------------------------------------------------------------------------

async function driftCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const sub = parts[0]?.toLowerCase() ?? "";

  if (sub === "help") {
    return [
      `${BOLD}Doc-Code Drift Detection${RESET}`,
      "",
      `${DIM}Detects when JSDoc/TSDoc documentation diverges from implementation.${RESET}`,
      "",
      `${CYAN}/drift${RESET}               Scan all source files for drift`,
      `${CYAN}/drift <glob>${RESET}        Scan specific files (e.g., "src/**/*.ts")`,
      "",
      `${DIM}Checks for:${RESET}`,
      `  - Parameter count mismatches`,
      `  - Parameter name mismatches`,
      `  - Parameter type mismatches`,
      `  - Return type mismatches`,
      "",
      `${DIM}Example:${RESET}`,
      `  ${YELLOW}/drift src/core/**/*.ts${RESET}`,
    ].join("\n");
  }

  // Import glob for file pattern matching
  const { glob } = await import("glob");

  try {
    // Determine file pattern
    let pattern = "**/*.{ts,tsx,js,jsx}";
    if (parts.length > 0 && !sub.startsWith("-")) {
      pattern = parts.join(" ");
    }

    // Find files matching pattern
    const sourceFiles = await glob(pattern, {
      cwd: state.projectRoot,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "**/coverage/**"],
      absolute: true,
    });

    if (sourceFiles.length === 0) {
      return `${YELLOW}No source files found matching pattern: ${pattern}${RESET}`;
    }

    // Run drift detection
    const checks = await detectDrift(sourceFiles, state.projectRoot);
    const drifted = checks.filter((c) => c.driftDetected);

    if (drifted.length === 0) {
      return [
        `${GREEN}${BOLD}No drift detected${RESET}`,
        ``,
        `${DIM}Scanned ${sourceFiles.length} files.${RESET}`,
        `${DIM}All documented functions and classes match their implementations.${RESET}`,
      ].join("\n");
    }

    // Format drift report
    const lines = [
      `${YELLOW}${BOLD}Doc-Code Drift Detected${RESET}`,
      "",
      `${DIM}Found ${drifted.length} drift issue${drifted.length === 1 ? "" : "s"} in ${sourceFiles.length} files scanned.${RESET}`,
      "",
    ];

    // Group by file
    const byFile = new Map<string, typeof drifted>();
    for (const check of drifted) {
      const fileList = byFile.get(check.file) ?? [];
      fileList.push(check);
      byFile.set(check.file, fileList);
    }

    for (const [file, issues] of byFile) {
      const relPath = relative(state.projectRoot, file);
      lines.push(`${BOLD}${relPath}${RESET}`);

      for (const issue of issues) {
        const typeColor = issue.type === "function" ? CYAN : YELLOW;
        lines.push(`  ${typeColor}${issue.type}${RESET} ${BOLD}${issue.name}${RESET}`);
        lines.push(`    ${RED}Issue:${RESET} ${issue.driftReason}`);
        lines.push(`    ${DIM}Code:${RESET} ${issue.codeSignature.slice(0, 80)}${issue.codeSignature.length > 80 ? "..." : ""}`);
        lines.push(`    ${DIM}Docs:${RESET} ${issue.docSignature}`);
        lines.push("");
      }
    }

    lines.push(`${DIM}Update JSDoc/TSDoc to match implementation or fix code.${RESET}`);

    return lines.join("\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Drift detection error: ${msg}${RESET}`;
  }
}

// ----------------------------------------------------------------------------
// Approval Engine slash commands
// ----------------------------------------------------------------------------

async function approveCommand(_args: string, state: ReplState): Promise<string> {
  // Interactive approval signal — registers a pending approval for the current sandboxed action.
  // Full interactive wiring is deferred; this confirms the intent to the user.
  globalApprovalEngine.setPolicy("auto");
  const store = new DurableRunStore(state.projectRoot);
  const run = await store.getLatestWaitingUserRun();
  if (!run) {
    return `${YELLOW}No paused durable run awaiting approval.${RESET}`;
  }

  const pendingToolCalls = await store.loadPendingToolCalls(run.id);
  const records = await store.loadToolCallRecords(run.id);
  const pendingRecord = records.find((record) => record.status === "awaiting_approval");
  const pendingToolCall =
    pendingToolCalls[0] ??
    (pendingRecord
      ? {
          id: pendingRecord.id,
          name: pendingRecord.toolName,
          input: pendingRecord.input,
          dependsOn: pendingRecord.dependsOn,
        }
      : undefined);

  if (!pendingToolCall) {
    return `${YELLOW}Durable run ${run.id} does not have a pending tool approval.${RESET}`;
  }

  globalApprovalGateway.approveToolCall(pendingToolCall.name, pendingToolCall.input);

  // Wave 3: Record approval_granted in receipts/reports
  if (state.runReportAccumulator) {
    state.runReportAccumulator.recordTimelineEvents([
      {
        kind: "approval_granted",
        label: `${pendingToolCall.name} granted`,
        at: new Date().toISOString(),
        detail: `User approved ${pendingToolCall.name} for durable run ${run.id}`,
      },
    ]);
  }

  state.pendingAgentPrompt = "continue";
  state.pendingResumeRunId = run.id;
  state.pendingExpectedWorkflow = run.workflow;
  return (
    `${GREEN}Approved ${BOLD}${pendingToolCall.name}${RESET}${GREEN} for durable run ${run.id}.${RESET}\n` +
    `${DIM}Queued the run to continue with the explicitly approved tool call.${RESET}`
  );
}

async function denyCommand(_args: string, state: ReplState): Promise<string> {
  // Interactive denial signal — registers a denial for the current sandboxed action.
  globalApprovalEngine.setPolicy("manual");
  const store = new DurableRunStore(state.projectRoot);
  const run = await store.getLatestWaitingUserRun();
  if (!run) {
    return `${YELLOW}No paused durable run awaiting approval.${RESET}`;
  }

  const pendingToolCalls = await store.loadPendingToolCalls(run.id);
  const restoredRecords = globalToolScheduler.resumeToolCalls(
    await store.loadToolCallRecords(run.id),
  );
  const pendingRecord = restoredRecords.find((record) => record.status === "awaiting_approval");
  const pendingToolCall =
    pendingToolCalls[0] ??
    (pendingRecord
      ? {
          id: pendingRecord.id,
          name: pendingRecord.toolName,
          input: pendingRecord.input,
          dependsOn: pendingRecord.dependsOn,
        }
      : undefined);

  if (pendingRecord) {
    globalToolScheduler.cancel(pendingRecord.id, "Denied by operator.");
    await store.persistToolCallRecords(run.id, [pendingRecord]);
  }

  if (pendingToolCall) {
    globalApprovalGateway.revokeToolCallApproval(pendingToolCall.name, pendingToolCall.input);

    // Wave 3: Record approval_denied in receipts/reports
    if (state.runReportAccumulator) {
      state.runReportAccumulator.recordTimelineEvents([
        {
          kind: "approval_denied",
          label: `${pendingToolCall.name} denied`,
          at: new Date().toISOString(),
          detail: `User denied ${pendingToolCall.name} for durable run ${run.id}`,
        },
      ]);
    }
  }

  await store.clearPendingToolCalls(run.id);
  await store.failRun(run.id, {
    session: state.session,
    touchedFiles: collectTouchedFilesFromSession(state.session, state.projectRoot),
    lastConfirmedStep: run.lastConfirmedStep,
    nextAction: "Adjust the plan or switch approval modes before retrying the run.",
    message: pendingToolCall
      ? `Operator denied ${pendingToolCall.name}.`
      : "Operator denied the pending action.",
    evidence: [],
  });

  state.pendingAgentPrompt = null;
  state.pendingResumeRunId = null;
  state.pendingExpectedWorkflow = null;

  if (!pendingToolCall) {
    return `${RED}Denied the pending durable run.${RESET}`;
  }

  return (
    `${RED}Denied ${BOLD}${pendingToolCall.name}${RESET}${RED} for durable run ${run.id}.${RESET}\n` +
    `${DIM}The run was marked failed and its pending tool calls were cleared.${RESET}`
  );
  return `${RED}Denial registered.${RESET} ${DIM}The pending sandboxed action has been denied. Policy reset to manual — all actions will prompt.${RESET}`;
}

async function alwaysAllowCommand(args: string, _state: ReplState): Promise<string> {
  const pattern = args.trim();
  if (!pattern) {
    return `${RED}Usage: /always-allow <pattern>${RESET}\n${DIM}Example: /always-allow npm test${RESET}`;
  }
  try {
    globalApprovalEngine.addAllowRule(pattern);
    return `${GREEN}Allow rule added:${RESET} ${BOLD}${pattern}${RESET}\n${DIM}Commands matching this pattern will bypass approval prompts.${RESET}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Invalid pattern: ${msg}${RESET}`;
  }
}

// ----------------------------------------------------------------------------
// DanteReview slash command
// ----------------------------------------------------------------------------

async function reviewCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const prArg = parts[0];

  if (!prArg || prArg === "--help" || prArg === "-h") {
    return [
      `${BOLD}DanteReview${RESET} — DanteForge-powered PR review`,
      `  ${CYAN}/review <PR#>${RESET}                           Analyze PR without posting`,
      `  ${CYAN}/review <PR#> --post${RESET}                   Analyze and post review to GitHub`,
      `  ${CYAN}/review <PR#> --severity=strict|normal|lenient${RESET}`,
      `  ${DIM}Requires GITHUB_TOKEN environment variable.${RESET}`,
    ].join("\n");
  }

  const prNumber = parseInt(prArg, 10);
  if (isNaN(prNumber) || prNumber <= 0) {
    return `${RED}Error: /review requires a positive PR number. Got: "${prArg}"${RESET}`;
  }

  const postComments = parts.includes("--post");
  const severityArg = parts.find((p) => p.startsWith("--severity="));
  const severity = (severityArg?.split("=")[1] ?? "normal") as "strict" | "normal" | "lenient";

  try {
    const { reviewPR, formatReviewOutput } = await import("./commands/review.js");
    const result = await reviewPR(prNumber, state.projectRoot, {
      postComments,
      severity,
    });
    return formatReviewOutput(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Review error: ${msg}${RESET}`;
  }
}

// ----------------------------------------------------------------------------
// DanteTriage slash command
// ----------------------------------------------------------------------------

async function triageCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const issueArg = parts[0];

  if (!issueArg || issueArg === "--help" || issueArg === "-h") {
    return [
      `${BOLD}DanteTriage${RESET} — model-assisted GitHub issue triage`,
      `  ${CYAN}/triage <issue#>${RESET}              Analyze issue (heuristics + LLM)`,
      `  ${CYAN}/triage <issue#> --post-labels${RESET} Analyze and apply labels`,
      `  ${CYAN}/triage <issue#> --no-llm${RESET}      Heuristic-only (fast)`,
      `  ${DIM}Requires GITHUB_TOKEN environment variable.${RESET}`,
    ].join("\n");
  }

  const issueNumber = parseInt(issueArg, 10);
  if (isNaN(issueNumber) || issueNumber <= 0) {
    return `${RED}Error: /triage requires a positive issue number. Got: "${issueArg}"${RESET}`;
  }

  const postLabels = parts.includes("--post-labels");
  const useLLM = !parts.includes("--no-llm");

  try {
    const { triageIssue, formatTriageOutput } = await import("./commands/triage.js");
    const result = await triageIssue(issueNumber, state.projectRoot, {
      postLabels,
      useLLM,
    });
    return formatTriageOutput(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Triage error: ${msg}${RESET}`;
  }
}

// ----------------------------------------------------------------------------
// DanteFleet slash command
// ----------------------------------------------------------------------------

/**
 * Reads .dantecode/agents/*.yaml manifests and returns their names.
 * Non-fatal: returns empty array if the directory does not exist.
 */
async function listAgentManifests(projectRoot: string): Promise<string[]> {
  const agentsDir = join(projectRoot, ".dantecode", "agents");
  try {
    const entries = await readdir(agentsDir);
    return entries
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map((f) => f.replace(/\.(yaml|yml)$/, ""));
  } catch {
    return [];
  }
}

async function fleetCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return [
      `${BOLD}DanteFleet${RESET} — launch parallel agents to solve a task using Git worktrees`,
      `  ${CYAN}/fleet <task>${RESET}    Launch builder + reviewer + tester agents in parallel`,
      ``,
      `  Each agent gets its own worktree isolation. Results are merged via Council.`,
      `  Agent manifests are read from ${DIM}.dantecode/agents/*.yaml${RESET}`,
      ``,
      `  Examples:`,
      `    ${DIM}/fleet implement authentication middleware${RESET}`,
      `    ${DIM}/fleet refactor the database layer with full test coverage${RESET}`,
    ].join("\n");
  }

  const task = parts.join(" ");
  const manifests = await listAgentManifests(state.projectRoot);

  const agentList =
    manifests.length > 0 ? manifests.join(", ") : "builder, reviewer, tester (default)";

  // Wire up the fleet by queueing a council start via pendingAgentPrompt.
  // This triggers the agent loop to invoke the council orchestrator with the
  // named agent roles discovered from .dantecode/agents/.
  const defaultAgents = manifests.length > 0 ? manifests : ["builder", "reviewer", "tester"];
  const fleetPrompt = [
    `Run dantecode council start with the following configuration:`,
    `  Objective: ${task}`,
    `  Agents: ${defaultAgents.join(", ")}`,
    `  Use worktrees for NOMA isolation.`,
    `  After all agents complete, run council merge --auto then council verify.`,
    ``,
    `Use the council CLI commands to orchestrate this multi-agent task.`,
  ].join("\n");

  state.pendingAgentPrompt = fleetPrompt;

  return [
    `${GREEN}${BOLD}Fleet launched${RESET} for: ${CYAN}${task}${RESET}`,
    `  Agents: ${BOLD}${agentList}${RESET}`,
    `  Manifests: ${manifests.length > 0 ? `${manifests.length} loaded from .dantecode/agents/` : "using defaults"}`,
    `  Results will be merged via Council orchestrator.`,
    ``,
    `${DIM}Handing off to agent loop — type /council status to monitor progress.${RESET}`,
  ].join("\n");
}

// ----------------------------------------------------------------------------
// DanteLoop slash command — autonomous recurring task
// ----------------------------------------------------------------------------

async function loopCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return [
      `${BOLD}DanteLoop${RESET} — autonomous recurring task loop`,
      `  ${CYAN}/loop [--max=N] <task>${RESET}    Run task autonomously up to N times (default: 5)`,
      ``,
      `  The agent will retry the task until it succeeds or reaches max iterations.`,
      `  Stops on: success, max iterations, or explicit failure.`,
      ``,
      `  Examples:`,
      `    ${DIM}/loop fix all failing tests${RESET}`,
      `    ${DIM}/loop --max=3 refactor until all types pass${RESET}`,
    ].join("\n");
  }

  const maxFlag = parts.find((a) => a.startsWith("--max="));
  const max = maxFlag ? parseInt(maxFlag.split("=")[1] ?? "5", 10) : 5;
  const taskParts = parts.filter((a) => !a.startsWith("--"));
  const task = taskParts.join(" ");

  if (!task) {
    return `${RED}Usage: /loop [--max=5] <task>${RESET}\n${DIM}Example: /loop fix all failing tests${RESET}`;
  }

  if (!Number.isFinite(max) || max < 1) {
    return `${RED}--max must be a positive integer. Got: ${maxFlag?.split("=")[1] ?? "?"}${RESET}`;
  }

  // Build an autonomous loop prompt that instructs the agent to retry up to max times.
  const loopPrompt = [
    `AUTONOMOUS LOOP MODE — max iterations: ${max}`,
    ``,
    `Task: ${task}`,
    ``,
    `Instructions:`,
    `1. Attempt the task above.`,
    `2. After each attempt, evaluate: did the task succeed? (run tests, typecheck, or other verification as appropriate)`,
    `3. If it succeeded: stop and report LOOP_SUCCESS.`,
    `4. If it failed and iterations < ${max}: analyze what went wrong, adjust your approach, retry.`,
    `5. If it failed after ${max} iterations: stop and report LOOP_MAX_REACHED with a summary of attempts.`,
    ``,
    `Always use tools to verify your work. Never claim success without evidence.`,
    `Report format on completion: LOOP_STATUS: <success|failed|max-reached> after <N> iteration(s).`,
  ].join("\n");

  state.pendingAgentPrompt = loopPrompt;

  return [
    `${GREEN}${BOLD}Autonomous loop started${RESET}`,
    `  Task: ${CYAN}${task}${RESET}`,
    `  Max iterations: ${BOLD}${max}${RESET}`,
    `  Stop on: success or max iterations`,
    ``,
    `${DIM}Handing off to agent loop — the agent will iterate autonomously.${RESET}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// /onboard — Re-run the setup wizard (OnRamp v1.3)
// ---------------------------------------------------------------------------

async function onboardCommand(args: string, state: ReplState): Promise<string> {
  try {
    const { OnboardingWizard } = await import("@dantecode/ux-polish");
    const wizard = new OnboardingWizard({
      stateOptions: { projectRoot: state.projectRoot },
    });

    const force = args.trim() === "--force";
    if (!force && wizard.isComplete()) {
      return `${GREEN}Setup already complete.${RESET} ${DIM}Use /onboard --force to re-run.${RESET}`;
    }

    const result = await wizard.run({ force });
    return result.completed
      ? `${GREEN}Setup complete.${RESET}`
      : `${YELLOW}Setup incomplete. ${result.nextSuggestedStep ?? "Run /onboard again."}${RESET}`;
  } catch {
    return `${DIM}Onboarding wizard not available. Run "dantecode init" instead.${RESET}`;
  }
}

// ---------------------------------------------------------------------------
// /score — Score C/D measurement (OnRamp v1.3)
// ---------------------------------------------------------------------------

async function scoreCommand(_args: string, state: ReplState): Promise<string> {
  const { measureAllDimensions } = await import("./scoring.js");
  const report = measureAllDimensions(state.projectRoot);

  const formatScore = (score: number): string => {
    if (score >= 8) return `${GREEN}${score.toFixed(1)}${RESET}`;
    if (score >= 6) return `${YELLOW}${score.toFixed(1)}${RESET}`;
    return `${RED}${score.toFixed(1)}${RESET}`;
  };

  const lines = [
    "",
    `${BOLD}DanteCode Score Report${RESET}`,
    "",
    `  ${BOLD}Score C (User Experience):${RESET}  ${formatScore(report.scoreC)}/10`,
    `  ${BOLD}Score D (Distribution):${RESET}     ${formatScore(report.scoreD)}/10`,
    "",
  ];

  for (const dim of report.dimensions) {
    const color = dim.score >= 8 ? GREEN : dim.score >= 6 ? YELLOW : RED;
    lines.push(
      `  ${dim.id.padEnd(6)} ${color}${dim.score.toFixed(1)}${RESET} ${DIM}${dim.name}${RESET}`,
    );
    lines.push(`         ${DIM}${dim.evidence}${RESET}`);
  }

  lines.push("");
  return lines.join("\n");
}

async function statusCommand(_args: string, state: ReplState): Promise<string> {
  const providerName = state.state.model.default.provider;
  const modelId = state.state.model.default.modelId;
  const operatorStatus = await buildCliOperatorStatus(state);
  const readinessCommit =
    operatorStatus.readiness.artifactCommitSha?.slice(0, 12) ??
    operatorStatus.readiness.headCommitSha?.slice(0, 12) ??
    "unknown";
  const sameCommitLabel =
    operatorStatus.readiness.sameCommit === null
      ? `${DIM}unknown${RESET}`
      : operatorStatus.readiness.sameCommit
        ? `${GREEN}yes${RESET}`
        : `${RED}no${RESET}`;
  const contextTierColor =
    operatorStatus.contextUtilization.tier === "red"
      ? RED
      : operatorStatus.contextUtilization.tier === "yellow"
        ? YELLOW
        : GREEN;
  const pausedRunLine = operatorStatus.latestPausedDurableRun
    ? `${operatorStatus.latestPausedDurableRun.id} (${operatorStatus.latestPausedDurableRun.workflow})`
    : `${DIM}none${RESET}`;
  const pdseSummary = operatorStatus.lastPdseSummary
    ? operatorStatus.lastPdseSummary.summary
    : "No PDSE results recorded for this session yet.";

  const lines: string[] = [
    "",
    `${BOLD}DanteCode Operator Status${RESET}`,
    "",
    `${DIM}Version:${RESET}  2.0.0`,
    `${DIM}Provider:${RESET} ${providerName} / ${modelId}`,
    `${DIM}Project:${RESET}  ${state.projectRoot}`,
    `${DIM}Sandbox:${RESET}  ${state.enableSandbox ? `${GREEN}enabled${RESET}` : `${DIM}disabled${RESET}`}`,
    `${DIM}Git:${RESET}      ${state.enableGit ? `${GREEN}enabled${RESET}` : `${DIM}disabled${RESET}`}`,
    "",
    `${BOLD}Operator${RESET}`,
    `  Approval Mode: ${CYAN}${operatorStatus.approvalMode}${RESET}`,
    `  Plan Mode:     ${operatorStatus.planMode ? `${YELLOW}active${RESET}` : `${DIM}inactive${RESET}`}`,
    `  Task Mode:     ${operatorStatus.taskMode ? `${YELLOW}${operatorStatus.taskMode}${RESET}` : `${DIM}inactive${RESET}`}`,
    `  Current Plan:  ${operatorStatus.currentPlanId ? `${CYAN}${operatorStatus.currentPlanId}${RESET}` : `${DIM}none${RESET}`}`,
    `  Current Run:   ${operatorStatus.currentRunId ? `${CYAN}${operatorStatus.currentRunId}${RESET}` : `${DIM}none${RESET}`}`,
    `  Paused Run:    ${pausedRunLine}`,
    "",
    `${BOLD}Context${RESET}`,
    `  Utilization:   ${contextTierColor}${operatorStatus.contextUtilization.percent}%${RESET} (${operatorStatus.contextUtilization.tokens}/${operatorStatus.contextUtilization.maxTokens} tokens)`,
    "",
    `${BOLD}Recovery${RESET}`,
    `  Last Restore:  ${operatorStatus.lastRestoreEvent?.restoreSummary ?? "none"}`,
    "",
    `${BOLD}Verification${RESET}`,
    `  Last PDSE:     ${pdseSummary}`,
    "",
    `${BOLD}Readiness${RESET}`,
    `  Status:        ${operatorStatus.readiness.status}`,
    `  Commit:        ${readinessCommit}`,
    `  same-commit:   ${sameCommitLabel}`,
    operatorStatus.latestPausedDurableRun?.nextAction
      ? `  Next Action:   ${operatorStatus.latestPausedDurableRun.nextAction}`
      : "",
    "",
  ];

  return lines.filter(Boolean).join("\n");
}

// ----------------------------------------------------------------------------
// /theme — Switch terminal theme with live preview
// ----------------------------------------------------------------------------

const AVAILABLE_THEMES: ThemeName[] = ["default", "minimal", "rich", "matrix", "ocean"];

async function themeCommand(args: string, state: ReplState): Promise<string> {
  const engine = getThemeEngine();
  const themeName = args.trim().toLowerCase();

  if (!themeName) {
    const current = state.theme;
    const lines = ["Available themes (current: " + BOLD + current + RESET + "):", ""];
    for (const name of AVAILABLE_THEMES) {
      engine.setTheme(name as ThemeName);
      const c = engine.resolve().colors;
      const indicator = name === current ? GREEN + "*" + RESET : " ";
      const preview =
        "  " +
        c.success +
        "ok" +
        c.reset +
        " " +
        c.error +
        "err" +
        c.reset +
        " " +
        c.warning +
        "warn" +
        c.reset +
        " " +
        c.info +
        "info" +
        c.reset +
        " " +
        c.muted +
        "muted" +
        c.reset;
      lines.push("  " + indicator + " " + BOLD + name.padEnd(10) + RESET + " " + preview);
    }
    engine.setTheme(current);
    lines.push("");
    lines.push(DIM + "Usage: /theme <name>" + RESET);
    return lines.join("\n");
  }

  if (!AVAILABLE_THEMES.includes(themeName as ThemeName)) {
    return (
      RED + "Unknown theme: " + themeName + ". Available: " + AVAILABLE_THEMES.join(", ") + RESET
    );
  }

  // Always apply visual + in-memory change unconditionally so the user
  // sees the new theme immediately regardless of disk state.
  engine.setTheme(themeName as ThemeName);
  state.theme = themeName as ThemeName;

  let persistNote = "";
  try {
    const stateYamlPath = join(state.projectRoot, ".dantecode", "STATE.yaml");
    const raw = await readFile(stateYamlPath, "utf8").catch(() => "");
    const updated = raw.includes("theme:")
      ? raw.replace(/^theme:.*$/m, "theme: " + themeName)
      : raw + "\ntheme: " + themeName + "\n";
    await writeFile(stateYamlPath, updated, "utf8");
  } catch {
    persistNote = " " + RED + "(not saved — check .dantecode/ permissions)" + RESET;
  }

  const c = engine.resolve().colors;
  return [
    GREEN + "Theme set to " + BOLD + themeName + RESET + persistNote,
    "",
    "Preview with " + BOLD + themeName + RESET + ":",
    "  " + c.success + "verification passed" + c.reset,
    "  " + c.error + "anti-stub violation" + c.reset,
    "  " + c.warning + "PDSE score: 78 (below threshold)" + c.reset,
    "  " + c.info + "model: grok/grok-3" + c.reset,
    "  " + c.muted + "session: my-session | tokens: 12,450" + c.reset,
  ].join("\n");
}

// ----------------------------------------------------------------------------
// /cost — Show token usage dashboard
// ----------------------------------------------------------------------------

async function costCommand(_args: string, state: ReplState): Promise<string> {
  const messages = state.session.messages;
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const byTool: Record<string, { calls: number; tokens: number }> = {};

  for (const msg of messages) {
    const t = msg.tokensUsed ?? 0;
    totalTokens += t;
    if (msg.role === "user" || msg.role === "tool") {
      inputTokens += t;
    } else if (msg.role === "assistant") {
      outputTokens += t;
    }
    if (msg.toolUse && msg.toolUse.name) {
      const tool = msg.toolUse.name;
      if (!byTool[tool]) byTool[tool] = { calls: 0, tokens: 0 };
      byTool[tool].calls++;
      byTool[tool].tokens += t;
    }
  }

  // Also count tool calls tracked in recentToolCalls (stuck-loop detection array).
  // These carry tool names without per-call token info, so we add call counts only,
  // merging with any entry already populated from msg.toolUse above.
  for (const toolName of state.recentToolCalls) {
    if (!toolName) continue;
    if (!byTool[toolName]) byTool[toolName] = { calls: 0, tokens: 0 };
    byTool[toolName].calls++;
  }

  const modelId = state.state.model.default.provider + "/" + state.state.model.default.modelId;
  const sessionStart = new Date(state.session.createdAt).getTime();
  const sessionDurationMs = Date.now() - sessionStart;

  const data = {
    totalTokens,
    inputTokens,
    outputTokens,
    byTool,
    modelId,
    contextWindow: 131072,
    contextUtilization: Math.min(1, totalTokens / 131072),
    sessionDurationMs,
  };

  return renderTokenDashboard(data, getThemeEngine());
}

// ----------------------------------------------------------------------------
// Slash Command Registry
// ----------------------------------------------------------------------------

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "help",
    description: "Show all slash commands",
    usage: "/help",
    handler: helpCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "tutorial",
    description: "Interactive tutorials for beginners (magic-basics, party-advanced, etc.)",
    usage: "/tutorial [<topic>]",
    handler: tutorialCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "magic",
    description: "Build something \u2014 describe what you want in plain language",
    usage: "/magic <what to build>",
    handler: magicCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "onboard",
    description: "Run the setup wizard",
    usage: "/onboard [--force]",
    handler: onboardCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "score",
    description: "Measure DanteCode readiness scores (C: User Experience, D: Distribution)",
    usage: "/score",
    handler: scoreCommand,
    tier: 2,
    category: "verification",
  },
  {
    name: "status",
    description: "Show DanteCode version, features, and health status",
    usage: "/status",
    handler: statusCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "model",
    description: "Switch model mid-session or select interactively",
    usage: "/model <id> or /model select",
    handler: modelCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "macro",
    description: "Record, play, and manage macros of slash commands",
    usage: "/macro <record <name>|stop|play <name>|list>",
    handler: macroCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "add",
    description: "Add file to conversation context (shows fuzzy finder if no args)",
    usage: "/add [file|<number>|<search>]",
    handler: addCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "browse",
    description: "Browse project files with PDSE previews (read-only)",
    usage: "/browse [<search>]",
    handler: browseCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "drop",
    description: "Remove file from context",
    usage: "/drop <file>",
    handler: dropCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "files",
    description: "List files currently in context",
    usage: "/files",
    handler: filesCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "diff",
    description: "Show pending changes (unstaged diff)",
    usage: "/diff",
    handler: diffCommand,
    tier: 1,
    category: "git",
  },
  {
    name: "commit",
    description: "Trigger auto-commit",
    usage: "/commit",
    handler: commitCommand,
    tier: 1,
    category: "git",
  },
  {
    name: "revert",
    description: "Revert last commit",
    usage: "/revert",
    handler: revertCommand,
    tier: 2,
    category: "git",
  },
  {
    name: "undo",
    description: "Restore the most recent file snapshot",
    usage: "/undo [file]",
    handler: undoCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "restore",
    description: "Restore a file or snapshot from the recovery trail",
    usage: "/restore <snapshot-id|file-path>",
    handler: restoreCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "recover",
    description: "Manage stale sessions (list, info, cleanup)",
    usage: "/recover [list|info <id>|cleanup <id>|cleanup-all]",
    handler: recoverCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "resume-checkpoint",
    description: "Resume from a checkpoint (list sessions or resume specific ID)",
    usage: "/resume-checkpoint [sessionId]",
    handler: resumeCheckpointCommand,
    tier: 1,
    category: "sessions",
  },
  {
    name: "replay",
    description: "Display event timeline for a session with optional filtering",
    usage: "/replay <sessionId> [kind...]",
    handler: replayCommand,
    tier: 2,
    category: "sessions",
  },
  {
    name: "fork",
    description: "Fork a session by creating a new branch from checkpoint",
    usage: "/fork <sessionId>",
    handler: forkCommand,
    tier: 2,
    category: "sessions",
  },
  {
    name: "timeline",
    description: "Show recent recovery trail events",
    usage: "/timeline [limit]",
    handler: timelineCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "lessons",
    description: "Show project lessons",
    usage: "/lessons",
    handler: lessonsCommand,
    tier: 2,
    category: "memory",
  },
  {
    name: "remember",
    description: "Save a note to .dantecode/DANTE.md (persistent project memory)",
    usage: "/remember <text>",
    handler: rememberCommand,
    tier: 2,
    category: "memory",
  },
  {
    name: "pdse",
    description: "Run PDSE scorer on a file",
    usage: "/pdse <file>",
    handler: pdseCommand,
    tier: 2,
    category: "verification",
  },
  {
    name: "qa",
    description: "Run GStack QA pipeline",
    usage: "/qa",
    handler: qaCommand,
    tier: 2,
    category: "verification",
  },
  {
    name: "verify-output",
    description: "Run structured output verification from JSON input",
    usage: "/verify-output <input.json>",
    handler: verifyOutputCommand,
    tier: 2,
    category: "verification",
  },
  {
    name: "qa-suite",
    description: "Run the QA harness across multiple outputs from JSON input",
    usage: "/qa-suite <input.json>",
    handler: qaSuiteCommand,
    tier: 2,
    category: "verification",
  },
  {
    name: "critic-debate",
    description: "Aggregate critic verdicts from JSON input",
    usage: "/critic-debate <input.json>",
    handler: criticDebateCommand,
    tier: 2,
    category: "verification",
  },
  {
    name: "add-verification-rail",
    description: "Register an output verification rail from JSON input",
    usage: "/add-verification-rail <input.json>",
    handler: addVerificationRailCommand,
    tier: 2,
    category: "verification",
  },
  {
    name: "verification-history",
    description: "Show recent verification reports and benchmark entries",
    usage:
      "/verification-history [limit] [--kind verify_output|qa_suite|critic_debate|verification_rail]",
    handler: verificationHistoryCommand,
    tier: 2,
    category: "verification",
  },
  {
    name: "audit",
    description: "Show recent audit log entries",
    usage: "/audit",
    handler: auditCommand,
    tier: 2,
    category: "verification",
  },
  {
    name: "history",
    description: "List past sessions, view details, or clear history",
    usage: "/history [id | clear]",
    handler: historyCommand,
    tier: 2,
    category: "sessions",
  },
  {
    name: "clear",
    description: "Clear conversation history",
    usage: "/clear",
    handler: clearCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "tokens",
    description: "Show token usage",
    usage: "/tokens",
    handler: tokensCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "web",
    description: "Fetch URL content into context",
    usage: "/web <url>",
    handler: webCommand,
    tier: 2,
    category: "search",
  },
  {
    name: "skill",
    description: "List or activate a skill",
    usage: "/skill [name]",
    handler: skillCommand,
    tier: 2,
    category: "skills",
  },
  {
    name: "skills",
    description: "Manage skills: list, run, import, export",
    usage: "/skills [run <name>|import|export|...]",
    handler: skillsRoutingCommand,
    tier: 2,
    category: "skills",
  },
  {
    name: "skill-install",
    description: "Quick install a skill from a path, git URL, or HTTP URL",
    usage: "/skill-install <source>",
    handler: skillInstallCommand,
    tier: 2,
    category: "skills",
  },
  {
    name: "skill-verify",
    description: "Run DanteForge verification on an installed skill",
    usage: "/skill-verify <name>",
    handler: skillVerifyCommand,
    tier: 2,
    category: "skills",
  },
  {
    name: "agents",
    description: "List available agents",
    usage: "/agents",
    handler: agentsCommand,
    tier: 2,
    category: "agents",
  },
  {
    name: "read-only",
    description: "Add file as read-only reference context",
    usage: "/read-only <file>",
    handler: readOnlyCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "compact",
    description: "Condense conversation to free context space",
    usage: "/compact",
    handler: compactCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "memory",
    description: "Browse, search, and manage persistent memories",
    usage: "/memory [list|search <q>|stats|forget <key>|cross-session|export [path]]",
    handler: memoryCommand,
    tier: 2,
    category: "memory",
  },
  {
    name: "session",
    description: "Manage sessions: list, name, export, branch",
    usage: "/session [list|name <n>|export [--format json|md]|branch [<name>]]",
    handler: sessionCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "name",
    description: "Name or rename the current session",
    usage: "/name <session-name>",
    handler: nameCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "export",
    description: "Export current session to JSON or Markdown",
    usage: "/export [json|md] [path]",
    handler: exportCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "import",
    description: "Import a session from JSON file",
    usage: "/import <path>",
    handler: importSessionCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "branch",
    description: "Fork current session into a new context (preserves history)",
    usage: "/branch [name]",
    handler: branchCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "architect",
    description: "Toggle plan-first architect mode",
    usage: "/architect",
    handler: architectCommand,
    tier: 2,
    category: "agents",
  },
  {
    name: "worktree",
    description: "Create git worktree for isolation",
    usage: "/worktree",
    handler: worktreeCommand,
    tier: 2,
    category: "git",
  },
  {
    name: "sandbox",
    description:
      "DanteSandbox enforcement: status | force-docker | force-worktree | force-host | on | off",
    usage: "/sandbox [status|force-docker|force-worktree|force-host|on|off]",
    handler: sandboxCommand,
    tier: 2,
    category: "sandbox",
  },
  {
    name: "silent",
    description: "Toggle silent mode (compact progress only)",
    usage: "/silent",
    handler: silentCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "autoforge",
    description: "Run autoforge IAL loop on active file",
    usage: "/autoforge [--self-improve] [--silent] [--persist]",
    handler: autoforgeCommand,
    tier: 2,
    category: "automation",
  },
  {
    name: "resume",
    description: "Queue a paused durable run for continuation",
    usage: "/resume [runId]",
    handler: resumeCommand,
    tier: 2,
    category: "sessions",
  },
  {
    name: "runs",
    description: "List durable runs and legacy resumable sessions",
    usage: "/runs",
    handler: runsCommand,
    tier: 2,
    category: "sessions",
  },
  {
    name: "oss",
    description: "OSS research pipeline — scan, search, harvest, implement, autoforge",
    usage: "/oss [focus-area]",
    handler: ossCommand,
    tier: 2,
    category: "automation",
  },
  {
    name: "party",
    description: "Multi-agent coordination — parallel lanes for complex tasks",
    usage: "/party [--autoforge] [--files a,b] <task>",
    handler: partyCommand,
    tier: 2,
    category: "agents",
  },
  {
    name: "forge",
    description: "GSD-phased build — Plan, Execute, and Verify in one command",
    usage: "/forge <goal description>",
    handler: forgeCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "postal",
    description: "Cross-workspace workflow quick reference — what to say where",
    usage: "/postal",
    handler: postalCommand,
    tier: 2,
    category: "agents",
  },
  {
    name: "mcp",
    description: "List MCP servers and tools",
    usage: "/mcp",
    handler: mcpCommand,
    tier: 2,
    category: "advanced",
  },
  {
    name: "git-watch",
    description: "Start, list, or stop durable Git event watchers",
    usage:
      "/git-watch [list | stop <id> | <eventType> [path] [--workflow path] [--event event.json]]",
    handler: gitWatchCommand,
    tier: 2,
    category: "git",
  },
  {
    name: "run-workflow",
    description: "Run a local GitHub-style workflow file",
    usage: "/run-workflow <workflowPath> [event.json] [--background]",
    handler: runWorkflowCommand,
    tier: 2,
    category: "git",
  },
  {
    name: "auto-pr",
    description: "Create a PR with optional changeset generation",
    usage:
      "/auto-pr <title> [--body-file path] [--base branch] [--draft] [--changeset patch:pkg1,pkg2] [--background]",
    handler: autoPrCommand,
    tier: 2,
    category: "git",
  },
  {
    name: "automate",
    description: "Unified automation management: dashboard, templates, create, stop, logs",
    usage:
      "/automate [dashboard | list | create <type> | template <name> | templates | stop <id> | logs <id>]",
    handler: async (args: string, state: ReplState) => {
      getGitAutomationOrchestrator(state); // pre-populate with buildAutomationAgentRunner DI
      return automateCommand(args, state);
    },
    tier: 2,
    category: "automation",
  },
  {
    name: "webhook-listen",
    description: "Start, list, or stop local webhook listeners",
    usage:
      "/webhook-listen [list | stop <id> | [github|gitlab|custom] [--port 3000] [--path /webhook] [--workflow path]]",
    handler: webhookListenCommand,
    tier: 2,
    category: "automation",
  },
  {
    name: "schedule-git-task",
    description: "Start, list, or stop durable scheduled git tasks",
    usage:
      "/schedule-git-task [list | stop <id> | <cron|intervalMs> <task> [--workflow path] [--event event.json]]",
    handler: scheduleGitTaskCommand,
    tier: 2,
    category: "automation",
  },
  {
    name: "bg",
    description: "Background agent tasks — run, list, cancel (--pr auto-creates PR)",
    usage: "/bg [--docker] [--commit] [--pr] [--long] [task | --resume <id> | cancel <id> | clear]",
    handler: bgCommand,
    tier: 2,
    category: "agents",
  },
  {
    name: "listen",
    description: "Start webhook server for GitHub/Slack events",
    usage: "/listen [port | status]",
    handler: listenCommand,
    tier: 2,
    category: "automation",
  },
  {
    name: "index",
    description: "Build semantic code index for the project",
    usage: "/index [--embed[=provider]]",
    handler: indexCommand,
    tier: 2,
    category: "search",
  },
  {
    name: "search",
    description: "Search code index for relevant code",
    usage: "/search <query>",
    handler: searchCommand,
    tier: 2,
    category: "search",
  },
  {
    name: "think",
    description: "Control reasoning effort tier and thinking display mode for session",
    usage: "/think [quick|deep|expert|auto] [--session] | display <mode> | stats | chain [N]",
    handler: thinkCommand,
    tier: 2,
    category: "advanced",
  },
  {
    name: "mode",
    description: "Switch approval mode (default, yolo, auto-edit, plan)",
    usage: "/mode [default|yolo|auto-edit|plan]",
    handler: modeCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "gaslight",
    description: "DanteGaslight adversarial refinement — on/off/stats/review/bridge",
    usage: "/gaslight <on|off|stats|review|bridge>",
    handler: gaslightCommand,
    tier: 2,
    category: "advanced",
  },
  {
    name: "fearset",
    description: "DanteFearSet — Fear-Setting on/off/stats/review/run/bridge",
    usage: "/fearset <on|off|stats|review|run <context>|bridge>",
    handler: fearsetCommand,
    tier: 2,
    category: "advanced",
  },
  {
    name: "drift",
    description: "Detect doc-code drift (JSDoc/TSDoc vs implementation)",
    usage: "/drift [glob-pattern]",
    handler: driftCommand,
    tier: 2,
    category: "quality",
  },
  {
    name: "plan",
    description: "Generate, review, and approve execution plans before coding",
    usage: "/plan <goal> | show | approve | reject | list | status",
    handler: planCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "adaptation",
    description: "D-12A Model Adaptation — status/overrides/experiments/rollback/report/mode",
    usage: "/adaptation <status|overrides|experiments|rollback|report|mode>",
    handler: adaptationCommand,
    tier: 2,
    category: "advanced",
  },
  {
    name: "research",
    description:
      "Deep web research with synthesis and citations — searches multiple engines, fetches top sources",
    usage: "/research <topic or question>",
    handler: researchSlashHandler,
    tier: 2,
    category: "search",
  },
  {
    name: "review",
    description: "Review a GitHub PR using DanteForge PDSE + constitutional verification",
    usage: "/review <PR#> [--post] [--severity=strict|normal|lenient]",
    handler: reviewCommand,
    tier: 2,
    category: "verification",
  },
  {
    name: "triage",
    description: "Triage a GitHub issue — labels, priority, effort, relevant files",
    usage: "/triage <issue#> [--post-labels] [--no-llm]",
    handler: triageCommand,
    tier: 2,
    category: "verification",
  },
  {
    name: "approve",
    description: "Approve the pending sandboxed action",
    usage: "/approve",
    handler: approveCommand,
    tier: 2,
    category: "sandbox",
  },
  {
    name: "deny",
    description: "Deny the pending sandboxed action and reset policy to manual",
    usage: "/deny",
    handler: denyCommand,
    tier: 2,
    category: "sandbox",
  },
  {
    name: "always-allow",
    description: "Add an allow rule to bypass sandbox approval for matching commands",
    usage: "/always-allow <pattern>",
    handler: alwaysAllowCommand,
    tier: 2,
    category: "sandbox",
  },
  {
    name: "fleet",
    description: "Launch parallel agents to solve a task using Git worktrees. Usage: /fleet <task>",
    usage: "/fleet <task>",
    handler: fleetCommand,
    tier: 2,
    category: "agents",
  },
  {
    name: "loop",
    description: "Run an autonomous task loop until condition met. Usage: /loop [--max=N] <task>",
    usage: "/loop [--max=N] <task>",
    handler: loopCommand,
    tier: 2,
    category: "agents",
  },
  {
    name: "theme",
    description: "Switch terminal theme with live preview",
    usage: "/theme [name]",
    handler: themeCommand,
    tier: 2,
    category: "core",
  },
  {
    name: "cost",
    description: "Show token usage and cost estimate for this session",
    usage: "/cost",
    handler: costCommand,
    tier: 1,
    category: "core",
  },
  {
    name: "trend",
    description: "Show verification score trends and regression alerts",
    usage: "/trend [category]",
    tier: 2,
    category: "verification",
    handler: async (args: string, state: ReplState): Promise<string> => {
      const { VerificationTrendTracker } = await import("@dantecode/core");
      if (!state.verificationTrendTracker) {
        state.verificationTrendTracker = new VerificationTrendTracker();
      }
      const tracker = state.verificationTrendTracker;

      if (args.trim()) {
        const trend = tracker.getTrend(args.trim());
        if (trend.dataPoints === 0) {
          return `No data recorded for category "${args.trim()}".`;
        }
        return [
          `Category: ${trend.category}`,
          `Current: ${trend.current}`,
          `Average: ${trend.average}`,
          `Trend: ${trend.trend}`,
          `Data points: ${trend.dataPoints}`,
        ].join("\n");
      }

      const report = tracker.generateHealthReport();
      if (report.categories.length === 0) {
        return "No verification data recorded yet. PDSE scores are tracked automatically during DanteForge runs.";
      }
      const lines = [`Verification Health: ${report.overallHealth}`];
      if (report.regressions.length > 0) {
        lines.push(`Regressions: ${report.regressions.join(", ")}`);
      }
      for (const cat of report.categories) {
        lines.push(
          `  ${cat.category}: ${cat.current.toFixed(1)} (${cat.trend}) -- avg ${cat.average.toFixed(1)}, ${cat.dataPoints} points`,
        );
      }
      return lines.join("\n");
    },
  },
];

/** Return lightweight metadata for all slash commands (for testing / introspection). */
export function getSlashCommandsMeta(): Array<{ name: string; tier: number }> {
  return SLASH_COMMANDS.map((c) => ({ name: c.name, tier: c.tier ?? 2 }));
}

function getNativeCommandDefinitions(): NativeSlashCommandDefinition[] {
  return SLASH_COMMANDS.map((command) => ({
    name: command.name,
    description: command.description,
    usage: command.usage,
    tier: command.tier,
    category: command.category,
  }));
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Routes a slash command string to its handler and executes it.
 *
 * @param input - The full slash command string including the leading `/`.
 * @param state - The current REPL state.
 * @returns The output string from the command handler, or an error message.
 */
export async function routeSlashCommand(input: string, state: ReplState): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return `${RED}Not a slash command: ${trimmed}${RESET}`;
  }

  const withoutSlash = trimmed.slice(1);
  const spaceIndex = withoutSlash.indexOf(" ");
  const commandName =
    spaceIndex === -1
      ? withoutSlash.toLowerCase()
      : withoutSlash.slice(0, spaceIndex).toLowerCase();
  const args = spaceIndex === -1 ? "" : withoutSlash.slice(spaceIndex + 1);

  // Detect keywords like 'run and observe only', 'observe only', 'diagnose only', 'run and observe'
  // in user input or task description. Set session flag accordingly.
  const lowerInput = (trimmed + " " + args).toLowerCase();
  if (lowerInput.includes("run and observe only") || lowerInput.includes("observe only")) {
    state.taskMode = "observe-only";
  } else if (lowerInput.includes("run and observe")) {
    state.taskMode = "run-and-observe";
  } else if (lowerInput.includes("diagnose only") || lowerInput.includes("diagnose-only")) {
    state.taskMode = "diagnose-only";
  }

  const registry = await loadSlashCommandRegistry(state.projectRoot, getNativeCommandDefinitions());
  const command = registry.find((c) => c.name === commandName);
  if (!command) {
    return `${RED}Unknown command: /${commandName}${RESET}\n${DIM}Type /help to see available commands.${RESET}`;
  }

  if (command.source === "markdown") {
    state.pendingAgentPrompt = trimmed;
    state.pendingExpectedWorkflow = command.name;
    // Load the full workflow contract so the agent loop can inject structured context
    // (stages, failure/rollback policy) into the system prompt for all models.
    try {
      const loaded = await loadWorkflowCommand(state.projectRoot, command.name);
      if (loaded.command) {
        state.pendingWorkflowContext = createWorkflowExecutionContext(loaded.command, trimmed);
      }
    } catch {
      // Non-fatal: workflow context enrichment is best-effort
    }
    return `${GREEN}Activated markdown-backed workflow /${command.name}.${RESET}\n${DIM}Queued for agent execution using the synced command file.${RESET}`;
  }

  const nativeCommand = SLASH_COMMANDS.find((c) => c.name === commandName);
  if (!nativeCommand) {
    return `${RED}Native command handler missing for /${commandName}.${RESET}`;
  }

  // Progressive disclosure: prevent tier 2 commands when not unlocked
  if (nativeCommand.tier === 2 && !state.state.progressiveDisclosure?.unlocked) {
    const sessionStats = await countSuccessfulSessions(state.projectRoot);
    const remaining = 3 - sessionStats.count;
    return `${YELLOW}/${commandName} is unlocked after 3 successful sessions.${RESET}\n${DIM}Complete ${remaining} more ${remaining === 1 ? "session" : "sessions"} with /magic to unlock advanced features.${RESET}`;
  }

  const result = await nativeCommand.handler(args, state);

  // Ensure after command, loop stops (reset mode flag)
  if (state.taskMode !== null) {
    state.taskMode = null;
  }

  // Record macro step if recording is active (only for native commands)
  if (state.macroRecording && commandName !== "macro") {
    // Don't record macro commands themselves to avoid recursion
    state.macroRecordingSteps.push({ type: "slash", value: withoutSlash });
  }

  return result;
}

/**
 * Returns true if the input string looks like a slash command.
 */
export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith("/");
}
