// ============================================================================
// @dantecode/cli — Main REPL Loop (readline-based)
// A simple, robust terminal REPL that reads user input line by line,
// routes slash commands to handlers, and routes natural language to the agent.
// ============================================================================

import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import { parseModelReference, readOrInitializeState, appendAuditEvent } from "@dantecode/core";
import type { Session, DanteCodeState, ModelConfig } from "@dantecode/config-types";
import { getBanner } from "./banner.js";
import { routeSlashCommand, isSlashCommand } from "./slash-commands.js";
import type { ReplState } from "./slash-commands.js";
import { runAgentLoop } from "./agent-loop.js";
import type { AgentLoopConfig } from "./agent-loop.js";
import { SandboxBridge } from "./sandbox-bridge.js";
import { RichRenderer, ProgressOrchestrator } from "@dantecode/ux-polish";
import { watchGitEvents } from "@dantecode/git-engine";
import type { GitEventWatcher } from "@dantecode/git-engine";

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `${RED}Error loading project state: ${message}${RESET}\n` +
        `${DIM}Run 'dantecode init' to initialize a new project.${RESET}\n`,
    );
    process.exit(1);
  }

  // Apply model override if specified
  if (options.model) {
    state = applyModelOverride(state, options.model);
  }

  // Create session
  const session = createSession(options.projectRoot, state.model.default);

  // Display banner (suppressed in silent mode)
  if (!options.silent) {
    const banner = getBanner(state.model.default, options.projectRoot);
    process.stdout.write(banner);
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
    recentToolCalls: [],
    pendingAgentPrompt: null,
    pendingResumeRunId: null,
    pendingExpectedWorkflow: null,
    pendingWorkflowContext: null,
    activeAbortController: null,
    sandboxBridge: null,
    activeSkill: null,
    waveState: null,
  };

  // Agent loop config
  const agentConfig: AgentLoopConfig = {
    state,
    verbose: options.verbose,
    enableGit: options.enableGit,
    enableSandbox: options.enableSandbox,
    silent: options.silent,
  };

  // Initialize sandbox bridge when --sandbox is enabled
  if (options.enableSandbox) {
    agentConfig.sandboxBridge = new SandboxBridge(options.projectRoot, options.verbose);
    replState.sandboxBridge = agentConfig.sandboxBridge;
  }

  // Start GitEventWatcher when events.enabled is true in STATE.yaml
  let gitEventWatcher: GitEventWatcher | null = null;
  const eventsEnabled = (state as Record<string, unknown>)["events"] !== undefined &&
    typeof (state as Record<string, unknown>)["events"] === "object" &&
    ((state as Record<string, unknown>)["events"] as Record<string, unknown>)["enabled"] === true;

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

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${CYAN}>${RESET} `,
    terminal: true,
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
          await processInput(fullInput, replState, agentConfig, rl);
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

    await processInput(line, replState, agentConfig, rl);
  });

  rl.on("close", async () => {
    // Stop GitEventWatcher if running
    if (gitEventWatcher) {
      await gitEventWatcher.stop().catch(() => {});
    }
    // Shut down sandbox container if running
    if (replState.sandboxBridge) {
      await replState.sandboxBridge.shutdown();
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
): Promise<void> {
  // Pause the readline while processing
  rl.pause();

  // Use richRenderer and progressOrchestrator for structured UX output.
  // For pipeline commands (/magic, /forge, /inferno, etc.) we track progress.
  const isPipelineCommand = isSlashCommand(input) &&
    /^\/(?:magic|forge|inferno|autoforge|blaze|ember|spark|party|ship|verify)\b/i.test(input.trim());
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
          richRenderer.render("cli", { kind: "status", content: `Starting ${input.trim()}` }).output + "\n",
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
  // Load or initialize state
  let state: DanteCodeState;
  try {
    state = await readOrInitializeState(options.projectRoot);
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

  // Config
  const agentConfig: AgentLoopConfig = {
    state,
    verbose: options.verbose,
    enableGit: options.enableGit,
    enableSandbox: options.enableSandbox,
    silent: options.silent,
  };

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
