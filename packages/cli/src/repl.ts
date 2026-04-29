// ============================================================================
// @dantecode/cli — Main REPL Loop (readline-based)
// A simple, robust terminal REPL that reads user input line by line,
// routes slash commands to handlers, and routes natural language to the agent.
// ============================================================================

import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import { parseModelReference, readOrInitializeState } from "@dantecode/core";
import type { Session, DanteCodeState, ModelConfig } from "@dantecode/config-types";
import { getBanner } from "./banner.js";
import { routeSlashCommand, isSlashCommand } from "./slash-commands.js";
import type { ReplState } from "./slash-commands.js";
import { runAgentLoop } from "./agent-loop.js";
import type { AgentLoopConfig } from "./agent-loop.js";
import { SandboxBridge } from "./sandbox-bridge.js";
import { loadMCPConfig, MCPClientManager, mcpToolsToAISDKTools } from "@dantecode/mcp";

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

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
  agentConfig.sandboxBridge = replState.enableSandbox
    ? (replState.sandboxBridge ?? undefined)
    : undefined;
  // Architect/Editor split: wire planning model when configured via taskOverrides
  agentConfig.architectModel = replState.state.model.taskOverrides["planning"] ?? undefined;
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
/** Print the startup banner + sandbox status + MCP status (suppressed in silent mode). */
async function displayReplStartupStatus(
  options: ReplOptions,
  state: DanteCodeState,
  mcpClientManager: MCPClientManager,
  toolCount: number,
): Promise<void> {
  if (!options.silent) {
    process.stdout.write(getBanner(state.model.default, options.projectRoot));
  }
  if (options.enableSandbox && !options.silent) {
    const bridge = new SandboxBridge(options.projectRoot, false);
    const dockerAvailable = await bridge.isAvailable();
    const sandboxMode = dockerAvailable ? "Docker container" : "local (audit-logged)";
    process.stdout.write(`${DIM}[sandbox: ${sandboxMode}]${RESET}\n`);
  } else if (!options.enableSandbox && !options.silent) {
    process.stdout.write(`${DIM}[sandbox: disabled — run without --no-sandbox to enable]${RESET}\n`);
  }
  if (!options.silent && toolCount > 0) {
    const serverCount = mcpClientManager.getConnectedServers().length;
    process.stdout.write(
      `${DIM}[mcp: ${serverCount} server${serverCount !== 1 ? "s" : ""}, ` +
        `${toolCount} tool${toolCount !== 1 ? "s" : ""}]${RESET}\n`,
    );
  }
}

/** Two-press Ctrl+C: first press aborts in-flight generation, second exits.
 * Returns a small ref object that the caller can update to reset the counter. */
function wireCtrlCHandler(rl: readline.Interface, replState: ReplState): { count: number } {
  const ref = { count: 0 };
  rl.on("SIGINT", () => {
    if (replState.activeAbortController) {
      replState.activeAbortController.abort();
      replState.activeAbortController = null;
      process.stdout.write(`\n${DIM}(generation aborted)${RESET}\n`);
      ref.count = 0;
      return;
    }
    ref.count++;
    if (ref.count >= 2) {
      process.stdout.write(`\n${DIM}Goodbye!${RESET}\n`);
      process.exit(0);
    }
    process.stdout.write(`\n${DIM}Press Ctrl+C again to exit, or type /clear to reset.${RESET}\n`);
    rl.prompt();
  });
  return ref;
}

/** Wire the readline `line` handler with multi-line buffer support
 * (triple-quote / triple-backtick fences). */
function wireReplLineHandler(
  rl: readline.Interface,
  replState: ReplState,
  agentConfig: AgentLoopConfig,
): void {
  let multiLineBuffer: string[] | null = null;
  rl.on("line", async (rawLine: string) => {
    const line = rawLine.trimEnd();
    if (multiLineBuffer !== null) {
      if (line === '"""' || line === "```") {
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
    if (line === '"""' || line === "```") {
      multiLineBuffer = [];
      process.stdout.write(`${DIM}(multi-line mode, end with ${line})${RESET}\n`);
      return;
    }
    if (line.trim().length === 0) {
      rl.prompt();
      return;
    }
    await processInput(line, replState, agentConfig, rl);
  });
}

/** Shut down sandbox + MCP on readline close, then exit cleanly. */
function wireReplCloseHandler(rl: readline.Interface, replState: ReplState): void {
  rl.on("close", async () => {
    if (replState.sandboxBridge) await replState.sandboxBridge.shutdown();
    if (replState.mcpClient) await replState.mcpClient.disconnectAll();
    process.stdout.write(`\n${DIM}Session ended. Goodbye!${RESET}\n`);
    process.exit(0);
  });
}

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

  // Load MCP config and connect to any configured external servers (before banner so status is visible)
  const mcpConfig = await loadMCPConfig(options.projectRoot);
  const mcpClientManager = new MCPClientManager();
  await mcpClientManager.connectAll(mcpConfig);
  const connectedTools = mcpClientManager.listTools();

  await displayReplStartupStatus(options, state, mcpClientManager, connectedTools.length);

  const permissions = state.permissions || {
    edit: "ask",
    bash: "ask",
    tools: "allow",
  };

  // Create readline interface before wiring any interactive permission prompts.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${CYAN}>${RESET} `,
    terminal: true,
  });

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
    activeAbortController: null,
    sandboxBridge: null,
    mcpClient: null,
    activeSkill: null,
    waveState: null,
    permissions,
    rl: rl,
  };

  // Agent loop config
  const agentConfig: AgentLoopConfig = {
    state,
    verbose: options.verbose,
    enableGit: options.enableGit,
    enableSandbox: options.enableSandbox,
    silent: options.silent,
    permissions: permissions,
    rl: rl,
    onCostUpdate: (estimate, provider) => {
      replState.lastCostEstimate = { ...estimate, provider };
    },
  };

  // Initialize sandbox bridge when --sandbox is enabled
  if (options.enableSandbox) {
    agentConfig.sandboxBridge = new SandboxBridge(options.projectRoot, options.verbose);
    replState.sandboxBridge = agentConfig.sandboxBridge;
  }

  // Wire MCP client into agentConfig and replState (already connected above, before banner)
  if (connectedTools.length > 0) {
    agentConfig.mcpTools = mcpToolsToAISDKTools(connectedTools);
    agentConfig.mcpClient = mcpClientManager;
  }
  replState.mcpClient = mcpClientManager;

  const ctrlCRef = wireCtrlCHandler(rl, replState);
  void ctrlCRef;
  wireReplLineHandler(rl, replState, agentConfig);
  wireReplCloseHandler(rl, replState);

  rl.prompt();
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

  try {
    if (isSlashCommand(input)) {
      // Route to slash command handler
      const output = await routeSlashCommand(input, replState);
      process.stdout.write(`${output}\n`);

      // Some slash commands (e.g. /oss) set a pending prompt to chain into the agent loop
      if (replState.pendingAgentPrompt) {
        const agentPrompt = replState.pendingAgentPrompt;
        replState.pendingAgentPrompt = null;
        syncAgentLoopConfig(replState, agentConfig);
        replState.activeAbortController = new AbortController();
        agentConfig.abortSignal = replState.activeAbortController.signal;
        replState.session = await runAgentLoop(agentPrompt, replState.session, agentConfig);
        replState.activeAbortController = null;
      }
    } else {
      // Route to agent loop
      syncAgentLoopConfig(replState, agentConfig);
      replState.activeAbortController = new AbortController();
      agentConfig.abortSignal = replState.activeAbortController.signal;
      replState.session = await runAgentLoop(input, replState.session, agentConfig);
      replState.activeAbortController = null;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
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
