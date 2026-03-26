// ============================================================================
// @dantecode/cli — Main REPL Loop (readline-based)
// A simple, robust terminal REPL that reads user input line by line,
// routes slash commands to handlers, and routes natural language to the agent.
// ============================================================================

import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import { readFile as fsReadFile } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { execSync } from "node:child_process";

import { parseModelReference, readOrInitializeState, appendAuditEvent } from "@dantecode/core";
import type { Session, DanteCodeState, ModelConfig } from "@dantecode/config-types";
import { isFirstRun, getFirstRunBanner, getCompactBanner } from "./banner.js";
import { checkForUpdate } from "./lib/auto-update.js";
import { routeSlashCommand, isSlashCommand } from "./slash-commands.js";
import type { ReplState } from "./slash-commands.js";
import { runAgentLoop } from "./agent-loop.js";
import type { AgentLoopConfig } from "./agent-loop.js";
import { SandboxBridge } from "./sandbox-bridge.js";
import {
  RichRenderer,
  ProgressOrchestrator,
  StatusBar,
  buildPrompt,
  renderTokenDashboard,
  getThemeEngine,
} from "@dantecode/ux-polish";
import type {
  StatusBarState,
  PromptBuilderState,
  TokenUsageData,
  ThemeName,
} from "@dantecode/ux-polish";
import { watchGitEvents } from "@dantecode/git-engine";
import type { GitEventWatcher } from "@dantecode/git-engine";
import { DanteSandbox } from "@dantecode/dante-sandbox";
import { getOrInitGaslight, tryAutoInit } from "./lazy-init.js";
import { configureApprovalMode } from "./approval-mode-runtime.js";
import { generateSessionReport } from "./session-report.js";

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ----------------------------------------------------------------------------
// TUI Utilities (exported for testing)
// ----------------------------------------------------------------------------

/**
 * Build a readline prompt string with an optional context utilization gauge.
 * At < 50% utilization returns "> "; above that shows a filled gauge bar.
 *
 * @param utilPct - Context utilization percentage (0–100).
 * @returns The prompt string to pass to rl.setPrompt().
 */
export function buildPromptString(utilPct: number): string {
  if (utilPct < 50) return "> ";
  const filled = Math.round((utilPct / 100) * 5);
  const empty = 5 - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)} ${utilPct}%] > `;
}

// ----------------------------------------------------------------------------
// UX Polish: RichRenderer + ProgressOrchestrator singletons
// These wire the @dantecode/ux-polish engine into the CLI surface.
// ----------------------------------------------------------------------------

const richRenderer = new RichRenderer({ defaultDensity: "normal" });
const progressOrchestrator = new ProgressOrchestrator();

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Options for starting the REPL. */
export interface ReplOptions {
  projectRoot: string;
  model?: string;
  enableGit: boolean;
  enableSandbox: boolean;
  enableWorktree: boolean;
  verbose: boolean;
  silent: boolean;
  configPath?: string;
  /** Maximum tool rounds for non-interactive/one-shot mode. */
  maxRounds?: number;
  /** Override config root directory for spawned child processes.
   *  When set, state is loaded from this path instead of projectRoot.
   *  Used by council createSelfExecutor so worktree-spawned processes
   *  still read API keys and settings from the main repo. */
  configRoot?: string;
  /** --continue / -C: resume the last session on startup. */
  resumeFromLastSession?: boolean;
  /** --fearset-block-on-nogo: block and prompt when FearSet returns no-go. */
  fearSetBlockOnNoGo?: boolean;
  /** --name <n>: human-readable name for this session. */
  sessionName?: string;
  /** --plan-first: auto-enter plan mode for all prompts. */
  planFirst?: boolean;
}

// ----------------------------------------------------------------------------
// Session Factory
// ----------------------------------------------------------------------------

/**
 * Creates a new session object with default values.
 */
function createSession(projectRoot: string, model: ModelConfig): Session {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    projectRoot,
    messages: [],
    activeFiles: [],
    readOnlyFiles: [],
    model,
    createdAt: now,
    updatedAt: now,
    agentStack: [],
    todoList: [],
  };
}

/**
 * Applies the --model override to the state's default model if provided.
 * Accepts formats like "grok/grok-3", "anthropic/claude-sonnet-4-20250514", or plain "grok-3".
 */
function applyModelOverride(state: DanteCodeState, modelOverride: string): DanteCodeState {
  const parsed = parseModelReference(modelOverride, state.model.default.provider);

  return {
    ...state,
    model: {
      ...state.model,
      default: {
        ...state.model.default,
        provider: parsed.provider,
        modelId: parsed.modelId,
      },
    },
  };
}

function syncAgentLoopConfig(replState: ReplState, agentConfig: AgentLoopConfig): void {
  configureApprovalMode(replState.approvalMode);
  agentConfig.state = replState.state;
  agentConfig.enableSandbox = replState.enableSandbox;
  agentConfig.silent = replState.silent;
  agentConfig.skillActive = replState.activeSkill !== null;
  agentConfig.waveState = replState.waveState ?? undefined;
  agentConfig.resumeFrom = replState.pendingResumeRunId ?? undefined;
  agentConfig.expectedWorkflow = replState.pendingExpectedWorkflow ?? undefined;
  agentConfig.workflowContext = replState.pendingWorkflowContext ?? undefined;
  agentConfig.sandboxBridge = replState.enableSandbox
    ? (replState.sandboxBridge ?? undefined)
    : undefined;
  // Lazy-init gaslight on first prompt submission (sync construction, no delay)
  agentConfig.gaslight = getOrInitGaslight(replState);
  // Wire replState for /think override and reasoning feedback loop
  agentConfig.replState = replState;
  agentConfig.planModeActive = replState.planMode && !replState.planApproved;
}

// ----------------------------------------------------------------------------
// Main REPL
// ----------------------------------------------------------------------------

/**
 * Starts the interactive REPL loop.
 *
 * 1. Loads or initializes the project state from STATE.yaml
 * 2. Creates a new session
 * 3. Displays the startup banner
 * 4. Reads input line by line
 * 5. Routes slash commands to handlers
 * 6. Routes natural language to the agent loop
 * 7. Handles Ctrl+C gracefully
 */
export async function startRepl(options: ReplOptions): Promise<void> {
  // Load or initialize state
  let state: DanteCodeState;
  try {
    state = await readOrInitializeState(options.projectRoot);
  } catch {
    // STATE.yaml missing or invalid — try auto-init with detected API key
    const autoState = await tryAutoInit(options.projectRoot);
    if (autoState) {
      state = autoState;
      const provLabel = `${state.model.default.provider}/${state.model.default.modelId}`;
      if (!options.silent) {
        process.stdout.write(
          `${DIM}Auto-initialized with ${provLabel}. Run 'dantecode init' to customize.${RESET}\n`,
        );
      }
    } else {
      process.stderr.write(
        `${RED}No API key found and no STATE.yaml.${RESET}\n` +
          `${DIM}Set ANTHROPIC_API_KEY, XAI_API_KEY, or OPENAI_API_KEY. Or run 'dantecode init'.${RESET}\n`,
      );
      process.exit(1);
    }
  }

  // Apply model override if specified
  if (options.model) {
    state = applyModelOverride(state, options.model);
  }

  // Create session
  const session = createSession(options.projectRoot, state.model.default);
  if (options.sessionName) {
    session.name = options.sessionName;
  }

  // Display banner (suppressed in silent mode)
  if (!options.silent) {
    if (isFirstRun(options.projectRoot)) {
      // OnRamp v1.3: Try to run the onboarding wizard on first run
      let wizardRan = false;
      try {
        const { OnboardingWizard } = await import("@dantecode/ux-polish");
        const wizard = new OnboardingWizard({
          stateOptions: { projectRoot: options.projectRoot },
        });
        if (!wizard.isComplete()) {
          const wizResult = await wizard.run({ ci: !!process.env["CI"] });
          wizardRan = true;
          if (!wizResult.completed && wizResult.nextSuggestedStep) {
            process.stdout.write(`\n${DIM}${wizResult.nextSuggestedStep}${RESET}\n`);
          }
        }
      } catch {
        // Wizard not available — fall back to static banner
      }
      if (!wizardRan) {
        process.stdout.write(getFirstRunBanner());
      }
    } else {
      process.stdout.write(getCompactBanner(state.model.default) + "\n");
    }
    void checkForUpdate("2.0.0");

    // C1: Print git branch + session status bar after the welcome banner
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: process.cwd(),
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 2000,
      }).trim();
      const shortId = session.id.slice(0, 8);
      const modelId = state.model.default.modelId;
      process.stdout.write(
        `${DIM}[model: ${modelId}] [ctx: 0%] [session: ${shortId}] [branch: ${branch}]${RESET}\n`,
      );
    } catch {
      // git not available or not a git repo — skip status bar
    }
  }

  // Load saved theme from STATE.yaml (persisted by /theme command)
  let savedTheme: ThemeName = "default";
  try {
    const stateYamlRaw = await fsReadFile(
      pathJoin(options.projectRoot, ".dantecode", "STATE.yaml"),
      "utf8",
    );
    const themeMatch = /^theme:\s*(\w+)$/m.exec(stateYamlRaw);
    if (themeMatch?.[1]) {
      const candidate = themeMatch[1];
      const validThemes = ["default", "minimal", "rich", "matrix", "ocean"];
      if (validThemes.includes(candidate)) {
        savedTheme = candidate as ThemeName;
        getThemeEngine().setTheme(savedTheme);
      }
    }
  } catch {
    /* no saved theme — use default */
  }

  // Initialize REPL state
  const replState: ReplState = {
    session,
    state,
    projectRoot: options.projectRoot,
    verbose: options.verbose,
    enableGit: options.enableGit,
    enableSandbox: options.enableSandbox,
    silent: options.silent,
    lastEditFile: null,
    lastEditContent: null,
    lastRestoreEvent: null,
    preMutationSnapshotted: new Set<string>(),
    recentToolCalls: [],
    pendingAgentPrompt: null,
    pendingResumeRunId: null,
    pendingExpectedWorkflow: null,
    pendingWorkflowContext: null,
    activeAbortController: null,
    sandboxBridge: null,
    activeSkill: null,
    waveState: null,
    gaslight: null, // lazy-init: created on first prompt or /gaslight command
    memoryOrchestrator: null, // lazy-init: created on first /memory or /compact command
    modelAdaptationStore: null, // D-12: lazy-init below
    verificationTrendTracker: null, // lazy-init: created on first PDSE recording or /trend command
    lastSessionPdseResults: [],
    reasoningOverrideSession: false,
    theme: savedTheme,
    planMode: false,
    currentPlan: null,
    planApproved: false,
    currentPlanId: null,
    planExecutionInProgress: false,
    planExecutionResult: null,
    approvalMode: "review",
  };

  // --plan-first: automatically enter plan mode
  if (options.planFirst) {
    replState.planMode = true;
  }

  // D-12A: Initialize model adaptation store + restore rate limiter (non-fatal, gated on env)
  if (process.env.DANTE_DISABLE_MODEL_ADAPTATION !== "1") {
    try {
      const { ModelAdaptationStore, getGlobalAdaptationRateLimiter } =
        await import("@dantecode/core");
      replState.modelAdaptationStore = new ModelAdaptationStore(options.projectRoot);
      await replState.modelAdaptationStore.load();
      // Restore persisted rate limiter state (D-12A Gap 3)
      const restoredLimiter = replState.modelAdaptationStore.loadRateLimiterState();
      getGlobalAdaptationRateLimiter(restoredLimiter);
    } catch {
      // Non-fatal — model adaptation is optional
    }
  }

  // Agent loop config
  const agentConfig: AgentLoopConfig = {
    state,
    verbose: options.verbose,
    enableGit: options.enableGit,
    enableSandbox: options.enableSandbox,
    silent: options.silent,
    fearSetBlockOnNoGo: options.fearSetBlockOnNoGo === true,
    replState: replState,
  };

  // DanteGaslight: deferred to first use via getOrInitGaslight() in lazy-init.ts.
  // Constructed lazily in syncAgentLoopConfig (first prompt) or /gaslight command.

  // Initialize DanteSandbox enforcement engine — ALWAYS mandatory, mode="auto".
  // allowHostEscape:false = hard rejection when Docker + worktree both unavailable.
  // This is true mandatory enforcement: isolation is not optional.
  await DanteSandbox.setup({
    projectRoot: options.projectRoot,
    config: { mode: "auto", allowHostEscape: false },
  });

  // DanteMemory: deferred to first use via getOrInitMemory() in lazy-init.ts.
  // /memory and /compact call it lazily; null until then.

  // --continue / -C: restore the most recent session from disk
  if (options.resumeFromLastSession) {
    try {
      const { SessionStore } = await import("@dantecode/core");
      const store = new SessionStore(options.projectRoot);
      const sessions = await store.list();
      if (sessions.length > 0) {
        const latest = sessions[0]; // list() already sorted newest-first
        if (latest) {
          const file = await store.load(latest.id);
          if (file) {
            // Restore identity and full message history into the live session
            replState.session.id = file.id;
            replState.session.name = file.title;
            replState.session.createdAt = file.createdAt;
            replState.session.messages = file.messages.map((m) => ({
              id: randomUUID(),
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
            }));
            replState.session.updatedAt = new Date().toISOString();
            if (!options.silent) {
              process.stdout.write(`${DIM}[--continue] Resumed: ${file.title}${RESET}\n`);
            }
          }
        }
      }
    } catch {
      // Non-fatal: --continue failure falls back to fresh session
    }
  }

  // Initialize sandbox bridge when --sandbox is enabled
  if (options.enableSandbox) {
    agentConfig.sandboxBridge = new SandboxBridge(options.projectRoot, options.verbose);
    replState.sandboxBridge = agentConfig.sandboxBridge;
  }

  // Start GitEventWatcher when events.enabled is true in STATE.yaml
  let gitEventWatcher: GitEventWatcher | null = null;
  const stateAsMap = state as unknown as Record<string, unknown>;
  const eventsEnabled =
    stateAsMap["events"] !== undefined &&
    typeof stateAsMap["events"] === "object" &&
    (stateAsMap["events"] as Record<string, unknown>)["enabled"] === true;

  if (eventsEnabled) {
    try {
      gitEventWatcher = watchGitEvents("post-commit", undefined, {
        cwd: options.projectRoot,
        persist: false,
      });
      gitEventWatcher.on("event", (evt) => {
        appendAuditEvent(options.projectRoot, {
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          type: "git_commit",
          payload: { source: "git-event-watcher", event: evt },
          modelId: "system",
          projectRoot: options.projectRoot,
        }).catch(() => {});
      });
      if (!options.silent) {
        process.stdout.write(`${DIM}[git-event-watcher: monitoring post-commit events]${RESET}\n`);
      }
    } catch {
      // GitEventWatcher startup failure must not prevent the REPL from starting
    }
  }

  // Initialize TUI components
  const sessionStartMs = Date.now();
  const themeEngine = getThemeEngine();

  // Status bar (non-TTY: render() returns "" and draw() is a no-op)
  const modelLabel = `${state.model.default.provider}/${state.model.default.modelId}`;
  const sandboxMode = options.enableSandbox ? "workspace-write" : "full-access";
  const initialStatusBarState: StatusBarState = {
    modelLabel,
    tokensUsed: 0,
    sandboxMode,
    sessionName: options.sessionName ?? session.id.slice(0, 8),
  };
  const statusBar = new StatusBar(initialStatusBarState, themeEngine);

  // Context-aware prompt builder
  const modelShort = state.model.default.modelId.split("-").slice(0, 2).join("-");
  const buildCurrentPrompt = (roundCount = 0, lastPdse?: number): string =>
    buildPrompt({
      sessionName: options.sessionName ?? session.id.slice(0, 8),
      modelShort,
      sandboxMode,
      roundCount,
      lastPdse,
      theme: themeEngine,
    } satisfies PromptBuilderState);

  let currentRoundCount = 0;
  let currentPdseScore: number | undefined;

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildCurrentPrompt(),
    terminal: true,
  });

  // Gap #3 — crash-safe session report.
  // The rl.on("close") handler covers normal exits (Ctrl+D, /exit, process.exit).
  // This handler also writes the report on uncaught exceptions so the user always
  // has a record even if the process crashes. Non-fatal and best-effort only.
  const _writeCrashReport = async () => {
    if (currentRoundCount > 0) {
      await generateSessionReport({
        session: replState.session,
        projectRoot: options.projectRoot,
        modelId: state.model.default.modelId,
        provider: state.model.default.provider,
        dantecodeVersion: "1.0.0",
        sessionDurationMs: Date.now() - sessionStartMs,
        mode: replState.approvalMode,
        restoredAt: replState.lastRestoreEvent?.restoredAt,
        restoreSummary: replState.lastRestoreEvent?.restoreSummary,
        pdseResults: replState.lastSessionPdseResults.length > 0
          ? replState.lastSessionPdseResults
          : undefined,
      }).catch(() => {});
    }
  };
  process.once("uncaughtException", async (err) => {
    process.stderr.write(
      `\n[DanteCode] Uncaught exception: ${err.message ?? err}\nWriting crash report...\n`,
    );
    await _writeCrashReport();
    process.exit(1);
  });
  process.once("unhandledRejection", async (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write(
      `\n[DanteCode] Unhandled rejection: ${msg}\nWriting crash report...\n`,
    );
    await _writeCrashReport();
    process.exit(1);
  });

  // Handle Ctrl+C gracefully — first press aborts streaming, second exits
  let ctrlCCount = 0;
  rl.on("SIGINT", () => {
    // If a generation is in progress, abort it first
    if (replState.activeAbortController) {
      replState.activeAbortController.abort();
      replState.activeAbortController = null;
      process.stdout.write(`\n${DIM}(generation aborted)${RESET}\n`);
      ctrlCCount = 0;
      return;
    }
    ctrlCCount++;
    if (ctrlCCount >= 2) {
      process.stdout.write(`\n${DIM}Goodbye!${RESET}\n`);
      process.exit(0);
    }
    process.stdout.write(`\n${DIM}Press Ctrl+C again to exit, or type /clear to reset.${RESET}\n`);
    rl.prompt();
  });

  // Multi-line input support: track whether we are collecting multi-line input
  let multiLineBuffer: string[] | null = null;

  // Draw status bar then show initial prompt
  statusBar.draw();
  rl.prompt();

  rl.on("line", async (rawLine: string) => {
    // Reset Ctrl+C counter on any input
    ctrlCCount = 0;

    const line = rawLine.trimEnd();

    // Multi-line mode: start with """ or ``` and end with the same
    if (multiLineBuffer !== null) {
      if (line === '"""' || line === "```") {
        // End of multi-line input
        const fullInput = multiLineBuffer.join("\n");
        multiLineBuffer = null;

        if (fullInput.trim().length > 0) {
          await processInput(fullInput, replState, agentConfig, rl, () => {
            currentRoundCount++;
            const totalTokens = replState.session.messages.reduce(
              (s, m) => s + (m.tokensUsed ?? 0),
              0,
            );
            statusBar.update({ tokensUsed: totalTokens, elapsedMs: Date.now() - sessionStartMs });
            rl.setPrompt(buildCurrentPrompt(currentRoundCount, currentPdseScore));
            statusBar.draw();
          });
        } else {
          rl.prompt();
        }
      } else {
        multiLineBuffer.push(line);
      }
      return;
    }

    // Start multi-line input
    if (line === '"""' || line === "```") {
      multiLineBuffer = [];
      process.stdout.write(`${DIM}(multi-line mode, end with ${line})${RESET}\n`);
      return;
    }

    // Skip empty lines
    if (line.trim().length === 0) {
      rl.prompt();
      return;
    }

    await processInput(line, replState, agentConfig, rl, () => {
      currentRoundCount++;
      const totalTokens = replState.session.messages.reduce((s, m) => s + (m.tokensUsed ?? 0), 0);
      statusBar.update({ tokensUsed: totalTokens, elapsedMs: Date.now() - sessionStartMs });
      rl.setPrompt(buildCurrentPrompt(currentRoundCount, currentPdseScore));
      statusBar.draw();
    });
  });

  rl.on("close", async () => {
    // Stop GitEventWatcher if running
    if (gitEventWatcher) {
      await gitEventWatcher.stop().catch(() => {});
    }
    // Tear down DanteSandbox isolation layers (containers, worktrees)
    await DanteSandbox.teardown().catch(() => {});
    // Shut down sandbox container if running
    if (replState.sandboxBridge) {
      await replState.sandboxBridge.shutdown();
    }

    // Clear status bar, then show token dashboard at session end
    statusBar.clear();
    if (!options.silent && currentRoundCount > 0) {
      const sessionMessages = replState.session.messages;
      const totalTokens = sessionMessages.reduce((sum, m) => sum + (m.tokensUsed ?? 0), 0);
      if (totalTokens > 0) {
        const tokenData: TokenUsageData = {
          totalTokens,
          inputTokens: Math.round(totalTokens * 0.66),
          outputTokens: Math.round(totalTokens * 0.34),
          byTool: {},
          modelId: state.model.default.modelId,
          contextWindow: 131072,
          contextUtilization: Math.min(1, totalTokens / 131072),
          sessionDurationMs: Date.now() - sessionStartMs,
        };
        process.stdout.write(renderTokenDashboard(tokenData, themeEngine));
      }
    }

    // Generate session report for REPL sessions (only if files were modified)
    if (currentRoundCount > 0) {
      const reportPath = await generateSessionReport({
        session: replState.session,
        projectRoot: options.projectRoot,
        modelId: state.model.default.modelId,
        provider: state.model.default.provider,
        dantecodeVersion: "1.0.0",
        sessionDurationMs: Date.now() - sessionStartMs,
        mode: replState.approvalMode,
        restoredAt: replState.lastRestoreEvent?.restoredAt,
        restoreSummary: replState.lastRestoreEvent?.restoreSummary,
        // Pass accumulated PDSE results so the report includes verification truth,
        // not just mutation counts. This satisfies the core product trust promise
        // for plain REPL sessions (gap FC-2 / gap #1).
        pdseResults: replState.lastSessionPdseResults.length > 0
          ? replState.lastSessionPdseResults
          : undefined,
      });
      if (reportPath && !options.silent) {
        process.stdout.write(`${DIM}Report saved: ${reportPath}${RESET}\n`);
      }
    }

    process.stdout.write(`\n${DIM}Session ended. Goodbye!${RESET}\n`);
    process.exit(0);
  });
}

/**
 * Processes a single line of input — either a slash command or a natural language prompt.
 */
async function processInput(
  input: string,
  replState: ReplState,
  agentConfig: AgentLoopConfig,
  rl: readline.Interface,
  onBeforePrompt?: () => void,
): Promise<void> {
  // Pause the readline while processing
  rl.pause();

  // Use richRenderer and progressOrchestrator for structured UX output.
  // For pipeline commands (/magic, /forge, /inferno, etc.) we track progress.
  const isPipelineCommand =
    isSlashCommand(input) &&
    /^\/(?:magic|forge|inferno|autoforge|blaze|ember|spark|party|ship|verify)\b/i.test(
      input.trim(),
    );
  const progressId = isPipelineCommand ? `cmd-${Date.now()}` : null;

  try {
    if (progressId) {
      progressOrchestrator.startProgress(progressId, {
        phase: input.trim().split(/\s+/)[0] ?? input.trim(),
        message: "running",
        initialProgress: 0,
      });
      if (!replState.silent) {
        process.stdout.write(
          richRenderer.render("cli", { kind: "status", content: `Starting ${input.trim()}` })
            .output + "\n",
        );
      }
    }

    if (isSlashCommand(input)) {
      // Route to slash command handler
      const output = await routeSlashCommand(input, replState);
      // Render slash command output through the RichRenderer for structured formatting
      const rendered = richRenderer.render("cli", { kind: "markdown", content: output });
      process.stdout.write(`${rendered.rendered ? rendered.output : output}\n`);

      // Some slash commands (e.g. /oss) set a pending prompt to chain into the agent loop
      if (replState.pendingAgentPrompt) {
        const agentPrompt = replState.pendingAgentPrompt;
        replState.pendingAgentPrompt = null;
        syncAgentLoopConfig(replState, agentConfig);
        replState.activeAbortController = new AbortController();
        agentConfig.abortSignal = replState.activeAbortController.signal;
        replState.session = await runAgentLoop(agentPrompt, replState.session, agentConfig);
        replState.pendingResumeRunId = null;
        replState.pendingExpectedWorkflow = null;
        replState.pendingWorkflowContext = null;
        replState.activeAbortController = null;
      }
    } else {
      // Route to agent loop
      syncAgentLoopConfig(replState, agentConfig);
      replState.activeAbortController = new AbortController();
      agentConfig.abortSignal = replState.activeAbortController.signal;
      replState.session = await runAgentLoop(input, replState.session, agentConfig);
      replState.pendingResumeRunId = null;
      replState.pendingExpectedWorkflow = null;
      replState.pendingWorkflowContext = null;
      replState.activeAbortController = null;
    }

    if (progressId) {
      progressOrchestrator.completeProgress(progressId, "done");
      if (!replState.silent) {
        process.stdout.write(progressOrchestrator.renderOne(progressId) + "\n");
      }
      progressOrchestrator.remove(progressId);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (progressId) {
      progressOrchestrator.failProgress(progressId, message);
      if (!replState.silent) {
        process.stdout.write(progressOrchestrator.renderOne(progressId) + "\n");
      }
      progressOrchestrator.remove(progressId);
    }
    process.stdout.write(`\n${RED}Error: ${message}${RESET}\n`);
  }

  // Invoke UI hook (status bar update + prompt update) before resuming
  onBeforePrompt?.();
  // Resume readline and prompt
  rl.resume();
  rl.prompt();
}

// ----------------------------------------------------------------------------
// One-Shot Mode
// ----------------------------------------------------------------------------

/**
 * Executes a single prompt in non-interactive mode.
 * Sends the prompt to the agent, prints the response, and exits.
 */
export async function runOneShotPrompt(prompt: string, options: ReplOptions): Promise<void> {
  // Load or initialize state.
  // When configRoot is set (e.g. spawned inside a council worktree), load config
  // from the main repo root so API keys and settings are available even though
  // the worktree has no STATE.yaml.
  const stateRoot = options.configRoot ?? options.projectRoot;
  let state: DanteCodeState;
  try {
    state = await readOrInitializeState(stateRoot);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${RED}Error loading state: ${message}${RESET}\n`);
    process.exit(1);
  }

  // Apply model override
  if (options.model) {
    state = applyModelOverride(state, options.model);
  }

  // Create session
  const session = createSession(options.projectRoot, state.model.default);
  if (options.sessionName) {
    session.name = options.sessionName;
  }

  // Config
  const agentConfig: AgentLoopConfig = {
    state,
    verbose: options.verbose,
    enableGit: options.enableGit,
    enableSandbox: options.enableSandbox,
    silent: options.silent,
  };

  if (options.maxRounds !== undefined) {
    agentConfig.requiredRounds = options.maxRounds;
  }

  if (options.enableSandbox) {
    agentConfig.sandboxBridge = new SandboxBridge(options.projectRoot, options.verbose);
  }

  // Run the agent loop once
  try {
    await runAgentLoop(prompt, session, agentConfig);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${RED}Error: ${message}${RESET}\n`);
    process.exit(1);
  } finally {
    if (agentConfig.sandboxBridge) {
      await agentConfig.sandboxBridge.shutdown();
    }
  }
}
